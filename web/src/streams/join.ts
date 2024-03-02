import { observable, Observable, WritableObservable } from 'micro-observables';

import { FWReports } from './reports';
import { objectPop, RefreshRecord, setdefault, Uuid, UuidRecord } from './utils';

/*
    Joiner: a small object representing only the joinable columns of a report.

    JoinedIndex: an in-memory index for efficient incremental joins.  It keeps a Joiners for every
    report in a whole project, since correct joining requires that level of global knowledge.

    FWJoinedTable: contains the full joined rows with associated grouping.  It may often focus only
    on a subset of the joiners.
*/

export type Joiner = {
  report: Uuid;
  row: Uuid;
  archived: boolean;
  clip?: string;
  episode?: string;
  scene?: string;
  take?: string;
  camera?: string;
};

export function firstAnswer(joiners: Joiner[], func: (j: Joiner) => string): string {
  let answer = '';
  let sort: string;
  joiners.forEach((j) => {
    const ans = func(j);
    // do we have a value?
    if ((ans ?? '') === '') return;
    // is our value "earlier" (by sorting uuids... dumb, but a repatably random sort)
    if (sort && j.row > sort) return;
    answer = ans;
    sort = j.row;
  });
  return answer;
}

// same logic as firstAnswer but on FWJoinedRow
export function fwFirstAnswer(row: FWJoinedRow, column: string): string {
  let answer = '';
  let sort: string;
  const cells = row.cells[column];
  if (cells)
    Object.entries(cells).forEach(([sourceRow, content]) => {
      if (content === '') return;
      if (sort && sourceRow > sort) return;
      answer = content;
      sort = sourceRow;
    });
  return answer;
}

// take rows and join them into a smaller of rows set by matching up keys
export function joinBy(rows: Joiner[][], func: (j: Joiner) => string): Joiner[][] {
  const out: Joiner[][] = [];
  const temp: Record<string, Joiner[]> = {};
  rows.forEach((joiners) => {
    const key = firstAnswer(joiners, func);
    if (key === '') {
      out.push(joiners);
    } else {
      setdefault(temp, key, []).push(...joiners);
    }
  });
  Object.values(temp).forEach((joiners) => out.push(joiners));
  return out;
}

// take rows and group them by matching values
export function groupBy(rows: Joiner[][], func: (j: Joiner) => string): Record<string, Joiner[][]> {
  const out: Record<string, Joiner[][]> = {};
  rows.forEach((joiners) => {
    const key = firstAnswer(joiners, func);
    setdefault(out, key, []).push(joiners);
  });
  return out;
}

function removeInPlace<T>(list: T[], keepFn: (val: T) => boolean): void {
  for (const i in list) {
    if (keepFn(list[i])) break;
    // overwrite matching element with copy of final element
    list[i] = list[list.length - 1];
    // drop final element
    list.pop();
    // we only remove one
    return;
  }
}

type Episode = {
  scenes: Record<string, Scene>;
  noScene: number[];
};

type Scene = {
  takes: Record<string, number[]>;
  noTake: number[];
};

type RecordKey = string | number;

type SubscriberFn = (updates: number[]) => void;

export class JoinedIndex {
  /* The JoinedIndex contains information about how rows combine, but does not contain the row
     information itself.

     Joining Algorithm:
      - join by clip (unique across project)
      - group by episode
      - group by scene
      - group by take
      - join by camera id
  */

  private lastSerial: number = 0;

  // All of the joined rows we know of.
  joined: Record<number, Joiner[]> = {};

  // The hierarchical index of how joined rows are grouped together.
  private episodes: Record<string, Episode> = {};

  // where would I find a given joined row?
  private paths: Record<number, RecordKey[]> = {};

  // which joined row contains a given clip?
  private clips: Record<string, number> = {};

  // which joined row contains a given row?
  private reverse: Record<Uuid, [Joiner, number]> = {};

  private subscribers: SubscriberFn[] = [];

  constructor(joiners: Joiner[]) {
    const rows = joiners.map((j) => [j]);
    const makeJoined = this.makeMakeJoined(this.joined, this.paths, this.clips, this.reverse);
    this.episodes = this.build(rows, makeJoined);
  }

  private nextSerial(): number {
    return ++this.lastSerial;
  }

  /* Create a function which inserts each row as a new serialized joined row, returning the list of
     serials.  The reason for the second-order function is that you can customize the reverse
     indices that are updated. */
  private makeMakeJoined(
    joined: Record<number, Joiner[]>,
    paths: Record<number, RecordKey[]>,
    clips: Record<string, number>,
    reverse: Record<Uuid, [Joiner, number]>,
  ): (rows: Joiner[][], path: RecordKey[]) => number[] {
    const makeJoined = (rows: Joiner[][], path: RecordKey[]): number[] => {
      return rows.map((row: Joiner[]): number => {
        const id = this.nextSerial();
        // remember the joined row we created
        joined[id] = row;
        // remember the path for each joined row.
        paths[id] = path;
        row.forEach((j) => {
          // remember the joiner we kept and where it was joined into
          reverse[j.row] = [j, id];
          // remember the joined row containing this clip.
          const clip = j.clip ?? '';
          if (clip !== '') clips[clip] = id;
        });
        return id;
      });
    };
    return makeJoined;
  }

  // build the hierarchical tree from a list of initially unjoined Joiners.
  private build(
    rows: Joiner[][],
    makeJoined: (rows: Joiner[][], path: RecordKey[]) => number[],
  ): Record<string, Episode> {
    const makeTake = (rows: Joiner[][], path: RecordKey[]): number[] => {
      // within take, join by camera
      rows = joinBy(rows, (j) => j.camera ?? '');
      return makeJoined(rows, path);
    };

    const makeScene = (rows: Joiner[][], path: RecordKey[]): Scene => {
      // within scene, group by take
      const takes = groupBy(rows, (j) => j.take ?? '');
      const noTake = takes[''] ?? [];
      delete takes[''];
      return {
        takes: Object.fromEntries(
          Object.entries(takes).map(([take, rows]) => [take, makeTake(rows, [...path, take])]),
        ),
        noTake: makeJoined(noTake, path),
      };
    };

    const makeEpisode = (rows: Joiner[][], path: RecordKey[]): Episode => {
      // within episode, group by scene
      const scenes = groupBy(rows, (j) => j.scene ?? '');
      const noScene = scenes[''] ?? [];
      delete scenes[''];
      return {
        scenes: Object.fromEntries(
          Object.entries(scenes).map(([scene, rows]) => [scene, makeScene(rows, [...path, scene])]),
        ),
        noScene: makeJoined(noScene, path),
      };
    };

    // join rows based on clip
    rows = joinBy(rows, (j) => j.clip ?? '');

    // group by episode
    const episodes = groupBy(rows, (j) => j.episode ?? '');

    return Object.fromEntries(
      Object.entries(episodes).map(([episode, rows]) => [episode, makeEpisode(rows, [episode])]),
    );
  }

  private rebuild(toPlace: Joiner[], joinedUpdates: Record<number, true>): void {
    // build a separate, nonoverlapping tree of joiners; if we find overlap, include it and retry
    while (true) {
      const rows = toPlace.map((j) => [j]);
      const joined: Record<number, Joiner[]> = {};
      const paths: Record<number, RecordKey[]> = {};
      const clips: Record<string, number> = {};
      const reverse: Record<Uuid, [Joiner, number]> = {};
      const makeJoined = this.makeMakeJoined(joined, paths, clips, reverse);
      const episodes = this.build(rows, makeJoined);

      let ok = true;

      const checkTake = (take: number[], realTake: number[]) => {
        // make sure that join-by-camera-id would not cause overlap
        const realTakeCameras: Record<string, number> = {};
        realTake.forEach((n) => {
          const camera = firstAnswer(this.joined[n], (j) => j.camera ?? '');
          if (camera) realTakeCameras[camera] = n;
        });
        take.forEach((n) => {
          const camera = firstAnswer(joined[n], (j) => j.camera ?? '');
          if (!camera) return;
          const overlapN = realTakeCameras[camera];
          if (!overlapN) return;
          // overlap detected! remove this joined row from the tree to rejoin and reinsert it
          removeInPlace(realTake, (n) => n === overlapN);
          // remove from paths
          delete this.paths[overlapN];
          // remove from joined, and remember to put them back
          const removed = objectPop(this.joined, overlapN);
          toPlace.push(...removed!);
          // we'll need to try again
          ok = false;
          /* note: clips and reverse will be updated when we put everything back into the tree,
             since we are not actually deleting any of the Joiners we are removing at this point */
        });
      };

      const checkScene = (scene: Scene, realScene: Scene) => {
        // ignore takeless rows, which have no grouping or joins
        Object.entries(scene.takes).forEach(([key, take]) => {
          const realTake = realScene.takes[key];
          if (realTake) checkTake(take, realTake);
        });
      };

      const checkEpisode = (episode: Episode, realEpisode: Episode) => {
        // ignore sceneless rows, which have no grouping or joins
        Object.entries(episode.scenes).forEach(([key, scene]) => {
          const realScene = realEpisode.scenes[key];
          if (realScene) checkScene(scene, realScene);
        });
      };

      // check for overlap
      Object.entries(episodes).forEach(([key, episode]) => {
        const realEpisode = this.episodes[key];
        if (realEpisode) checkEpisode(episode, realEpisode);
      });

      if (!ok) continue;

      // ok, we've extracted our non-overlapping updated tree, now we can merge it

      const mergeList = (list: number[], realList: number[] | undefined): number[] => {
        if (!realList) return list;
        if (list.length === 0) return realList;
        return [...realList, ...list];
      };

      const mergeScene = (scene: Scene, realScene: Scene) => {
        if (!realScene) return scene;
        Object.entries(scene.takes).forEach(([key, take]) => {
          const realTake = realScene.takes[key];
          realScene.takes[key] = mergeList(take, realTake);
        });
        realScene.noTake = mergeList(scene.noTake, realScene.noTake);
        return realScene;
      };

      const mergeEpisode = (episode: Episode, realEpisode: Episode) => {
        if (!realEpisode) return episode;
        Object.entries(episode.scenes).forEach(([key, scene]) => {
          const realScene = realEpisode.scenes[key];
          realEpisode.scenes[key] = mergeScene(scene, realScene);
        });
        realEpisode.noScene = mergeList(episode.noScene, realEpisode.noScene);
        return realEpisode;
      };

      Object.entries(episodes).forEach(([key, episode]) => {
        const realEpisode = this.episodes[key];
        this.episodes[key] = mergeEpisode(episode, realEpisode);
      });

      // also update the various lookup tables
      Object.entries(joined).forEach(([nstr, joiners]) => {
        const n = Number(nstr);
        joinedUpdates[n] = true;
        this.joined[n] = joiners;
        joiners.forEach((j) => {
          this.reverse[j.row] = [j, n];
          const clip = j.clip ?? '';
          if (clip !== '') this.clips[clip] = n;
        });
      });
      Object.entries(paths).forEach(([n, path]) => (this.paths[Number(n)] = path));

      break;
    }
  }

  private dropPath(path: RecordKey[], tgt: number): void {
    if (path.length === 0) return;
    const episode = this.episodes[path[0]];
    if (path.length === 1) {
      episode.noScene = episode.noScene.filter((n) => n !== tgt);
      return;
    }
    const scene = episode.scenes[path[1]];
    if (path.length === 2) {
      scene.noTake = scene.noTake.filter((n) => n !== tgt);
      return;
    }
    scene.takes[path[2]] = scene.takes[path[2]].filter((n) => n !== tgt);
  }

  update(changes: Joiner[]): void {
    const toPlace: UuidRecord<Joiner> = {};
    const joinedUpdates: Record<number, true> = {};

    /* for every old Joiner, remove every corresponding joined row from the tree, except in the
       special case that the old Joiner and the new Joiner are identical */
    changes.forEach((j) => {
      // pop from reverse
      const old = this.reverse[j.row];

      if (
        old &&
        !j.archived &&
        old[0].clip === j.clip &&
        old[0].episode === j.episode &&
        old[0].scene === j.scene &&
        old[0].take === j.take &&
        old[0].camera === j.camera
      ) {
        // no change to joiner at all, just a content change
        const serial = old[1];
        joinedUpdates[serial] = true;
        return;
      }

      if (old) {
        const serial = old[1];
        // delete from joined
        const joined = objectPop(this.joined, serial);
        if (!joined) {
          // already removed this row for other reasons
          return;
        }

        // delete from paths
        const path = objectPop(this.paths, serial);

        // delete from clips
        joined.forEach((j) => {
          if ((j.clip ?? '') !== '') delete this.clips[j.clip ?? ''];
        });

        // everything in joined goes into toPlace
        joined.forEach((j) => (toPlace[j.row] = j));

        // also remove from main hierarchical index
        this.dropPath(path!, serial);

        joinedUpdates[serial] = true;

        /* note that we don't delete from reverse here; that is done on a per-Joiner basis.  Joiners
           which are not deleted will be put back in the tree and their entry in reverse is updated
           after remerging them in. */
      }

      if (j.archived) {
        // we're deleting a Joiner; make sure we don't put the old Joiner back in
        delete toPlace[j.row];
        // also drop from the reverse index
        delete this.reverse[j.row];
      } else {
        // overwrite the old Joiner with the new one
        toPlace[j.row] = j;
      }
    });

    // then rebuild
    this.rebuild(Object.values(toPlace), joinedUpdates);

    if (this.subscribers.length > 0) {
      const list = Object.keys(joinedUpdates).map((s) => Number(s));
      this.subscribers.forEach((fn) => fn(list));
    }
  }

  subscribe(fn: SubscriberFn): () => void {
    this.subscribers.push(fn);
    return () => {
      this.subscribers = this.subscribers.filter((f) => f !== fn);
    };
  }
}

// maps sourceRow to content
export type FWJoinedCell = UuidRecord<string>;

export type FWJoinedRow = {
  serial: number;
  cells: Record<string, FWJoinedCell>;
};

export type FWTake = FWJoinedRow[];

export type FWScene = {
  takeList: string[];
  takes: Record<string, FWTake>;
  noTake: FWJoinedRow[];
};

export type FWEpisode = {
  sceneList: string[];
  scenes: Record<string, FWScene>;
  noScene: FWJoinedRow[];
};

export type FWJoinedTableResult = {
  columns: string[];
  episodeList: string[];
  episodes: Record<string, FWEpisode>;
};

class RefreshScene {
  vtakeList?: true;
  vtakes?: RefreshRecord<true, FWTake>;
  vnoTake?: true;

  private fw: FWScene;

  constructor(fw: FWScene) {
    this.fw = fw;
  }

  takes(): RefreshRecord<true, FWTake> {
    if (!this.vtakes) {
      this.fw.takes = { ...this.fw.takes };
      this.vtakes = new RefreshRecord<true, FWTake>(this.fw.takes, (_: FWTake) => true);
    }
    return this.vtakes;
  }

  takeList(): void {
    if (this.vtakeList) return;
    this.vtakeList = true;
    // we don't actually incrementally modify the take list, so this isn't necessary
    // this.fw.takeList = [...this.fw.takeList];
  }

  noTake(): void {
    if (this.vnoTake) return;
    this.vnoTake = true;
    this.fw.noTake = [...this.fw.noTake];
  }
}

class RefreshEpisode {
  vsceneList?: true;
  vscenes?: RefreshRecord<RefreshScene, FWScene>;
  vnoScene?: true;

  private fw: FWEpisode;

  constructor(fw: FWEpisode) {
    this.fw = fw;
  }

  scenes(): RefreshRecord<RefreshScene, FWScene> {
    if (!this.vscenes) {
      this.fw.scenes = { ...this.fw.scenes };
      this.vscenes = new RefreshRecord<RefreshScene, FWScene>(
        this.fw.scenes,
        (t: FWScene) => new RefreshScene(t),
      );
    }
    return this.vscenes;
  }

  sceneList(): void {
    if (this.vsceneList) return;
    this.vsceneList = true;
    // we don't actually incrementally modify the scene list, so this isn't necessary
    // this.fw.sceneList = [...this.fw.sceneList];
  }

  noScene(): void {
    if (this.vnoScene) return;
    this.vnoScene = true;
    this.fw.noScene = [...this.fw.noScene];
  }
}

class Refresh {
  vepisodeList?: true;
  vepisodes?: RefreshRecord<RefreshEpisode, FWEpisode>;
  vcolumns?: true;

  private fw: FWJoinedTableResult;

  constructor(fw: FWJoinedTableResult) {
    this.fw = fw;
  }

  episodes(): RefreshRecord<RefreshEpisode, FWEpisode> {
    if (!this.vepisodes) {
      this.fw.episodes = { ...this.fw.episodes };
      this.vepisodes = new RefreshRecord<RefreshEpisode, FWEpisode>(
        this.fw.episodes,
        (t: FWEpisode) => new RefreshEpisode(t),
      );
    }
    return this.vepisodes;
  }

  episodeList(): void {
    if (this.vepisodeList) return;
    this.vepisodeList = true;
    this.fw.episodeList = [...this.fw.episodeList];
  }

  columns(): void {
    this.vcolumns = true;
  }
}

// helper functions for FWJoinedTable.processRow //

function replaceRow(list: FWJoinedRow[], row: FWJoinedRow): void {
  const serial = row.serial;
  for (let i = 0; i < list.length; i++) {
    if (list[i].serial === serial) {
      list[i] = row;
      return;
    }
  }
}

function deleteRow(list: FWJoinedRow[], row: FWJoinedRow): void {
  const serial = row.serial;
  for (let i = 0; i < list.length; i++) {
    if (list[i].serial === serial) {
      // overwrite matching element with copy of final element
      list[i] = list[list.length - 1];
      // drop original final element
      list.pop();
      return;
    }
  }
}

function appendRow(list: FWJoinedRow[], row: FWJoinedRow): void {
  list.push(row);
}

// helper functions for FWJoinedTable.refresh //

function cmpSort(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
}

export function selectorSort<T>(
  rows: T[],
  selector: (row: T) => unknown,
  cmp: (a: unknown, b: unknown) => number = cmpSort,
): T[] {
  return rows
    .map((j: T): [unknown, T] => [selector(j), j])
    .sort((a, b) => cmp(a[0], b[0]))
    .map(([_, j]) => j);
}

export function parseScene(s: string): [number, string, string] {
  // parses "v25a" into [25, "a", "v"]

  // find first digit
  let firstDigit;
  let i = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c >= '0' && c <= '9') {
      firstDigit = i;
      // increment i here to match the behavior of the for loop, if a number came last
      i++;
      break;
    }
  }
  if (firstDigit === undefined) {
    // no digits found!
    return [0, s, ''];
  }

  // find length of numbers
  let nDigits = 1;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c < '0' || c > '9') {
      break;
    }
    nDigits++;
  }
  return [
    // number
    Number(s.substring(firstDigit, firstDigit + nDigits)),
    // suffix
    s.substring(firstDigit + nDigits),
    // prefix
    s.substring(0, firstDigit),
  ];
}

export class FWJoinedTable {
  private reports: FWReports;
  private index: JoinedIndex;
  private unsubscribe: () => void;
  private closed: boolean = false;

  private writable: WritableObservable<FWJoinedTableResult>;
  observable: Observable<FWJoinedTableResult>;

  private result: FWJoinedTableResult;

  // our own copy of the rows
  private rows: Record<number, FWJoinedRow> = {};
  // when count reaches zero it is removed from columns
  private columnCounts: Record<string, number> = {};

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
  }

  constructor(reports: FWReports) {
    if (!reports.index) {
      throw new Error("you can't create an FWJoinedTable before the FWReports.onSync()!");
    }
    this.reports = reports;
    this.index = reports.index;

    // bootstrap an empty result
    this.result = {
      columns: [],
      episodeList: [],
      episodes: {},
    };

    this.writable = observable(this.result);
    this.observable = this.writable.readOnly();

    // call update with the initial rows
    this.update(Object.keys(this.index.joined).map(Number));

    // subscribe to reports.index
    this.unsubscribe = this.index.subscribe((updates: number[]) => this.update(updates));
  }

  private processRow(
    refresh: Refresh,
    row: FWJoinedRow,
    apply: (list: FWJoinedRow[], row: FWJoinedRow) => void,
  ): void {
    // select episode
    const episode = fwFirstAnswer(row, '__episode__');
    const [refrEpisode, fwEpisode] = refresh.episodes().g2(episode, () => {
      refresh.episodeList();
      return { sceneList: [], scenes: {}, noScene: [] };
    });

    // select scene
    const scene = fwFirstAnswer(row, '__scene__');
    if (scene === '') {
      refrEpisode.noScene();
      apply(fwEpisode.noScene, row);
      return;
    }
    const [refrScene, fwScene] = refrEpisode.scenes().g2(scene, () => {
      refrEpisode.sceneList();
      return { takeList: [], takes: {}, noTake: [] };
    });

    // select take
    const take = fwFirstAnswer(row, '__take__');
    if (take === '') {
      refrScene.noTake();
      apply(fwScene.noTake, row);
      return;
    }
    const [_, fwTake] = refrScene.takes().g2(take, () => {
      refrScene.takeList();
      return [];
    });

    apply(fwTake, row);
  }

  private buildFullRows(updates: number[]): Record<number, FWJoinedRow> {
    // get all the joiners which are not deletions
    const updateJoiners: Record<number, Joiner[]> = [];
    updates.forEach((n) => {
      const joiners = this.index.joined[n];
      // skip over deletion updates
      if (!joiners) return;
      updateJoiners[n] = joiners;
    });

    // group by reports
    const reports: UuidRecord<[number, Joiner][]> = {};
    Object.entries(updateJoiners).forEach(([n, joiners]) => {
      joiners.forEach((j) =>
        setdefault<[number, Joiner][]>(reports, j.report, []).push([Number(n), j]),
      );
    });

    // build joined rows from each report
    const out: Record<number, FWJoinedRow> = {};
    Object.entries(reports).forEach(([report, njs]) => {
      const content = this.reports.contents[report];
      const columns = this.reports.readColumns(content);
      njs.forEach(([n, j]) => {
        const fwRow = content.rows[j.row];
        if (fwRow.archived) return;
        Object.entries(fwRow.cells).forEach(([column, cell]) => {
          const name = columns[column];
          // if column was archived, we'll end up not finding the name
          if (!name) return;
          let full = out[n];
          if (!full) {
            full = { serial: n, cells: {} };
            out[n] = full;
          }
          setdefault(full.cells, name, {})[j.row] = cell.text;
        });
      });
    });

    return out;
  }

  private addColumns(row: FWJoinedRow, refresh: Refresh): void {
    Object.keys(row.cells).forEach((column) => {
      const count = this.columnCounts[column];
      if (count === undefined) {
        // add column
        this.columnCounts[column] = 1;
        // configure refresh
        refresh.columns();
      } else {
        // increment existing count
        this.columnCounts[column] = count + 1;
      }
    });
  }

  private dropColumns(row: FWJoinedRow, refresh: Refresh): void {
    Object.keys(row.cells).forEach((column) => {
      const count = this.columnCounts[column];
      if (count === undefined) {
        // this must not occur
        throw new Error(`invalid column count when deleting "${column}"`);
      }
      if (count === 1) {
        // drop the column
        delete this.columnCounts[column];
        // configure refresh
        refresh.columns();
      } else {
        this.columnCounts[column] = count - 1;
      }
    });
  }

  private update(updates: number[]): void {
    this.result = { ...this.result };
    const refresh = new Refresh(this.result);

    // first build all the FWJoinedRows for each new or updated row (leave deletions alone for now)
    const newRows = this.buildFullRows(updates);

    // apply each update
    updates.forEach((n) => {
      // did we have this before?
      const old: FWJoinedRow = this.rows[n];
      // do we have it now?
      const now: Joiner[] = this.index.joined[n];

      if (old && now) {
        // this update is not join-affecting (that's why we have the same serial for old and now)
        const row = newRows[n];
        this.rows[n] = row;
        this.addColumns(row, refresh);
        this.dropColumns(old, refresh);
        this.processRow(refresh, row, replaceRow);
        return;
      }

      if (old) {
        // remove the old
        delete this.rows[n];
        this.dropColumns(old, refresh);
        this.processRow(refresh, old, deleteRow);
      }

      if (now) {
        // insert the new
        const row = newRows[n];
        this.rows[n] = row;
        this.addColumns(row, refresh);
        this.processRow(refresh, row, appendRow);
      }
    });

    this.refresh(refresh);

    // submit to the observable
    this.writable.set(this.result);
  }

  private refreshScene(refrScene: RefreshScene, scene: FWScene): boolean {
    if (refrScene.vtakes) {
      refrScene.vtakes.keys().forEach((key) => {
        const take = scene.takes[key];
        if (take.length === 0) {
          // prune take
          delete scene.takes[key];
          refrScene.takeList();
        } else {
          // resort take by camera id
          scene.takes[key] = selectorSort(scene.takes[key], (jr) =>
            fwFirstAnswer(jr, '__camera__'),
          );
        }
      });
    }

    if (refrScene.vtakeList) {
      // resort takeList
      scene.takeList = Object.keys(scene.takes);
      // normal alphabetical sort
      scene.takeList.sort();
    }

    if (refrScene.vnoTake) {
      // resort noTake... TODO: what is a reasonable sort order?
    }

    // prune scenes with no takes and no scene-level reports.
    return scene.takeList.length === 0 && scene.noTake.length === 0;
  }

  private refreshEpisode(refrEpisode: RefreshEpisode, episode: FWEpisode): boolean {
    if (refrEpisode.vscenes) {
      refrEpisode.vscenes.entries().forEach(([key, refrScene]) => {
        const prune = this.refreshScene(refrScene, episode.scenes[key]);
        if (prune) {
          delete episode.scenes[key];
          refrEpisode.sceneList();
        }
      });
    }

    if (refrEpisode.vsceneList) {
      // sort sceneList
      episode.sceneList = selectorSort(Object.keys(episode.scenes), (s) => parseScene(s));
    }

    if (refrEpisode.vnoScene) {
      // sort noScene... TODO: what is a reasonable sort order?
    }

    // prune episodes with no scenes and no episode-level reports
    return episode.sceneList.length === 0 && episode.noScene.length === 0;
  }

  private refresh(refresh: Refresh): void {
    if (refresh.vepisodes) {
      refresh.vepisodes.entries().forEach(([key, refrEpisode]) => {
        const prune = this.refreshEpisode(refrEpisode, this.result.episodes[key]);
        if (prune) {
          delete this.result.episodes[key];
          refresh.episodeList();
        }
      });
    }

    if (refresh.vepisodeList) {
      // sort episodeList
      this.result.episodeList = selectorSort(
        // TODO: decide on a episode-specific sort mechanism
        Object.keys(this.result.episodes),
        (e) => parseScene(e),
      );
    }

    if (refresh.vcolumns) {
      // create a fresh column list
      this.result.columns = Object.keys(this.columnCounts).sort(cmpColumn);
    }
  }
}

const columnScore: Record<string, number> = {
  __episode__: 1,
  __scene__: 2,
  __take__: 3,
  __camera__: 4,
  __clip__: 5,
};

function cmpColumn(a: string, b: string) {
  const scoreA = columnScore[a] ?? 100;
  const scoreB = columnScore[b] ?? 100;
  if (scoreA !== scoreB) {
    return scoreA < scoreB ? -1 : 1;
  }
  // equality case not needed, since we're sorting an Object.keys()
  return a < b ? -1 : 1;
}
