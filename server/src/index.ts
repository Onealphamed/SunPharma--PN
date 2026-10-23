import { createApp } from './app';
import { UserDirectory } from './auth';
import { loadConfig } from './config';
import { DataService } from './DataService';
import { FileStore } from './store/FileStore';
import { GoogleSheetsStore } from './store/GoogleSheetsStore';
import type { TableStore } from './store/types';

const cfg = loadConfig();
if (cfg.production && cfg.configErrors.some(e => e.startsWith('JWT_SECRET'))) {
  console.error('Refusing to start: JWT_SECRET must be set in production.');
  process.exit(1);
}

let store: TableStore;
if (cfg.dataSource === 'google' && cfg.sheetId && cfg.googleCredentials) {
  store = new GoogleSheetsStore(cfg.sheetId, cfg.googleCredentials);
} else {
  if (cfg.dataSource === 'google') console.warn('Google Sheets is not fully configured — falling back to the local data file.\n  ' + cfg.configErrors.join('\n  '));
  store = new FileStore(cfg.localStorePath);
}

const data = new DataService(store, { intervalSec: cfg.syncIntervalSec, timeZone: cfg.timeZone, configErrors: cfg.configErrors, serverless: cfg.serverless });
const users = new UserDirectory(cfg);
data.start();

const app = createApp(cfg, data, users);
app.listen(cfg.port, () => {
  console.log(`PN0510 dashboard API on http://localhost:${cfg.port}`);
  console.log(`  Source: ${store.description} · polling every ${cfg.syncIntervalSec}s`);
  if (cfg.allowDevLogin) console.log('  Dev sign-in enabled (ALLOW_DEV_LOGIN=true) — never enable this in production.');
  if (!users.list().length && !cfg.allowDevLogin) console.log('  No users configured: add one with  npm run user:add -- <email> "<name>" <admin|editor|client>');
});
