import flask
import flask_sock

app = flask.Flask("filmware")
sock = flask_sock.Sock(app)

@sock.route('/echo')
def echo(ws):
    while True:
        data = ws.receive()
        ws.send(data)
