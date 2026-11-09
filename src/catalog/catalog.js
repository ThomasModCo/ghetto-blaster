// Ghetto Blaster asset catalog: a live, searchable view of every character, weapon, prop, structure, map,
// texture, VFX and icon, rendered from the game's own code.
import './catalog.css';
import { Studio, measure, disposeGeometry } from './studio.js';
import { buildRegistry, CATEGORIES } from './registry.js';
import { loadModels } from '../game/models.js';
import { analyseMaps } from './maps.js';
import { MAPS } from '../maps/index.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtN = (n) => (n == null ? '—' : n >= 10000 ? (n / 1000).toFixed(1) + 'k' : n.toLocaleString());
const cvar = (cat) => `var(--cat-${cat})`;
const MAP_NAME = Object.fromEntries(MAPS.map((m) => [m.id, m.name]));

const studio = new Studio();
await loadModels('../').catch((e) => console.warn('models unavailable', e));
const items = buildRegistry();
const byId = new Map(items.map((it) => [it.id, it]));
const state = { q: '', cat: 'All', sort: 'category', dir: 1, view: 'grid', rendered: 0, mapsDone: 0, usageReady: false };
window.__cat = { items, studio, state }; // used by scripts/capture-asset-library.mjs (before/after library)
try { Object.assign(state, JSON.parse(localStorage.getItem('gb.catalog') || '{}'), { q: '', rendered: 0, mapsDone: 0, usageReady: false }); } catch (e) { /* ignore */ }
const saveUi = () => { try { localStorage.setItem('gb.catalog', JSON.stringify({ cat: state.cat, sort: state.sort, dir: state.dir, view: state.view })); } catch (e) { /* ignore */ } };

// ---------------- layout ----------------
$('#app').innerHTML = `
<header class="top">
  <div class="row1">
    <div class="brand"><b>GHETTO BLASTER</b><span>ASSET CATALOG</span></div>
    <div class="search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" type="search" placeholder="Search name, tag, category, file…" autocomplete="off"><kbd>/</kbd></div>
    <div class="ctrl"><label for="sort" style="color:var(--muted);font-size:12px">Sort</label>
      <select id="sort"><option value="category">Category</option><option value="name">Name</option><option value="size">Size</option><option value="tris">Triangles</option><option value="usage">Usage</option><option value="materials">Materials</option></select>
      <button class="btn" id="dir" title="Reverse order">↓</button></div>
    <div class="seg" id="viewseg"><button data-v="grid">Grid</button><button data-v="list">Table</button></div>
    <div class="ctrl"><button class="btn" id="csv">Export CSV</button><button class="btn" id="json">JSON</button></div>
    <a class="back" href="../">← Back to game</a>
  </div>
  <div class="chips" id="chips"></div>
  <div class="status" id="status"></div>
</header>
<main><div id="results"></div></main>
<div class="modal hidden" id="modal"><div class="sheet">
  <div class="viewer" id="viewer"><div class="vbar" id="vbar"></div><div class="hint" id="vhint"></div></div>
  <div class="info"><div class="ih"><div><h2 id="dname"></h2><div class="id" id="did"></div></div><div class="x"><button class="btn" id="prev" title="Previous (←)">‹</button><button class="btn" id="next" title="Next (→)">›</button><button class="btn" id="close" title="Close (Esc)">✕</button></div></div><div class="ib" id="dbody"></div></div>
</div></div>
<div class="toast" id="toast"></div>`;

const toast = (t) => { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => e.classList.remove('on'), 1600); };

// ---------------- derived values ----------------
const sizeOf = (it) => (it.mapStats ? it.mapStats.size : it.sizeM ?? (it.stats ? Math.max(it.stats.w, it.stats.h, it.stats.d) : 0));
function usageOf(it) {
  if (it.usage != null) return it.usage;
  if (!it.usageKey || !state.usageReady) return null;
  const u = state.usage[it.usageKey] || {};
  if (it.category === 'Textures') return Object.keys(u).length; // maps it appears on
  return Object.values(u).reduce((a, b) => a + b, 0);
}
function usageText(it) {
  const u = usageOf(it);
  if (u == null) return it.usageKey ? (state.usageReady ? '0 uses' : 'counting…') : '';
  if (it.category === 'Textures') return `${u} map${u === 1 ? '' : 's'}`;
  if (it.category === 'Props' || it.category === 'Structures') return `${fmtN(u)} placed`;
  return `${u} use${u === 1 ? '' : 's'}`;
}
const dims = (it) => (it.mapStats ? `${it.mapStats.size} × ${it.mapStats.size} m` : it.size2d ? it.size2d : it.stats ? `${it.stats.w} × ${it.stats.h} × ${it.stats.d} m` : '…');
const haystack = (it) => [it.name, it.id, it.category, it.group, it.desc, it.source, ...(it.tags || [])].join(' ').toLowerCase();

// ---------------- filtering / sorting ----------------
function visibleItems() {
  const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  let list = items.filter((it) => (state.cat === 'All' || it.category === state.cat) && words.every((w) => (it._hay ||= haystack(it)).includes(w)));
  const catIdx = (c) => CATEGORIES.indexOf(c);
  const key = { name: (it) => it.name.toLowerCase(), category: (it) => catIdx(it.category) * 1e6, size: sizeOf, tris: (it) => (it.mapStats ? it.mapStats.tris : it.stats ? it.stats.tris : -1), usage: (it) => usageOf(it) ?? -1, materials: (it) => (it.stats ? it.stats.materials : -1) }[state.sort];
  const numeric = state.sort !== 'name';
  const desc = ['size', 'tris', 'usage', 'materials'].includes(state.sort);
  list.sort((a, b) => {
    let r;
    if (state.sort === 'category') r = catIdx(a.category) - catIdx(b.category) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name);
    else if (numeric) r = (desc ? key(b) - key(a) : key(a) - key(b)) || a.name.localeCompare(b.name);
    else r = key(a).localeCompare(key(b));
    return r * state.dir;
  });
  return list;
}

// ---------------- rendering the list ----------------
function thumbClass(it) { return ['thumb', it.flat && !it.iconBg ? 'flat' : '', it.iconBg ? 'icon' : '', it.background ? 'dark' : '', it.category === 'Textures' && it.group !== 'Ground' && it.group !== 'Surfaces' && it.group !== 'Facades' ? 'checker' : ''].join(' '); }
function cardHTML(it) {
  return `<div class="card" data-id="${esc(it.id)}" style="--c:${cvar(it.category)}"><div class="${thumbClass(it)}">${it.thumb ? `<img src="${it.thumb}" alt="${esc(it.name)}">` : '<div class="shimmer"></div>'}<span class="tag">${esc(it.category)}</span></div>
  <div class="meta"><div class="nm" title="${esc(it.name)}">${esc(it.name)}</div><div class="sub">${esc(it.group)}</div><div class="st"><span>${esc(dims(it))}</span>${it.stats || it.mapStats ? `<span><b>${fmtN(it.mapStats ? it.mapStats.tris : it.stats.tris)}</b> tris</span>` : ''}${usageText(it) ? `<span>${esc(usageText(it))}</span>` : ''}</div></div></div>`;
}
function rowHTML(it) {
  const s = it.stats; const tris = it.mapStats ? it.mapStats.tris : s ? s.tris : null;
  return `<tr data-id="${esc(it.id)}" style="--c:${cvar(it.category)}"><td><div class="mini">${it.thumb ? `<img src="${it.thumb}" alt="">` : ''}</div></td><td><b>${esc(it.name)}</b><div class="src">${esc(it.id)}</div></td><td><span class="cat"><i></i>${esc(it.category)}</span></td><td>${esc(it.group)}</td><td>${esc(dims(it))}</td><td class="num">${fmtN(tris)}</td><td class="num">${s ? s.materials : '—'}</td><td>${esc(usageText(it))}</td></tr>`;
}
let renderQueued = false;
function render() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderNow(); }); }
function renderNow() {
  const list = visibleItems(); state.list = list;
  const counts = { All: items.length }; for (const it of items) counts[it.category] = (counts[it.category] || 0) + 1;
  $('#chips').innerHTML = ['All', ...CATEGORIES].map((c) => `<button class="chip ${state.cat === c ? 'on' : ''}" data-cat="${c}" style="--c:${c === 'All' ? 'var(--accent)' : cvar(c)}">${c !== 'All' ? '<i></i>' : ''}${c}<em>${counts[c] || 0}</em></button>`).join('');
  const res = $('#results');
  if (!list.length) { res.innerHTML = `<div class="empty">No assets match “${esc(state.q)}”.</div>`; return; }
  if (state.view === 'grid') res.innerHTML = `<div class="grid">${list.map(cardHTML).join('')}</div>`;
  else {
    const th = (k, label, cls = '') => `<th data-sort="${k}" class="${state.sort === k ? 'sorted' : ''} ${cls}">${label}${state.sort === k ? (state.dir > 0 ? ' ↓' : ' ↑') : ''}</th>`;
    res.innerHTML = `<table class="list"><thead><tr><th></th>${th('name', 'Name')}${th('category', 'Category')}<th>Group</th>${th('size', 'Size')}${th('tris', 'Tris', 'num')}${th('materials', 'Mats', 'num')}${th('usage', 'Usage')}</tr></thead><tbody>${list.map(rowHTML).join('')}</tbody></table>`;
  }
  $('#sort').value = state.sort; $('#dir').textContent = state.dir > 0 ? '↓' : '↑';
  for (const b of $('#viewseg').children) b.classList.toggle('on', b.dataset.v === state.view);
}
function updateStatus() {
  const total = items.filter((it) => !it.mapId).length;
  const parts = [];
  if (state.rendered < total) parts.push(`<span>Rendering assets ${state.rendered}/${total}</span><span class="bar"><i style="width:${(state.rendered / total) * 100}%"></i></span>`);
  if (state.mapsDone < MAPS.length) parts.push(`<span>Analysing maps ${state.mapsDone}/${MAPS.length} (usage counts)</span><span class="bar"><i style="width:${(state.mapsDone / MAPS.length) * 100}%"></i></span>`);
  if (!parts.length) parts.push(`<span>${items.length} assets · rendered live from the game code · ${new Date().toLocaleDateString()}</span>`);
  $('#status').innerHTML = parts.join('');
}

// ---------------- controls ----------------
const q = $('#q');
q.addEventListener('input', () => { state.q = q.value; render(); });
$('#chips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; state.cat = b.dataset.cat; saveUi(); render(); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; state.dir = 1; saveUi(); render(); });
$('#dir').addEventListener('click', () => { state.dir *= -1; saveUi(); render(); });
$('#viewseg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.view = b.dataset.v; saveUi(); render(); });
$('#results').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]'); if (th) { if (state.sort === th.dataset.sort) state.dir *= -1; else { state.sort = th.dataset.sort; state.dir = 1; } saveUi(); render(); return; }
  const el = e.target.closest('[data-id]'); if (el) openDetail(el.dataset.id);
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); q.select(); }
  if (!$('#modal').classList.contains('hidden')) { if (e.key === 'Escape') closeDetail(); if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); }
  else if (e.key === 'Escape' && document.activeElement === q) { q.value = ''; state.q = ''; render(); }
});
function exportRows() {
  return items.map((it) => ({ id: it.id, name: it.name, category: it.category, group: it.group, width_m: it.stats?.w ?? '', height_m: it.stats?.h ?? '', depth_m: it.stats?.d ?? '', triangles: it.mapStats ? it.mapStats.tris : it.stats?.tris ?? '', meshes: it.mapStats ? it.mapStats.meshes : it.stats?.meshes ?? '', materials: it.stats?.materials ?? '', usage: usageOf(it) ?? '', usage_detail: usageDetailText(it), palette: (it.stats?.palette || []).join(' '), textures: (it.stats?.textures || []).join(' '), source: it.source, description: it.desc }));
}
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
$('#csv').addEventListener('click', () => { const rows = exportRows(); const cols = Object.keys(rows[0]); const cell = (v) => `"${String(v).replace(/"/g, '""')}"`; download('ghetto-blaster-assets.csv', [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n'), 'text/csv'); });
$('#json').addEventListener('click', () => download('ghetto-blaster-assets.json', JSON.stringify(exportRows(), null, 2), 'application/json'));

// ---------------- detail panel ----------------
const view = { it: null, obj: null, orbit: null, auto: true, idleT: 0, drag: null, fx: null, liveT: 0, last: 0, play: false };
function usageDetailText(it) { if (!it.usageKey || !state.usageReady) return it.usageLabel || ''; const u = state.usage[it.usageKey] || {}; return Object.entries(u).map(([m, n]) => `${MAP_NAME[m]} ${n}`).join('; '); }
function usageHTML(it) {
  if (it.usageLabel && !it.usageKey) return `<div class="desc">${esc(it.usageLabel)}</div>`;
  if (!it.usageKey) return '';
  if (!state.usageReady) return '<div class="desc" style="color:var(--muted)">Counting across all maps…</div>';
  const u = state.usage[it.usageKey] || {}; const max = Math.max(1, ...Object.values(u));
  const tex = it.category === 'Textures';
  const rows = MAPS.map((m) => { const n = u[m.id] || 0; const pct = tex && state.mapInfo[m.id] ? ((n / state.mapInfo[m.id].stats.tris) * 100).toFixed(1) + '%' : fmtN(n); return `<div class="use"><span>${esc(m.name)}</span><span class="b"><i style="width:${(n / max) * 100}%"></i></span><em>${n ? pct : '—'}</em></div>`; }).join('');
  return `<div class="uses">${rows}</div>${tex ? '<div class="src" style="margin-top:4px">Share of each map\'s triangles using this texture.</div>' : ''}`;
}
function infoRows(it) { return (it.info || []).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join(''); }
function detailBody(it) {
  const s = it.stats, ms = it.mapStats;
  const kpis = ms
    ? [['Size', `${ms.size} × ${ms.size} m`], ['Triangles', fmtN(ms.tris)], ['Draw objects', ms.meshes], ['Colliders', fmtN(ms.colliders)], ['Point lights', ms.lights], ['Spawns', ms.spawns]]
    : s ? [[it.size2d ? 'Size' : 'Size (W×H×D)', it.size2d || `${s.w} × ${s.h} × ${s.d} m`], ['Triangles', fmtN(s.tris)], ['Meshes', s.meshes], ['Materials', s.materials]] : it.size2d ? [['Resolution', it.size2d]] : [];
  let mapExtra = '';
  if (ms) {
    const props = Object.entries(state.usage || {}).filter(([k]) => !k.startsWith('tex:')).map(([k, v]) => [k, v[it.mapId] || 0]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const texs = Object.entries(ms.texTris).sort((a, b) => b[1] - a[1]).slice(0, 8);
    mapExtra = `<div><h3 class="sec">Most placed assets</h3><div class="uses">${props.map(([k, n]) => `<div class="use"><span>${esc(byId.get(k.replace(/^(building|shell):/, (m0) => 'structure:' + m0.slice(0, -1) + '-').replace(/^prop:/, 'prop:').replace(/^(wall|fence|stairs|platform|road)$/, 'structure:$1'))?.name || k)}</span><span class="b"><i style="width:${(n / props[0][1]) * 100}%"></i></span><em>${n}</em></div>`).join('')}</div></div>
      <div><h3 class="sec">Texture coverage</h3><div class="uses">${texs.map(([n, t]) => `<div class="use" style="--c:var(--cat-Textures)"><span>${esc(n)}</span><span class="b"><i style="width:${(t / texs[0][1]) * 100}%"></i></span><em>${((t / ms.tris) * 100).toFixed(0)}%</em></div>`).join('')}</div></div>
      <table class="kv"><tr><td>Teams</td><td>TDM ${ms.teams?.tdm ?? '?'}v${ms.teams?.tdm ?? '?'} · FFA ${ms.teams?.ffa ?? '?'} players</td></tr><tr><td>Lighting</td><td>${ms.night ? 'Night (moon + neon)' : 'Day'}</td></tr><tr><td>Landmarks</td><td>${esc(ms.landmarks.join(', '))}</td></tr><tr><td>Walkable nav cells</td><td>${fmtN(ms.navCells)}</td></tr></table>`;
  }
  return `<div class="pills"><span class="pill" style="--c:${cvar(it.category)}"><i></i>${esc(it.category)}</span><span class="pill">${esc(it.group)}</span>${(it.tags || []).slice(0, 4).map((t) => `<span class="pill">${esc(t)}</span>`).join('')}</div>
    <div class="desc">${esc(it.desc)}</div>
    ${kpis.length ? `<div class="kpis">${kpis.map(([k, v]) => `<div class="kpi"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
    ${mapExtra}
    ${s && s.palette.length ? `<div><h3 class="sec">Colour palette</h3><div class="palette">${s.palette.map((c) => `<span class="sw" data-hex="${c}"><i style="background:${c}"></i>${c}</span>`).join('')}</div></div>` : ''}
    ${s && s.textures.length ? `<div><h3 class="sec">Textures used</h3><div class="pills">${s.textures.map((t) => `<span class="pill">${esc(t)}</span>`).join('')}${s.emissive ? '<span class="pill">emissive parts</span>' : ''}</div></div>` : ''}
    ${it.usageKey || it.usageLabel ? `<div><h3 class="sec">Usage</h3>${usageHTML(it)}</div>` : ''}
    ${(it.info || []).length ? `<div><h3 class="sec">Details</h3><table class="kv">${infoRows(it)}</table></div>` : ''}
    ${it.notes ? `<div><h3 class="sec">Notes for the reskin</h3><div class="notes">${esc(it.notes)}</div></div>` : ''}
    <div><h3 class="sec">Source</h3><div class="src">${esc(it.source)}</div></div>`;
}
function openDetail(id) {
  const it = byId.get(id); if (!it) return;
  closeViewerObj();
  view.it = it; if (decodeURIComponent(location.hash.slice(1)) !== id) history.replaceState(null, '', '#' + encodeURIComponent(id));
  $('#modal').classList.remove('hidden'); $('#dname').textContent = it.name; $('#did').textContent = it.id;
  const viewer = $('#viewer'); viewer.classList.toggle('dark', !!it.background);
  viewer.querySelectorAll('.imgs, canvas').forEach((n) => n.remove());
  const bar = $('#vbar'); bar.innerHTML = '';
  if (it.build) {
    view.obj = it.build(); if (!it.stats) it.stats = measure(view.obj);
    view.fx = view.obj.userData.fx || null; view.liveT = 0; view.play = false;
    const dir = { iso: [0.7, 0.5], side: [Math.PI / 2, 0.12], front: [0.25, 0.22], top: [0.001, 1.1], low: [0.75, 0.25] }[it.view || 'iso'] || [0.7, 0.5];
    view.orbit = { yaw: dir[0], pitch: dir[1], zoom: 1.08 }; view.auto = !it.frame; view.idleT = 0;
    const cv = studio.renderer.domElement; viewer.prepend(cv);
    bar.innerHTML = `${it.live ? '<button class="btn" id="vplay">Play effect</button>' : ''}<button class="btn ${view.auto ? 'on' : ''}" id="vauto">Auto-rotate</button><button class="btn" id="vreset">Reset view</button><button class="btn" id="vpng">Download PNG</button>`;
    if (it.live) $('#vplay').onclick = () => { view.play = !view.play; $('#vplay').classList.toggle('on', view.play); $('#vplay').textContent = view.play ? 'Playing (loop)' : 'Play effect'; if (!view.play) { closeViewerObj(); view.obj = it.build(); view.fx = view.obj.userData.fx || null; } };
    $('#vhint').textContent = it.live ? 'Frozen at peak · drag to orbit · scroll to zoom' : 'Drag to orbit · scroll to zoom';
    $('#vauto').onclick = () => { view.auto = !view.auto; $('#vauto').classList.toggle('on', view.auto); };
    $('#vreset').onclick = () => { view.orbit = { yaw: dir[0], pitch: dir[1], zoom: 1.08 }; };
    $('#vpng').onclick = () => { const o = it.build(); const url = studio.snapshot(o, { w: 1600, h: 1200, view: it.view, grounded: it.grounded !== false, background: it.background, exposure: it.exposure, frame: it.frame }); disposeGeometry(o); const a = document.createElement('a'); a.href = url; a.download = it.id.replace(/[:]/g, '-') + '.png'; a.click(); };
  } else {
    const imgs = document.createElement('div');
    if (it.mapId) { imgs.className = 'imgs'; imgs.innerHTML = it.thumb ? `<img src="${it.thumb}" alt="${esc(it.name)} view"><img src="${state.mapInfo[it.mapId].minimap}" alt="${esc(it.name)} layout">` : '<div class="desc" style="padding:20px">Analysing this map…</div>'; $('#vhint').textContent = it.thumb ? 'Cinematic view and top-down layout' : ''; }
    else if (it.iconBg) { imgs.className = 'imgs icon'; imgs.innerHTML = `<img src="${it.thumb}" alt="">`; $('#vhint').textContent = ''; }
    else { imgs.className = 'imgs tile'; imgs.innerHTML = `<img src="${it.thumb}" alt=""><img src="${it.thumb}" alt=""><img src="${it.thumb}" alt=""><img src="${it.thumb}" alt="">`; $('#vhint').textContent = it.group === 'Ground' || it.group === 'Surfaces' || it.group === 'Facades' ? 'Tiled 2 × 2 to check seams' : 'Shown 2 × 2'; }
    viewer.prepend(imgs);
    if (it.thumb) { bar.innerHTML = '<button class="btn" id="vpng">Download PNG</button>'; $('#vpng').onclick = () => { const a = document.createElement('a'); a.href = it.thumb; a.download = it.id.replace(/[:]/g, '-') + (it.thumb.startsWith('data:image/jpeg') ? '.jpg' : '.png'); a.click(); }; }
  }
  $('#dbody').innerHTML = detailBody(it); $('#dbody').scrollTop = 0;
}
function closeViewerObj() { if (view.obj) { studio.slot.remove(view.obj); disposeGeometry(view.obj); view.obj = null; view.fx = null; } }
function closeDetail() { closeViewerObj(); view.it = null; $('#modal').classList.add('hidden'); history.replaceState(null, '', location.pathname + location.search); }
function step(d) { const list = state.list || items; const i = list.indexOf(view.it); const n = list[(i + d + list.length) % list.length]; if (n) openDetail(n.id); }
$('#close').onclick = closeDetail; $('#prev').onclick = () => step(-1); $('#next').onclick = () => step(1);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeDetail(); });
$('#dbody').addEventListener('click', (e) => { const sw = e.target.closest('.sw'); if (sw) { navigator.clipboard?.writeText(sw.dataset.hex); toast(`Copied ${sw.dataset.hex}`); } });
const cv = studio.renderer.domElement;
cv.addEventListener('pointerdown', (e) => { view.drag = { x: e.clientX, y: e.clientY }; view.idleT = 0; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', (e) => { if (!view.drag || !view.orbit) return; view.orbit.yaw -= (e.clientX - view.drag.x) * 0.008; view.orbit.pitch = Math.max(-0.2, Math.min(1.45, view.orbit.pitch + (e.clientY - view.drag.y) * 0.006)); view.drag = { x: e.clientX, y: e.clientY }; view.idleT = 0; });
cv.addEventListener('pointerup', () => { view.drag = null; });
cv.addEventListener('wheel', (e) => { if (!view.orbit) return; e.preventDefault(); view.orbit.zoom = Math.max(0.35, Math.min(3, view.orbit.zoom * (1 + Math.sign(e.deltaY) * 0.08))); }, { passive: false });

// ---------------- pipeline: thumbnails, then map analysis ----------------
const queue = items.filter((it) => !it.mapId);
function renderThumb(it) {
  if (it.image) { it.thumb = it.image(); return; }
  const obj = it.build(); it.stats = measure(obj);
  it.thumb = studio.snapshot(obj, { w: 400, h: 300, view: it.view, grounded: it.grounded !== false, background: it.background, exposure: it.exposure, frame: it.frame });
  disposeGeometry(obj);
}
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - (view.last || t)) / 1000); view.last = t;
  if (queue.length) {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 24) { const it = queue.shift(); try { renderThumb(it); } catch (e) { console.warn('asset failed', it.id, e); it.thumb = ''; it.error = String(e); } state.rendered++; }
    updateStatus(); render();
    if (!queue.length) startMaps();
  }
  if (view.obj && view.it) {
    const it = view.it;
    if (view.auto && !view.drag) { view.idleT += dt; if (view.idleT > 0.4) view.orbit.yaw += dt * 0.45; }
    if (view.fx && (view.play || !it.live)) { view.fx.update(dt, null); if (it.live && view.play) { view.liveT -= dt; if (view.liveT <= 0) { view.liveT = it.live.every; it.live.spawn(view.fx); } } }
    const r = $('#viewer').getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
    studio.render(view.obj, { w: Math.max(2, Math.round(r.width * dpr)), h: Math.max(2, Math.round(r.height * dpr)), orbit: view.orbit, grounded: it.grounded !== false, background: it.background, exposure: it.exposure, frame: it.frame });
  }
}
let mapsStarted = false;
async function startMaps() {
  if (mapsStarted) return; mapsStarted = true; state.mapInfo = {};
  const usage = await analyseMaps(studio, (info) => {
    state.mapInfo[info.id] = info; const it = byId.get('map:' + info.id);
    it.thumb = info.shot; it.mapStats = info.stats; it.pending = false; state.mapsDone++;
    it.desc = `${info.def.name} — based on ${info.def.city}. ${info.def.blurb || ''}`.trim();
    updateStatus(); render(); if (view.it === it) openDetail(it.id);
  });
  state.usage = usage; state.usageReady = true; updateStatus(); render();
  if (view.it) $('#dbody').innerHTML = detailBody(view.it);
}

updateStatus(); renderNow(); requestAnimationFrame(loop);
const fromHash = () => { const id = decodeURIComponent(location.hash.slice(1)); if (id && byId.has(id)) { if (!view.it || view.it.id !== id) openDetail(id); } else if (view.it) closeDetail(); };
window.addEventListener('hashchange', fromHash);
if (location.hash.length > 1) setTimeout(fromHash, 50);
