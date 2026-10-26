import { createApp } from './app';
import { UserDirectory } from './auth';
import { loadConfig } from './config';
import { DataService } from './DataService';
import { FileStore } from './store/FileStore';
import { GoogleSheetsStore } from './store/GoogleSheetsStore';
import { PublicSheetStore } from './store/PublicSheetStore';
import type { TableStore } from './store/types';

const cfg = loadConfig();
const users = new UserDirectory(cfg);
// Sessions need a real secret whenever someone can sign in (always, unless open access with no accounts).
const canSignIn = !cfg.publicAccess || users.list().length > 0;
if (cfg.production && canSignIn && cfg.configErrors.some(e => e.startsWith('JWT_SECRET'))) {
  console.error('Refusing to start: JWT_SECRET must be set in production.');
  process.exit(1);
}

let store: TableStore;
if (cfg.dataSource === 'google' && cfg.sheetId && cfg.googleCredentials) {
  store = new GoogleSheetsStore(cfg.sheetId, cfg.googleCredentials);
} else if (cfg.dataSource === 'public-sheet' && cfg.sheetId) {
  store = new PublicSheetStore(cfg.sheetId);
} else {
  if (cfg.dataSource !== 'local') console.warn('Google Sheets is not fully configured — falling back to the local data file.\n  ' + cfg.configErrors.join('\n  '));
  store = new FileStore(cfg.localStorePath);
}

const data = new DataService(store, { intervalSec: cfg.syncIntervalSec, timeZone: cfg.timeZone, configErrors: cfg.configErrors, serverless: cfg.serverless });
data.start();

const app = createApp(cfg, data, users);
app.listen(cfg.port, () => {
  console.log(`PN0510 dashboard API on http://localhost:${cfg.port}`);
  console.log(`  Source: ${store.description} · polling every ${cfg.syncIntervalSec}s`);
  console.log(cfg.publicAccess ? '  Open access: visitors see the read-only client view without signing in.' : '  Sign-in required for everyone (PUBLIC_ACCESS=false).');
  if (cfg.allowDevLogin) console.log('  Dev sign-in enabled (ALLOW_DEV_LOGIN=true) — never enable this in production.');
  if (!users.list().length && !cfg.allowDevLogin) console.log('  No users configured: add one with  npm run user:add -- <email> "<name>" <admin|editor|client>');
});
