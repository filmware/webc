#!/usr/bin/env python3

import sys

import simple_websocket

def echo():
    ws = simple_websocket.Client.connect('ws://localhost:5000/echo')
    try:
        while True:
            data = input('> ')
            ws.send(data)
            data = ws.receive()
            print(f'< {data}')
    except (KeyboardInterrupt, EOFError, simple_websocket.ConnectionClosed):
        pass
    finally:
        ws.close()

if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "echo":
        echo()
        sys.exit(0)

    print(f"usage: {sys.argv[0]} echo",file=sys.stderr)
    sys.exit(1)
