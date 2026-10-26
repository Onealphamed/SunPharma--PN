// Executive Summary — the landing page. Everything here is calculated from the live
// tracker; nothing is typed in except the PM's optional narrative edit.
import { useEffect, useState } from 'react';
import { fmtDate } from '../../../shared/dates';
import { norm, Rec } from '../../../shared/model';
import { HEALTH_LABEL, isOpenAction, narrativeText, plainName } from '../../../shared/project';
import { api } from '../api';
import { go } from '../App';
import { useData } from '../data';
import { BarList, Card, Empty, FlagBadge, HealthPill, Icon, Kpi, PlanDate, Progress, relTime, StatusBadge, Tag } from '../ui';
import { useSetting } from './settingsHelpers';

export function Summary() {
  const { project: p, snap, internal, user } = useData();
  const s = p.settings;
  const k = p.kpis;
  const filter = (f: string) => go('tracker', { filter: f });
  const open = p.deliverables.filter(d => !d.complete);
  const statusRows = p.statuses.list.map(def => ({ key: def.status, label: <StatusBadge status={def.status} />, value: open.filter(d => d.status === def.status).length, title: `${def.status}: ${def.definition}` }));
  const unset = open.filter(d => d.category === 'Unmapped').length;
  if (unset) statusRows.push({ key: '(none)', label: <StatusBadge status={null} />, value: unset, title: 'No recognised status' });
  if (k.completed) statusRows.push({ key: 'complete', label: <span className="badge" style={{ ['--c' as string]: '#15803d' }}><span className="dot" />Complete (confirmed)</span>, value: k.completed, title: 'Completion Confirmed = Yes' });

  const majors = p.deliverables.filter(d => !d.complete && (d.isMilestone || d.keyMilestone || d.isApprovalGate));
  const upcoming = [...majors.filter(d => d.end).sort((a, b) => a.end!.localeCompare(b.end!)), ...majors.filter(d => !d.end)].slice(0, 8);
  const attention = [...p.deliverables.filter(d => d.overdue).sort((a, b) => b.overdueDays - a.overdueDays), ...p.deliverables.filter(d => d.atRisk)];
  const awaitingSun = open.filter(d => d.awaiting === 'Sun Pharma').sort((a, b) => (a.end ?? '9').localeCompare(b.end ?? '9') || a.sortOrder - b.sortOrder);
  const awaitingOam = open.filter(d => d.awaiting === 'OneAlphaMed').sort((a, b) => (a.end ?? '9').localeCompare(b.end ?? '9') || a.sortOrder - b.sortOrder);
  const actions = (p.tables.actions ?? []).filter(isOpenAction);
  const sunActions = actions.filter(a => norm(a.ownerOrg) === 'sun pharma');
  const oamActions = actions.filter(a => norm(a.ownerOrg) !== 'sun pharma');

  return (
    <div className="page">
      <section className="hero card">
        <div className="hero-main">
          <div className="eyebrow">{s.programme || 'Programme'}</div>
          <h1>{s.projectName}</h1>
          <div className="hero-meta">
            <span><strong>Client</strong> {s.client}</span>
            <span><strong>Agency</strong> {s.agency}</span>
            <span title={s.startDate ? 'Project Start Date (Settings)' : 'Earliest confirmed planned start across deliverables'}><strong>{s.startDate ? 'Start' : 'Earliest planned start'}</strong> <PlanDate v={p.projectStart} label="Not confirmed" /></span>
            <span title={s.endDate ? 'Project End Date (Settings)' : 'Latest confirmed planned end across deliverables'}><strong>{s.endDate ? 'End' : 'Latest planned end'}</strong> <PlanDate v={p.projectEnd} label="Not confirmed" /></span>
            <span><strong>Current phase</strong> {p.currentPhase}</span>
          </div>
          <div className="hero-meta">
            <span><strong>Project manager</strong> {s.projectManager || <span className="unconfirmed">Not confirmed</span>}</span>
            <span><strong>Data last synced</strong> {relTime(snap.sync.lastSuccessAt)}</span>
            <span><strong>Reporting date</strong> {fmtDate(p.today, { weekday: true })}</span>
          </div>
          {internal && (
            <div className="row no-print" style={{ marginTop: 6 }}>
              <button className="btn btn-primary" onClick={() => go('meetings', { new: '1' })}><Icon name="plus" /> Add Meeting Notes</button>
              <button className="btn" onClick={() => go('reports', { report: 'executive' })}><Icon name="file" /> Executive report</button>
            </div>
          )}
          {!internal && (
            <div className="row no-print" style={{ marginTop: 6 }}>
              <button className="btn" onClick={() => go('reports', { report: 'executive' })}><Icon name="file" /> Download executive report</button>
            </div>
          )}
        </div>
        <div className="hero-health">
          <div className="eyebrow">Overall health</div>
          <HealthPill health={p.health} override={!!s.healthOverride} large />
          <ul className="reasons">
            {(s.healthOverride ? [s.healthOverrideReason || 'Set by the Project Manager (no reason recorded)', `Calculated: ${HEALTH_LABEL[p.computedHealth]}`] : p.healthReasons).map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          <div className="hero-number" title="Completed deliverables ÷ all active deliverables. Only items with Completion Confirmed = Yes count as completed.">
            <strong>{k.pct}%</strong>
            <span className="muted">overall progress</span>
          </div>
          <Progress value={k.pct} label="Overall progress" color="var(--navy)" />
          <small className="muted">{k.completed} of {k.total} deliverables confirmed complete</small>
        </div>
      </section>

      <div className="kpis eight">
        <Kpi label="Total deliverables" value={k.total} sub={k.notScheduled ? `${k.notScheduled} awaiting dates` : 'All scheduled'} onClick={() => filter('all')} />
        <Kpi label="Completed" value={k.completed} tone={k.completed ? 'green' : undefined} sub={`${k.pct}% of total`} onClick={() => filter('complete')} />
        <Kpi label="In progress" value={k.inProgress} tone="blue" onClick={() => filter('status:In Progress')} />
        <Kpi label="In review" value={k.inReview} onClick={() => filter('status:In Review')} />
        <Kpi label="Pending approvals" value={k.pendingApprovals} sub="Under Approval, Approval or awaiting decision" onClick={() => filter('approvals')} />
        <Kpi label="Yet to start" value={k.yetToStart} sub={k.yetToAssign ? `+ ${k.yetToAssign} yet to assign` : k.unmapped ? `+ ${k.unmapped} with no status` : undefined} onClick={() => filter('status:Yet to Start')} />
        <Kpi label="Overdue" value={k.overdue} tone={k.overdue ? 'red' : undefined} sub={k.notScheduled ? 'Based on confirmed dates only' : 'Past planned end, not complete'} onClick={() => filter('overdue')} />
        <Kpi label="Due in next 7 days" value={k.dueSoon} tone={k.dueSoon ? 'amber' : undefined} onClick={() => filter('duesoon')} />
      </div>

      <div className="split">
        <Card title="Phase-wise progress" subtitle="Confirmed completions ÷ deliverables in the phase (same rule as overall)" actions={<a className="btn btn-sm" href="#/phases">Phase details</a>}>
          <BarList
            max={100}
            format={n => `${n}%`}
            onClick={ph => go('phases', { phase: ph })}
            rows={p.phases.map(ph => ({ key: ph.phase, label: ph.name, value: ph.pct, title: `${ph.name}\n${ph.completed}/${ph.total} complete · ${ph.inProgress} in progress · ${ph.reviewApproval} in review/approval · ${ph.overdue} overdue · ${ph.atRisk} at risk` }))}
          />
          <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="grid">
            <thead><tr><th>Phase</th><th>Total</th><th>Done</th><th>Active</th><th>Review / approval</th><th>Overdue</th><th>At risk</th><th>Health</th></tr></thead>
            <tbody>
              {p.phases.map(ph => (
                <tr key={ph.phase} className="clickable" onClick={() => go('phases', { phase: ph.phase })}>
                  <td>{ph.phase}</td><td>{ph.total}</td><td>{ph.completed}</td><td>{ph.inProgress}</td><td>{ph.reviewApproval}</td>
                  <td className={ph.overdue ? 'bad' : ''}>{ph.overdue}</td><td className={ph.atRisk ? 'warn' : ''}>{ph.atRisk}</td><td><HealthPill health={ph.health} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
        <Card title="Status distribution" subtitle={`Open deliverables by status (${open.length})${k.completed ? ' · plus confirmed completions' : ''}`}>
          <BarList rows={statusRows} onClick={st => st !== 'complete' && st !== '(none)' && filter(`status:${st}`)} />
          <p className="chart-note">Bar length = number of deliverables. Click a bar to open those items in the tracker.</p>
        </Card>
      </div>

      <div className="split">
        <Card title="Upcoming milestones & approval gates" subtitle="Chronological; items without a confirmed date are listed last" actions={<a className="btn btn-sm" href="#/timeline">Timeline</a>}>
          {upcoming.length ? (
            <ul className="timeline-list">
              {upcoming.map(m => (
                <li key={m.key} className={m.overdue ? 'is-overdue' : m.atRisk ? 'is-risk' : ''}>
                  <div className="tl-date">
                    <PlanDate v={m.end} label="Not confirmed" />
                    <small>{m.overdue ? `${m.overdueDays}d overdue` : m.daysRemaining !== null ? (m.daysRemaining === 0 ? 'today' : `in ${m.daysRemaining}d`) : ''}</small>
                  </div>
                  <div>
                    <a href={`#/tracker?open=${encodeURIComponent(m.key)}`}>{plainName(m.name)}</a>
                    <div className="small muted">{m.id} · {m.type} · {m.phase} <StatusBadge status={m.status} /></div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty title="No open milestones" icon="check" />}
        </Card>
        <Card title="Overdue & at-risk items" subtitle="Items needing immediate attention" actions={<a className="btn btn-sm" href="#/tracker?filter=attention">View all</a>}>
          {attention.length === 0 ? (
            <Empty title={k.notScheduled === k.total - k.completed ? 'No dates confirmed yet' : 'Nothing overdue or at risk'} icon="check">
              {k.notScheduled ? `${k.notScheduled} open deliverables have no confirmed dates, so they cannot be assessed for slippage yet.` : 'All open deliverables are on track.'}
            </Empty>
          ) : (
            <ul className="plain-list">
              {attention.slice(0, 8).map(d => (
                <li key={d.key}>
                  <FlagBadge flag={d.flag} title={d.riskReasons.join('\n')} /> <a href={`#/tracker?open=${encodeURIComponent(d.key)}`}>{plainName(d.name)}</a>
                  <div className="small muted">{d.id} · {d.overdue ? `${d.overdueDays} day(s) past ${fmtDate(d.end)}` : d.riskReasons[0]} · {d.owner || 'no owner'}</div>
                </li>
              ))}
              {attention.length > 8 && <li className="muted small">+ {attention.length - 8} more</li>}
            </ul>
          )}
        </Card>
      </div>

      <div className="split">
        <PendingList
          title={user.role === 'client' && !user.public ? 'Awaiting Sun Pharma (your inputs & approvals)' : 'Pending client inputs — awaiting Sun Pharma'}
          subtitle="Lead = Sun, Client Input items, and approvals awaiting a decision"
          items={awaitingSun.map(d => ({ key: d.key, id: d.id, name: plainName(d.name), tag: d.isClientInput ? 'Input' : d.pendingApproval || d.isApprovalGate ? 'Approval' : d.type || 'Task', who: d.sunOwner || d.leadFunction, due: d.end, overdue: d.overdue }))}
          actions={sunActions}
          link="#/approvals"
        />
        <PendingList
          title="Pending internal actions — awaiting OneAlphaMed"
          subtitle="Open deliverables led by OneAlphaMed, Joint teams or vendors"
          items={awaitingOam.map(d => ({ key: d.key, id: d.id, name: plainName(d.name), tag: d.lead || '—', who: d.oamOwner, due: d.end, overdue: d.overdue }))}
          actions={oamActions}
          link="#/tracker?filter=oam"
        />
      </div>

      <Narrative />
      <RecentUpdates />
    </div>
  );
}

function PendingList({ title, subtitle, items, actions, link }: { title: string; subtitle: string; items: { key: string; id: string; name: string; tag: string; who: string; due: string | null; overdue: boolean }[]; actions: Rec[]; link: string }) {
  return (
    <Card title={`${title} (${items.length + actions.length})`} subtitle={subtitle} actions={<a className="btn btn-sm" href={link}>View all</a>}>
      {items.length + actions.length === 0 ? (
        <Empty title="Nothing pending" icon="check" />
      ) : (
        <ul className="plain-list">
          {items.slice(0, 7).map(x => (
            <li key={x.key}>
              <Tag tone={x.tag === 'Input' ? 'purple' : x.tag === 'Approval' ? 'blue' : 'neutral'}>{x.tag}</Tag>
              <a href={`#/tracker?open=${encodeURIComponent(x.key)}`}>{x.name}</a>
              <div className="small muted">{x.id} · {x.who || 'owner not set'} · due <PlanDate v={x.due} label="date not confirmed" />{x.overdue && <span className="bad"> · overdue</span>}</div>
            </li>
          ))}
          {items.length > 7 && <li className="muted small">+ {items.length - 7} more deliverables</li>}
          {actions.slice(0, 4).map(a => (
            <li key={a._key}>
              <Tag tone="amber">Action</Tag> {String(a.action)}
              <div className="small muted">{a._key} · {String(a.owner ?? 'owner not set')} · due {a.dueDate ? fmtDate(String(a.dueDate)) : 'not set'}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Generated narrative + the PM's edited version (stored in Settings, used by reports). */
function Narrative() {
  const { project: p, user, toast } = useData();
  const save = useSetting();
  const generated = narrativeText(p.summary);
  const edited = p.settings.narrative;
  const [mode, setMode] = useState<'edited' | 'generated'>(edited ? 'edited' : 'generated');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const isPm = user.role === 'admin';
  useEffect(() => setMode(edited ? 'edited' : 'generated'), [edited]);
  const persist = async (text: string) => {
    setBusy(true);
    try {
      await save([['Executive Narrative', text], ['Executive Narrative Updated', text ? p.today : ''], ['Executive Narrative Updated By', text ? user.name : '']]);
      setEditing(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Executive narrative"
      subtitle={<>Generated from live tracker data on {fmtDate(p.today, { weekday: true })}. Missing information is stated as unconfirmed, not assumed. Linked IDs open the source deliverables.</>}
      actions={
        <>
          {edited && (
            <div className="seg" role="group" aria-label="Narrative version">
              <button className={mode === 'edited' ? 'active' : ''} onClick={() => setMode('edited')}>PM edited</button>
              <button className={mode === 'generated' ? 'active' : ''} onClick={() => setMode('generated')}>Auto-generated</button>
            </div>
          )}
          {isPm && !editing && <button className="btn btn-sm" onClick={() => { setDraft(edited || generated); setEditing(true); }}><Icon name="notes" /> Edit narrative</button>}
        </>
      }
    >
      {editing ? (
        <div className="narrative-editor">
          <p className="small muted">Edit before sharing. The saved version is shown here and used in exported reports; the auto-generated version stays available.</p>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} aria-label="Executive narrative" />
          <div className="form-actions">
            <button className="btn" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            <button className="btn" onClick={() => setDraft(generated)} disabled={busy}>Reset to generated text</button>
            {edited && <button className="btn btn-danger-ghost" onClick={() => void persist('')} disabled={busy}>Remove PM edit</button>}
            <button className="btn btn-primary" onClick={() => void persist(draft)} disabled={busy || !draft.trim()}>{busy ? 'Saving…' : 'Save narrative'}</button>
          </div>
        </div>
      ) : mode === 'edited' && edited ? (
        <>
          <div className="notice notice-warn"><Icon name="notes" /> Edited by {p.settings.narrativeUpdatedBy || 'the Project Manager'}{p.settings.narrativeUpdated ? ` on ${fmtDate(p.settings.narrativeUpdated)}` : ''}. Figures may have changed since — compare with the auto-generated version.</div>
          <div className="narrative">{edited}</div>
        </>
      ) : (
        <div className="summary-grid">
          {p.summary.map(sec => (
            <div key={sec.key} className="summary-sec">
              <h3>{sec.heading}</h3>
              <ul>
                {sec.items.map((it, i) => (
                  <li key={i} className={it.tone ? `tone-${it.tone}` : ''}>
                    {it.text}
                    {it.refs && it.refs.length > 0 && (
                      <span className="refs">
                        {it.refs.slice(0, 6).map(r => (
                          <a key={r} className="tag tag-neutral mono" href={r.startsWith('PN-') ? `#/tracker?open=${encodeURIComponent(r)}` : r.startsWith('ACT') ? '#/meetings?tab=actions' : '#/risks'}>{r}</a>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RecentUpdates() {
  const { project: p, internal, snap } = useData();
  const [audit, setAudit] = useState<Rec[] | null>(null);
  useEffect(() => {
    if (!internal) return;
    api.audit().then(r => setAudit(r.entries.filter(e => e.source !== 'Import script').slice(0, 14))).catch(() => setAudit([]));
  }, [internal, snap.version]);
  return (
    <Card title="Recent updates" subtitle={internal ? 'Field-level changes from the audit log (dashboard and direct sheet edits)' : 'Recently changed deliverables, comments and meeting records'}>
      {internal && audit ? (
        audit.length === 0 ? <Empty title="No changes since the checklist import" /> : (
          <ul className="plain-list">
            {audit.map((e, i) => (
              <li key={i}>
                <span className="mono">{String(e.recordId)}</span>{' '}
                {e.field ? <>· <strong>{String(e.field)}</strong>: “{String(e.oldValue || '—')}” → “{String(e.newValue || '—')}”</> : <>· {String(e.action)} {e.newValue ? `— ${String(e.newValue)}` : ''}</>}
                <div className="small muted">{String(e.user)} · {relTime(String(e.timestamp))}{e.source === 'Sheet' ? ' · edited in the sheet' : ''}</div>
              </li>
            ))}
          </ul>
        )
      ) : p.recent.length === 0 ? (
        <Empty title="No updates yet" />
      ) : (
        <ul className="plain-list">
          {p.recent.slice(0, 12).map((r, i) => (
            <li key={i}>
              <Tag>{r.kind}</Tag> <a href={r.link}>{r.title}</a>
              <div className="small muted clamp">{r.id} · {r.detail} · {relTime(r.when)}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
