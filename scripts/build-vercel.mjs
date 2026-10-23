// Builds a Vercel "Build Output API" bundle in .vercel/output:
//   static/                  → the React client (dist/client)
//   functions/api/index.func → the whole API bundled into one CommonJS file
// Routing: real files first, then /api/* → the function, then the SPA fallback.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const out = '.vercel/output';
fs.rmSync(out, { recursive: true, force: true });
execSync('npx vite build', { stdio: 'inherit' });
fs.cpSync('dist/client', `${out}/static`, { recursive: true });

const fn = `${out}/functions/api/index.func`;
await build({
  entryPoints: ['server/src/vercel.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: `${fn}/index.js`,
  logLevel: 'warning',
});
fs.writeFileSync(`${fn}/package.json`, JSON.stringify({ type: 'commonjs' }));
fs.writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.js', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 }, null, 2));

const security = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
  'X-Robots-Tag': 'noindex, nofollow',
};
fs.writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '/(.*)', headers: security, continue: true },
    { src: '/assets/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
    { handle: 'filesystem' },
    { src: '^/api(?:/.*)?$', dest: '/api/index' },
    { src: '/(.*)', dest: '/index.html' },
  ],
}, null, 2));
console.log(`Vercel output ready → ${out}`);
