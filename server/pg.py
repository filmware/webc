#!/usr/bin/env python3

import argparse
import contextlib
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

import ingest
import fake

HERE = os.path.dirname(__file__)

@contextlib.contextmanager
def do_finally(fn):
    try:
        yield
    finally:
        fn()


def defer(es, fn=None):
    if fn:
        es.enter_context(do_finally(fn))
    else:
        def decorator(fn):
            es.enter_context(do_finaly(fn))
        return decorator


class Reader(threading.Thread):
    def __init__(self, io):
        self.io = io
        self.cond = threading.Condition()
        self.ready = False
        self.done = False
        super().__init__()

    def run(self):
        for line in self.io:
            print(line, end="")
            if "database system is ready to accept connections" in line:
                with self.cond:
                    self.ready = True
                    self.cond.notify_all()
        with self.cond:
            self.done = True
            self.cond.notify_all()


def main(pgpath, fake_spec, example_data):
    with contextlib.ExitStack() as es:
        if not pgpath:
            pgpath = tempfile.mkdtemp("pg")
            defer(es, lambda: shutil.rmtree(pgpath))

        datadir = os.path.join(pgpath, "data")

        bootstrap = not os.path.exists(datadir)

        if bootstrap:
            subprocess.run(
                [
                    "initdb",
                    "-E", "UTF8",
                    "-U", os.environ["USER"],
                    "--data-checksums",
                    "-D", datadir,
                ],
                check=True,
            )

        # start postgres
        pg = subprocess.Popen(
            ["postgres", "-D", datadir, "-k", "..", "-c", "listen_addresses="],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
        )
        reader = Reader(pg.stdout)
        reader.start()

        defer(es, lambda: reader.join())
        defer(es, lambda: pg.wait())
        defer(es, lambda: pg.kill())

        # forward signals to postgres
        def handle_sig(signum, frame):
            pg.send_signal(signum)

        for signame in ["HUP", "INT", "TERM", "USR1", "USR2"]:
            sig = signal.Signals.__members__.get("SIG" + signame)
            if sig:
                signal.signal(sig, handle_sig)

        # wait for ready message
        with reader.cond:
            while not reader.ready and not reader.done:
                print("waiting")
                reader.cond.wait()

        # wait for the socket to appear
        for i in range(500):
            if pg.poll is None:
                sys.exit(pg.wait())
            if os.path.exists(os.path.join(pgpath, ".s.PGSQL.5432")):
                break
            time.sleep(.001)

        if bootstrap:
            subprocess.run(["createdb", "-h", pgpath, "filmware"], check=True)

            # populate database
            with open(os.path.join(HERE, "db.sql")) as f:
                subprocess.run(
                    ["psql", "-h", pgpath, "filmware"],
                    stdin=f,
                    check=True,
                )

            # inject fake data
            if fake_spec is not None:
                fake.main(fake_spec, host=pgpath)

            if example_data:
                for file in os.listdir(example_data):
                    ingest.main(
                        kind=None,
                        file=os.path.join(example_data, file),
                        want_save=True,
                        pghost=pgpath,
                    )

        print(f"filmware db is ready: \x1b[33mpsql -h {pgpath} filmware\x1b[m")

        return pg.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pgpath")
    parser.add_argument("--fake", "-f")
    parser.add_argument("--example", "-x")
    args = parser.parse_args(sys.argv[1:])

    sys.exit(main(pgpath=args.pgpath, fake_spec=args.fake, example_data=args.example))
