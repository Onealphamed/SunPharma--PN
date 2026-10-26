// The view-only-link source: the sheet is read live, nothing is written back, and contact
// details are masked for visitors on the Live sheet view.
import ExcelJS from 'exceljs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { UserDirectory } from '../src/auth';
import { loadConfig } from '../src/config';
import { DataService } from '../src/DataService';
import { PublicSheetStore } from '../src/store/PublicSheetStore';

const H = { 'x-requested-with': 'sunpm' };
const HEADER = ['Phase', 'Workstream', 'Task / Activity', 'Description & Key Deliverables', 'Type', 'Lead', 'Lead Function', 'OAM Owner', 'Sun Owner', 'Duration (WD)', 'Status', 'Schedule Flag', 'Remarks',
  'Deliverable ID', 'Planned Start Date', 'Planned End Date', 'Completion Confirmed'];

async function workbook(status = 'Yet to start') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Readiness Checklist');
  ws.addRow(HEADER);
  ws.addRow(['PHASE 1:  MOBILISATION & CLIENT INPUTS   ·   Scope']);
  ws.addRow(['1.2 Objectives & Programme Direction']);
  ws.addRow(['Phase 1', 'Objectives & Programme Direction', 'Objectives working session', 'Draft', 'Task', 'Joint', 'Medical Affairs', 'Dr. Nivedita', 'Prasad N.', 5, status, 'Upcoming', '', 'PN-OBJ-01', new Date(Date.UTC(2026, 10, 2)), new Date(Date.UTC(2026, 10, 6)), 'No']);
  ws.addRow(['Phase 1', 'Objectives & Programme Direction', 'Objectives confirmed', 'Sign-off', 'Approval Gate', 'Sun', 'Sun Medical', 'Dr. Nivedita', 'Prasad N.', 5, 'Approval', 'Upcoming', '', '', null, null, 'Yes']);
  const kol = wb.addWorksheet('KOL Tracker');
  kol.addRow(['KOL Name', 'City', 'Phone', 'Email']);
  kol.addRow(['Dr. Example', 'Delhi', '9876543210', 'kol@example.com']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function fakeFetch(state: { buf: Buffer; html?: boolean }) {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? (state.html ? 'text/html; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') : null) },
    arrayBuffer: async () => state.buf.buffer.slice(state.buf.byteOffset, state.buf.byteOffset + state.buf.byteLength) as ArrayBuffer,
  });
}

async function setup() {
  const state = { buf: await workbook(), html: false };
  const cfg = loadConfig({ NODE_ENV: 'test', ALLOW_DEV_LOGIN: 'true', JWT_SECRET: 'x'.repeat(40), DATA_SOURCE: 'google', GOOGLE_SHEET_ID: 'https://docs.google.com/spreadsheets/d/TEST_SHEET-id_1/edit?usp=sharing', USERS_FILE: 'none.json' } as NodeJS.ProcessEnv);
  const data = new DataService(new PublicSheetStore(cfg.sheetId!, fakeFetch(state)), { intervalSec: cfg.syncIntervalSec, timeZone: 'Asia/Kolkata' });
  await data.sync('startup');
  const app = createApp(cfg, data, new UserDirectory(cfg));
  const admin = request.agent(app);
  await admin.post('/api/auth/dev-login').set(H).send({ role: 'admin' }).expect(200);
  return { cfg, data, app, admin, state };
}

describe('Google Sheet through its view-only link', () => {
  it('is chosen automatically when only GOOGLE_SHEET_ID is set, and accepts a pasted URL', async () => {
    const { cfg } = await setup();
    expect(cfg.dataSource).toBe('public-sheet');
    expect(cfg.sheetId).toBe('TEST_SHEET-id_1');
    expect(cfg.syncIntervalSec).toBe(15);
  });

  it('builds the tracker live from the Readiness Checklist, including added tracker columns', async () => {
    const { app } = await setup();
    const snap = (await request(app).get('/api/snapshot').expect(200)).body;
    expect(snap.sync).toMatchObject({ mode: 'public-sheet', readOnly: true, state: 'ok' });
    const ds = snap.tables.deliverables;
    expect(ds.map((d: any) => d.id)).toEqual(['PN-OBJ-01', 'PN-1.2.02']); // own ID column, else positional
    expect(ds[0]).toMatchObject({ plannedStart: '2026-11-02', plannedEnd: '2026-11-06', status: 'Yet to Start' });
    expect(ds[1].completionConfirmed).toBe('Yes');
  });

  it('picks up an edit made in the sheet on the next sync', async () => {
    const { app, data, state } = await setup();
    const before = data.status.version;
    state.buf = await workbook('In Progress');
    await data.sync('poll');
    expect(data.status.version).toBe(before + 1);
    const snap = (await request(app).get('/api/snapshot').expect(200)).body;
    expect(snap.tables.deliverables[0].status).toBe('In Progress');
  });

  it('never writes back: edits are refused with a clear message, even for the PM', async () => {
    const { app, admin } = await setup();
    await request(app).patch('/api/tables/deliverables/PN-OBJ-01').set(H).send({ changes: { status: 'In Review' } }).expect(403);
    const res = await admin.patch('/api/tables/deliverables/PN-OBJ-01').set(H).send({ changes: { status: 'In Review' } }).expect(409);
    expect(res.body.error).toMatch(/edit|Google Sheets/i);
    await admin.post('/api/tables/meetings').set(H).send({ values: { title: 'x', date: '2026-11-02' } }).expect(409);
  });

  it('shows every tab on the Live sheet view, masking contact details for visitors', async () => {
    const { app, admin } = await setup();
    const pub = (await request(app).get('/api/workbook').expect(200)).body;
    expect(pub.tabs.map((t: any) => t.name)).toEqual(['Readiness Checklist', 'KOL Tracker']);
    const kol = pub.tabs.find((t: any) => t.name === 'KOL Tracker');
    expect(kol.rows[1].cells).toEqual(['Dr. Example', 'Delhi', '•••', '•••']);
    expect(pub.masked).toEqual([{ tab: 'KOL Tracker', columns: ['Phone', 'Email'] }]);
    expect(pub.sheetUrl).toBeNull();
    expect(JSON.stringify(pub)).not.toContain('9876543210');
    const team = (await admin.get('/api/workbook').expect(200)).body;
    expect(team.tabs.find((t: any) => t.name === 'KOL Tracker').rows[1].cells).toContain('9876543210');
    expect(team.sheetUrl).toBe('https://docs.google.com/spreadsheets/d/TEST_SHEET-id_1/edit');
    expect(team.version).toMatch(/^[0-9a-f]{10}$/);
  });

  it('reports a clear error when the sheet is no longer shared by link, keeping the last good data', async () => {
    const { data, state } = await setup();
    state.html = true;
    await data.sync('poll');
    expect(data.status.state).toBe('error');
    expect(data.status.lastError).toMatch(/Anyone with the link can view/);
    expect(data.records.deliverables).toHaveLength(2);
  });
});
