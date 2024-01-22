import { observable, Observable, WritableObservable } from 'micro-observables';

import { FWClient, FWSubscription } from './client';
import { FWUserAccounts } from './compilers';
import { JoinedIndex, Joiner } from './join';
import {
  AdvancerNoFail,
  isBefore2Sort,
  need,
  Needed,
  RecvMsg,
  RecvReport,
  RefreshRecord,
  resolve,
  setdefault,
  Unresolved,
  Uuid,
  UuidRecord,
} from './utils';

type Historical = {
  submissiontime: Date;
  isModified: boolean;
};

type History<T extends Historical> = UuidRecord<T>;

function updateHistory<T extends Historical>(
  hist: History<T>,
  modifies: Uuid[] | null,
  version: Uuid,
  val: T,
): void {
  modifies?.forEach((uuid) => {
    hist[uuid].isModified = true;
  });
  hist[version] = val;
}

// return the automatic resolution, then every unmodified version, sorted for best-first
export function resolveHistory<H extends Historical>(hist: History<H>): [H, Uuid[]] {
  const results = Object.entries(hist)
    .filter(([_, h]) => !h.isModified) // eslint-disable-line @typescript-eslint/no-unused-vars
    .sort((a, b) => -isBefore2Sort(a[1], b[1], 'submissiontime', 'version'));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return [results[0][1], results.map(([v, _]) => v)];
}

// returns just the chosen historical value, not all the versions
export function resolveHistory1<H extends Historical>(hist: History<H>): H {
  return Object.values(hist)
    .filter((h) => !h.isModified)
    .sort((a, b) => -isBefore2Sort(a, b, 'submissiontime', 'version'))[0];
}

// EXPORTABLE //

export type FWReportSummary = {
  uuid: Uuid;
  project: Uuid;
  archived: boolean;
  conflicts: number;

  user: Uuid;
  submissiontime: Date;
  authortime: Date;
  edittime: Date | null;
};

export type FWReportsList = {
  summaries: UuidRecord<FWReportSummary>;
  bySubmit: Uuid[];
};

export type FWColumn = {
  uuid: Uuid;
  archived: boolean;
  name: string;
  hasConflict: boolean;
  versions: Uuid[];
};

export type FWCell = {
  text: string;
  hasConflict: boolean;
  versions: Uuid[];
};

export type FWRow = {
  uuid: Uuid;
  archived: boolean;
  // cells is {column_uuid: FWCell}
  cells: UuidRecord<FWCell>;
  conflicts: number;
};

export type FWReportContent = {
  uuid: Uuid;

  columnList: Uuid[];
  rowList: Uuid[];

  columns: UuidRecord<FWColumn>;
  rows: UuidRecord<FWRow>;
};

// RAW //

type RawText = Historical & {
  text: string;
};

type RawArchived = Historical & {
  archived: boolean;
};

type RawColumn = {
  name: History<RawText>;
  archived: History<RawArchived>;
  default: string;
  submissiontime: Date; // 0 for new report operation
};

type RawCell = History<RawText>;

type RawRow = {
  archived: History<RawArchived>;
  // {column_uuid: cell_history}
  cells: UuidRecord<RawCell>;
  submissiontime: Date; // 0 for new report operation
};

type RawReport = {
  archived: History<RawArchived>;
};

// REFRESH //

class RefreshRow {
  varchived?: true;
  vcells?: RefreshRecord<true, FWCell>;

  private fw: FWRow;

  constructor(fw: FWRow) {
    this.fw = fw;
  }

  archived(): void {
    this.varchived = true;
  }

  cells(): RefreshRecord<true, FWCell> {
    if (!this.vcells) {
      this.fw.cells = { ...this.fw.cells };
      this.vcells = new RefreshRecord<true, FWCell>(this.fw.cells, (_: FWCell) => true);
    }
    return this.vcells;
  }
}

class RefreshColumn {
  varchived?: true;
  vname?: true;

  constructor(_: FWColumn) {
    // leaf node; no need to keep fw
  }

  archived(): void {
    this.varchived = true;
  }

  name(): void {
    this.vname = true;
  }
}

class RefreshContent {
  vcolumnList?: true;
  vrowList?: true;
  vcolumns?: RefreshRecord<RefreshColumn, FWColumn>;
  vrows?: RefreshRecord<RefreshRow, FWRow>;

  private fw: FWReportContent;

  constructor(fw: FWReportContent) {
    this.fw = fw;
  }

  columnList(): void {
    if (this.vcolumnList) return;
    this.vcolumnList = true;
    this.fw.columnList = [...this.fw.columnList];
  }

  rowList(): void {
    if (this.vrowList) return;
    this.vrowList = true;
    this.fw.rowList = [...this.fw.rowList];
  }

  columns(): RefreshRecord<RefreshColumn, FWColumn> {
    if (!this.vcolumns) {
      this.fw.columns = { ...this.fw.columns };
      this.vcolumns = new RefreshRecord<RefreshColumn, FWColumn>(
        this.fw.columns,
        (t: FWColumn) => new RefreshColumn(t),
      );
    }
    return this.vcolumns;
  }

  rows(): RefreshRecord<RefreshRow, FWRow> {
    if (!this.vrows) {
      this.fw.rows = { ...this.fw.rows };
      this.vrows = new RefreshRecord<RefreshRow, FWRow>(
        this.fw.rows,
        (t: FWRow) => new RefreshRow(t),
      );
    }
    return this.vrows;
  }
}

class RefreshSummary {
  varchived?: true;

  constructor(_: FWReportSummary) {
    // leaf node; no need to keep fw
  }

  archived(): void {
    this.varchived = true;
  }
}

class Refresh {
  vcontents?: RefreshRecord<RefreshContent, FWReportContent>;
  vsummaries?: RefreshRecord<RefreshSummary, FWReportSummary>;
  vbySubmit?: boolean;

  private fw: FWReports;

  constructor(fw: FWReports) {
    this.fw = fw;
  }

  contents(): RefreshRecord<RefreshContent, FWReportContent> {
    if (!this.vcontents) {
      this.fw.contents = { ...this.fw.contents };
      this.vcontents = new RefreshRecord<RefreshContent, FWReportContent>(
        this.fw.contents,
        (t: FWReportContent) => new RefreshContent(t),
      );
    }
    return this.vcontents;
  }

  summaries(): RefreshRecord<RefreshSummary, FWReportSummary> {
    if (!this.vsummaries) {
      this.fw.summaries = { ...this.fw.summaries };
      this.vsummaries = new RefreshRecord<RefreshSummary, FWReportSummary>(
        this.fw.summaries,
        (t: FWReportSummary) => new RefreshSummary(t),
      );
    }
    return this.vsummaries;
  }

  bySubmit(): void {
    if (this.vbySubmit) return;
    this.vbySubmit = true;
    this.fw.bySubmit = [...this.fw.bySubmit];
  }
}

export class FWReports {
  reportsList: Observable<FWReportsList>;
  reportContents: UuidRecord<Observable<FWReportContent>>;
  // onSync fires shortly after the observable are populated the first time
  onSync?: { (result: FWReportsList): void };

  // versions: {version_uuid: RecvReport}
  versions: UuidRecord<RecvReport> = {};

  private writableList: WritableObservable<FWReportsList>;
  private writableContents: UuidRecord<WritableObservable<FWReportContent>>;
  private sub: FWSubscription;
  private advancer: AdvancerNoFail;
  private ua: FWUserAccounts;
  private recvd: RecvMsg[] = [];

  // experimental: uuid of versions, rows, columns, or reports that are needed
  private needed: Needed = {};

  // public for FWJoinedTable's sake
  columns: UuidRecord<RawColumn> = {};
  rows: UuidRecord<RawRow> = {};
  private reports: UuidRecord<RawReport> = {};

  // exported objects
  // also public, for refresh's sake
  summaries: UuidRecord<FWReportSummary> = {};
  bySubmit: Uuid[] = [];
  contents: UuidRecord<FWReportContent> = {};

  // index is public for FWJoinedReport's sake
  index?: JoinedIndex;

  private synced: boolean = false;
  private uaSynced: boolean = false;

  private onSyncSent: boolean = false;

  constructor(client: FWClient, ua: FWUserAccounts, spec: object) {
    this.advancer = new AdvancerNoFail(this, this.advance);
    this.sub = client.subscribe({ reports: spec });
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
    this.writableList = observable(undefined);
    this.reportsList = this.writableList.readOnly();
    this.writableContents = {};
    this.reportContents = {};
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

  private processEditTime(msg: RecvReport, report: Uuid, refresh: Refresh) {
    const old = this.summaries[report];
    if (!old.edittime || msg.submissiontime > old.edittime) {
      refresh.summaries().g(report);
      this.summaries[report].edittime = msg.submissiontime;
    }
  }

  private processReport(msg: RecvReport, refresh: Refresh, rowUpdates: UuidRecord<Uuid>): void {
    const report = msg.report;
    const version = msg.version;
    const op = msg.operation;

    // check for duplicates
    if (version in this.versions) return;

    // figure out if this message is resolvable yet
    const unresolved = new Unresolved((arg) => {
      this.recvd.push(msg);
      if (arg) this.advancer.schedule();
    });
    // are we missing a user?
    if (!(msg.user in this.ua.users)) need(msg.user, this.ua.usersNeeded, unresolved, true);
    // are we missing any modified versions?
    msg.modifies?.forEach((old) => {
      if (!(old in this.versions)) need(old, this.needed, unresolved, false);
    });
    // are we missing the initial report upload?
    if (op.operation !== 'new' && !(report in this.reports)) {
      need(report, this.needed, unresolved, false);
    }
    // are we missing any op-specific implicit dependencies?
    switch (op.operation) {
      case 'add-row':
        Object.keys(op.row).forEach((column) => {
          if (!(column in this.columns)) need(column, this.needed, unresolved, false);
        });
        break;
      case 'rename-column':
        if (!(op.uuid in this.columns)) need(op.uuid, this.needed, unresolved, false);
        break;
      case 'update-cell':
        if (!(op.row in this.rows)) need(op.row, this.needed, unresolved, false);
        if (!(op.column in this.columns)) need(op.column, this.needed, unresolved, false);
        break;
      case 'archive-column':
        if (!(op.uuid in this.columns)) need(op.uuid, this.needed, unresolved, false);
        break;
      case 'archive-row':
        if (!(op.uuid in this.rows)) need(op.uuid, this.needed, unresolved, false);
        break;
      // no dependencies:
      case 'new':
      // only depends on report:
      case 'add-column':
      case 'archive-report':
      default:
        break;
    }
    if (!unresolved.isResolved()) return;

    // save this msg
    this.versions[version] = msg;

    // resolve anything that might be dependent: version, report, row, or column
    resolve(version, this.needed);
    switch (op.operation) {
      case 'new':
        resolve(report, this.needed);
        op.column_uuids.forEach((x) => resolve(x, this.needed));
        op.row_uuids.forEach((x) => resolve(x, this.needed));
        break;
      case 'add-column':
        resolve(op.uuid, this.needed);
        break;
      case 'add-row':
        resolve(op.uuid, this.needed);
        break;
      // no new entities
      case 'rename-column':
      case 'update-cell':
      case 'archive-report':
      case 'archive-column':
      case 'archive-row':
      default:
        break;
    }

    this.apply(msg, refresh, rowUpdates);
  }

  private apply(msg: RecvReport, refresh: Refresh, rowUpdates: UuidRecord<Uuid>): void {
    const report = msg.report;
    const version = msg.version;
    const op = msg.operation;

    const historical = {
      submissiontime: msg.submissiontime,
      isModified: false,
    };
    switch (op.operation) {
      case 'new':
        {
          // new objects are never archived
          const notArchived = { ...historical, archived: false };

          // create new columns
          const columns: UuidRecord<FWColumn> = {};
          for (let i = 0; i < op.column_uuids.length; i++) {
            const name = { ...historical, text: op.columns[i] };
            const uuid = op.column_uuids[i];
            // RawColumn
            this.columns[uuid] = {
              archived: { [version]: notArchived },
              name: { [version]: name },
              default: '',
              // TODO: fix dates
              submissiontime: '' as unknown as Date,
            };
            // FWColumn
            columns[uuid] = {
              uuid: uuid,
              archived: false,
              name: op.columns[i],
              hasConflict: false,
              versions: [version],
            };
          }

          // create new rows
          const rows: UuidRecord<FWRow> = {};
          for (let i = 0; i < op.row_uuids.length; i++) {
            const row = op.rows[i];
            const rawCells: UuidRecord<RawCell> = {};
            const cells: UuidRecord<FWCell> = {};
            Object.entries(row).forEach(([col, text]) => {
              // raw cell
              rawCells[col] = { [version]: { ...historical, text: text } };
              // FWCell
              cells[col] = { text: text, hasConflict: false, versions: [version] };
            });
            const uuid = op.row_uuids[i];
            // RawRow
            this.rows[uuid] = {
              archived: { [version]: notArchived },
              cells: rawCells,
              // TODO: fix dates
              submissiontime: '' as unknown as Date,
            };
            // FWRow
            rows[uuid] = {
              uuid: uuid,
              archived: false,
              cells: cells,
              conflicts: 0,
            };
          }

          const content: FWReportContent = {
            uuid: report,
            columnList: op.column_uuids,
            rowList: op.row_uuids,
            rows: rows,
            columns: columns,
          };

          // populate observables
          const obs = observable(content);
          this.writableContents[report] = obs;
          this.reportContents[report] = obs.readOnly();

          // populate toplevel report objects
          this.reports[report] = {
            archived: { [version]: notArchived },
          };

          // create new content
          refresh.contents();
          this.contents[report] = content;
          // make sure every row in this new report is flagged as an update
          op.row_uuids.forEach((uuid) => (rowUpdates[uuid] = report));

          // create new summary
          refresh.summaries();
          this.summaries[report] = {
            // static values
            uuid: report,
            project: msg.project,
            submissiontime: msg.submissiontime,
            authortime: msg.authortime,
            user: msg.user,
            // initial dynamic values
            archived: false,
            conflicts: 0,
            edittime: null,
          };

          // include this report in our sorted list
          refresh.bySubmit();
          this.bySubmit.push(report);
        }
        break;

      case 'add-column':
        {
          // new objects are never archived
          const notArchived = { ...historical, archived: false };

          // create new column
          const name = { ...historical, text: op.name };
          // RawColumn
          this.columns[op.uuid] = {
            archived: { [version]: notArchived },
            name: { [version]: name },
            default: op.default ?? '',
            submissiontime: msg.submissiontime,
          };

          // add a column and update columnList
          const refr = refresh.contents().g(report);
          refr.columns();
          refr.columnList();

          const content = this.contents[report];

          content.columns[op.uuid] = {
            uuid: op.uuid,
            archived: false,
            name: op.name,
            hasConflict: false,
            versions: [version],
          };
          content.columnList.push(op.uuid);

          this.processEditTime(msg, report, refresh);
        }
        break;

      case 'add-row':
        {
          // new objects are never archived
          const notArchived = { ...historical, archived: false };

          // create new row
          const rawCells: UuidRecord<RawCell> = {};
          const cells: UuidRecord<FWCell> = {};
          Object.entries(op.row).forEach(([col, text]) => {
            rawCells[col] = { [version]: { ...historical, text: text } };
            cells[col] = { text: text, hasConflict: false, versions: [version] };
          });
          this.rows[op.uuid] = {
            archived: { [version]: notArchived },
            cells: rawCells,
            submissiontime: msg.submissiontime,
          };

          // add a row and update rowList
          const refr = refresh.contents().g(report);
          refr.rows();
          refr.rowList();

          const content = this.contents[report];

          content.rows[op.uuid] = {
            uuid: op.uuid,
            archived: false,
            cells: cells,
            conflicts: 0,
          };
          content.rowList.push(op.uuid);

          // make sure this new row is flagged as an update
          rowUpdates[op.uuid] = report;

          this.processEditTime(msg, report, refresh);
        }
        break;

      case 'rename-column':
        {
          // do the update
          const hist = this.columns[op.uuid].name;
          const name = { ...historical, text: op.name };
          updateHistory(hist, msg.modifies, version, name);

          this.processEditTime(msg, report, refresh);

          // configure refresh
          refresh.contents().g(report).columns().g(op.uuid).name();
        }
        break;

      case 'update-cell':
        {
          // start with empty history if the add-row didn't populate a field for this column
          const hist = setdefault(this.rows[op.row].cells, op.column, {});
          const text = { ...historical, text: op.text };
          updateHistory(hist, msg.modifies, version, text);

          this.processEditTime(msg, report, refresh);

          // configure refresh
          refresh.contents().g(report).rows().g(op.row).cells().g(op.column);
        }
        break;

      case 'archive-report':
        {
          // do the update
          const archived = { ...historical, archived: op.value };
          const hist = this.reports[report].archived;
          updateHistory(hist, msg.modifies, version, archived);

          this.processEditTime(msg, report, refresh);

          // configure refresh
          refresh.summaries().g(report).archived();
        }
        break;

      case 'archive-column':
        {
          // do the update
          const archived = { ...historical, archived: op.value };
          const hist = this.columns[op.uuid].archived;
          updateHistory(hist, msg.modifies, version, archived);

          this.processEditTime(msg, report, refresh);

          // configure refresh
          refresh.contents().g(report).columns().g(op.uuid).archived();
        }
        break;

      case 'archive-row':
        {
          // do the update
          const archived = { ...historical, archived: op.value };
          const hist = this.rows[op.uuid].archived;
          updateHistory(hist, msg.modifies, version, archived);

          this.processEditTime(msg, report, refresh);

          // configure refresh
          refresh.contents().g(report).rows().g(op.uuid).archived();
        }
        break;

      default:
        throw new Error(`unknown op.operation in ${op}`);
    }
  }

  // returns the delta of conflicts
  private rebuildContent(
    report: Uuid,
    refresh: RefreshContent,
    rowUpdates: UuidRecord<Uuid>,
  ): number {
    const content = this.contents[report];
    let delta = 0;
    let allRowsUpdated = false;

    if (refresh.vcolumnList) {
      content.columnList = content.columnList
        .map((uuid) => ({ uuid: uuid, submissiontime: this.columns[uuid].submissiontime }))
        .sort((a, b) => isBefore2Sort(a, b, 'submissiontime', 'uuid'))
        .map((x) => x.uuid);
      // any column change affects all rows in the report
      allRowsUpdated = true;
    }

    if (refresh.vrowList) {
      content.rowList = content.rowList
        .map((uuid) => ({ uuid: uuid, submissiontime: this.rows[uuid].submissiontime }))
        .sort((a, b) => isBefore2Sort(a, b, 'submissiontime', 'uuid'))
        .map((x) => x.uuid);
    }

    if (refresh.vcolumns) {
      refresh.vcolumns.entries().forEach(([uuid, refr]) => {
        const raw = this.columns[uuid];
        const column = content.columns[uuid];
        if (refr.varchived) column.archived = resolveHistory1(raw.archived).archived;
        if (refr.vname) {
          delta -= column.hasConflict ? 1 : 0;
          const [resolved, versions] = resolveHistory(raw.name);
          column.name = resolved.text;
          column.hasConflict = versions.length > 1;
          column.versions = versions;
          delta += column.hasConflict ? 1 : 0;
        }
      });
      // any column change affects all rows in the report
      allRowsUpdated = true;
    }

    if (allRowsUpdated) {
      content.rowList.forEach((uuid) => (rowUpdates[uuid] = report));
    }

    if (refresh.vrows) {
      refresh.vrows.entries().forEach(([uuid, refr]) => {
        rowUpdates[uuid] = report;
        const raw = this.rows[uuid];
        const row = content.rows[uuid];
        if (refr.varchived) row.archived = resolveHistory1(raw.archived).archived;
        if (refr.vcells) {
          const rawCells = raw.cells;
          const cells = row.cells;
          delta -= row.conflicts;
          refr.vcells.keys().forEach((cellUuid) => {
            const cell = cells[cellUuid];
            row.conflicts -= cell.hasConflict ? 1 : 0;
            const [resolved, versions] = resolveHistory(rawCells[cellUuid]);
            cell.text = resolved.text;
            cell.hasConflict = versions.length > 1;
            cell.versions = versions;
            row.conflicts += cell.hasConflict ? 1 : 0;
          });
          delta += row.conflicts;
        }
      });
    }

    // update the observable
    this.writableContents[report].set(content);

    return delta;
  }

  private advance(): void {
    // wait for initial sync, both our own and the FWUserAccounts.
    if (!this.synced || !this.uaSynced) return;

    // process new messages
    const refresh = new Refresh(this);
    // {row_uuid: report_uuid}
    /* note that this is a useful structure for collecting updates, but we'll need to reshape during
       joiner calculation */
    const rowUpdates: UuidRecord<Uuid> = {};
    let msg;
    while ((msg = this.recvd.shift())) {
      if (msg.type !== 'report') continue;
      this.processReport(msg, refresh, rowUpdates);
    }

    // rebuild content changes
    if (refresh.vcontents) {
      refresh.vcontents.entries().forEach(([report, content]) => {
        const delta = this.rebuildContent(report, content, rowUpdates);
        if (delta !== 0) {
          refresh.summaries().g(report);
          this.summaries[report].conflicts += delta;
        }
      });
    }

    // rebuild summaries
    if (refresh.vsummaries) {
      refresh.vsummaries.entries().forEach(([report, refr]) => {
        const summary = this.summaries[report];
        const raw = this.reports[report];
        if (refr.varchived) summary.archived = resolveHistory1(raw.archived).archived;
        this.summaries[report] = { ...summary };
      });
    }
    if (refresh.vbySubmit) {
      this.bySubmit = this.bySubmit
        .map((uuid) => ({ uuid: uuid, submissiontime: this.summaries[uuid].submissiontime }))
        .sort((a, b) => isBefore2Sort(a, b, 'submissiontime', 'uuid'))
        .map((x) => x.uuid);
    }

    /* note: no need to check refresh.bySubmit; bySubmit is only refreshed when there are new
       summaries, which guarantees that refresh.summaries would already be set */
    if (refresh.vsummaries || !this.onSyncSent) {
      this.writableList.set({
        summaries: this.summaries,
        bySubmit: this.bySubmit,
      });
    }

    // flush changes to the index
    if (!this.index) {
      // first time: index initial build
      this.index = this.indexFirstBuild();
    } else {
      // after first time: index incremental update
      this.indexUpdate(rowUpdates);
    }

    // send the onSync event
    if (!this.onSyncSent) {
      this.onSyncSent = true;
      setTimeout(() => {
        if (!this.advancer.done && this.onSync) {
          this.onSync(this.reportsList.get());
        }
      });
    }
  }

  private indexFirstBuild(): JoinedIndex {
    // create joiners for every row of every report
    const joiners: Joiner[] = [];
    Object.entries(this.contents).forEach(([report, content]) => {
      const summary = this.summaries[report];
      joiners.push(...this.joinersForReport(summary, content, content.rowList));
    });
    return new JoinedIndex(joiners);
  }

  private indexUpdate(rowUpdates: UuidRecord<Uuid>): void {
    // {report_uuid: row_uuids[]}
    const rowsByReport: UuidRecord<Uuid[]> = {};
    // reshape rowUpdates from incremental-friendly shape to report-then-rows shape.
    Object.entries(rowUpdates).forEach(([row, report]) =>
      setdefault<string[]>(rowsByReport, report, []).push(row),
    );
    const joiners: Joiner[] = [];
    // process each report
    Object.entries(rowsByReport).forEach(([report, rows]) => {
      const summary = this.summaries[report];
      const content = this.contents[report];
      joiners.push(...this.joinersForReport(summary, content, rows));
    });
    // pass updated joiners to the index
    this.index!.update(joiners);
  }

  private joinersForReport(
    summary: FWReportSummary,
    content: FWReportContent,
    rows: Uuid[],
  ): Joiner[] {
    const report = summary.uuid;
    const archived = summary.archived;
    // {column_name: column_uuid}
    const cols = this.readColumnsReverse(content);
    const colClip = cols['__clip__'];
    const colEpisode = cols['__episode__'];
    const colScene = cols['__scene__'];
    const colTake = cols['__take__'];
    const colCamera = cols['__camera__'];
    const joiners: Joiner[] = [];
    rows.forEach((row) => {
      const fw = content.rows[row];
      const cells = fw.cells;
      const j: Joiner = {
        report: report,
        row: row,
        archived: archived || fw.archived,
      };
      const valClip = colClip && cells[colClip]?.text;
      const valEpisode = colEpisode && cells[colEpisode]?.text;
      const valScene = colScene && cells[colScene]?.text;
      const valTake = colTake && cells[colTake]?.text;
      const valCamera = colCamera && cells[colCamera]?.text;
      if (valClip) j.clip = valClip;
      if (valEpisode) j.episode = valEpisode;
      if (valScene) j.scene = valScene;
      if (valTake) j.take = valTake;
      if (valCamera) j.camera = valCamera;
      joiners.push(j);
    });
    return joiners;
  }

  readColumns(content: FWReportContent): Record<Uuid, string> {
    // read columns in order, prefering the first
    // {column_uuid, column_name}
    const output: Record<Uuid, string> = {};
    content.columnList.forEach((column) => {
      const fw = content.columns[column];
      if (fw.archived) return;
      if (fw.name in output) return;
      output[column] = fw.name;
    });
    return output;
  }

  private readColumnsReverse(content: FWReportContent): Record<string, Uuid> {
    // read columns in order, prefering the first
    // {column_name, column_uuid}
    const output: Record<string, Uuid> = {};
    content.columnList.forEach((column) => {
      const fw = content.columns[column];
      if (fw.archived) return;
      if (fw.name in output) return;
      output[fw.name] = column;
    });
    return output;
  }

  close(): void {
    this.advancer.done = true;
    this.sub.close();
  }
}
