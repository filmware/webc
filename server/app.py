#!/usr/bin/env python3

import asyncio
import json
import logging
import sys
import uuid
import datetime
import secrets
import base64

import asyncpg
from aiohttp import web
import argon2

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("app")

ph = argon2.PasswordHasher()

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


def pgify(func):
    async def decorated(*args, **kwargs):
        conn = await asyncpg.connect(host="/tmp/filmware", database="filmware")
        try:
            return await func(conn, *args, **kwargs)
        finally:
            await conn.close()

    return decorated


class Listener:
    def __init__(self, conn):
        self.conn = conn
        self.session = None
        self.account = None
        self.allusers = None
        self.allprojects = None

        self.subs = set()
        self.configured = False
        self.preconfigure = []
        self.bootq = asyncio.Queue()
        self.booted = False

    # start must complete before subscriptions may be added
    async def start(self):
        await self.conn.add_listener('stream', self.on_notify)

    def configure(self, session, account, allusers, allprojects):
        self.session = session
        self.account = account
        self.allusers = allusers
        self.allprojects = allprojects
        self.configured = True
        # process any notifications we had earlier
        for obj in self.preconfigure:
            reason = self.check_bootem(obj)
            if reason:
                raise ValueError(f"booting: {boot_reason}")
        self.preconfigure = []

    async def run(self):
        # wait for a justbootem signal
        boot_reason = await self.bootq.get()
        raise ValueError(f"booting: {boot_reason}")

    def check_bootem(self, obj):
        typ = obj["type"]
        if typ == "user":
            account = obj["account"]
            user = obj["user"]
            if account == self.account and user not in self.allusers:
                return "a new user was added to the account"
            if user in self.allusers and account != self.account:
                return "a user was removed from this account"
        if typ == "permission":
            enable = obj["enable"]
            user = obj["user"]
            project = obj["project"]
            if enable and user in self.allusers and project not in self.allprojects:
                return "a permission was added to this account"
            if not enable and project in self.allprojects:
                return "a permission was removed from this account"
        if typ == "session":
            if obj["session"] == self.session and not obj["valid"]:
                return "this session was invalidated"
        return None

    def on_notify(self, conn, pid, channel, payload):
        # synchronous!
        if self.booted:
            return
        obj = json.loads(payload)
        typ = obj["type"]
        if not self.configured:
            if typ in ["user", "permission", "session"]:
                # we don't know what the bootem conditions are yet, so we'll check this later
                self.preconfigure.append(obj)
            return
        # detect just-bootem situations
        boot_reason = self.check_bootem(obj)
        if boot_reason:
            self.booted = True
            self.bootq.put_nowait(boot_reason)
            return
        # apply basic permissions
        typ = obj["type"]
        if typ in ["entry", "topic", "comment"]:
            if obj["project"] not in self.allprojects:
                return
        # broadcast to our subscribers
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


class AllSpec:
    """Like a SubscriptionSpec, but where the main filter will eventually be rbac-based."""

    def __init__(self, since):
        self.since = since

    @classmethod
    def from_json(cls, obj):
        if obj is None:
            return None
        since = obj.get("since", [])
        # validate
        for s in since:
            if len(s) != 2:
                raise UserError(f"invalid {cls.fieldname}.since ({s})")
        return cls(since)

    def pred(self, obj):
        return True

    def where(self):
        a = Argno()
        clauses = []
        args = []
        for s in self.since:
            assert len(s) == 2, s
            clauses.append(a(f"(not (srv_id = ? and seqno <= ?))"))
            args.extend(s)

        if not clauses:
            return "", args

        return "where " + " and ".join(clauses), args


class AllProjects(AllSpec):
    fieldname = "projects"

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


class AllAccounts(AllSpec):
    fieldname = "accounts"

    async def fetch_initial(self, conn):
        where, args = self.where()
        query = f"""
            select
                srv_id,
                seqno,
                version,
                account,
                "user",
                name,
                email,
                password,
                submissiontime,
                authortime,
                archivetime
            from accounts
            {where}
            ORDER BY seqno
        """

        stmt = await conn.prepare(query)

        records = await stmt.fetch(*args)

        return [mkdict("account", r.items()) for r in records]


class AllUsers(AllSpec):
    fieldname = "users"

    async def fetch_initial(self, conn):
        where, args = self.where()
        query = f"""
            select
                srv_id,
                seqno,
                version,
                "user",
                account,
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


class AllPermissions(AllSpec):
    fieldname = "permissions"

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
        self.projects = AllProjects.from_json(obj.get("projects"))
        self.accounts = AllAccounts.from_json(obj.get("accounts"))
        self.users = AllUsers.from_json(obj.get("users"))
        self.permissions = AllPermissions.from_json(obj.get("permissions"))
        self.entries = EntriesSpec.from_json(obj.get("entries"))
        self.topics = TopicsSpec.from_json(obj.get("topics"))
        self.comments = CommentsSpec.from_json(obj.get("comments"))
        # collect streaming results for emission after we complete our initial
        # fetch; that way we never accidentally give end users a seqno that
        # they are not allowed to store.
        self.early_streaming_results = []

        self.specmap = {
            "project": self.projects,
            "account": self.accounts,
            "user": self.users,
            "permission": self.permissions,
            "entry": self.entries,
            "topic": self.topics,
            "comment": self.comments,
            "session": None,
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
    def __init__(self, ws, l, w, user):
        self.ws = ws
        self.l = l
        self.w = w
        self.user = user
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
                            self.user,
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
                            self.user,
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
                            self.user,
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

async def authenticate(conn, msg):
    typ = msg["type"]

    if typ == "password":
        email = msg["email"]
        password = base64.b64decode(msg["password"])
        results = await conn.fetch("select account, password from accounts where email = $1", email)
        if len(results) != 1:
            # do a dummy hash anyway to avoid leaking obvious timing information
            # TODO: collect stats on timecost distribution of hash and delay a random time that
            # looks like a hash, rather than wasting compute
            fakehash = (
                "$argon2id$v=19$m=65536,t=3,"
                "p=4$072ULEKysbQvmVGCXAdLcw$k4ZOCFLo4bBWdCIDb7edu8nmUT7MjrblYVYGql2vMqc"
            )
            ph.verify(fakehash, password)
            return False
        # TODO: do hashing off-thread to not stop the whole application for 50ms!
        if not ph.verify(results[0]["password"], password):
            return False
        # mint a new session
        account = results[0]["account"]
        session = uuid.uuid4()
        token = secrets.token_bytes(32)
        expiry = datetime_now() + datetime.timedelta(days=7)
        await conn.fetch(
            f"""
            insert into sessions (
                "session",
                token,
                account,
                expiry
            ) VALUES ($1, $2, $3, $4)
            """,
            session,
            token,
            account,
            expiry,
        )
        return account, session, token, expiry

    elif typ == "session":
        session = msg["session"]
        token = base64.b64decode(msg["token"])
        results = await conn.fetch(
            """
            select
                account,
                expiry
            from sessions
            where session = $1 and token = $2 and valid = true
            """,
            session,
            token,
        )
        if not results:
            return False
        # RACE: this session might have been invalidated already
        return results[0]["account"], session, token, results[0]["expiry"]

    else:
        raise ValueError(f"unknown authentication message type {typ}")


@route.get("/ws")
@pgify
async def ws_handler(conn, request):
    try:
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        # wait for successful authentication
        while True:
            msg = await ws.receive_json()
            result = await authenticate(conn, msg)
            if result:
                break
            await ws.send_str(tojson({"type": "result", "success": False}))
        account, session, token, expiry = result

        # Start our Listener now, which will be responsible for detect just-bootem situations.
        l = Listener(conn)
        await l.start()

        # explicitly verify that session is still valid (now that we have started our subscription)
        results = await conn.fetch('select valid from sessions where "session" = $1', session)
        if not results or not results[0]["valid"]:
            raise ValueError("booting: this session was invalidated")

        # find the primary user for this account
        # (race-free; this is an immutable property of the account)
        results = await conn.fetch('select "user" from accounts where account = $1', account)
        if len(results) == 0:
            raise ValueError("partial replication error")
        user = results[0]["user"]

        # find all users belonging to this account
        results = await conn.fetch('select "user" from users where account = $1', account)
        allusers = set(r["user"] for r in results)
        if user not in allusers:
            # TODO: this is a permanent error
            raise ValueError("account has been invalidated by a merge")

        # find all projects this account has permissions on
        user_argstr = ", ".join(f"${n+1}" for n in range(len(allusers)))
        results = await conn.fetch(
            f"""
            select
                project, enable
            from permissions
            where "user" in ({user_argstr})
            order by submissiontime asc
            """,
            *allusers
        )
        allprojects = set()
        for project, enable in results:
            if enable:
                allprojects.add(str(project))
            else:
                try:
                    allprojects.remove(str(project))
                except KeyError:
                    pass

        await ws.send_str(
            tojson(
                {
                    "type": "result",
                    "success": True,
                    "user": user,
                    "session": session,
                    "token": base64.b64encode(token).decode("utf8"),
                    "expiry": expiry,
                }
            )
        )

        # TODO: I'd rather we kept an in-memory cache of login data, or that everything after
        # password validation ran in a single transaction, because I'd feel much more confident that
        # we avoided all race conditions that way.
        l.configure(session, account, allusers, allprojects)

        # Writer to write results to the websocket
        w = Writer(ws)
        # Reader to read and process messages from the client
        r = Reader(ws, l, w, user)

        # don't outlive our session expiry
        async def expire():
            delay = (expiry - datetime_now()).total_seconds()
            if delay <= 0:
                raise ValueError("session expired")
            await asyncio.sleep(delay)
            raise ValueError("session expired")

        await waitgroup(l.run(), w.run(), r.run(), expire())

        return ws
    except ConnectionResetError:
        log.debug("/ws connection reset")
    except Exception as e:
        log.error(e)
        raise


async def amain():
    app = web.Application()
    app.add_routes(route)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, 'localhost', 8080)
    await site.start()
    print("\x1b[32mapp.py is listening on http://localhost:8080\x1b[m", file=sys.stderr)
    try:
        await asyncio.sleep(sys.maxsize)
    finally:
        await runner.cleanup()

if __name__ == '__main__':
    asyncio.run(amain())
