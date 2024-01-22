import { FWFetch, FWSubscription, FWUpload } from './client';
import { FWUserAccounts } from './compilers';
import {
  firstAnswer,
  FWJoinedRow,
  FWJoinedTable,
  FWJoinedTableResult,
  joinBy,
  Joiner,
  parseScene,
  selectorSort,
} from './join';
import { FWReports } from './reports';
import { RecvMsg, RecvMsgCommon } from './utils';

describe('firstAnswer', () => {
  it('should work with no input', () => {
    const result = firstAnswer([], (j) => j.clip ?? '');
    expect(result).toBe('');
  });
  it('should work with one input', () => {
    const input = [
      { report: 'r1', row: 'w1', archived: false },
      { report: 'r2', row: 'w2', archived: false, clip: 'theclip' },
      { report: 'r3', row: 'w3', archived: false, clip: '' },
    ];
    const result = firstAnswer(input, (j) => j.clip ?? '');
    expect(result).toBe('theclip');
  });
  it('should work with multiple matching inputs', () => {
    const input = [
      { report: 'r1', row: 'w1', archived: false },
      { report: 'r2', row: 'w2', archived: false, clip: 'theclip' },
      { report: 'r3', row: 'w3', archived: false, clip: 'theclip' },
    ];
    const result = firstAnswer(input, (j) => j.clip ?? '');
    expect(result).toBe('theclip');
  });
  it('should work with multiple mismatching inputs', () => {
    const input = [
      { report: 'r1', row: 'w1', archived: false },
      { report: 'r2', row: 'w2', archived: false, clip: 'theclip' },
      { report: 'r3', row: 'w3', archived: false, clip: 'thewrongclip' },
    ];
    const result = firstAnswer(input, (j) => j.clip ?? '');
    expect(result).toBe('theclip');
  });
});

describe('joinBy', () => {
  it('should work', () => {
    const input: Joiner[][] = [
      [{ report: 'r1', row: 'w1', archived: false, clip: 'theclip' }],
      [{ report: 'r2', row: 'w2', archived: false, clip: 'theclip' }],
      [{ report: 'r3', row: 'w3', archived: false, clip: '' }],
      [{ report: 'r4', row: 'w4', archived: false }],
    ];
    const result = joinBy(input, (j) => j.clip ?? '');
    expect(result).toStrictEqual([
      [{ report: 'r3', row: 'w3', archived: false, clip: '' }],
      [{ report: 'r4', row: 'w4', archived: false }],
      [
        { report: 'r1', row: 'w1', archived: false, clip: 'theclip' },
        { report: 'r2', row: 'w2', archived: false, clip: 'theclip' },
      ],
    ]);
  });
});

describe('parseScene', () => {
  it('should parse a full scene', () => {
    const result = parseScene('v25a');
    expect(result).toStrictEqual([25, 'a', 'v']);
  });
  it('should parse a bare number', () => {
    const result = parseScene('25');
    expect(result).toStrictEqual([25, '', '']);
  });
  it('should parse number plus suffix', () => {
    const result = parseScene('25a1');
    expect(result).toStrictEqual([25, 'a1', '']);
  });
  it('should parse number plus prefix', () => {
    const result = parseScene('v25');
    expect(result).toStrictEqual([25, '', 'v']);
  });
  it('should should do something sane when no number is found', () => {
    const result = parseScene('hello world');
    expect(result).toStrictEqual([0, 'hello world', '']);
  });
});

describe('selectorSort', () => {
  it('should sort scenes properly', () => {
    const input = ['1', '2', '1b', 'v1a', 'v2a', '2b', 'v1'];
    const result = selectorSort(input, (s) => parseScene(s));
    expect(result).toStrictEqual(['1', 'v1', 'v1a', '1b', '2', 'v2a', '2b']);
  });
});

class MockSubscription {
  onPreSyncMsg?: { (msg: RecvMsg): void };
  onSync?: { (payload: RecvMsg[]): void };
  onMsg?: { (msg: RecvMsg): void };

  private synced: boolean = false;
  private payload: RecvMsg[] = [];
  private closeExpected: boolean = false;
  closed: boolean = false;

  constructor() {}

  private healthyCallback(func: () => void): void {
    setTimeout(() => {
      if (!this.closed) {
        func();
      }
    });
  }

  put(msg: RecvMsg): void {
    if (this.synced) {
      // after sync, always call onMsg
      this.healthyCallback(() => this.onMsg?.call(null, msg));
    } else if (this.onPreSyncMsg) {
      // before sync, client can request individual messages
      this.healthyCallback(() => this.onPreSyncMsg?.call(null, msg));
    } else {
      // buffer presync message and keep waiting for sync
      this.payload.push(msg);
    }
  }

  sync(): void {
    if (this.synced) throw new Error('duplicate call to MockSubscription.sync()');
    this.synced = true;
    const payload = this.payload;
    this.payload = [];
    this.healthyCallback(() => this.onSync?.call(null, payload));
  }

  close(): void {
    if (this.closed) return;
    if (!this.closeExpected) {
      throw new Error('unexpected MockSubscription.close()');
    }
    this.closed = true;
  }

  expectClose(): void {
    this.closeExpected = true;
  }
}

class MockClient {
  private expectSubscriptions: MockSubscription[] = [];

  constructor() {}

  subscribe(_: object): FWSubscription {
    if (this.expectSubscriptions.length === 0) {
      throw new Error('unexpected MockClient.subscribe()');
    }
    return this.expectSubscriptions.shift()!;
  }

  expectSubscribe(sub: MockSubscription): void {
    this.expectSubscriptions.push(sub);
  }

  fetch(_: object): FWFetch {
    throw new Error('MockClient.fetch() is not implemented');
  }

  upload(_: object): FWUpload {
    throw new Error('MockClient.upload() is not implemented');
  }

  expectDone(): void {
    expect(this.expectSubscriptions.length).toBe(0);
  }
}

let gSeqno = 0;
type MsgCommon = RecvMsgCommon & { submissiontime: Date; authortime: Date; archivetime: unknown };
function msgCommon(): MsgCommon {
  return {
    srv_id: 0,
    seqno: ++gSeqno,
    mux_id: 0,
    submissiontime: '0' as unknown as Date, // TODO:fixdates
    authortime: '0' as unknown as Date, // TODO:fixdates
    archivetime: null,
  };
}

describe('JoinedIndex', () => {
  it('should start up with basic values', async () => {
    const client = new MockClient();

    // configure the FWUserAccounts
    const userSub = new MockSubscription();
    client.expectSubscribe(userSub);
    const ua = new FWUserAccounts(client);
    client.expectDone();

    userSub.put({
      ...msgCommon(),
      type: 'account',
      version: 'account1-v1',
      account: 'account1',
      user: 'user1',
      name: 'User 1',
    });
    userSub.put({
      ...msgCommon(),
      type: 'user',
      version: 'user1-v1',
      user: 'user1',
      account: 'account1',
    });
    userSub.sync();

    // configure the FWReports
    const reportSub = new MockSubscription();
    client.expectSubscribe(reportSub);
    const reports = new FWReports(client, ua, {});
    client.expectDone();

    reportSub.put({
      ...msgCommon(),
      type: 'report',
      project: 'project1',
      report: 'report1',
      version: 'report1v1',
      operation: {
        operation: 'new',
        // script supervisor report
        column_uuids: ['r1c1', 'r1c2', 'r1c3'],
        columns: ['__scene__', '__take__', 'note'],
        row_uuids: ['r1w1'],
        rows: [{ r1c1: '1', r1c2: '1', r1c3: 'bad' }],
      },
      modifies: null,
      reason: null,
      user: 'user1',
    });
    reportSub.put({
      ...msgCommon(),
      type: 'report',
      project: 'project1',
      report: 'report2',
      version: 'report2v1',
      operation: {
        operation: 'new',
        // zoelog report
        column_uuids: ['r2c1', 'r2c2', 'r2c3', 'r2c4', 'r2c5'],
        columns: ['__camera__', '__scene__', '__take__', 'lens', 'note'],
        row_uuids: ['r2w1'],
        rows: [{ r2c1: 'a', r2c2: '1', r2c3: '1', r2c4: '31mm', r2c5: 'meh' }],
      },
      modifies: null,
      reason: null,
      user: 'user1',
    });
    reportSub.put({
      ...msgCommon(),
      type: 'report',
      project: 'project1',
      report: 'report3',
      version: 'report3v1',
      operation: {
        operation: 'new',
        // silverstack report
        column_uuids: ['r3c1', 'r3c2'],
        columns: ['__camera__', '__clip__'],
        row_uuids: ['r3w1'],
        rows: [{ r3c1: 'a', r3c2: 'clipA1' }],
      },
      modifies: null,
      reason: null,
      user: 'user1',
    });
    reportSub.put({
      ...msgCommon(),
      type: 'report',
      project: 'project1',
      report: 'report4',
      version: 'report4v1',
      operation: {
        operation: 'new',
        // dailies report
        column_uuids: ['r4c1', 'r4c2', 'r4c3', 'r4c4'],
        columns: ['__clip__', '__scene__', '__take__', 'note'],
        row_uuids: ['r4w1'],
        rows: [{ r4c1: 'clipA1', r4c2: '1', r4c3: '1', r4c4: 'd1' }],
      },
      modifies: null,
      reason: null,
      user: 'user1',
    });
    reportSub.sync();

    // wait for the reports compiler to get synced
    await new Promise((resolve) => (reports.onSync = resolve));

    // configure the FWJoinedTable
    const jt = new FWJoinedTable(reports);

    const extract = (jrs: FWJoinedRow[]) => {
      // we don't care to check serial numbers, only cells
      return jrs.map((jr) => jr.cells);
    };

    // check the result
    {
      const result = jt.observable.get();
      expect(result.episodeList).toStrictEqual(['']);

      const episode = result.episodes[''];
      expect(episode.noScene).toStrictEqual([]);
      expect(episode.sceneList).toStrictEqual(['1']);

      const scene = episode.scenes['1'];
      expect(scene.noTake).toStrictEqual([]);
      expect(scene.takeList).toStrictEqual(['1']);
      expect(extract(scene.takes[1])).toStrictEqual([
        {
          __camera__: { r2w1: 'a', r3w1: 'a' },
          __scene__: { r2w1: '1', r4w1: '1' },
          __take__: { r2w1: '1', r4w1: '1' },
          __clip__: { r3w1: 'clipA1', r4w1: 'clipA1' },
          lens: { r2w1: '31mm' },
          note: { r2w1: 'meh', r4w1: 'd1' },
        },
        {
          __scene__: { r1w1: '1' },
          __take__: { r1w1: '1' },
          note: { r1w1: 'bad' },
        },
      ]);
    }

    // apply an update to a joining row
    reportSub.put({
      ...msgCommon(),
      type: 'report',
      project: 'project1',
      report: 'report4',
      version: 'report4v2',
      operation: {
        operation: 'update-cell',
        // dailies report; reassign clip to scene 2, take 1
        row: 'r4w1',
        column: 'r4c2',
        text: '2',
      },
      modifies: ['report4v1'],
      reason: 'unit test',
      user: 'user1',
    });

    {
      const result: FWJoinedTableResult = await new Promise((result) =>
        jt.observable.subscribe((x) => result(x)),
      );
      expect(result.episodeList).toStrictEqual(['']);

      const episode = result.episodes[''];
      expect(episode.noScene).toStrictEqual([]);
      expect(episode.sceneList).toStrictEqual(['1', '2']);

      const s1 = episode.scenes['1'];
      expect(s1.noTake).toStrictEqual([]);
      expect(s1.takeList).toStrictEqual(['1']);
      expect(extract(s1.takes[1])).toStrictEqual([
        {
          __camera__: { r2w1: 'a' },
          __scene__: { r2w1: '1' },
          __take__: { r2w1: '1' },
          lens: { r2w1: '31mm' },
          note: { r2w1: 'meh' },
        },
        {
          __scene__: { r1w1: '1' },
          __take__: { r1w1: '1' },
          note: { r1w1: 'bad' },
        },
      ]);

      const s2 = episode.scenes['2'];
      expect(s2.noTake).toStrictEqual([]);
      expect(s2.takeList).toStrictEqual(['1']);
      expect(extract(s2.takes[1])).toStrictEqual([
        {
          __camera__: { r3w1: 'a' },
          __scene__: { r4w1: '2' },
          __take__: { r4w1: '1' },
          __clip__: { r3w1: 'clipA1', r4w1: 'clipA1' },
          note: { r4w1: 'd1' },
        },
      ]);
    }
  }, 100); // 100ms timeout
});
