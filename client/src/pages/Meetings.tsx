// Meetings & Minutes: meeting register, minutes form, decisions → actions, action tracker.
import { useEffect, useMemo, useState } from 'react';
import { fmtDate } from '../../../shared/dates';
import { norm, Rec } from '../../../shared/model';
import { isArchived, isOpenAction } from '../../../shared/project';
import { canCreate, canEditField, PHASE_NUMBERS, TABLES } from '../../../shared/schema';
import { go } from '../App';
import { useData } from '../data';
import { History } from '../History';
import { FormSection, RecordForm } from '../RecordForm';
import { RecordTable } from '../RecordTable';
import { buildReport } from '../reports';
import { ReportActions, ReportPreview } from '../ReportView';
import { Card, D, Drawer, Empty, Icon, SearchBox, Tag } from '../ui';

const MEETING_SECTIONS: FormSection[] = [
  { title: 'Meeting details', fields: ['title', 'type', 'phase', 'date', 'startTime', 'endTime', 'organiser', 'visibility'] },
  { title: 'Participants', fields: ['clientParticipants', 'oamParticipants', 'attendees'] },
  { title: 'Meeting summary', fields: ['objective', 'agenda', 'summary', 'discussion', 'decisions', 'openQuestions', 'risks', 'clientFeedback', 'clarifications'] },
  { title: 'Follow-up', fields: ['nextMeeting', 'nextAgenda', 'followUp', 'links'] },
  { title: 'Internal (OneAlphaMed only)', fields: ['internalNotes'] },
];
const ACTION_SECTIONS: FormSection[] = [
  { title: 'Action', fields: ['action', 'meetingId', 'related', 'owner', 'ownerOrg', 'function', 'dueDate', 'priority', 'status', 'visibility'] },
  { title: 'Progress', fields: ['latestUpdate', 'dateClosed'] },
];
const DECISION_SECTIONS: FormSection[] = [
  { title: 'Decision', fields: ['decision', 'context', 'status', 'finalDecision', 'dateRecorded', 'owner', 'ownerOrg', 'phase', 'related', 'meetingId', 'visibility'] },
];
const TEXT: [string, string][] = [
  ['objective', 'Meeting objective'], ['agenda', 'Agenda'], ['summary', 'Executive summary'], ['discussion', 'Key discussion points'],
  ['openQuestions', 'Open questions'], ['risks', 'Risks or concerns raised'], ['clientFeedback', 'Client feedback'], ['clarifications', 'Pending clarifications'],
];
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const SEARCHABLE = ['title', 'objective', 'agenda', 'summary', 'discussion', 'decisions', 'openQuestions', 'risks', 'clientFeedback', 'clarifications', 'type'];
const PEOPLE = ['clientParticipants', 'oamParticipants', 'attendees', 'organiser'];

export function Meetings({ params }: { params: URLSearchParams }) {
  const { project: p, user, internal } = useData();
  const [tab, setTab] = useState<'meetings' | 'actions'>(params.get('tab') === 'actions' ? 'actions' : 'meetings');
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const [phase, setPhase] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const meetings = useMemo(
    () => [...(p.tables.meetings ?? [])].filter(m => !isArchived(m)).sort((a, b) => s(b.date).localeCompare(s(a.date)) || s(b.startTime).localeCompare(s(a.startTime))),
    [p.tables.meetings],
  );
  const filtered = meetings.filter(m =>
    (!q || SEARCHABLE.some(k => norm(m[k]).includes(norm(q))) || norm(m._key).includes(norm(q))) &&
    (!who || PEOPLE.some(k => norm(m[k]).includes(norm(who)))) &&
    (!phase || m.phase === phase) &&
    (!from || s(m.date) >= from) &&
    (!to || s(m.date) <= to),
  );
  const [selected, setSelected] = useState<string | null>(params.get('id'));
  const [mode, setMode] = useState<'view' | 'edit' | 'new' | 'minutes'>(params.get('new') ? 'new' : 'view');
  const [drawer, setDrawer] = useState<{ kind: 'action' | 'decision'; defaults: Record<string, unknown> } | null>(null);
  useEffect(() => {
    if (params.get('new')) setMode('new');
    if (params.get('id')) { setSelected(params.get('id')); setMode('view'); }
    if (params.get('tab')) setTab(params.get('tab') === 'actions' ? 'actions' : 'meetings');
  }, [params]);
  useEffect(() => {
    if (!selected && filtered[0] && mode !== 'new') setSelected(filtered[0]._key);
  }, [filtered, selected, mode]);
  const m = meetings.find(x => x._key === selected) ?? null;
  const actions = (p.tables.actions ?? []).filter(a => !isArchived(a));
  const canEdit = canEditField(user.role, 'meetings', 'summary');
  const overdueActions = actions.filter(a => isOpenAction(a) && a.dueDate && s(a.dueDate) < p.today);

  return (
    <div className="page">
      <div className="seg big" role="tablist">
        <button role="tab" aria-selected={tab === 'meetings'} className={tab === 'meetings' ? 'active' : ''} onClick={() => setTab('meetings')}>Meeting register <span className="chip-n">{meetings.length}</span></button>
        <button role="tab" aria-selected={tab === 'actions'} className={tab === 'actions' ? 'active' : ''} onClick={() => setTab('actions')}>Action tracker <span className="chip-n">{actions.filter(isOpenAction).length} open{overdueActions.length ? ` · ${overdueActions.length} overdue` : ''}</span></button>
      </div>

      {tab === 'meetings' && (
        <div className="meetings">
          <aside className="meeting-list card">
            <div className="toolbar">
              <SearchBox value={q} onChange={setQ} placeholder="Search topic or notes…" />
              {canCreate(user.role, 'meetings') && <button className="btn btn-primary btn-sm" onClick={() => { setMode('new'); setSelected(null); }}><Icon name="plus" /> Add</button>}
            </div>
            <div className="toolbar wrap" style={{ marginTop: 6 }}>
              <input value={who} onChange={e => setWho(e.target.value)} placeholder="Attendee…" aria-label="Filter by attendee" style={{ flex: 1 }} />
              <select value={phase} onChange={e => setPhase(e.target.value)} aria-label="Phase">
                <option value="">All phases</option>
                {[...PHASE_NUMBERS, 'All phases'].map(x => <option key={x}>{x}</option>)}
              </select>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From date" />
              <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To date" />
            </div>
            {filtered.length === 0 ? (
              <Empty title={meetings.length ? 'No matches' : 'No meetings recorded yet'}>{meetings.length ? '' : canEdit ? 'Use “Add” to capture the first meeting.' : 'Minutes shared by the project team will appear here.'}</Empty>
            ) : (
              <ol>
                {filtered.map(x => (
                  <li key={x._key}>
                    <button className={`meeting-item${x._key === selected && mode !== 'new' ? ' active' : ''}`} onClick={() => { setSelected(x._key); setMode('view'); }}>
                      <span className="mi-date">{fmtDate(s(x.date), { weekday: true })}{x.startTime ? ` · ${s(x.startTime)}` : ''} · {x._key}</span>
                      <strong>{s(x.title)}</strong>
                      <span className="small muted">
                        {s(x.type) || 'Meeting'}{x.phase ? ` · ${s(x.phase)}` : ''} · {actions.filter(a => a.meetingId === x._key && isOpenAction(a)).length} open action(s)
                        {internal && <> <Tag tone={x.visibility === 'Client' ? 'blue' : 'neutral'}>{s(x.visibility) || 'Internal'}</Tag></>}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </aside>

          <section className="meeting-detail card">
            {mode === 'new' ? (
              <>
                <h2>New meeting notes</h2>
                <p className="muted small">A Meeting ID is assigned automatically. Saved to the “{TABLES.meetings.tab}” tab of the live tracker. New meetings are Internal until Visibility is set to Client.</p>
                <RecordForm table="meetings" rec={null} sections={MEETING_SECTIONS} defaults={{ date: p.today, visibility: 'Internal', type: 'Status review', organiser: user.name }} submitLabel="Save meeting" onDone={id => { setSelected(id); setMode('view'); go('meetings', { id }); }} onCancel={() => setMode('view')} />
              </>
            ) : !m ? (
              <Empty title="Select a meeting" />
            ) : mode === 'edit' ? (
              <>
                <h2>Edit · {m._key} {s(m.title)}</h2>
                <RecordForm key={`${m._key}-${s(m.lastUpdated)}`} table="meetings" rec={m} sections={MEETING_SECTIONS} onDone={() => setMode('view')} onCancel={() => setMode('view')} />
                <History recordId={m._key} />
              </>
            ) : mode === 'minutes' ? (
              <MinutesExport m={m} onBack={() => setMode('view')} />
            ) : (
              <MeetingView
                m={m}
                onEdit={canEdit ? () => setMode('edit') : undefined}
                onMinutes={() => setMode('minutes')}
                onAction={canCreate(user.role, 'actions') ? text => setDrawer({ kind: 'action', defaults: { meetingId: m._key, action: text, status: 'Open', visibility: s(m.visibility) || 'Internal' } }) : undefined}
              />
            )}
          </section>
        </div>
      )}

      {tab === 'actions' && (
        <Card title="Action tracker" subtitle="Actions from meetings, linked to deliverables by ID. Owners, target dates and status also appear on the linked deliverable and in the executive summary.">
          {overdueActions.length > 0 && <div className="notice notice-error"><Icon name="alert" /> {overdueActions.length} open action(s) are past their target date.</div>}
          <RecordTable
            table="actions"
            rows={actions}
            columns={['action', 'meetingId', 'related', 'owner', 'ownerOrg', 'function', 'dueDate', 'priority', 'status', 'latestUpdate', 'dateClosed', ...(internal ? ['visibility'] : [])]}
            initialSort="dueDate"
            render={{
              related: r => (r.related ? <a className="tag tag-neutral mono" href={`#/tracker?open=${encodeURIComponent(s(r.related))}`} onClick={e => e.stopPropagation()}>{s(r.related)}</a> : <span className="muted">—</span>),
              meetingId: r => (r.meetingId ? <a className="mono" href={`#/meetings?id=${encodeURIComponent(s(r.meetingId))}`} onClick={e => e.stopPropagation()}>{s(r.meetingId)}</a> : <span className="muted">—</span>),
              status: r => <Tag tone={isOpenAction(r) ? (r.dueDate && s(r.dueDate) < p.today ? 'red' : 'amber') : 'green'}>{s(r.status)}{isOpenAction(r) && r.dueDate && s(r.dueDate) < p.today ? ' · overdue' : ''}</Tag>,
            }}
            rowTone={r => (isOpenAction(r) && r.dueDate && s(r.dueDate) < p.today ? 'red' : undefined)}
            createDefaults={{ status: 'Open', visibility: 'Internal' }}
            emptyText="No action items yet. Create them from a meeting's decisions or with “Add”."
            sections={ACTION_SECTIONS}
          />
        </Card>
      )}

      <Drawer open={!!drawer} onClose={() => setDrawer(null)} title={drawer?.kind === 'decision' ? 'Record in the decision log' : 'New action item'} subtitle={m ? `From ${m._key} · ${s(m.title)} (${fmtDate(s(m.date))})` : ''}>
        {drawer && (
          <RecordForm
            key={JSON.stringify(drawer.defaults)}
            table={drawer.kind === 'decision' ? 'decisions' : 'actions'}
            rec={null}
            sections={drawer.kind === 'decision' ? DECISION_SECTIONS : ACTION_SECTIONS}
            defaults={drawer.defaults}
            onDone={() => setDrawer(null)}
            onCancel={() => setDrawer(null)}
          />
        )}
      </Drawer>
    </div>
  );
}

function MeetingView({ m, onEdit, onMinutes, onAction, onDecision }: { m: Rec; onEdit?: () => void; onMinutes: () => void; onAction?: (text: string) => void; onDecision?: (text: string) => void }) {
  const { internal, project: p } = useData();
  const linked = (p.tables.actions ?? []).filter(a => a.meetingId === m._key && !isArchived(a));
  const decisions = s(m.decisions).split(/\r?\n/).map(l => l.replace(/^[\s•\-*\d.)]+/, '').trim()).filter(Boolean);
  const logged = (p.tables.decisions ?? []).filter(d => d.meetingId === m._key && !isArchived(d));
  const time = [s(m.startTime), s(m.endTime)].filter(Boolean).join('–');
  const links = s(m.links).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return (
    <article className="meeting-view">
      <header className="mv-head">
        <div>
          <div className="eyebrow">{s(m.type) || 'Meeting'} · {m._key}{m.phase ? ` · ${s(m.phase)}` : ''}</div>
          <h2>{s(m.title)}</h2>
          <div className="muted">
            <D v={m.date} weekday />{time ? ` · ${time}` : ''}{m.organiser ? ` · organised by ${s(m.organiser)}` : ''}
            {internal && <> · <Tag tone={m.visibility === 'Client' ? 'blue' : 'neutral'}>{m.visibility === 'Client' ? 'Shared with Sun Pharma' : 'Internal only'}</Tag></>}
          </div>
        </div>
        <div className="row no-print">
          <button className="btn btn-sm" onClick={onMinutes}><Icon name="file" /> Client-ready minutes (PDF / Word)</button>
          {onEdit && <button className="btn btn-sm btn-primary" onClick={onEdit}>Edit</button>}
        </div>
      </header>
      <dl className="dl-grid">
        <div><dt>Sun Pharma participants</dt><dd className="prewrap">{s(m.clientParticipants) || <span className="muted">—</span>}</dd></div>
        <div><dt>OneAlphaMed participants</dt><dd className="prewrap">{s(m.oamParticipants) || <span className="muted">—</span>}</dd></div>
        {s(m.attendees) && <div><dt>Other attendees</dt><dd className="prewrap">{s(m.attendees)}</dd></div>}
      </dl>
      <div className="mv-grid">
        {TEXT.map(([k, label]) => (s(m[k]) ? <section key={k} className={k === 'summary' || k === 'discussion' ? 'mv-wide' : ''}><h3>{label}</h3><p className="prewrap">{s(m[k])}</p></section> : null))}
        <section className="mv-wide">
          <h3>Decisions made ({decisions.length})</h3>
          {decisions.length ? (
            <ul className="decision-lines">
              {decisions.map((d, i) => (
                <li key={i}>
                  <span>{d}</span>
                  {(onAction || onDecision) && (
                    <span className="row no-print">
                      {onAction && <button className="btn btn-sm" onClick={() => onAction(d)}>→ Action item</button>}
                      {onDecision && <button className="btn btn-sm" onClick={() => onDecision(d)} disabled={logged.some(x => norm(x.decision) === norm(d))}>{logged.some(x => norm(x.decision) === norm(d)) ? 'In decision log' : '→ Decision log'}</button>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="muted">No decisions recorded. Enter one decision per line in “Decisions Made”.</p>}
        </section>
        {internal && s(m.internalNotes) && (
          <section className="mv-wide internal-box">
            <h3>Internal notes <span className="internal-flag">OneAlphaMed only</span></h3>
            <p className="prewrap">{s(m.internalNotes)}</p>
          </section>
        )}
      </div>
      <section>
        <div className="row between">
          <h3>Action items ({linked.length})</h3>
          {onAction && <button className="btn btn-sm no-print" onClick={() => onAction('')}><Icon name="plus" /> Add action</button>}
        </div>
        {linked.length === 0 ? <p className="muted">No actions recorded for this meeting.</p> : (
          <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>ID</th><th>Action</th><th>Deliverable</th><th>Owner</th><th>Target date</th><th>Priority</th><th>Status</th><th>Latest update</th></tr></thead>
            <tbody>
              {linked.map(a => (
                <tr key={a._key} className={isOpenAction(a) && a.dueDate && s(a.dueDate) < p.today ? 'row-red' : ''}>
                  <td className="mono">{a._key}</td>
                  <td>{s(a.action)}</td>
                  <td>{a.related ? <a className="mono" href={`#/tracker?open=${encodeURIComponent(s(a.related))}`}>{s(a.related)}</a> : '—'}</td>
                  <td>{s(a.owner) || '—'} <span className="muted small">{s(a.ownerOrg)}{a.function ? ` · ${s(a.function)}` : ''}</span></td>
                  <td className="nowrap"><D v={a.dueDate} /></td>
                  <td>{s(a.priority) || '—'}</td>
                  <td><Tag tone={isOpenAction(a) ? (a.dueDate && s(a.dueDate) < p.today ? 'red' : 'amber') : 'green'}>{s(a.status)}</Tag></td>
                  <td className="small"><span className="clamp">{s(a.latestUpdate) || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
      <section>
        <h3>Follow-up</h3>
        <dl className="dl-grid">
          <div><dt>Next meeting</dt><dd><D v={m.nextMeeting} weekday empty="To be confirmed" /></dd></div>
          {s(m.nextAgenda) && <div><dt>Next meeting agenda</dt><dd className="prewrap">{s(m.nextAgenda)}</dd></div>}
          {s(m.followUp) && <div><dt>Follow-up communication</dt><dd className="prewrap">{s(m.followUp)}</dd></div>}
          {links.length > 0 && (
            <div><dt>Attachments / references</dt><dd>{links.map((l, i) => <div key={i}>{/^https?:\/\//i.test(l) ? <a href={l} target="_blank" rel="noreferrer noopener">{l}</a> : l}</div>)}</dd></div>
          )}
        </dl>
      </section>
      {logged.length > 0 && <p className="small muted">Decision-log entries from this meeting: {logged.map(d => d._key).join(', ')}</p>}
      {internal && <History recordId={m._key} />}
      <p className="muted small">Last updated {s(m.lastUpdated).replace('T', ' ').replace('Z', ' UTC') || '—'}</p>
    </article>
  );
}

function MinutesExport({ m, onBack }: { m: Rec; onBack: () => void }) {
  const { project: p, snap, user, internal } = useData();
  const r = buildReport('minutes', { p, lastSync: snap.sync.lastSuccessAt, sourceLabel: snap.sync.mode === 'google' ? 'Google Sheet' : 'local data adapter', generatedBy: user.name, internal }, { meeting: m });
  return (
    <div className="print-target-wrap">
      <div className="row between no-print" style={{ marginBottom: 10 }}>
        <button className="btn btn-sm" onClick={onBack}>← Back to meeting</button>
        <ReportActions title={r.title} html={r.html} />
      </div>
      {internal && m.visibility !== 'Client' && <div className="notice notice-warn no-print"><Icon name="alert" /> This meeting is marked Internal. The minutes below exclude internal notes, but check the content before sharing with Sun Pharma.</div>}
      <ReportPreview html={r.html} />
    </div>
  );
}
