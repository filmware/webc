// Either wrap the built-in WebSocket or hide the delay of a dynamic import of the ws package.

const wsWaiters: { (): void }[] = [];
type ModuleType = typeof import('ws');
let ws: ModuleType;

if (typeof WebSocket === 'undefined') {
  // We're in node; there is no WebSocket.
  import('ws').then((mod) => {
    ws = mod;
    wsWaiters.forEach((func) => func());
  });
}

export class WebSock {
  onopen?: { (): void };
  onmessage?: { (event: MessageEvent): void };
  onclose?: { (): void };
  onerror?: { (event: ErrorEvent): void };

  private ws?: WebSocket;
  private closed: boolean = false;

  constructor(url: string) {
    if (typeof WebSocket === 'undefined') {
      if (!ws) {
        // ws not imported yet
        wsWaiters.push(() => {
          this.configure(new ws.WebSocket(url) as unknown as WebSocket);
        });
      } else {
        // already imported
        this.configure(new ws.WebSocket(url) as unknown as WebSocket);
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
    if (this.closed) return;
    ws.onopen = () => {
      if (this.onopen) this.onopen();
    };
    ws.onmessage = (event: MessageEvent) => {
      if (this.onmessage) this.onmessage(event);
    };
    ws.onclose = () => {
      if (this.onclose) this.onclose();
    };
    ws.onerror = (event: Event) => {
      // TODO how is one supposed to deal with an event instead of an ErrorEvent?
      if (this.onerror) this.onerror(event as ErrorEvent);
    };
    if (this.closed) {
      ws.close();
    }
    this.ws = ws;
  }
}
