// Detailed Deliverables Tracker — the primary operational view.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { fmtDate } from '../../../shared/dates';
import { slipImpact, toGraphTasks } from '../../../shared/graph';
import { norm } from '../../../shared/model';
import { Deliverable, groupBy, isArchived, isOpenAction, plainName } from '../../../shared/project';
import { canCreate, canEditField, PRIORITIES, SCHEDULE_FLAGS } from '../../../shared/schema';
import { api } from '../api';
import { go } from '../App';
import { useData } from '../data';
import { History } from '../History';
import { FormSection, RecordForm } from '../RecordForm';
import { CompleteBadge, Confirm, D, Drawer, Empty, FlagBadge, Icon, Menu, PlanDate, SearchBox, StatusBadge, Tag } from '../ui';

type ColKey =
  | 'phase' | 'workstream' | 'name' | 'type' | 'leadFunction' | 'oamOwner' | 'sunOwner' | 'start' | 'end' | 'duration' | 'status' | 'complete'
  | 'priority' | 'flag' | 'dependency' | 'nextAction' | 'actionOwner' | 'targetDate' | 'remarks' | 'updated' | 'approval' | 'actualEnd';

const COLS: { key: ColKey; label: string; default?: boolean }[] = [
  { key: 'name', label: 'Task / Activity', default: true },
  { key: 'phase', label: 'Phase' },
  { key: 'workstream', label: 'Workstream' },
  { key: 'type', label: 'Type', default: true },
  { key: 'leadFunction', label: 'Lead Function' },
  { key: 'oamOwner', label: 'OneAlphaMed Owner', default: true },
  { key: 'sunOwner', label: 'Sun Pharma Owner', default: true },
  { key: 'start', label: 'Start Date', default: true },
  { key: 'end', label: 'End Date', default: true },
  { key: 'duration', label: 'Duration (WD)', default: true },
  { key: 'status', label: 'Status', default: true },
  { key: 'complete', label: 'Completion' },
  { key: 'priority', label: 'Priority', default: true },
  { key: 'flag', label: 'Schedule Flag', default: true },
  { key: 'dependency', label: 'Dependency' },
  { key: 'nextAction', label: 'Next Action', default: true },
  { key: 'actionOwner', label: 'Action Owner' },
  { key: 'targetDate', label: 'Target Date' },
  { key: 'approval', label: 'Client Approval Status' },
  { key: 'actualEnd', label: 'Actual Completion' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'updated', label: 'Last Updated' },
];

const QUICK: { key: string; label: string; test: (d: Deliverable) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'overdue', label: 'Overdue only', test: d => d.overdue },
  { key: 'duesoon', label: 'Due in 7 days', test: d => d.dueSoon },
  { key: 'attention', label: 'Overdue & at risk', test: d => d.overdue || d.atRisk },
  { key: 'client', label: 'Pending client inputs', test: d => !d.complete && d.isClientInput },
  { key: 'approvals', label: 'Pending approvals', test: d => d.pendingApproval || (!d.complete && d.isApprovalGate) },
  { key: 'sun', label: 'Awaiting Sun Pharma', test: d => d.awaiting === 'Sun Pharma' },
  { key: 'oam', label: 'Awaiting OneAlphaMed', test: d => d.awaiting === 'OneAlphaMed' },
  { key: 'unscheduled', label: 'Date not confirmed', test: d => !d.complete && !d.scheduled },
  { key: 'complete', label: 'Completed', test: d => d.complete },
];

const PRIORITY_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

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

function loadCols(): ColKey[] {
  try {
    const v = JSON.parse(localStorage.getItem('sunpm.cols') ?? 'null');
    if (Array.isArray(v) && v.every(k => COLS.some(c => c.key === k))) return v;
  } catch {
    /* storage unavailable */
  }
  return COLS.filter(c => c.default).map(c => c.key);
}

export function Tracker({ params }: { params: URLSearchParams }) {
  const { project: p, user, internal, update, bulkUpdate, toast } = useData();
  const fromParam = params.get('filter') ?? 'all';
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState(fromParam.startsWith('status:') ? 'all' : fromParam);
  const [status, setStatus] = useState(fromParam.startsWith('status:') ? fromParam.slice(7) : '');
  const [phase, setPhase] = useState(params.get('phase') ?? '');
  const [ws, setWs] = useState('');
  const [oam, setOam] = useState('');
  const [sun, setSun] = useState('');
  const [fn, setFn] = useState('');
  const [priority, setPriority] = useState('');
  const [flag, setFlag] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [group, setGroup] = useState<'ws' | 'phase' | 'flat'>('ws');
  const [sort, setSort] = useState<{ key: 'order' | 'end' | 'start' | 'status' | 'priority' | 'id' | 'flag'; dir: 1 | -1 }>({ key: 'order', dir: 1 });
  const [cols, setCols] = useState<ColKey[]>(loadCols);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(params.get('open'));
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (params.get('open')) setOpen(params.get('open'));
    const f = params.get('filter');
    if (f) {
      if (f.startsWith('status:')) {
        setStatus(f.slice(7));
        setQuick('all');
      } else {
        setQuick(f);
        setStatus('');
      }
    }
    if (params.get('phase')) setPhase(params.get('phase')!);
  }, [params]);

  useEffect(() => {
    try {
      localStorage.setItem('sunpm.cols', JSON.stringify(cols));
    } catch {
      /* storage unavailable */
    }
  }, [cols]);

  const ds = p.deliverables;
  const opts = useMemo(() => {
    const uniq = (f: (d: Deliverable) => string) => [...new Set(ds.map(f).filter(Boolean))].sort();
    return { ws: uniq(d => (phase && d.phase !== phase ? '' : d.workstream)), oam: uniq(d => d.oamOwner), sun: uniq(d => d.sunOwner), fn: uniq(d => d.leadFunction) };
  }, [ds, phase]);

  const filtered = useMemo(() => {
    const qq = norm(q);
    const qt = QUICK.find(x => x.key === quick) ?? QUICK[0];
    let out = ds.filter(d =>
      qt.test(d) &&
      (!status || (status === '(none)' ? d.category === 'Unmapped' : d.status === status && !d.complete)) &&
      (!phase || d.phase === phase) &&
      (!ws || d.workstream === ws) &&
      (!oam || d.oamOwner === oam) &&
      (!sun || d.sunOwner === sun) &&
      (!fn || d.leadFunction === fn) &&
      (!priority || (priority === '(not set)' ? !d.priority : d.priority === priority)) &&
      (!flag || d.flag === flag) &&
      (!from || (d.end ?? '') >= from) &&
      (!to || (d.start ?? '9999') <= to) &&
      (!qq || [d.id, d.name, d.rec.description, d.oamOwner, d.sunOwner, d.leadFunction, d.actionOwner, d.rec.remarks].some(v => norm(v).includes(qq))),
    );
    const flagRank = (d: Deliverable) => SCHEDULE_FLAGS.indexOf(d.flag);
    const cmp: Record<string, (a: Deliverable, b: Deliverable) => number> = {
      order: (a, b) => a.sortOrder - b.sortOrder,
      id: (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }),
      end: (a, b) => (a.end ?? '9999').localeCompare(b.end ?? '9999'),
      start: (a, b) => (a.start ?? '9999').localeCompare(b.start ?? '9999'),
      status: (a, b) => (p.statuses.get(a.status)?.order ?? 99) - (p.statuses.get(b.status)?.order ?? 99),
      priority: (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9),
      flag: (a, b) => flagRank(b) - flagRank(a),
    };
    return [...out].sort((a, b) => cmp[sort.key](a, b) * sort.dir || a.sortOrder - b.sortOrder);
  }, [ds, q, quick, status, phase, ws, oam, sun, fn, priority, flag, from, to, sort, p.statuses]);

  const groups: [string, Deliverable[]][] =
    group === 'flat' ? [['', filtered]] : group === 'phase' ? groupBy(filtered, d => d.phase) : groupBy(filtered, d => `${d.phase}|${d.wsCode} ${d.workstream}`);
  const phaseName = (ph: string) => p.phases.find(x => x.phase === ph)?.name ?? ph;
  const groupLabel = (g: string) => (group === 'phase' ? phaseName(g) : `${phaseName(g.split('|')[0])} › ${g.split('|')[1]}`);
  const activeFilters = [status, phase, ws, oam, sun, fn, priority, flag, from, to, q].filter(Boolean).length + (quick !== 'all' ? 1 : 0);
  const clear = () => {
    setQ(''); setQuick('all'); setStatus(''); setPhase(''); setWs(''); setOam(''); setSun(''); setFn(''); setPriority(''); setFlag(''); setFrom(''); setTo('');
    go('tracker');
  };
  const canEdit = (k: string) => canEditField(user.role, 'deliverables', k);
  const toggle = (set: Set<string>, k: string) => {
    const n = new Set(set);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  };
  const save = async (d: Deliverable, changes: Record<string, unknown>) => {
    try {
      await update('deliverables', d.rec, changes);
    } catch (err) {
      toast(`Not saved — ${(err as Error).message}`, 'error');
    }
  };
  const doExport = async (format: 'xlsx' | 'csv', all = false) => {
    try {
      await api.exportTable('deliverables', format, all ? undefined : filtered.map(d => d.key));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const selectedRecs = ds.filter(d => selected.has(d.key) && !d.rec._readonly).map(d => d.rec);
  const bulk = async (changes: Record<string, unknown>) => {
    try {
      await bulkUpdate('deliverables', selectedRecs, changes);
      setSelected(new Set());
    } catch (e) {
      toast(`Bulk update not saved — ${(e as Error).message}`, 'error');
    }
  };

  const cell = (d: Deliverable, k: ColKey) => {
    const r = d.rec;
    const ro = !!r._readonly;
    switch (k) {
      case 'name':
        return (
          <div className="name-cell">
            <button className="link" onClick={() => setOpen(d.key)}>{d.name || <em className="muted">(no name)</em>}</button>
            <span className="flags">
              {d.critical && <Tag tone="red" title="On the critical path">critical path</Tag>}
              {ro && <Tag tone="red" title={String(r._readonly)}>read-only</Tag>}
              {internal && r.clientVisible === 'No' && <Tag tone="neutral" title="Hidden from Sun Pharma">internal</Tag>}
              {(p.tables.comments ?? []).some(c => c.deliverableId === d.key && !isArchived(c)) && <Tag tone="blue" title="Has comments"><Icon name="comment" size={11} /> {(p.tables.comments ?? []).filter(c => c.deliverableId === d.key && !isArchived(c)).length}</Tag>}
            </span>
          </div>
        );
      case 'phase': return d.phase;
      case 'workstream': return d.workstream;
      case 'type': return d.type ? <span className={`type type-${norm(d.type).replace(/\s/g, '-')}`}>{d.type}</span> : <span className="unconfirmed">Not set</span>;
      case 'leadFunction': return d.leadFunction || <span className="muted">—</span>;
      case 'oamOwner': return d.oamOwner || <span className="muted">—</span>;
      case 'sunOwner': return d.sunOwner || <span className="muted">—</span>;
      case 'start':
        return canEdit('plannedStart') && !ro ? <InlineDate value={d.start} label={`Start date of ${d.id}`} onSave={v => save(d, { plannedStart: v })} /> : <PlanDate v={d.start} />;
      case 'end':
        return (
          <span className={d.overdue ? 'bad' : ''}>
            {canEdit('plannedEnd') && !ro ? <InlineDate value={d.end} min={d.start} label={`End date of ${d.id}`} onSave={v => save(d, { plannedEnd: v })} /> : <PlanDate v={d.end} />}
            {d.varianceWd ? <small className={d.varianceWd > 0 ? 'bad' : 'ok'} title="Against baseline"> {d.varianceWd > 0 ? '+' : ''}{d.varianceWd}WD</small> : null}
          </span>
        );
      case 'duration':
        return (
          <span title={d.windowWd !== null ? `Planned dates span ${d.windowWd} working day(s)` : 'Duration from the checklist (working days)'}>
            {d.durationWd ?? <span className="muted">—</span>}
            {d.windowWd !== null && d.durationWd !== null && d.windowWd !== d.durationWd && <small className={d.windowWd < d.durationWd ? 'bad' : 'muted'}> ({d.windowWd} planned)</small>}
          </span>
        );
      case 'status':
        return canEdit('status') && !ro ? (
          <select className="inline-select" value={p.statuses.get(d.status)?.status ?? d.status} aria-label={`Status of ${d.id}`} onChange={e => void save(d, { status: e.target.value })} style={{ ['--c' as string]: p.statuses.color(d.status) }}>
            {!p.statuses.get(d.status) && <option value={d.status}>{d.status || 'Status not set'}</option>}
            {p.statuses.activeNames().map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : <StatusBadge status={d.status} />;
      case 'complete':
        return d.complete ? <CompleteBadge /> : canEdit('completionConfirmed') && !ro ? (
          <button className="btn btn-sm" title="Confirm this deliverable is complete" onClick={() => void save(d, { completionConfirmed: 'Yes', ...(d.actualEnd ? {} : { actualEnd: p.today }) })}>Confirm complete</button>
        ) : <span className="muted">Open</span>;
      case 'priority':
        return canEdit('priority') && !ro ? (
          <select className="inline-select" value={d.priority} aria-label={`Priority of ${d.id}`} onChange={e => void save(d, { priority: e.target.value || null })}>
            <option value="">Not set</option>
            {PRIORITIES.map(x => <option key={x}>{x}</option>)}
          </select>
        ) : d.priority ? <span className={`prio prio-${d.priority.toLowerCase()}`}>{d.priority}</span> : <span className="muted">Not set</span>;
      case 'flag':
        return (
          <>
            <FlagBadge flag={d.flag} title={d.riskReasons.join('\n') || undefined} />
            {!d.scheduled && !d.complete && <div className="unconfirmed">{d.dateError ?? 'Date not confirmed'}</div>}
            {d.overdue && <div className="small bad">{d.overdueDays}d late</div>}
          </>
        );
      case 'dependency':
        return d.predecessors.length ? d.predecessors.map(x => <a key={x} className="tag tag-neutral mono" href={`#/tracker?open=${encodeURIComponent(x)}`}>{x}</a>) : <span className="muted">—</span>;
      case 'nextAction': return d.nextAction ? <span className="clamp">{d.nextAction}</span> : <span className="muted">—</span>;
      case 'actionOwner': return d.actionOwner || <span className="muted">—</span>;
      case 'targetDate': return <span className={d.targetDate && d.targetDate < p.today && !d.complete ? 'bad' : ''}><D v={d.targetDate} /></span>;
      case 'approval': return (r.approvalStatus as string) || <span className="muted">—</span>;
      case 'actualEnd': return <D v={d.actualEnd} />;
      case 'remarks': return r.remarks ? <span className="clamp">{String(r.remarks)}</span> : <span className="muted">—</span>;
      case 'updated': return d.lastUpdated ? <span className="small" title={d.lastUpdated}>{fmtDate(d.lastUpdated.slice(0, 10))}</span> : <span className="muted">—</span>;
    }
  };

  const shown = COLS.filter(c => cols.includes(c.key));
  const openD = open ? p.byId.get(open) : undefined;
  const canSelect = canEdit('status');
  const span = shown.length + 2 + (canSelect ? 1 : 0);

  return (
    <div className="page">
      <div className="chips" role="tablist" aria-label="Quick filters">
        {QUICK.map(x => (
          <button key={x.key} role="tab" aria-selected={quick === x.key} className={`chip${quick === x.key ? ' active' : ''}`} onClick={() => setQuick(x.key)}>
            {x.label} <span className="chip-n">{ds.filter(x.test).length}</span>
          </button>
        ))}
      </div>
      <div className="toolbar wrap">
        <SearchBox value={q} onChange={setQ} placeholder="Search task, description, owner or ID…" />
        <select value={phase} onChange={e => { setPhase(e.target.value); setWs(''); }} aria-label="Phase">
          <option value="">All phases</option>
          {p.phases.map(x => <option key={x.phase} value={x.phase}>{x.name}</option>)}
        </select>
        <select value={ws} onChange={e => setWs(e.target.value)} aria-label="Workstream">
          <option value="">All workstreams</option>
          {opts.ws.map(x => <option key={x}>{x}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {p.statuses.list.map(s => <option key={s.status}>{s.status}</option>)}
          <option value="(none)">Status not set</option>
        </select>
        <select value={oam} onChange={e => setOam(e.target.value)} aria-label="OneAlphaMed owner">
          <option value="">All OneAlphaMed owners</option>
          {opts.oam.map(x => <option key={x}>{x}</option>)}
        </select>
        <select value={sun} onChange={e => setSun(e.target.value)} aria-label="Sun Pharma owner">
          <option value="">All Sun Pharma owners</option>
          {opts.sun.map(x => <option key={x}>{x}</option>)}
        </select>
        <select value={fn} onChange={e => setFn(e.target.value)} aria-label="Lead function">
          <option value="">All lead functions</option>
          {opts.fn.map(x => <option key={x}>{x}</option>)}
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value)} aria-label="Priority">
          <option value="">All priorities</option>
          {[...PRIORITIES, '(not set)'].map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={flag} onChange={e => setFlag(e.target.value)} aria-label="Schedule flag">
          <option value="">All schedule flags</option>
          {SCHEDULE_FLAGS.map(s => <option key={s}>{s}</option>)}
        </select>
        <label className="date-range">
          <span>Ends from</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="End date from" />
          <span>starts by</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="Start date until" />
        </label>
        {activeFilters > 0 && <button className="btn btn-ghost btn-sm" onClick={clear}><Icon name="x" /> Reset filters ({activeFilters})</button>}
      </div>
      <div className="toolbar wrap">
        <div className="seg" role="group" aria-label="Grouping">
          <button className={group === 'ws' ? 'active' : ''} onClick={() => setGroup('ws')}>Phase › Workstream</button>
          <button className={group === 'phase' ? 'active' : ''} onClick={() => setGroup('phase')}>Phase</button>
          <button className={group === 'flat' ? 'active' : ''} onClick={() => setGroup('flat')}>Flat list</button>
        </div>
        <label className="inline">
          Sort
          <select value={`${sort.key}:${sort.dir}`} onChange={e => { const [k2, d2] = e.target.value.split(':'); setSort({ key: k2 as typeof sort.key, dir: Number(d2) as 1 | -1 }); }}>
            <option value="order:1">Checklist order</option>
            <option value="end:1">End date (soonest)</option>
            <option value="end:-1">End date (latest)</option>
            <option value="start:1">Start date</option>
            <option value="flag:1">Schedule flag (worst first)</option>
            <option value="status:1">Status</option>
            <option value="priority:1">Priority</option>
            <option value="id:1">Deliverable ID</option>
          </select>
        </label>
        <Menu label="Columns" icon="list">
          <div className="col-chooser" onClick={e => e.stopPropagation()}>
            {COLS.map(c => (
              <label key={c.key}>
                <input type="checkbox" checked={cols.includes(c.key)} disabled={c.key === 'name'} onChange={() => setCols(cs => (cs.includes(c.key) ? cs.filter(x => x !== c.key) : [...cs, c.key]))} />
                {c.label}
              </label>
            ))}
            <button className="btn btn-sm" onClick={() => setCols(COLS.map(c => c.key))}>Show all</button>
            <button className="btn btn-sm" onClick={() => setCols(COLS.filter(c => c.default).map(c => c.key))}>Reset</button>
          </div>
        </Menu>
        <div className="spacer" />
        <span className="muted small">{filtered.length} of {ds.length} deliverables</span>
        <Menu label="Export" icon="download">
          <button onClick={() => doExport('xlsx')}>Excel (.xlsx) — filtered rows</button>
          <button onClick={() => doExport('csv')}>CSV — filtered rows</button>
          <button onClick={() => doExport('xlsx', true)}>Excel (.xlsx) — complete tracker</button>
        </Menu>
        {canCreate(user.role, 'deliverables') && <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" /> Add deliverable</button>}
      </div>

      {canSelect && selected.size > 0 && (
        <div className="bulk-bar" role="region" aria-label="Bulk update">
          <strong>{selected.size} selected</strong>
          <select defaultValue="" aria-label="Set status for selected" onChange={e => { if (e.target.value) void bulk({ status: e.target.value }); e.target.value = ''; }}>
            <option value="">Set status…</option>
            {p.statuses.activeNames().map(s => <option key={s}>{s}</option>)}
          </select>
          <select defaultValue="" aria-label="Set priority for selected" onChange={e => { if (e.target.value) void bulk({ priority: e.target.value }); e.target.value = ''; }}>
            <option value="">Set priority…</option>
            {PRIORITIES.map(s => <option key={s}>{s}</option>)}
          </select>
          {canEdit('completionConfirmed') && <button className="btn btn-sm" onClick={() => void bulk({ completionConfirmed: 'Yes' })}>Confirm complete</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
          <span className="small muted">All-or-nothing: if any record changed in the sheet meanwhile, nothing is saved.</span>
        </div>
      )}

      {filtered.length === 0 ? (
        <Empty title="No deliverables match these filters"><button className="btn btn-sm" onClick={clear}>Reset filters</button></Empty>
      ) : (
        <div className="table-wrap tall">
          <table className="grid deliverables">
            <thead>
              <tr>
                {canSelect && (
                  <th className="col-sel">
                    <input type="checkbox" aria-label="Select all shown" checked={filtered.every(d => selected.has(d.key))} onChange={e => setSelected(e.target.checked ? new Set(filtered.map(d => d.key)) : new Set())} />
                  </th>
                )}
                <th className="col-exp" aria-label="Expand" />
                <th><button className="th-btn" onClick={() => setSort(s => ({ key: 'id', dir: s.key === 'id' ? ((-s.dir) as 1 | -1) : 1 }))}>Deliverable ID</button></th>
                {shown.map(c => <th key={c.key}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map(([g, items]) => {
                const isCollapsed = collapsed.has(g);
                return (
                  <Fragment key={g || 'all'}>
                    {g && (
                      <tr className="group-row">
                        <td colSpan={span}>
                          <button className="group-btn" onClick={() => setCollapsed(c => toggle(c, g))} aria-expanded={!isCollapsed}>
                            <Icon name={isCollapsed ? 'chevron' : 'down'} size={14} />
                            <strong>{groupLabel(g)}</strong>
                            <span className="muted small"> {items.length} items · {items.filter(i => i.complete).length} complete{items.some(i => i.overdue) ? ` · ${items.filter(i => i.overdue).length} overdue` : ''}</span>
                          </button>
                        </td>
                      </tr>
                    )}
                    {!isCollapsed && items.map(d => (
                      <Fragment key={d.key}>
                        <tr className={d.overdue ? 'row-red' : d.atRisk ? 'row-amber' : d.complete ? 'row-done' : ''}>
                          {canSelect && <td className="col-sel"><input type="checkbox" aria-label={`Select ${d.id}`} checked={selected.has(d.key)} onChange={() => setSelected(s => toggle(s, d.key))} /></td>}
                          <td className="col-exp">
                            <button className="icon-btn sm" aria-label={`Show details for ${d.id}`} aria-expanded={expanded.has(d.key)} onClick={() => setExpanded(e => toggle(e, d.key))}>
                              <Icon name={expanded.has(d.key) ? 'down' : 'chevron'} size={14} />
                            </button>
                          </td>
                          <td className="mono nowrap">{d.id}</td>
                          {shown.map(c => <td key={c.key} className={c.key === 'name' ? 'col-name' : undefined}>{cell(d, c.key)}</td>)}
                        </tr>
                        {expanded.has(d.key) && (
                          <tr className="expand-row">
                            <td colSpan={canSelect ? 2 : 1} />
                            <td colSpan={shown.length + 1}><ExpandedRow d={d} onOpen={() => setOpen(d.key)} /></td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={!!openD} wide onClose={() => { setOpen(null); if (params.get('open')) go('tracker'); }} title={openD ? `${openD.id} · ${plainName(openD.name)}` : ''} subtitle={openD && <DeliverableHeader d={openD} />}>
        {openD && <DeliverableDetail d={openD} />}
      </Drawer>
      {open && !openD && (
        <Drawer open wide onClose={() => { setOpen(null); go('tracker'); }} title="Deliverable not found">
          <Empty title={`${open} is not available`}>It may have been archived, or is not visible to your role.</Empty>
        </Drawer>
      )}
      <Drawer open={adding} wide onClose={() => setAdding(false)} title="Add deliverable" subtitle="A unique Deliverable ID is assigned from the workstream (e.g. PN-3.1.15). Dates can stay blank until confirmed.">
        {adding && (
          <RecordForm
            table="deliverables"
            rec={null}
            sections={DELIVERABLE_SECTIONS.slice(0, 5)}
            defaults={{ phase: phase || p.phases[0]?.phase, workstream: ws || undefined, type: 'Task', lead: 'OAM' }}
            onDone={id => { setAdding(false); setOpen(id); }}
            onCancel={() => setAdding(false)}
          />
        )}
      </Drawer>
    </div>
  );
}

/** Date cell that saves on blur / Enter, so partially typed dates are never written. */
function InlineDate({ value, onSave, label, min }: { value: string | null; onSave: (v: string | null) => Promise<void>; label: string; min?: string | null }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const commit = () => {
    if ((v || null) === (value || null)) return;
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return setV(value ?? '');
    void onSave(v || null);
  };
  return (
    <input
      type="date"
      className={`inline-date${v ? '' : ' empty'}`}
      value={v}
      min={min ?? undefined}
      aria-label={label}
      title={v ? undefined : 'Date not confirmed'}
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function ExpandedRow({ d, onOpen }: { d: Deliverable; onOpen: () => void }) {
  const r = d.rec;
  const { internal } = useData();
  const field = (label: string, v: unknown) => (v ? <div><dt>{label}</dt><dd className="prewrap">{String(v)}</dd></div> : null);
  return (
    <div className="expand">
      <dl className="dl-grid">
        {field('Description & Key Deliverables', r.description)}
        {field('Remarks', r.remarks)}
        {field('Lead / Lead Function', [d.lead, d.leadFunction].filter(Boolean).join(' · '))}
        {field('Risk / blocker', r.risk)}
        {field('Next action', d.nextAction && `${d.nextAction}${d.actionOwner ? ` — ${d.actionOwner}` : ''}${d.targetDate ? ` (by ${fmtDate(d.targetDate)})` : ''}`)}
        {internal && field('Internal notes', r.internalNotes)}
        <div><dt>Depends on</dt><dd>{d.predecessors.length ? d.predecessors.join(', ') : <span className="muted">No dependencies recorded</span>}</dd></div>
        <div><dt>Blocks</dt><dd>{d.successors.length ? d.successors.join(', ') : <span className="muted">—</span>}</dd></div>
        {d.riskReasons.length > 0 && <div><dt>Flags</dt><dd>{d.riskReasons.join(' · ')}</dd></div>}
      </dl>
      <button className="btn btn-sm" onClick={onOpen}>Open full details{internal ? ', edit, comments & history' : ' & comments'}</button>
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
        <div className="mini"><span>Baseline</span><strong>{d.baselineEnd ? <><D v={d.baselineStart} /> → <D v={d.baselineEnd} /></> : <span className="unconfirmed">Set when dates are first saved</span>}</strong></div>
        <div className="mini"><span>Awaiting</span><strong>{d.awaiting ?? '—'}</strong></div>
        {d.float !== null && <div className="mini"><span>Total float</span><strong>{d.float} WD</strong></div>}
      </div>
      {d.riskReasons.length > 0 && <div className="notice notice-warn"><Icon name="alert" /> {d.riskReasons.join(' · ')}</div>}

      <section className="deps">
        <h3>Dependencies & impact</h3>
        <p className="small">
          <strong>Depends on:</strong> {d.predecessors.length ? d.predecessors.map(x => <a key={x} className="tag tag-neutral mono" href={`#/tracker?open=${encodeURIComponent(x)}`}>{x}</a>) : <span className="muted">none recorded</span>}
          {'  '}
          <strong>Blocks:</strong> {d.successors.length ? d.successors.map(x => <a key={x} className="tag tag-neutral mono" href={`#/tracker?open=${encodeURIComponent(x)}`}>{x}</a>) : <span className="muted">nothing recorded</span>}
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
                {impact.map(i => <li key={i.id}><span className="mono">{i.id}</span> {p.byId.get(i.id)?.name} — moves to <D v={i.newStart} /> → <D v={i.newEnd} /> <span className="bad">(+{i.slipWd} WD)</span></li>)}
              </ul>
            ) : <p className="small ok">Downstream items have enough slack — no knock-on delay.</p>}
          </div>
        ) : (
          <p className="muted small">{d.successors.length ? 'Slip impact needs confirmed dates on this item and its dependants.' : internal ? 'Record dependencies on downstream deliverables (or apply suggestions on Risks & Dependencies) to enable impact analysis.' : 'No downstream dependencies recorded.'}</p>
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
                <span className="mono small">{a._key}</span> {String(a.action)} · {String(a.owner ?? 'no owner')} · due <D v={a.dueDate} /> · <Tag tone={isOpenAction(a) ? 'amber' : 'green'}>{String(a.status)}</Tag>
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
        title={`Archive ${d.id}?`}
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
      {!internal && <p className="muted small">Read-only view for Sun Pharma. Updates are made by the OneAlphaMed project team.</p>}
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
