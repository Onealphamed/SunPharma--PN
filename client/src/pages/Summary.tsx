// Executive Summary — the landing page, laid out like the EAN tracker's executive view:
// header, KPI tiles, "where it's pending — and with whom", then charts. Numbers and charts
// only; every figure is calculated from the live tracker and links to it.
import { ReactNode } from 'react';
import { diffDays, fmtDate } from '../../../shared/dates';
import { Deliverable, HEALTH_LABEL, plainName } from '../../../shared/project';
import { CATEGORY_COLOR, CHART_ORDER, COMPLETE_COLOR } from '../../../shared/status';
import { go } from '../App';
import { ChartCard, ChartKey, Counts, HBars, pct, Ring, Series, StackBar, StackRows, TooltipLayer } from '../charts';
import { useData } from '../data';
import { PROGRESS_HELP, progressOf } from '../progress';
import { HealthPill, Icon } from '../ui';

const OAM_COLOR = '#2a78d6';
const SUN_COLOR = '#f5911f';

export function Summary() {
  const { project: p, snap, internal, readOnly } = useData();
  const s = p.settings;
  const k = p.kpis;
  const ds = p.deliverables;
  const filter = (f: string) => go('tracker', { filter: f });

  // Status series in the validated chart order; confirmed completion first, unset last.
  const names = [...CHART_ORDER.filter(n => p.statuses.get(n)), ...p.statuses.list.map(d => d.status).filter(n => !CHART_ORDER.includes(n))];
  const keyOf = (d: Deliverable) => (d.complete ? '__complete' : p.statuses.get(d.status)?.status ?? '__none');
  const countBy = (items: Deliverable[]) => {
    const c: Counts = {};
    for (const d of items) c[keyOf(d)] = (c[keyOf(d)] ?? 0) + 1;
    return c;
  };
  const all = countBy(ds);
  const series: Series[] = [
    { key: '__complete', label: 'Complete (confirmed)', color: COMPLETE_COLOR },
    ...names.map(n => ({ key: n, label: n, color: p.statuses.color(n) })),
    ...(all.__none ? [{ key: '__none', label: 'Status not set', color: CATEGORY_COLOR.Unmapped }] : []),
  ];
  const byStatus = (key: string) => filter(key === '__complete' ? 'complete' : `status:${key}`);

  const open = ds.filter(d => !d.complete);
  const withOam = open.filter(d => d.awaiting === 'OneAlphaMed');
  const withSun = open.filter(d => d.awaiting === 'Sun Pharma');
  const avgProgress = ds.length ? Math.round(ds.reduce((a, d) => a + progressOf(d), 0) / ds.length) : 0;

  // Where today sits between the earliest planned start and latest planned end (no dates → not shown).
  const start = p.projectStart;
  const end = p.projectEnd;
  const span = start && end ? Math.max(1, diffDays(start, end)) : 0;
  const elapsed = start ? diffDays(start, p.today) : 0;
  const timePct = span ? Math.max(0, Math.min(100, Math.round((elapsed / span) * 100))) : null;
  const when = !start ? 'Not yet scheduled' : elapsed < 0 ? `Starts in ${-elapsed} day${elapsed === -1 ? '' : 's'}` : end && p.today > end ? 'Past planned end' : span ? `Day ${elapsed + 1} of ${span + 1}` : `Day ${elapsed + 1}`;
  const notStarted = k.yetToStart + k.yetToAssign;
  const noDates = k.notScheduled === open.length && open.length > 0;

  const phaseRows = p.phases.map(ph => ({ key: ph.phase, label: ph.name, counts: countBy(ds.filter(d => d.phase === ph.phase)), done: ph.completed, total: ph.total }));
  const statusCols = series.map(x => x.label);

  return (
    <TooltipLayer>
      <div className="page">
        {/* Compact header (as on the AZ dashboard) */}
        <section className="ov-head card">
          <div className="ov-title">
            <div className="eyebrow">{s.programme || 'Programme'}</div>
            <h1>{s.projectName}</h1>
            <div className="ov-pills">
              <span title={(s.healthOverride ? [s.healthOverrideReason || 'Set by the Project Manager', `Calculated: ${HEALTH_LABEL[p.computedHealth]}`] : p.healthReasons).join('\n')}>
                <HealthPill health={p.health} override={!!s.healthOverride} />
              </span>
              <span className="pill"><Icon name="flag" size={13} /> {p.currentPhase}</span>
              <span className="pill" title="Earliest planned start → latest planned end">
                <Icon name="calendar" size={13} /> {start || end ? <>{start ? fmtDate(start) : 'Start TBC'} → {end ? fmtDate(end) : 'End TBC'}</> : 'Dates not confirmed'}
              </span>
              <span className="pill">{when}</span>
            </div>
            {((internal && !readOnly) || snap.sheetUrl) && (
              <div className="ov-pills no-print">
                {snap.sheetUrl && (
                  <a className="btn btn-sm btn-primary" href={snap.sheetUrl} target="_blank" rel="noreferrer noopener" title="The Google Sheet this dashboard reads live">
                    <Icon name="grid" size={14} /> Open live Google Sheet ↗
                  </a>
                )}
                {internal && !readOnly && <button className="btn btn-sm" onClick={() => go('meetings', { new: '1' })}><Icon name="plus" size={14} /> Add Meeting Notes</button>}
              </div>
            )}
          </div>
          <div className="ov-progress">
            <div className="ov-ring" title="Only items with Completion Confirmed = Yes count as complete">
              <Ring value={k.pct} />
              <div>
                <strong>{k.completed}/{k.total}</strong>
                <span>deliverables complete</span>
              </div>
            </div>
            <div className="ov-time">
              <div className="ov-time-row"><span>Timeline elapsed</span><strong>{timePct === null ? '—' : `${timePct}%`}</strong></div>
              <div className="progress"><div style={{ width: `${timePct ?? 0}%`, background: 'var(--navy)' }} /></div>
              <div className="ov-time-row" title={PROGRESS_HELP}><span>Weighted progress</span><strong>{avgProgress}%</strong></div>
              <div className="progress"><div style={{ width: `${avgProgress}%` }} /></div>
            </div>
          </div>
        </section>

        <div className="ov-tiles">
          <Tile icon="layers" tone="navy" label="Total deliverables" value={k.total} sub={`${p.phases.length} phases`} onClick={() => filter('all')} />
          <Tile icon="refresh" tone="blue" label="Active" value={k.inProgress + k.inReview} sub="in progress / review" onClick={() => filter('status:In Progress')} />
          <Tile icon="check" tone="green" label="Completed" value={k.completed} sub={`${k.pct}% done`} onClick={() => filter('complete')} />
          <Tile icon="alert" tone={k.overdue ? 'red' : 'grey'} label="Overdue" value={k.overdue} sub={noDates ? 'no dates confirmed yet' : 'past planned end'} onClick={() => filter('overdue')} />
          <Tile icon="calendar" tone="amber" label={`Due in ${s.dueSoonDays} days`} value={k.dueSoon} sub="due this week" onClick={() => filter('duesoon')} />
          <Tile icon="shield" tone="violet" label="Pending approvals" value={k.pendingApprovals} sub="under approval / awaiting decision" onClick={() => filter('approvals')} />
          <Tile icon="flag" tone="grey" label="Not started" value={notStarted} sub={`${pct(notStarted, k.total)}% of total`} onClick={() => filter('status:Yet to Start')} />
          <Tile icon="overview" tone="green" label="Avg progress" value={`${avgProgress}%`} sub="indicative, by status" title={PROGRESS_HELP} onClick={() => go('tracker')} />
        </div>

        <section className="card ww">
          <header className="chart-head">
            <h2>Where it's pending — and with whom</h2>
            <span className="chart-sub">With Sun Pharma = client inputs, Sun-led items and approvals awaiting a decision</span>
          </header>
          <div className="ww-cards">
            <WhoCard mark="OA" color={OAM_COLOR} title="With OneAlphaMed" sub="to be delivered" items={withOam} onClick={() => filter('oam')} />
            <WhoCard mark="SP" color={SUN_COLOR} ink="#211f1f" title="With Sun Pharma" sub="client inputs & approvals" items={withSun} onClick={() => filter('sun')} />
            <WhoCard mark="✓" color={COMPLETE_COLOR} title="Closed" sub="completion confirmed" items={ds.filter(d => d.complete)} closed onClick={() => filter('complete')} />
          </div>
          <StackBar
            labels
            label="Where deliverables sit"
            series={[
              { key: 'oam', label: 'With OneAlphaMed', color: OAM_COLOR },
              { key: 'sun', label: 'With Sun Pharma', color: SUN_COLOR, ink: '#211f1f' },
              { key: 'closed', label: 'Closed', color: COMPLETE_COLOR },
            ]}
            counts={{ oam: withOam.length, sun: withSun.length, closed: k.completed }}
            onClick={key => filter(key === 'closed' ? 'complete' : key)}
          />
        </section>

        <ChartKey series={series.filter(x => all[x.key])} />

        <div className="exec-grid">
          <ChartCard title="Deliverables by status" sub="Statuses in use · click a bar to open those items" table={{ head: ['Status', 'Deliverables', 'Share'], rows: series.map(x => [x.label, all[x.key] ?? 0, `${pct(all[x.key] ?? 0, k.total)}%`]) }}>
            <HBars rows={series.map(x => ({ key: x.key, label: x.label, color: x.color, value: all[x.key] ?? 0 }))} onBar={byStatus} />
          </ChartCard>

          <ChartCard title="Progress by phase" sub="Bar length = deliverables, colour = status · right = confirmed complete" table={{ head: ['Phase', ...statusCols, 'Complete'], rows: phaseRows.map(r => [r.label, ...series.map(x => r.counts[x.key] ?? 0), `${pct(r.done, r.total)}%`]) }}>
            <StackRows series={series} rows={phaseRows.map(r => ({ key: r.key, label: r.label, counts: r.counts, right: <><b>{pct(r.done, r.total)}%</b><small>{r.done}/{r.total}</small></> }))} onRow={ph => go('tracker', { phase: ph })} />
          </ChartCard>
        </div>

        {p.milestones.length > 0 && (
          <ChartCard title="Key milestones" sub="In date order; dates show once confirmed in the sheet" table={{ head: ['Milestone', 'Phase', 'Planned date', 'Status'], rows: p.milestones.map(m => [plainName(m.name), m.phase, m.end ? fmtDate(m.end) : 'Not confirmed', m.complete ? 'Complete' : m.status || 'Not set']) }}>
            <ol className="ms-strip">
              {p.milestones.map(m => (
                <li key={m.key}>
                  <button className="ms-btn" onClick={() => go('tracker', { open: m.key })} title={`${plainName(m.name)} — ${m.complete ? 'Complete' : m.status}`}>
                    <i className={`ms-diamond${m.overdue ? ' late' : ''}`} style={{ background: m.complete ? COMPLETE_COLOR : p.statuses.color(m.status) }} aria-hidden />
                    <span className="ms-name">{plainName(m.name)}</span>
                    <span className={`ms-date${m.overdue ? ' bad' : ''}`}>{m.end ? fmtDate(m.end, { year: false }) : 'Date TBC'}</span>
                  </button>
                </li>
              ))}
            </ol>
          </ChartCard>
        )}
      </div>
    </TooltipLayer>
  );
}

function Tile({ icon, tone, label, value, sub, title, onClick }: { icon: string; tone: string; label: string; value: ReactNode; sub: string; title?: string; onClick: () => void }) {
  return (
    <button className={`ov-tile tone-${tone}`} onClick={onClick} title={title}>
      <span className="ov-icon"><Icon name={icon} size={18} /></span>
      <span className="ov-label">{label}</span>
      <span className="ov-value">{value}</span>
      <span className="ov-sub">{sub}</span>
    </button>
  );
}

function WhoCard({ mark, color, ink = '#fff', title, sub, items, closed, onClick }: { mark: string; color: string; ink?: string; title: string; sub: string; items: Deliverable[]; closed?: boolean; onClick: () => void }) {
  const { project: p } = useData();
  const statuses = closed ? [] : [...new Set(items.map(d => d.status))];
  const overdue = items.filter(d => d.overdue).length;
  return (
    <button className="ww-card" style={{ ['--c' as string]: color }} onClick={onClick}>
      <span className="ww-top">
        <span className="ww-mark" style={{ background: color, color: ink }}>{mark}</span>
        <span className="ww-title"><strong>{title}</strong><small>{sub}</small></span>
        <span className="ww-count">{items.length}</span>
      </span>
      <span className="ww-chips">
        {closed ? (
          <span className="ww-chip"><i className="swatch" style={{ background: COMPLETE_COLOR }} />Completion confirmed <b>{items.length}</b></span>
        ) : statuses.length === 0 ? (
          <span className="muted small">Nothing pending</span>
        ) : (
          statuses
            .sort((a, b) => (p.statuses.get(a)?.order ?? 99) - (p.statuses.get(b)?.order ?? 99))
            .map(st => <span key={st || 'none'} className="ww-chip"><i className="swatch" style={{ background: st ? p.statuses.color(st) : CATEGORY_COLOR.Unmapped }} />{st ? p.statuses.get(st)?.status ?? st : 'Status not set'}<b>{items.filter(d => d.status === st).length}</b></span>)
        )}
        {overdue > 0 && <span className="ww-chip ww-late"><Icon name="alert" size={12} /> {overdue} overdue</span>}
      </span>
    </button>
  );
}
