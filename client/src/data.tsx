// Single client-side data store. Every page reads the same snapshot and the same
// derived project model, so all sections stay consistent with each other.
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Rec } from '../../shared/model';
import { buildProject, Project } from '../../shared/project';
import { isInternalRole, TableKey } from '../../shared/schema';
import { api, ApiError, BulkItem, SessionUser, Snapshot } from './api';

export type Link = 'live' | 'polling' | 'offline';

interface Toast {
  id: number;
  tone: 'ok' | 'error' | 'info';
  text: string;
}

export interface FailedSave {
  at: Date;
  what: string;
  message: string;
}

interface DataCtx {
  /**
   * The user as far as editing is concerned: when the source is a view-only sheet link,
   * everyone is read-only (role "client"), so no edit control is shown.
   */
  user: SessionUser;
  /** The signed-in account (or visitor), for display. */
  account: SessionUser;
  /** Team member: sees internal data and pages. */
  internal: boolean;
  /** Changes are made in Google Sheets, not in the dashboard. */
  readOnly: boolean;
  snap: Snapshot;
  project: Project;
  link: Link;
  /** A refresh or save is in flight. */
  syncing: boolean;
  lastFetched: Date;
  failures: FailedSave[];
  asOf: string | null;
  setAsOf: (d: string | null) => void;
  refresh: (force?: boolean, fresh?: boolean) => Promise<void>;
  update: (table: TableKey, rec: Rec, changes: Record<string, unknown>) => Promise<void>;
  bulkUpdate: (table: TableKey, recs: Rec[], changes: Record<string, unknown>) => Promise<number>;
  create: (table: TableKey, values: Record<string, unknown>) => Promise<string>;
  archive: (table: TableKey, rec: Rec) => Promise<void>;
  toast: (text: string, tone?: Toast['tone']) => void;
  canEditCol: (table: TableKey, key: string) => boolean;
}

const Ctx = createContext<DataCtx | null>(null);
export const useData = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useData outside provider');
  return c;
};

export function DataProvider({ initial, children, onSignedOut }: { initial: Snapshot; children: ReactNode; onSignedOut: () => void }) {
  const [snap, setSnap] = useState(initial);
  const [link, setLink] = useState<Link>('polling');
  const [busy, setBusy] = useState(0);
  const [lastFetched, setLastFetched] = useState(new Date());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [failures, setFailures] = useState<FailedSave[]>([]);
  const internal = isInternalRole(initial.user.role);
  const [asOf, setAsOfState] = useState<string | null>(() => {
    try {
      return internal ? sessionStorage.getItem('sunpm.asOf') : null;
    } catch {
      return null;
    }
  });
  const versionRef = useRef(initial.version);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, tone, text }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'error' ? 9000 : 4000);
  }, []);

  /** Run a request with the "Syncing" indicator on. */
  const tracked = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusy(b => b + 1);
    try {
      return await fn();
    } finally {
      setBusy(b => b - 1);
    }
  }, []);

  const refresh = useCallback(async (force = false, fresh = false) => {
    await tracked(async () => {
      try {
        if (force && internal) await api.sync();
        const s = await api.snapshot(fresh || force);
        versionRef.current = s.version;
        setSnap(s);
        setLastFetched(new Date());
        setLink(l => (l === 'offline' ? (s.sync.push ? 'live' : 'polling') : l));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onSignedOut();
        else {
          setLink('offline');
          if (force) toast((e as Error).message, 'error');
        }
      }
    });
  }, [internal, onSignedOut, toast, tracked]);

  // Push channel (server-sent events) with polling fallback.
  useEffect(() => {
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (poll) return;
      poll = setInterval(() => void refresh(), Math.max(10, snap.sync.intervalSec) * 1000);
    };
    if (!initial.sync.push) {
      // Serverless host: no push channel, poll at the sync interval.
      setLink('polling');
      startPolling();
    } else try {
      es = new EventSource('/api/events');
      es.addEventListener('sync', ev => {
        setLink('live');
        if (poll) {
          clearInterval(poll);
          poll = null;
        }
        const msg = JSON.parse((ev as MessageEvent).data);
        if (msg.version !== versionRef.current || msg.state !== 'ok') void refresh();
        else setSnap(s => (s.sync.lastSuccessAt === msg.lastSuccessAt ? s : { ...s, sync: { ...s.sync, lastSuccessAt: msg.lastSuccessAt, state: msg.state } }));
      });
      es.onerror = () => {
        setLink('polling');
        startPolling();
      };
    } catch {
      startPolling();
    }
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      es?.close();
      if (poll) clearInterval(poll);
      window.removeEventListener('focus', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = asOf ?? snap.today;
  const project = useMemo(() => buildProject(snap.tables, today), [snap.tables, today]);
  const savedMsg = snap.sync.mode === 'google' ? 'Saved to the Google Sheet' : 'Saved to the local data file';

  const recordFailure = useCallback((what: string, e: unknown) => {
    setFailures(f => [{ at: new Date(), what, message: (e as Error).message }, ...f].slice(0, 30));
  }, []);

  const update = useCallback(async (table: TableKey, rec: Rec, changes: Record<string, unknown>) => {
    const original: Record<string, unknown> = {};
    for (const k of Object.keys(changes)) original[k] = rec[k] ?? null;
    try {
      await tracked(() => api.update(table, rec._key, changes, original));
    } catch (e) {
      recordFailure(`Edit ${rec._key}`, e);
      throw e;
    }
    await refresh(false, true);
    toast(`${savedMsg} · ${rec._key}`);
  }, [refresh, toast, savedMsg, tracked, recordFailure]);

  const bulkUpdate = useCallback(async (table: TableKey, recs: Rec[], changes: Record<string, unknown>) => {
    const items: BulkItem[] = recs.map(rec => {
      const original: Record<string, unknown> = {};
      for (const k of Object.keys(changes)) original[k] = rec[k] ?? null;
      return { key: rec._key, changes, original };
    });
    let n = 0;
    try {
      n = (await tracked(() => api.bulk(table, items))).updated;
    } catch (e) {
      recordFailure(`Bulk edit of ${recs.length} record(s)`, e);
      throw e;
    }
    await refresh(false, true);
    toast(`${savedMsg} · ${n} record(s) updated`);
    return n;
  }, [refresh, toast, savedMsg, tracked, recordFailure]);

  const create = useCallback(async (table: TableKey, values: Record<string, unknown>) => {
    let id = '';
    try {
      id = (await tracked(() => api.create(table, values))).id;
    } catch (e) {
      recordFailure(`New record (${table})`, e);
      throw e;
    }
    await refresh(false, true);
    toast(`${savedMsg} · created ${id}`);
    return id;
  }, [refresh, toast, savedMsg, tracked, recordFailure]);

  const archive = useCallback(async (table: TableKey, rec: Rec) => {
    try {
      await tracked(() => api.archive(table, rec._key, { archived: rec.archived ?? null }));
    } catch (e) {
      recordFailure(`Archive ${rec._key}`, e);
      throw e;
    }
    await refresh(false, true);
    toast(`Archived ${rec._key}`);
  }, [refresh, toast, tracked, recordFailure]);

  const readOnly = !!snap.sync.readOnly;
  const canEditCol = useCallback(
    (table: TableKey, key: string) => !readOnly && (snap.columns[table] ?? []).includes(key),
    [snap.columns, readOnly],
  );
  const user = useMemo<SessionUser>(() => (readOnly ? { ...snap.user, role: 'client' } : snap.user), [snap.user, readOnly]);

  const setAsOf = (d: string | null) => {
    try {
      if (d) sessionStorage.setItem('sunpm.asOf', d);
      else sessionStorage.removeItem('sunpm.asOf');
    } catch {
      /* storage unavailable */
    }
    setAsOfState(d);
  };

  const value: DataCtx = { user, account: snap.user, internal, readOnly, snap, project, link, syncing: busy > 0, lastFetched, failures, asOf, setAsOf, refresh, update, bulkUpdate, create, archive, toast, canEditCol };
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
