// Small chart kit for the Executive Summary: plain HTML bars (no chart library).
// Rules: series colours follow the entity in a fixed, validated order; text is always ink,
// never the series colour; every chart has a key or direct labels, a hover tooltip and a
// table view of the same numbers.
import { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import { Icon } from './ui';

export interface Series {
  key: string;
  label: string;
  color: string;
  /** Text colour for labels printed on this series' marks (dark on light fills). */
  ink?: string;
}
export type Counts = Record<string, number>;

type Tip = { x: number; y: number; content: ReactNode } | null;
const TipCtx = createContext<{ show: (e: React.MouseEvent, content: ReactNode) => void; hide: () => void } | null>(null);

/** Provides one floating tooltip for all charts inside it. */
export function TooltipLayer({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<Tip>(null);
  const show = useCallback((e: React.MouseEvent, content: ReactNode) => setTip({ x: e.clientX, y: e.clientY, content }), []);
  const hide = useCallback(() => setTip(null), []);
  return (
    <TipCtx.Provider value={{ show, hide }}>
      {children}
      {tip && (
        <div className="chart-tip" role="tooltip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 240), top: tip.y + 14 }}>
          {tip.content}
        </div>
      )}
    </TipCtx.Provider>
  );
}

const useTip = () => useContext(TipCtx) ?? { show: () => undefined, hide: () => undefined };
export const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

export function TipBody({ title, rows }: { title: string; rows: [ReactNode, ReactNode][] }) {
  return (
    <>
      <strong>{title}</strong>
      <table>
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i}><td>{k}</td><td className="num">{v}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export const Swatch = ({ color }: { color: string }) => <i className="swatch" style={{ background: color }} aria-hidden />;

/** Colour key for a set of series, optionally with counts. */
export function ChartKey({ series, counts }: { series: Series[]; counts?: Counts }) {
  return (
    <div className="chart-key">
      {series.map(s => (
        <span key={s.key}>
          <Swatch color={s.color} />
          {s.label}
          {counts && <b>{counts[s.key] ?? 0}</b>}
        </span>
      ))}
    </div>
  );
}

/** One horizontal 100% bar split by series (2px gaps). `labels` prints counts on the segments. */
export function StackBar({ series, counts, label, labels, onClick }: { series: Series[]; counts: Counts; label: string; labels?: boolean; onClick?: (key: string) => void }) {
  const { show, hide } = useTip();
  const shown = series.filter(s => (counts[s.key] ?? 0) > 0);
  const total = shown.reduce((a, s) => a + counts[s.key], 0);
  if (!total) return <div className="stack stack-empty" aria-label={`${label}: none`} />;
  return (
    <div className={`stack${labels ? ' stack-lg' : ''}`} role="img" aria-label={`${label}: ${shown.map(s => `${s.label} ${counts[s.key]}`).join(', ')}`}>
      {shown.map(s => (
        <span
          key={s.key}
          className={`stack-seg${onClick ? ' clickable' : ''}`}
          style={{ flexGrow: counts[s.key], background: s.color, color: s.ink ?? '#fff' }}
          onMouseMove={e => show(e, <TipBody title={label} rows={[[<><Swatch color={s.color} /> {s.label}</>, `${counts[s.key]} · ${pct(counts[s.key], total)}%`], ['Total', total]]} />)}
          onMouseLeave={hide}
          onClick={onClick ? () => onClick(s.key) : undefined}
        >
          {labels && counts[s.key]}
        </span>
      ))}
    </div>
  );
}

/** A card that can switch between the chart and a table of the same numbers. */
export function ChartCard({ title, sub, children, table, className }: { title: string; sub?: ReactNode; children: ReactNode; table: { head: string[]; rows: (string | number)[][] }; className?: string }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card chart-card${className ? ` ${className}` : ''}`}>
      <header className="chart-head">
        <div>
          <h2>{title}</h2>
          {sub && <div className="chart-sub">{sub}</div>}
        </div>
        <button className="icon-btn no-print" onClick={() => setAsTable(t => !t)} aria-pressed={asTable} title={asTable ? 'Show chart' : 'Show as table'} aria-label={asTable ? 'Show chart' : 'Show as table'}>
          <Icon name={asTable ? 'gantt' : 'list'} />
        </button>
      </header>
      {asTable ? (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr>{table.head.map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === 'number' ? 'num' : undefined}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
    </section>
  );
}

/** Rows of stacked bars with a label on the left and a value on the right; bar length = row total. */
export function StackRows({ series, rows, onRow }: { series: Series[]; rows: { key: string; label: string; counts: Counts; right: ReactNode }[]; onRow?: (key: string) => void }) {
  const totals = rows.map(r => series.reduce((a, s) => a + (r.counts[s.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <div className="stack-rows">
      {rows.map((r, i) => (
        <div key={r.key} className={`stack-row${onRow ? ' clickable' : ''}`} onClick={onRow ? () => onRow(r.key) : undefined}>
          <span className="sr-label" title={r.label}>{r.label}</span>
          <span className="sr-track"><span style={{ width: `${(totals[i] / max) * 100}%` }}><StackBar series={series} counts={r.counts} label={r.label} /></span></span>
          <span className="sr-right">{r.right}</span>
        </div>
      ))}
    </div>
  );
}

/** Simple horizontal bars, one colour per bar, value labelled at the end. Zero rows are left out. */
export function HBars({ rows: allRows, onBar }: { rows: { key: string; label: string; color: string; value: number }[]; onBar?: (key: string) => void }) {
  const { show, hide } = useTip();
  const rows = allRows.filter(r => r.value > 0);
  const max = Math.max(1, ...rows.map(r => r.value));
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="hbars">
      {rows.map(r => (
        <div
          key={r.key}
          className={`hbar-row${onBar ? ' clickable' : ''}`}
          onClick={onBar ? () => onBar(r.key) : undefined}
          onMouseMove={e => show(e, <TipBody title={r.label} rows={[['Deliverables', r.value], ['Share', `${pct(r.value, total)}%`]]} />)}
          onMouseLeave={hide}
        >
          <span className="hb-label"><Swatch color={r.color} />{r.label}</span>
          <span className="hb-track">{r.value > 0 && <span className="hb-bar" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />}</span>
          <span className="hb-val">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Bullet-style bars: confirmed complete (filled) out of total (track). */
export function CompletionBars({ rows, color, onBar }: { rows: { key: string; label: string; done: number; total: number }[]; color: string; onBar?: (key: string) => void }) {
  const { show, hide } = useTip();
  const max = Math.max(1, ...rows.map(r => r.total));
  return (
    <div className="hbars">
      {rows.map(r => (
        <div
          key={r.key}
          className={`hbar-row${onBar ? ' clickable' : ''}`}
          onClick={onBar ? () => onBar(r.key) : undefined}
          onMouseMove={e => show(e, <TipBody title={r.label} rows={[['Completion confirmed', r.done], ['Total', r.total], ['Complete', `${pct(r.done, r.total)}%`]]} />)}
          onMouseLeave={hide}
        >
          <span className="hb-label">{r.label}</span>
          <span className="hb-track">
            <span className="hb-total" style={{ width: `${(r.total / max) * 100}%` }}>
              {r.done > 0 && <span className="hb-bar" style={{ width: `${(r.done / r.total) * 100}%`, background: color }} />}
            </span>
          </span>
          <span className="hb-val">{r.done}/{r.total}</span>
        </div>
      ))}
    </div>
  );
}
