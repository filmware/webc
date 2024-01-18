#!/usr/bin/env python3

import argparse
import asyncio
import csv
import datetime
import json
import logging
import random
import sys
import uuid

import asyncpg


logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ingest")


OWNER = "0fe07a2c-59d1-4f65-a8a8-e0b4269c32ef"
PROJ = "aeb2c3f0-a645-44a9-b6f6-9cb7152c0163"
PROJ_VERSION = "45d56af6-5403-4736-9b3c-04a08fa68c9a"


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


def csvread(file, opts):
    with open(file, "r", newline="") as f:
        table = list(csv.reader(f, **opts))
    return table


def skip_rows_until_first_cell_contains(x, exp):
    """TODO: this should be done on text lines, not on the csv"""
    skip = 0
    for row in x:
        if row and row[0].startswith(exp):
            break
        skip += 1
    return x[skip:]


def skip_empty_rows(x):
    skip = 0
    for row in x:
        if any(row):
            break
        skip += 1
    return x[skip:]


def strip_rows(x, start, end):
    start = start if start >= 0 else len(x) + 1 + start
    end = end if end >= 0 else len(x) + 1 + end
    x = list(x)
    for i in range(start, end):
        row = list(x[i])
        while row and row[-1] == "":
            row = row[:-1]
        x[i] = row
    return x


def strip_cells(x, start, end):
    start = start if start >= 0 else len(x) + 1 + start
    end = end if end >= 0 else len(x) + 1 + end
    x = list(x)
    for i in range(start, end):
        x[i] = [cell.strip() for cell in x[i]]
    return x


def subtable(x, row, col):
    """
    Specify the row,col of the leftmost header, then ignore all space above or to the left of that.

    Then search rightwards for the end of headers, and ignore all space to the right of that.

    Then search downwards until the first empty row, and ignore everything below it.
    """
    headers = x[row][col:]

    # search for end of headers
    for i, h in enumerate(headers):
        if h: continue
        headers = headers[:i]
        break

    # build the output report
    out = [headers]

    # search for end of body
    for oldrow in x[row:]:
        newrow = oldrow[col:col + len(headers)]
        if not any(newrow): break
        out.append(newrow)

    return out


def zip_shortest(a, b):
    aiter = iter(a)
    biter = iter(b)
    try:
        while True:
            yield next(aiter), next(biter)
    except StopIteration:
        pass


def report_with_headers(x):
    headers = x[0]
    body = x[1:]
    column_uuids = [str(uuid.uuid4()) for _ in headers]
    row_uuids = [str(uuid.uuid4()) for _ in body]
    return {
        "operation": "new",
        "column_uuids": column_uuids,
        "row_uuids": row_uuids,
        "columns": headers,
        "rows": [{col: cell for cell, col in zip_shortest(row, column_uuids)} for row in body],
    }


def follow_steps(x, steps):
    for step in steps:
        if step[0] == "skip-rows-until-first-cell-contains":
            x = skip_rows_until_first_cell_contains(x, step[1])
        elif step[0] == "skip-empty-rows":
            x = skip_empty_rows(x, step[1], step[2])
        elif step[0] == "strip-rows":
            x = strip_rows(x, step[1], step[2])
        elif step[0] == "strip-cells":
            x = strip_cells(x, step[1], step[2])
        elif step[0] == "subtable":
            x = subtable(x, row=step[1], col=step[2])
        elif step[0] == "report-with-headers":
            x = report_with_headers(x)
        else:
            raise ValueError(f"unrecognized step '{step}'")
    return x


def ingest_all(table, reports):
    return [follow_steps(table, steps) for steps in reports]


def print_result(result):
    def get_width(i):
        w = len(result["columns"][i])
        c = result["column_uuids"][i]
        for r in result["rows"]:
            cell = r.get(c, "")
            for line in cell.split("\n"):
                w = max(w, len(line))
        return w

    def get_height(i):
        h = 1
        row = result["rows"][i]
        for cell in result["rows"][i].values():
            h = max(h, 1 + cell.count("\n"))
        return h

    widths = [get_width(i) for i in range(len(result["columns"]))]
    heights = [get_height(i) for i in range(len(result["rows"]))]

    def cellify(s, w):
        if s is None:
            s = ""
        s = s.replace(" ", "·")
        if len(s) < w:
            return s + " "*(w - len(s))
        if len(s) > w:
            return s[:w]
        return s

    print("|", end="")
    for header, w in zip(result["columns"], widths):
        print(" " + cellify(header, w), end=" |")
    print()

    print("-" * (sum(widths) + 3*len(widths) + 1))

    def listget(l, i):
        try:
            return l[i]
        except IndexError:
            return ""

    for r, h in zip(result["rows"], heights):
        cellrows = [r.get(col, "").split("\n") for col in result["column_uuids"]]
        for l in range(h):
            print("|", end="")
            for cell, w in zip(cellrows, widths):
                print(" " + cellify(listget(cell, l), w), end=" |")
            print()


async def random_user(conn):
    all_users = [str(r["user"]) for r in await conn.fetch('select "user" from users')]
    return random.choice(all_users)


async def save(results):
    conn = await asyncpg.connect(
        host="/tmp/filmware", database="filmware"
    )

    user = await random_user(conn)

    report = uuid.uuid4()

    for operation in results:
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
            uuid.uuid4(), # report
            uuid.uuid4(), # version
            tojson(operation),
            None,  # modifies
            user,
            "uploaded report",
            datetime.datetime.now(),
            datetime.datetime.now(),
        )


def main(kind, file, want_save):
    standard = {
        "csvread": {},
        "reports": [
            [
                ["report-with-headers"],
            ]
        ]
    }

    kindmap = {
        "standard": standard,
        "zoelog": standard,
        "nextlab": standard,
        "silverstack": standard,
        "scripte-csv": standard,  # we probably want the xml format instead
        "zaxcom": {
            "csvread": {},
            "reports": [
                [
                    ["skip-rows-until-first-cell-contains", "FileID"],
                    ["strip-rows", 0, -1],
                    ["strip-cells", 0, -1],
                    ["report-with-headers"],
                ]
            ]
        },
        "ltfs": {
            "csvread": {},
            "reports": [
                [
                    ["subtable", 0, 0],
                    ["report-with-headers"],
                ],
                [
                    ["skip-rows-until-first-cell-contains", "Shoot Day"],
                    ["report-with-headers"],
                ]
            ]
        }
    }
    if kind not in kindmap:
        print(f"unrecognized kind '{kind}'; must be one of {list(kindmap)}", file=sys.stderr)
        return 1

    spec = kindmap[kind]

    table = csvread(file, opts=spec["csvread"])

    results = ingest_all(table, spec["reports"])

    if want_save:
        asyncio.run(save(results))
    else:
        for r in results:
            print("\n#######\n")
            print_result(r)

    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("kind")
    p.add_argument("file")
    p.add_argument("--save", action="store_true")
    args = p.parse_args(sys.argv[1:])

    sys.exit(main(args.kind, args.file, args.save))
