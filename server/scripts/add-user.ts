// Add or update a dashboard user in config/users.json (or the path in USERS_FILE).
//
//   npm run user:add -- someone@example.com "Full Name" admin|editor|client [--password <pw>]
//
// Without --password a strong random password is generated and printed once.
// For hosted deployments, copy the resulting JSON into the USERS_JSON secret.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { hashPassword, UserRecord } from '../src/auth';
import { ROLES, Role } from '../../shared/schema';

const args = process.argv.slice(2);
const pwIdx = args.indexOf('--password');
const password = pwIdx >= 0 ? args[pwIdx + 1] : crypto.randomBytes(12).toString('base64url');
const [email, name, role] = pwIdx >= 0 ? args.filter((_, i) => i !== pwIdx && i !== pwIdx + 1) : args;
if (!email || !name || !ROLES.includes(role as Role)) {
  console.error('Usage: npm run user:add -- <email> "<name>" <admin|editor|client> [--password <pw>]');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Password must be at least 10 characters.');
  process.exit(1);
}
const file = process.env.USERS_FILE ?? 'config/users.json';
fs.mkdirSync(path.dirname(file), { recursive: true });
const users: UserRecord[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
const rec: UserRecord = { email: email.toLowerCase(), name, role: role as Role, passwordHash: await hashPassword(password) };
const i = users.findIndex(u => u.email === rec.email);
if (i >= 0) users[i] = rec;
else users.push(rec);
fs.writeFileSync(file, JSON.stringify(users, null, 2));
console.log(`${i >= 0 ? 'Updated' : 'Added'} ${rec.email} (${rec.role}) in ${file}`);
if (pwIdx < 0) console.log(`Generated password (shown once — share it securely): ${password}`);
