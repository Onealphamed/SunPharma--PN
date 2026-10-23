// Phase-wise project management: one view per phase, all calculated from the tracker.
import { useEffect, useState } from 'react';
import { fmtDate } from '../../../shared/dates';
import { norm } from '../../../shared/model';
import { Deliverable, isOpenDecision, plainName } from '../../../shared/project';
import { go } from '../App';
import { useData } from '../data';
import { BarList, Card, Empty, FlagBadge, HealthPill, PlanDate, Progress, StatusBadge, Tag } from '../ui';

export function Phases({ params }: { params: URLSearchParams }) {
  const { project: p } = useData();
  const [phase, setPhase] = useState(params.get('phase') ?? p.phases[0]?.phase ?? '');
  useEffect(() => {
    if (params.get('phase')) setPhase(params.get('phase')!);
  }, [params]);
  const ph = p.phases.find(x => x.phase === phase) ?? p.phases[0];
  if (!ph) return <Empty title="No phases" />;
  const items = p.deliverables.filter(d => d.phase === ph.phase);
  const open = items.filter(d => !d.complete);
  const milestones = items.filter(d => d.isMilestone || d.keyMilestone || d.isApprovalGate);
  const crossDeps = items.flatMap(d => d.predecessors.map(pr => ({ d, pred: p.byId.get(pr) }))).filter(x => x.pred && x.pred.phase !== ph.phase);
  const inputs = open.filter(d => d.isClientInput);
  const decisions = [...open.filter(d => d.isApprovalGate || d.pendingApproval), ...open.filter(d => d.isClientInput)];
  const decisionLog = (p.tables.decisions ?? []).filter(isOpenDecision).filter(r => norm(r.phase) === norm(ph.phase) || String(r.related ?? '').split(/[,\s]+/).some(id => p.byId.get(id)?.phase === ph.phase));
  const next = [...open.filter(d => d.nextAction), ...open.filter(d => !d.nextAction && (d.category === 'Active' || d.overdue || d.atRisk))]
    .sort((a, b) => (a.targetDate ?? a.end ?? '9').localeCompare(b.targetDate ?? b.end ?? '9'))
    .slice(0, 8);
  const firstUp = open.filter(d => d.category === 'Not started' || d.category === 'Unassigned').slice(0, 5);
  const earlier = p.phases.filter(x => x.order < ph.order);

  return (
    <div className="page">
      <div className="phase-tabs" role="tablist" aria-label="Phases">
        {p.phases.map(x => (
          <button key={x.phase} role="tab" aria-selected={x.phase === ph.phase} className={`phase-tab${x.phase === ph.phase ? ' active' : ''}`} onClick={() => { setPhase(x.phase); go('phases', { phase: x.phase }); }}>
            <strong>{x.phase}</strong>
            <small>{x.name.replace(/^Phase \d+:\s*/, '')}</small>
            <small>{x.completed}/{x.total} · {x.pct}%</small>
          </button>
        ))}
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h1 style={{ fontSize: 20 }}>{ph.name}</h1>
            <p className="card-sub">{ph.summary || <span className="unconfirmed">The checklist heading for this phase gives no scope summary.</span>}</p>
          </div>
          <HealthPill health={ph.health} large />
        </div>
        <div className="facts">
          <div className="mini"><span>Completion</span><strong>{ph.pct}%</strong><Progress value={ph.pct} color="var(--navy)" label="Phase completion" /></div>
          <div className="mini"><span>Total deliverables</span><strong>{ph.total}</strong></div>
          <div className="mini"><span>Completed</span><strong>{ph.completed}</strong></div>
          <div className="mini"><span>In progress</span><strong>{ph.inProgress}</strong></div>
          <div className="mini"><span>In review / approval</span><strong>{ph.reviewApproval}</strong></div>
          <div className="mini"><span>Pending (not complete)</span><strong>{ph.pending}</strong></div>
          <div className="mini"><span>Overdue</span><strong className={ph.overdue ? 'bad' : ''}>{ph.overdue}</strong></div>
          <div className="mini"><span>At risk</span><strong className={ph.atRisk ? 'warn' : ''}>{ph.atRisk}</strong></div>
          <div className="mini"><span>Phase start</span><strong><PlanDate v={ph.start} label="Not confirmed" /></strong></div>
          <div className="mini"><span>Phase end</span><strong><PlanDate v={ph.end} label="Not confirmed" /></strong></div>
          <div className="mini"><span>Awaiting dates</span><strong>{ph.notScheduled}</strong></div>
          <div className="mini"><span>Awaiting Sun Pharma</span><strong>{ph.awaitingSun}</strong></div>
        </div>
        <ul className="reasons" style={{ marginTop: 10 }}>{ph.healthReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        <p className="chart-note">Phase completion = confirmed completions ÷ deliverables in the phase. Start/end are the earliest and latest confirmed planned dates.</p>
      </section>

      <div className="split">
        <Card title="Workstreams" subtitle="Completion by workstream (checklist sections)">
          <BarList max={100} format={n => `${n}%`} rows={ph.workstreams.map(w => ({ key: w.code + w.name, label: `${w.code} ${w.name}`, value: w.total ? Math.round((w.completed / w.total) * 100) : 0, title: `${w.completed}/${w.total} complete` }))} onClick={() => go('tracker', { phase: ph.phase })} />
          <p className="chart-note">{ph.workstreams.map(w => `${w.code}: ${w.completed}/${w.total}`).join(' · ')}</p>
        </Card>
        <Card title="Key milestones & approval gates">
          {milestones.length ? (
            <ul className="timeline-list">
              {milestones.map(m => (
                <li key={m.key} className={m.overdue ? 'is-overdue' : m.atRisk ? 'is-risk' : ''}>
                  <div className="tl-date"><PlanDate v={m.end} label="Not confirmed" /><small>{m.type}</small></div>
                  <div><a href={`#/tracker?open=${encodeURIComponent(m.key)}`}>{plainName(m.name)}</a> <div className="small muted">{m.id} <StatusBadge status={m.status} /> <FlagBadge flag={m.flag} /></div></div>
                </li>
              ))}
            </ul>
          ) : <Empty title="No milestones or gates in this phase" />}
        </Card>
      </div>

      <div className="three-col">
        <Card title="Dependencies on earlier phases">
          {crossDeps.length ? (
            <ul className="plain-list">
              {crossDeps.map(({ d, pred }, i) => (
                <li key={i}><span className="mono small">{d.id}</span> waits for <a href={`#/tracker?open=${encodeURIComponent(pred!.key)}`}>{pred!.id}</a> {plainName(pred!.name)} {pred!.complete ? <Tag tone="green">done</Tag> : <FlagBadge flag={pred!.flag} />}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              {earlier.length ? 'No cross-phase dependencies are recorded in the tracker. ' : 'This is the first phase. '}
              {earlier.length > 0 && <a href="#/risks?tab=dependencies">Review dependency suggestions from the checklist remarks</a>}
            </p>
          )}
        </Card>
        <Card title={`Key decisions required (${decisions.length + decisionLog.length})`} subtitle="Approval gates, pending approvals and client decisions in this phase">
          {decisions.length + decisionLog.length ? (
            <ul className="plain-list">
              {decisions.slice(0, 8).map(d => <li key={d.key}><Tag tone={d.isClientInput ? 'purple' : 'blue'}>{d.isClientInput ? 'Input' : 'Approval'}</Tag> <a href={`#/tracker?open=${encodeURIComponent(d.key)}`}>{plainName(d.name)}</a> <span className="small muted">· {d.sunOwner || d.leadFunction || 'owner not set'}</span></li>)}
              {decisionLog.map(r => <li key={r._key}><Tag tone="amber">Decision</Tag> {String(r.decision)} <span className="small muted">· due {r.dueDate ? fmtDate(String(r.dueDate)) : 'not set'}</span></li>)}
            </ul>
          ) : <Empty title="None open" icon="check" />}
        </Card>
        <Card title={`Outstanding client inputs (${inputs.length})`}>
          {inputs.length ? (
            <ul className="plain-list">
              {inputs.map(d => <li key={d.key}><a href={`#/tracker?open=${encodeURIComponent(d.key)}`}>{plainName(d.name)}</a><div className="small muted">{d.id} · {d.sunOwner || 'owner not set'} · needed by <PlanDate v={d.end} label="date not confirmed" /></div></li>)}
            </ul>
          ) : <Empty title="No client inputs outstanding" icon="check" />}
        </Card>
      </div>

      <Card title="Next steps" subtitle="Recorded next actions (by target date), then active / at-risk items, then the first items yet to start">
        {next.length + firstUp.length ? (
          <ul className="plain-list">
            {next.map(d => <NextRow key={d.key} d={d} />)}
            {next.length === 0 && firstUp.map(d => <NextRow key={d.key} d={d} />)}
          </ul>
        ) : <Empty title="No open items" icon="check" />}
      </Card>

      <Card title={`${ph.phase} deliverables (${items.length})`} actions={<button className="btn btn-sm" onClick={() => go('tracker', { phase: ph.phase })}>Open in tracker</button>}>
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>ID</th><th>Task / Activity</th><th>Workstream</th><th>Type</th><th>OneAlphaMed</th><th>Sun Pharma</th><th>Start</th><th>End</th><th>WD</th><th>Status</th><th>Flag</th></tr></thead>
            <tbody>
              {items.map(d => (
                <tr key={d.key} className={`clickable ${d.overdue ? 'row-red' : d.atRisk ? 'row-amber' : d.complete ? 'row-done' : ''}`} onClick={() => go('tracker', { open: d.key })}>
                  <td className="mono nowrap">{d.id}</td>
                  <td className="col-name">{d.name}</td>
                  <td>{d.wsCode}</td>
                  <td>{d.type || <span className="unconfirmed">Not set</span>}</td>
                  <td>{d.oamOwner}</td>
                  <td>{d.sunOwner || <span className="muted">—</span>}</td>
                  <td className="nowrap"><PlanDate v={d.start} label="Not confirmed" /></td>
                  <td className="nowrap"><PlanDate v={d.end} label="Not confirmed" /></td>
                  <td>{d.durationWd ?? '—'}</td>
                  <td><StatusBadge status={d.status} /></td>
                  <td><FlagBadge flag={d.flag} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function NextRow({ d }: { d: Deliverable }) {
  return (
    <li>
      <a href={`#/tracker?open=${encodeURIComponent(d.key)}`}>{d.nextAction || plainName(d.name)}</a>
      <div className="small muted">{d.id}{d.nextAction ? ` · ${plainName(d.name)}` : ''} · {d.actionOwner || d.owner || 'owner not set'} · {d.targetDate ? `target ${fmtDate(d.targetDate)}` : d.end ? `due ${fmtDate(d.end)}` : 'date not confirmed'} <FlagBadge flag={d.flag} /></div>
    </li>
  );
}
