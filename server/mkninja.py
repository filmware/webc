def swc(path, out, workdir=SRC):
    glob = add_glob(
        path/"**/*.ts",
        path/"**/*.tsx",
        path/"**/*.js",
        path/"**/*.jsx",
        "!**/node_modules",
        "!**/build",
        out=f"{out}.manifest"
    )
    return add_target(
        inputs=[glob],
        outputs=[f"{out}.stamp"],
        command=[
            "sh",
            "-c",
            f"{SRC}/node_modules/.bin/swc -d {BLD} {path} && touch {out}.stamp"
        ],
        workdir=workdir,
    )

web_compiled = swc(SRC/"../web/src", BLD/"web")
# pick a workdir that causes a build tree we like
demo_compiled = swc(SRC/"demo/src", BLD/"demo", workdir=SRC/"decisions")
