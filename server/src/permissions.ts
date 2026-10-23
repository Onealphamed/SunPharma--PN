// Server-side data projection by role. This is the confidentiality boundary: the
// client role only ever receives rows and columns that pass these rules, so hiding
// something in the UI is never the only protection.
import type { Rec } from '../../shared/model';
import { norm } from '../../shared/model';
import { isInternalRole, Role, TABLES, TableKey } from '../../shared/schema';

export function canReadTable(role: Role, table: TableKey): boolean {
  return isInternalRole(role) || !TABLES[table].internalOnly;
}

export function projectRecord(role: Role, table: TableKey, rec: Rec): Rec {
  if (isInternalRole(role)) return rec;
  const out: Rec = { _row: 0, _key: rec._key };
  for (const col of TABLES[table].columns) if (!col.internal) out[col.key] = rec[col.key];
  return out;
}

export function rowVisible(role: Role, table: TableKey, rec: Rec): boolean {
  if (isInternalRole(role)) return true;
  const spec = TABLES[table];
  if (spec.archiveKey && norm(rec[spec.archiveKey]) === 'yes') return false;
  if (spec.clientRows) {
    const v = rec[spec.clientRows.key];
    // Rows with a blank visibility flag are treated as internal (safe default),
    // except deliverables, which default to client-visible as in the migration.
    if (v === null || v === undefined || v === '') return table === 'deliverables';
    if (spec.clientRows.hiddenValues.some(h => norm(h) === norm(v))) return false;
  }
  return true;
}

export function projectTables(role: Role, tables: Partial<Record<TableKey, Rec[]>>): Partial<Record<TableKey, Rec[]>> {
  const out: Partial<Record<TableKey, Rec[]>> = {};
  for (const [k, recs] of Object.entries(tables) as [TableKey, Rec[]][]) {
    if (!recs || !canReadTable(role, k)) continue;
    out[k] = recs.filter(r => rowVisible(role, k, r)).map(r => projectRecord(role, k, r));
  }
  return out;
}

/** Visible column keys per table for this role (for exports and the UI). */
export function visibleColumns(role: Role, table: TableKey): string[] {
  return TABLES[table].columns.filter(c => isInternalRole(role) || !c.internal).map(c => c.key);
}
