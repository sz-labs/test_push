const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const rawApiBase = process.env.INVENTORY_API_BASE_URL || '';
const apiUrl = new URL(rawApiBase);
if (apiUrl.protocol !== 'https:' || apiUrl.username || apiUrl.password || apiUrl.search ||
    apiUrl.hash || rawApiBase !== rawApiBase.trim()) {
  throw new Error('INVENTORY_API_BASE_URL 必须是纯 HTTPS 地址。');
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(sourcePath, destinationPath);
    else if (entry.isFile()) fs.copyFileSync(sourcePath, destinationPath);
  }
}

fs.rmSync(output, { recursive: true, force: true });
copyDirectory(path.join(root, 'public'), output);

const htmlPath = path.join(output, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8')
  .replace(/(href|src)="\/(styles\.css|config\.js|app\.js|icons\/)/g, '$1="./$2');
fs.writeFileSync(htmlPath, html);
fs.writeFileSync(
  path.join(output, 'config.js'),
  `window.__INVENTORY_CONFIG__ = Object.freeze({ apiBaseUrl: ${JSON.stringify(rawApiBase.replace(/\/+$/, ''))} });\n`
);
fs.writeFileSync(path.join(output, '.nojekyll'), '');

const iconNames = [...new Set([...html.matchAll(/\.\/icons\/([^"']+)/g)].map((match) => match[1]))];
const iconOutput = path.join(output, 'icons');
fs.mkdirSync(iconOutput, { recursive: true });
for (const iconName of iconNames) {
  fs.copyFileSync(
    path.join(root, 'node_modules', 'lucide-static', 'icons', iconName),
    path.join(iconOutput, iconName)
  );
}
console.log(`Pages build ready: ${iconNames.length} icons, API ${apiUrl.origin}`);
