// "Live sheet": the Google Sheet exactly as it stands — every tab, read through the same sync
// that drives every other page. Refreshes whenever the sync sees a change.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { norm } from '../../../shared/model';
import { api, Workbook } from '../api';
import { useData } from '../data';
import { Empty, Icon, relTime, SearchBox, useTick } from '../ui';

const colLetter = (i: number) => {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export function LiveSheet() {
  const { snap, refresh, internal, syncing } = useData();
  useTick(5000);
  const [wb, setWb] = useState<Workbook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(() => {
    try {
      return sessionStorage.getItem('sunpm.sheetTab') ?? '';
    } catch {
      return '';
    }
  });
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      setWb(await api.workbook());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  // Reload whenever the sync reports new data (or a new successful read).
  useEffect(() => {
    void load();
  }, [load, snap.version, snap.sync.lastSuccessAt]);

  const current = wb?.tabs.find(t => t.name === tab) ?? wb?.tabs.find(t => t.name === 'Readiness Checklist') ?? wb?.tabs[0];
  useEffect(() => {
    try {
      if (current) sessionStorage.setItem('sunpm.sheetTab', current.name);
    } catch {
      /* storage unavailable */
    }
  }, [current]);
  const rows = useMemo(() => {
    if (!current) return [];
    const qq = norm(q);
    return qq ? current.rows.filter(r => r.cells.some(c => norm(c).includes(qq))) : current.rows;
  }, [current, q]);
  const masked = wb?.masked.find(m => m.tab === current?.name);
  const live = snap.sync.mode !== 'local' && snap.sync.state === 'ok';

  if (error && !wb) return <Empty title="Live sheet unavailable" icon="alert">{error}</Empty>;
  if (!wb) return <Empty title="Reading the Google Sheet…" icon="refresh" />;

  return (
    <div className="page">
      <section className="sheet-intro">
        <div className="eyebrow">Programme</div>
        <h1>Live sheet</h1>
        <p className="muted">
          The workbook exactly as it stands in {snap.sync.mode === 'local' ? 'the local data file' : 'Google Sheets'} — all {wb.tabs.length} tabs, read through the same sync that drives every other page.
          {snap.sync.readOnly && ' Edits made in the sheet appear here automatically.'}
        </p>
      </section>

      <div className="sheet-stats">
        <div><strong>{wb.tabs.length}</strong><span>Tabs</span></div>
        <div><strong>{current?.rows.length ?? 0}</strong><span>Rows in this tab</span></div>
        <div><strong>{current?.columns ?? 0}</strong><span>Columns</span></div>
        <div><strong className="mono">{wb.version}</strong><span>Version</span></div>
        <div><strong>{relTime(wb.lastSuccessAt ?? wb.readAt)}</strong><span>Last synced · every {wb.intervalSec}s</span></div>
        <div><strong className={live ? 'ok' : snap.sync.state === 'error' ? 'bad' : ''}>{snap.sync.state === 'error' ? 'Error' : live ? 'Live' : 'Local'}</strong><span>Source</span></div>
      </div>

      <div className="toolbar wrap">
        <SearchBox value={q} onChange={setQ} placeholder="Search this tab…" />
        <div className="spacer" />
        <button className="btn" disabled={syncing} onClick={async () => { await refresh(internal, true); await load(); }}>
          <Icon name="refresh" className={syncing ? 'spin' : ''} /> Sync now
        </button>
        {wb.sheetUrl && (
          <a className="btn btn-primary" href={wb.sheetUrl} target="_blank" rel="noreferrer noopener">Open in Google Sheets</a>
        )}
      </div>

      <div className="sheet-tabs" role="tablist" aria-label="Sheet tabs">
        {wb.tabs.map(t => (
          <button key={t.name} role="tab" aria-selected={t.name === current?.name} className={`sheet-tab${t.name === current?.name ? ' active' : ''}`} onClick={() => setTab(t.name)}>
            {t.name}
          </button>
        ))}
      </div>

      {masked && (
        <div className="notice notice-warn">
          <Icon name="shield" /> Contact details are hidden in this public view ({masked.columns.join(', ')}). The project team sees them after signing in.
        </div>
      )}
      {error && <div className="notice notice-error"><Icon name="alert" /> Could not refresh: {error}. Showing the last version read.</div>}

      {!current || current.rows.length === 0 ? (
        <Empty title="This tab is empty" />
      ) : (
        <div className="table-wrap tall sheet-grid">
          <table className="grid">
            <thead>
              <tr>
                <th className="rownum">#</th>
                {Array.from({ length: Math.max(current.columns, 1) }, (_, i) => <th key={i}>{colLetter(i)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.n}>
                  <td className="rownum">{r.n}</td>
                  {Array.from({ length: Math.max(current.columns, 1) }, (_, i) => <td key={i}>{r.cells[i] ?? ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty title="No rows match this search" />}
        </div>
      )}
      <p className="muted small">Read at {new Date(wb.readAt).toLocaleString()} · version {wb.version} changes whenever any cell in the workbook changes.</p>
    </div>
  );
}
