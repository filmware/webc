import { FWClient, FWFetch, FWSubscription, FWUpload } from './client';
import { RecvMsg, SubscriptionSpec } from './utils';

// implements the FWClient interface
export class FWClientRecon {
  private ws?: FWClient;

  closed: boolean = false;

  subs: FWSubscriptionRecon[] = [];
  fetches: FWFetchRecon[] = [];
  uploads: FWUploadRecon[] = [];

  connect(ws: FWClient): void {
    this.ws = ws;

    // resubmit each of our subscriptions, fetches, and uploads
    this.subs.forEach((s) => s.send(ws));
    this.fetches.forEach((f) => f.send(ws));
    this.uploads.forEach((u) => u.send(ws));
  }

  subscribe(spec: object): FWSubscription {
    const s = new FWSubscriptionRecon(this, spec);
    this.subs.push(s);
    if (this.ws) s.send(this.ws);
    return s;
  }

  fetch(spec: object): FWFetch {
    const f = new FWFetchRecon(this, spec);
    this.fetches.push(f);
    if (this.ws) f.send(this.ws);
    return f;
  }

  upload(objects: object[]): FWUpload {
    const u = new FWUploadRecon(this, objects);
    this.uploads.push(u);
    if (this.ws) u.send(this.ws);
    return u;
  }
}

// TODO: needs a unit test
class Since {
  /* since will look like this:
      {
        "entries": {
          "1": 1029,
          "2": 3104,
        },
        "comments": {
          "1": 190839,
          "2": 18498,
        }
      } */
  private since: Record<string, Record<string, number>>;

  constructor(spec: SubscriptionSpec) {
    this.since = {
      project: {},
      user: {},
      permission: {},
      entry: {},
      topic: {},
      comment: {},
    };
    // remember the initial since values
    spec.projects?.since?.forEach((x) => {
      this.since.project[x[0]] = x[1];
    });
    spec.users?.since?.forEach((x) => {
      this.since.user[x[0]] = x[1];
    });
    spec.permissions?.since?.forEach((x) => {
      this.since.permission[x[0]] = x[1];
    });
    spec.entries?.since?.forEach((x) => {
      this.since.entry[x[0]] = x[1];
    });
    spec.topics?.since?.forEach((x) => {
      this.since.topic[x[0]] = x[1];
    });
    spec.comments?.since?.forEach((x) => {
      this.since.comment[x[0]] = x[1];
    });
  }

  private updateSince(subSince: Record<string, number>, srvId: number, seqno: number) {
    const old = subSince[srvId] || 0;
    subSince[srvId] = Math.max(old, seqno);
  }

  update(msg: RecvMsg) {
    this.updateSince(this.since[msg.type], msg.srv_id, msg.seqno);
  }

  private mkSince(subSince: Record<string, number>): number[][] {
    const since: number[][] = [];
    Object.entries(subSince).forEach(([k, v]) => since.push([Number(k), v]));
    return since;
  }

  mkSpec(spec: SubscriptionSpec): SubscriptionSpec {
    // return a user-provided spec modified with our own since values
    const out: SubscriptionSpec = {};
    if (spec.projects) out.projects = { ...spec.projects, since: this.mkSince(this.since.project) };
    if (spec.users) out.users = { ...spec.users, since: this.mkSince(this.since.user) };
    if (spec.permissions)
      out.permissions = {
        ...spec.permissions,
        since: this.mkSince(this.since.permission),
      };
    if (spec.entries) out.entries = { ...spec.entries, since: this.mkSince(this.since.entry) };
    if (spec.topics) out.topics = { ...spec.topics, since: this.mkSince(this.since.topic) };
    if (spec.comments) out.comments = { ...spec.comments, since: this.mkSince(this.since.comment) };
    return out;
  }
}

class FWSubscriptionRecon {
  recon: FWClientRecon;
  spec: object;
  wsSub?: FWSubscription;
  since: Since;
  closed: boolean = false;
  payload: RecvMsg[] = [];
  synced: boolean = false;

  onPreSyncMsg?: { (msg: RecvMsg): void };
  onSync?: { (payload: RecvMsg[]): void };
  onMsg?: { (msg: RecvMsg): void };

  constructor(recon: FWClientRecon, spec: object) {
    this.recon = recon;
    this.spec = spec;
    this.since = new Since(spec);
  }

  private healthyCallback(func: () => void): void {
    setTimeout(() => {
      if (!this.closed && !this.recon.closed) {
        func();
      }
    });
  }

  private put(msg: RecvMsg): void {
    // remember the since values we see
    this.since.update(msg);
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
    this.payload.push(msg);
  }

  send(ws: FWClient) {
    const spec = this.since.mkSpec(this.spec);
    this.wsSub = ws.subscribe(spec);
    this.wsSub.onPreSyncMsg = (msg: RecvMsg) => this.put(msg);
    this.wsSub.onMsg = (msg: RecvMsg) => this.put(msg);
    this.wsSub.onSync = () => {
      // only the first sync gets passed on
      if (this.synced) return;
      this.synced = true;
      const payload = this.payload;
      this.payload = [];
      this.healthyCallback(() => this.onSync?.call(null, payload));
    };
  }

  close(): void {
    this.closed = true;
    this.wsSub?.close();
    this.recon.subs = this.recon.subs.filter((x) => x !== this);
  }
}

class FWFetchRecon {
  recon: FWClientRecon;
  spec: object;
  wsFetch?: FWFetch;
  since: Since;
  closed: boolean = false;
  payload: RecvMsg[] = [];
  synced: boolean = false;

  onPreSyncMsg?: { (payload: RecvMsg): void };
  onFetch?: { (payload: RecvMsg[]): void };

  constructor(recon: FWClientRecon, spec: SubscriptionSpec) {
    this.recon = recon;
    this.spec = spec;
    this.since = new Since(spec);
  }

  private healthyCallback(func: () => void): void {
    setTimeout(() => {
      if (!this.closed && !this.recon.closed) {
        func();
      }
    });
  }

  send(ws: FWClient) {
    const spec = this.since.mkSpec(this.spec);
    this.wsFetch = ws.fetch(spec);
    this.wsFetch.onPreSyncMsg = (msg: RecvMsg) => {
      this.since.update(msg);
      if (this.onPreSyncMsg) {
        this.healthyCallback(() => this.onPreSyncMsg?.call(null, msg));
        return;
      }
      this.payload.push(msg);
    };
    this.wsFetch.onFetch = () => {
      const payload = this.payload;
      this.payload = [];
      this.healthyCallback(() => this.onFetch?.call(null, payload));
      // done with this fetch
      this.recon.fetches = this.recon.fetches.filter((x) => x !== this);
    };
  }

  cancel(): void {
    this.closed = true;
    this.wsFetch?.cancel();
    this.recon.fetches = this.recon.fetches.filter((x) => x !== this);
  }
}

class FWUploadRecon {
  recon: FWClientRecon;
  finished: boolean = false;
  objects: object[];

  onFinish?: { (): void };

  constructor(recon: FWClientRecon, objects: object[]) {
    this.recon = recon;
    this.objects = objects;
  }

  private healthyCallback(func: () => void): void {
    setTimeout(() => {
      if (!this.recon.closed) {
        func();
      }
    });
  }

  send(ws: FWClient) {
    // just resend
    const u = ws.upload(this.objects);
    u.onFinish = () => {
      this.healthyCallback(() => this.onFinish?.call(null));
      this.recon.uploads = this.recon.uploads.filter((x) => x !== this);
    };
  }
}
