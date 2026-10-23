// Interactive Gantt chart generated from the same Deliverables data as the tracker.
// Only items with confirmed planned dates are drawn; everything else is listed as
// "Awaiting schedule confirmation" — no bar is ever drawn from an assumed date.
import { useRef, useState } from 'react';
import { addDays, diffDays, fmtDate, isWorkingDay, maxDate, minDate, weekday } from '../../../shared/dates';
import { Deliverable, groupBy, plainName } from '../../../shared/project';
import { go } from '../App';
import { useData } from '../data';
import { Card, Empty, FlagBadge, Icon, StatusBadge } from '../ui';

type Zoom = 'day' | 'week' | 'month';
const PX: Record<Zoom, number> = { day: 34, week: 14, month: 4.2 };
const ROW = 30;

export function Gantt() {
  const { project: p, internal } = useData();
  const [zoom, setZoom] = useState<Zoom>('week');
  const [phase, setPhase] = useState('');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState('');
  const [showBaseline, setShowBaseline] = useState(true);
  const [showDeps, setShowDeps] = useState(true);
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);

  const items = p.deliverables.filter(d => (!phase || d.phase === phase) && (!owner || d.oamOwner === owner || d.sunOwner === owner) && (!status || d.status === status) && (!criticalOnly || d.critical));
  const owners = [...new Set(p.deliverables.flatMap(d => [d.oamOwner, d.sunOwner]).filter(Boolean))].sort();
  const scheduled = items.filter(d => d.scheduled);
  const unscheduled = items.filter(d => !d.scheduled && !d.complete);

  const toolbar = (
    <div className="toolbar wrap">
      <div className="seg" role="group" aria-label="Timeline view">
        {(['day', 'week', 'month'] as Zoom[]).map(z => (
          <button key={z} className={zoom === z ? 'active' : ''} onClick={() => setZoom(z)}>{z === 'day' ? 'Daily' : z === 'week' ? 'Weekly' : 'Monthly'}</button>
        ))}
      </div>
      <select value={phase} onChange={e => setPhase(e.target.value)} aria-label="Phase">
        <option value="">All phases</option>
        {p.phases.map(ph => <option key={ph.phase} value={ph.phase}>{ph.name}</option>)}
      </select>
      <select value={owner} onChange={e => setOwner(e.target.value)} aria-label="Owner">
        <option value="">All owners</option>
        {owners.map(o => <option key={o}>{o}</option>)}
      </select>
      <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
        <option value="">All statuses</option>
        {p.statuses.list.map(s => <option key={s.status}>{s.status}</option>)}
      </select>
      <label className="inline"><input type="checkbox" checked={showBaseline} onChange={e => setShowBaseline(e.target.checked)} /> Baseline</label>
      <label className="inline"><input type="checkbox" checked={showDeps} onChange={e => setShowDeps(e.target.checked)} /> Dependencies</label>
      {p.graph.critical.size > 0 && <label className="inline"><input type="checkbox" checked={criticalOnly} onChange={e => setCriticalOnly(e.target.checked)} /> Critical path only</label>}
    </div>
  );

  const unscheduledPanel = unscheduled.length > 0 && (
    <Card title={`Awaiting schedule confirmation (${unscheduled.length})`} subtitle="These deliverables have no confirmed planned start and end dates, so they are not drawn. Durations are working days from the checklist — not calendar days.">
      {groupBy(unscheduled, d => d.phase).map(([ph, ds]) => (
        <details key={ph} open={unscheduled.length < 30}>
          <summary><strong>{p.phases.find(x => x.phase === ph)?.name ?? ph}</strong> <span className="muted small">· {ds.length} items · {ds.reduce((a, d) => a + (d.durationWd ?? 0), 0)} WD of effort</span></summary>
          <div className="table-wrap" style={{ margin: '6px 0 10px' }}>
            <table className="grid">
              <thead><tr><th>ID</th><th>Task / Activity</th><th>Duration (WD)</th><th>Status</th><th>Dates</th></tr></thead>
              <tbody>
                {ds.map(d => (
                  <tr key={d.key} className="clickable" onClick={() => go('tracker', { open: d.key })}>
                    <td className="mono">{d.id}</td><td>{d.name}</td><td>{d.durationWd ?? '—'}</td><td><StatusBadge status={d.status} /></td>
                    <td className="unconfirmed">{d.dateError ?? (!d.start && !d.end ? 'Start and end not confirmed' : !d.start ? 'Start not confirmed' : 'End not confirmed')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
      {internal && <p className="small muted">Enter dates in the Deliverables Tracker (inline date cells) or directly in the Google Sheet; the chart updates on the next sync.</p>}
    </Card>
  );

  const start0 = minDate([...scheduled.map(d => d.start), ...scheduled.map(d => d.baselineStart)]);
  const end0 = maxDate([...scheduled.map(d => d.end), ...scheduled.map(d => d.baselineEnd)]);
  if (!start0 || !end0)
    return (
      <div className="page">
        {toolbar}
        <Empty title="No deliverables have confirmed dates yet" icon="calendar">
          The timeline draws only confirmed planned dates. {unscheduled.length} deliverable(s) are awaiting schedule confirmation.
        </Empty>
        {unscheduledPanel}
      </div>
    );

  const first = minDate([start0, p.today])!;
  const last = maxDate([end0, p.today])!;
  const start = addDays(first, -((weekday(first) + 6) % 7) - 7);
  const end = addDays(last, 14);
  const days = diffDays(start, end) + 1;
  const px = PX[zoom];
  const width = days * px;
  const x = (iso: string) => diffDays(start, iso) * px;

  type Row = { kind: 'phase' | 'ws'; key: string; label: string; count: number; start: string | null; end: string | null; pct?: number } | { kind: 'task'; d: Deliverable };
  const rows: Row[] = [];
  for (const [ph, inPhase] of groupBy(scheduled, d => d.phase)) {
    const meta = p.phases.find(x2 => x2.phase === ph);
    rows.push({ kind: 'phase', key: ph, label: meta?.name ?? ph, count: inPhase.length, start: minDate(inPhase.map(d => d.start)), end: maxDate(inPhase.map(d => d.end)), pct: meta?.pct });
    if (collapsed.has(ph)) continue;
    for (const [wsName, inWs] of groupBy(inPhase, d => `${d.wsCode} ${d.workstream}`.trim())) {
      const k = `${ph}|${wsName}`;
      rows.push({ kind: 'ws', key: k, label: wsName, count: inWs.length, start: minDate(inWs.map(d => d.start)), end: maxDate(inWs.map(d => d.end)) });
      if (collapsed.has(k)) continue;
      for (const d of inWs) rows.push({ kind: 'task', d });
    }
  }
  const rowIndex = new Map<string, number>();
  rows.forEach((r, i) => r.kind === 'task' && rowIndex.set(r.d.key, i));
  const phaseStarts = p.phases.filter(ph => ph.start && (!phase || ph.phase === phase)).map(ph => ({ phase: ph.phase, at: ph.start! }));

  const ticks = (() => {
    const out: { x: number; label: string; major: boolean }[] = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(start, i);
      const dd = +d.slice(8, 10);
      if (zoom === 'day') out.push({ x: i * px, label: `${dd}`, major: weekday(d) === 1 });
      else if (zoom === 'week' && weekday(d) === 1) out.push({ x: i * px, label: fmtDate(d, { year: false }), major: dd <= 7 });
      else if (zoom === 'month' && dd === 1) out.push({ x: i * px, label: fmtDate(d).replace(/^1 /, ''), major: true });
    }
    return out;
  })();

  const toggle = (k: string) => setCollapsed(c => {
    const n = new Set(c);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  const barClass = (d: Deliverable) =>
    ['bar', d.complete ? 'bar-done' : '', d.isApprovalGate ? 'bar-gate' : d.isClientInput ? 'bar-input' : 'bar-task', d.overdue ? 'bar-overdue' : d.atRisk ? 'bar-risk' : '', d.critical ? 'bar-critical' : '', d.category === 'Blocked' ? 'bar-hold' : '']
      .filter(Boolean).join(' ');
  const deps = showDeps ? p.deliverables.filter(d => rowIndex.has(d.key)).flatMap(d => d.predecessors.filter(pr => rowIndex.has(pr)).map(pr => ({ from: p.byId.get(pr)!, to: d }))) : [];

  return (
    <div className="page">
      {toolbar}
      <div className="toolbar">
        <button className="btn btn-sm" onClick={() => setCollapsed(new Set(p.phases.map(x2 => x2.phase)))}>Collapse all</button>
        <button className="btn btn-sm" onClick={() => setCollapsed(new Set())}>Expand all</button>
        <button className="btn btn-sm" onClick={() => scroller.current?.scrollTo({ left: Math.max(0, x(p.today) - 200), behavior: 'smooth' })}><Icon name="calendar" /> Today</button>
        <span className="muted small">{scheduled.length} scheduled · {unscheduled.length} awaiting dates · working days Mon–Fri{p.cal.holidays.size ? ` minus ${p.cal.holidays.size} holiday(s)` : ''}</span>
      </div>
      <div className="legend">
        <span><i className="lg lg-task" /> Task</span>
        <span><i className="lg lg-gate" /> Approval gate</span>
        <span><i className="lg lg-input" /> Client input</span>
        <span><i className="lg lg-ms">◆</i> Milestone</span>
        <span><i className="lg lg-done" /> Complete</span>
        <span><i className="lg lg-overdue" /> Overdue</span>
        <span><i className="lg lg-risk" /> At risk</span>
        {showBaseline && <span><i className="lg lg-base" /> Baseline</span>}
        <span><i className="lg lg-today" /> Today ({fmtDate(p.today)})</span>
        <span className="muted">{p.graph.linkCount ? `Critical path: ${p.graph.critical.size} item(s) from ${p.graph.linkCount} recorded dependencies` : 'Critical path not identifiable — no dependencies recorded yet'}</span>
      </div>

      <div className="gantt">
        <div className="gantt-left">
          <div className="gantt-head-left">Deliverable</div>
          {rows.map((r, i) =>
            r.kind === 'task' ? (
              <div key={r.d.key} className="g-label g-task" style={{ height: ROW }}>
                <button className="link" onClick={() => go('tracker', { open: r.d.key })} title={`${r.d.id} — ${r.d.name}`}>
                  <span className="mono small">{r.d.id.replace('PN-', '')}</span> {plainName(r.d.name)}
                </button>
              </div>
            ) : (
              <div key={r.key + i} className={`g-label g-${r.kind}`} style={{ height: ROW }}>
                <button className="group-btn" onClick={() => toggle(r.key)} aria-expanded={!collapsed.has(r.key)}>
                  <Icon name={collapsed.has(r.key) ? 'chevron' : 'down'} size={13} />
                  <span>{r.label}</span>
                  <span className="muted small">{r.count}{r.kind === 'phase' && r.pct !== undefined ? ` · ${r.pct}%` : ''}</span>
                </button>
              </div>
            ),
          )}
        </div>
        <div className="gantt-right" ref={scroller}>
          <div style={{ width, position: 'relative' }}>
            <div className="gantt-head" style={{ width }}>
              {ticks.map((t, i) => <div key={i} className={`tick${t.major ? ' major' : ''}`} style={{ left: t.x }}>{t.label}</div>)}
            </div>
            <div className="gantt-body" style={{ height: rows.length * ROW, width }}>
              {zoom === 'day' && Array.from({ length: days }, (_, i) => addDays(start, i)).filter(d => !isWorkingDay(d, p.cal)).map(d => <div key={d} className={`nonwork${p.cal.holidays.has(d) ? ' holiday' : ''}`} style={{ left: x(d), width: px }} />)}
              {zoom !== 'day' && [...p.cal.holidays].map(h => <div key={h} className="nonwork holiday" style={{ left: x(h), width: Math.max(px, 2) }} title={`Holiday ${fmtDate(h)}`} />)}
              {ticks.filter(t => t.major || zoom !== 'month').map((t, i) => <div key={i} className="gridline" style={{ left: t.x }} />)}
              {phaseStarts.map(b => <div key={b.phase} className="proj-line" style={{ left: x(b.at) }} title={`${b.phase} starts ${fmtDate(b.at)}`} />)}
              <div className="today" style={{ left: x(p.today) + px / 2 }} title={`Today ${fmtDate(p.today)}`} />
              {rows.map((r, i) => {
                const top = i * ROW;
                if (r.kind !== 'task') {
                  if (!r.start || !r.end) return null;
                  return <div key={r.key + i} className={`summary-bar summary-${r.kind}`} style={{ top: top + ROW / 2 - 3, left: x(r.start), width: x(r.end) - x(r.start) + px }} title={`${r.label}: ${fmtDate(r.start)} → ${fmtDate(r.end)}`} />;
                }
                const d = r.d;
                const ms = d.isMilestone || (d.keyMilestone && d.windowWd === 1);
                const tip = `${d.id} · ${d.name}\n${fmtDate(d.start)} → ${fmtDate(d.end)} (${d.windowWd} WD planned${d.durationWd !== null ? `, ${d.durationWd} WD required` : ''})\nStatus: ${d.status}${d.complete ? ' · complete' : ''} · ${d.flag}${d.baselineEnd && d.baselineEnd !== d.end ? `\nBaseline end: ${fmtDate(d.baselineEnd)}` : ''}${d.riskReasons.length ? `\n⚠ ${d.riskReasons.join('; ')}` : ''}`;
                return (
                  <div key={d.key}>
                    {showBaseline && d.baselineStart && d.baselineEnd && (d.baselineStart !== d.start || d.baselineEnd !== d.end) && (
                      <div className="baseline" style={{ top: top + ROW - 7, left: x(d.baselineStart), width: x(d.baselineEnd) - x(d.baselineStart) + px }} />
                    )}
                    {ms ? (
                      <button className={`milestone${d.complete ? ' done' : ''}${d.overdue ? ' overdue' : ''}`} style={{ top: top + 6, left: x(d.end!) + px / 2 - 9 }} title={tip} aria-label={tip} onClick={() => go('tracker', { open: d.key })} />
                    ) : (
                      <button className={barClass(d)} style={{ top: top + 6, left: x(d.start!), width: Math.max(x(d.end!) - x(d.start!) + px, 6) }} title={tip} aria-label={tip} onClick={() => go('tracker', { open: d.key })}>
                        {d.complete && <span className="bar-fill" style={{ width: '100%' }} />}
                      </button>
                    )}
                    {zoom !== 'month' && d.overdue && <span className="bar-after" style={{ top: top + 7, left: x(d.end!) + px + 6 }}>{d.overdueDays}d late</span>}
                  </div>
                );
              })}
              {deps.length > 0 && (
                <svg className="dep-layer" width={width} height={rows.length * ROW}>
                  <defs>
                    <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor" /></marker>
                  </defs>
                  {deps.map(({ from, to }, i) => {
                    const x1 = x(from.end!) + px;
                    const y1 = rowIndex.get(from.key)! * ROW + ROW / 2;
                    const x2 = x(to.start!);
                    const y2 = rowIndex.get(to.key)! * ROW + ROW / 2;
                    const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 12));
                    return <path key={i} className={`dep${from.critical && to.critical ? ' dep-critical' : ''}${x2 <= x1 ? ' dep-conflict' : ''}`} d={`M${x1},${y1} H${mid} V${y2} H${x2}`} markerEnd="url(#arr)" />;
                  })}
                </svg>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="muted small">Bars show confirmed planned dates; thin grey lines show the baseline where it differs; dashed vertical lines mark phase starts. Hover a bar for details, click to open it. <FlagBadge flag="Overdue" /> and <FlagBadge flag="At Risk" /> follow the tracker rules.</p>
      {unscheduledPanel}
    </div>
  );
}
