const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const value = process.env.INVENTORY_API_BASE_URL;
const api = new URL(value);
if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash || value !== value.trim()) {
  throw new Error('INVENTORY_API_BASE_URL 必须是纯 HTTPS 地址。');
}
fs.rmSync(output, { recursive: true, force: true });
function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const target = path.join(destination, entry.name);
    const original = path.join(source, entry.name);
    if (entry.isDirectory()) copyDirectory(original, target);
    else if (entry.isFile()) fs.copyFileSync(original, target);
  }
}
copyDirectory(path.join(root, 'public'), output);
const iconNames = new Set(['power.svg', 'power-off.svg']);
for (const name of fs.readdirSync(output)) {
  if (!/\.(html|js|css)$/.test(name)) continue;
  const file = path.join(output, name);
  const original = fs.readFileSync(file, 'utf8');
  for (const match of original.matchAll(/\/icons\/([a-z0-9-]+\.svg)/g)) iconNames.add(match[1]);
  const adapted = name.endsWith('.html')
    ? original.replace(/(href|src)="\/(?!\/)/g, '$1="./')
    : original.replaceAll('/icons/', './icons/');
  fs.writeFileSync(file, adapted);
}
fs.mkdirSync(path.join(output, 'icons'), { recursive: true });
for (const name of iconNames) {
  fs.copyFileSync(path.join(root, 'node_modules/lucide-static/icons', name), path.join(output, 'icons', name));
}
fs.writeFileSync(path.join(output, 'config.js'),
  `window.__INVENTORY_CONFIG__ = Object.freeze({ apiBaseUrl: ${JSON.stringify(value.replace(/\/+$/, ''))} });\n`);
fs.writeFileSync(path.join(output, '.nojekyll'), '');
console.log(`Pages build ready: ${iconNames.size} icons`);
