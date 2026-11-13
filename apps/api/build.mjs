// Bundles the API (and the workspace `@app/shared` package) into dist/.
// npm dependencies stay external and are installed in the runtime image.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@app/'));

await build({
  entryPoints: ['src/server.ts', 'src/migrate.ts', 'src/scripts/bot-setup.ts'],
  entryNames: '[name]',
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node26',
  format: 'esm',
  sourcemap: true,
  external,
  logLevel: 'info',
});
