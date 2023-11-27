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
            return obj.isoformat()
        raise TypeError(
            f"unable to jsonify {obj!r} of type {type(obj).__name__}"
        )

    return json.dumps(jsonable(obj), indent=indent)



def waitgroup(*coros):
    """
    Return a coroutine that propagates the first non-CancelledError from coros,
    or else waits for all to finish.

    If a failure is to be raised, either due to one of coros crashing or due
    to the waitgroup coroutine itself being canceled, any remaining coros are
    canceled and awaited first, so none of coros will ever outlive the
    waitgroup coroutine.
    """

    async def _waitgroup():
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

    return _waitgroup()


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
        log.error(f"notify: {payload}")
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
        for q in query.split("?"):
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


class EntriesSpec:
    def __init__(self, since, match, value):
        self.since = since
        self.match = match
        self.value = value

    @classmethod
    def from_json(cls, obj):
        if obj is None:
            return None
        since = obj.get("since", [])
        match = obj.get("match", "*")
        value = obj.get("value")
        # validate
        for s in since:
            if len(s) != 2:
                raise UserError(f"invalid entries.since ({s})")
        if match not in ["*", "report_uuid", "user_id"]:
            raise UserError(f"invalid entries.match ({match})")
        return EntriesSpec(since, match, value)

    async def fetch_initial(self, conn):
        a = Argno()
        clauses = []
        args = []
        for s in self.since:
            assert len(s) == 2, s
            clauses.append(a(f"(not (srv_id = ? and seqno < ?))"))
            args.extend(s)
        if self.match == "report_uuid":
            clauses.append(a("report_uuid = ?"))
            args.append(self.value)
        elif self.match == "user_id":
            clauses.append(a("user_id = ?"))
            args.append(self.value)

        where = ("where " + " and ".join(clauses)) if clauses else ""

        query =f"""
            select
                srv_id,
                seqno,
                report_uuid,
                entry_uuid,
                proj_id,
                user_id,
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

    def pred(self, obj):
        if self.match == "report_uuid":
            return obj["report_uuid"] == self.value
        if self.match == "user_id":
            return obj["user_id"] == self.value
        # self.match = "*"
        return True


class TopicsSpec:
    def __init__(self, since, match, value):
        self.since = since
        self.match = match
        self.value = value

    @classmethod
    def from_json(cls, obj):
        if obj is None:
            return None
        since = obj.get("since", [])
        match = obj.get("match", "*")
        value = obj.get("value")
        # validate
        for s in since:
            if len(s) != 2:
                raise UserError(f"invalid topics.since ({s})")
        if match not in ["*", "user_id"]:
            raise UserError(f"invalid topics.match ({match})")
        return TopicsSpec(since, match, value)

    async def fetch_initial(self, conn):
        a = Argno()
        clauses = []
        args = []
        for s in self.since:
            assert len(s) == 2, s
            clauses.append(a(f"(not (srv_id = ? and seqno < ?))"))
            args.extend(s)
        if self.match == "user_id":
            clauses.append(a("user_id = ?"))
            args.append(self.value)

        where = ("where " + " and ".join(clauses)) if clauses else ""

        query =f"""
            select
                srv_id,
                seqno,
                topic_uuid,
                proj_id,
                user_id,
                links,
                archivetime
            from topics
            {where}
            ORDER BY seqno
        """

        stmt = await conn.prepare(query)

        records = await stmt.fetch(*args)

        return [mkdict("topic", r.items()) for r in records]

    def pred(self, obj):
        if self.match == "user_id":
            return obj["user_id"] == self.value
        # self.match = "*"
        return True


class CommentsSpec:
    def __init__(self, since, match, value):
        self.since = since
        self.match = match
        self.value = value

    @classmethod
    def from_json(cls, obj):
        if obj is None:
            return None
        since = obj.get("since", [])
        match = obj.get("match", "*")
        value = obj.get("value")
        # validate
        for s in since:
            if len(s) != 2:
                raise UserError(f"invalid comment.since ({s})")
        if match not in ["*", "topic_uuid", "user_id"]:
            raise UserError(f"invalid comment.match ({match})")
        return CommentsSpec(since, match, value)

    async def fetch_initial(self, conn):
        a = Argno()
        clauses = []
        args = []
        for s in self.since:
            assert len(s) == 2, s
            clauses.append(a(f"(not (srv_id = ? and seqno < ?))"))
            args.extend(s)
        if self.match == "topic_uuid":
            clauses.append(a("topic_uuid = ?"))
            args.append(self.value)
        if self.match == "user_id":
            clauses.append(a("user_id = ?"))
            args.append(self.value)

        where = ("where " + " and ".join(clauses)) if clauses else ""

        query =f"""
            select
                srv_id,
                seqno,
                comment_uuid,
                topic_uuid,
                proj_id,
                user_id,
                parent_uuid,
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

    def pred(self, obj):
        if self.match == "topic_uuid":
            return obj["topic_uuid"] == self.value
        if self.match == "user_id":
            return obj["user_id"] == self.value
        # self.match = "*"
        return True


class Subscription:
    def __init__(self, w, mux_id, obj):
        self.w = w
        self.mux_id = mux_id
        self.proj_id = obj["proj_id"]
        self.entries = EntriesSpec.from_json(obj.get("entries"))
        self.topics = TopicsSpec.from_json(obj.get("topics"))
        self.comments = CommentsSpec.from_json(obj.get("comments"))
        # collect streaming results for emission after we complete our initial
        # fetch; that way we never accidentally give end users a seqno that
        # they are not allowed to store.
        self.early_streaming_results = []

        self.specmap = {
            "entries": self.entries,
            "topics": self.topics,
            "comments": self.comments,
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
        if obj["proj_id"] != self.proj_id:
            return False
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
            if typ == "subscribe":
                if mux_id in self.subs:
                    raise UserError(f"duplicate mux_id: {mux_id}")
                sub = Subscription(self.w, mux_id, obj)
                self.subs[mux_id] = sub
                self.l.add_subscriber(sub)
                await sub.fetch_initial()
            elif typ == "close":
                sub = self.subs.pop(mux_id, None)
                if not sub:
                    raise UserError(f"unknown mux_id: {mux_id}")
                self.l.remove_subscriber(sub)
                self.w.put({"type": "closed", "mux_id": mux_id})
            else:
                raise ValueError("invalid msg type: {typ}")

#### begin web app ####

route = web.RouteTableDef()

# aiohttp's built-in websocket
@route.get("/ws")
async def ws_handler(request):
    try:
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        # Listner to listen for notifications from postgres
        l = Listener()
        # Writer to write results to the websocket
        w = Writer(ws)
        # Reader to read and process messages from the user
        r = Reader(ws, l, w)

        await waitgroup(l.run(), w.run(), r.run())

        return ws
    except Exception as e:
        log.error(e)
        raise

app = web.Application()
app.add_routes(route)

if __name__ == '__main__':
    web.run_app(app)
