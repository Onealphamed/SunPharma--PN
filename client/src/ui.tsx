import { ReactNode, useEffect, useRef, useState } from 'react';
import { fmtDate } from '../../shared/dates';
import { Health, HEALTH_LABEL } from '../../shared/project';
import type { ColumnSpec, ScheduleFlag } from '../../shared/schema';
import { CATEGORY_COLOR, COMPLETE_COLOR } from '../../shared/status';
import { useData } from './data';

const PATHS: Record<string, string> = {
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  grid: 'M3 4h18v16H3zM3 9h18M3 14h18M9 4v16M15 4v16',
  inbox: 'M3 13h5l1 3h6l1-3h5M5 5h14l2 8v6H3v-6z',
  file: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  comment: 'M4 5h16v11H9l-5 4z',
  overview: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  gantt: 'M3 5h8M7 10h10M5 15h7M12 20h9',
  flag: 'M4 21V4m0 0h12l-2 4 2 4H4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  notes: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  users: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7M21 19v-1a4 4 0 00-3-3.9M16 3.1a3.5 3.5 0 010 6.8',
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  refresh: 'M21 12a9 9 0 11-2.6-6.4M21 4v5h-5',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3',
  x: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  alert: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  check: 'M5 12l5 5L20 7',
  logout: 'M15 4h4v16h-4M10 17l5-5-5-5M15 12H3',
  menu: 'M4 6h16M4 12h16M4 18h16',
  calendar: 'M4 5h16v16H4zM4 9h16M8 3v4M16 3v4',
  diamond: 'M12 2l10 10-10 10L2 12z',
  link: 'M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1',
  sun: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z',
  moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z',
  print: 'M6 9V3h12v6M6 18H4v-6h16v6h-2M6 14h12v7H6z',
};

export function Icon({ name, size = 16, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const { project } = useData();
  const def = project.statuses.get(status);
  const color = def?.color ?? CATEGORY_COLOR.Unmapped;
  if (!status) return <span className="unconfirmed" title="No status recorded">Status not set</span>;
  return (
    <span className="badge" style={{ ['--c' as string]: color }} title={def ? def.definition : 'Not one of the configured statuses'}>
      <span className="dot" />
      {def?.status ?? status}
      {!def && ' (unrecognised)'}
    </span>
  );
}

export function CompleteBadge() {
  return (
    <span className="badge" style={{ ['--c' as string]: COMPLETE_COLOR }} title="Completion Confirmed = Yes">
      <span className="dot" />
      Complete
    </span>
  );
}

const FLAG_CLASS: Record<ScheduleFlag, string> = { Upcoming: 'upcoming', 'On Track': 'ontrack', 'At Risk': 'atrisk', Overdue: 'overdue', Completed: 'completed' };
export function FlagBadge({ flag, title }: { flag: ScheduleFlag; title?: string }) {
  return <span className={`flag flag-${FLAG_CLASS[flag]}`} title={title}>{flag}</span>;
}

/** A planned date, or an explicit "not confirmed" marker — dates are never invented. */
export function PlanDate({ v, label = 'Date not confirmed' }: { v: string | null | undefined; label?: string }) {
  return v ? <>{fmtDate(v)}</> : <span className="unconfirmed">{label}</span>;
}

/** Horizontal bar list: one hue, direct value labels, hover title per bar. */
export function BarList({ rows, max, format = n => String(n), onClick }: { rows: { label: ReactNode; value: number; title?: string; key: string }[]; max?: number; format?: (n: number) => string; onClick?: (key: string) => void }) {
  const m = max ?? Math.max(1, ...rows.map(r => r.value));
  return (
    <div className="bars" role="list">
      {rows.map(r => (
        <div key={r.key} className="bar-row" role="listitem" title={r.title} onClick={onClick ? () => onClick(r.key) : undefined} style={onClick ? { cursor: 'pointer' } : undefined}>
          <span className="bar-label-text">{r.label}</span>
          <span className="bar-track"><i className={r.value ? '' : 'zero'} style={{ width: `${(r.value / m) * 100}%` }} /></span>
          <span className="bar-val">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Tag({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'red' | 'amber' | 'green' | 'blue' | 'purple'; title?: string }) {
  return <span className={`tag tag-${tone}`} title={title}>{children}</span>;
}

export function HealthPill({ health, override, large }: { health: Health; override?: boolean; large?: boolean }) {
  return (
    <span className={`health health-${health}${large ? ' health-lg' : ''}`}>
      <span className="dot" />
      {HEALTH_LABEL[health]}
      {override && <small> · PM override</small>}
    </span>
  );
}

export function Progress({ value, color, label }: { value: number; color?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="progress" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div style={{ width: `${v}%`, background: color }} />
    </div>
  );
}

export function Kpi({ label, value, sub, tone, onClick, hint }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'red' | 'amber' | 'green' | 'blue'; onClick?: () => void; hint?: string }) {
  const El = onClick ? 'button' : 'div';
  return (
    <El className={`kpi${tone ? ` kpi-${tone}` : ''}${onClick ? ' clickable' : ''}`} onClick={onClick} title={hint}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </El>
  );
}

export function Card({ title, actions, children, className, subtitle }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; subtitle?: ReactNode }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ title, children, icon = 'notes' }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Drawer({ open, title, subtitle, onClose, children, footer, wide }: { open: boolean; title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`drawer${wide ? ' drawer-wide' : ''}`} role="dialog" aria-modal="true" ref={ref} tabIndex={-1}>
        <header className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="drawer-sub">{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Confirm({ open, title, body, confirmLabel, danger, onConfirm, onCancel }: { open: boolean; title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  if (!open) return null;
  return (
    <div className="overlay center" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="alertdialog" aria-modal="true">
        <h2>{title}</h2>
        <div className="modal-body">{body}</div>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} autoFocus>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function D({ v, empty = '—', weekday }: { v: unknown; empty?: string; weekday?: boolean }) {
  return typeof v === 'string' && v ? <>{fmtDate(v, { weekday })}</> : <span className="muted">{empty}</span>;
}

export function relTime(iso: string | Date | null | undefined): string {
  if (!iso) return 'never';
  const t = typeof iso === 'string' ? new Date(iso) : iso;
  const s = Math.round((Date.now() - t.getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return t.toLocaleString();
}

/** Re-render periodically so relative times stay current. */
export function useTick(ms = 15000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set(x => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function FieldInput({ col, value, onChange, disabled, options, id }: { col: ColumnSpec; value: unknown; onChange: (v: unknown) => void; disabled?: boolean; options?: string[]; id?: string }) {
  const v = value === null || value === undefined ? '' : String(value);
  if (col.type === 'enum') {
    const opts = options ?? col.options ?? [];
    return (
      <select id={id} value={v} disabled={disabled} onChange={e => onChange(e.target.value || null)}>
        <option value="">{col.required ? 'Select…' : '—'}</option>
        {v && !opts.includes(v) && <option value={v}>{v} (not in list)</option>}
        {opts.map(o => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (col.type === 'longtext') return <textarea id={id} value={v} disabled={disabled} rows={3} onChange={e => onChange(e.target.value)} />;
  if (col.type === 'date') return <input id={id} type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''} disabled={disabled} onChange={e => onChange(e.target.value || null)} />;
  if (col.type === 'number')
    return <input id={id} type="number" min={0} value={v} disabled={disabled} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
  return <input id={id} type="text" value={v} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder={col.type === 'idlist' ? 'e.g. PN-1.2.01, PN-1.2.02' : col.key === 'related' || col.key === 'deliverableId' ? 'e.g. PN-2.3.01' : undefined} list={['related', 'predecessors', 'deliverableId'].includes(col.key) ? 'deliverable-ids' : undefined} />;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="search">
      <Icon name="search" />
      <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

export function Menu({ label, icon, children }: { label: string; icon?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className="btn" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {icon && <Icon name={icon} />} {label} <Icon name="down" size={14} />
      </button>
      {open && (
        <div className="menu-pop" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
