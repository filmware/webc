export type Uuid = string;
export type UuidRecord<T> = Record<Uuid, T>;

interface Beforable {
  srvId: number;
  seqno: number;
}

export function isBefore(a: Beforable, akind: string, b: Beforable, bkind: string): boolean {
  if (a[akind] < b[bkind]) {
    return true;
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
type advanceDnFn = (error: Error) => void;

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

  schedule(error: Error) {
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
        this.error = error;
      }
    }

    if (this.doneUp || this.error) {
      this.advanceDn(this.error);
    }
  }
}
