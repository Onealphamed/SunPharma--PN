// Governance: risk & issue log, decision log and dependencies.
import { useEffect, useMemo, useState } from 'react';
import { norm, Rec, splitIds } from '../../../shared/model';
import { isHighRisk, isOpenRaid, plainName, riskSeverity } from '../../../shared/project';
import { canEditField } from '../../../shared/schema';
import { suggestDependencies } from '../../../shared/suggestions';
import { go } from '../App';
import { useData } from '../data';
import { RecordTable } from '../RecordTable';
import { Card, Empty, FlagBadge, Icon, PlanDate, StatusBadge, Tag } from '../ui';

type Tab = 'risks' | 'decisions' | 'dependencies';
const CATS = ['All', 'Risk', 'Issue', 'Dependency', 'Assumption'] as const;
const sevTone = (s: string) => (['critical', 'high'].includes(norm(s)) ? 'red' : norm(s) === 'medium' ? 'amber' : 'neutral');

export function Risks({ params }: { params: URLSearchParams }) {
  const { project: p, internal } = useData();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'risks');
  useEffect(() => {
    if (params.get('tab')) setTab(params.get('tab') as Tab);
  }, [params]);
  const [cat, setCat] = useState<(typeof CATS)[number]>('All');
  const raid = (p.tables.raid ?? []).filter(r => cat === 'All' || r.category === cat);
  const highOpen = (p.tables.raid ?? []).filter(isOpenRaid).filter(isHighRisk);
  const related = (r: Rec) =>
    splitIds(r.related as string).map(id => (
      <a key={id} className="tag tag-neutral mono" href={`#/tracker?open=${encodeURIComponent(id)}`} onClick={e => e.stopPropagation()}>{id}</a>
    ));
  const openCount = (c: string) => (p.tables.raid ?? []).filter(r => r.category === c && isOpenRaid(r)).length;

  return (
    <div className="page">
      <div className="seg big" role="tablist">
        <button role="tab" aria-selected={tab === 'risks'} className={tab === 'risks' ? 'active' : ''} onClick={() => setTab('risks')}>Risks & issues <span className="chip-n">{(p.tables.raid ?? []).filter(isOpenRaid).length} open</span></button>
        <button role="tab" aria-selected={tab === 'decisions'} className={tab === 'decisions' ? 'active' : ''} onClick={() => setTab('decisions')}>Decision log</button>
        <button role="tab" aria-selected={tab === 'dependencies'} className={tab === 'dependencies' ? 'active' : ''} onClick={() => setTab('dependencies')}>Dependencies</button>
      </div>

      {tab === 'risks' && (
        <>
          {highOpen.length > 0 && (
            <div className="notice notice-error"><Icon name="alert" /> {highOpen.length} unresolved high-severity item(s): {highOpen.map(r => `${r._key} ${String(r.title)}`).join('; ')}</div>
          )}
          <Card title="Risk, issue, dependency & assumption log" subtitle={internal ? 'New items start Internal. Set Visibility = Client to share with Sun Pharma; escalation notes are never shared. Severity left blank is derived from Impact × Likelihood and marked “calc.”.' : 'Items shared by the OneAlphaMed project team.'}>
            <RecordTable
              table="raid"
              rows={raid}
              columns={['category', 'title', 'phase', 'related', 'impact', 'likelihood', 'severity', 'owner', 'ownerOrg', 'targetDate', 'status', 'clientDecision', ...(internal ? ['visibility'] : [])]}
              initialSort="id"
              toolbar={
                <div className="seg" role="group" aria-label="Category">
                  {CATS.map(c => <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>{c}{c !== 'All' && <span className="chip-n">{openCount(c)}</span>}</button>)}
                </div>
              }
              render={{
                severity: r => {
                  const s = riskSeverity(r);
                  return s.value ? <Tag tone={sevTone(s.value)} title={s.derived ? 'Derived from Impact × Likelihood' : undefined}>{s.value}{s.derived ? ' (calc.)' : ''}</Tag> : <span className="muted">Not assessed</span>;
                },
                related,
                status: r => <Tag tone={norm(r.status) === 'escalated' ? 'red' : isOpenRaid(r) ? 'amber' : 'green'}>{String(r.status ?? '—')}</Tag>,
                clientDecision: r => (r.clientDecision === 'Yes' ? <Tag tone="purple">Yes</Tag> : <span className="muted">{String(r.clientDecision ?? '—')}</span>),
              }}
              rowTone={r => (isOpenRaid(r) && isHighRisk(r) ? 'red' : undefined)}
              createDefaults={{ category: cat === 'All' ? 'Risk' : cat, status: 'Open', visibility: 'Internal', dateRaised: p.today, clientDecision: 'No' }}
              emptyText="No risks or issues recorded. Nothing is pre-filled: add items as they are identified."
              sections={[
                { title: 'Item', fields: ['category', 'title', 'details', 'status', 'visibility'] },
                { title: 'Links', fields: ['phase', 'related'] },
                { title: 'Assessment', fields: ['impact', 'likelihood', 'severity', 'owner', 'ownerOrg', 'dateRaised', 'targetDate', 'clientDecision'] },
                { title: 'Response', fields: ['mitigation', 'latestUpdate'] },
                { title: 'Internal (OneAlphaMed only)', fields: ['escalation'] },
              ]}
            />
          </Card>
        </>
      )}

      {tab === 'decisions' && (
        <Card title="Decision log" subtitle="Decision required, context, owner, due date, decision made and date recorded.">
          <RecordTable
            table="decisions"
            rows={p.tables.decisions ?? []}
            columns={['decision', 'owner', 'ownerOrg', 'dueDate', 'status', 'finalDecision', 'dateRecorded', 'phase', 'related', 'meetingId', ...(internal ? ['visibility'] : [])]}
            render={{
              related,
              meetingId: r => (r.meetingId ? <a className="mono" href={`#/meetings?id=${encodeURIComponent(String(r.meetingId))}`} onClick={e => e.stopPropagation()}>{String(r.meetingId)}</a> : <span className="muted">—</span>),
              status: r => <Tag tone={norm(r.status) === 'open' ? (r.dueDate && String(r.dueDate) < p.today ? 'red' : 'amber') : 'green'}>{String(r.status ?? '—')}</Tag>,
            }}
            rowTone={r => (norm(r.status) === 'open' && r.dueDate && String(r.dueDate) < p.today ? 'red' : undefined)}
            createDefaults={{ status: 'Open', visibility: 'Internal' }}
            emptyText="No decisions recorded. Decisions can also be added from meeting minutes."
            sections={[
              { title: 'Decision', fields: ['decision', 'context', 'status', 'visibility'] },
              { title: 'Ownership', fields: ['owner', 'ownerOrg', 'dueDate', 'phase', 'related', 'meetingId'] },
              { title: 'Outcome', fields: ['finalDecision', 'dateRecorded'] },
            ]}
          />
        </Card>
      )}

      {tab === 'dependencies' && <Dependencies />}
    </div>
  );
}

function Dependencies() {
  const { project: p, user, update, toast } = useData();
  const [busy, setBusy] = useState<string | null>(null);
  const recorded = p.deliverables.flatMap(d => d.predecessors.map(pr => ({ d, pred: p.byId.get(pr), id: pr })));
  const suggestions = useMemo(() => suggestDependencies(p.deliverables), [p.deliverables]);
  const gating = p.deliverables.filter(d => d.rec.remarks && /gate|before|only after|critical-path|required/i.test(String(d.rec.remarks)));
  const blocking = p.approvals.filter(a => !a.decided && a.downstream > 0);
  const canApply = canEditField(user.role, 'deliverables', 'predecessors');
  const apply = async (succ: string, pred: string) => {
    const d = p.byId.get(succ);
    if (!d) return;
    setBusy(`${succ}>${pred}`);
    try {
      await update('deliverables', d.rec, { predecessors: [...d.predecessors, pred].join(', ') });
    } catch (e) {
      toast(`Not saved — ${(e as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {blocking.length > 0 && (
        <div className="notice notice-error"><Icon name="alert" /> {blocking.length} pending approval(s) gate downstream deliverables: {blocking.map(a => `${a.d.id} (${a.downstream})`).join(', ')}</div>
      )}
      <Card title={`Recorded dependencies (${recorded.length})`} subtitle="Finish-to-start links from the Dependency column. Used for at-risk flags, critical path and slip impact.">
        {recorded.length ? (
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Deliverable</th><th>Waits for</th><th>Prerequisite status</th><th>Prerequisite due</th><th>Impact</th></tr></thead>
              <tbody>
                {recorded.map(({ d, pred, id }, i) => (
                  <tr key={i} className={pred?.overdue ? 'row-red' : ''}>
                    <td><a className="mono" href={`#/tracker?open=${encodeURIComponent(d.key)}`}>{d.id}</a> {plainName(d.name)}</td>
                    <td>{pred ? <><a className="mono" href={`#/tracker?open=${encodeURIComponent(pred.key)}`}>{pred.id}</a> {plainName(pred.name)}</> : <span className="bad">{id} (unknown ID)</span>}</td>
                    <td>{pred ? (pred.complete ? <Tag tone="green">Complete</Tag> : <><StatusBadge status={pred.status} /> <FlagBadge flag={pred.flag} /></>) : '—'}</td>
                    <td className="nowrap"><PlanDate v={pred?.end} label="Not confirmed" /></td>
                    <td className="small">{pred?.overdue ? <span className="bad">Prerequisite overdue — {d.id} is at risk</span> : d.start && pred?.end && d.start <= pred.end ? <span className="warn">Starts before prerequisite ends</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No dependencies recorded yet">The Readiness Checklist has no structured dependencies. Review the suggestions below, or enter IDs in the Dependency column.</Empty>}
      </Card>

      <Card title={`Suggested from checklist remarks (${suggestions.length})`} subtitle="Read from the checklist's own Remarks column. Not applied until you confirm each one.">
        {suggestions.length ? (
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Deliverable</th><th>Should wait for</th><th>Basis in the checklist</th>{canApply && <th />}</tr></thead>
              <tbody>
                {suggestions.map(s => (
                  <tr key={`${s.successor}>${s.predecessor}`}>
                    <td><span className="mono">{s.successor}</span> {plainName(p.byId.get(s.successor)?.name ?? '')}</td>
                    <td><span className="mono">{s.predecessor}</span> {plainName(p.byId.get(s.predecessor)?.name ?? '')}</td>
                    <td className="small">{s.basis}</td>
                    {canApply && <td><button className="btn btn-sm" disabled={!!busy} onClick={() => void apply(s.successor, s.predecessor)}>{busy === `${s.successor}>${s.predecessor}` ? 'Saving…' : 'Apply'}</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No outstanding suggestions" icon="check" />}
      </Card>

      <div className="split">
        <Card title="Gating notes in the checklist" subtitle="Remarks that describe gates or prerequisites (kept verbatim)">
          {gating.length ? (
            <ul className="plain-list">
              {gating.map(d => <li key={d.key}><a className="mono" href={`#/tracker?open=${encodeURIComponent(d.key)}`}>{d.id}</a> {plainName(d.name)} — <em>“{String(d.rec.remarks)}”</em></li>)}
            </ul>
          ) : <Empty title="None" />}
        </Card>
        <Card title="Client-input dependencies" subtitle="Open Client Input deliverables (Sun Pharma) — derived live, not duplicated in the log">
          {p.deliverables.filter(d => d.isClientInput && !d.complete).length ? (
            <ul className="plain-list">
              {p.deliverables.filter(d => d.isClientInput && !d.complete).map(d => (
                <li key={d.key} className="clickable" onClick={() => go('tracker', { open: d.key })}>
                  <span className="mono small">{d.id}</span> {d.name} <span className="small muted">· {d.sunOwner || 'owner not set'} · needed by <PlanDate v={d.end} label="date not confirmed" />{d.successors.length ? ` · blocks ${d.successors.length}` : ''}</span>
                </li>
              ))}
            </ul>
          ) : <Empty title="All client inputs received" icon="check" />}
        </Card>
      </div>
    </>
  );
}
