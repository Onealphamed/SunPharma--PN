import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { UserDirectory } from '../src/auth';
import { loadConfig } from '../src/config';
import { DataService } from '../src/DataService';
import { FileStore } from '../src/store/FileStore';
import { CellOut, CellUpdate, StoreError, TableStore } from '../src/store/types';
import { tempStore } from './fixture';

const H = { 'x-requested-with': 'sunpm' };

async function setup(storeOverride?: (s: FileStore) => TableStore, extraEnv: Record<string, string> = {}) {
  const file = tempStore();
  const usersFile = path.join(path.dirname(file), 'users.json');
  fs.writeFileSync(usersFile, JSON.stringify([{ email: 'pm@oam.test', name: 'Test PM', role: 'admin', passwordHash: bcrypt.hashSync('correct-horse-battery', 4) }]));
  const cfg = loadConfig({ NODE_ENV: 'test', ALLOW_DEV_LOGIN: 'true', JWT_SECRET: 'x'.repeat(40), USERS_FILE: usersFile, DATA_SOURCE: 'local', LOCAL_STORE_PATH: file, PUBLIC_ACCESS: 'false', ...extraEnv } as NodeJS.ProcessEnv);
  const fileStore = new FileStore(file);
  const store = storeOverride ? storeOverride(fileStore) : fileStore;
  const data = new DataService(store, { intervalSec: 30, timeZone: 'Asia/Kolkata' });
  await data.sync('startup');
  const app = createApp(cfg, data, new UserDirectory(cfg));
  const agent = async (role: 'admin' | 'editor' | 'client') => {
    const a = request.agent(app);
    await a.post('/api/auth/dev-login').set(H).send({ role }).expect(200);
    return a;
  };
  const readFile = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const cell = (tabName: string, id: string, header: string) => {
    const t = readFile().tabs[tabName];
    return t.rows.find((r: unknown[]) => r[0] === id)?.[t.header.indexOf(header)];
  };
  return { app, data, file, agent, readFile, cell, cfg };
}

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => ctx.data.stop());

describe('authentication', () => {
  it('rejects anonymous access to data', async () => {
    await request(ctx.app).get('/api/snapshot').expect(401);
  });
  it('signs in with a valid password and rejects a wrong one', async () => {
    await request(ctx.app).post('/api/auth/login').set(H).send({ email: 'pm@oam.test', password: 'nope-nope-nope' }).expect(401);
    const a = request.agent(ctx.app);
    const res = await a.post('/api/auth/login').set(H).send({ email: 'PM@oam.test', password: 'correct-horse-battery' }).expect(200);
    expect(res.body.user.role).toBe('admin');
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    await a.get('/api/snapshot').expect(200);
  });
  it('requires the anti-CSRF header on state-changing requests', async () => {
    await request(ctx.app).post('/api/auth/login').send({ email: 'pm@oam.test', password: 'correct-horse-battery' }).expect(403);
  });
  it('disables dev login in production', () => {
    const cfg = loadConfig({ NODE_ENV: 'production', ALLOW_DEV_LOGIN: 'true', JWT_SECRET: 'y'.repeat(40) } as NodeJS.ProcessEnv);
    expect(cfg.allowDevLogin).toBe(false);
  });
});

describe('open access (default)', () => {
  it('is on unless PUBLIC_ACCESS=false', () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).publicAccess).toBe(true);
    expect(loadConfig({ PUBLIC_ACCESS: 'false' } as NodeJS.ProcessEnv).publicAccess).toBe(false);
  });
  it('shows visitors exactly the client view, read-only, without signing in', async () => {
    const open = await setup(undefined, { PUBLIC_ACCESS: 'true' });
    const visitor = await request(open.app).get('/api/snapshot').expect(200);
    expect(visitor.body.user).toMatchObject({ role: 'client', public: true });
    const client = await (await open.agent('client')).get('/api/snapshot').expect(200);
    expect(visitor.body.tables).toEqual(client.body.tables);
    const body = JSON.stringify(visitor.body);
    expect(body).not.toMatch(/secret/);
    expect(body).not.toContain('Internal-only task');
    expect(visitor.body.issues).toBeUndefined();
    // No writes, audit or forced re-reads for visitors.
    await request(open.app).patch('/api/tables/deliverables/PN-1.2.02').set(H).send({ changes: { status: 'In Review' } }).expect(403);
    await request(open.app).post('/api/tables/comments').set(H).send({ values: { deliverableId: 'PN-1.2.02', comment: 'x' } }).expect(403);
    await request(open.app).post('/api/sync').set(H).expect(403);
    await request(open.app).get('/api/audit').expect(403);
    expect(open.cell('Deliverables', 'PN-1.2.02', 'Status')).toBe('In Progress');
    // Team sign-in still works and still has edit rights.
    const a = request.agent(open.app);
    await a.post('/api/auth/login').set(H).send({ email: 'pm@oam.test', password: 'correct-horse-battery' }).expect(200);
    await a.patch('/api/tables/deliverables/PN-1.2.02').set(H).send({ changes: { status: 'In Review' } }).expect(200);
    open.data.stop();
  });
});

describe('client confidentiality (server-enforced)', () => {
  it('never sends internal columns, internal rows, audit or data-quality issues to the client role', async () => {
    const a = await ctx.agent('client');
    const res = await a.get('/api/snapshot').expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/secret/); // internal notes, escalation notes, internal settings, internal comments
    expect(body).not.toContain('Internal-only task');
    expect(body).not.toContain('Internal issue');
    expect(res.body.tables.audit).toBeUndefined();
    expect(res.body.issues).toBeUndefined();
    expect(res.body.tables.deliverables).toHaveLength(5);
    expect(body).not.toContain('internalNotes'); // not even the column names
    expect(body).not.toContain('escalation');
    expect(res.body.sync.recentErrors).toEqual([]);
  });
  it('blocks client writes, audit access and confidential exports', async () => {
    const a = await ctx.agent('client');
    await a.patch('/api/tables/deliverables/PN-1.2.02').set(H).send({ changes: { status: 'In Review' } }).expect(403);
    await a.post('/api/tables/deliverables/bulk').set(H).send({ items: [{ key: 'PN-1.2.02', changes: { status: 'In Review' } }] }).expect(403);
    await a.post('/api/tables/meetings').set(H).send({ values: { title: 'x', date: '2026-11-02', visibility: 'Client' } }).expect(403);
    await a.get('/api/audit').expect(403);
    await a.post('/api/export').set(H).send({ table: 'audit' }).expect(403);
    const csv = await a.post('/api/export').set(H).send({ table: 'deliverables', format: 'csv' }).expect(200);
    expect(csv.text).not.toContain('Internal Notes');
    expect(csv.text).not.toContain('secret');
    expect(csv.text).not.toContain('Internal-only task');
  });
  it('internal users see everything', async () => {
    const a = await ctx.agent('editor');
    const res = await a.get('/api/snapshot').expect(200);
    expect(res.body.tables.deliverables).toHaveLength(6);
    expect(res.body.issues).toBeDefined();
  });
});

describe('write-back to the source', () => {
  it('writes a status edit to the store, stamps it, audits it and refreshes the snapshot', async () => {
    const a = await ctx.agent('editor');
    await a.patch('/api/tables/deliverables/PN-1.2.02').set(H).send({ changes: { status: 'In Review' }, original: { status: 'In Progress' } }).expect(200);
    expect(ctx.cell('Deliverables', 'PN-1.2.02', 'Status')).toBe('In Review');
    expect(ctx.cell('Deliverables', 'PN-1.2.02', 'Updated By')).toBe('Dev OneAlphaMed Editor');
    expect(ctx.cell('Deliverables', 'PN-1.2.02', 'Last Updated')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const audit = ctx.readFile().tabs['Audit Log'].rows;
    expect(audit.some((r: unknown[]) => r.includes('PN-1.2.02') && r.includes('Status') && r.includes('In Review'))).toBe(true);
    const snap = await a.get('/api/snapshot');
    expect(snap.body.tables.deliverables.find((d: any) => d.id === 'PN-1.2.02').status).toBe('In Review');
  });
  it('accepts the eight statuses in any capitalisation and stores the configured spelling', async () => {
    const a = await ctx.agent('editor');
    await a.patch('/api/tables/deliverables/PN-1.2.02').set(H).send({ changes: { status: 'under approval' } }).expect(200);
    expect(ctx.cell('Deliverables', 'PN-1.2.02', 'Status')).toBe('Under Approval');
    await a.patch('/api/tables/deliverables/PN-1.2.02').set(H).send({ changes: { status: 'Completed' } }).expect(400);
  });
  it('detects concurrent edits (409) instead of silently overwriting', async () => {
    const a = await ctx.agent('editor');
    const res = await a.patch('/api/tables/deliverables/PN-1.2.02').set(H).send({ changes: { status: 'On Hold' }, original: { status: 'Yet to Start' } }).expect(409);
    expect(res.body.details.conflicts[0].current).toBe('In Progress');
    expect(ctx.data.status.recentErrors[0].kind).toBe('save');
  });
  it('validates dates and dependencies', async () => {
    const a = await ctx.agent('editor');
    await a.patch('/api/tables/deliverables/PN-1.2.02').set(H).send({ changes: { plannedEnd: '2026-10-01' } }).expect(400);
    await a.patch('/api/tables/deliverables/PN-1.2.02').set(H).send({ changes: { plannedEnd: '31/02/2026' } }).expect(400);
    await a.patch('/api/tables/deliverables/PN-1.2.02').set(H).send({ changes: { predecessors: 'PN-9.9.99' } }).expect(400);
    await a.patch('/api/tables/deliverables/PN-1.2.02').set(H).send({ changes: { predecessors: 'PN-1.2.01' } }).expect(200);
    const cyc = await a.patch('/api/tables/deliverables/PN-1.2.01').set(H).send({ changes: { predecessors: 'PN-1.2.02' } }).expect(400);
    expect(cyc.body.error).toMatch(/Circular/);
  });
  it('captures the baseline the first time planned dates are saved, and keeps it afterwards', async () => {
    const a = await ctx.agent('editor');
    await a.patch('/api/tables/deliverables/PN-2.1.01').set(H).send({ changes: { plannedStart: '2026-11-02', plannedEnd: '2026-11-06' } }).expect(200);
    expect(ctx.cell('Deliverables', 'PN-2.1.01', 'Baseline End')).toBe('2026-11-06');
    await a.patch('/api/tables/deliverables/PN-2.1.01').set(H).send({ changes: { plannedEnd: '2026-11-10' } }).expect(200);
    expect(ctx.cell('Deliverables', 'PN-2.1.01', 'Baseline End')).toBe('2026-11-06');
    expect(ctx.cell('Deliverables', 'PN-2.1.01', 'Planned End Date')).toBe('2026-11-10');
    await a.patch('/api/tables/deliverables/PN-2.1.01').set(H).send({ changes: { baselineEnd: '2026-11-20' } }).expect(403); // PM-only
    const pm = await ctx.agent('admin');
    await pm.patch('/api/tables/deliverables/PN-2.1.01').set(H).send({ changes: { baselineEnd: '2026-11-20' } }).expect(200);
  });
  it('bulk-updates several deliverables in one all-or-nothing batch', async () => {
    const a = await ctx.agent('editor');
    const res = await a.post('/api/tables/deliverables/bulk').set(H).send({ items: [
      { key: 'PN-1.2.04', changes: { status: 'In Review' }, original: { status: 'Approval' } },
      { key: 'PN-2.1.01', changes: { status: 'In Review' }, original: { status: 'Yet to Start' } },
    ] }).expect(200);
    expect(res.body.updated).toBe(2);
    expect(ctx.cell('Deliverables', 'PN-2.1.01', 'Status')).toBe('In Review');
    // One stale record rejects the whole batch.
    await a.post('/api/tables/deliverables/bulk').set(H).send({ items: [
      { key: 'PN-1.2.04', changes: { status: 'Pending' }, original: { status: 'In Review' } },
      { key: 'PN-2.1.01', changes: { status: 'Pending' }, original: { status: 'Yet to Start' } },
    ] }).expect(409);
    expect(ctx.cell('Deliverables', 'PN-1.2.04', 'Status')).toBe('In Review');
  });
  it('adds a deliverable with a unique, stable ID and never duplicates it', async () => {
    const a = await ctx.agent('editor');
    const values = { phase: 'Phase 1', workstream: 'Objectives & Programme Direction', name: 'New task', type: 'Task', oamOwner: 'PM' };
    const [r1, r2] = await Promise.all([
      a.post('/api/tables/deliverables').set(H).send({ values }).expect(201),
      a.post('/api/tables/deliverables').set(H).send({ values: { ...values, name: 'Second task' } }).expect(201),
    ]);
    expect(new Set([r1.body.id, r2.body.id])).toEqual(new Set(['PN-1.2.05', 'PN-1.2.06']));
    const ids = ctx.readFile().tabs.Deliverables.rows.map((r: unknown[]) => r[0]);
    expect(new Set(ids).size).toBe(ids.length);
    const snap = await a.get('/api/snapshot');
    const d = snap.body.tables.deliverables.find((x: any) => x.id === r1.body.id);
    expect(d.status).toBe('Yet to Start');
    expect(d.completionConfirmed).toBe('No');
    expect(d.plannedStart).toBeNull(); // no dates invented
  });
  it('records the author and time of comments server-side', async () => {
    const a = await ctx.agent('editor');
    const res = await a.post('/api/tables/comments').set(H).send({ values: { deliverableId: 'PN-1.2.02', comment: 'Draft shared', visibility: 'Client', author: 'Spoofed' } }).expect(201);
    expect(ctx.cell('Comments', res.body.id, 'Author')).toBe('Dev OneAlphaMed Editor');
    expect(ctx.cell('Comments', res.body.id, 'Posted At')).toMatch(/^\d{4}-/);
    await a.post('/api/tables/comments').set(H).send({ values: { deliverableId: 'PN-0.0.00', comment: 'x' } }).expect(400);
  });
});

describe('meeting minutes persistence', () => {
  it('saves meetings and linked actions to the source so they survive a restart', async () => {
    const a = await ctx.agent('editor');
    const m = await a.post('/api/tables/meetings').set(H).send({ values: { title: 'Kick-off', date: '2026-11-02', type: 'Kick-off', summary: 'Agreed timeline', decisions: 'Use modified Delphi\nFive boards', visibility: 'Client', internalNotes: 'internal view only' } }).expect(201);
    expect(m.body.id).toBe('MTG-001');
    await a.post('/api/tables/actions').set(H).send({ values: { meetingId: m.body.id, action: 'Send KOL list', related: 'PN-2.1.01', ownerOrg: 'Sun Pharma', dueDate: '2026-11-03', visibility: 'Client' } }).expect(201);
    await a.post('/api/tables/actions').set(H).send({ values: { meetingId: m.body.id, action: 'Bad link', related: 'PN-9.9.99' } }).expect(400);
    // "Restart": a brand-new service reading the same file.
    const fresh = new DataService(new FileStore(ctx.file), { intervalSec: 30, timeZone: 'Asia/Kolkata' });
    await fresh.sync('startup');
    expect(fresh.records.meetings![0].title).toBe('Kick-off');
    expect(fresh.records.actions![0].meetingId).toBe(m.body.id);
    const client = await ctx.agent('client');
    const snap = await client.get('/api/snapshot');
    expect(snap.body.tables.meetings[0].summary).toBe('Agreed timeline');
    expect(JSON.stringify(snap.body)).not.toContain('internal view only');
  });
  it('edits a saved meeting and keeps the change history', async () => {
    const a = await ctx.agent('editor');
    const m = await a.post('/api/tables/meetings').set(H).send({ values: { title: 'Review', date: '2026-11-05' } }).expect(201);
    await a.patch(`/api/tables/meetings/${m.body.id}`).set(H).send({ changes: { summary: 'Revised' }, original: { summary: null } }).expect(200);
    const hist = await a.get(`/api/audit?recordId=${m.body.id}`).expect(200);
    expect(hist.body.entries.map((e: any) => e.action)).toEqual(expect.arrayContaining(['create', 'edit']));
  });
  it('defaults new meetings to Internal so nothing is shared with the client by accident', async () => {
    const a = await ctx.agent('editor');
    await a.post('/api/tables/meetings').set(H).send({ values: { title: 'Agency stand-up', date: '2026-11-03' } }).expect(201);
    const client = await ctx.agent('client');
    const snap = await client.get('/api/snapshot');
    expect(snap.body.tables.meetings).toHaveLength(0);
  });
});

describe('source synchronisation', () => {
  it('picks up edits made directly in the source and audits them', async () => {
    const before = ctx.data.status.version;
    const raw = ctx.readFile();
    const t = raw.tabs.Deliverables;
    t.rows.find((r: unknown[]) => r[0] === 'PN-2.1.01')[t.header.indexOf('Status')] = 'On Hold';
    fs.writeFileSync(ctx.file, JSON.stringify(raw));
    await ctx.data.sync('poll');
    expect(ctx.data.status.version).toBe(before + 1);
    expect(ctx.data.records.deliverables!.find(r => r._key === 'PN-2.1.01')!.status).toBe('On Hold');
    const audit = ctx.readFile().tabs['Audit Log'].rows;
    expect(audit.some((r: unknown[]) => r.includes('edit (sheet)') && r.includes('PN-2.1.01'))).toBe(true);
  });
  it('flags duplicate and missing IDs and makes those rows read-only', async () => {
    const raw = ctx.readFile();
    const t = raw.tabs.Deliverables;
    t.rows.push([...t.rows[1]]); // duplicate of PN-1.2.02
    const noId = [...t.rows[0]];
    noId[0] = null;
    t.rows.push(noId);
    fs.writeFileSync(ctx.file, JSON.stringify(raw));
    await ctx.data.sync('poll');
    const codes = ctx.data.issues.map(i => i.code);
    expect(codes).toContain('duplicate-id');
    expect(codes).toContain('missing-id');
    const a = await ctx.agent('editor');
    await a.patch('/api/tables/deliverables/PN-1.2.02').set(H).send({ changes: { status: 'In Review' } }).expect(409);
  });
  it('keeps serving the last good data and reports the error when the source fails', async () => {
    let fail = false;
    const c = await setup(fs => ({
      kind: 'google', description: 'flaky',
      readTabs: (t: string[]) => (fail ? Promise.reject(new StoreError('Google Sheets error 503: backend unavailable')) : fs.readTabs(t)),
      updateCells: (t: string, u: CellUpdate[]) => fs.updateCells(t, u),
      appendRows: (t: string, r: CellOut[][]) => fs.appendRows(t, r),
      ensureTabs: (t: { name: string; header: string[] }[]) => fs.ensureTabs(t),
    }));
    fail = true;
    await c.data.sync('poll');
    expect(c.data.status.state).toBe('error');
    expect(c.data.status.lastError).toMatch(/503/);
    expect(c.data.status.recentErrors[0]).toMatchObject({ kind: 'sync' });
    expect(c.data.records.deliverables).toHaveLength(6);
    const a = await c.agent('client');
    const snap = await a.get('/api/snapshot').expect(200);
    expect(snap.body.sync.state).toBe('error');
    expect(snap.body.sync.lastError).toBe('Live source temporarily unavailable'); // no internals leaked
    const ed = await c.agent('editor');
    await ed.patch('/api/tables/deliverables/PN-1.2.02').set(H).send({ changes: { status: 'In Review' } }).expect(502);
    c.data.stop();
  });
});

describe('export', () => {
  it('exports filtered deliverables with calculated columns and an About sheet', async () => {
    const a = await ctx.agent('admin');
    const res = await a.post('/api/export').set(H).send({ table: 'deliverables', keys: ['PN-1.2.01'], format: 'csv' }).expect(200);
    const lines = res.text.trim().split(/\r\n/);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Schedule Flag (Live)');
    expect(lines[1]).toContain('Completed');
    const x = await a.post('/api/export').set(H).send({ table: 'deliverables' }).buffer(true).expect(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
  });
});

describe('USERS_JSON pasted into a hosting dashboard', () => {
  it('tolerates terminal line wraps, quotes and a KEY= prefix', async () => {
    const { cleanPastedJson } = await import('../src/auth');
    const good = JSON.stringify([{ email: 'a@b.c', name: 'A B', role: 'admin', passwordHash: '$2a$12$abcdefghijklmnopqrstuv' }]);
    const wrapped = good.slice(0, 30) + '\r\n' + good.slice(30, 70) + '\n' + good.slice(70);
    for (const v of [good, wrapped, `USERS_JSON=${good}`, `'${good}'`, JSON.stringify(good), `  ${good}\n`]) {
      expect(JSON.parse(cleanPastedJson(v))[0].email).toBe('a@b.c');
    }
  });
});
