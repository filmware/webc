#!/usr/bin/env python3

import asyncio
import sys
import json

import aiohttp

async def echo():
    try:
        async with aiohttp.ClientSession() as client:
            async with client.ws_connect('ws://localhost:8080/ws') as ws:
                while True:
                    data = input('> ')
                    await ws.send_str(data)
                    data = await ws.receive()
                    print(f'< {data}')
    except (KeyboardInterrupt, EOFError):
        pass

async def ws():
    try:
        async with aiohttp.ClientSession() as client:
            async with client.ws_connect('ws://localhost:8080/ws') as ws:
                await ws.send_str(json.dumps({
                    "type": "subscribe",
                    "mux_id": "Z",
                    "project_id": 1,
                    "entries": {"match": "*"},
                    "topics": {"match": "*"},
                    "comments": {"match": "*"},
                }))
                msg = await ws.receive()
                print(msg.data)

                await ws.send_str(json.dumps({
                    "type": "subscribe",
                    "mux_id": "Y",
                    "project_id": 1,
                }))
                msg = await ws.receive()
                print(msg.data)

                await ws.send_str(json.dumps({"type": "close", "mux_id": "Y"}))
                msg = await ws.receive()
                print(msg.data)

                await ws.send_str(json.dumps({"type": "close", "mux_id": "Z"}))
                msg = await ws.receive()
                print(msg.data)
    except (KeyboardInterrupt, EOFError, simple_websocket.ConnectionClosed):
        pass


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "echo":
        asyncio.run(echo())
        sys.exit(0)

    if len(sys.argv) == 2 and sys.argv[1] == "ws":
        asyncio.run(ws())
        sys.exit(0)

    print(f"usage: {sys.argv[0]} echo", file=sys.stderr)
    print(f"usage: {sys.argv[0]} ws", file=sys.stderr)
    sys.exit(1)
