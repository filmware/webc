#!/usr/bin/env python3

import asyncio
import json
import logging
import sys
import uuid
import datetime

import asyncpg
from aiohttp import web

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("app")

# pretend we have an auth system
USER = "0fe07a2c-59d1-4f65-a8a8-e0b4269c32ef"

def tojson(obj, indent=None):

    def jsonable(obj):
        if isinstance(obj, (str, bool, type(None), int, float)):
            return obj
        if isinstance(obj, (list, tuple)):
            return [jsonable(v) for v in obj]
        if isinstance(obj, dict):
            return {k: jsonable(v) for k, v in obj.items()}
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

def datetime_now():
    return datetime.datetime.now(datetime.timezone.utc)


def readdatetime(x):
    # read utf rfc3339 stamps, with optional fractional seconds
    # add +0000 to the Z, to force timezone to utc by strptime
    try:
        dt = datetime.datetime.strptime(f"{x}+0000", "%Y-%m-%dT%H:%M:%S.%fZ%z")
    except ValueError:
        dt = datetime.datetime.strptime(f"{x}+0000", "%Y-%m-%dT%H:%M:%SZ%z")
    return dt


async def waitgroup(*coros):
    """
    Return a coroutine that propagates the first non-CancelledError from coros,
    or else waits for all to finish.

    If a failure is to be raised, either due to one of coros crashing or due
    to the waitgroup coroutine itself being canceled, any remaining coros are
    canceled and awaited first, so none of coros will ever outlive the
    waitgroup coroutine.
    """

    tasks = [
        asyncio.create_task(c) for c in coros if asyncio.iscoroutine(c)
    ]
    exc = None
    while exc is None:
        try:
            done, pending = await asyncio.wait(
                tasks, return_when=asyncio.FIRST_EXCEPTION
            )
        except asyncio.CancelledError as e:
            exc = e
            break

        if not pending:
            # success!
            return

        # grab the first exception
        for task in done:
            if task.exception() is None:
                continue
            if isinstance(task.exception(), asyncio.CancelledError):
                # ignore Cancelled errors.
                continue
            # found the first exception
            exc = task.exception()
            break

    for task in tasks:
        task.cancel()

    # absolutely refuse to not wait on all our children
    while True:
        try:
            await asyncio.wait(
                tasks, return_when=asyncio.ALL_COMPLETED
            )
            break
        except asyncio.CancelledError:
            continue

    raise exc


#### begin server ####


class Listener:
    def __init__(self):
        self.subs = set()
        self.conn = None

    async def run(self):
        self.conn = await asyncpg.connect(
            host="/tmp/filmware", database="filmware"
        )
        try:
            await self.conn.add_listener('stream', self.on_notify)
            # run forever
            await asyncio.sleep(sys.maxsize)
        finally:
            await self.conn.close()

    def on_notify(self, conn, pid, channel, payload):
        # synchronous!
        obj = json.loads(payload)
        for sub in self.subs:
            sub.put(obj)

    def add_subscriber(self, sub):
        self.subs.add(sub)

    def remove_subscriber(self, sub):
        try:
            self.subs.remove(sub)
        except KeyError:
            pass


class Argno:
    def __init__(self):
        self.val = 0

    def __call__(self, query):
        sections = query.split("?")
        out = [sections[0]]
        for q in sections[1:]:
            self.val += 1
            out.append(f"${self.val}")
            out.append(q)
        return "".join(out)


def mkdict(typ, itr):
    out = dict(itr)
    out["type"] = typ
    return out


def with_mux(mux_id, obj):
    return {"mux_id": mux_id, **obj}


class SubscriptionSpec:
    fieldname = ""
    matchables = ()

    def __init__(self, since, match, value):
        self.since = since
        self.match = match
        self.value = value

    @classmethod
    def from_json(cls, obj):
        if obj is None:
            return None
        since = obj.get("since", [])
        match = obj["match"]
        value = obj["value"]
        # validate
        for s in since:
            if len(s) != 2:
                raise UserError(f"invalid {cls.fieldname}.since ({s})")
        if match not in cls.matchables:
            raise UserError(f"invalid {cls.fieldname}.match ({match})")
        return cls(since, match, value)

    def pred(self, obj):
        return obj[self.match] == self.value

    def where(self):
        a = Argno()
        clauses = []
        args = []
        for s in self.since:
            assert len(s) == 2, s
            clauses.append(a(f"(not (srv_id = ? and seqno <= ?))"))
            args.extend(s)

        if self.value is not None:
            clauses.append(a(f"{self.match} = ?"))
            args.append(self.value)

        if not clauses:
            return "", args

        return "where " + " and ".join(clauses), args


class ProjectsSpec(SubscriptionSpec):
    @classmethod
    def from_json(cls, obj):
        if obj is None:
            return None
        since = obj.get("since", [])
        match = obj["match"]
        value = obj.get("value")
        # validate
        for s in since:
            if len(s) != 2:
                raise UserError(f"invalid projects.since ({s})")
        if match not in ("*", "project"):
            raise UserError(f"invalid projects.match ({match})")
        if value is None and match != "*":
            raise UserError(f"invalid projects.match ({match})")
        return cls(since, match, value)

    def pred(self, obj):
        if self.match == "*":
            return True
        return obj[self.match] == self.value

    async def fetch_initial(self, conn):
        where, args = self.where()
        query = f"""
            select
                srv_id,
                seqno,
                version,
                project,
                name,
                "user",
                submissiontime,
                authortime,
                archivetime
            from projects
            {where}
            ORDER BY seqno
        """

        stmt = await conn.prepare(query)

        records = await stmt.fetch(*args)

        return [mkdict("project", r.items()) for r in records]


class UsersSpec(SubscriptionSpec):
    fieldname = "users"
    # TODO: users doesn't even have a project field!
    matchables = ("project", "user")

    async def fetch_initial(self, conn):
        where, args = self.where()
        query = f"""
            select
                srv_id,
                seqno,
                version,
                "user",
                name,
                -- email,
                -- password,
                submissiontime,
                authortime,
                archivetime
            from users
            {where}
            ORDER BY seqno
        """

        stmt = await conn.prepare(query)

        records = await stmt.fetch(*args)

        return [mkdict("user", r.items()) for r in records]


class PermissionsSpec(SubscriptionSpec):
    fieldname = "permissions"
    matchables = ("project", "user")

    async def fetch_initial(self, conn):
        where, args = self.where()
        query = f"""
            select
                srv_id,
                seqno,
                version,
                "user",
                project,
                kind,
                enable,
                author,
                submissiontime,
                authortime,
                archivetime
            from users
            {where}
            ORDER BY seqno
        """


        stmt = await conn.prepare(query)

        records = await stmt.fetch(*args)

        return [mkdict("user", r.items()) for r in records]


class EntriesSpec(SubscriptionSpec):
    fieldname = "entries"
    matchables = ("project", "report", "user")

    async def fetch_initial(self, conn):
        where, args = self.where()
        query = f"""
            select
                srv_id,
                seqno,
                report,
                entry,
                project,
                "user",
                clip_id,
                content,
                modifies,
                reason,
                archivetime
            from entries
            {where}
            ORDER BY seqno
        """

        stmt = await conn.prepare(query)

        records = await stmt.fetch(*args)

        return [mkdict("entry", r.items()) for r in records]


class TopicsSpec(SubscriptionSpec):
    fieldname = "topics"
    matchables = ("project", "user")

    async def fetch_initial(self, conn):
        where, args = self.where()
        query = f"""
            select
                srv_id,
                seqno,
                topic,
                project,
                "user",
                name,
                links,
                submissiontime,
                authortime,
                archivetime
            from topics
            {where}
            ORDER BY seqno
        """

        stmt = await conn.prepare(query)

        records = await stmt.fetch(*args)

        return [mkdict("topic", r.items()) for r in records]


class CommentsSpec(SubscriptionSpec):
    fieldname = "comments"
    matchables = ("project", "topic", "user")

    async def fetch_initial(self, conn):
        where, args = self.where()
        query = f"""
            select
                srv_id,
                seqno,
                comment,
                topic,
                project,
                "user",
                parent,
                body,
                submissiontime,
                authortime,
                archivetime
            from comments
            {where}
            ORDER BY seqno
        """

        stmt = await conn.prepare(query)

        records = await stmt.fetch(*args)

        return [mkdict("comment", r.items()) for r in records]


class Subscription:
    def __init__(self, w, mux_id, obj):
        self.w = w
        self.mux_id = mux_id
        self.projects = ProjectsSpec.from_json(obj.get("projects"))
        self.users = UsersSpec.from_json(obj.get("users"))
        self.permissions = PermissionsSpec.from_json(obj.get("permissions"))
        self.entries = EntriesSpec.from_json(obj.get("entries"))
        self.topics = TopicsSpec.from_json(obj.get("topics"))
        self.comments = CommentsSpec.from_json(obj.get("comments"))
        # collect streaming results for emission after we complete our initial
        # fetch; that way we never accidentally give end users a seqno that
        # they are not allowed to store.
        self.early_streaming_results = []

        self.specmap = {
            "projects": self.projects,
            "users": self.users,
            "permissions": self.permissions,
            "entry": self.entries,
            "topic": self.topics,
            "comment": self.comments,
        }

    def put(self, obj):
        if not self.pred(obj):
            return
        # inject our mux_id
        obj = with_mux(self.mux_id, obj)
        if self.early_streaming_results is not None:
            # we haven't finished the initial results yet
            self.early_streaming_results.append(obj)
        else:
            # we're live-streaming already
            self.w.put(obj)

    def pred(self, obj):
        # TODO: configure wakeups to be per-project, at least
        spec = self.specmap[obj["type"]]
        return spec and spec.pred(obj)

    async def fetch_initial(self):
        conn = await asyncpg.connect(
            host="/tmp/filmware", database="filmware"
        )
        try:
            for spec in self.specmap.values():
                if spec is not None:
                    for r in await spec.fetch_initial(conn):
                        self.w.put(with_mux(self.mux_id, r))
        finally:
            await conn.close()

        # transition to online streaming:
        # - dump the sync message
        # - dump early streaming results (likely containing duplicates)
        # - set self.early_streaming_results to None
        self.w.put({"type": "sync", "mux_id": self.mux_id})
        for r in self.early_streaming_results:
            self.w.put(r)
        self.early_streaming_results = None


class Writer:
    def __init__(self, ws):
        self.ws = ws
        self.q = asyncio.Queue()

    def put(self, obj):
        self.q.put_nowait(obj)

    async def run(self):
        try:
            while True:
                obj = await self.q.get()
                await self.ws.send_str(tojson(obj))
        finally:
            await self.ws.close()


class UserError(Exception):
    pass


class Reader:
    def __init__(self, ws, l, w):
        self.ws = ws
        self.l = l
        self.w = w
        # map mux_id to subscriber
        self.subs = {}

    async def run(self):
        async for msg in self.ws:
            obj = msg.json()
            typ = obj["type"]
            mux_id = obj["mux_id"]
            if typ in ("subscribe", "fetch"):
                if mux_id in self.subs:
                    raise UserError(f"duplicate mux_id: {mux_id}")
                sub = Subscription(self.w, mux_id, obj)
                self.subs[mux_id] = sub
                if typ == "subscribe":
                    self.l.add_subscriber(sub)
                await sub.fetch_initial()
            elif typ == "close":
                sub = self.subs.pop(mux_id, None)
                if not sub:
                    raise UserError(f"unknown mux_id: {mux_id}")
                self.l.remove_subscriber(sub)
                self.w.put({"type": "closed", "mux_id": mux_id})
            elif typ == "upload":
                if mux_id in self.subs:
                    raise UserError(f"duplicate mux_id: {mux_id}")
                await self.upload(obj["objects"])
                self.w.put({"type": "uploaded", "mux_id": mux_id})
            else:
                raise ValueError("invalid msg type: {typ}")

    async def upload(self, objects):
        # sort objects into types
        typed = {"newcomment":[], "newtopic": [], "newentry": []}
        for obj in objects:
            typed[obj["type"]].append(obj)

        conn = await asyncpg.connect(
            host="/tmp/filmware", database="filmware"
        )
        try:
            # use a transaction to avoid implicit commits between inserts
            async with conn.transaction():
                if typed["newcomment"]:
                    stmt = await conn.prepare("""
                        insert into comments (
                            project,
                            version,
                            comment,
                            topic,
                            parent,
                            body,
                            authortime,
                            archivetime,
                            "user",
                            submissiontime
                        ) values (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
                        ) on conflict (version) do nothing;
                    """)
                    for obj in typed["newcomment"]:
                        await stmt.fetch(
                            obj["project"],
                            obj["version"],
                            obj["comment"],
                            obj["topic"],
                            obj["parent"],
                            obj.get("body"),
                            readdatetime(obj["authortime"]),
                            obj["archivetime"],
                            USER,
                            datetime_now(),
                        )
                if typed["newentry"]:
                    stmt = await conn.prepare("""
                        insert into entries (
                            project,
                            "user",
                            version,
                            report,
                            entry,
                            archivetime,
                            clip_id,
                            content,
                            modifies,
                            reason
                        ) values (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
                        ) on conflict (version) do nothing;
                    """)
                    for obj in typed["newentry"]:
                        await stmt.fetch(
                            obj["project"],
                            USER,
                            obj["version"],
                            obj["report"],
                            obj["entry"],
                            obj["archivetime"],
                            obj.get("clip_id"),
                            tojson(obj.get("content")),
                            tojson(obj.get("modifies")),
                            obj.get("reasons"),
                        )
                if typed["newtopic"]:
                    stmt = await conn.prepare("""
                        insert into topics (
                            project,
                            "user",
                            version,
                            topic,
                            name,
                            links,
                            archivetime,
                            authortime,
                            submissiontime
                        ) values (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9
                        ) on conflict (version) do nothing;
                    """)
                    for obj in typed["newtopic"]:
                        await stmt.fetch(
                            obj["project"],
                            USER,
                            obj["version"],
                            obj["topic"],
                            obj["name"],
                            tojson(obj.get("links")),
                            obj["archivetime"],
                            readdatetime(obj["authortime"]),
                            datetime_now(),
                        )
        finally:
            await conn.close()


#### begin web app ####

route = web.RouteTableDef()

@route.get("/ws")
async def ws_handler(request):
    try:
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        # Listener to listen for notifications from postgres
        l = Listener()
        # Writer to write results to the websocket
        w = Writer(ws)
        # Reader to read and process messages from the client
        r = Reader(ws, l, w)

        await waitgroup(l.run(), w.run(), r.run())

        return ws
    except ConnectionResetError:
        log.debug("/ws connection reset")
    except Exception as e:
        log.error(e)
        raise

app = web.Application()
app.add_routes(route)

if __name__ == '__main__':
    web.run_app(app)
