// Settings / Data Connection (internal users only; the server also refuses client access
// to the audit log and data-quality report).
import { useEffect, useState } from 'react';
import { fmtDate } from '../../../shared/dates';
import type { Issue, Rec } from '../../../shared/model';
import { TABLES } from '../../../shared/schema';
import { api } from '../api';
import { useData } from '../data';
import { RecordTable } from '../RecordTable';
import { Card, Empty, Icon, relTime, Tag } from '../ui';

type Tab = 'sync' | 'quality' | 'settings' | 'statuses' | 'audit';

export function SettingsPage() {
  const initial = (new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tab') as Tab) || 'sync';
  const [tab, setTab] = useState<Tab>(initial);
  const { snap } = useData();
  const errs = (snap.issues ?? []).filter(i => i.severity === 'error').length;
  const tabs: [Tab, string][] = [['sync', 'Data connection'], ['quality', `Data quality${errs ? ` (${errs})` : ''}`], ['settings', 'Project settings'], ['statuses', 'Statuses & calendar'], ['audit', 'Audit log']];
  return (
    <div className="page">
      <div className="seg big" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'sync' && <SyncPanel />}
      {tab === 'quality' && <Quality />}
      {tab === 'settings' && <SettingsPanel />}
      {tab === 'statuses' && <StatusPanel />}
      {tab === 'audit' && <AuditPanel />}
    </div>
  );
}

function SyncPanel() {
  const { snap, link, refresh, asOf, setAsOf, project, failures, syncing } = useData();
  const s = snap.sync;
  const [d, setD] = useState(asOf ?? project.today);
  const state = s.state === 'error' || link === 'offline' ? 'Connection Error' : syncing ? 'Syncing' : 'Connected';
  return (
    <>
      <div className="two-col">
        <Card title="Live data connection" actions={<button className="btn btn-primary btn-sm" disabled={syncing} onClick={() => void refresh(true)}><Icon name="refresh" className={syncing ? 'spin' : ''} /> {s.state === 'error' ? 'Retry now' : 'Sync now'}</button>}>
          <dl className="dl-grid">
            <div><dt>Status</dt><dd><Tag tone={state === 'Connected' ? 'green' : state === 'Syncing' ? 'amber' : 'red'}>{state}</Tag></dd></div>
            <div><dt>Data source</dt><dd>{s.mode === 'google' ? 'Google Sheet (live source of truth, read/write)' : s.mode === 'public-sheet' ? 'Google Sheet, live through its view-only link (read-only)' : <strong className="warn">Local data adapter — the Google Sheet is NOT connected</strong>}</dd></div>
            <div><dt>Source detail</dt><dd>{s.source}</dd></div>
            <div><dt>Refresh method</dt><dd>The server re-reads the source every <strong>{s.intervalSec}s</strong>; open browsers update automatically ({link === 'live' ? 'push connection active' : 'polling'}). {s.readOnly ? 'Changes are made in Google Sheets.' : 'Saves are written immediately and re-read.'}</dd></div>
            <div><dt>Last successful sync</dt><dd>{s.lastSuccessAt ? `${new Date(s.lastSuccessAt).toLocaleString()} (${relTime(s.lastSuccessAt)})` : 'never'}</dd></div>
            <div><dt>Last data change</dt><dd>{s.lastChangeAt ? new Date(s.lastChangeAt).toLocaleString() : '—'}</dd></div>
            {s.lastError && <div><dt>Last error</dt><dd className="bad">{s.lastError}</dd></div>}
          </dl>
          {s.configErrors.length > 0 && <div className="notice notice-error"><Icon name="alert" /> Configuration needed:<ul>{s.configErrors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
        </Card>
        <Card title={s.mode === 'local' ? 'Connect the Google Sheet' : 'Connection details'} subtitle="Full instructions: README.md › “Connect the live Google Sheet”">
          {s.mode === 'google' ? (
            <p className="small">Connected through a Google service account (server-side only; no credentials reach the browser). Share the sheet only with the service account and the OneAlphaMed team — Sun Pharma sees data through this dashboard, which removes internal fields on the server.</p>
          ) : s.mode === 'public-sheet' ? (
            <ul className="small" style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>The sheet is read through its <strong>“Anyone with the link can view”</strong> sharing — no credentials. If that sharing is turned off, the dashboard shows a connection error.</li>
              <li>Deliverables come from the <strong>Readiness Checklist</strong> tab. Extra columns named like the tracker fields (e.g. <em>Planned Start Date</em>, <em>Planned End Date</em>, <em>Completion Confirmed</em>, <em>Priority</em>, <em>Next Action</em>, <em>Deliverable ID</em>) are picked up automatically.</li>
              <li>Because the link is view-only, edits are made in Google Sheets. To edit from the dashboard instead, add a service account (README §3).</li>
            </ul>
          ) : (
            <ol className="small" style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>Upload <code>output/PN0510_Live_Tracker.xlsx</code> to Google Drive and open it as a Google Sheet (or run <code>npm run sheet:push</code> against an empty sheet).</li>
              <li>In Google Cloud, enable the Google Sheets API and create a service account with a JSON key.</li>
              <li>Share the sheet with the service-account email as <strong>Editor</strong>.</li>
              <li>Set <code>DATA_SOURCE=google</code>, <code>GOOGLE_SHEET_ID</code> and <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> in <code>.env</code> (or the host’s secrets).</li>
              <li>Check with <code>npm run sheet:push -- --check</code>, then restart. This panel will show “Google Sheet”.</li>
            </ol>
          )}
        </Card>
      </div>
      <Card title="Failed saves & sync errors" subtitle="Server log (most recent first) plus saves that failed in this browser session. Nothing is retried silently.">
        {s.recentErrors.length + failures.length === 0 ? <Empty title="No errors recorded" icon="check" /> : (
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>When</th><th>Where</th><th>Type</th><th>Record</th><th>User</th><th>Message</th></tr></thead>
              <tbody>
                {failures.map((f, i) => <tr key={`c${i}`}><td className="nowrap small">{relTime(f.at)}</td><td>This browser</td><td>save</td><td>{f.what}</td><td>you</td><td className="bad">{f.message}</td></tr>)}
                {s.recentErrors.map((e, i) => <tr key={`s${i}`}><td className="nowrap small" title={e.at}>{relTime(e.at)}</td><td>Server</td><td>{e.kind}</td><td>{e.record ?? '—'}</td><td>{e.user ?? '—'}</td><td className="bad">{e.message}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Simulate a date (internal what-if)" subtitle="Recalculate overdue, due-soon and health as if today were another date. Affects only your browser session.">
        <div className="row">
          <input type="date" value={d} onChange={e => setD(e.target.value)} aria-label="Simulated date" />
          <button className="btn btn-primary" onClick={() => setAsOf(d || null)}>Apply</button>
          {asOf && <button className="btn" onClick={() => setAsOf(null)}>Reset to today</button>}
        </div>
        <p className="muted small">Server date (project time zone): {fmtDate(snap.today, { weekday: true })}</p>
      </Card>
    </>
  );
}

function Quality() {
  const { snap } = useData();
  const [sev, setSev] = useState<'all' | Issue['severity']>('all');
  const issues = (snap.issues ?? []).filter(i => sev === 'all' || i.severity === sev);
  const count = (s: Issue['severity']) => (snap.issues ?? []).filter(i => i.severity === s).length;
  const link = (i: Issue) => (i.table === 'deliverables' && i.recordId ? `#/tracker?open=${encodeURIComponent(i.recordId)}` : i.table === 'actions' || i.table === 'meetings' ? '#/meetings' : undefined);
  return (
    <Card title="Data-quality report" subtitle="Re-checked on every sync: unconfirmed or impossible dates, blank or unknown statuses, missing owners, duplicate or missing IDs, placeholder text, dependency cycles and broken links. Rows with ID problems are read-only until fixed in the sheet.">
      <div className="toolbar">
        <div className="seg">
          <button className={sev === 'all' ? 'active' : ''} onClick={() => setSev('all')}>All {snap.issues?.length ?? 0}</button>
          <button className={sev === 'error' ? 'active' : ''} onClick={() => setSev('error')}>Errors {count('error')}</button>
          <button className={sev === 'warning' ? 'active' : ''} onClick={() => setSev('warning')}>Warnings {count('warning')}</button>
          <button className={sev === 'info' ? 'active' : ''} onClick={() => setSev('info')}>Info {count('info')}</button>
        </div>
      </div>
      {issues.length === 0 ? <Empty title="No issues" icon="check">The source data passed every check.</Empty> : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Severity</th><th>Tab</th><th>Record</th><th>Field</th><th>Issue</th></tr></thead>
            <tbody>
              {issues.map((i, n) => (
                <tr key={n} className={i.severity === 'error' ? 'row-red' : ''}>
                  <td><Tag tone={i.severity === 'error' ? 'red' : i.severity === 'warning' ? 'amber' : 'neutral'}>{i.severity}</Tag></td>
                  <td>{TABLES[i.table]?.tab ?? i.table}</td>
                  <td className="mono">{i.recordId ? (link(i) ? <a href={link(i)}>{i.recordId}</a> : i.recordId) : i.row ? `row ${i.row}` : '—'}</td>
                  <td>{i.field ? TABLES[i.table]?.columns.find(c => c.key === i.field)?.header ?? i.field : '—'}</td>
                  <td>{i.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SettingsPanel() {
  const { project: p } = useData();
  return (
    <Card title="Project settings" subtitle="Stored in the Settings tab. Includes project dates, names, the working-day calendar, alert thresholds and the review-turnaround assumption. Blank values display as “Not confirmed”.">
      <RecordTable table="settings" rows={p.tables.settings ?? []} columns={['value', 'notes', 'visibility']} initialSort="_row" createDefaults={{ visibility: 'Internal' }} sections={[{ fields: ['key', 'value', 'notes', 'visibility'] }]} />
    </Card>
  );
}

function StatusPanel() {
  const { project: p } = useData();
  return (
    <>
      <Card title="Status configuration" subtitle="The eight statuses from the project brief. Colours and definitions drive the badges and legend. Completion is recorded separately (Completion Confirmed), so no status counts as complete by default. Adding a status here is a controlled change for the PM.">
        <RecordTable table="statuses" rows={p.tables.statuses ?? []} columns={['category', 'countsComplete', 'color', 'definition', 'aliases', 'order', 'active']} initialSort="order"
          render={{ color: r => <span className="badge" style={{ ['--c' as string]: String(r.color ?? '#999') }}><span className="dot" />{String(r.color ?? '')}</span> }}
          sections={[{ fields: ['status', 'category', 'countsComplete', 'color', 'aliases', 'order', 'active', 'definition'] }]} />
      </Card>
      <Card title="Working-day calendar" subtitle={`Weekends: ${p.settings.weekend.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')} (Settings › Weekend Days). Durations and windows are counted in working days excluding the holidays below.`}>
        <RecordTable table="holidays" rows={p.tables.holidays ?? []} columns={['name', 'region']} initialSort="date" emptyText="No holidays configured. The Readiness Checklist has none — add Indian public / company holidays here." sections={[{ fields: ['date', 'name', 'region'] }]} />
      </Card>
    </>
  );
}

function AuditPanel() {
  const { snap } = useData();
  const [rows, setRows] = useState<Rec[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.audit().then(r => setRows(r.entries)).catch(e => setErr(e.message));
  }, [snap.version]);
  return (
    <Card title="Audit log" subtitle="Every dashboard edit (who, field, old → new, when) and every change detected in the sheet between syncs. Stored in the Audit Log tab.">
      {err && <p className="bad">{err}</p>}
      {!rows ? <p className="muted">Loading…</p> : rows.length === 0 ? <Empty title="No entries yet" /> : (
        <div className="table-wrap tall">
          <table className="grid">
            <thead><tr><th>When</th><th>User</th><th>Source</th><th>Table</th><th>Record</th><th>Action</th><th>Field</th><th>Old</th><th>New</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="nowrap small" title={String(r.timestamp)}>{relTime(String(r.timestamp))}</td>
                  <td>{String(r.user ?? '')}</td><td>{String(r.source ?? '')}</td><td>{String(r.table ?? '')}</td>
                  <td className="mono">{String(r.recordId ?? '')}</td><td>{String(r.action ?? '')}</td><td>{String(r.field ?? '')}</td>
                  <td className="small clamp">{String(r.oldValue ?? '')}</td><td className="small clamp">{String(r.newValue ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
