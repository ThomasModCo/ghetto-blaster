// node scripts/capture-asset-library.mjs <siteBase> <outDir>: every catalog asset as a 720x540 WebP studio render (or its 2D image), plus manifest.json.
// Needs puppeteer-core and sharp, and the window.__cat hook in src/catalog/catalog.js (add it by hand when capturing an older build).
import puppeteer from 'puppeteer-core'; import fs from 'node:fs'; import sharp from 'sharp';
const [, , base, out] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 600000, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'] });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 800 }); p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto(base + 'asset-catalog/', { waitUntil: 'load', timeout: 120000 });
await p.waitForFunction(() => window.__cat && window.__cat.state.usageReady, { timeout: 900000, polling: 2000 });
const list = await p.evaluate(() => window.__cat.items.map((it) => ({ id: it.id, name: it.name, category: it.category, group: it.group, desc: it.desc, build: !!it.build })));
console.log(list.length, 'items');
const man = [];
for (let i = 0; i < list.length; i++) {
  const meta = list[i];
  const url = await p.evaluate((id) => {
    const { items, studio } = window.__cat; const it = items.find((x) => x.id === id);
    if (!it.build) return it.thumb || '';
    try { const obj = it.build(); const u = studio.snapshot(obj, { w: 720, h: 540, view: it.view, grounded: it.grounded !== false, background: it.background, exposure: it.exposure, frame: it.frame }); obj.traverse((o) => o.geometry && o.geometry.dispose()); return u; } catch (e) { return it.thumb || ''; }
  }, meta.id);
  if (!url) { console.log('no image', meta.id); continue; }
  const file = meta.id.replace(/[^a-z0-9_-]+/gi, '_') + '.webp';
  const buf = Buffer.from(url.split(',')[1], 'base64');
  await sharp(buf).resize({ width: 720, height: 540, fit: 'inside', withoutEnlargement: false }).webp({ quality: 80 }).toFile(`${out}/${file}`);
  man.push({ ...meta, file });
  if (i % 25 === 0) console.log(i, meta.id);
}
fs.writeFileSync(`${out}/manifest.json`, JSON.stringify(man));
await b.close();
