import { useCallback, useEffect, useState } from 'react';
import { fmtDate } from '../../shared/dates';
import { ROLE_LABEL } from '../../shared/schema';
import { api, Snapshot } from './api';
import { DataProvider, useData } from './data';
import { Login } from './Login';
import { Gantt } from './pages/Gantt';
import { Meetings } from './pages/Meetings';
import { SettingsPage } from './pages/Settings';
import { Summary } from './pages/Summary';
import { Tracker } from './pages/Tracker';
import { Icon, relTime, useTick } from './ui';

export type Page = 'summary' | 'tracker' | 'timeline' | 'meetings' | 'settings';

/** internalOnly: team only. */
const NAV: { page: Page; label: string; icon: string; internalOnly?: boolean }[] = [
  { page: 'summary', label: 'Executive Summary', icon: 'overview' },
  { page: 'tracker', label: 'Deliverables Tracker', icon: 'list' },
  { page: 'timeline', label: 'Timeline / Gantt', icon: 'gantt' },
  { page: 'meetings', label: 'Meetings & Minutes', icon: 'notes' },
  { page: 'settings', label: 'Settings / Data Connection', icon: 'settings', internalOnly: true },
];

export function parseHash(): { page: Page; params: URLSearchParams } {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [p, qs] = h.split('?');
  const page = (NAV.find(n => n.page === p)?.page ?? 'summary') as Page;
  return { page, params: new URLSearchParams(qs ?? '') };
}

export function go(page: Page, params?: Record<string, string>) {
  const qs = params ? new URLSearchParams(params).toString() : '';
  window.location.hash = `/${page}${qs ? `?${qs}` : ''}`;
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export default function App() {
  const [state, setState] = useState<{ phase: 'loading' } | { phase: 'login'; error?: string } | { phase: 'ready'; snap: Snapshot } | { phase: 'error'; error: string }>({ phase: 'loading' });

  const load = useCallback(async () => {
    try {
      const snap = await api.snapshot();
      setState({ phase: 'ready', snap });
    } catch (e: any) {
      if (e.status === 401) setState({ phase: 'login' });
      else setState({ phase: 'error', error: e.message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.phase === 'loading')
    return (
      <div className="splash" aria-busy="true">
        <div className="spinner" />
        <p>Loading project data…</p>
      </div>
    );
  if (state.phase === 'error')
    return (
      <div className="splash">
        <Icon name="alert" size={32} />
        <h1>Dashboard unavailable</h1>
        <p>{state.error}</p>
        <button className="btn btn-primary" onClick={() => void load()}>Try again</button>
      </div>
    );
  if (state.phase === 'login') return <Login onSignedIn={load} onCancel={load} />;
  return (
    <DataProvider initial={state.snap} onSignedOut={() => void load()}>
      <Shell
        onSignIn={() => setState({ phase: 'login' })}
        onSignOut={async () => {
          await api.logout().catch(() => undefined);
          // With open access this returns to the visitor view; otherwise to the sign-in page.
          await load();
        }}
      />
    </DataProvider>
  );
}

/** Connection status: Connected · Syncing · Connection Error — and honest about local mode. */
function SyncIndicator() {
  const { snap, link, refresh, internal, lastFetched, syncing } = useData();
  useTick(10000);
  const s = snap.sync;
  const error = s.state === 'error' || link === 'offline';
  const state = error ? 'Connection Error' : syncing || s.state === 'connecting' ? 'Syncing' : 'Connected';
  const source = s.mode === 'google' ? 'Google Sheet' : s.mode === 'public-sheet' ? 'Google Sheet (live)' : 'Local data (Google Sheet not connected)';
  const title = [
    `Status: ${state}`,
    `Source: ${s.source}`,
    `The server checks the source every ${s.intervalSec}s; this page updates automatically (${link === 'live' ? 'push connection' : 'polling'}).`,
    `Last successful sync: ${s.lastSuccessAt ? new Date(s.lastSuccessAt).toLocaleString() : 'never'}`,
    `Page refreshed: ${lastFetched.toLocaleTimeString()}`,
    s.lastError ? `Last error: ${s.lastError}` : '',
  ].filter(Boolean).join('\n');
  return (
    <div className={`sync ${error ? 'sync-error' : syncing ? 'sync-polling' : s.mode !== 'local' ? 'sync-live' : 'sync-polling'}`} title={title} role="status" aria-live="polite">
      <span className="dot" />
      <span className="sync-label">
        <strong>{state}</strong> · {source} · last sync {relTime(s.lastSuccessAt)}
      </span>
      <span className="sync-interval">every {s.intervalSec}s</span>
      <button className="icon-btn" aria-label={error ? 'Retry connection' : 'Refresh now'} title={error ? 'Retry' : 'Refresh now'} disabled={syncing} onClick={() => void refresh(internal)}>
        <Icon name="refresh" className={syncing ? 'spin' : ''} />
      </button>
    </div>
  );
}

function Shell({ onSignOut, onSignIn }: { onSignOut: () => void; onSignIn: () => void }) {
  const { account: user, internal, project, asOf, setAsOf, snap, refresh } = useData();
  const { page, params } = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [page]);
  const items = NAV.filter(n => internal || !n.internalOnly);
  const errors = (snap.issues ?? []).filter(i => i.severity === 'error').length;

  return (
    <div className={`shell${navOpen ? ' nav-open' : ''}`}>
      <a href="#main" className="skip">Skip to content</a>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <div className="brand-mark">PN</div>
          <div>
            <div className="brand-name">{project.settings.projectName}</div>
            <div className="brand-sub">{project.settings.client} × {project.settings.agency}</div>
          </div>
        </div>
        <nav>
          {items.map(n => (
            <a key={n.page} href={`#/${n.page}`} className={page === n.page ? 'active' : ''} aria-current={page === n.page ? 'page' : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.page === 'settings' && errors > 0 && <span className="count count-red" title="Data-quality errors">{errors}</span>}
              {n.page === 'tracker' && project.kpis.overdue > 0 && <span className="count count-red" title="Overdue">{project.kpis.overdue}</span>}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          {user.public ? (
            <>
              <div className="who">
                <strong>Read-only view</strong>
                <span>Open access · no sign-in needed</span>
              </div>
              <button className="btn btn-ghost" onClick={onSignIn}>
                <Icon name="logout" /> Team sign-in
              </button>
            </>
          ) : (
            <>
              <div className="who">
                <strong>{user.name}</strong>
                <span>{ROLE_LABEL[user.role]}{user.dev ? ' · dev' : ''}</span>
              </div>
              <button className="btn btn-ghost" onClick={onSignOut}>
                <Icon name="logout" /> Sign out
              </button>
            </>
          )}
        </div>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <button className="icon-btn nav-toggle" aria-label="Open navigation" onClick={() => setNavOpen(o => !o)}>
            <Icon name="menu" />
          </button>
          <div className="topbar-title">{NAV.find(n => n.page === page)?.label}</div>
          <SyncIndicator />
        </header>
        {asOf && (
          <div className="banner banner-warn">
            <Icon name="calendar" /> Viewing the plan as of <strong>{fmtDate(asOf, { weekday: true })}</strong> (simulated date — internal only).
            <button className="btn btn-sm" onClick={() => setAsOf(null)}>Back to today</button>
          </div>
        )}
        {snap.sync.state === 'error' && (
          <div className="banner banner-error" role="alert">
            <Icon name="alert" /> Connection error: the live source could not be read{internal && snap.sync.lastError ? ` (${snap.sync.lastError})` : ''}. Figures are from the last successful sync ({relTime(snap.sync.lastSuccessAt)}).
            <button className="btn btn-sm" onClick={() => void refresh(internal)}>Retry</button>
          </div>
        )}
        {internal && snap.sync.mode === 'local' && (
          <div className="banner banner-warn no-print">
            <Icon name="alert" /> Running on the local data adapter — the Google Sheet is not connected yet, so this is not live. <a href="#/settings?tab=sync">Connection set-up</a>
          </div>
        )}
        {internal && snap.sync.readOnly && (
          <div className="banner banner-info no-print">
            <Icon name="link" /> Live from the Google Sheet. To change anything, edit the sheet — the dashboard picks it up within about {snap.sync.intervalSec} seconds.
          </div>
        )}
        <main id="main" tabIndex={-1}>
          {page === 'summary' && <Summary />}
          {page === 'tracker' && <Tracker params={params} />}
          {page === 'timeline' && <Gantt />}
          {page === 'meetings' && <Meetings params={params} />}
          {page === 'settings' && internal && <SettingsPage />}
        </main>
      </div>
      <datalist id="deliverable-ids">{project.deliverables.map(d => <option key={d.key} value={d.key}>{d.name}</option>)}</datalist>
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
    </div>
  );
}
