// Builds the Android app's web bundle into app/www:
// copies public/ (minus server-only files), bundles the native bridge, and switches the UI to on-device mode.
import { build } from 'esbuild';
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const www = root + 'app/www';
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
cpSync(root + 'public', www, { recursive: true, filter: (src) => !/[/\\](sw\.js|manifest\.webmanifest)$/.test(src) });

await build({
  entryPoints: [root + 'app/native.js'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  outfile: www + '/native.js',
});

const indexPath = www + '/index.html';
let html = readFileSync(indexPath, 'utf8');
html = html.replace('<link rel="manifest" href="/manifest.webmanifest" />\n', '');
html = html.replace(
  '<link rel="stylesheet" href="/styles.css" />',
  `<script>window.RECIPIN_MODE='app'</script>\n  <script src="/native.js"></script>\n  <link rel="stylesheet" href="/styles.css" />`,
);
writeFileSync(indexPath, html);
console.log('app/www ready');
