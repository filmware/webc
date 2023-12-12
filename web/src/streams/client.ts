import { Advancer } from './utils';

/* FWClient is the logical unit of synchronization.  It is an interface because it can be
   implemented either directly over a websocket or through a replicator built around an IndexedDB,
   or through a port to SharedWorker. */
export interface FWClient {
  subscribe(spec: object): FWSubscription;
  fetch(spec: object): FWFetch;
  upload(objects: object[]): void;
}

export interface FWSubscription {
  /* onPreSyncMsg returns messages prior to the synchronization message.  If unset, onSync will
     return all messages in a single callback.  It is assumed onPreSyncMsg will be unset unless
     the consumer is collecting a very large amount of data and wants to process it as it arrives,
     rather than buffer everything in memory. */
  onPreSyncMsg?: { (msg: object): void };
  /* onSync returns the whole initial payload, unless onPreSyncMsg was set, in which case it returns
     an empty list of messages. */
  onSync?: { (payload: object[]): void };
  // onMsg returns individual messages which arrive after the sync message.
  onMsg?: { (msg: object): void };

  close(): void;
}

export interface FWFetch {
  onFetch?: { (payload: object[]): void };
  cancel(): void;
}

export class FWClientWS {
  advancer: Advancer;
  socket: WebSocket;

  unsent: object[] = [];
  recvd: object[] = [];
  muxId: number = 0;
  subs: Record<number, FWSubscriptionWS> = {};
  reqs: Record<number, FWRequestWS> = {};

  socketConnected: boolean = false;
  socketCloseStarted: boolean = false;
  socketCloseDone: boolean = false;
  wantClose: boolean = false;

  // callback API //
  onClose?: { (error: Error): void };

  constructor(url: string) {
    this.advancer = new Advancer(this, this.advanceUp, this.advanceDn);

    this.socket = new WebSocket(url);

    this.socket.onopen = (): void => {
      this.socketConnected = true;
      this.advancer.schedule(null);
    };
    this.socket.onmessage = (e: Event): void => {
      const msg = JSON.parse(e.data);
      this.recvd.push(msg);
      this.advancer.schedule(null);
    };
    this.socket.onclose = (): void => {
      this.socketCloseDone = true;
      let error = undefined;
      if (!this.wantClose) {
        error = new Error('closed early');
      }
      this.advancer.schedule(error);
    };
    this.socket.onerror = (error: Event): void => {
      // discard the error if we closed the websocket ourselves
      let keptError = undefined;
      if (!this.wantClose) {
        keptError = error;
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

  private advanceDn(error: Error): void {
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
  subscribe(spec: object): FWSubscription {
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

  fetch(spec: object): FWFetch {
    const muxId = this.getMuxID();
    const msg = {
      type: 'fetch',
      mux_id: muxId,
      ...spec,
    };
    const sub = new FWSubscriptionWS(this, muxId);
    this.subs[muxId] = sub;
    this.unsent.push(msg);
    this.advancer.schedule(null);
    return new FWFetchWS(sub);
  }

  upload(objects: object[]): FWRequestWS {
    const muxId = this.getMuxID();
    const msg = {
      type: 'upload',
      mux_id: muxId,
      objects: objects,
    };
    const req = new FWRequestWS(this, muxId);
    this.reqs[muxId] = req;
    this.unsent.push(msg);
    this.advancer.schedule(null);
    return req;
  }
}

class FWSubscriptionWS {
  client: FWClientWS;
  muxId: number;

  presync: object[] = [];

  synced: boolean = false;
  closed: boolean = false;

  // callback API //
  /* onPreSyncMsg returns messages prior to the synchronization message.  If unset, onSync will
     return all messages in a single callback.  It is assumed onPreSyncMsg will be unset unless the
     consumer is collecting a very large amount of data and wants to process it as it arrives,
     rather than buffer everything in memory. */
  onPreSyncMsg?: { (msg: object): void };
  /* onSync returns the whole initial payload, unless onPreSyncMsg was set, in which case it returns
     an empty list of messages. */
  onSync?: { (payload: object[]): void };
  // onMsg returns individual messages which arrive after the sync message.
  onMsg?: { (msg: object): void };

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
  put(msg: object): void {
    if (this.synced) {
      // after sync, always call onMsg
      this.healthyCallback(() => this.onMsg?.call(this, msg));
      return;
    }
    if (msg.type === 'sync') {
      // this is the sync; deliver the buffered presync messages
      this.synced = true;
      const payload = this.presync;
      this.presync = [];
      this.healthyCallback(() => this.onSync?.call(this, payload));
      return;
    }
    if (this.onPreSyncMsg) {
      // before sync, client can request individual messages
      this.healthyCallback(() => this.onPreSyncMsg?.call(this, msg));
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
  // FWFetch is just a wrapper around FWSubscription
  sub: FWSubscriptionWS;

  canceled: boolean = false;

  // callback API //
  onFetch?: { (payload: object[]): void };

  constructor(sub: object) {
    this.sub = sub;
    this.sub.onSync = (payload) => {
      this.healthyCallback(() => this.onFetch?.call(this, payload));
      delete this.sub.client.subs[sub.muxId];
    };
  }

  healthyCallback(func: () => void): void {
    setTimeout(() => {
      if (!this.canceled && !this.sub.client.wantClose) {
        func();
      }
    });
  }

  // external API //

  /* cancel cancels the callback but does not affect the messages on the wire, since the server does
     not read messages from the client until after the sync message is sent. */
  cancel(): void {
    this.canceled = true;
  }
}

class FWRequestWS {
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
      if (!this.client.wantClose) this.onFinish?.call(this);
    });
  }

  // no external API //
}
