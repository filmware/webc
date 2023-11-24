#!/usr/bin/env python3

import asyncio
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


async def fake_report(conn):
    # Create a fake report.
    report_uuid = uuid.uuid4()
    for i in range(ri(5, 25)):
        entry_uuid = uuid.uuid4()
        version_uuid = uuid.uuid4()
        clip_id = str(ri(1, 50)) + "abcdef"[ri(0,5)]
        content = {
            "notes": random_sentence(ri(1, 3)),
            "actors": random_word(ri(1, 10)),
            "scene": random_word(ri(1, 3)),
        }
        await conn.fetch(
            f"""
            insert into entries (
                proj_id,
                user_id,
                report_uuid,
                entry_uuid,
                version_uuid,
                clip_id,
                content
            ) VALUES (1, 1, $1, $2, $3, $4, $5)
            """,
            report_uuid,
            entry_uuid,
            version_uuid,
            clip_id,
            json.dumps(content),
        )


def unmodified_versions(entry):
    # return a list of versions not modified by anything
    modified = set(m for modifies in entry.values() if modifies for m in modifies)
    return set(entry).difference(modified)


async def fake_edit(conn):
    # Create a fake edit in every existing report.
    all_report_uuids = [
        r["report_uuid"] for r in await conn.fetch(
            "select report_uuid from entries group by report_uuid"
        )
    ]
    for report_uuid in all_report_uuids:
        # {entry_uuid: {version_uuid: [modifies]}}
        entries = {}
        for entry_uuid, version_uuid, modifies in await conn.fetch(
            """
            select
                entry_uuid, version_uuid, modifies
            from entries
            where report_uuid = $1
            """,
            report_uuid,
        ):
            entry = entries.setdefault(entry_uuid, {})
            entry[version_uuid] = modifies and json.loads(modifies)

        mode = ri(1,3)

        if mode == 1:
            # create a conflict
            for entry_uuid, entry in entries.items():
                if len(entry) < 2:
                    continue
                # use the same modifies value as some existing edit
                edits = [m for v, m in entry.items() if m]
                modifies = random.choice(edits)
                content = {
                    "notes": random_sentence(ri(1, 3)),
                    "actors": random_word(ri(1, 10)),
                    "scene": random_word(ri(1, 3)),
                }
                version_uuid = uuid.uuid4()
                reason = "intentional conflcit"
                await conn.fetch(
                    """
                    insert into entries (
                        proj_id,
                        user_id,
                        report_uuid,
                        entry_uuid,
                        version_uuid,
                        content,
                        reason,
                        modifies
                    ) VALUES (1, 1, $1, $2, $3, $4, $5, $6)
                    """,
                    report_uuid,
                    entry_uuid,
                    version_uuid,
                    json.dumps(content),
                    reason,
                    json.dumps([str(m) for m in modifies]),
                )
                break
            else:
                # No conflict was found.  Just insert an entry.
                mode = 3

        if mode == 2:
            # resolve all conflicts.
            resolved_one = False
            for entry_uuid, entry in entries.items():
                unmodified = unmodified_versions(entry)
                if len(unmodified) < 2:
                    continue
                resolved_one = True
                content = {
                    "notes": random_sentence(ri(1, 3)),
                    "actors": random_word(ri(1, 10)),
                    "scene": random_word(ri(1, 3)),
                }
                version_uuid = uuid.uuid4()
                reason = "conflict resolution"
                await conn.fetch(
                    """
                    insert into entries (
                        proj_id,
                        user_id,
                        report_uuid,
                        entry_uuid,
                        version_uuid,
                        content,
                        reason,
                        modifies
                    ) VALUES (1, 1, $1, $2, $3, $4, $5, $6)
                    """,
                    report_uuid,
                    entry_uuid,
                    version_uuid,
                    json.dumps(content),
                    reason,
                    json.dumps([str(m) for m in unmodified]),
                )
            if not resolved_one:
                # No conflict was resolved.  Just insert an entry.
                mode = 3

        if mode == 3:
            # insert a normal edit modifying a single previous version
            entry_uuid = random.choice(list(entries))
            modifies = [random.choice(list(unmodified_versions(entry)))]
            content = {
                "notes": random_sentence(ri(1, 3)),
                "actors": random_word(ri(1, 10)),
                "scene": random_word(ri(1, 3)),
            }
            version_uuid = uuid.uuid4()
            reason = "conflict resolution"
            await conn.fetch(
                """
                insert into entries (
                    proj_id,
                    user_id,
                    report_uuid,
                    entry_uuid,
                    version_uuid,
                    content,
                    reason,
                    modifies
                ) VALUES (1, 1, $1, $2, $3, $4, $5, $6)
                """,
                report_uuid,
                entry_uuid,
                version_uuid,
                json.dumps(content),
                reason,
                json.dumps([str(m) for m in modifies]),
            )


async def fake_topic(conn):
    # Create a fake topic.
    topic_uuid = uuid.uuid4()
    all_report_uuids = [
        r["report_uuid"] for r in await conn.fetch(
            "select report_uuid from entries group by report_uuid"
        )
    ]
    random.shuffle(all_report_uuids)
    links = [("report", str(r)) for r in all_report_uuids[:ri(0,3)]]
    await conn.fetch(
        f"""
        insert into topics (
            proj_id,
            user_id,
            topic_uuid,
            links
        ) VALUES (1, 1, $1, $2)
        """,
        topic_uuid,
        json.dumps(links),
    )

async def fake_comment(conn):
    # Create a comment in every existing topic.
    all_topic_uuids = [
        r["topic_uuid"] for r in await conn.fetch(
            "select topic_uuid from topics group by topic_uuid"
        )
    ]
    for topic_uuid in all_topic_uuids:
        # {comment_uuid: parent_uuid}
        comments = {
            c: p for c, p in await conn.fetch(
                "select comment_uuid, parent_uuid "
                "from comments where topic_uuid = $1",
                topic_uuid,
            )
        }
        threads = set(comments.values()) or set([None])

        mode = ri(1,5) if comments else 1

        if mode in (1, 2):
            # add a new comment in a random thread
            comment_uuid = uuid.uuid4()
            parent_uuid = random.choice(list(threads))

        if mode in (3, 4):
            # modify an existing comment
            comment_uuid, parent_uuid = random.choice(list(comments.items()))

        if mode == 5:
            # start a new thread
            comment_uuid = uuid.uuid4()
            parent_uuid = random.choice(list(comments))

        body = random_sentence(ri(1,5))
        submissiontime = time.time()

        await conn.fetch(
            f"""
            insert into comments (
                proj_id,
                user_id,
                topic_uuid,
                comment_uuid,
                parent_uuid,
                body,
                submissiontime,
                authortime
            ) VALUES (1, 1, $1, $2, $3, $4, $5, $6)
            """,
            topic_uuid,
            comment_uuid,
            parent_uuid,
            body,
            datetime.datetime.now(),
            datetime.datetime.now()
        )


async def main(args):
    conn = await asyncpg.connect(
        host="/tmp/filmware", database="filmware"
    )
    actions = {
        "r": fake_report,
        "e": fake_edit,
        "t": fake_topic,
        "c": fake_comment,
    }
    try:
        for arg in args:
            for c in arg:
                await actions[c](conn)
    finally:
        await conn.close()


if __name__ == "__main__":
    if len(sys.argv) == 1:
        print(
            textwrap.dedent(f"""
            usage: {sys.argv[0]} SPEC

            where SPEC is any sequence of the following characters:
                r   insert a report
                e   insert an edit into every report
                t   insert a topic
                c   insert a comment into every topic
            """).strip(),
            file=sys.stderr,
        )
        exit(1)

        print(f"usage: {sys.argv[0]} SPEC", file=sys.stderr)
        print(f"where SPEC is any combination of the following characters:", file=sys.stderr)

    asyncio.run(main(sys.argv[1:]))