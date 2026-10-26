// Converts the "Readiness Checklist" worksheet into the live tracker tabs and writes an
// import report. ONLY that worksheet is read — Overview, Gantt Timeline, KOL Tracker,
// Board Tracker and Reference are deliberately ignored, as required by the brief.
// Nothing is invented: blank source cells stay blank, and every derived value is
// listed in the report with the rule that produced it.
import type ExcelJS from 'exceljs';
import { parseDate } from '../../shared/dates';
import { norm, parseTable, Rec, splitIds } from '../../shared/model';
import { buildProject, plainName } from '../../shared/project';
import { ColumnSpec, DELIVERABLE_TYPES, LEADS, TABLES, TableKey } from '../../shared/schema';
import { DEFAULT_STATUSES, StatusMap } from '../../shared/status';
import { suggestDependencies } from '../../shared/suggestions';

export const SOURCE_SHEET = 'Readiness Checklist';

export type Cell = string | number | null;
export interface Tab { header: string[]; rows: Cell[][] }
export interface Finding { severity: 'error' | 'warning' | 'info'; area: string; message: string }

export interface ImportResult {
  tables: Record<string, Tab>;
  findings: Finding[];
  report: string;
  counts: { deliverables: number; phases: number; workstreams: number; headings: number };
}

/** Official phase names from the project brief, checked against the checklist headings. */
export const PHASE_NAMES: Record<string, string> = {
  'Phase 1': 'Phase 1: Mobilisation & Client Inputs',
  'Phase 2': 'Phase 2: Scientific Content & Approvals',
  'Phase 3': 'Phase 3: Regional Advisory Boards (AB-1 to AB-4)',
  'Phase 4': 'Phase 4: National Consensus Advisory Board (NAB-5)',
  'Phase 5': 'Phase 5: Consolidation, Final Deliverables & Close-out',
};

/** Source column header → field key. Matched by header text, not by column letter. */
const SOURCE_COLUMNS: [string, string][] = [
  ['Phase', 'phase'], ['Workstream', 'workstream'], ['Task / Activity', 'name'], ['Description & Key Deliverables', 'description'],
  ['Type', 'type'], ['Lead', 'lead'], ['Lead Function', 'leadFunction'], ['OAM Owner', 'oamOwner'], ['Sun Owner', 'sunOwner'],
  ['Duration (WD)', 'durationWd'], ['Status', 'status'], ['Schedule Flag', 'scheduleFlag'], ['Remarks', 'remarks'],
];

/** Live-tracker fields that are part of the checklist itself (everything else is optional). */
const CHECKLIST_KEYS = new Set(['phase', 'workstream', 'name', 'description', 'type', 'lead', 'leadFunction', 'oamOwner', 'sunOwner', 'durationWd', 'status', 'remarks']);
/** Fields never read from the sheet: system-managed or derived. */
const SYSTEM_KEYS = new Set(['wsCode', 'scheduleFlagSource', 'statusOriginal', 'sourceRow', 'sortOrder', 'lastUpdated', 'updatedBy', 'archived']);

export function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as any;
    if ('result' in o) return o.result ?? null;
    if ('richText' in o) return o.richText.map((t: any) => t.text).join('');
    if ('text' in o) return o.text;
    if ('error' in o) return null;
  }
  return v;
}
// Trim only: inner spacing and characters such as "◆", "–" and "≥" are kept exactly.
const str = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? (isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)) : String(v).trim());

function rowOf(key: TableKey, rec: Record<string, Cell>): Cell[] {
  return TABLES[key].columns.map(c => (rec[c.key] === undefined ? null : rec[c.key]));
}

/** Value of an optional tracker column, typed like the live tracker column. */
function typedValue(col: ColumnSpec, raw: unknown): { value: Cell; invalid?: string } {
  const s = str(raw);
  if (!s) return { value: null };
  switch (col.type) {
    case 'date': {
      const p = parseDate(raw instanceof Date ? raw : s);
      return p.iso ? { value: p.iso } : { value: null, invalid: s };
    }
    case 'number': {
      const n = Number(s);
      return isFinite(n) ? { value: n } : { value: null, invalid: s };
    }
    case 'enum': {
      const hit = col.options?.find(o => norm(o) === norm(s));
      return { value: hit ?? s, invalid: col.options && !hit ? s : undefined };
    }
    case 'idlist':
      return { value: splitIds(s).join(', ') || null };
    default:
      return { value: s };
  }
}

/**
 * opts.live: the workbook is the live Google Sheet, read on every sync. Rows then carry no
 * import timestamp, and IDs come from a "Deliverable ID" column when the team adds one.
 */
export function importChecklist(wb: ExcelJS.Workbook, opts: { sourceName: string; importedAt: string; live?: boolean }): ImportResult {
  const findings: Finding[] = [];
  const f = (severity: Finding['severity'], area: string, message: string) => findings.push({ severity, area, message });
  const statusMap = new StatusMap(DEFAULT_STATUSES);

  const others = wb.worksheets.map(w => w.name).filter(n => n !== SOURCE_SHEET);
  const ws = wb.getWorksheet(SOURCE_SHEET);
  if (!ws) throw new Error(`Worksheet "${SOURCE_SHEET}" not found. Sheets in the workbook: ${wb.worksheets.map(w => w.name).join(', ')}`);
  f('info', 'Scope', `Read worksheet "${SOURCE_SHEET}" only. Not read: ${others.join(', ') || 'none'}.`);

  // Header row → column numbers.
  const headerRow = ws.getRow(1);
  const colOf: Record<string, number> = {};
  headerRow.eachCell({ includeEmpty: false }, (c, n) => {
    const h = norm(str(cellValue(c.value)));
    const hit = SOURCE_COLUMNS.find(([name]) => norm(name) === h);
    if (hit && !colOf[hit[1]]) colOf[hit[1]] = n;
  });
  for (const [name, key] of SOURCE_COLUMNS) if (!colOf[key]) f('error', 'Structure', `Column "${name}" not found in the header row.`);
  const get = (r: number, key: string) => (colOf[key] ? cellValue(ws.getRow(r).getCell(colOf[key]).value) : null);

  // Tracker columns the team may add to the checklist (Planned Start Date, Completion Confirmed,
  // Deliverable ID…), matched by the live-tracker header names.
  const optional = TABLES.deliverables.columns.filter(c => !CHECKLIST_KEYS.has(c.key) && !SYSTEM_KEYS.has(c.key));
  const extraCol = new Map<ColumnSpec, number>();
  headerRow.eachCell({ includeEmpty: false }, (c, n) => {
    const h = norm(str(cellValue(c.value)));
    const col = optional.find(o => [o.header, ...(o.aliases ?? [])].some(x => norm(x) === h));
    if (col && ![...extraCol.keys()].includes(col)) extraCol.set(col, n);
  });
  if (extraCol.size) f('info', 'Tracker columns', `Tracker columns found in the checklist and used: ${[...extraCol.keys()].map(c => c.header).join(', ')}.`);
  const idCol = [...extraCol.keys()].find(c => c.key === 'id');

  const deliverables: Record<string, Cell>[] = [];
  const phases: Record<string, Cell>[] = [];
  const headings: { row: number; kind: 'phase' | 'workstream'; text: string }[] = [];
  const statusesSeen = new Map<string, number>();
  let wsCode = '';
  let wsName = '';
  let seq = 0;
  let order = 0;

  for (let r = 2; r <= ws.rowCount; r++) {
    const a = str(get(r, 'phase'));
    const c = str(get(r, 'name'));
    if (!a && !c) continue;
    // Merged heading rows repeat the same text across every column.
    const ph = a.match(/^PHASE\s+(\d+):\s*(.+?)\s*$/i);
    if (ph && (!c || c === a)) {
      const [title, ...rest] = ph[2].split(/\s+·\s+/);
      const phase = `Phase ${ph[1]}`;
      const name = PHASE_NAMES[phase] ?? `${phase}: ${title}`;
      if (norm(name.replace(/^Phase \d+:\s*/, '')) !== norm(title)) f('warning', 'Phases', `Heading "${title}" differs from the expected name "${name}".`);
      phases.push({ phase, name, summary: rest.join(' · ').trim() || null, order: +ph[1] });
      headings.push({ row: r, kind: 'phase', text: a });
      continue;
    }
    const wh = a.match(/^(\d+\.\d+)\s+(.+)$/);
    if (wh && (!c || c === a)) {
      wsCode = wh[1];
      wsName = wh[2].trim();
      seq = 0;
      headings.push({ row: r, kind: 'workstream', text: a });
      continue;
    }
    if (!/^Phase \d+$/i.test(a) || !c) {
      f('warning', 'Rows', `Row ${r} is neither a heading nor a task — skipped: "${a || c}".`);
      continue;
    }
    seq++;
    order += 10;
    const ownId = idCol ? str(cellValue(ws.getRow(r).getCell(extraCol.get(idCol)!).value)) : '';
    const id = ownId || `PN-${wsCode || '0.0'}.${String(seq).padStart(2, '0')}`;
    const workstream = str(get(r, 'workstream'));
    if (wsName && norm(workstream) !== norm(wsName)) f('warning', 'Workstreams', `${id} (row ${r}): Workstream "${workstream}" differs from its section heading "${wsName}".`);
    const rawType = str(get(r, 'type'));
    const type = DELIVERABLE_TYPES.find(t => norm(t) === norm(rawType)) ?? (rawType || null);
    if (rawType && !DELIVERABLE_TYPES.some(t => norm(t) === norm(rawType))) f('warning', 'Type', `${id}: unrecognised Type "${rawType}" kept as-is.`);
    const rawLead = str(get(r, 'lead'));
    const lead = LEADS.find(l => norm(l) === norm(rawLead)) ?? (rawLead || null);
    const rawStatus = str(get(r, 'status'));
    statusesSeen.set(rawStatus || '(blank)', (statusesSeen.get(rawStatus || '(blank)') ?? 0) + 1);
    const def = rawStatus ? statusMap.get(rawStatus) : undefined;
    if (rawStatus && !def) f('error', 'Status', `${id}: status "${rawStatus}" does not match any of the eight statuses — kept as-is and flagged.`);
    const durRaw = get(r, 'durationWd');
    const duration = durRaw === null || durRaw === '' ? null : Number(durRaw);
    const missing = [!rawType && 'Type', !rawLead && 'Lead', !str(get(r, 'sunOwner')) && 'Sun Owner', duration === null && 'Duration (WD)', !rawStatus && 'Status', !str(get(r, 'scheduleFlag')) && 'Schedule Flag'].filter(Boolean);
    if (missing.length >= 3) f('warning', 'Incomplete row', `${id} "${c}" (row ${r}) has no ${missing.join(', ')} in the checklist — left blank, not filled in.`);
    else if (!rawStatus) f('warning', 'Status', `${id} (row ${r}): blank status — left blank and flagged for the PM.`);
    if (duration !== null && !isFinite(duration)) f('error', 'Duration', `${id}: Duration "${durRaw}" is not a number.`);
    const text = `${str(get(r, 'description'))} ${str(get(r, 'remarks'))}`;
    if (/^(.)\1{2,}$/.test(str(get(r, 'description')))) f('warning', 'Content', `${id} (row ${r}): description "${str(get(r, 'description'))}" looks like placeholder text — kept as-is for the PM to correct.`);
    const statusRef = text.match(/status to ['‘’"]([^'‘’"]+)['‘’"]/i);
    if (statusRef && !statusMap.get(statusRef[1])) f('warning', 'Status', `${id} (row ${r}) refers to a status "${statusRef[1]}", which is not one of the eight configured statuses. Use "In Review" (or add it in Status Config if Sun Pharma needs it).`);
    if (/overview tab/i.test(text)) f('info', 'Content', `${id} (row ${r}) refers to the Overview tab, which is not read by this import. The text is kept as-is.`);
    const extras: Record<string, Cell> = {};
    for (const [col, n] of extraCol) {
      if (col.key === 'id') continue;
      const { value, invalid } = typedValue(col, cellValue(ws.getRow(r).getCell(n).value));
      if (invalid !== undefined) f('warning', 'Tracker columns', `${id} (row ${r}): "${invalid}" in ${col.header} could not be read${col.type === 'date' ? ' as a date' : ''}.`);
      extras[col.key] = value;
    }
    deliverables.push({
      id, phase: `Phase ${a.match(/\d+/)![0]}`, wsCode, workstream: workstream || wsName, name: c, description: str(get(r, 'description')) || null,
      type, lead, leadFunction: str(get(r, 'leadFunction')) || null, oamOwner: str(get(r, 'oamOwner')) || null, sunOwner: str(get(r, 'sunOwner')) || null,
      plannedStart: null, plannedEnd: null, durationWd: duration !== null && isFinite(duration) ? duration : null, baselineStart: null, baselineEnd: null,
      actualStart: null, actualEnd: null,
      status: def ? def.status : rawStatus || null,
      completionConfirmed: 'No', priority: null, predecessors: null, keyMilestone: 'No',
      scheduleFlagSource: str(get(r, 'scheduleFlag')) || null, statusOriginal: rawStatus || null,
      risk: null, remarks: str(get(r, 'remarks')) || null, nextAction: null, actionOwner: null, targetDate: null,
      approvalStatus: type === 'Approval Gate' ? 'Not Submitted' : null,
      clientApprover: null, dateSubmitted: null, reviewTurnaroundWd: null, approvalDue: null, approvalFeedback: null, lastFollowUp: null, nextFollowUp: null,
      internalNotes: null, clientVisible: 'Yes', archived: 'No', sortOrder: order, sourceRow: r,
      lastUpdated: opts.live ? null : opts.importedAt, updatedBy: opts.live ? null : 'Checklist import',
      ...extras,
    });
  }

  const ids = deliverables.map(d => String(d.id));
  if (new Set(ids).size !== ids.length) f('error', 'IDs', 'Duplicate deliverable IDs.');
  if (opts.live && !idCol)
    f('info', 'IDs', 'IDs are numbered by position within each checklist section. Add a "Deliverable ID" column to the Readiness Checklist to keep IDs fixed when rows are inserted or moved.');
  const missingPhases = Object.keys(PHASE_NAMES).filter(p => !phases.some(x => x.phase === p));
  for (const p of missingPhases) f('error', 'Phases', `${p} heading not found.`);
  const wsCodes = [...new Set(deliverables.map(d => String(d.wsCode)))];
  if (!wsCodes.includes('1.1')) f('info', 'Workstreams', 'Phase 1 starts at section 1.2 in the checklist (there is no section 1.1); numbering is kept as in the source.');

  const settings: Record<string, Cell>[] = [];
  const set = (key: string, value: Cell, notes: string, visibility = 'Client') => settings.push({ key, value, notes, visibility });
  set('Project Name', 'PN0510 Advisory Board Programme', `From the workbook file name "${opts.sourceName}". Edit to the agreed programme name.`);
  set('Programme', 'Regional Advisory Boards AB-1 to AB-4 and National Consensus Advisory Board NAB-5', 'From the Phase 3 and Phase 4 headings of the Readiness Checklist.');
  set('Client', 'Sun Pharma', 'Checklist owner columns (Sun Owner)');
  set('Agency', 'OneAlphaMed', 'Checklist owner columns (OAM Owner)');
  set('Project Start Date', null, 'Not in the Readiness Checklist — enter once confirmed (YYYY-MM-DD).');
  set('Project End Date', null, 'Not in the Readiness Checklist — enter once confirmed (YYYY-MM-DD).');
  set('Project Manager', null, 'Not in the Readiness Checklist.');
  set('OneAlphaMed Project Lead', null, 'Not in the Readiness Checklist.');
  set('Sun Pharma Project Lead', null, 'Not in the Readiness Checklist.');
  set('Weekend Days', 'Sat, Sun', 'Working-day calendar assumption (Mon–Fri). Change if the team works Saturdays.');
  set('Due Soon Days', 7, '"Due in the next 7 days" window (calendar days).');
  set('At-Risk Window (WD)', 3, 'Not-started items due within this many working days are flagged at risk.');
  const turnaroundRow = deliverables.find(d => /review turnaround/i.test(String(d.description ?? '')));
  set('Review Turnaround (WD)', 5, `Proposed in the checklist${turnaroundRow ? ` (${turnaroundRow.id}: "${turnaroundRow.description}")` : ''}. Treated as an assumption until Sun Pharma confirms it.`);
  set('Review Turnaround Confirmed', 'No', 'Set to Yes once Sun Pharma confirms the review turnaround.');
  set('Executive Narrative', null, 'PM-edited executive narrative. Leave blank to show the auto-generated narrative.');
  set('Executive Narrative Updated', null, '');
  set('Executive Narrative Updated By', null, '', 'Internal');
  set('Health Override', null, 'Leave blank for calculated health; or Green / Amber / Red');
  set('Health Override Reason', null, '');
  set('Checklist Imported At', opts.live ? null : opts.importedAt, opts.live ? 'Read live from the Google Sheet on every sync.' : 'Timestamp of the initial import (used to tell imported rows from later edits).');
  set('Source Workbook', opts.sourceName, `Worksheet "${SOURCE_SHEET}" only.`);

  const tables: Record<string, Tab> = {};
  const put = (key: TableKey, recs: Record<string, Cell>[]) => (tables[TABLES[key].tab] = { header: TABLES[key].columns.map(c => c.header), rows: recs.map(r => rowOf(key, r)) });
  put('deliverables', deliverables);
  put('statuses', DEFAULT_STATUSES.map(s => ({ ...s, countsComplete: s.countsComplete ? 'Yes' : 'No', aliases: s.aliases.join(', ') || null, active: s.active ? 'Yes' : 'No' }) as unknown as Record<string, Cell>));
  put('settings', settings);
  put('holidays', []);
  put('phases', phases);
  put('raid', []);
  put('decisions', []);
  put('meetings', []);
  put('actions', []);
  put('comments', []);
  put('audit', [{ timestamp: opts.importedAt, user: 'Checklist import', role: 'system', table: 'all', recordId: '', action: 'import', field: '', oldValue: '', newValue: `Imported ${deliverables.length} deliverables from ${opts.sourceName} › ${SOURCE_SHEET}`, source: 'Import script' }]);

  // Dependency suggestions from remarks (listed, never applied).
  const recs: Partial<Record<TableKey, Rec[]>> = {};
  for (const k of ['deliverables', 'statuses', 'settings', 'phases'] as TableKey[]) recs[k] = parseTable(k, tables[TABLES[k].tab]).records;
  const project = buildProject(recs, opts.importedAt.slice(0, 10));
  const suggestions = suggestDependencies(project.deliverables);
  f('info', 'Holidays', 'The Readiness Checklist has no holiday calendar; working days are Mon–Fri until holidays are added in Settings › Calendar.');
  f('info', 'Dates', `The Readiness Checklist contains working-day durations but no start or end dates. All ${deliverables.length} deliverables are imported as "Date not confirmed".`);

  const byPhase = phases.map(p => {
    const items = deliverables.filter(d => d.phase === p.phase);
    const wss = [...new Set(items.map(d => `${d.wsCode} ${d.workstream}`))];
    return `| ${p.name} | ${wss.length} | ${items.length} | ${wss.join('; ')} |`;
  });
  const typeCount = (t: string | null) => deliverables.filter(d => (d.type ?? null) === t).length;
  const sev = (s: Finding['severity']) => findings.filter(x => x.severity === s);
  const report = `# Readiness Checklist import report

Source: \`${opts.sourceName}\` › worksheet **${SOURCE_SHEET}** only · Imported: ${opts.importedAt}

Worksheets present but **not read** (per the brief): ${others.map(o => `\`${o}\``).join(', ') || 'none'}.
The source workbook was opened read-only and was not modified.

## 1. Summary

| Item | Count |
|---|---|
| Deliverables imported (one per task row) | ${deliverables.length} |
| Phase headings (organisational, not deliverables) | ${phases.length} |
| Workstream headings (organisational, not deliverables) | ${headings.filter(h => h.kind === 'workstream').length} |
| Types: Task / Client Input / Approval Gate / Milestone / blank | ${typeCount('Task')} / ${typeCount('Client Input')} / ${typeCount('Approval Gate')} / ${typeCount('Milestone')} / ${typeCount(null)} |
| Findings: errors / warnings / info | ${sev('error').length} / ${sev('warning').length} / ${sev('info').length} |

## 2. Phases and workstreams

| Phase | Workstreams | Deliverables | Workstream sections |
|---|---|---|---|
${byPhase.join('\n')}

## 3. Identifiers

Deliverable IDs follow \`PN-<section>.<sequence>\`, e.g. \`PN-1.2.01\` is the first task under section 1.2 *Objectives & Programme Direction*. IDs are written into the sheet once and **never renumbered**: new deliverables get the next free number in their section, and the dashboard uses the ID (not the row number) for every edit. Each row also records its source row (\`Checklist Row\`) for traceability.

## 4. Field mapping

| Checklist column | Live tracker column | Rule |
|---|---|---|
${SOURCE_COLUMNS.map(([src, key]) => {
  const target = key === 'scheduleFlag' ? 'Schedule Flag (Checklist)' : TABLES.deliverables.columns.find(c => c.key === key)?.header ?? key;
  const rule = key === 'status' ? 'Mapped to the configured spelling; original kept in *Original Status (Checklist)*' : key === 'scheduleFlag' ? 'Kept for traceability; the live Schedule Flag is calculated' : 'Copied as-is (trimmed)';
  return `| ${src} | ${target} | ${rule} |`;
}).join('\n')}

New tracking fields (Planned/Actual dates, Priority, Dependency, Next Action, Action Owner, Target Date, approval fields, Comments) start **blank**. Exceptions, all derived by a stated rule:
- **Completion Confirmed** = "No" for every row (the checklist records no completed items).
- **Client Approval Status** = "Not Submitted" for the ${typeCount('Approval Gate')} *Approval Gate* rows (all are "Yet to start" in the checklist).
- **Client Visible** = "Yes", **Archived** = "No", **Sort Order** = checklist order.

## 5. Status mapping

Statuses found: ${[...statusesSeen].map(([st, n]) => `"${st}" × ${n}`).join(', ')}.

| Status | Category | Counts as complete |
|---|---|---|
${DEFAULT_STATUSES.map(s => `| ${s.status} | ${s.category} | ${s.countsComplete ? 'Yes' : 'No'} |`).join('\n')}

Completion is recorded separately with **Completion Confirmed**, so no status, including "Approval", is treated as complete.

## 6. Gaps in the source (not filled in)

- **Dates:** the checklist has durations (working days) but no start or end dates. All items are "Date not confirmed" until the PM enters dates.
- **Dependencies:** none recorded as structured data. ${suggestions.length} dependency suggestion(s) were read from the *Remarks* column and are listed below for the PM to apply or ignore.
- **Priority, actual dates, approval submission data, next actions:** not present.
- **Project dates, PM name, project leads:** not in this worksheet (other worksheets were not read, per the brief).
- **Holidays:** none in this worksheet.

## 7. Dependency suggestions from checklist remarks (not applied)

| Deliverable | Should wait for | Basis |
|---|---|---|
${suggestions.map(sg => `| ${sg.successor} ${plainName(project.byId.get(sg.successor)?.name ?? '')} | ${sg.predecessor} ${plainName(project.byId.get(sg.predecessor)?.name ?? '')} | ${sg.basis.replace(/\|/g, '\\|')} |`).join('\n') || '| — | — | — |'}

## 8. All findings

| Severity | Area | Finding |
|---|---|---|
${findings.map(x => `| ${x.severity} | ${x.area} | ${x.message.replace(/\|/g, '\\|')} |`).join('\n')}
`;
  return {
    tables,
    findings,
    report,
    counts: { deliverables: deliverables.length, phases: phases.length, workstreams: wsCodes.length, headings: headings.length },
  };
}
