// Builds a single self-contained HTML demo (for a Claude artifact or any static host):
//   node build/demo.mjs  → dist/demo.html
// The bundle sets __DEMO__ = true and replaces js/net.js with js/demo/net.js (simulated data).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swapNet = {
  name: 'swap-net',
  setup(b) {
    b.onResolve({ filter: /^\.\/net\.js$/ }, args =>
      args.importer.includes(`${'/'}js${'/'}demo${'/'}`) ? undefined : { path: resolve(root, 'js/demo/net.js') });
  },
};
const out = await build({
  entryPoints: [resolve(root, 'js/app.js')], bundle: true, write: false, format: 'iife',
  minify: !process.env.DEBUG, target: 'es2020', define: { __DEMO__: 'true' }, plugins: [swapNet], charset: 'utf8',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const leafletCss = readFileSync(resolve(root, 'vendor/leaflet/leaflet.css'), 'utf8');
const appCss = readFileSync(resolve(root, 'css/app.css'), 'utf8').replace(/@font-face\s*\{[^}]*\}/, '');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script src="vendor/leaflet/leaflet.js">')).trim();

const page = `<title>بیلبوردسنج</title>
<meta name="description" content="دموی تحلیل نقاط بیلبورد تهران">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300..900&display=swap">
<style>
${leafletCss}
${appCss}
:root { color-scheme: dark; }
html, body { height: 100%; background: var(--bg); color: var(--text); }
body { direction: rtl; }
</style>
<div dir="rtl" lang="fa" style="display:contents">
${body}
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
<script>${js}</script>
`;
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/demo.html'), page);
console.log('dist/demo.html', (page.length / 1024).toFixed(0) + ' KB');
