// JSON-file implementation of TableStore for local development and demos. The file
// is re-read on every sync, so editing it by hand simulates an edit in the live sheet.
import fs from 'node:fs';
import path from 'node:path';
import type { RawTable } from '../../../shared/model';
import { CellOut, CellUpdate, StoreError, TableStore } from './types';

interface FileShape {
  tabs: Record<string, { header: string[]; rows: (string | number | null)[][] }>;
}

export class FileStore implements TableStore {
  readonly kind = 'local' as const;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private file: string) {}

  get description() {
    return `Local file ${path.basename(this.file)}`;
  }

  private load(): FileShape {
    if (!fs.existsSync(this.file)) throw new StoreError(`Local data file not found: ${this.file}. Run "npm run migrate" first.`, 503);
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as FileShape;
    } catch (e) {
      throw new StoreError(`Local data file is not valid JSON: ${(e as Error).message}`, 503);
    }
  }

  private save(data: FileShape) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, this.file);
  }

  /** Serialise writes so concurrent requests cannot interleave read-modify-write. */
  private exclusive<T>(fn: () => T): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async readTabs(tabs: string[]): Promise<Record<string, RawTable>> {
    const data = this.load();
    const out: Record<string, RawTable> = {};
    for (const t of tabs) if (data.tabs[t]) out[t] = { header: data.tabs[t].header, rows: data.tabs[t].rows };
    return out;
  }

  updateCells(tab: string, updates: CellUpdate[]): Promise<void> {
    return this.exclusive(() => {
      const data = this.load();
      const t = data.tabs[tab];
      if (!t) throw new StoreError(`Tab "${tab}" not found`, 404);
      for (const u of updates) {
        const r = u.row - 2;
        if (r < 0) throw new StoreError('Refusing to write to the header row', 400);
        while (t.rows.length <= r) t.rows.push([]);
        const row = t.rows[r];
        while (row.length <= u.col) row.push(null);
        row[u.col] = u.value === '' ? null : typeof u.value === 'string' && u.value.startsWith("'") ? u.value.slice(1) : u.value;
      }
      this.save(data);
    });
  }

  appendRows(tab: string, rows: CellOut[][]): Promise<void> {
    return this.exclusive(() => {
      const data = this.load();
      const t = data.tabs[tab];
      if (!t) throw new StoreError(`Tab "${tab}" not found`, 404);
      for (const r of rows) t.rows.push(r.map(v => (v === '' ? null : typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v)));
      this.save(data);
    });
  }

  ensureTabs(tabs: { name: string; header: string[] }[]): Promise<string[]> {
    return this.exclusive(() => {
      const data = fs.existsSync(this.file) ? this.load() : { tabs: {} };
      const created: string[] = [];
      for (const t of tabs) {
        if (!data.tabs[t.name]) {
          data.tabs[t.name] = { header: t.header, rows: [] };
          created.push(t.name);
        }
      }
      if (created.length) this.save(data);
      return created;
    });
  }
}
