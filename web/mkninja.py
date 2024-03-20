deps = add_target(
    STAMP=BLD/"deps",
    inputs=[
        SRC/"package.json",
        SRC/"package-lock.json",
        SRC/"tsconfig.json",
        SRC/"tsconfig.node.json",
        SRC/"vite.config.mts",
    ],
    outputs=["$STAMP"],
    command="npm ci && touch $STAMP",
    workdir=SRC,
)

websrc = add_glob(SRC/"index.html", f":f:{SRC}/src/**", out=BLD/"websrc.manifest")

# handle customizations from the preview server
import os
import urllib.parse
build_cmd = "npm run build && touch $STAMP"
if "HTTPURL" in os.environ:
    x = urllib.parse.urlparse(os.environ["HTTPURL"])
    ws_scheme = "ws" if x.scheme == "http" else "wss"
    prefix = x.path.rstrip("/")
    ws_url = urllib.parse.urlunparse((ws_scheme, x.netloc, f"{prefix}/ws", "", "", ""))
    build_cmd = f"VITE_BASE_PATH={prefix} VITE_WS_URL={ws_url} " + build_cmd

build = add_target(
    STAMP=BLD/"build",
    inputs=[deps, websrc],
    outputs=["$STAMP"],
    command=build_cmd,
    workdir=SRC,
)

## dependencies for ingest.wasm ##

import subprocess

def configure_git_repo(path, remote, commit):
    def run(cmd, **kwargs):
        subprocess.run(cmd, check=True, **kwargs)

    def run_idmpt(cmd, **kwargs):
        subprocess.run(cmd, check=False, stderr=subprocess.DEVNULL)

    def maybe_read(path):
        return path.read_text() if path.exists() else None

    repo = path / "repo"
    tree = path / "tree"

    if not repo.exists():
        # create bare git repo
        repo.mkdir(parents=True)
        run(["git", "init", "--bare"], cwd=repo)

    if maybe_read(path / "remote") != remote:
        # configure or reconfigure remote
        run_idmpt(["git", "remote", "remove", "origin"], cwd=repo)
        run(["git", "remote", "add", "origin", remote], cwd=repo)
        (path / "remote").write_text(remote)

    if maybe_read(path / "commit") != commit:
        # maybe clean up old tree
        if tree.exists():
            run(["git", "worktree", "remove", tree, "-f"], cwd=repo)
        # create new tree
        run(["git", "fetch", "origin", commit], cwd=repo)
        run(["git", "worktree", "add", "--detach", tree, commit], cwd=repo)
        (path / "commit").write_text(commit)

    return tree, (path / "commit")

# webc
webc_tree, webc_checkout = configure_git_repo(
    path=BLD/"webc",
    remote="https://github.com/filmware/webc.git",
    commit="ded3933a48a7ee6730a271bd353f14a7f71c1486",
)
webc_glob = add_glob("makefile", "**/*.c", "**/*.h", workdir=webc_tree, out=BLD/"webc"/"glob")
webc = add_target(
    inputs=[webc_checkout, webc_glob],
    outputs=[webc_tree / "libc.a"],
    workdir=webc_tree,
    command=["make", "-j"],
)

# openlibm
openlibm_tree, openlibm_checkout = configure_git_repo(
    path=BLD/"openlibm",
    remote="https://github.com/ryan-filmware/openlibm.git",
    commit="5fc95f7b5927ebb06e2665b753d2636c5e24adaf",
)
openlibm_glob = add_glob(
    "Make*", "**/*.c", "**/*.h", workdir=openlibm_tree, out=BLD/"openlibm"/"glob"
)
openlibm = add_target(
    inputs=[openlibm_checkout, openlibm_glob],
    outputs=[openlibm_tree / "libopenlibm.a"],
    workdir=openlibm_tree,
    command=["make", "ARCH=wasm32", "-j"],
)

# expat
expat_tree, expat_checkout = configure_git_repo(
    path=BLD/"expat",
    remote="https://github.com/filmware/libexpat",
    commit="65f2beb0005d68d09d2d517d537f1a98d8de24bb",
)
expat_buildconf = add_target(
    inputs=[expat_checkout],
    outputs=[expat_tree/"expat"/"configure"],
    workdir=expat_tree/"expat",
    command="./buildconf.sh",
)
expat_install = BLD/"expat"/"install"
expat_configure = add_target(
    inputs=[expat_buildconf],
    outputs=[expat_tree/"expat"/"Makefile"],
    workdir=expat_tree/"expat",
    command=[
        "env",
        "CC=clang",
        "LD=clang",
        "AR=llvm-ar",
        "RANLIB=llvm-ranlib",
        f"CFLAGS=--target=wasm32-unknown-none -nostdlib -I{webc_tree} -I{openlibm_tree}/include",
        "LDFLAGS=--target=wasm32-unknown-none -Wl,--no-entry",
        "./configure",
        "--host=wasm32-unknown-none",
        "--with-getrandom",
        "--without-xmlwf",
        "--without-examples",
        "--without-docbook",
        "--without-sys-getrandom",
        "--without-libbsd",
        "--without-tests",
        "--disable-shared",
        f"--prefix={expat_install}",
    ]
)
expat_glob = add_glob(
    "Makefile*", "**/*.c", "**/*.h",
    workdir=expat_tree/"expat",
    out=BLD/"expat"/"glob",
)
expat = add_target(
    inputs=[expat_configure, expat_glob],
    outputs=[expat_install/"lib"/"libexpat.a"],
    workdir=expat_tree/"expat",
    command=["make", "-j", "install"],
)

# lua
lua_tree, lua_checkout = configure_git_repo(
    path=BLD/"lua",
    remote="https://github.com/filmware/lua.git",
    commit="db65f320441ca6bb627a6627527ff934816341a5",
)
lua_glob = add_glob("makefile", "**/*.c", "**/*.h", workdir=lua_tree, out=BLD/"lua"/"glob")
lua = add_target(
    inputs=[lua_checkout, lua_glob],
    outputs=[lua_tree / "liblua.a"],
    workdir=lua_tree,
    command=["make", f"WEBC_ROOT={webc_tree}", f"OPENLIBM_ROOT={openlibm_tree}", "-j", "liblua.a"],
)

## ingest.wasm ##

ingest_glob = add_glob("**/*.h", "**/*.c", workdir=SRC/"src"/"ingest", out=BLD/"ingest_glob")
ingest_o = add_target(
    OUT=BLD/"ingest.o",
    inputs=[ingest_glob, webc, openlibm, lua, expat],
    outputs=["$OUT"],
    command=[
        "clang",
        "-nostdlib",
        "--target=wasm32-unknown-none",
        f"-I{webc_tree}",
        f"-I{lua_tree}",
        f"-I{expat_install}/include",
        "-c",
        "-o", "$OUT",
        f"{SRC}/src/ingest/ingest.c",
    ]
)
allow_undef = add_target(
    IN1=webc_tree/"webc.import",
    IN2=SRC/"src"/"ingest"/"ingest.import",
    OUT=BLD/"ingest.import",
    inputs=["$IN1", "$IN2"],
    outputs=["$OUT"],
    command="cat $IN1 $IN2 > $OUT",
)

def libdep(tgt):
    path, file = os.path.split(tgt.outputs[0])
    lib, _ = os.path.splitext(file)
    name = lib[3:]
    return [f"-L{path}", f"-l{name}"]

ingest_wasm = add_target(
    OUT=BLD/"ingest.wasm",
    inputs=[ingest_o, allow_undef],
    outputs=["$OUT"],
    command=[
        "wasm-ld",
        "-m", "wasm32",
        "--no-entry",
        "--export=run",
        "--export=_setjmp_inner",
        "--export=malloc",
        "--export=free",
        f"--allow-undefined-file={allow_undef}",
        *libdep(webc),
        *libdep(openlibm),
        *libdep(lua),
        *libdep(expat),
        "--error-limit=0",
        "-o", "$OUT",
        ingest_o,
    ]
)
