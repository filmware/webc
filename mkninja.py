import root.server
import root.web

deps = add_target(
    STAMP=BLD/"deps",
    outputs=["$STAMP"],
    inputs=[server.deps, web.deps],
    command="touch $STAMP",
)

build = add_target(
    STAMP=BLD/"build",
    outputs=["$STAMP"],
    inputs=[server.deps, web.build],
    command="touch $STAMP",
)
