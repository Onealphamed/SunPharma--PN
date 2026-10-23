// Reports & Exports. Every report is generated from the latest synchronised data:
// the page re-reads the source when it opens and before each download.
import { useEffect, useMemo, useState } from 'react';
import { fmtDate } from '../../../shared/dates';
import { isArchived } from '../../../shared/project';
import { TableKey } from '../../../shared/schema';
import { api } from '../api';
import { useData } from '../data';
import { buildReport, ReportKey, REPORTS } from '../reports';
import { ReportActions, ReportPreview } from '../ReportView';
import { Card, Icon, relTime } from '../ui';

export function Reports() {
  const { project: p, snap, user, internal, refresh, toast, syncing } = useData();
  const initial = (new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('report') as ReportKey) || 'executive';
  const [key, setKey] = useState<ReportKey>(REPORTS.some(r => r.key === initial) ? initial : 'executive');
  const meetings = useMemo(() => [...(p.tables.meetings ?? [])].filter(m => !isArchived(m)).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))), [p.tables.meetings]);
  const [meetingId, setMeetingId] = useState('');
  useEffect(() => {
    void refresh(false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const meeting = meetings.find(m => m._key === meetingId) ?? meetings[0];
  const ctx = { p, lastSync: snap.sync.lastSuccessAt, sourceLabel: snap.sync.mode === 'google' ? 'Google Sheet' : 'local data adapter — Google Sheet not connected', generatedBy: user.name, internal };
  const report = buildReport(key, ctx, { meeting });
  const meta = REPORTS.find(r => r.key === key)!;
  const exportData = async (table: TableKey, format: 'xlsx' | 'csv', keys?: string[]) => {
    try {
      await api.exportTable(table, format, keys);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const openActionKeys = (p.tables.actions ?? []).filter(a => !['done', 'cancelled'].includes(String(a.status ?? '').toLowerCase()) && !isArchived(a)).map(a => a._key);

  return (
    <div className="page">
      <Card
        title="Reports"
        subtitle={<>Generated from the data synchronised {relTime(snap.sync.lastSuccessAt)} ({snap.sync.lastSuccessAt ? new Date(snap.sync.lastSuccessAt).toLocaleString() : 'never'}) · reporting date {fmtDate(p.today, { weekday: true })}. Each report includes the project name, reporting date, status legend, summary metrics and the last-sync time.</>}
        actions={<button className="btn btn-sm" disabled={syncing} onClick={() => void refresh(internal, true)}><Icon name="refresh" className={syncing ? 'spin' : ''} /> Refresh data</button>}
      >
        <div className="report-list" role="tablist" aria-label="Report type">
          {REPORTS.map(r => (
            <button key={r.key} role="tab" aria-selected={key === r.key} className={`report-card${key === r.key ? ' active' : ''}`} onClick={() => setKey(r.key)}>
              <strong>{r.title}</strong>
              <small>{r.description}</small>
            </button>
          ))}
        </div>
      </Card>

      <Card
        title={report.title}
        subtitle={meta.description}
        className="print-target-wrap"
        actions={
          <>
            {key === 'minutes' && (
              <select value={meeting?._key ?? ''} onChange={e => setMeetingId(e.target.value)} aria-label="Meeting">
                {meetings.length === 0 && <option value="">No meetings recorded</option>}
                {meetings.map(m => <option key={m._key} value={m._key}>{m._key} · {fmtDate(String(m.date ?? ''))} · {String(m.title ?? '')}</option>)}
              </select>
            )}
            {meta.table === 'deliverables' && (
              <>
                <button className="btn btn-sm" onClick={() => void exportData('deliverables', 'xlsx')}><Icon name="download" /> Excel</button>
                <button className="btn btn-sm" onClick={() => void exportData('deliverables', 'csv')}>CSV</button>
              </>
            )}
            {meta.table === 'actions' && (
              <>
                <button className="btn btn-sm" onClick={() => void exportData('actions', 'xlsx', openActionKeys)} disabled={!openActionKeys.length}><Icon name="download" /> Excel</button>
                <button className="btn btn-sm" onClick={() => void exportData('actions', 'csv', openActionKeys)} disabled={!openActionKeys.length}>CSV</button>
              </>
            )}
            {(key !== 'minutes' || meeting) && <ReportActions title={report.title} html={report.html} />}
          </>
        }
      >
        <ReportPreview html={report.html} />
      </Card>

      <Card title="Data exports" subtitle="Spreadsheet exports of the live tracker tabs, limited to what your role may see. Each workbook includes an About sheet with the last-sync time.">
        <div className="row">
          {(['deliverables', 'actions', 'meetings', 'raid', 'decisions', 'comments'] as TableKey[]).map(t => (
            <button key={t} className="btn btn-sm" onClick={() => void exportData(t, 'xlsx')}><Icon name="download" /> {t === 'raid' ? 'Risks & issues' : t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
      </Card>
    </div>
  );
}
