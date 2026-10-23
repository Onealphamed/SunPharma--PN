// Items needing Sun Pharma's attention: approvals (workflow status kept separate from the
// decision) and client inputs. No email or notification is ever sent from here.
import { useState } from 'react';
import { fmtDate } from '../../../shared/dates';
import { plainName } from '../../../shared/project';
import { go } from '../App';
import { useData } from '../data';
import { Card, D, Empty, FlagBadge, Icon, PlanDate, StatusBadge, Tag } from '../ui';

const decisionTone = (s: string) => (s === 'Approved' ? 'green' : s === 'Rejected' ? 'red' : s === 'Pending Approval' ? 'amber' : 'neutral');

export function Approvals() {
  const { project: p, internal } = useData();
  const [showDecided, setShowDecided] = useState(false);
  const s = p.settings;
  const approvals = p.approvals.filter(a => showDecided || !a.decided);
  const overdue = p.approvals.filter(a => a.overdue);
  const blocking = p.approvals.filter(a => !a.decided && a.downstream > 0);
  const inputs = p.deliverables.filter(d => d.isClientInput && (showDecided || !d.complete));
  const open = (k: string) => go('tracker', { open: k });

  return (
    <div className="page">
      <div className="notice notice-warn">
        <Icon name="alert" /> Review turnaround: <strong>{s.reviewTurnaroundWd} working days</strong> — {s.reviewTurnaroundConfirmed ? 'confirmed by Sun Pharma.' : 'a proposed assumption from the checklist until Sun Pharma confirms it (Settings › Review Turnaround Confirmed).'} Approval due dates without a recorded date are calculated as Submission Date + turnaround.
      </div>
      <div className="toolbar">
        <label className="inline"><input type="checkbox" checked={showDecided} onChange={e => setShowDecided(e.target.checked)} /> Include decided / completed items</label>
        <div className="spacer" />
        <span className="muted small">{p.approvals.filter(a => !a.decided).length} open approvals · {p.deliverables.filter(d => d.isClientInput && !d.complete).length} open client inputs</span>
      </div>
      {overdue.length > 0 && <div className="notice notice-error"><Icon name="alert" /> {overdue.length} approval decision(s) are past their due date{blocking.some(a => a.overdue) ? ' and are holding up dependent deliverables' : ''}.</div>}

      <Card title={`Approvals (${approvals.length})`} subtitle="Approval gates and items under approval. Workflow Status and the Client Approval Status (the decision) are shown separately.">
        {approvals.length === 0 ? <Empty title="No approvals pending" icon="check" /> : (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Deliverable requiring approval</th><th>Phase / workstream</th><th>Deliverable owner</th><th>Client approver</th><th>Submitted</th><th>Turnaround</th><th>Approval due</th>
                  <th>Approval status</th><th>Feedback received</th><th>Latest follow-up</th><th>Next follow-up action</th><th>Days awaiting</th><th>Gates</th>
                </tr>
              </thead>
              <tbody>
                {approvals.map(a => (
                  <tr key={a.d.key} className={`clickable ${a.overdue ? 'row-red' : a.downstream && !a.decided ? 'row-amber' : ''}`} onClick={() => open(a.d.key)}>
                    <td className="col-name"><strong>{plainName(a.d.name)}</strong><div className="small muted"><span className="mono">{a.d.id}</span> · {a.d.type} · <StatusBadge status={a.d.status} /></div></td>
                    <td className="small">{a.d.phase} › {a.d.workstream}</td>
                    <td>{a.owner || <span className="muted">—</span>}</td>
                    <td>{a.approver || <span className="muted">Not set</span>}</td>
                    <td className="nowrap"><D v={a.dateSubmitted} empty="Not submitted" /></td>
                    <td className="small nowrap" title={a.turnaroundBasis}>{a.turnaroundWd} WD{a.turnaroundBasis === 'project default (proposed)' && <div className="unconfirmed">proposed</div>}</td>
                    <td className="nowrap"><span className={a.overdue ? 'bad' : ''}><PlanDate v={a.due} label="Not confirmed" /></span>{a.due && a.dueBasis !== 'recorded' && <div className="small muted">{a.dueBasis}</div>}</td>
                    <td><Tag tone={decisionTone(a.approvalStatus)}>{a.approvalStatus}</Tag>{!a.approvalStatusRecorded && <div className="small muted">derived</div>}</td>
                    <td className="small"><span className="clamp">{a.feedback || '—'}</span></td>
                    <td className="nowrap"><D v={a.lastFollowUp} /></td>
                    <td className="small">{a.nextFollowUp || <span className="muted">—</span>}</td>
                    <td>{a.daysAwaiting ?? <span className="muted">—</span>}</td>
                    <td>{a.downstream ? <Tag tone={a.overdue ? 'red' : 'amber'}>{a.downstream} item(s)</Tag> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {internal && <p className="small muted">Open an item to record submission date, decision, feedback and follow-ups. Nothing on this page sends emails or approval requests.</p>}
      </Card>

      <Card title={`Client inputs (${inputs.length})`} subtitle="Deliverables of type “Client Input” — information or decisions Sun Pharma provides">
        {inputs.length === 0 ? <Empty title="No client inputs outstanding" icon="check" /> : (
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Input required</th><th>Phase / workstream</th><th>Sun Pharma owner</th><th>Lead function</th><th>Needed by</th><th>Status</th><th>Flag</th><th>Latest follow-up</th><th>Next follow-up action</th><th>Blocks</th></tr></thead>
              <tbody>
                {inputs.map(d => (
                  <tr key={d.key} className={`clickable ${d.overdue ? 'row-red' : d.atRisk ? 'row-amber' : ''}`} onClick={() => open(d.key)}>
                    <td className="col-name"><strong>{d.name}</strong><div className="small muted clamp">{String(d.rec.description ?? '')}</div><span className="mono small">{d.id}</span></td>
                    <td className="small">{d.phase} › {d.workstream}</td>
                    <td>{d.sunOwner || <span className="muted">Not set</span>}</td>
                    <td className="small">{d.leadFunction}</td>
                    <td className="nowrap"><PlanDate v={d.end} label="Not confirmed" /></td>
                    <td>{d.complete ? <Tag tone="green">Complete</Tag> : <StatusBadge status={d.status} />}</td>
                    <td><FlagBadge flag={d.flag} /></td>
                    <td className="nowrap">{d.rec.lastFollowUp ? fmtDate(String(d.rec.lastFollowUp)) : <span className="muted">—</span>}</td>
                    <td className="small">{String(d.rec.nextFollowUp ?? '') || <span className="muted">—</span>}</td>
                    <td>{d.successors.length ? `${d.successors.length} item(s)` : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
