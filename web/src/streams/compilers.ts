import { observable, Observable, WritableObservable } from 'micro-observables';

import { FWClient, FWSubscription } from './client';
import {
  AdvancerNoFail,
  isBefore,
  isBeforeSort,
  RecvAccount,
  RecvMsg,
  RecvUser,
  Uuid,
  UuidRecord,
} from './utils';

type Needed = UuidRecord<{ (): void }[]>;

function need(key: Uuid, needed: Needed, unresolved: Unresolved) {
  if (key in needed) {
    needed[key].push(unresolved.needed());
  } else {
    needed[key] = [unresolved.needed()];
  }
}

function resolve(key: Uuid, needed: Needed) {
  if (key in needed) {
    needed[key].forEach((fn) => fn());
    delete needed[key];
  }
}

class Unresolved {
  private flags: boolean[] = [];
  private onResolve: () => void;

  constructor(onResolve: () => void) {
    this.onResolve = onResolve;
  }

  needed(): () => void {
    const index = this.flags.length;
    this.flags.push(false);
    return () => {
      this.flags[index] = true;
      // was this the last dependency?
      if (this.flags.every((x) => x)) {
        this.onResolve();
      }
    };
  }
}

export type FWProject = {
  srvId: number; // only for tie-breaker sorting
  seqno: number; // only for tie-breaker sorting
  uuid: Uuid;
  name: string;
  submissiontime: Date;
  authortime: Date;
  edittime: Date | null;
};

export class FWProjects {
  observable: Observable<UuidRecord<FWProject>>;
  onSync?: (result: UuidRecord<FWProject>) => void;

  private writable: WritableObservable<UuidRecord<FWProject>>;
  private sub: FWSubscription;
  private advancer: AdvancerNoFail;
  private recvd: RecvMsg[] = [];
  private projects: UuidRecord<FWProject> = {};
  private synced: boolean = false;
  private onSyncSent: boolean = false;

  constructor(client: FWClient) {
    this.advancer = new AdvancerNoFail(this, this.advance);
    this.sub = client.subscribe({ projects: {} });
    this.sub.onSync = (payload) => {
      this.synced = true;
      this.recvd = payload;
      this.advancer.schedule();
    };
    this.sub.onMsg = (msg) => {
      this.recvd.push(msg);
      this.advancer.schedule();
    };
    // @ts-expect-error; the value isn't valid until onSync
    this.writable = observable(undefined);
    this.observable = this.writable.readOnly();
  }

  private processMsg(msg: RecvMsg) {
    if (msg.type !== 'project') return;

    const uuid = msg['project'];

    const p = {
      srvId: msg['srv_id'],
      seqno: msg['seqno'],
      uuid: uuid,
      name: msg['name'],
      submissiontime: msg['submissiontime'],
      authortime: msg['authortime'],
      edittime: null,
    };

    const prev = this.projects[uuid];
    if (!prev) {
      // new project
      this.projects[uuid] = p;
    } else if (
      // prev has already been edited...
      prev.edittime &&
      // and p is an update to prev...
      isBefore(prev, 'authortime', p, 'authortime') &&
      // but p is not the latest update to prev...
      isBefore(p, 'authortime', prev, 'edittime')
    ) {
      // ignore already-obsolete updates
    } else {
      // we have an update
      const prevIsOlder = isBefore(prev, 'authortime', p, 'authortime');
      const [older, newer] = prevIsOlder ? [prev, p] : [p, prev];
      this.projects[uuid] = {
        // preserve immutable fields
        // (note we are trusting the update to not make illegal modifications)
        ...prev,
        // update mutable content
        srvId: older.srvId,
        seqno: older.seqno,
        submissiontime: older.submissiontime,
        authortime: older.authortime,
        name: newer.name,
        edittime: newer.authortime,
      };
    }
  }

  private advance(): void {
    // wait for initial sync
    if (!this.synced) return;

    // process recvd, and any messages which become resolvable as a result
    this.recvd.forEach((msg) => this.processMsg(msg));

    // update the observable
    this.writable.set({ ...this.projects });

    // send onSync after we have processed our own sync msg
    if (!this.onSyncSent) {
      this.onSyncSent = true;
      setTimeout(() => {
        if (!this.advancer.done && this.onSync) {
          this.onSync(this.observable.get());
        }
      });
    }
  }

  close(): void {
    this.advancer.done = true;
    this.sub.close();
  }
}

type User = {
  srvId: number; // only for tie-breaker sorting
  seqno: number; // only for tie-breaker sorting
  uuid: Uuid;
  account: Uuid;
  timestamp: Date;
};

type Account = {
  srvId: number; // only for tie-breaker sorting
  seqno: number; // only for tie-breaker sorting
  uuid: Uuid;
  name: string;
  timestamp: Date;
};

// FWUserAccount is a blend of the user and accounts table, keyed by user uuid.
export type FWUserAccount = {
  user: Uuid;
  account: Uuid;
  name: string;
};

export class FWUserAccounts {
  observable: Observable<UuidRecord<FWUserAccount>>;
  // onSync fires shortly after the observable are populated the first time
  onSync?: { (result: UuidRecord<FWUserAccount>): void };

  private writable: WritableObservable<UuidRecord<FWUserAccount>>;
  private sub: FWSubscription;
  private advancer: AdvancerNoFail;
  private recvd: RecvMsg[] = [];
  private accounts: UuidRecord<Account> = {};
  private ua: UuidRecord<FWUserAccount> = {};
  private accountsNeeded: Needed = {};

  private synced: boolean = false;
  private onSyncSent: boolean = false;

  // exposed for other compilers... not really meant to be public
  users: UuidRecord<User> = {};
  usersNeeded: Needed = {};
  private syncWritable: WritableObservable<boolean>;
  syncObservable: Observable<boolean>;

  constructor(client: FWClient) {
    this.advancer = new AdvancerNoFail(this, this.advance);
    this.sub = client.subscribe({ users: {}, accounts: {} });
    this.sub.onSync = (payload) => {
      this.synced = true;
      this.recvd = payload;
      this.advancer.schedule();
    };
    this.sub.onMsg = (msg) => {
      this.recvd.push(msg);
      this.advancer.schedule();
    };
    // @ts-expect-error; the value isn't valid until onSync
    this.writable = observable(undefined);
    this.observable = this.writable.readOnly();
    this.syncWritable = observable(false);
    this.syncObservable = this.syncWritable.readOnly();
  }

  processAccount(msg: RecvAccount): boolean {
    const a = {
      srvId: msg.srv_id,
      seqno: msg.seqno,
      name: msg.name,
      uuid: msg.account,
      timestamp: msg.submissiontime,
    };

    const prev = this.accounts[a.uuid];

    // is this update stale?
    if (prev && isBefore(a, 'timestamp', prev, 'timestamp')) return false;

    this.accounts[a.uuid] = a;

    // detect resolutions
    if (!prev) {
      resolve(a.uuid, this.accountsNeeded);
    }

    // will this affect our observable?
    if (!prev || prev.name === a.name) return false;

    // apply name change
    const updates: Uuid[] = [];
    Object.values(this.ua).forEach((ua) => {
      if (ua.account === a.uuid) updates.push(ua.user);
    });
    updates.forEach((uuid) => {
      this.ua[uuid] = { ...this.ua[uuid], name: a.name };
    });
    return true;
  }

  processUser(msg: RecvUser): boolean {
    if (!(msg.account in this.accounts)) {
      // not yet resolvable
      const unresolved = new Unresolved(() => {
        this.recvd.push(msg);
      });
      need(msg.account, this.accountsNeeded, unresolved);
      return false;
    }

    const u = {
      srvId: msg.srv_id,
      seqno: msg.seqno,
      uuid: msg.user,
      account: msg.account,
      timestamp: msg.submissiontime,
    };

    const prev = this.users[u.uuid];

    // is this update stale?
    if (prev && isBefore(u, 'timestamp', prev, 'timestamp')) return false;

    this.users[u.uuid] = u;

    if (!prev) {
      resolve(u.uuid, this.usersNeeded);
    }

    // does this update affect our observable output?
    if (prev && prev.account === u.account) return false;

    this.ua[u.uuid] = {
      user: u.uuid,
      account: u.account,
      name: this.accounts[u.account].name,
    };
    return true;
  }

  private advance(): void {
    if (!this.synced) return;

    let update = false;
    let msg;
    while ((msg = this.recvd.shift())) {
      switch (msg.type) {
        case 'account':
          update = this.processAccount(msg) || update;
          break;
        case 'user':
          update = this.processUser(msg) || update;
          break;
        default:
          break;
      }
    }

    if (update || !this.onSyncSent) {
      // update the observable
      this.writable.set({ ...this.ua });
    }

    // send onSync after we have processed our own sync msg
    if (!this.onSyncSent) {
      this.onSyncSent = true;
      setTimeout(() => {
        if (!this.advancer.done && this.onSync) {
          this.onSync(this.observable.get());
        }
      });
      this.syncWritable.set(true);
    }
  }

  close(): void {
    this.advancer.done = true;
    this.sub.close();
  }
}

export type FWComment = {
  srvId: number; // only for tie-breaker sorting
  seqno: number; // only for tie-breaker sorting
  uuid: Uuid;
  topic: Uuid;
  project: Uuid;
  user: Uuid;
  body: string;
  parent: Uuid | null;

  // whose parent are we
  children: Uuid[];
  submissiontime: Date;
  authortime: Date;
  edittime: Date | null;
};

export type FWCommentsResult = {
  // comments is all comments this store knows of.
  comments: UuidRecord<FWComment>;
  // topLevels are comments with a null parent, sorted by submissiontime
  topLevels: Uuid[];
};

export class FWComments {
  observable: Observable<FWCommentsResult>;
  // onSync fires shortly after the observable are populated the first time
  onSync?: { (result: FWCommentsResult): void };

  private writable: WritableObservable<FWCommentsResult>;
  private sub: FWSubscription;
  private advancer: AdvancerNoFail;
  private ua: FWUserAccounts;
  private recvd: RecvMsg[] = [];
  private comments: UuidRecord<FWComment> = {};
  private tops: string[] = [];
  private commentsNeeded: Needed = {};
  private synced: boolean = false;
  private uaSynced: boolean = false;

  private onSyncSent: boolean = false;

  constructor(client: FWClient, ua: FWUserAccounts, spec: object) {
    this.advancer = new AdvancerNoFail(this, this.advance);
    this.sub = client.subscribe({ comments: spec });
    this.sub.onSync = (payload) => {
      this.synced = true;
      this.recvd = payload;
      this.advancer.schedule();
    };
    this.sub.onMsg = (msg) => {
      this.recvd.push(msg);
      this.advancer.schedule();
    };
    // @ts-expect-error; the value isn't valid until onSync
    this.writable = observable(undefined);
    this.observable = this.writable.readOnly();
    this.ua = ua;
    if (ua.syncObservable.get()) {
      this.uaSynced = true;
    } else {
      ua.syncObservable.subscribe(() => {
        this.uaSynced = true;
        this.advancer.schedule();
      });
    }
  }

  // returns a set of comment uuids whose child lists need sorting.
  private processMsg(msg: RecvMsg): UuidRecord<boolean> {
    const out: UuidRecord<boolean> = {};
    if (msg.type !== 'comment') return out;

    const uuid = msg['comment'];
    const parent = msg['parent'];
    const user = msg['user'];

    // can we resolve this message yet?
    const haveParent = parent == null || parent in this.comments;
    const haveUser = user in this.ua.users;
    if (!haveParent || !haveUser) {
      const unresolved = new Unresolved(() => {
        this.recvd.push(msg);
        this.advancer.schedule();
      });
      if (!haveParent) need(parent, this.commentsNeeded, unresolved);
      if (!haveUser) need(user, this.ua.usersNeeded, unresolved);
      return out;
    }

    const c = {
      srvId: msg['srv_id'],
      seqno: msg['seqno'],
      uuid: uuid,
      topic: msg['topic'],
      project: msg['project'],
      user: user,
      parent: msg['parent'],
      body: msg['body'],
      submissiontime: msg['submissiontime'],
      authortime: msg['authortime'],
      edittime: null,
      children: [],
    };

    // read diffs, apply to our comments map
    const prev = this.comments[uuid];
    if (!prev) {
      // new comment
      this.comments[uuid] = c;
      if (c.parent) {
        // add this comment to its parent's children list
        this.comments[c.parent].children.push(uuid);
        out[c.parent] = true;
      } else {
        // add this comment to our list of top-level comments
        this.tops.push(uuid);
        out['topLevels'] = true;
      }
      resolve(uuid, this.commentsNeeded);
    } else if (
      // prev has already been edited...
      prev.edittime &&
      // and c is an update to prev...
      isBefore(prev, 'authortime', c, 'authortime') &&
      // but c is not the latest update to prev...
      isBefore(c, 'authortime', prev, 'edittime')
    ) {
      // ignore already-obsolete updates
    } else {
      // we have an update
      const prevIsOlder = isBefore(prev, 'authortime', c, 'authortime');
      const [older, newer] = prevIsOlder ? [prev, c] : [c, prev];
      if (!prevIsOlder) {
        // a resort will also be called for
        out[c.parent || 'topLevels'] = true;
      }
      this.comments[uuid] = {
        // preserve immutable fields and child links
        // (note we are trusting the update to not make illegal modifications)
        ...prev,
        // update mutable content
        srvId: older.srvId,
        seqno: older.seqno,
        submissiontime: older.submissiontime,
        authortime: older.authortime,
        body: newer.body,
        edittime: newer.authortime,
      };
    }

    return out;
  }

  private sortUuids(list: Uuid[]): Uuid[] {
    // do all map lookups once
    const temp = list.map((uuid) => this.comments[uuid]);

    // sort by submissiontime
    temp.sort((a, b) => {
      return isBeforeSort(a, 'submissiontime', b, 'submissiontime');
    });

    // return just the sorted uuids
    return temp.map((c) => c.uuid);
  }

  private advance(): void {
    // wait for initial sync, both our own and the FWUserAccounts.
    if (!this.synced || !this.uaSynced) return;

    let reSort = {};
    let msg;
    while ((msg = this.recvd.shift())) {
      reSort = { ...reSort, ...this.processMsg(msg) };
    }

    // re-sort any objects with updated lists
    for (const key in reSort) {
      if (key === 'topLevels') {
        this.tops = this.sortUuids(this.tops);
      } else {
        const c = this.comments[key];
        this.comments[key] = {
          ...c,
          children: this.sortUuids(c.children),
        };
      }
    }

    // update the observable
    this.writable.set({
      /* the only case where map was not updated is if we received only stale updates, which will be
         virtually never */
      comments: { ...this.comments },
      // topLevels is updated IFF this.tops was updated
      topLevels: this.tops,
    });

    // send onSync after we have processed our own sync msg
    if (!this.onSyncSent) {
      this.onSyncSent = true;
      setTimeout(() => {
        if (!this.advancer.done && this.onSync) {
          this.onSync(this.observable.get());
        }
      });
    }
  }

  close(): void {
    this.advancer.done = true;
    this.sub.close();
  }
}

export type FWTopic = {
  srvId: number; // only for tie-breaker sorting
  seqno: number; // only for tie-breaker sorting
  uuid: Uuid;
  project: Uuid;
  user: Uuid;
  name: string;
  // TODO: figure out what links will look like.
  links: unknown;

  /* more info TDB.  I expect collecting some summary data (comment count, date of most recent
     activity, etc) would be seriously useful to the online-only web client (though it would be
     calculated offline for the indexed-db-based web client), but the server needs to be written to
     track that info. */

  submissiontime: Date;
  authortime: Date;
  edittime: Date | null;
};

export type FWTopicsResult = {
  topics: UuidRecord<FWTopic>;
  bySubmit: Uuid[];
};

export class FWTopics {
  observable: Observable<FWTopicsResult>;
  // onSync fires shortly after the observable are populated the first time
  onSync?: { (result: FWTopicsResult): void };

  private writable: WritableObservable<FWTopicsResult>;
  private sub: FWSubscription;
  private advancer: AdvancerNoFail;
  private recvd: RecvMsg[] = [];
  private topics: UuidRecord<FWTopic> = {};
  private bySubmit: Uuid[] = [];
  private synced: boolean = false;

  private onSyncSent: boolean = false;

  constructor(client: FWClient, spec: object) {
    this.advancer = new AdvancerNoFail(this, this.advance);
    this.sub = client.subscribe({ topics: spec });
    this.sub.onSync = (payload) => {
      this.synced = true;
      this.recvd = payload;
      this.advancer.schedule();
    };
    this.sub.onMsg = (msg) => {
      this.recvd.push(msg);
      this.advancer.schedule();
    };
    // @ts-expect-error; the value isn't valid until onSync
    this.writable = observable(undefined);
    this.observable = this.writable.readOnly();
  }

  // returns true if a sort is called for
  private processMsg(msg: RecvMsg): boolean {
    if (msg.type !== 'topic') return false;

    const uuid = msg['topic'];
    let wantSort = false;

    const t = {
      srvId: msg['srv_id'],
      seqno: msg['seqno'],
      uuid: uuid,
      project: msg['project'],
      user: msg['user'],
      name: msg['name'],
      links: msg['links'],
      submissiontime: msg['submissiontime'],
      authortime: msg['authortime'],
      edittime: null,
    };

    const prev = this.topics[uuid];
    if (!prev) {
      // this is a new topic
      this.topics[uuid] = t;
      this.bySubmit.push(uuid);
      wantSort = true;
    } else if (
      // prev has already been edited...
      prev.edittime &&
      // and t is an update to prev...
      isBefore(prev, 'authortime', t, 'authortime') &&
      // but t is not the latest update to prev...
      isBefore(t, 'authortime', prev, 'edittime')
    ) {
      // ignore already-obsolete updates
    } else {
      // we have an update
      // t updates prev
      const prevIsOlder = isBefore(prev, 'authortime', t, 'authortime');
      const [older, newer] = prevIsOlder ? [prev, t] : [t, prev];
      if (!prevIsOlder) {
        // a resort is called for
        wantSort = true;
      }
      this.topics[uuid] = {
        // preserve immutable fields
        // (note we are trusting the update to not make illegal modifications)
        ...prev,
        // update mutable content
        srvId: older.srvId,
        seqno: older.seqno,
        submissiontime: older.submissiontime,
        authortime: older.authortime,
        name: newer.name,
        links: newer.links,
        edittime: newer.authortime,
      };
    }

    return wantSort;
  }

  private advance(): void {
    // wait for initial sync
    if (!this.synced) return;

    // process recvd, and any messages which become resolvable as a result
    let wantSort = false;
    this.recvd.forEach((msg) => {
      wantSort = this.processMsg(msg) || wantSort;
    });
    this.recvd = [];

    if (wantSort) {
      const temp = this.bySubmit.map((uuid) => this.topics[uuid]);

      // sort by submissiontime
      temp.sort((a, b) => {
        return isBeforeSort(a, 'submissiontime', b, 'submissiontime');
      });

      this.bySubmit = temp.map((t) => t.uuid);
    }

    // update the observable
    this.writable.set({
      topics: { ...this.topics },
      bySubmit: this.bySubmit,
    });

    // send onSync after we have processed our own sync msg
    if (!this.onSyncSent) {
      this.onSyncSent = true;
      setTimeout(() => {
        if (!this.advancer.done && this.onSync) {
          this.onSync(this.observable.get());
        }
      });
    }
  }

  close(): void {
    this.advancer.done = true;
    this.sub.close();
  }
}
