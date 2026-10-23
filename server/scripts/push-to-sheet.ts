// Populate an empty Google Sheet with the migrated tabs (alternative to importing
// output/PN0510_Live_Tracker.xlsx by hand).
//
//   npm run sheet:push            → creates missing tabs and fills only tabs that are empty
//   npm run sheet:push -- --check → read-only: verify access and report tab/row counts
//
// Never overwrites a tab that already has data rows.
import fs from 'node:fs';
import { loadConfig } from '../src/config';
import { GoogleSheetsStore } from '../src/store/GoogleSheetsStore';
import { TABLES, TABLE_KEYS } from '../../shared/schema';
import { mapHeader, parseTable } from '../../shared/model';

const cfg = loadConfig({ ...process.env, DATA_SOURCE: 'google' });
if (!cfg.sheetId || !cfg.googleCredentials) {
  console.error('Configure GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON in .env first.\n' + cfg.configErrors.join('\n'));
  process.exit(1);
}
const store = new GoogleSheetsStore(cfg.sheetId, cfg.googleCredentials);
const tabs = TABLE_KEYS.map(k => TABLES[k].tab);
const before = await store.readTabs(tabs);
console.log(`Connected as ${store.serviceAccountEmail}`);

if (process.argv.includes('--check')) {
  for (const k of TABLE_KEYS) {
    const raw = before[TABLES[k].tab];
    if (!raw) { console.log(`  ✖ ${TABLES[k].tab}: missing`); continue; }
    const p = parseTable(k, raw);
    const missing = mapHeader(TABLES[k], raw.header).missing.map(m => TABLES[k].columns.find(c => c.key === m)!.header);
    console.log(`  ✔ ${TABLES[k].tab}: ${p.records.length} rows${missing.length ? ` · missing columns: ${missing.join(', ')}` : ''}${p.issues.length ? ` · ${p.issues.length} issue(s)` : ''}`);
  }
  process.exit(0);
}

const seedFile = cfg.localStorePath;
if (!fs.existsSync(seedFile)) {
  console.error(`${seedFile} not found — run "npm run import -- <checklist.xlsx>" first.`);
  process.exit(1);
}
const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8')) as { tabs: Record<string, { header: string[]; rows: (string | number | null)[][] }> };
const created = await store.ensureTabs(TABLE_KEYS.map(k => ({ name: TABLES[k].tab, header: seed.tabs[TABLES[k].tab]?.header ?? TABLES[k].columns.map(c => c.header) })));
if (created.length) console.log(`Created tabs: ${created.join(', ')}`);
const now = await store.readTabs(tabs);
for (const k of TABLE_KEYS) {
  const tab = TABLES[k].tab;
  const existing = now[tab]?.rows.filter(r => r.some(c => c !== '' && c !== null)).length ?? 0;
  const rows = seed.tabs[tab]?.rows ?? [];
  if (existing > 0) { console.log(`  • ${tab}: already has ${existing} rows — skipped`); continue; }
  if (!rows.length) { console.log(`  • ${tab}: nothing to push`); continue; }
  const header = now[tab].header;
  const seedHeader = seed.tabs[tab].header;
  const out = rows.map(r => header.map(h => {
    const i = seedHeader.indexOf(h);
    const v = i >= 0 ? r[i] : null;
    return v === null || v === undefined ? '' : typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v;
  }));
  await store.appendRows(tab, out);
  console.log(`  ✔ ${tab}: ${out.length} rows written`);
}
console.log('Done. Open the sheet, then start the dashboard with DATA_SOURCE=google.');
