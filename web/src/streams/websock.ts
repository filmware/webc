// Either wrap the built-in WebSocket or hide the delay of a dynamic import of the ws package.

const wsWaiters: { (): void }[] = [];
let ws;

if (typeof Websocket === 'undefined') {
  // We're in node; there is no WebSocket.
  import('ws').then((mod) => {
    ws = mod;
    wsWaiters.forEach((func) => func());
  });
}

export class WebSock {
  onopen?: { (): void };
  onmessage?: { (Event): void };
  onclose?: { (): void };
  onerror?: { (Event): void };

  private ws: WebSocket;
  private closed: boolean = false;

  constructor(url: string) {
    if (typeof Websocket === 'undefined') {
      if (!ws) {
        // ws not imported yet
        wsWaiters.push(() => {
          this.configure(new ws.WebSocket(url));
        });
      } else {
        // already imported
        this.configure(new ws.WebSocket(url));
      }
    } else {
      // builtin
      this.configure(new WebSocket(url));
    }
  }

  send(msg: string): void {
    if (!this.ws) {
      throw new Error('WebSock is not yet configured');
    }
    this.ws.send(msg);
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  private configure(ws: WebSocket) {
    ws.onopen = () => {
      if (this.onopen) this.onopen();
    };
    ws.onmessage = (event: Event) => {
      if (this.onmessage) this.onmessage(event);
    };
    ws.onclose = () => {
      if (this.onclose) this.onclose();
    };
    ws.onerror = (event: Event) => {
      if (this.onerror) this.onerror(event);
    };
    if (this.closed) {
      ws.close();
    }
    this.ws = ws;
  }
}
