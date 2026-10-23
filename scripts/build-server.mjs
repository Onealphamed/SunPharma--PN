// Bundles the API server (and shared code) into dist/server/index.js.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/server/index.js',
  packages: 'external',
  sourcemap: true,
});
console.log('Server bundled → dist/server/index.js');
