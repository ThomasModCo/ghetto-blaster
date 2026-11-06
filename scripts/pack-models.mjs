// Post-build: pack dist/models/*.glb into dist/models/pack.json (base64) for hosts that refuse .glb files.
// Usage: node scripts/pack-models.mjs [distDir]
import fs from 'node:fs'; import path from 'node:path';
const dist = process.argv[2] || 'dist'; const dir = path.join(dist, 'models');
const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const pack = {};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.glb'))) {
  pack['models/' + f] = fs.readFileSync(path.join(dir, f)).toString('base64');
  fs.unlinkSync(path.join(dir, f));
}
fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(pack));
mf.pack = 'models/pack.json';
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(mf));
console.log('packed', Object.keys(pack).length, 'models');
