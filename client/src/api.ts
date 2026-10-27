import type { Issue, Rec } from '../../shared/model';
import type { Role, TableKey } from '../../shared/schema';

export interface SyncStatus {
  mode: 'google' | 'public-sheet' | 'local';
  /** Source is a view-only Google Sheet link: changes are made in Google Sheets. */
  readOnly: boolean;
  source: string;
  state: 'connecting' | 'ok' | 'error';
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastChangeAt: string | null;
  lastError: string | null;
  intervalSec: number;
  version: number;
  configErrors: string[];
  push: boolean;
  recentErrors: { at: string; kind: 'sync' | 'save'; message: string; user?: string; record?: string }[];
}

export interface BulkItem {
  key: string;
  changes: Record<string, unknown>;
  original: Record<string, unknown>;
}

export interface SessionUser {
  email: string;
  name: string;
  role: Role;
  dev?: boolean;
  /** Anonymous visitor (open access). */
  public?: boolean;
}

export interface Snapshot {
  version: number;
  generatedAt: string;
  today: string;
  user: SessionUser;
  tables: Partial<Record<TableKey, Rec[]>>;
  columns: Partial<Record<TableKey, string[]>>;
  issues?: Issue[];
  sync: SyncStatus;
  /** Link to the source Google Sheet, when it may be shown to this user. */
  sheetUrl: string | null;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: any) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'x-requested-with': 'sunpm', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the dashboard server. Check your connection.');
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details);
  return data as T;
}

export const api = {
  authConfig: () => call<{ devLogin: boolean; mode: string; publicAccess: boolean }>('GET', '/api/auth/config'),
  me: () => call<{ user: SessionUser }>('GET', '/api/auth/me'),
  login: (email: string, password: string) => call<{ user: SessionUser }>('POST', '/api/auth/login', { email, password }),
  devLogin: (role: Role) => call<{ user: SessionUser }>('POST', '/api/auth/dev-login', { role }),
  logout: () => call('POST', '/api/auth/logout', {}),
  snapshot: (fresh = false) => call<Snapshot>('GET', fresh ? '/api/snapshot?fresh=1' : '/api/snapshot'),
  sync: () => call<{ sync: SyncStatus }>('POST', '/api/sync', {}),
  update: (table: TableKey, key: string, changes: Record<string, unknown>, original: Record<string, unknown>) =>
    call<{ ok: boolean; record: Rec; unchanged?: boolean }>('PATCH', `/api/tables/${table}/${encodeURIComponent(key)}`, { changes, original }),
  bulk: (table: TableKey, items: BulkItem[]) => call<{ ok: boolean; updated: number }>('POST', `/api/tables/${table}/bulk`, { items }),
  create: (table: TableKey, values: Record<string, unknown>) => call<{ ok: boolean; id: string; record: Rec }>('POST', `/api/tables/${table}`, { values }),
  archive: (table: TableKey, key: string, original: Record<string, unknown>) =>
    call<{ ok: boolean }>('POST', `/api/tables/${table}/${encodeURIComponent(key)}/archive`, { original }),
  audit: (recordId?: string) => call<{ entries: Rec[] }>('GET', `/api/audit${recordId ? `?recordId=${encodeURIComponent(recordId)}` : ''}`),
  async exportTable(table: TableKey, format: 'xlsx' | 'csv', keys?: string[]) {
    const res = await fetch('/api/export', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-requested-with': 'sunpm', 'content-type': 'application/json' },
      body: JSON.stringify({ table, format, keys }),
    });
    if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.error ?? 'Export failed');
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `export.${format}`;
    downloadBlob(blob, name);
  },
};

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
