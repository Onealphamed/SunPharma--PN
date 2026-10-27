// Schema-driven create/edit form used for every table. Field editability follows the
// role rules in shared/schema (the server re-checks them) and the columns actually
// present in the live sheet.
import { useMemo, useState } from 'react';
import { addWorkingDays, fmtDate } from '../../shared/dates';
import type { Rec } from '../../shared/model';
import { canCreate, canEditField, ColumnSpec, TABLES, TableKey } from '../../shared/schema';
import { ApiError } from './api';
import { useData } from './data';
import { FieldInput, Icon } from './ui';

export interface FormSection {
  title?: string;
  fields: string[];
}

export function RecordForm({ table, rec, sections, defaults, onDone, onCancel, submitLabel }: {
  table: TableKey;
  rec: Rec | null;
  sections: FormSection[];
  defaults?: Record<string, unknown>;
  onDone?: (id: string) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const { user, project, snap, canEditCol, update, create } = useData();
  const spec = TABLES[table];
  const creating = !rec;
  const initial = useMemo(() => {
    const o: Record<string, unknown> = {};
    for (const c of spec.columns) o[c.key] = rec ? rec[c.key] ?? null : defaults?.[c.key] ?? null;
    return o;
  }, [rec, defaults, spec]);
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<{ header: string; current: unknown; yours: unknown }[] | null>(null);

  const editable = (c: ColumnSpec) => {
    if (rec?._readonly) return false;
    if (!canEditCol(table, c.key)) return false; // column missing in sheet
    if (creating) return canCreate(user.role, table) && c.edit !== 'none' && (canEditField(user.role, table, c.key) || ['phase', 'workstream'].includes(c.key));
    return canEditField(user.role, table, c.key);
  };
  const changed = Object.keys(values).filter(k => JSON.stringify(values[k] ?? null) !== JSON.stringify(initial[k] ?? null));
  const statusOptions = project.statuses.activeNames();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setConflicts(null);
    const missing = spec.columns.filter(c => c.required && c.key !== spec.idKey && editable(c) && (values[c.key] === null || values[c.key] === ''));
    if (missing.length) return setError(`Please fill in: ${missing.map(m => m.header).join(', ')}`);
    setBusy(true);
    try {
      if (creating) {
        const payload: Record<string, unknown> = {};
        for (const k of Object.keys(values)) if (values[k] !== null && values[k] !== '') payload[k] = values[k];
        const id = await create(table, payload);
        onDone?.(id);
      } else {
        if (!changed.length) return onDone?.(rec!._key);
        const changes: Record<string, unknown> = {};
        for (const k of changed) changes[k] = values[k];
        await update(table, rec!, changes);
        onDone?.(rec!._key);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details?.conflicts) setConflicts(err.details.conflicts);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="record-form" onSubmit={submit} noValidate>
      {rec?._readonly && (
        <div className="notice notice-warn">
          <Icon name="alert" /> Read-only: {rec._readonly}. Fix this row in the source sheet.
        </div>
      )}
      {sections.map((s, i) => (
        <fieldset key={i}>
          {s.title && <legend>{s.title}</legend>}
          <div className="form-grid">
            {s.fields.map(k => {
              const c = spec.columns.find(x => x.key === k);
              if (!c) return null;
              const can = editable(c);
              if (creating && !can && c.edit === 'none') return null;
              const id = `f-${table}-${k}`;
              const wide = c.type === 'longtext';
              return (
                <div key={k} className={`field${wide ? ' field-wide' : ''}${changed.includes(k) ? ' field-changed' : ''}`}>
                  <label htmlFor={id}>
                    {c.header}
                    {c.required && can && <span className="req" aria-hidden> *</span>}
                    {c.internal && <span className="internal-flag" title="Agency only — never shown to the client">internal</span>}
                  </label>
                  <FieldInput id={id} col={c} value={values[k]} disabled={!can || busy} options={c.optionsFrom === 'statuses' ? statusOptions : undefined} onChange={v => setValues(o => ({ ...o, [k]: v }))} />
                  {c.help && <small className="help">{c.help}</small>}
                  {table === 'deliverables' && k === 'plannedEnd' && can && !values.plannedEnd && typeof values.plannedStart === 'string' && typeof values.durationWd === 'number' && values.durationWd > 0 && (() => {
                    const end = addWorkingDays(values.plannedStart as string, (values.durationWd as number) - 1, project.cal);
                    return <button type="button" className="btn btn-sm" onClick={() => setValues(o => ({ ...o, plannedEnd: end }))}>Use {fmtDate(end)} ({String(values.durationWd)} working days from start)</button>;
                  })()}
                  {table === 'deliverables' && k === 'actualEnd' && can && values.completionConfirmed === 'Yes' && !values.actualEnd && (
                    <button type="button" className="btn btn-sm" onClick={() => setValues(o => ({ ...o, actualEnd: project.today }))}>Completed today ({fmtDate(project.today)})</button>
                  )}
                  {!(snap.columns[table] ?? []).includes(k) && !creating && <small className="help warn">Column not present in the sheet</small>}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" /> {error}
          {conflicts && (
            <ul className="conflicts">
              {conflicts.map((c, i) => (
                <li key={i}>
                  <strong>{c.header}</strong>: now “{String(c.current ?? '—')}” in the sheet — you entered “{String(c.yours ?? '—')}”.
                </li>
              ))}
              <li className="muted">Close and reopen this record to load the latest values, then re-apply your change.</li>
            </ul>
          )}
        </div>
      )}
      <div className="form-actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>}
        {(creating ? canCreate(user.role, table) : spec.columns.some(editable)) && (
          <button type="submit" className="btn btn-primary" disabled={busy || (!creating && !changed.length)}>
            {busy ? 'Saving…' : submitLabel ?? (creating ? 'Create' : changed.length ? `Save ${changed.length} change${changed.length > 1 ? 's' : ''}` : 'No changes')}
          </button>
        )}
      </div>
    </form>
  );
}
