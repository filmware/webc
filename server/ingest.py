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
import re

import asyncpg
import defusedxml.ElementTree as ET


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


def skip_rows_until_row_contains(x, exp):
    """TODO: this should be done on text lines, not on the csv"""
    skip = 0
    for row in x:
        if any(r and exp in r for r in row):
            break
        skip += 1
    return x[skip:]


def drop_empty_rows(x):
    return [r for r in x if any(r)]


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


def rename_column(x, src, dst):
    x["columns"] = [dst if c == src else c for c in x["columns"]]
    return x


def drop_matching_rows(x, column, pattern):
    p = re.compile(pattern)
    try:
        column_idx = x["columns"].index(column)
    except ValueError:
        # no such column
        return x
    column_uuid = x["column_uuids"][column_idx]
    rows = x["rows"]
    # go in reverse order so popping while iterating is safe
    for i in reversed(range(len(x["rows"]))):
        cell = rows[i].get(column_uuid)
        if cell is None:
            continue
        if p.search(cell) is not None:
            # drop this row
            rows.pop(i)
            x["row_uuids"].pop(i)
    return x


def regex_column(x, column, pattern, replace):
    p = re.compile(pattern)
    try:
        column_idx = x["columns"].index(column)
    except ValueError:
        # no such column
        return x
    column_uuid = x["column_uuids"][column_idx]
    for row in x["rows"]:
        cell = row.get(column_uuid)
        if cell is None:
            continue
        row[column_uuid] = p.sub(replace, cell)
    return x


def follow_steps(x, steps):
    for step in steps:
        if step[0] == "skip-rows-until-row-contains":
            x = skip_rows_until_row_contains(x, step[1])
        elif step[0] == "drop-empty-rows":
            x = drop_empty_rows(x)
        elif step[0] == "strip-rows":
            x = strip_rows(x, step[1], step[2])
        elif step[0] == "strip-cells":
            x = strip_cells(x, step[1], step[2])
        elif step[0] == "subtable":
            x = subtable(x, row=step[1], col=step[2])
        elif step[0] == "report-with-headers":
            x = report_with_headers(x)
        elif step[0] == "rename-column":
            x = rename_column(x, src=step[1], dst=step[2])
        elif step[0] == "drop-matching-rows":
            x = drop_matching_rows(x, column=step[1], pattern=step[2])
        elif step[0] == "regex-column":
            x = regex_column(x, column=step[1], pattern=step[2], replace=step[3])
        else:
            raise ValueError(f"unrecognized step '{step}'")
    return x


def ingest_all(table, reports):
    return [follow_steps(table, steps) for steps in reports]


def xmlread_scripte(file):
    root = ET.parse(file).getroot()
    assert root.tag == "ScriptEMetaData", root.tag
    shots = [child for child in root if child.tag == "ShotProperties"]
    # find all the columns, preserving order as best we can
    columns = []
    columns_seen = set()
    for shot in shots:
        for i in shot:
            if i.tag not in columns_seen:
                columns.append(i.tag)
                columns_seen.add(i.tag)
    # extract into a table
    table = [columns]
    for shot in shots:
        rdict = {}
        for i in shot:
            # does this element have children?
            if bool(i):
                # looks like this is just RelatedScenes
                cell = ",".join(x.text for x in iter(i))
            else:
                cell = i.text or ""
            rdict[i.tag] = cell
        row = [rdict.get(c, "") for c in columns]
        table.append(row)

    return table


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
        l = len(s)
        s = s.replace(" ", "\x1b[90m·\x1b[m")
        if l < w:
            return s + " "*(w - l)
        if l > w:
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


async def save(results, pghost):
    conn = await asyncpg.connect(host=pghost, database="filmware")

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

def detect_kind(file):
    with open(file) as f:
        text = f.read()

    lines = text.splitlines()

    # xml?
    if "<?xml" in lines[0]:
        return "scripte-xml"

    # tab-separated?
    if text.count("\t") > text.count(","):
        return "cantar"

    # zaxcom has some header data, with their brand name in the first line
    if "Zaxcom" in lines[0]:
        return "zaxcom"

    # ltfs contains a subtable with a "Software" column that contains "LTFS" in the value
    if "Software" in lines[0] and "LTFS" in lines[1]:
        return "ltfs"

    # silverstack is really pitching shothub
    if "ShotID" in lines[0] and "Shothub Link" in lines[0]:
        return "silverstack"

    # zoelog puts all of its headers in quotes
    if '"Camera"' in lines[0]:
        return "zoelog"

    # dailies report has timecodes, but scripte does not
    if "Timecode" in lines[0]:
        return "nextlab"

    return "scripte-csv"


def main(kind, file, want_save, pghost="/tmp/filmware"):
    kind = kind or detect_kind(file)

    standard = {
        "csvread": {},
        "reports": [
            [
                ["report-with-headers"],
            ]
        ]
    }

    kindmap = {
        "zoelog": {
            "csvread": {},
            "reports": [
                [
                    ["report-with-headers"],
                    ["rename-column", "Episode", "__episode__"],
                    ["rename-column", "Scene", "__scene__"],
                    ["rename-column", "Take", "__take__"],
                    ["rename-column", "Camera", "__camera__"],
                ]
            ]
        },
        "nextlab": {
            "csvread": {},
            "reports": [
                [
                    ["report-with-headers"],
                    ["rename-column", "Episode", "__episode__"],
                    ["rename-column", "Scene", "__scene__"],
                    ["rename-column", "Take", "__take__"],
                    ["rename-column", "Camera", "__camera__"],
                    ["rename-column", "Start Timecode", "__tcstart__"],
                    ["rename-column", "End Timecode", "__tcend__"],
                ]
            ]
        },
        "silverstack": {
            "csvread": {},
            "reports": [
                [
                    ["report-with-headers"],
                    ["drop-matching-rows", "ShotID", "^$"],
                    ["regex-column", "Camera", "_$", ""],
                    ["rename-column", "Name", "__clip__"],
                    ["rename-column", "Camera", "__camera__"],
                ]
            ]
        },
        "scripte-csv": standard,  # we probably want the xml format instead
        "scripte-xml": {
            "xmlread": "scripte",
            "reports": [
                [
                    ["report-with-headers"],
                    ["rename-column", "Slate", "__scene__"],
                    ["rename-column", "Take", "__take__"],
                    ["rename-column", "Camera", "__camera__"],
                ]
            ]
        },
        "zaxcom": {
            "csvread": {},
            "reports": [
                [
                    ["skip-rows-until-row-contains", "FileID"],
                    ["strip-rows", 0, -1],
                    ["strip-cells", 0, -1],
                    ["report-with-headers"],
                    ["rename-column", "Scene", "__scene__"],
                    ["rename-column", "Take", "__take__"],
                    ["rename-column", "TimeCode", "__tcstart__"],
                ]
            ]
        },
        "cantar": {
            "csvread": {"delimiter": "\t"},
            "reports": [
                [
                    ["skip-rows-until-row-contains", "Index"],
                    ["strip-rows", 0, -1],
                    ["strip-cells", 0, -1],
                    ["drop-empty-rows"],
                    ["report-with-headers"],
                    ["rename-column", "Episode", "__episode__"],
                    ["rename-column", "Scene", "__scene__"],
                    ["rename-column", "Take", "__take__"],
                    ["rename-column", "TC Start", "__tcstart__"],
                    ["rename-column", "TC End", "__tcend__"],
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
                    ["skip-rows-until-row-contains", "Shoot Day"],
                    ["report-with-headers"],
                ]
            ]
        }
    }
    if kind not in kindmap:
        print(f"unrecognized kind '{kind}'; must be one of {list(kindmap)}", file=sys.stderr)
        return 1

    spec = kindmap[kind]

    if "csvread" in spec:
        table = csvread(file, opts=spec["csvread"])
    elif "xmlread" in spec:
        # don't have enough xml to know how to generalize
        assert spec["xmlread"] == "scripte", spec
        table = xmlread_scripte(file)
    else:
        raise ValueError("invalid spec:", spec)

    results = ingest_all(table, spec["reports"])

    if want_save:
        asyncio.run(save(results, pghost))
    else:
        for r in results:
            print("\n#######\n")
            print_result(r)

    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("kind", nargs="?")
    p.add_argument("file")
    p.add_argument("--save", action="store_true")
    args = p.parse_args(sys.argv[1:])

    sys.exit(main(args.kind, args.file, args.save))
