// One-off import: Readiness Checklist worksheet → live tracker tabs.
//
//   npm run import -- "D:\Project Management\Sun Pharma\PN\OneAlphaMed_SunPharma_PN0510_AdBoard_Readiness_Checklist_v1.0.xlsx" [--force]
//
// Reads ONLY the "Readiness Checklist" worksheet; the workbook is opened read-only.
// Produces:
//   output/PN0510_Live_Tracker.xlsx   → upload to Google Drive and open as a Google Sheet (the live source)
//   data/local-store.json             → local data adapter (skipped if present, unless --force)
//   docs/IMPORT_REPORT.md             → what was imported, derived, flagged
import ExcelJS from 'exceljs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { importChecklist } from '../src/checklistImport';
import { writeSourceWorkbook } from '../src/sourceWorkbook';

const args = process.argv.slice(2);
const force = args.includes('--force');
const file = args.find(a => !a.startsWith('--')) ?? process.env.CHECKLIST_WORKBOOK;
if (!file || !fs.existsSync(file)) {
  console.error('Usage: npm run import -- "<path to the Readiness Checklist .xlsx>" [--force]');
  process.exit(1);
}

const bytes = fs.readFileSync(file); // read into memory: the original file is never opened for writing
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(bytes as unknown as ArrayBuffer);
const importedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const result = importChecklist(wb, { sourceName: path.basename(file), importedAt });
const sha = crypto.createHash('sha256').update(bytes).digest('hex');

fs.mkdirSync('output', { recursive: true });
fs.mkdirSync('data', { recursive: true });
fs.mkdirSync('docs', { recursive: true });

const xlsxOut = 'output/PN0510_Live_Tracker.xlsx';
await writeSourceWorkbook(result.tables, xlsxOut);
console.log(`✔ ${xlsxOut}`);

const storePath = process.env.LOCAL_STORE_PATH ?? 'data/local-store.json';
if (fs.existsSync(storePath) && !force) {
  console.log(`• ${storePath} already exists — left untouched (use --force to overwrite; this discards local edits).`);
} else {
  fs.writeFileSync(storePath, JSON.stringify({ tabs: result.tables }, null, 1));
  console.log(`✔ ${storePath}`);
}
fs.writeFileSync('docs/IMPORT_REPORT.md', result.report.replace('The source workbook was opened read-only', `Source SHA-256: \`${sha}\`. The source workbook was opened read-only`));
console.log('✔ docs/IMPORT_REPORT.md');
const errors = result.findings.filter(f => f.severity === 'error').length;
console.log(`\n${result.counts.deliverables} deliverables in ${result.counts.phases} phases / ${result.counts.workstreams} workstreams; ${result.findings.length} findings (${errors} errors).`);
