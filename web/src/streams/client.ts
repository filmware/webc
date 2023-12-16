import { Advancer, RecvMsg, RecvMsgOrSync, SubscriptionSpec } from './utils';
import { WebSock } from './websock';

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

export class FWClientWS {
  advancer: Advancer;
  socket: WebSock;

  unsent: object[] = [];
  recvd: RecvMsgOrSync[] = [];
  muxId: number = 0;
  subs: Record<number, FWSubscriptionWS | FWFetchWS> = {};
  reqs: Record<number, FWUploadWS> = {};

  socketConnected: boolean = false;
  socketCloseStarted: boolean = false;
  socketCloseDone: boolean = false;
  wantClose: boolean = false;

  // callback API //
  onClose?: { (error?: Error): void };

  // FWClientWS-specific callback
  onConnect?: { (): void };

  constructor(url: string) {
    this.advancer = new Advancer(this, this.advanceUp, this.advanceDn);

    this.socket = new WebSock(url);
    this.socket.onopen = (): void => {
      setTimeout(() => {
        if (!this.wantClose) this.onConnect?.call(null);
      });
      this.socketConnected = true;
      this.advancer.schedule(null);
    };
    this.socket.onmessage = (e: MessageEvent): void => {
      const msg = JSON.parse(e.data);
      this.recvd.push(msg);
      this.advancer.schedule(null);
    };
    this.socket.onclose = (): void => {
      this.socketCloseDone = true;
      let error = null;
      if (!this.wantClose) {
        error = new Error('closed early');
      }
      this.advancer.schedule(error);
    };
    this.socket.onerror = (event: ErrorEvent): void => {
      // discard the error if we closed the websocket ourselves
      let keptError = null;
      if (!this.wantClose) {
        keptError = event.error;
      }
      this.advancer.schedule(keptError);
    };
  }

  private getMuxID(): number {
    this.muxId += 1;
    return this.muxId;
  }

  private advanceUp(): void {
    // wait for a connection
    if (!this.socketConnected) {
      return;
    }

    // hand out recvd messages
    let msg;
    while ((msg = this.recvd.shift())) {
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
      this.socket.send(JSON.stringify(msg));
    }
  }

  private advanceDn(error?: Error): void {
    // make sure our socket is closed
    if (!this.socketCloseDone) {
      if (!this.socketCloseStarted) {
        this.socket.close();
      }
      return;
    }

    // we're done now
    this.advancer.doneDn = true;

    if (this.onClose) {
      setTimeout(() => {
        if (this.onClose) this.onClose(error);
      });
    }
  }

  // external API //
  close() {
    this.wantClose = true;
    this.advancer.doneUp = true;
    this.advancer.schedule(null);
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
    this.advancer.schedule(null);
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
    this.advancer.schedule(null);
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
    this.advancer.schedule(null);
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
      if (!this.closed && !this.client.wantClose) {
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
    this.client.advancer.schedule(null);
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
      if (!this.canceled && !this.client.wantClose) {
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
      if (!this.client.wantClose) this.onFinish?.call(null);
    });
  }
}
