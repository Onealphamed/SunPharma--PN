// Deliverable tracker (layout modelled on the EAN project tracker): one filter bar, then a
// collapsible section per phase with "N items · X done" and a completion bar, and a table of
// SR · Deliverable · Status · Owners · Start · End · Progress · Delay/Left · Priority.
// Click a row for the full record.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { fmtDate } from '../../../shared/dates';
import { slipImpact, toGraphTasks } from '../../../shared/graph';
import { norm } from '../../../shared/model';
import { Deliverable, groupBy, isArchived, isOpenAction, plainName } from '../../../shared/project';
import { canCreate, PRIORITIES } from '../../../shared/schema';
import { api } from '../api';
import { go } from '../App';
import { useData } from '../data';
import { History } from '../History';
import { FormSection, RecordForm } from '../RecordForm';
import { CompleteBadge, Confirm, D, Drawer, Empty, FlagBadge, Icon, Menu, PlanDate, SearchBox, StatusBadge, Tag } from '../ui';

/**
 * Indicative progress per row, by status stage. Completion itself still counts only
 * "Completion Confirmed = Yes" (shown as 100%); the phase bar uses confirmed completion.
 */
const STATUS_PROGRESS: [string, number][] = [
  ['Yet to Start', 0],
  ['Yet to Assign', 0],
  ['Pending', 0],
  ['In Progress', 50],
  ['On Hold', 50],
  ['In Review', 80],
  ['Under Approval', 90],
  ['Approval', 90],
];
const PROGRESS_BY = new Map(STATUS_PROGRESS.map(([s, v]) => [norm(s), v]));
const progressOf = (d: Deliverable) => (d.complete ? 100 : PROGRESS_BY.get(norm(d.status)) ?? 0);
const PROGRESS_HELP = `Indicative stage by status: ${STATUS_PROGRESS.map(([s, v]) => `${s} ${v}%`).join(' · ')} · Completion confirmed 100%`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Extra views reached from the Executive Summary (shown as a removable chip). */
const VIEWS: Record<string, { label: string; test: (d: Deliverable) => boolean }> = {
  duesoon: { label: 'Due in 7 days', test: d => d.dueSoon },
  attention: { label: 'Overdue & at risk', test: d => d.overdue || d.atRisk },
  approvals: { label: 'Pending approvals', test: d => d.pendingApproval || (!d.complete && d.isApprovalGate) },
  client: { label: 'Pending client inputs', test: d => !d.complete && d.isClientInput },
  sun: { label: 'Awaiting Sun Pharma', test: d => d.awaiting === 'Sun Pharma' },
  oam: { label: 'Awaiting OneAlphaMed', test: d => d.awaiting === 'OneAlphaMed' },
  unscheduled: { label: 'Date not confirmed', test: d => !d.complete && !d.scheduled },
};

export const DELIVERABLE_SECTIONS: FormSection[] = [
  { title: 'Scope (from the Readiness Checklist)', fields: ['name', 'type', 'phase', 'workstream', 'description', 'remarks'] },
  { title: 'Ownership', fields: ['lead', 'leadFunction', 'oamOwner', 'sunOwner'] },
  { title: 'Schedule', fields: ['plannedStart', 'plannedEnd', 'durationWd', 'actualStart', 'actualEnd', 'predecessors', 'baselineStart', 'baselineEnd', 'keyMilestone'] },
  { title: 'Status & completion', fields: ['status', 'completionConfirmed', 'priority', 'risk'] },
  { title: 'Next action', fields: ['nextAction', 'actionOwner', 'targetDate'] },
  { title: 'Client approval', fields: ['approvalStatus', 'clientApprover', 'dateSubmitted', 'reviewTurnaroundWd', 'approvalDue', 'lastFollowUp', 'nextFollowUp', 'approvalFeedback'] },
  { title: 'Internal (OneAlphaMed only)', fields: ['internalNotes', 'clientVisible', 'sortOrder', 'scheduleFlagSource', 'statusOriginal', 'sourceRow'] },
];
const CLIENT_SECTIONS = DELIVERABLE_SECTIONS.slice(0, 6);

export function Tracker({ params }: { params: URLSearchParams }) {
  const { project: p, user, toast } = useData();
  const [q, setQ] = useState('');
  const [phase, setPhase] = useState('');
  const [oam, setOam] = useState('');
  const [sun, setSun] = useState('');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [view, setView] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  // null = untouched: the first phase starts open (as in the reference tracker).
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [adding, setAdding] = useState(false);

  // Links from the Executive Summary: ?filter=status:X | overdue | complete | duesoon | approvals …, ?phase=, ?open=
  useEffect(() => {
    const f = params.get('filter') ?? '';
    setStatus(f.startsWith('status:') ? f.slice(7) : f === 'overdue' ? '__overdue' : f === 'complete' ? '__complete' : '');
    setView(VIEWS[f] ? f : '');
    setPhase(params.get('phase') ?? '');
    setOpen(params.get('open'));
  }, [params]);

  const ds = p.deliverables;
  const opts = useMemo(() => {
    const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const dates = ds.map(d => d.end ?? d.start).filter((x): x is string => !!x);
    return {
      oam: uniq(ds.map(d => d.oamOwner)),
      sun: uniq(ds.map(d => d.sunOwner)),
      months: [...new Set(dates.map(x => +x.slice(5, 7)))].sort((a, b) => a - b),
      years: uniq(dates.map(x => x.slice(0, 4))),
    };
  }, [ds]);

  const filtered = useMemo(() => {
    const qq = norm(q);
    return ds.filter(d => {
      const date = d.end ?? d.start;
      return (
        (!phase || d.phase === phase) &&
        (!oam || d.oamOwner === oam) &&
        (!sun || d.sunOwner === sun) &&
        (!priority || (priority === '__none' ? !d.priority : d.priority === priority)) &&
        (!status ||
          (status === '__overdue' ? d.overdue
            : status === '__complete' ? d.complete
            : status === '__none' ? d.category === 'Unmapped'
            : norm(d.status) === norm(status) && !d.complete)) &&
        (!month || (!!date && +date.slice(5, 7) === +month)) &&
        (!year || (!!date && date.startsWith(year))) &&
        (!view || VIEWS[view].test(d)) &&
        (!qq || [d.name, d.rec.description, d.oamOwner, d.sunOwner, d.workstream, d.leadFunction, d.actionOwner, d.rec.remarks].some(v => norm(v).includes(qq)))
      );
    });
  }, [ds, q, phase, oam, sun, priority, status, month, year, view]);

  const active = [q, phase, oam, sun, priority, status, month, year, view].filter(Boolean).length;
  const clear = () => {
    setQ(''); setPhase(''); setOam(''); setSun(''); setPriority(''); setStatus(''); setMonth(''); setYear(''); setView('');
    go('tracker');
  };
  // With a filter applied, show every phase that has matches; otherwise the user's own choice.
  const isOpen = (ph: string) => (active ? true : expanded ? expanded.has(ph) : ph === p.phases[0]?.phase);
  const togglePhase = (ph: string) => setExpanded(s => {
    const n = new Set(s ?? p.phases.filter(x => isOpen(x.phase)).map(x => x.phase));
    if (n.has(ph)) n.delete(ph);
    else n.add(ph);
    return n;
  });
  const doExport = async (format: 'xlsx' | 'csv', all = false) => {
    try {
      await api.exportTable('deliverables', format, all ? undefined : filtered.map(d => d.key));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const closeDrawer = () => {
    setOpen(null);
    if (params.get('open')) go('tracker');
  };
  const openD = open ? p.byId.get(open) : undefined;
  const sel = (label: string, value: string, set: (v: string) => void, options: [string, string][]) => (
    <label className="tf">
      <span>{label}</span>
      <select value={value} onChange={e => set(e.target.value)} aria-label={label}>
        <option value="">All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <div className="page tracker">
      <div className="tracker-filters card">
        <SearchBox value={q} onChange={setQ} placeholder="Search deliverables, owners, remarks…" />
        {sel('Phase', phase, setPhase, p.phases.map(x => [x.phase, x.name]))}
        {sel('Owner (OAM)', oam, setOam, opts.oam.map(o => [o, o]))}
        {sel('Owner (Client)', sun, setSun, opts.sun.map(o => [o, o]))}
        {sel('Priority', priority, setPriority, [...PRIORITIES.map(x => [x, x] as [string, string]), ['__none', 'Not set']])}
        {sel('Status', status, setStatus, [
          ...p.statuses.list.map(s => [s.status, s.status] as [string, string]),
          ['__complete', 'Completed'],
          ['__overdue', 'Overdue'],
          ['__none', 'Status not set'],
        ])}
        {sel('Month', month, setMonth, opts.months.map(m => [String(m), MONTHS[m - 1]]))}
        {sel('Year', year, setYear, opts.years.map(y => [y, y]))}
        <button className="btn btn-sm" onClick={clear} disabled={!active}>Clear</button>
      </div>

      <div className="tracker-title">
        <h2>Deliverable Tracker</h2>
        <span className="muted small">Phase → Workstream → Task · click a row for full detail</span>
        {view && <Tag tone="blue">{VIEWS[view].label} <button className="tag-x" aria-label="Remove view" onClick={() => { setView(''); go('tracker'); }}>×</button></Tag>}
        <span className="spacer" />
        <span className="muted small">{filtered.length} of {ds.length}</span>
        <Menu label="Export" icon="download">
          <button onClick={() => doExport('xlsx')}>Excel (.xlsx) — {filtered.length} rows</button>
          <button onClick={() => doExport('csv')}>CSV — {filtered.length} rows</button>
          <button onClick={() => doExport('xlsx', true)}>Excel (.xlsx) — complete tracker</button>
        </Menu>
        {canCreate(user.role, 'deliverables') && <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Icon name="plus" /> Add</button>}
      </div>

      {filtered.length === 0 ? (
        <Empty title="No deliverables match these filters"><button className="btn btn-sm" onClick={clear}>Clear filters</button></Empty>
      ) : (
        p.phases.map(ph => {
          const items = filtered.filter(d => d.phase === ph.phase);
          if (!items.length) return null;
          const done = items.filter(d => d.complete).length;
          const pct = Math.round((done / items.length) * 100);
          const opened = isOpen(ph.phase);
          let sr = 0;
          return (
            <section key={ph.phase} className="tphase card">
              <button className="tphase-head" onClick={() => togglePhase(ph.phase)} aria-expanded={opened}>
                <Icon name={opened ? 'down' : 'chevron'} />
                <strong>{ph.name}</strong>
                <span className="muted small">{items.length} items · {done} done{items.some(d => d.overdue) ? ` · ${items.filter(d => d.overdue).length} overdue` : ''}</span>
                <span className="spacer" />
                <span className="tphase-bar" title="Completion confirmed"><i style={{ width: `${pct}%` }} /></span>
                <b className="tphase-pct">{pct}%</b>
              </button>
              {opened && (
                <div className="table-wrap tphase-table">
                  <table className="grid ttable">
                    <thead>
                      <tr>
                        <th className="c-sr">SR</th>
                        <th>Deliverable</th>
                        <th>Status</th>
                        <th>Owner (OAM)</th>
                        <th>Owner (Client)</th>
                        <th>Start</th>
                        <th>End</th>
                        <th title={PROGRESS_HELP}>Progress</th>
                        <th>Delay / Left</th>
                        <th>Priority</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupBy(items, d => d.workstream).map(([ws, rows]) => (
                        <Fragment key={ws}>
                          <tr className="tws-row"><td colSpan={10}>{rows[0].wsCode} {ws} <span className="muted small">· {rows.length}</span></td></tr>
                          {rows.map(d => {
                            sr++;
                            const prog = progressOf(d);
                            return (
                              <tr key={d.key} className={`clickable${d.overdue ? ' row-red' : d.complete ? ' row-done' : ''}`} onClick={() => setOpen(d.key)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && setOpen(d.key)}>
                                <td className="c-sr muted">{sr}</td>
                                <td className="c-name">
                                  <strong>{d.name || <em className="muted">(no name)</em>}</strong>
                                  {d.rec.description && <span className="c-desc">{String(d.rec.description)}</span>}
                                </td>
                                <td>{d.complete ? <CompleteBadge /> : <StatusBadge status={d.status} />}</td>
                                <td>{d.oamOwner || <span className="muted">—</span>}</td>
                                <td>{d.sunOwner || <span className="muted">—</span>}</td>
                                <td className="nowrap">{d.start ? fmtDate(d.start, { year: false }) : <span className="muted">—</span>}</td>
                                <td className="nowrap">{d.end ? fmtDate(d.end, { year: false }) : <span className="muted">—</span>}</td>
                                <td>
                                  <span className="tprog" title={PROGRESS_HELP}>
                                    <span className="tprog-bar"><i style={{ width: `${prog}%`, background: d.complete ? 'var(--green)' : p.statuses.color(d.status) }} /></span>
                                    <span className="tprog-pct">{prog}%</span>
                                  </span>
                                </td>
                                <td className="nowrap">
                                  {d.complete ? <span className="ok">Done</span> : d.overdue ? <span className="bad">+{d.overdueDays}d</span> : d.daysRemaining !== null ? (d.daysRemaining === 0 ? 'Today' : `${d.daysRemaining}d`) : <span className="muted">—</span>}
                                </td>
                                <td>{d.priority ? <span className={`ppill ppill-${norm(d.priority)}`}>{d.priority}</span> : <span className="muted small">Not set</span>}</td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })
      )}

      <Drawer open={!!openD} wide onClose={closeDrawer} title={openD ? plainName(openD.name) : ''} subtitle={openD && <DeliverableHeader d={openD} />}>
        {openD && <DeliverableDetail d={openD} />}
      </Drawer>
      {open && !openD && (
        <Drawer open onClose={closeDrawer} title="Deliverable not found">
          <Empty title="Deliverable not found">It may have been archived, or is not visible to your role.</Empty>
        </Drawer>
      )}
      <Drawer open={adding} wide onClose={() => setAdding(false)} title="Add deliverable" subtitle="Dates can stay blank until confirmed.">
        {adding && (
          <RecordForm
            table="deliverables"
            rec={null}
            sections={DELIVERABLE_SECTIONS.slice(0, 5)}
            defaults={{ phase: phase || p.phases[0]?.phase, type: 'Task', lead: 'OAM' }}
            onDone={id => { setAdding(false); setOpen(id); }}
            onCancel={() => setAdding(false)}
          />
        )}
      </Drawer>
    </div>
  );
}

function DeliverableHeader({ d }: { d: Deliverable }) {
  return (
    <div className="detail-head">
      <StatusBadge status={d.status} />
      {d.complete && <CompleteBadge />}
      <FlagBadge flag={d.flag} />
      {d.type && <span className={`type type-${norm(d.type).replace(/\s/g, '-')}`}>{d.type}</span>}
      <span>{d.phase} › {d.workstream}</span>
      <span><PlanDate v={d.start} /> → <PlanDate v={d.end} /> {d.durationWd !== null ? `· ${d.durationWd} WD` : ''}</span>
    </div>
  );
}

/** A linked deliverable, shown by name. */
function DeliverableLink({ id }: { id: string }) {
  const { project: p } = useData();
  const name = p.byId.get(id)?.name;
  return <a className="tag tag-neutral" href={`#/tracker?open=${encodeURIComponent(id)}`}>{name ? plainName(name) : 'Linked deliverable'}</a>;
}

function DeliverableDetail({ d }: { d: Deliverable }) {
  const { internal, project: p, user, archive, toast } = useData();
  const [slip, setSlip] = useState(5);
  const [confirm, setConfirm] = useState(false);
  const tasks = useMemo(() => toGraphTasks(p.deliverables.map(x => ({ id: x.key, start: x.start, end: x.end, predecessors: x.predecessors.join(','), complete: x.complete }))), [p.deliverables]);
  const impact = useMemo(() => (d.successors.length && d.scheduled ? slipImpact(tasks, d.key, slip, p.cal) : []), [tasks, d, slip, p.cal]);
  const actions = (p.tables.actions ?? []).filter(a => a.related === d.key && !isArchived(a));

  return (
    <div className="detail">
      <div className="detail-cards">
        <div className="mini"><span>Schedule flag</span><strong><FlagBadge flag={d.flag} /></strong></div>
        <div className="mini"><span>{d.complete ? 'Completed' : d.overdue ? 'Overdue by' : 'Days remaining'}</span><strong className={d.overdue ? 'bad' : ''}>{d.complete ? <D v={d.actualEnd} empty="Date not recorded" /> : d.overdue ? `${d.overdueDays} days` : d.daysRemaining ?? <span className="unconfirmed">Date not confirmed</span>}</strong></div>
        <div className="mini"><span>Duration / planned window</span><strong>{d.durationWd ?? '—'} WD{d.windowWd !== null ? ` / ${d.windowWd} WD` : ''}</strong></div>
        <div className="mini"><span>Awaiting</span><strong>{d.awaiting ?? '—'}</strong></div>
        {d.float !== null && <div className="mini"><span>Total float</span><strong>{d.float} WD</strong></div>}
      </div>
      {d.riskReasons.length > 0 && <div className="notice notice-warn"><Icon name="alert" /> {d.riskReasons.join(' · ')}</div>}

      <section className="deps">
        <h3>Dependencies & impact</h3>
        <p className="small">
          <strong>Depends on:</strong> {d.predecessors.length ? d.predecessors.map(x => <DeliverableLink key={x} id={x} />) : <span className="muted">none recorded</span>}
          {'  '}
          <strong>Blocks:</strong> {d.successors.length ? d.successors.map(x => <DeliverableLink key={x} id={x} />) : <span className="muted">nothing recorded</span>}
        </p>
        {d.successors.length > 0 && d.scheduled ? (
          <div className="impact">
            <label className="inline">
              If this finishes
              <input type="number" min={1} max={60} value={slip} onChange={e => setSlip(Math.max(1, Number(e.target.value) || 1))} style={{ width: 64 }} />
              working days late:
            </label>
            {impact.length ? (
              <ul>
                {impact.map(i => <li key={i.id}>{plainName(p.byId.get(i.id)?.name ?? '')} — moves to <D v={i.newStart} /> → <D v={i.newEnd} /> <span className="bad">(+{i.slipWd} WD)</span></li>)}
              </ul>
            ) : <p className="small ok">Downstream items have enough slack — no knock-on delay.</p>}
          </div>
        ) : (
          <p className="muted small">{d.successors.length ? 'Slip impact needs confirmed dates on this item and its dependants.' : 'No downstream dependencies recorded.'}</p>
        )}
      </section>

      <Comments d={d} />

      <section className="deps">
        <div className="row between">
          <h3>Linked action items ({actions.length})</h3>
          <a className="btn btn-sm" href="#/meetings?tab=actions">All actions</a>
        </div>
        {actions.length ? (
          <ul className="plain-list">
            {actions.map(a => (
              <li key={a._key} className={isOpenAction(a) && a.dueDate && String(a.dueDate) < p.today ? 'bad' : ''}>
                {String(a.action)} · {String(a.owner ?? 'no owner')} · due <D v={a.dueDate} /> · <Tag tone={isOpenAction(a) ? 'amber' : 'green'}>{String(a.status)}</Tag>
              </li>
            ))}
          </ul>
        ) : <p className="muted small">No meeting actions are linked to this deliverable.</p>}
      </section>

      <RecordForm key={`${d.key}-${d.lastUpdated}`} table="deliverables" rec={d.rec} sections={internal ? DELIVERABLE_SECTIONS : CLIENT_SECTIONS} />
      {internal && <History recordId={d.key} />}
      {user.role === 'admin' && (
        <div className="danger-zone">
          <button className="btn btn-danger-ghost btn-sm" onClick={() => setConfirm(true)}>Archive deliverable…</button>
        </div>
      )}
      <Confirm
        open={confirm}
        title={`Archive “${plainName(d.name)}”?`}
        danger
        confirmLabel="Archive"
        body={<p>The row stays in the Google Sheet with Archived = Yes and is removed from all dashboard counts. Undo by setting Archived back to “No” in the sheet. Deliverables are never hard-deleted.</p>}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          try {
            await archive('deliverables', d.rec);
          } catch (e) {
            toast((e as Error).message, 'error');
          }
        }}
      />
      {!internal && <p className="muted small">Read-only view. Updates are maintained by the OneAlphaMed project team.</p>}
      <p className="muted small">Last updated {d.lastUpdated ? d.lastUpdated.replace('T', ' ').replace('Z', ' UTC') : '—'}{internal && d.rec.sourceRow ? ` · Readiness Checklist row ${d.rec.sourceRow}` : ''}</p>
    </div>
  );
}

function Comments({ d }: { d: Deliverable }) {
  const { project: p, user, internal, create, toast } = useData();
  const [text, setText] = useState('');
  const [vis, setVis] = useState<'Internal' | 'Client'>('Internal');
  const [busy, setBusy] = useState(false);
  const list = (p.tables.comments ?? []).filter(c => c.deliverableId === d.key && !isArchived(c)).sort((a, b) => String(b.postedAt ?? '').localeCompare(String(a.postedAt ?? '')));
  const post = async () => {
    setBusy(true);
    try {
      await create('comments', { deliverableId: d.key, comment: text, visibility: vis });
      setText('');
    } catch (e) {
      toast(`Comment not saved — ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="deps">
      <h3>Comments & updates ({list.length})</h3>
      {canCreate(user.role, 'comments') && (
        <div className="row" style={{ marginTop: 6, alignItems: 'flex-start' }}>
          <textarea rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Add an update…" aria-label="New comment" style={{ flex: 1 }} />
          <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <select value={vis} onChange={e => setVis(e.target.value as 'Internal' | 'Client')} aria-label="Comment visibility">
              <option value="Internal">Internal only</option>
              <option value="Client">Visible to Sun Pharma</option>
            </select>
            <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={() => void post()}>{busy ? 'Saving…' : 'Post'}</button>
          </div>
        </div>
      )}
      {list.length ? (
        <ul className="comments">
          {list.map(c => (
            <li key={c._key}>
              <div className="meta"><strong>{String(c.author ?? '')}</strong> {c.postedAt ? fmtDate(String(c.postedAt).slice(0, 10)) : ''} {internal && <Tag tone={c.visibility === 'Client' ? 'blue' : 'neutral'}>{c.visibility === 'Client' ? 'Client visible' : 'Internal'}</Tag>}</div>
              <div className="prewrap">{String(c.comment ?? '')}</div>
            </li>
          ))}
        </ul>
      ) : <p className="muted small">No comments yet.</p>}
    </section>
  );
}
