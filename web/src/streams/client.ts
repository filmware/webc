import { AdvancerNoFail, RecvMsg, RecvMsgAll, RecvMsgOrSync, SubscriptionSpec } from './utils';
import { WebSock } from './websock';

// import { newIngestWorker, noop } from '@/ingest/ingest';
//
// // newIngestWorker();
// noop();

/* FWClient is the logical unit of synchronization.  It is an interface because it can be
   implemented either directly over a websocket or through a replicator built around an IndexedDB,
   or through a port to SharedWorker. */
export interface FWClient {
  subscribe(spec: object): FWSubscription;
  fetch(spec: object): FWFetch;
  upload(objects: object[]): FWUpload;
}

export interface FWSubscription {
  /* onPreSyncMsg returns messages prior to the synchronization message.  If unset, onSync will
     return all messages in a single callback.  It is assumed onPreSyncMsg will be unset unless
     the consumer is collecting a very large amount of data and wants to process it as it arrives,
     rather than buffer everything in memory. */
  onPreSyncMsg?: { (msg: RecvMsg): void };
  /* onSync returns the whole initial payload, unless onPreSyncMsg was set, in which case it returns
     an empty list of messages. */
  onSync?: { (payload: RecvMsg[]): void };
  // onMsg returns individual messages which arrive after the sync message.
  onMsg?: { (msg: RecvMsg): void };

  close(): void;
}

export interface FWFetch {
  onPreSyncMsg?: { (payload: RecvMsg): void };
  onFetch?: { (payload: RecvMsg[]): void };
  cancel(): void;
}

export interface FWUpload {
  onFinish?: { (): void };
  /* no cancel, because it would be ambiguous if the upload was completed or not.  So just assume it
     was completed and prefer edits to cancelations */
}

export class FWSocket {
  // A little typed wrapper around WebSocket.
  // send() is ok before connecting
  // close() is ok before connecting
  // combine onclose() and onerror()
  // guaranteed no callbacks after call to close()
  // supports synchronous or asynchronous message traffic (recv vs onMsg)
  private socket: WebSock;
  private connected: boolean = false;
  private unsent: string[] = [];
  private error?: Error;
  private recvrs: { (msg: RecvMsgAll): void }[] = [];

  closing: boolean = false;

  onConnect?: { (): void };
  onMsg?: { (msg: RecvMsgAll): void };
  onClose?: { (error?: Error): void };

  constructor(url: string) {
    this.socket = new WebSock(url);
    this.socket.onopen = () => {
      if (this.closing) return;
      this.onConnect?.call(null);
      this.connected = true;
      let msg;
      while ((msg = this.unsent.shift())) {
        this.socket.send(msg);
      }
    };
    this.socket.onmessage = (e: MessageEvent): void => {
      if (this.closing) return;
      const msg = JSON.parse(e.data);
      const recvr = this.recvrs.shift();
      if (recvr) {
        // somebody was waiting for that particular message
        recvr(msg);
        return;
      }
      // fall back to the onMsg pattern
      this.onMsg?.call(null, msg);
    };
    this.socket.onclose = (): void => {
      const error = !this.error && this.closing ? new Error('closed early') : this.error;
      this.onClose?.call(null, error);
    };
    this.socket.onerror = (event: ErrorEvent): void => {
      // discard the error if we closed the websocket ourselves
      if (this.closing) return;
      this.error = event.error;
    };
  }

  recv(recvr: (msg: RecvMsgAll) => void): void {
    this.recvrs.push(recvr);
  }

  send(msg: object): void {
    const jmsg = JSON.stringify(msg);
    if (!this.connected) {
      this.unsent.push(jmsg);
    } else {
      this.socket.send(jmsg);
    }
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.socket.close();
  }
}

export class FWClientWS {
  advancer: AdvancerNoFail;
  socket: FWSocket;

  unsent: object[] = [];
  recvd: RecvMsgAll[] = [];
  muxId: number = 0;
  subs: Record<number, FWSubscriptionWS | FWFetchWS> = {};
  reqs: Record<number, FWUploadWS> = {};

  constructor(socket: FWSocket) {
    this.advancer = new AdvancerNoFail(this, this.advance);

    this.socket = socket;

    // receive all messages from the socket
    this.socket.onMsg = (msg: RecvMsgAll) => {
      this.recvd.push(msg);
      this.advancer.schedule();
    };
  }

  private getMuxID(): number {
    this.muxId += 1;
    return this.muxId;
  }

  private advance(): void {
    // hand out recvd messages
    let msg;
    while ((msg = this.recvd.shift())) {
      if (msg.type === 'result') {
        throw new Error('unexpected type:result message after login complete');
      }
      // find the matching subscription
      const sub = this.subs[msg.mux_id];
      if (sub !== undefined) {
        // let that subscription decide what to do
        sub.put(msg);
        continue;
      }
      const req = this.reqs[msg.mux_id];
      if (req !== undefined) {
        req.finish();
        delete this.reqs[msg.mux_id];
        continue;
      }
      // must be a streaming muxId that we canceled earlier
      console.warn(`unexpected muxId: ${msg.mux_id}`);
      return;
    }

    // ship any unsent messages
    while ((msg = this.unsent.shift())) {
      this.socket.send(msg);
    }
  }

  // TODO: have a real api; as-written, the user composes the whole message except mux_id and type
  subscribe(spec: SubscriptionSpec): FWSubscription {
    // can these be const?  I don't know how that works.
    const muxId = this.getMuxID();
    const msg = {
      type: 'subscribe',
      mux_id: muxId,
      ...spec,
    };
    const sub = new FWSubscriptionWS(this, muxId);
    this.subs[muxId] = sub;
    this.unsent.push(msg);
    this.advancer.schedule();
    return sub;
  }

  fetch(spec: SubscriptionSpec): FWFetch {
    const muxId = this.getMuxID();
    const msg = {
      type: 'fetch',
      mux_id: muxId,
      ...spec,
    };
    const f = new FWFetchWS(this, muxId);
    this.subs[muxId] = f;
    this.unsent.push(msg);
    this.advancer.schedule();
    return f;
  }

  upload(objects: object[]): FWUploadWS {
    const muxId = this.getMuxID();
    const msg = {
      type: 'upload',
      mux_id: muxId,
      objects: objects,
    };
    const req = new FWUploadWS(this, muxId);
    this.reqs[muxId] = req;
    this.unsent.push(msg);
    this.advancer.schedule();
    return req;
  }
}

class FWSubscriptionWS {
  client: FWClientWS;
  muxId: number;

  presync: RecvMsg[] = [];

  synced: boolean = false;
  closed: boolean = false;

  // callback API //
  /* onPreSyncMsg returns messages prior to the synchronization message.  If unset, onSync will
     return all messages in a single callback.  It is assumed onPreSyncMsg will be unset unless the
     consumer is collecting a very large amount of data and wants to process it as it arrives,
     rather than buffer everything in memory. */
  onPreSyncMsg?: { (msg: RecvMsg): void };
  /* onSync returns the whole initial payload, unless onPreSyncMsg was set, in which case it returns
     an empty list of messages. */
  onSync?: { (payload: RecvMsg[]): void };
  // onMsg returns individual messages which arrive after the sync message.
  onMsg?: { (msg: RecvMsg): void };

  constructor(client: FWClientWS, muxId: number) {
    this.client = client;
    this.muxId = muxId;
  }

  healthyCallback(func: () => void): void {
    setTimeout(() => {
      if (!this.closed && !this.client.socket.closing) {
        func();
      }
    });
  }

  // a message arrives from the client object
  put(msg: RecvMsgOrSync): void {
    if (msg.type === 'sync') {
      // this is the sync; deliver the buffered presync messages
      this.synced = true;
      const payload = this.presync;
      this.presync = [];
      this.healthyCallback(() => this.onSync?.call(null, payload));
      return;
    }
    if (this.synced) {
      // after sync, always call onMsg
      this.healthyCallback(() => this.onMsg?.call(null, msg));
      return;
    }
    if (this.onPreSyncMsg) {
      // before sync, client can request individual messages
      this.healthyCallback(() => this.onPreSyncMsg?.call(null, msg));
      return;
    }
    // buffer presync message and keep waiting for sync
    this.presync.push(msg);
  }

  // external API //
  close(): void {
    this.closed = true;
    this.client.unsent.push({ type: 'close', mux_id: this.muxId });
    delete this.client.subs[this.muxId];
    this.client.advancer.schedule();
  }
}

class FWFetchWS {
  client: FWClientWS;
  muxId: number;
  payload: RecvMsg[] = [];
  done: boolean = false;

  canceled: boolean = false;

  // callback API //
  onPreSyncMsg?: { (msg: RecvMsg): void };
  onFetch?: { (payload: RecvMsg[]): void };

  constructor(client: FWClientWS, muxId: number) {
    this.client = client;
    this.muxId = muxId;
  }

  healthyCallback(func: () => void): void {
    setTimeout(() => {
      if (!this.canceled && !this.client.socket.closing) {
        func();
      }
    });
  }

  // a message arrives from the client object
  put(msg: RecvMsgOrSync): void {
    if (msg.type === 'sync') {
      // this is the sync; deliver the buffered presync messages
      this.done = true;
      const payload = this.payload;
      this.payload = [];
      this.healthyCallback(() => this.onFetch?.call(null, payload));
      delete this.client.subs[this.muxId];
      return;
    }
    if (this.done) {
      console.error('FWFetchWS received a message after the sync!');
      return;
    }
    if (this.onPreSyncMsg) {
      // before completed fetch, client can request individual messages
      this.healthyCallback(() => this.onPreSyncMsg?.call(null, msg));
      return;
    }
    // buffer message as part of payload
    this.payload.push(msg);
  }

  // external API //

  /* cancel cancels the callback but does not affect the messages on the wire, since the server does
     not read messages from the client until after the sync message is sent. */
  // TODO: write the server to support preemption messages, and fix this
  cancel(): void {
    this.canceled = true;
  }
}

class FWUploadWS {
  client: FWClientWS;
  muxId: number;
  finished: boolean = false;

  // callback API //
  onFinish?: { (): void };

  constructor(client: FWClientWS, muxId: number) {
    this.client = client;
    this.muxId = muxId;
  }

  finish(): void {
    this.finished = true;
    if (!this.onFinish) return;
    setTimeout(() => {
      if (!this.client.socket.closing) this.onFinish?.call(null);
    });
  }
}
