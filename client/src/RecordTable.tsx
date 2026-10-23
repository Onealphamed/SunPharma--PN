// Generic searchable / sortable / editable table for the secondary trackers
// (risks, decisions, actions, settings, statuses, holidays).
import { ReactNode, useMemo, useState } from 'react';
import type { Rec } from '../../shared/model';
import { norm } from '../../shared/model';
import { canCreate, TABLES, TableKey } from '../../shared/schema';
import { api } from './api';
import { useData } from './data';
import { FormSection, RecordForm } from './RecordForm';
import { History } from './History';
import { Confirm, D, Drawer, Empty, Icon, Menu, SearchBox, StatusBadge, Tag } from './ui';

export interface RecordTableProps {
  table: TableKey;
  rows: Rec[];
  columns: string[];
  sections: FormSection[];
  title?: string;
  createDefaults?: Record<string, unknown>;
  render?: Record<string, (r: Rec) => ReactNode>;
  rowTone?: (r: Rec) => 'red' | 'amber' | undefined;
  emptyText?: string;
  toolbar?: ReactNode;
  initialSort?: string;
}

export function RecordTable({ table, rows, columns, sections, createDefaults, render, rowTone, emptyText, toolbar, initialSort }: RecordTableProps) {
  const { user, internal, archive, toast } = useData();
  const spec = TABLES[table];
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: initialSort ?? spec.idKey, dir: 1 });
  const [open, setOpen] = useState<Rec | 'new' | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<Rec | null>(null);

  const visible = useMemo(() => {
    const qq = norm(q);
    let out = rows.filter(r => !spec.archiveKey || norm(r[spec.archiveKey]) !== 'yes');
    if (qq) out = out.filter(r => columns.some(c => norm(r[c]).includes(qq)) || norm(r._key).includes(qq));
    return [...out].sort((a, b) => {
      const av = a[sort.key] ?? '';
      const bv = b[sort.key] ?? '';
      if (av === bv) return 0;
      if (av === '') return 1;
      if (bv === '') return -1;
      return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true })) * sort.dir;
    });
  }, [rows, q, sort, columns, spec]);

  const cell = (r: Rec, k: string): ReactNode => {
    if (render?.[k]) return render[k](r);
    const col = spec.columns.find(c => c.key === k)!;
    const v = r[k];
    if (col.type === 'date') return <D v={v} />;
    if (col.optionsFrom === 'statuses') return <StatusBadge status={v as string} />;
    if (k === 'visibility') return <Tag tone={v === 'Client' ? 'blue' : 'neutral'}>{String(v ?? '—')}</Tag>;
    if (col.type === 'enum' && ['Yes', 'No', 'N/A'].includes(String(v))) return <span className={`yn yn-${String(v).toLowerCase().replace('/', '')}`}>{String(v)}</span>;
    if (v === null || v === undefined || v === '') return <span className="muted">—</span>;
    return <span className={col.type === 'longtext' ? 'clamp' : undefined}>{String(v)}</span>;
  };

  const doExport = async (format: 'xlsx' | 'csv') => {
    try {
      await api.exportTable(table, format, visible.map(r => r._key));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="record-table">
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={`Search ${spec.label.toLowerCase()}…`} />
        {toolbar}
        <div className="spacer" />
        <span className="muted small">{visible.length} of {rows.length}</span>
        <Menu label="Export" icon="download">
          <button onClick={() => doExport('xlsx')}>Excel (.xlsx)</button>
          <button onClick={() => doExport('csv')}>CSV</button>
        </Menu>
        {canCreate(user.role, table) && (
          <button className="btn btn-primary" onClick={() => setOpen('new')}>
            <Icon name="plus" /> Add
          </button>
        )}
      </div>
      {visible.length === 0 ? (
        <Empty title={rows.length ? 'No matches' : 'Nothing recorded yet'}>{rows.length ? 'Try a different search.' : emptyText}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                {[spec.idKey, ...columns].map(k => {
                  const col = spec.columns.find(c => c.key === k)!;
                  return (
                    <th key={k} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                      <button className="th-btn" onClick={() => setSort(s => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : 1 }))}>
                        {col.header}
                        {sort.key === k && <span aria-hidden>{sort.dir === 1 ? ' ▲' : ' ▼'}</span>}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r._key} className={`clickable ${rowTone?.(r) ? `row-${rowTone(r)}` : ''}`} onClick={() => setOpen(r)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && setOpen(r)}>
                  <td className="mono nowrap">{r._key}</td>
                  {columns.map(k => (
                    <td key={k}>{cell(r, k)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Drawer
        open={!!open}
        onClose={() => setOpen(null)}
        title={open === 'new' ? `Add to ${spec.label}` : open ? `${open._key}` : ''}
        subtitle={open && open !== 'new' ? String(open.title ?? open.name ?? open.action ?? open.decision ?? open.role ?? '') : undefined}
        footer={
          open && open !== 'new' && spec.archiveKey && user.role === 'admin' ? (
            <button className="btn btn-danger-ghost" onClick={() => setConfirmArchive(open)}>Archive…</button>
          ) : undefined
        }
      >
        {open && (
          <>
            <RecordForm key={open === 'new' ? 'new' : open._key} table={table} rec={open === 'new' ? null : open} sections={sections} defaults={createDefaults} onDone={() => setOpen(null)} onCancel={() => setOpen(null)} />
            {open !== 'new' && internal && <History recordId={open._key} />}
          </>
        )}
      </Drawer>
      <Confirm
        open={!!confirmArchive}
        title={`Archive ${confirmArchive?._key}?`}
        body={<p>The row stays in the sheet with Archived = Yes and disappears from the dashboard. You can restore it by setting Archived back to No in the sheet.</p>}
        confirmLabel="Archive"
        danger
        onCancel={() => setConfirmArchive(null)}
        onConfirm={async () => {
          const r = confirmArchive!;
          setConfirmArchive(null);
          setOpen(null);
          try {
            await archive(table, r);
          } catch (e) {
            toast((e as Error).message, 'error');
          }
        }}
      />
    </div>
  );
}
