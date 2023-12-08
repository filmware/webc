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
