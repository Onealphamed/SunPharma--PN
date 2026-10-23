// Prints config/users.json as one line, ready to paste into the USERS_JSON environment
// variable on Vercel (or any host without a persistent disk). Contains bcrypt hashes
// only — never plaintext passwords.
import fs from 'node:fs';

const file = process.env.USERS_FILE ?? 'config/users.json';
if (!fs.existsSync(file)) {
  console.error(`${file} not found — add users first with: npm run user:add -- <email> "<name>" <admin|editor|client>`);
  process.exit(1);
}
const users = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log(JSON.stringify(users));
console.error(`\n${users.length} user(s). Paste the line above into Vercel → Settings → Environment Variables → USERS_JSON.`);
