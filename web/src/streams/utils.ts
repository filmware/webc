export type Uuid = string;
export type UuidRecord<T> = Record<Uuid, T>;

export type RecvSync = {
  type: 'sync';
  mux_id: number;
};

export type RecvSuccess = {
  type: 'result';
  success: true;
  user: Uuid;
  session: string;
  token: string;
  expiry: Date;
};

export type RecvFailure = {
  type: 'result';
  success: false;
};

type RecvMsgCommon = {
  srv_id: number;
  seqno: number;
  mux_id: number;
};

export type RecvProject = RecvMsgCommon & {
  type: 'project';
  version: Uuid;
  project: Uuid;
  name: string;
  user: Uuid;
  submissiontime: Date;
  authortime: Date;
  archivetime: unknown;
};

export type RecvAccount = RecvMsgCommon & {
  type: 'account';
  version: Uuid;
  account: Uuid;
  user: Uuid;
  name: Uuid;
  submissiontime: Date;
  authortime: Date;
  archivetime: unknown;
};

export type RecvUser = RecvMsgCommon & {
  type: 'user';
  version: Uuid;
  user: Uuid;
  account: Uuid;
  submissiontime: Date;
  authortime: Date;
  archivetime: Date;
};

type ReportNew = {
  operation: 'new';
  column_uuids: Uuid[];
  columns: string[];
  row_uuids: Uuid[];
  rows: UuidRecord<string>[];
  upload?: Uuid;
};
type ReportAddColumn = {
  operation: 'add-column';
  uuid: Uuid;
  name: string;
  default?: string;
};
type ReportAddRow = {
  operation: 'add-row';
  uuid: Uuid;
  row: UuidRecord<string>;
};
type ReportRenameColumn = {
  operation: 'rename-column';
  uuid: Uuid;
  name: string;
};
type ReportUpdateCell = {
  operation: 'update-cell';
  row: Uuid;
  column: Uuid;
  text: string;
};
type ReportArchiveReport = {
  operation: 'archive-report';
  value: boolean;
};
type ReportArchiveColumn = {
  operation: 'archive-column';
  uuid: Uuid;
  value: boolean;
};
type ReportArchiveRow = {
  operation: 'archive-row';
  uuid: Uuid;
  value: boolean;
};
type ReportOperation =
  | ReportNew
  | ReportAddColumn
  | ReportAddRow
  | ReportRenameColumn
  | ReportUpdateCell
  | ReportArchiveReport
  | ReportArchiveColumn
  | ReportArchiveRow;

export type RecvReport = RecvMsgCommon & {
  type: 'report';
  project: Uuid;
  report: Uuid;
  version: Uuid;
  operation: ReportOperation;
  modifies: Uuid[] | null;
  reason: string | null;
  user: Uuid;
  submissiontime: Date;
  authortime: Date;
  archivetime: unknown;
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

export type RecvMsg = RecvProject | RecvAccount | RecvUser | RecvReport | RecvComment | RecvTopic;
export type RecvMsgOrSync = RecvMsg | RecvSync;
export type RecvMsgAll = RecvMsgOrSync | RecvSuccess | RecvFailure;

export type SubscriptionSince = number[][];

export type AllSubscriptionItem = {
  since: SubscriptionSince;
};

export type SubscriptionItem = {
  since: SubscriptionSince;
  match: string;
  value?: string;
};

export type SubscriptionSpec = {
  projects?: AllSubscriptionItem;
  users?: AllSubscriptionItem;
  accounts?: AllSubscriptionItem;
  permissions?: SubscriptionItem;
  reports?: SubscriptionItem;
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
  if (a.srvId === b.srvId) return a.seqno < b.seqno;
  return a.srvId < b.srvId;
}

export function isBeforeSort(a: Beforable, akind: string, b: Beforable, bkind: string): number {
  return isBefore(a, akind, b, bkind) ? -1 : 1;
}

export function isBefore2(a: unknown, b: unknown, ...keys: string[]): boolean {
  for (const i in keys) {
    const key = keys[i];
    // @ts-expect-error: please get out of the way, typescript
    if (a[key] === b[key]) continue;
    // @ts-expect-error: please get out of the way, typescript
    return a[key] < b[key];
  }
  throw new Error(`unable to distinguish objects by keys [${keys}]`);
}

export function isBefore2Sort(a: unknown, b: unknown, ...keys: string[]): number {
  return isBefore2(a, b, ...keys) ? -1 : 1;
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

export class AdvancerNoFail {
  protected scheduled: boolean = false;
  protected advance: advanceUpFn;

  done: boolean = false;

  constructor(thisArg: unknown, advance: advanceUpFn) {
    this.advance = advance.bind(thisArg);
  }

  schedule(): void {
    if (!this.done && !this.scheduled) {
      setTimeout(() => {
        this.advanceState();
      });
      this.scheduled = true;
    }
  }

  protected advanceState(): void {
    this.scheduled = false;
    if (this.done) {
      // late wakeups are ignored
      return;
    }
    this.advance();
  }
}

export type Needed = UuidRecord<{ (): void }[]>;

export function need(key: Uuid, needed: Needed, unresolved: Unresolved, arg: unknown = null) {
  if (key in needed) {
    needed[key].push(unresolved.needed(arg));
  } else {
    needed[key] = [unresolved.needed(arg)];
  }
}

export function resolve(key: Uuid, needed: Needed) {
  if (key in needed) {
    needed[key].forEach((fn) => fn());
    delete needed[key];
  }
}

export class Unresolved {
  private flags: boolean[] = [];
  private onResolve: (arg: unknown) => void;

  constructor(onResolve: (arg: unknown) => void) {
    this.onResolve = onResolve;
  }

  needed(arg: unknown): () => void {
    const index = this.flags.length;
    this.flags.push(false);
    return () => {
      this.flags[index] = true;
      // was this the last dependency?
      if (this.isResolved()) {
        this.onResolve(arg);
      }
    };
  }

  isResolved(): boolean {
    return this.flags.every((x) => x);
  }
}

export function tob64(s: string): string {
  // from https://developer.mozilla.org/en-US/docs/Glossary/Base64#the_unicode_problem
  return btoa(String.fromCodePoint(...new TextEncoder().encode(s)));
}
