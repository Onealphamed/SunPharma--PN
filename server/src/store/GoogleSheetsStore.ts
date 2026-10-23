// Google Sheets implementation of TableStore (Sheets API v4, service-account auth).
// All calls are server-side; credentials never reach the browser.
import { GoogleAuth } from 'google-auth-library';
import type { RawTable } from '../../../shared/model';
import { CellOut, CellUpdate, StoreError, TableStore } from './types';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export interface GoogleCredentials {
  client_email: string;
  private_key: string;
  [k: string]: unknown;
}

export function colLetter(index0: number): string {
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const q = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

export class GoogleSheetsStore implements TableStore {
  readonly kind = 'google' as const;
  private auth: GoogleAuth;

  constructor(private spreadsheetId: string, private credentials: GoogleCredentials) {
    this.auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }

  get description() {
    return `Google Sheet …${this.spreadsheetId.slice(-6)}`;
  }

  get serviceAccountEmail() {
    return this.credentials.client_email;
  }

  private async call<T>(opts: { url: string; method?: 'GET' | 'POST' | 'PUT'; params?: Record<string, unknown>; data?: unknown }): Promise<T> {
    const client = await this.auth.getClient();
    let attempt = 0;
    for (;;) {
      try {
        const res = await client.request<T>({ ...opts, method: opts.method ?? 'GET', paramsSerializer: serialise, timeout: 20000 });
        return res.data;
      } catch (e: any) {
        const status: number = e?.response?.status ?? 0;
        const retryable = status === 429 || status >= 500 || status === 0;
        if (retryable && attempt < 3) {
          await new Promise(r => setTimeout(r, 500 * 2 ** attempt + Math.random() * 250));
          attempt++;
          continue;
        }
        const apiMsg = e?.response?.data?.error?.message ?? e?.message ?? 'Unknown error';
        if (status === 403)
          throw new StoreError(`Google Sheets denied access. Share the sheet with ${this.credentials.client_email} as Editor. (${apiMsg})`, 502);
        if (status === 404) throw new StoreError(`Google Sheet not found — check GOOGLE_SHEET_ID. (${apiMsg})`, 502);
        if (status === 429) throw new StoreError('Google Sheets rate limit reached; will retry on the next sync.', 503, true);
        throw new StoreError(`Google Sheets error${status ? ` ${status}` : ''}: ${apiMsg}`, 502, retryable);
      }
    }
  }

  private async tabTitles(): Promise<string[]> {
    const meta = await this.call<{ sheets: { properties: { title: string } }[] }>({
      url: `${API}/${this.spreadsheetId}`,
      params: { fields: 'sheets.properties.title' },
    });
    return meta.sheets.map(s => s.properties.title);
  }

  async readTabs(tabs: string[]): Promise<Record<string, RawTable>> {
    const existing = new Set(await this.tabTitles());
    const wanted = tabs.filter(t => existing.has(t));
    if (!wanted.length) return {};
    const res = await this.call<{ valueRanges: { range: string; values?: unknown[][] }[] }>({
      url: `${API}/${this.spreadsheetId}/values:batchGet`,
      params: {
        ranges: wanted.map(t => q(t)),
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER',
        majorDimension: 'ROWS',
      },
    });
    const out: Record<string, RawTable> = {};
    wanted.forEach((t, i) => {
      const values = res.valueRanges[i]?.values ?? [];
      out[t] = { header: (values[0] ?? []).map(v => String(v ?? '')), rows: values.slice(1) };
    });
    return out;
  }

  async updateCells(tab: string, updates: CellUpdate[]): Promise<void> {
    if (!updates.length) return;
    if (updates.some(u => u.row < 2)) throw new StoreError('Refusing to write to the header row', 400);
    await this.call({
      url: `${API}/${this.spreadsheetId}/values:batchUpdate`,
      method: 'POST',
      data: {
        valueInputOption: 'USER_ENTERED',
        data: updates.map(u => ({ range: `${q(tab)}!${colLetter(u.col)}${u.row}`, values: [[u.value]] })),
      },
    });
  }

  async appendRows(tab: string, rows: CellOut[][]): Promise<void> {
    if (!rows.length) return;
    await this.call({
      url: `${API}/${this.spreadsheetId}/values/${encodeURIComponent(`${q(tab)}!A1`)}:append`,
      method: 'POST',
      params: { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' },
      data: { values: rows },
    });
  }

  async ensureTabs(tabs: { name: string; header: string[] }[]): Promise<string[]> {
    const existing = new Set(await this.tabTitles());
    const missing = tabs.filter(t => !existing.has(t.name));
    if (!missing.length) return [];
    await this.call({
      url: `${API}/${this.spreadsheetId}:batchUpdate`,
      method: 'POST',
      data: { requests: missing.map(t => ({ addSheet: { properties: { title: t.name, gridProperties: { frozenRowCount: 1 } } } })) },
    });
    await this.call({
      url: `${API}/${this.spreadsheetId}/values:batchUpdate`,
      method: 'POST',
      data: { valueInputOption: 'RAW', data: missing.map(t => ({ range: `${q(t.name)}!A1`, values: [t.header] })) },
    });
    return missing.map(t => t.name);
  }
}

function serialise(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(x => sp.append(k, String(x)));
    else if (v !== undefined) sp.append(k, String(v));
  }
  return sp.toString();
}
