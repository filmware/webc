#!/usr/bin/env python3

import argparse
import asyncio
import collections
import datetime
import json
import logging
import pathlib
import random
import sys
import textwrap
import time
import uuid
import urllib.request

import asyncpg

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("fake")

OWNER = "0fe07a2c-59d1-4f65-a8a8-e0b4269c32ef"
PROJ = "aeb2c3f0-a645-44a9-b6f6-9cb7152c0163"
PROJ_VERSION = "45d56af6-5403-4736-9b3c-04a08fa68c9a"

_dickens = None

def get_dickens():
    global _dickens
    if _dickens is None:
        path = pathlib.Path(__file__).parent / ".great_expectations.txt"
        if not path.exists():
            print("downloading great expectations...", file=sys.stderr)
            url = "https://www.gutenberg.org/ebooks/1400.txt.utf-8"
            tmp = pathlib.Path(__file__).parent / ".great_expectations.txt~"
            with tmp.open("w") as f:
                with urllib.request.urlopen(url) as req:
                    f.write(req.read().decode('utf8'))
            tmp.rename(path)
        with path.open() as f:
            _dickens = f.read()
    return _dickens

def random_word(n):
    dickens = get_dickens()
    start = random.randint(0, len(dickens)-100)
    subtext = dickens[start:start+100]
    return " ".join(subtext.split()[1:1+n])

def random_sentence(n):
    dickens = get_dickens()
    start = random.randint(0, len(dickens)-1000)
    subtext = dickens[start:start+1000]
    return "  ".join([
        s.strip().replace("\n", " ") + "." for s in subtext.split(".")[1:1+n]
    ])


def ri(a, b):
    return random.randint(a, b)


async def random_user(conn):
    all_users = [str(r["user"]) for r in await conn.fetch('select "user" from users')]
    return random.choice(all_users)


def tojson(obj, indent=None):

    def jsonable(obj):
        if isinstance(obj, (str, bool, type(None), int, float)):
            return obj
        if isinstance(obj, (list, tuple)):
            return [jsonable(v) for v in obj]
        if isinstance(obj, dict):
            return {str(k): jsonable(v) for k, v in obj.items()}
        # custom types
        if isinstance(obj, uuid.UUID):
            return str(obj)
        if isinstance(obj, datetime.datetime):
            # .isoformat doesn't do what I want; I want utc rfc3339 stamps
            return obj.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        raise TypeError(
            f"unable to jsonify {obj!r} of type {type(obj).__name__}"
        )

    return json.dumps(jsonable(obj), indent=indent)


async def fake_report(conn):
    user = await random_user(conn)
    # Create a fake report.
    report = uuid.uuid4()
    version = uuid.uuid4()
    upload = uuid.uuid4()
    column_uuids = [uuid.uuid4() for _ in range(ri(2,5))]
    columns = [f"{i} {random_word(2)}" for i, _ in enumerate(column_uuids)]
    row_uuids = [uuid.uuid4() for i in range(ri(2, 5))]
    rows = [{c: random_word(ri(1, 10)) for c in column_uuids} for _ in row_uuids]
    operation = {
        "operation": "new",
        "column_uuids": column_uuids,
        "columns": columns,
        "row_uuids": row_uuids,
        "rows": rows,
    }
    modifies = None
    reason = None
    await conn.fetch(
        f"""
        insert into reports (
            project,
            report,
            version,
            operation,
            modifies,
            "user",
            reason,
            submissiontime,
            authortime
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        """,
        PROJ,
        report,
        version,
        tojson(operation),
        modifies,
        user,
        reason,
        datetime.datetime.now(),
        datetime.datetime.now(),
    )


class ReportVersion:
    def __init__(self, report, row):
        self.report = str(report)
        self.version = str(row["version"])
        self.modifies = row["modifies"] and json.loads(row["modifies"]) or []
        self.operation = json.loads(row["operation"])
        self.type = self.operation["operation"]

async def get_report_versions(conn, report):
    all_versions = await conn.fetch(
        "select report, version, operation, modifies from reports where report = $1", report
    )
    return [ReportVersion(report, result) for result in all_versions]

def get_columns(rvs):
    cols = []
    for rv in rvs:
        if rv.type == "new":
            cols.extend(rv.operation["column_uuids"])
        elif rv.type == "add-column":
            cols.append(rv.operation["uuid"])
    return cols


class Unresolved:
    def __init__(self, missing, func):
        self.missing = set(missing)
        self.func = func

    def resolve(self, val):
        self.missing.remove(val)
        if self.missing:
            return
        self.func()


def resolvable(rvs):
    seen = set()
    needed = {}
    ready = list(rvs)
    while ready:
        rv = ready.pop(0)
        missing = [m for m in rv.modifies if m not in seen]
        if missing:
            u = Unresolved(missing, lambda: ready.append(rv))
            [needed.setdefault(m, []).append(u) for m in missing]
            continue
        seen.add(rv.version)
        for u in needed.pop(rv.version, []):
            u.resolve(rv.version)
        yield rv


def structure_versions(rvs):
    columns = collections.defaultdict(set)
    unmod_columns = collections.defaultdict(set)
    # cells[row][col]
    cells = collections.defaultdict(lambda: collections.defaultdict(set))
    unmod_cells = collections.defaultdict(lambda: collections.defaultdict(set))

    def apply(rv, c, u, *keys):
        # apply to {column,cells}
        x = c
        for k in keys:
            x = x[k]
        x.add(rv.version)
        # apply to unmod_{columns,cells}
        x = u
        for k in keys:
            x = x[k]
        x.add(rv.version)
        [x.discard(m) for m in rv.modifies]

    for rv in resolvable(rvs):
        if rv.type == "new":
            for c in rv.operation["column_uuids"]:
                apply(rv, columns, unmod_columns, c)
                for r, row in zip(rv.operation["row_uuids"], rv.operation["rows"]):
                    if c in row:
                        apply(rv, cells, unmod_cells, r, c)
        elif rv.type == "add-column":
            apply(rv, columns, unmod_columns, rv.operation["uuid"])
        elif rv.type == "rename-column":
            apply(rv, columns, unmod_columns, rv.operation["uuid"])
        elif rv.type == "add-row":
            for c in rv.operation["row"]:
                apply(rv, cells, unmod_cells, rv.operation["uuid"], c)
        elif rv.type == "update-cell":
            apply(rv, cells, unmod_cells, rv.operation["row"], rv.operation["column"])

    return columns, cells, unmod_columns, unmod_cells


async def fake_edit(conn):
    user = await random_user(conn)
    # Create a fake edit in every existing report.
    all_reports = set(
        str(r["report"]) for r in await conn.fetch("select report from reports group by report")
    )
    for report in all_reports:
        rvs = await get_report_versions(conn, report)
        columns = get_columns(rvs)
        colvers, cellvers, unmod_cols, unmod_cells = structure_versions(rvs)

        mode = ri(1,7)

        if 1 <= mode <= 4:
            # fill in a blank
            filled_one = False
            rlist = list(unmod_cells.items())
            random.shuffle(rlist)
            clist = list(columns)
            random.shuffle(columns)
            for row, cells in rlist:
                for column in clist:
                    if column in cells:
                        continue
                    filled_one = True
                    reason = "filling empty cell"
                    version = uuid.uuid4()
                    modifies = None
                    operation = {
                        "operation": "update-cell",
                        "row": row,
                        "column": column,
                        "text": random_word(ri(1,2)),
                    }
                    await conn.fetch(
                        """
                        insert into reports (
                            project,
                            report,
                            version,
                            operation,
                            modifies,
                            reason,
                            "user",
                            submissiontime,
                            authortime
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                        """,
                        PROJ,
                        report,
                        version,
                        tojson(operation),
                        modifies,
                        reason,
                        user,
                        datetime.datetime.now(),
                        datetime.datetime.now(),
                    )
                    break

                if filled_one:
                    break

            if not filled_one:
                # fine, create a new one instead
                mode = 5


        if mode == 5:
            # create a conflict
            if ri(1,4) == 1:
                # conflict on a column name
                c = random.choice(columns)
                modifies = [
                    tojson([random.choice(list(unmod_cols[c]))]),
                    tojson([random.choice(list(unmod_cols[c]))]),
                ]
                operation = [
                    {"operation": "rename-column", "uuid": c, "name": random_word(ri(1,2))},
                    {"operation": "rename-column", "uuid": c, "name": random_word(ri(1,2))},
                ]
            else:
                # create a conflict in a cell somewhere
                c = random.choice(columns)
                r = random.choice(list(cellvers))
                unmod_cell = unmod_cells[r][c]
                modifies = [
                    tojson([random.choice(list(unmod_cell))]) if unmod_cell else None,
                    tojson([random.choice(list(unmod_cell))]) if unmod_cell else None,
                ]
                operation = [
                    {"operation": "update-cell", "column": c, "row": r, "text": random_word(3)},
                    {"operation": "update-cell", "column": c, "row": r, "text": random_word(3)},
                ]

            reason = [random_sentence(1), random_sentence(1)]
            version = [uuid.uuid4(), uuid.uuid4()]
            user2 = await random_user(conn)
            await conn.fetch(
                """
                insert into reports (
                    project,
                    report,
                    version,
                    operation,
                    modifies,
                    reason,
                    "user",
                    submissiontime,
                    authortime
                ) VALUES
                    ($1, $2, $3, $4, $5, $6, $7, $8, $9),
                    ($10, $11, $12, $13, $14, $15, $16, $17, $18)
                """,
                # a
                PROJ,
                report,
                version[0],
                tojson(operation[0]),
                modifies[0],
                reason[0],
                user,
                datetime.datetime.now(),
                datetime.datetime.now(),
                # b
                PROJ,
                report,
                version[1],
                tojson(operation[1]),
                modifies[1],
                reason[1],
                user2,
                datetime.datetime.now(),
                datetime.datetime.now(),
            )

        if mode == 6:
            # resolve all conflicts.
            resolved_one = False
            # resolve all column conflicts
            for c, unmod in unmod_cols.items():
                if len(unmod) < 2: continue
                resolved_one = True
                operation = {"operation": "rename-column", "uuid": c, "name": random_word(ri(1,2))}
                modifies = list(unmod)
                version = uuid.uuid4()
                reason = "resolve conflicts"
                await conn.fetch(
                    """
                    insert into reports (
                        project,
                        report,
                        version,
                        operation,
                        modifies,
                        reason,
                        "user",
                        submissiontime,
                        authortime
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    """,
                    # a
                    PROJ,
                    report,
                    version,
                    tojson(operation),
                    tojson(modifies),
                    reason,
                    user,
                    datetime.datetime.now(),
                    datetime.datetime.now(),
                )
            # resolve all cell conflicts
            for r, cells in unmod_cells.items():
                for c, unmod in cells.items():
                    if len(unmod) < 2: continue
                    resolved_one = True
                    text = random_word(ri(1,5))
                    operation = {"operation": "update-cell", "row": r, "column": c, "text": text}
                    modifies = list(unmod)
                    version = uuid.uuid4()
                    reason = "resolve conflicts"
                    await conn.fetch(
                        """
                        insert into reports (
                            project,
                            report,
                            version,
                            operation,
                            modifies,
                            reason,
                            "user",
                            submissiontime,
                            authortime
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                        """,
                        # a
                        PROJ,
                        report,
                        version,
                        tojson(operation),
                        tojson(modifies),
                        reason,
                        user,
                        datetime.datetime.now(),
                        datetime.datetime.now(),
                    )
            if not resolved_one:
                # no conflict was resolved, insert something new instead
                mode = 7

        if mode == 7:
            # add a new column or row
            if ri(1,4) == 1:
                # add a new column
                column = uuid.uuid4()
                name = random_word(ri(1,3))
                operation = {"operation": "add-column", "uuid": column, "name": name}
                reason = "I wanted a new column"
            else:
                # add a new row
                row = uuid.uuid4()
                cells = {c: random_word(ri(1,5)) for c in columns}
                operation = {"operation": "add-row", "uuid": row, "row": cells}
                reason = "I wanted a new row"

            version = uuid.uuid4()
            modifies = None

            # add a brand new entry
            entry_uuid = uuid.uuid4()
            version = uuid.uuid4()
            reason = None
            await conn.fetch(
                """
                insert into reports (
                    project,
                    report,
                    version,
                    operation,
                    modifies,
                    reason,
                    "user",
                    submissiontime,
                    authortime
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                PROJ,
                report,
                version,
                tojson(operation),
                None, # modifies
                reason,
                user,
                datetime.datetime.now(),
                datetime.datetime.now(),
            )


async def fake_topic(conn):
    user = await random_user(conn)
    mode = ri(1,2)
    if mode == 1:
        # Modify an existing topic.
        all_topics = [
            str(r["topic"]) for r in await conn.fetch(
                "select topic from topics group by topic"
            )
        ]
        if not all_topics:
            mode = 2
        else:
            version = uuid.uuid4()
            topic = random.choice(all_topics)
            name = random_word(5)
            links = None

    if mode == 2:
        # Create a new topic.
        version = uuid.uuid4()
        topic = uuid.uuid4()
        name = random_word(5)
        all_reports = [
            str(r["report"]) for r in await conn.fetch(
                "select report from reports group by report"
            )
        ]
        random.shuffle(all_reports)
        links = [("report", str(r)) for r in all_reports[:ri(0,3)]]

    await conn.fetch(
        f"""
        insert into topics (
            project,
            "user",
            version,
            topic,
            name,
            submissiontime,
            authortime,
            links
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        PROJ,
        user,
        version,
        topic,
        name,
        datetime.datetime.now(),
        datetime.datetime.now(),
        tojson(links),
    )

async def fake_comment(conn):
    user = await random_user(conn)
    # Create a comment in every existing topic.
    all_topics = [
        r["topic"] for r in await conn.fetch(
            "select topic from topics group by topic"
        )
    ]
    for topic in all_topics:
        # {comment: parent}
        comments = {
            c: p for c, p in await conn.fetch(
                "select comment, parent "
                "from comments where topic = $1",
                topic,
            )
        }
        threads = set(comments.values()) or set([None])

        mode = ri(1,5) if comments else 1

        version = uuid.uuid4()

        if mode in (1, 2):
            # add a new comment in a random thread
            comment = uuid.uuid4()
            parent = random.choice(list(threads))

        if mode in (3, 4):
            # modify an existing comment
            comment, parent = random.choice(list(comments.items()))

        if mode == 5:
            # start a new thread
            comment = uuid.uuid4()
            parent = random.choice(list(comments))

        body = random_sentence(ri(1,5))
        submissiontime = time.time()

        await conn.fetch(
            f"""
            insert into comments (
                project,
                "user",
                topic,
                version,
                comment,
                parent,
                body,
                submissiontime,
                authortime
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """,
            PROJ,
            user,
            topic,
            version,
            comment,
            parent,
            body,
            datetime.datetime.now(),
            datetime.datetime.now(),
        )

async def fake_user(conn, user=None, firstname=None, lastname=None, kind="member"):
    names = [
        "Matthew", "Mark", "Luke", "John", "Paul", "Michael", "Gabriel", "Abraham", "Adam",
        "Isaac", "Levi", "Judah", "Joshua", "Moses", "Joseph", "Timothy", "Daniel", "Job",
    ]
    firstname = firstname or random.choice(names)
    lastname = lastname or random.choice(names) + "son"

    version = user or uuid.uuid4()
    account = user or uuid.uuid4()
    user = user or uuid.uuid4()

    # create an account
    await conn.fetch(
        f"""
        insert into accounts (
            version,
            account,
            "user",
            name,
            email,
            password,
            submissiontime,
            authortime
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (version) do nothing
        """,
        version,
        account,
        user,
        f"{firstname} {lastname}",
        f"{firstname}.{lastname}@filmware.io".lower(),
        # password is always "password"
        "$argon2id$v=19$m=65536,t=3,"
        "p=4$G3xG3i0g1GIVmQG81YDpcA$Lh6QE93dh7iOvm3o9OtA9g+m2ZBmUekx1VL7GLkdr5o",
        datetime.datetime.now(),
        datetime.datetime.now(),
    )

    # create a user for that account
    await conn.fetch(
        f"""
        insert into users (
            version,
            "user",
            account,
            submissiontime,
            authortime
        ) VALUES ($1, $2, $3, $4, $5)
        on conflict (version) do nothing
        """,
        version,
        user,
        account,
        datetime.datetime.now(),
        datetime.datetime.now(),
    )

    # and create a permission for the user
    await conn.fetch(
        f"""
        insert into permissions (
            version,
            "user",
            project,
            kind,
            enable,
            author,
            submissiontime,
            authortime
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (version) do nothing
        """,
        version,
        user,
        PROJ,
        kind,
        True,  # enabled
        OWNER,  # author
        datetime.datetime.now(),
        datetime.datetime.now(),
    )


async def make_project(conn):
    # create a project
    await conn.fetch(
        f"""
        insert into projects (
            version,
            project,
            name,
            "user",
            submissiontime,
            authortime
        ) VALUES ($1, $2, $3, $4, $5, $6)
        on conflict (version) do nothing;
        """,
        PROJ_VERSION,
        PROJ,
        "Avengers: Overkill",
        OWNER,
        datetime.datetime.now(),
        datetime.datetime.now(),
    )

    # create an owner
    await fake_user(conn, OWNER, "Praj", "Ectowner", "admin")


async def amain(args, host="/tmp/filmware"):
    conn = await asyncpg.connect(host=host, database="filmware")
    actions = {
        "r": fake_report,
        "e": fake_edit,
        "t": fake_topic,
        "c": fake_comment,
        "u": fake_user,
    }
    try:
        await make_project(conn)

        for arg in args:
            for c in arg:
                await actions[c](conn)
    finally:
        await conn.close()


def main(args, host="/tmp/filmware"):
    asyncio.run(amain(args, host=host))


if __name__ == "__main__":
    usage = textwrap.dedent(f"""
    usage: {sys.argv[0]} [OPTIONS] SPEC

    where SPEC is any sequence of the following characters:
        r   insert a report
        e   insert an edit into every report
        t   insert a topic
        c   insert a comment into every topic
        u   insert a user
    """).strip()

    parser = argparse.ArgumentParser(usage=usage)
    parser.add_argument("--pgpath", default="/tmp/filmware", help="path to postgres dir")
    parser.add_argument("SPEC", nargs="*")
    args = parser.parse_args()

    main(sys.argv[1:], args.pgpath)
