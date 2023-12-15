export type Uuid = string;
export type UuidRecord<T> = Record<Uuid, T>;

export type RecvSync = {
  type: 'sync';
  mux_id: number;
};

type RecvMsgCommon = {
  srv_id: number;
  seqno: number;
  mux_id: number;
};

export type RecvComment = RecvMsgCommon & {
  type: 'comment';
  project: Uuid;
  user: Uuid;
  version: Uuid;
  comment: Uuid;
  parent: Uuid | null;
  body: string;
  topic: Uuid;
  submissiontime: Date;
  authortime: Date;
  archivetime: unknown;
};

export type RecvTopic = RecvMsgCommon & {
  type: 'topic';
  project: Uuid;
  version: Uuid;
  topic: Uuid;
  user: Uuid;
  name: string;
  submissiontime: Date;
  authortime: Date;
  archivetime: unknown;
  links: unknown;
};

export type RecvMsg = RecvComment | RecvTopic;
export type RecvMsgOrSync = RecvMsg | RecvSync;

export type SubscriptionSince = number[][];

export type SubscriptionItem = {
  since: SubscriptionSince;
  match: string;
  value?: string;
};

export type SubscriptionSpec = {
  projects?: SubscriptionItem;
  users?: SubscriptionItem;
  permissions?: SubscriptionItem;
  entries?: SubscriptionItem;
  topics?: SubscriptionItem;
  comments?: SubscriptionItem;
};

interface Beforable {
  srvId: number;
  seqno: number;
}

export function isBefore(a: Beforable, akind: string, b: Beforable, bkind: string): boolean {
  // @ts-expect-error: please get out of the way, typescript
  if (a[akind] < b[bkind]) {
    return true;
    // @ts-expect-error: please get out of the way, typescript
  } else if (a[akind] > b[bkind]) {
    return false;
  }
  // tiebreaker
  if (a.srvId === b.srvId) return a.srvId < b.srvId;
  return a.srvId < b.srvId;
}

export function isBeforeSort(a: Beforable, akind: string, b: Beforable, bkind: string): number {
  return isBefore(a, akind, b, bkind) ? -1 : 1;
}

type advanceUpFn = () => void;
type advanceDnFn = (error?: Error) => void;

export class Advancer {
  protected error?: Error;
  protected scheduled: boolean = false;
  protected advanceUp: advanceUpFn;
  protected advanceDn: advanceDnFn;

  doneUp: boolean = false;
  doneDn: boolean = false;

  constructor(thisArg: unknown, advanceUp: advanceUpFn, advanceDn: advanceDnFn) {
    this.advanceUp = advanceUp.bind(thisArg);
    this.advanceDn = advanceDn.bind(thisArg);
  }

  alive(): boolean {
    return !this.doneUp && !this.error;
  }

  schedule(error: Error | null = null) {
    if (error && !this.error) {
      this.error = error;
    }
    if (!this.doneDn && !this.scheduled) {
      setTimeout(() => {
        this.advanceState();
      });
      this.scheduled = true;
    }
  }

  protected advanceState(): void {
    this.scheduled = false;
    if (this.doneDn) {
      // late wakeups are ignored
      return;
    }
    if (!this.doneUp && !this.error) {
      try {
        this.advanceUp();
      } catch (error) {
        this.error = error as Error;
      }
    }

    if (this.doneUp || this.error) {
      this.advanceDn(this.error);
    }
  }
}
