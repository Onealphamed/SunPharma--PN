// Synchronisation engine. Polls the source (Google Sheet or local file) on a fixed
// interval, keeps the last good snapshot in memory, notifies browsers on change, and
// performs validated, conflict-checked write-back with an audit trail.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { parseDate, todayInZone } from '../../shared/dates';
import { wouldCreateCycle, toGraphTasks } from '../../shared/graph';
import { Issue, mapHeader, norm, parseTable, ParsedTable, Rec, sameValue, splitIds, toCell } from '../../shared/model';
import { buildProject } from '../../shared/project';
import { crossValidate } from '../../shared/quality';
import { canCreate, canEditField, ColumnSpec, isInternalRole, Role, TABLES, TABLE_KEYS, TableKey, Value } from '../../shared/schema';
import { StatusMap } from '../../shared/status';
import type { SessionUser } from './auth';
import { canReadTable, projectRecord, projectTables, visibleColumns } from './permissions';
import { CellUpdate, StoreError, TableStore } from './store/types';

export interface SyncError {
  at: string;
  kind: 'sync' | 'save';
  message: string;
  user?: string;
  record?: string;
}

export interface SyncStatus {
  mode: 'google' | 'local';
  source: string;
  state: 'connecting' | 'ok' | 'error';
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastChangeAt: string | null;
  lastError: string | null;
  intervalSec: number;
  version: number;
  configErrors: string[];
  /** False on serverless hosts (Vercel): browsers poll instead of holding a push connection. */
  push: boolean;
  /** Most recent failed syncs and saves (internal users only). */
  recentErrors: SyncError[];
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

const AUDITED: TableKey[] = ['deliverables', 'raid', 'decisions', 'meetings', 'actions', 'comments', 'settings', 'statuses', 'holidays', 'phases'];
const MAX_TEXT = 20000;
const MAX_ERRORS = 50;
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export interface BulkItem {
  key: string;
  changes: Record<string, unknown>;
  original: Record<string, unknown>;
}

export class DataService extends EventEmitter {
  parsed: Partial<Record<TableKey, ParsedTable>> = {};
  records: Partial<Record<TableKey, Rec[]>> = {};
  issues: Issue[] = [];
  status: SyncStatus;
  private hash = '';
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<unknown> = Promise.resolve();
  private syncing: Promise<void> | null = null;

  constructor(
    private store: TableStore,
    private opts: { intervalSec: number; timeZone: string; configErrors?: string[]; serverless?: boolean },
  ) {
    super();
    this.setMaxListeners(500); // two per open browser tab (SSE)
    this.status = {
      mode: store.kind,
      source: store.description,
      state: 'connecting',
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastChangeAt: null,
      lastError: null,
      intervalSec: opts.intervalSec,
      version: 0,
      configErrors: opts.configErrors ?? [],
      push: !opts.serverless,
      recentErrors: [],
    };
  }

  start() {
    void this.sync('startup');
    this.timer = setInterval(() => void this.sync('poll'), this.opts.intervalSec * 1000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Serverless hosts have no background timer: each request refreshes the cache when it is
   * older than the sync interval, so data is never staler than the interval while in use.
   */
  async ensureFresh() {
    const last = this.status.lastAttemptAt ? Date.parse(this.status.lastAttemptAt) : 0;
    if (!last || Date.now() - last >= this.opts.intervalSec * 1000) await this.sync('poll');
  }

  today() {
    return todayInZone(this.opts.timeZone);
  }

  logError(e: Omit<SyncError, 'at'>) {
    this.status.recentErrors = [{ at: nowIso(), ...e }, ...this.status.recentErrors].slice(0, MAX_ERRORS);
  }

  /** Pull every tab; if anything changed, re-parse, audit sheet-side edits and notify. */
  sync(reason: string): Promise<void> {
    // A write must be followed by a read that starts after it, never by an in-flight older poll.
    if (this.syncing && reason === 'write') return this.syncing.then(() => this.sync(reason));
    if (this.syncing) return this.syncing;
    this.syncing = this.doSync(reason).finally(() => (this.syncing = null));
    return this.syncing;
  }

  private async doSync(reason: string) {
    this.status.lastAttemptAt = nowIso();
    try {
      const raw = await this.store.readTabs(TABLE_KEYS.map(k => TABLES[k].tab));
      const hash = crypto.createHash('sha1').update(JSON.stringify(raw)).digest('hex');
      const wasError = this.status.state !== 'ok';
      this.status.state = 'ok';
      this.status.lastError = null;
      this.status.lastSuccessAt = nowIso();
      if (hash !== this.hash) {
        const prev = this.records;
        const parsed: Partial<Record<TableKey, ParsedTable>> = {};
        for (const k of TABLE_KEYS) parsed[k] = parseTable(k, raw[TABLES[k].tab]);
        const records: Partial<Record<TableKey, Rec[]>> = {};
        for (const k of TABLE_KEYS) records[k] = parsed[k]!.records;
        const project = buildProject(records, this.today());
        const cross = crossValidate(project);
        // A blank required field reported by a more specific cross-check is listed once.
        const specific = new Set(cross.map(i => `${i.table}|${i.recordId}|${i.field}`));
        const issues = [
          ...TABLE_KEYS.flatMap(k => parsed[k]!.issues.filter(i => !(k === 'audit' && (i.code === 'missing-id' || i.code === 'duplicate-id')) && !(i.code === 'required-blank' && specific.has(`${i.table}|${i.recordId}|${i.field}`)))),
          ...cross,
        ];
        // Sheet-edit auditing needs one long-lived process; serverless instances would log duplicates.
        const external = this.hash && reason !== 'write' && !this.opts.serverless ? this.diff(prev, records) : [];
        issues.push(...this.bulkRemovalIssues(prev, records));
        this.parsed = parsed;
        this.records = records;
        this.issues = issues;
        this.hash = hash;
        this.status.version++;
        this.status.lastChangeAt = nowIso();
        if (external.length) await this.appendAudit(external).catch(() => undefined);
        this.emit('change', this.status);
      } else if (wasError) {
        this.emit('change', this.status);
      }
      this.emit('synced', this.status);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const changed = this.status.state !== 'error' || this.status.lastError !== msg;
      this.status.state = 'error';
      this.status.lastError = msg;
      if (changed) {
        this.logError({ kind: 'sync', message: msg });
        this.emit('change', this.status);
      }
    }
  }

  /** Field-level diff between syncs, used to audit edits made directly in the sheet. */
  private diff(prev: Partial<Record<TableKey, Rec[]>>, next: Partial<Record<TableKey, Rec[]>>) {
    const out: Record<string, string>[] = [];
    const sheet = { email: 'Source sheet', name: 'Source sheet', role: 'editor' as Role };
    for (const k of AUDITED) {
      const before = new Map((prev[k] ?? []).map(r => [r._key, r]));
      const after = new Map((next[k] ?? []).map(r => [r._key, r]));
      for (const [key, r] of after) {
        const p = before.get(key);
        if (!p) {
          out.push(this.auditRow(sheet, k, key, 'row added (sheet)', '', '', '', 'Sheet'));
          continue;
        }
        for (const col of TABLES[k].columns) {
          if (col.key === 'lastUpdated' || col.key === 'updatedBy') continue;
          if (!sameValue(p[col.key], r[col.key])) out.push(this.auditRow(sheet, k, key, 'edit (sheet)', col.header, p[col.key], r[col.key], 'Sheet'));
        }
      }
      for (const key of before.keys()) if (!after.has(key)) out.push(this.auditRow(sheet, k, key, 'row removed (sheet)', '', '', '', 'Sheet'));
    }
    if (out.length > 200) return [this.auditRow(sheet, 'deliverables', '*', 'bulk change (sheet)', '', '', `${out.length} field changes detected in one sync`, 'Sheet')];
    return out;
  }

  private bulkRemovalIssues(prev: Partial<Record<TableKey, Rec[]>>, next: Partial<Record<TableKey, Rec[]>>): Issue[] {
    const out: Issue[] = [];
    for (const k of AUDITED) {
      const a = prev[k]?.length ?? 0;
      const b = next[k]?.length ?? 0;
      if (a >= 5 && a - b >= Math.max(3, Math.ceil(a * 0.2)))
        out.push({ severity: 'error', code: 'bulk-removal', table: k, message: `${a - b} of ${a} rows disappeared from "${TABLES[k].tab}" since the previous sync. Nothing was deleted by the dashboard; if unintended, restore them from the Google Sheet version history (File → Version history).` });
    }
    return out;
  }

  // ---------------------------------------------------------------- reads

  snapshot(user: SessionUser) {
    const internal = isInternalRole(user.role);
    const { audit: _audit, ...rest } = this.records;
    const tables = projectTables(user.role, rest);
    const columns: Partial<Record<TableKey, string[]>> = {};
    for (const k of TABLE_KEYS) {
      if (!canReadTable(user.role, k)) continue;
      const visible = new Set(visibleColumns(user.role, k));
      columns[k] = Object.keys(this.parsed[k]?.columnIndex ?? {}).filter(c => visible.has(c));
    }
    return {
      version: this.status.version,
      generatedAt: nowIso(),
      today: this.today(),
      user,
      tables,
      columns,
      issues: internal ? this.issues : undefined,
      sync: internal
        ? this.status
        : { ...this.status, source: this.status.mode === 'google' ? 'Google Sheet' : 'Local data', configErrors: [], recentErrors: [], lastError: this.status.lastError ? 'Live source temporarily unavailable' : null },
    };
  }

  auditFor(recordId?: string, limit = 200) {
    const rows = (this.records.audit ?? []).filter(r => !recordId || r.recordId === recordId);
    return rows.slice(-limit).reverse();
  }

  // ---------------------------------------------------------------- writes

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writing.then(fn, fn);
    this.writing = run.catch(() => undefined);
    return run;
  }

  private statuses() {
    return StatusMap.fromRecords(this.records.statuses);
  }

  /** Normalise and validate one incoming value. Returns [value, error]. */
  coerce(col: ColumnSpec, v: unknown): [Value, string | null] {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      return col.required ? [null, `${col.header} is required`] : [null, null];
    }
    switch (col.type) {
      case 'date': {
        const p = parseDate(v);
        return p.iso ? [p.iso, null] : [null, `${col.header}: "${v}" is not a valid date`];
      }
      case 'number': {
        const n = Number(v);
        return isFinite(n) && n >= 0 ? [n, null] : [null, `${col.header} must be a non-negative number`];
      }
      case 'enum': {
        if (col.optionsFrom === 'statuses') {
          const def = this.statuses().get(v);
          return def?.active ? [def.status, null] : [null, `${col.header}: "${v}" is not an allowed value (${this.statuses().activeNames().join(', ')})`];
        }
        const opts = col.options ?? [];
        const hit = opts.find(o => norm(o) === norm(v));
        return hit ? [hit, null] : [null, `${col.header}: "${v}" is not an allowed value (${opts.join(', ')})`];
      }
      case 'idlist':
        return [splitIds(String(v)).join(', ') || null, null];
      default: {
        const s = String(v);
        return s.length > MAX_TEXT ? [null, `${col.header} is too long`] : [s.trim(), null];
      }
    }
  }

  private crossChecks(table: TableKey, next: Rec, key: string | null): string[] {
    const errors: string[] = [];
    const lt = (a: Value | undefined, b: Value | undefined) => typeof a === 'string' && typeof b === 'string' && a < b;
    const known = (id: string) => (this.records.deliverables ?? []).some(r => r._key === id);
    if (table === 'deliverables') {
      if (lt(next.plannedEnd, next.plannedStart)) errors.push('Planned End Date cannot be earlier than Planned Start Date');
      if (lt(next.baselineEnd, next.baselineStart)) errors.push('Baseline End cannot be earlier than Baseline Start');
      if (lt(next.actualEnd, next.actualStart)) errors.push('Actual Completion Date cannot be earlier than Actual Start Date');
      const preds = splitIds(next.predecessors as string);
      if (preds.length) {
        const all = this.records.deliverables ?? [];
        const unknown = preds.filter(p => !known(p));
        if (unknown.length) errors.push(`Unknown dependency ID(s): ${unknown.join(', ')}`);
        const id = key ?? String(next.id);
        if (preds.includes(id)) errors.push('A deliverable cannot depend on itself');
        const tasks = toGraphTasks(all.map(r => ({ id: r._key, start: null, end: null, predecessors: r.predecessors as string, complete: false })));
        if (!tasks.some(t => t.id === id)) tasks.push({ id, start: null, end: null, predecessors: [], complete: false });
        const cyc = wouldCreateCycle(tasks, id, preds);
        if (cyc) errors.push(`Circular dependency: ${[...cyc, cyc[0]].join(' → ')}`);
      }
    }
    if (table === 'actions' && next.related && !known(String(next.related))) errors.push(`Linked deliverable "${next.related}" does not exist`);
    if (table === 'comments' && next.deliverableId && !known(String(next.deliverableId))) errors.push(`Deliverable "${next.deliverableId}" does not exist`);
    if (table === 'raid' || table === 'decisions') {
      const unknown = splitIds(next.related as string).filter(r => !known(r));
      if (unknown.length) errors.push(`Unknown deliverable ID(s): ${unknown.join(', ')}`);
    }
    return errors;
  }

  private checkFields(user: SessionUser, table: TableKey, fields: string[]) {
    const spec = TABLES[table];
    if (!fields.length) throw new HttpError(400, 'No changes supplied');
    for (const f of fields) {
      const col = spec.columns.find(c => c.key === f);
      if (!col) throw new HttpError(400, `Unknown field "${f}"`);
      if (!canEditField(user.role, table, f)) throw new HttpError(403, `You cannot edit ${col.header}`);
    }
  }

  /**
   * Validate one record's changes against the freshly read sheet and return the cells to
   * write. Throws HttpError on any problem so nothing is written for an invalid record.
   */
  private prepare(user: SessionUser, table: TableKey, parsed: ParsedTable, key: string, changes: Record<string, unknown>, original: Record<string, unknown>, stamp: string) {
    const spec = TABLES[table];
    const fields = Object.keys(changes);
    const rec = parsed.records.find(r => r._key === key);
    if (!rec) throw new HttpError(404, `Record ${key} not found — it may have been removed or its ID changed in the sheet. Refresh and try again.`);
    if (rec._readonly) throw new HttpError(409, `${key} cannot be edited from the dashboard: ${rec._readonly}. Fix it in the sheet.`);
    const missing = fields.filter(f => parsed.columnIndex[f] === undefined);
    if (missing.length) throw new HttpError(409, `Column(s) missing in the sheet: ${missing.map(m => spec.columns.find(c => c.key === m)!.header).join(', ')}`);

    // Optimistic concurrency: every field being edited must still hold the value the user started from.
    const conflicts = fields
      .filter(f => f in original && !sameValue(rec[f], original[f] as Value))
      .map(f => ({ record: key, field: f, header: spec.columns.find(c => c.key === f)!.header, current: rec[f], original: original[f], yours: changes[f] }));
    if (conflicts.length) throw new HttpError(409, 'Someone else changed this record since you opened it. Review the latest values and re-apply your change.', { conflicts });

    const next: Rec = { ...rec };
    const errors: string[] = [];
    for (const f of fields) {
      const [v, err] = this.coerce(spec.columns.find(c => c.key === f)!, changes[f]);
      if (err) errors.push(err);
      next[f] = v;
    }
    // The first time planned dates are saved they become the baseline (system rule, any editor).
    const system: string[] = [];
    if (table === 'deliverables') {
      for (const [planned, baseline] of [['plannedStart', 'baselineStart'], ['plannedEnd', 'baselineEnd']] as const) {
        if (fields.includes(planned) && !fields.includes(baseline) && next[planned] && !rec[baseline] && parsed.columnIndex[baseline] !== undefined) {
          next[baseline] = next[planned];
          system.push(baseline);
        }
      }
    }
    errors.push(...this.crossChecks(table, next, key));
    if (errors.length) throw new HttpError(400, `${key}: ${errors[0]}`, { errors, record: key });

    const changed = [...fields.filter(f => !sameValue(rec[f], next[f])), ...system];
    if (!changed.length) return { rec, next, changed, cells: [] as CellUpdate[] };
    if (parsed.columnIndex.lastUpdated !== undefined) next.lastUpdated = stamp;
    if (parsed.columnIndex.updatedBy !== undefined) next.updatedBy = user.name;
    const cells: CellUpdate[] = [...changed, 'lastUpdated', 'updatedBy']
      .filter(f => parsed.columnIndex[f] !== undefined)
      .map(f => ({ row: rec._row, col: parsed.columnIndex[f], value: toCell(spec.columns.find(c => c.key === f)!, next[f]) }));
    return { rec, next, changed, cells };
  }

  async update(user: SessionUser, table: TableKey, key: string, changes: Record<string, unknown>, original: Record<string, unknown>) {
    const spec = TABLES[table];
    if (!spec) throw new HttpError(404, 'Unknown table');
    this.checkFields(user, table, Object.keys(changes));
    return this.exclusive(async () => {
      try {
        const fresh = await this.store.readTabs([spec.tab]);
        const parsed = parseTable(table, fresh[spec.tab]);
        if (!parsed.present) throw new HttpError(503, `Tab "${spec.tab}" is missing from the source sheet`);
        const { rec, next, changed, cells } = this.prepare(user, table, parsed, key, changes, original, nowIso());
        if (!changed.length) return { ok: true, unchanged: true, record: projectRecord(user.role, table, rec) };
        await this.store.updateCells(spec.tab, cells);
        await this.appendAudit(changed.map(f => this.auditRow(user, table, key, 'edit', spec.columns.find(c => c.key === f)!.header, rec[f], next[f], 'Dashboard'))).catch(e =>
          console.error('Audit append failed:', e.message),
        );
        await this.sync('write');
        return { ok: true, record: projectRecord(user.role, table, next) };
      } catch (e) {
        this.logError({ kind: 'save', message: (e as Error).message, user: user.name, record: `${spec.label} ${key}` });
        throw e;
      }
    });
  }

  /** Several records in one validated batch: all-or-nothing, one write to the sheet. */
  async bulkUpdate(user: SessionUser, table: TableKey, items: BulkItem[]) {
    const spec = TABLES[table];
    if (!spec) throw new HttpError(404, 'Unknown table');
    if (!items.length) throw new HttpError(400, 'No records supplied');
    if (items.length > 200) throw new HttpError(400, 'At most 200 records per bulk update');
    for (const it of items) this.checkFields(user, table, Object.keys(it.changes ?? {}));
    return this.exclusive(async () => {
      try {
        const fresh = await this.store.readTabs([spec.tab]);
        const parsed = parseTable(table, fresh[spec.tab]);
        if (!parsed.present) throw new HttpError(503, `Tab "${spec.tab}" is missing from the source sheet`);
        const stamp = nowIso();
        const prepared = items.map(it => ({ key: it.key, ...this.prepare(user, table, parsed, it.key, it.changes, it.original ?? {}, stamp) }));
        const cells = prepared.flatMap(p => p.cells);
        if (!cells.length) return { ok: true, updated: 0 };
        await this.store.updateCells(spec.tab, cells);
        await this.appendAudit(prepared.flatMap(p => p.changed.map(f => this.auditRow(user, table, p.key, 'bulk edit', spec.columns.find(c => c.key === f)!.header, p.rec[f], p.next[f], 'Dashboard')))).catch(e =>
          console.error('Audit append failed:', e.message),
        );
        await this.sync('write');
        return { ok: true, updated: prepared.filter(p => p.changed.length).length };
      } catch (e) {
        this.logError({ kind: 'save', message: (e as Error).message, user: user.name, record: `${spec.label} (bulk, ${items.length})` });
        throw e;
      }
    });
  }

  async create(user: SessionUser, table: TableKey, values: Record<string, unknown>) {
    const spec = TABLES[table];
    if (!spec) throw new HttpError(404, 'Unknown table');
    if (!canCreate(user.role, table)) throw new HttpError(403, `You cannot add to ${spec.label}`);
    return this.exclusive(async () => {
      try {
        const fresh = await this.store.readTabs([spec.tab]);
        const parsed = parseTable(table, fresh[spec.tab]);
        if (!parsed.present) throw new HttpError(503, `Tab "${spec.tab}" is missing from the source sheet`);
        const rec: Rec = { _row: 0, _key: '' };
        const errors: string[] = [];
        const defaults = this.defaultsFor(user, table, values, parsed);
        for (const col of spec.columns) {
          if ((col.key === spec.idKey && spec.idPrefix) || col.key === 'lastUpdated' || col.key === 'updatedBy') continue;
          const supplied = col.key in values && canSetOnCreate(user.role, table, col);
          const [v, err] = this.coerce(col, supplied ? values[col.key] : defaults[col.key] ?? null);
          if (err) errors.push(err);
          rec[col.key] = v;
        }
        if (table === 'deliverables' && values.workstream && !rec.wsCode) {
          const match = parsed.records.find(r => norm(r.workstream) === norm(values.workstream) && norm(r.phase) === norm(rec.phase));
          if (match) rec.wsCode = match.wsCode ?? null;
        }
        const id = this.nextId(table, parsed, rec);
        rec[spec.idKey] = id;
        rec._key = id;
        errors.push(...this.crossChecks(table, rec, id));
        if (errors.length) throw new HttpError(400, errors[0], { errors });
        // Never create a duplicate: the ID is checked against the sheet as it is right now.
        if (parsed.records.some(r => r._key === id)) throw new HttpError(409, `ID ${id} already exists`);
        rec.lastUpdated = nowIso();
        rec.updatedBy = user.name;
        const header = fresh[spec.tab].header;
        const row: (string | number)[] = header.map(() => '');
        for (const col of spec.columns) {
          const ci = parsed.columnIndex[col.key];
          if (ci !== undefined) row[ci] = toCell(col, rec[col.key]);
        }
        await this.store.appendRows(spec.tab, [row]);
        await this.appendAudit([this.auditRow(user, table, id, 'create', '', '', String(rec.name ?? rec.title ?? rec.action ?? rec.decision ?? rec.comment ?? ''), 'Dashboard')]).catch(() => undefined);
        await this.sync('write');
        return { ok: true, id, record: projectRecord(user.role, table, rec) };
      } catch (e) {
        this.logError({ kind: 'save', message: (e as Error).message, user: user.name, record: `New ${spec.label}` });
        throw e;
      }
    });
  }

  private defaultsFor(user: SessionUser, table: TableKey, values: Record<string, unknown>, parsed: ParsedTable): Record<string, Value> {
    const d: Record<string, Value> = {};
    const has = (k: string) => values[k] !== undefined && values[k] !== null && values[k] !== '';
    if (table === 'deliverables') {
      d.status = has('oamOwner') || has('sunOwner') ? 'Yet to Start' : 'Yet to Assign';
      d.completionConfirmed = 'No';
      d.clientVisible = 'Yes';
      d.archived = 'No';
      d.keyMilestone = 'No';
      d.baselineStart = (values.plannedStart as Value) ?? null;
      d.baselineEnd = (values.plannedEnd as Value) ?? null;
      const ws = parsed.records.filter(r => norm(r.workstream) === norm(values.workstream) && norm(r.phase) === norm(values.phase));
      if (ws.length) {
        d.wsCode = ws[0].wsCode as Value;
        d.sortOrder = Math.max(...ws.map(r => (typeof r.sortOrder === 'number' ? r.sortOrder : 0))) + 1;
      } else d.sortOrder = Math.max(0, ...parsed.records.map(r => (typeof r.sortOrder === 'number' ? r.sortOrder : 0))) + 10;
      if (norm(values.type) === 'approval gate') d.approvalStatus = 'Not Submitted';
    }
    if (['meetings', 'actions', 'raid', 'decisions', 'comments'].includes(table)) {
      d.visibility = 'Internal';
      d.archived = 'No';
    }
    if (table === 'actions') d.status = 'Open';
    if (table === 'raid') {
      d.status = 'Open';
      d.dateRaised = this.today();
    }
    if (table === 'decisions') d.status = 'Open';
    if (table === 'comments') {
      d.author = user.name;
      d.postedAt = nowIso();
    }
    return d;
  }

  private nextId(table: TableKey, parsed: ParsedTable, rec: Rec): string {
    const spec = TABLES[table];
    const existing = new Set(parsed.records.map(r => String(r[spec.idKey] ?? '')));
    if (!spec.idPrefix) {
      const v = String(rec[spec.idKey] ?? '');
      if (!v) throw new HttpError(400, `${spec.columns.find(c => c.key === spec.idKey)!.header} is required`);
      return v;
    }
    if (table === 'deliverables') {
      const ws = String(rec.wsCode ?? '').trim() || String(rec.phase ?? '').replace(/\D/g, '') + '.0';
      const prefix = `PN-${ws}.`;
      const nums = [...existing].filter(i => i.startsWith(prefix)).map(i => parseInt(i.slice(prefix.length), 10)).filter(n => !isNaN(n));
      let n = (nums.length ? Math.max(...nums) : 0) + 1;
      while (existing.has(`${prefix}${String(n).padStart(2, '0')}`)) n++;
      return `${prefix}${String(n).padStart(2, '0')}`;
    }
    const width = table === 'comments' ? 4 : 3;
    const nums = [...existing].filter(i => i.startsWith(spec.idPrefix)).map(i => parseInt(i.slice(spec.idPrefix.length), 10)).filter(n => !isNaN(n));
    let n = (nums.length ? Math.max(...nums) : 0) + 1;
    while (existing.has(`${spec.idPrefix}${String(n).padStart(width, '0')}`)) n++;
    return `${spec.idPrefix}${String(n).padStart(width, '0')}`;
  }

  async archive(user: SessionUser, table: TableKey, key: string, original: Record<string, unknown>) {
    const spec = TABLES[table];
    if (!spec.archiveKey) throw new HttpError(400, `${spec.label} rows cannot be archived`);
    return this.update(user, table, key, { [spec.archiveKey]: 'Yes' }, original);
  }

  // ---------------------------------------------------------------- audit

  private auditRow(user: Pick<SessionUser, 'email' | 'name' | 'role'>, table: TableKey, recordId: string, action: string, field: string, oldV: unknown, newV: unknown, source: string) {
    const s = (v: unknown) => (v === null || v === undefined ? '' : String(v)).slice(0, 2000);
    return { timestamp: nowIso(), user: user.name || user.email, role: user.role, table: TABLES[table]?.label ?? table, recordId, action, field, oldValue: s(oldV), newValue: s(newV), source };
  }

  private async appendAudit(rows: Record<string, string>[]) {
    if (!rows.length) return;
    const spec = TABLES.audit;
    let header = this.parsed.audit?.present ? null : spec.columns.map(c => c.header);
    if (header) await this.store.ensureTabs([{ name: spec.tab, header }]);
    const fresh = await this.store.readTabs([spec.tab]);
    header = fresh[spec.tab]?.header ?? spec.columns.map(c => c.header);
    const { index } = mapHeader(spec, header);
    const out = rows.map(r => {
      const row: (string | number)[] = header!.map(() => '');
      for (const col of spec.columns) if (index[col.key] !== undefined) row[index[col.key]] = toCell(col, r[col.key] ?? '');
      return row;
    });
    await this.store.appendRows(spec.tab, out);
  }
}

export function storeErrorStatus(e: unknown): number {
  if (e instanceof HttpError) return e.status;
  if (e instanceof StoreError) return e.status;
  return 500;
}

export type { Role };

/** Structural fields (phase/workstream) are admin-only to edit but must be settable when adding a row. */
const CREATE_FIELDS = new Set(['phase', 'workstream', 'wsCode']);
function canSetOnCreate(role: Role, table: TableKey, col: ColumnSpec): boolean {
  if (col.edit === 'none' || !col.edit) return false;
  if (canEditField(role, table, col.key)) return true;
  return col.edit === 'admin' && CREATE_FIELDS.has(col.key) && role === 'editor';
}
