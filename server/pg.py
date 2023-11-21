#!/usr/bin/env python3

import os
import shutil
import subprocess
import tempfile
import time

tmp = tempfile.mkdtemp("pg")
datadir = os.path.join(tmp, "data")
pg = None
try:
    # init postgres
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
    pg = subprocess.Popen(["postgres", "-D", datadir, "-k", ".."])
    time.sleep(50/1000)

    # create database
    subprocess.run(["createdb", "-h", tmp, "filmware"], check=True)

    # populate database
    with open("db.sql") as f:
        print("running psql")
        subprocess.run(["psql", "-h", tmp, "filmware"], stdin=f, check=True)
        print("done running psql")

    print(f"connect with: \x1b[33mpsql -h {tmp} filmware\x1b[m")

    while True:
        time.sleep(1000)

finally:
    if pg is not None:
        pg.kill()
        pg.wait()
    shutil.rmtree(tmp)
