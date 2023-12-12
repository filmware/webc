import { observable, Observable, WritableObservable } from 'micro-observables';

import { FWClient, FWSubscription } from './client';
import { Advancer, isBefore, isBeforeSort, Uuid, UuidRecord } from './utils';

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
  private advancer: Advancer;
  private recvd?: object[];
  private comments: UuidRecord<FWComment> = {};
  private tops: string[] = [];
  private unresolved: UuidRecord<object[]> = {};

  private onSyncSent: boolean = false;

  constructor(client: FWClient, spec: object) {
    this.advancer = new Advancer(this, this.advanceUp, this.advanceDn);
    this.sub = client.subscribe({ comments: spec });
    this.sub.onSync = (payload) => {
      this.recvd = payload;
      this.advancer.schedule(null);
    };
    this.sub.onMsg = (msg) => {
      this.recvd.push(msg);
      this.advancer.schedule(null);
    };
    // @ts-expect-error; the value isn't valid until onSync
    this.writable = observable(undefined);
    this.observable = this.writable.readOnly();
  }

  // returns a set of comment uuids whose child lists need resolving.
  private processMsg(msg: object): UuidRecord<boolean> {
    const uuid = msg['comment'];
    const parent = msg['parent'];
    let out: UuidRecord<boolean> = {};

    // can we resolve this message yet?
    if (parent != null && !(parent in this.comments)) {
      // comment has a parent, but we haven't seen it yet
      if (parent in this.unresolved) {
        this.unresolved[parent].push(msg);
      } else {
        this.unresolved[parent] = [msg];
      }
      // we'll come back to it later
      return out;
    }

    const c = {
      srvId: msg['srvId'],
      seqno: msg['seqno'],
      uuid: uuid,
      topic: msg['topic'],
      project: msg['project'],
      user: msg['user'], // todo: link to users instead
      parent: msg['parent'],
      body: msg['body'],
      submissiontime: msg['submissiontime'],
      authortime: msg['authortime'],
      edittime: null,
      children: [],
    };

    // read diffs, apply to our comments map
    const prev = this.comments[uuid];
    const recurse = [];
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
      // check if any unresolved messages are newly resolvable
      const newResolved = this.unresolved[uuid];
      if (newResolved) {
        delete this.unresolved[uuid];
        // we'll process them at the end of this call
        recurse.push(...newResolved);
      }
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

    recurse.forEach((msg) => {
      out = { ...out, ...this.processMsg(msg) };
    });
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

  private advanceUp(): void {
    // wait for initial sync
    if (!this.recvd) return;

    // process recvd, and any messages which become resolvable as a result
    let reSort = {};
    this.recvd.forEach((msg: object) => {
      reSort = { ...reSort, ...this.processMsg(msg) };
    });
    this.recvd = [];

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
        if (!this.advancer.doneUp && this.onSync) {
          this.onSync(this.observable.get());
        }
      });
    }
  }

  private advanceDn(error: Error): void {
    // this should actually never run
    console.error('unexpected FWComments.advanceDn() error:', error);
  }

  close(): void {
    this.advancer.doneUp = true;
    this.sub.close();
    // there's no cleanup to be done
    this.advancer.doneDn = true;
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
  private advancer: Advancer;
  private recvd?: object[];
  private topics: UuidRecord<FWTopic> = {};
  private bySubmit: Uuid[] = [];

  private onSyncSent: boolean = false;

  constructor(client: FWClient, spec: object) {
    this.advancer = new Advancer(this, this.advanceUp, this.advanceDn);
    this.sub = client.subscribe({ topics: spec });
    this.sub.onSync = (payload) => {
      this.recvd = payload;
      this.advancer.schedule(null);
    };
    this.sub.onMsg = (msg) => {
      this.recvd.push(msg);
      this.advancer.schedule(null);
    };
    // @ts-expect-error; the value isn't valid until onSync
    this.writable = observable(undefined);
    this.observable = this.writable.readOnly();
  }

  // returns true if a sort is called for
  private processMsg(msg: object): boolean {
    const uuid = msg['topic'];
    let wantSort = false;

    const t = {
      srvId: msg['srvId'],
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

  private advanceUp(): void {
    // wait for initial sync
    if (!this.recvd) return;

    // process recvd, and any messages which become resolvable as a result
    let wantSort = false;
    this.recvd.forEach((msg: object) => {
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
        if (!this.advancer.doneUp && this.onSync) {
          this.onSync(this.observable.get());
        }
      });
    }
  }

  private advanceDn(error: Error): void {
    // this should actually never run
    console.error('unexpected FWTopics.advanceDn() error:', error);
  }

  close(): void {
    this.advancer.doneUp = true;
    this.sub.close();
    // there's no cleanup to be done
    this.advancer.doneDn = true;
  }
}
