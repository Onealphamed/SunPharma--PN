// Vercel serverless entry point. One Express app per function instance; the data
// cache lives for the life of the instance and refreshes on demand (see ensureFresh).
// Project data is never bundled into the deployment: without Google Sheets
// credentials every data request fails with a clear "not configured" error.
import { createApp } from './app';
import { describeUsersJson, UserDirectory } from './auth';
import { loadConfig } from './config';
import { DataService } from './DataService';
import { GoogleSheetsStore } from './store/GoogleSheetsStore';
import { StoreError, TableStore } from './store/types';

const cfg = loadConfig({ ...process.env, SERVERLESS: 'true', DATA_SOURCE: 'google' });

const store: TableStore =
  cfg.sheetId && cfg.googleCredentials
    ? new GoogleSheetsStore(cfg.sheetId, cfg.googleCredentials)
    : {
        kind: 'google',
        description: 'Google Sheet (not configured)',
        readTabs: () => Promise.reject(new StoreError(`Live Google Sheet not configured: ${cfg.configErrors.join(' ')}`, 503)),
        updateCells: () => Promise.reject(new StoreError('Live Google Sheet not configured', 503)),
        appendRows: () => Promise.reject(new StoreError('Live Google Sheet not configured', 503)),
        ensureTabs: () => Promise.reject(new StoreError('Live Google Sheet not configured', 503)),
      };

const data = new DataService(store, { intervalSec: cfg.syncIntervalSec, timeZone: cfg.timeZone, configErrors: cfg.configErrors, serverless: true });
const app = createApp(cfg, data, new UserDirectory(cfg));

const jwtError = cfg.configErrors.find(e => e.startsWith('JWT_SECRET'));

// USERS_JSON is parsed lazily at sign-in; check it up front so a bad paste is reported clearly.
let usersError: string | null = null;
try {
  const n = new UserDirectory(cfg).list().length;
  if (!n) usersError = process.env.USERS_JSON ? 'USERS_JSON contains no valid users.' : 'USERS_JSON is not set for this environment.';
} catch {
  usersError = `USERS_JSON is not valid JSON (${describeUsersJson(process.env.USERS_JSON)}). Re-paste the single line printed by scripts/users-json.mjs.`;
}

export default function handler(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  const problem = jwtError ?? usersError;
  if (problem) {
    // Refuse to run half-configured (e.g. signing sessions with the development fallback secret).
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: `Server not configured: ${problem} Add it in Vercel → Settings → Environment Variables (Production), then redeploy.` }));
    return;
  }
  return app(req as any, res as any);
}
