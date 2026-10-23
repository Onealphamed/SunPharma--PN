import 'dotenv/config';
import fs from 'node:fs';
import type { GoogleCredentials } from './store/GoogleSheetsStore';

export interface AppConfig {
  port: number;
  production: boolean;
  dataSource: 'google' | 'local';
  localStorePath: string;
  sheetId: string | null;
  googleCredentials: GoogleCredentials | null;
  syncIntervalSec: number;
  jwtSecret: string;
  sessionHours: number;
  usersFile: string;
  usersJson: string | null;
  allowDevLogin: boolean;
  cookieSecure: boolean;
  timeZone: string;
  /** Running as short-lived functions (Vercel): no background poller or push channel. */
  serverless: boolean;
  /** Problems that prevent the configured mode from working (reported in /api/health). */
  configErrors: string[];
}

function readCredentials(errors: string[]): GoogleCredentials | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  try {
    let text: string | null = null;
    if (raw) text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    else if (file && fs.existsSync(file)) text = fs.readFileSync(file, 'utf8');
    if (!text) return null;
    const json = JSON.parse(text);
    if (!json.client_email || !json.private_key) throw new Error('missing client_email / private_key');
    return json;
  } catch (e) {
    errors.push(`Service-account credentials could not be read: ${(e as Error).message}`);
    return null;
  }
}

export function loadConfig(env = process.env): AppConfig {
  const errors: string[] = [];
  const production = env.NODE_ENV === 'production';
  const dataSource = (env.DATA_SOURCE ?? 'local') === 'google' ? 'google' : 'local';
  const creds = dataSource === 'google' ? readCredentials(errors) : null;
  if (dataSource === 'google') {
    if (!env.GOOGLE_SHEET_ID) errors.push('GOOGLE_SHEET_ID is not set.');
    if (!creds && !errors.length) errors.push('GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_APPLICATION_CREDENTIALS) is not set.');
  }
  // Trim: values pasted into hosting dashboards often carry a trailing newline or spaces.
  let jwtSecret = (env.JWT_SECRET ?? '').trim();
  if (jwtSecret.length < 32) {
    // Report only presence and length, never the value.
    if (production)
      errors.push(jwtSecret ? `JWT_SECRET is too short (${jwtSecret.length} characters; needs 32+).` : 'JWT_SECRET is not set for this environment.');
    jwtSecret = jwtSecret || 'dev-only-insecure-secret-change-me-0123456789';
  }
  const allowDevLogin = env.ALLOW_DEV_LOGIN === 'true' && !production;
  return {
    port: Number(env.PORT ?? 8080),
    production,
    dataSource,
    localStorePath: env.LOCAL_STORE_PATH ?? 'data/local-store.json',
    sheetId: env.GOOGLE_SHEET_ID ?? null,
    googleCredentials: creds,
    syncIntervalSec: Math.max(10, Number(env.SYNC_INTERVAL_SECONDS ?? 30)),
    jwtSecret,
    sessionHours: Number(env.SESSION_HOURS ?? 12),
    usersFile: env.USERS_FILE ?? 'config/users.json',
    usersJson: env.USERS_JSON ?? null,
    allowDevLogin,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    timeZone: env.PROJECT_TIME_ZONE ?? 'Asia/Kolkata',
    serverless: env.VERCEL === '1' || env.SERVERLESS === 'true',
    configErrors: errors,
  };
}
