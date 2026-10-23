import cookieParser from 'cookie-parser';
import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { isInternalRole, Role, ROLES, TABLES, TableKey } from '../../shared/schema';
import { authenticate, clearSession, issueSession, requireRole, UserDirectory } from './auth';
import type { AppConfig } from './config';
import { DataService, HttpError, storeErrorStatus } from './DataService';
import { buildExport, toCsv, toXlsx } from './export';
import { canReadTable } from './permissions';

export function createApp(cfg: AppConfig, data: DataService, users: UserDirectory) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(authenticate(cfg, users));

  // CSRF defence in depth: state-changing API calls must carry a custom header,
  // which browsers will not attach to cross-site form posts.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.get('x-requested-with') !== 'sunpm') return res.status(403).json({ error: 'Missing request header' });
    next();
  });

  // Serverless: refresh the per-instance cache on demand (no background poller). `?fresh=1`
  // forces a re-read, used right after a write so the next request never shows stale data.
  if (cfg.serverless) {
    app.use('/api', (req, _res, next) => {
      if (!req.user) return next(); // anonymous requests never trigger Sheets reads
      const p = req.query.fresh ? data.sync('poll') : data.ensureFresh();
      p.then(() => next(), next);
    });
  }

  const loginLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-in attempts — wait a minute and try again.' } });
  const writeLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });

  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
  const tableParam = (req: Request): TableKey => {
    const t = req.params.table as TableKey;
    if (!TABLES[t]) throw new HttpError(404, 'Unknown table');
    if (!canReadTable(req.user!.role, t)) throw new HttpError(403, 'Not permitted');
    return t;
  };

  app.get('/api/health', (req, res) => {
    const internal = req.user && isInternalRole(req.user.role);
    res.json({ ok: data.status.state === 'ok', state: data.status.state, mode: data.status.mode, version: data.status.version, configErrors: internal ? data.status.configErrors : undefined });
  });

  app.get('/api/auth/config', (_req, res) => res.json({ devLogin: cfg.allowDevLogin, mode: data.status.mode }));

  app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) throw new HttpError(400, 'Email and password are required');
    const u = await users.verify(email, password);
    if (!u) throw new HttpError(401, 'Incorrect email or password');
    issueSession(res, { email: u.email, name: u.name, role: u.role }, cfg);
    res.json({ user: { email: u.email, name: u.name, role: u.role } });
  }));

  app.post('/api/auth/dev-login', (req, res) => {
    if (!cfg.allowDevLogin) return res.status(404).json({ error: 'Not available' });
    const role = req.body?.role as Role;
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
    const names: Record<Role, string> = { admin: 'Dev Project Manager', editor: 'Dev OneAlphaMed Editor', client: 'Dev Sun Pharma Viewer' };
    const user = { email: `dev-${role}@localhost`, name: names[role], role, dev: true };
    issueSession(res, user, cfg);
    res.json({ user });
  });

  app.post('/api/auth/logout', (_req, res) => {
    clearSession(res, cfg);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => (req.user ? res.json({ user: req.user }) : res.status(401).json({ error: 'Not signed in' })));

  app.get('/api/snapshot', requireRole('client'), (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(data.snapshot(req.user!));
  });

  // Server-sent events: push a lightweight "version changed" signal; clients then refetch.
  app.get('/api/events', requireRole('client'), (req, res) => {
    if (!data.status.push) return res.status(204).end();
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = () => res.write(`event: sync\ndata: ${JSON.stringify({ version: data.status.version, state: data.status.state, lastSuccessAt: data.status.lastSuccessAt })}\n\n`);
    send();
    data.on('change', send);
    data.on('synced', send);
    const hb = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(hb);
      data.off('change', send);
      data.off('synced', send);
    });
  });

  app.post('/api/sync', requireRole('editor'), wrap(async (_req, res) => {
    await data.sync('manual');
    res.json({ sync: data.status });
  }));

  app.patch('/api/tables/:table/:key', writeLimiter, requireRole('editor'), wrap(async (req, res) => {
    const t = tableParam(req);
    const { changes, original } = req.body ?? {};
    if (!changes || typeof changes !== 'object') throw new HttpError(400, 'changes object required');
    res.json(await data.update(req.user!, t, req.params.key, changes, original ?? {}));
  }));

  app.post('/api/tables/:table', writeLimiter, requireRole('editor'), wrap(async (req, res) => {
    const t = tableParam(req);
    const values = req.body?.values;
    if (!values || typeof values !== 'object') throw new HttpError(400, 'values object required');
    res.status(201).json(await data.create(req.user!, t, values));
  }));

  app.post('/api/tables/:table/bulk', writeLimiter, requireRole('editor'), wrap(async (req, res) => {
    const t = tableParam(req);
    const items = req.body?.items;
    if (!Array.isArray(items) || items.some(i => !i || typeof i.key !== 'string' || !i.changes || typeof i.changes !== 'object'))
      throw new HttpError(400, 'items array of { key, changes, original } required');
    res.json(await data.bulkUpdate(req.user!, t, items));
  }));

  app.post('/api/tables/:table/:key/archive', writeLimiter, requireRole('admin'), wrap(async (req, res) => {
    const t = tableParam(req);
    res.json(await data.archive(req.user!, t, req.params.key, req.body?.original ?? {}));
  }));

  app.get('/api/audit', requireRole('editor'), (req, res) => {
    const recordId = typeof req.query.recordId === 'string' ? req.query.recordId : undefined;
    res.json({ entries: data.auditFor(recordId, Number(req.query.limit ?? 300)) });
  });

  app.post('/api/export', requireRole('client'), wrap(async (req, res) => {
    const table = req.body?.table as TableKey;
    if (!TABLES[table] || !canReadTable(req.user!.role, table)) throw new HttpError(403, 'Not permitted');
    const keys = Array.isArray(req.body?.keys) ? req.body.keys.map(String) : undefined;
    // Exports always reflect the latest sheet: re-read first (a no-op if nothing changed).
    await data.sync('poll');
    const sheet = buildExport(req.user!.role, table, data.records, data.today(), { lastSync: data.status.lastSuccessAt, source: data.status.mode === 'google' ? 'Google Sheet (live)' : 'Local data adapter (Google Sheet not connected)' }, keys);
    const stamp = data.today();
    const base = `PN0510_${TABLES[table].label.replace(/\W+/g, '-')}_${stamp}`;
    if (req.body?.format === 'csv') {
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${base}.csv"` });
      return res.send(toCsv(sheet));
    }
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${base}.xlsx"` });
    res.send(await toXlsx(sheet));
  }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Static frontend (production build).
  const clientDir = path.resolve('dist/client');
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = storeErrorStatus(err);
    const message = err instanceof Error ? err.message : 'Unexpected error';
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Unexpected server error' : message, details: err instanceof HttpError ? err.details : undefined });
  });
  return app;
}
