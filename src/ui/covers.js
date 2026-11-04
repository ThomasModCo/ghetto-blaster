// Mode panel covers: three standalone, brightly lit dioramas rendered once (independent of the current map).
//  TDM      - "Block War": midday street, blue crew vs red crew across a car, cool sky, team rim lights.
//  FFA      - "No Friends": rain-slick neon alley at night, magenta/cyan, a lone shooter and chaos behind.
//  Gun Game - "Climb the Ladder": golden-hour rooftop, six shooters in a V, each holding a different gun.
import * as THREE from 'three';
import { CharacterModel } from '../game/character.js';
import { WEAPONS } from '../game/weapons.js';
import { RNG } from '../core/rng.js';
import { tex, skyGradient } from '../core/textures.js';

const W = 480, H = 720;

export function renderCovers(engine) {
  const r = engine.renderer;
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  const buf = new Uint8Array(W * H * 4); const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
  const saved = { exposure: r.toneMappingExposure, clear: r.getClearColor(new THREE.Color()).getHex() };
  const out = [];
  for (const build of [blockWar, noFriends, climbTheLadder]) {
    const scene = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 400);
    const { exposure } = build(scene, cam, new RNG(7));
    r.toneMappingExposure = exposure;
    r.setRenderTarget(rt); r.setClearColor(0x000000, 1); r.clear(); r.render(scene, cam); r.setRenderTarget(null);
    r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    const img = ctx.createImageData(W, H); for (let y = 0; y < H; y++) img.data.set(buf.subarray(y * W * 4, (y + 1) * W * 4), (H - 1 - y) * W * 4); ctx.putImageData(img, 0, 0);
    out.push(c.toDataURL('image/jpeg', 0.88));
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose(); });
  }
  rt.dispose(); r.toneMappingExposure = saved.exposure; r.setClearColor(saved.clear, 1);
  return out;
}

// ---------------- helpers ----------------
const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.02, ...o });
function box(scene, w, h, d, mat, x, y, z, ry = 0, shadow = true) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z); m.rotation.y = ry; m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m; }
function texMat(name, params, repeat, extra = {}) { const t = tex(name, params).clone(); t.repeat.set(repeat[0], repeat[1]); t.needsUpdate = true; return std({ map: t, ...extra }); }
function ground(scene, name, params, size, repeat, extra) { const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), texMat(name, params, [repeat, repeat], extra)); g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g); return g; }
function sun(scene, color, intensity, pos, target = new THREE.Vector3(0, 0, 4)) {
  const s = new THREE.DirectionalLight(color, intensity); s.position.copy(pos); s.target.position.copy(target); s.castShadow = true;
  s.shadow.mapSize.setScalar(2048); const b = 14; Object.assign(s.shadow.camera, { left: -b, right: b, top: b, bottom: -b, near: 1, far: 120 }); s.shadow.bias = -0.0012; s.shadow.normalBias = 0.03;
  scene.add(s); scene.add(s.target); return s;
}
function car(scene, color, x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  const body = std({ color, roughness: 0.35, metalness: 0.1 }), glass = std({ color: '#1d2a3a', roughness: 0.15 }), wheel = std({ color: '#111' });
  const add = (geo, m, px, py, pz) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(px, py, pz); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh; };
  add(new THREE.BoxGeometry(1.9, 0.7, 4.4), body, 0, 0.65, 0); add(new THREE.BoxGeometry(1.7, 0.6, 2.2), glass, 0, 1.3, -0.2); add(new THREE.BoxGeometry(1.75, 0.08, 2.3), body, 0, 1.62, -0.2);
  for (const [wx, wz] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) { const w = add(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 14), wheel, wx, 0.34, wz); w.rotation.z = Math.PI / 2; }
  const lamp = std({ color: '#fff4c0', emissive: '#ffe9a0', emissiveIntensity: 1 }); for (const sx of [-0.6, 0.6]) add(new THREE.BoxGeometry(0.4, 0.2, 0.1), lamp, sx, 0.75, 2.2);
  scene.add(g); return g;
}
function bot(scene, { x, z, y = 0, yaw, faction = 'gang', shirt, pants, accent, hat, weapon, pose = 'aim', pitch = 0, rng }) {
  const m = new CharacterModel({ faction, accent, rng, shirt, pants, hat });
  m.setGun(WEAPONS[weapon]); m.group.position.set(x, y, z); m.group.rotation.y = yaw;
  const st = { speed: 0, moving: false, sprint: false, crouch: false, ads: false, onGround: true, pitch, lean: 0, dead: false };
  if (pose === 'aim') st.ads = true;
  if (pose === 'hip') st.ads = false;
  if (pose === 'crouch') { st.crouch = true; st.ads = true; }
  if (pose === 'run') { st.moving = true; st.sprint = true; st.speed = 7; }
  if (pose === 'lean') { st.ads = true; st.lean = 1; }
  if (pose === 'dead') { st.dead = true; m.die(1); }
  for (let i = 0; i < 30; i++) m.update(0.08, st);
  if (pose === 'run') { m.phase = 1.2; m.update(0.016, st); }
  m.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(m.group); return m;
}
function frontFill(scene, cam, color, intensity) { const f = new THREE.DirectionalLight(color, intensity); f.position.copy(cam.position).add(new THREE.Vector3(1.5, 2.5, 0)); f.target.position.set(cam.position.x, 1, cam.position.z + 10); scene.add(f); scene.add(f.target); return f; }
const face = (from, to) => Math.atan2(to[0] - from[0], to[1] - from[1]);
function facade(scene, wall, style, w, h, d, x, z, ry, lit = 0.25, seed = 2) {
  const t = tex('facade', { seed, wall, style, cols: 3, rows: 2, lit, winColor: '#1a2230' }).clone(); t.repeat.set(Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(h / 6))); t.needsUpdate = true;
  const m = std({ map: t }); const roof = std({ color: '#55544f' });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [m, m, roof, roof, m, m]); mesh.position.set(x, h / 2, z); mesh.rotation.y = ry; mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); return mesh;
}
function decal(scene, texture, w, h, x, y, z, ry, emissive = null, intensity = 1) {
  const m = new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: 0.8, emissive: emissive ? new THREE.Color(emissive) : new THREE.Color(0), emissiveMap: emissive ? texture : null, emissiveIntensity: intensity, side: THREE.DoubleSide });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.position.set(x, y, z); p.rotation.y = ry; scene.add(p); return p;
}

// ---------------- TDM: Block War ----------------
function blockWar(scene, cam, rng) {
  scene.background = skyGradient('#2f7fe0', '#cfe8ff', '#8a9aa8');
  scene.fog = new THREE.Fog('#cfe2f2', 30, 90);
  ground(scene, 'asphalt', { seed: 4, color: '#55555c' }, 80, 18);
  const sw = texMat('sidewalk', {}, [2, 12]); box(scene, 3, 0.15, 40, sw, -5.2, 0, 10, 0, false); box(scene, 3, 0.15, 40, sw, 5.2, 0, 10, 0, false);
  const line = std({ color: '#f2d24b', emissive: '#7a6418', emissiveIntensity: 0.3 }); for (let z = -2; z < 30; z += 3) box(scene, 0.15, 0.02, 1.5, line, 0, 0, z, 0, false);
  facade(scene, '#c0603f', 'brick', 9, 12, 16, -11, 10, 0, 0.3, 1); facade(scene, '#f0c890', 'plain', 9, 9, 14, 11, 8, 0, 0.3, 3); facade(scene, '#d8cbb4', 'plain', 18, 16, 8, 0, 34, 0, 0.35, 2);
  decal(scene, tex('graffiti', { seed: 2, text: 'BLOCK' }), 5, 2.5, -6.48, 1.8, 6, Math.PI / 2); decal(scene, tex('graffiti', { seed: 3, text: 'WAR' }), 4, 2, 6.48, 1.6, 9, -Math.PI / 2);
  car(scene, '#f2c511', 0.2, 7.5, 0.25);
  const bc = { shirt: '#1f6fff', pants: '#1a2440', accent: '#5aa0ff' }, rc = { shirt: '#e8302a', pants: '#2a1a1a', accent: '#ff6b5a' };
  const blue = [[-1.35, 2.2, 'aim', 'chopper', 'gang', 'cap'], [-2.1, 4.6, 'crouch', 'gauge', 'gang', 'bandana'], [-1.6, 9.2, 'aim', 'stick', 'sicario', null]];
  const red = [[1.45, 3.2, 'aim', 'drako', 'gang', 'hood'], [2.2, 6.2, 'run', 'macdaddy', 'gang', 'cap'], [1.7, 10.4, 'aim', 'tommy', 'hitman', 'glasses']];
  blue.forEach(([x, z, pose, w, f, hat], i) => bot(scene, { x, z, yaw: face([x, z], red[i]) , faction: f, ...bc, hat: hat ?? undefined, weapon: w, pose, rng }));
  red.forEach(([x, z, pose, w, f, hat], i) => bot(scene, { x, z, yaw: pose === 'run' ? face([x, z], [-1, 3]) : face([x, z], blue[i]), faction: f, ...rc, hat: hat ?? undefined, weapon: w, pose, rng }));
  scene.add(new THREE.HemisphereLight('#e4f2ff', '#b0a490', 2.2)); scene.add(new THREE.AmbientLight('#ffffff', 0.55));
  sun(scene, '#fff3e0', 3.4, new THREE.Vector3(-14, 26, -12), new THREE.Vector3(0, 0, 6));
  const bl = new THREE.PointLight('#3d8bff', 30, 14, 1.6); bl.position.set(-4.5, 2.5, 3); scene.add(bl);
  const rl = new THREE.PointLight('#ff3b30', 30, 14, 1.6); rl.position.set(4.5, 2.5, 4); scene.add(rl);
  cam.position.set(0, 1.35, -6.4); cam.lookAt(0, 1.5, 7); cam.fov = 46; cam.updateProjectionMatrix();
  frontFill(scene, cam, '#ffffff', 1.4);
  return { exposure: 1.45 };
}

// ---------------- FFA: No Friends ----------------
function noFriends(scene, cam, rng) {
  scene.background = skyGradient('#120a2e', '#7a2a8a', '#1a0f2e');
  scene.fog = new THREE.Fog('#2a1446', 14, 46);
  ground(scene, 'asphalt', { seed: 4, color: '#544a64' }, 60, 14, { roughness: 0.28 });
  const wallL = texMat('brick', { color: '#7a4a62', seed: 2 }, [6, 3]), wallR = texMat('concrete', { color: '#6a6a84', seed: 3 }, [6, 3]);
  box(scene, 0.6, 10, 30, wallL, -3.2, 0, 10, 0); box(scene, 0.6, 12, 30, wallR, 3.2, 0, 10, 0);
  const neon = [['KTV', '#ff2d95', -2.88, 3.6, 4, Math.PI / 2], ['24H', '#00e5ff', 2.88, 4.2, 6.5, -Math.PI / 2], ['PAWN', '#ffe600', -2.88, 5.2, 10, Math.PI / 2], ['GB', '#ff2d95', 2.88, 3.0, 12, -Math.PI / 2], ['OPEN', '#00e5ff', -2.88, 2.6, 14, Math.PI / 2]];
  for (const [t, col, x, y, z, ry] of neon) decal(scene, tex('neon', { text: t, color: col, w: 512, h: 160 }), 2.6, 0.8, x, y, z, ry, col, 2.2);
  decal(scene, tex('graffiti', { seed: 1, text: 'NO FRIENDS' }), 4.5, 2.2, 2.88, 1.5, 3, -Math.PI / 2);
  box(scene, 2, 1.3, 1.3, std({ color: '#2f5f3f' }), -2.0, 0, 7.5, 0.2); box(scene, 1, 1, 1, std({ color: '#9c7a4a' }), 2.2, 0, 9, 0.5);
  const hero = [0.25, 1.4];
  bot(scene, { x: hero[0], z: hero[1], yaw: Math.PI + 0.55, faction: 'gang', shirt: '#ffcc00', pants: '#141414', accent: '#ffcc00', hat: 'hood', weapon: 'drako', pose: 'aim', rng });
  bot(scene, { x: -1.4, z: 6.5, yaw: Math.PI - 0.5, faction: 'sicario', shirt: '#1a1a1a', pants: '#3a3a2a', weapon: 'whisper', pose: 'run', rng });
  bot(scene, { x: 1.6, z: 9.5, yaw: Math.PI + 0.3, faction: 'hitman', weapon: 'hammer', pose: 'crouch', rng });
  bot(scene, { x: -0.6, z: 4.4, yaw: 2.2, faction: 'gang', shirt: '#00c2ff', pants: '#1a2440', hat: 'cap', weapon: 'nine', pose: 'dead', rng });
  bot(scene, { x: 0.8, z: 15, yaw: Math.PI, faction: 'gang', shirt: '#ff2d95', pants: '#222', weapon: 'chopper', pose: 'aim', rng });
  scene.add(new THREE.HemisphereLight('#a89cff', '#5a2a6a', 2.3)); scene.add(new THREE.AmbientLight('#c8b8ff', 0.75));
  const key = sun(scene, '#ffd6f5', 1.6, new THREE.Vector3(6, 18, -10), new THREE.Vector3(0, 0, 5));
  for (const [col, x, y, z, i] of [['#ff2d95', -2.2, 3.6, 2.5, 60], ['#00e5ff', 2.2, 4, 4.5, 60], ['#ffe600', -2.2, 5, 10, 40], ['#ff2d95', 2, 3, 12, 40], ['#ffffff', 0.5, 2.5, -1.5, 18], ['#ff6fd0', 1.6, 2.2, -0.4, 36], ['#00e5ff', -1.8, 1.8, 0.6, 30]]) { const l = new THREE.PointLight(col, i, 16, 1.6); l.position.set(x, y, z); scene.add(l); }
  cam.position.set(-0.4, 1.45, -2.9); cam.lookAt(0.3, 1.5, 6); cam.fov = 52; cam.updateProjectionMatrix();
  frontFill(scene, cam, '#ffd0f0', 0.9);
  return { exposure: 1.7 };
}

// ---------------- Gun Game: Climb the Ladder ----------------
function climbTheLadder(scene, cam, rng) {
  scene.background = skyGradient('#1e4a6e', '#ffb347', '#6a3a1a');
  scene.fog = new THREE.Fog('#f2a75a', 40, 120);
  ground(scene, 'tile', { seed: 2, color: '#a8a296', line: '#6a6458', size: 32 }, 60, 10);
  const parapet = std({ color: '#8a6a50' }); box(scene, 16, 1, 0.4, parapet, 0, 0, 13, 0); box(scene, 0.4, 1, 16, parapet, -7, 0, 5, 0); box(scene, 0.4, 1, 16, parapet, 7, 0, 5, 0);
  // water tower + AC units
  const wood = std({ color: '#6a4a30' }); for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(scene, 0.15, 5, 0.15, wood, 4.5 + lx, 0, 11 + lz, 0);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.5, 2.6, 18), std({ color: '#7a5a3a' })); tank.position.set(4.5, 6.3, 11); tank.castShadow = true; scene.add(tank);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.75, 1, 18), std({ color: '#4a3020' })); cone.position.set(4.5, 8.1, 11); scene.add(cone);
  box(scene, 1.6, 1, 1.2, std({ color: '#b8bcc0', roughness: 0.5 }), -4.5, 0, 9, 0.3);
  // skyline silhouettes catching the sun
  for (let i = 0; i < 9; i++) { const x = -40 + i * 10 + rng.float(-2, 2), h = rng.float(14, 36); facade(scene, rng.pick(['#5a4a42', '#6a5a4a', '#4a4a52']), 'plain', rng.float(7, 11), h, 8, x, rng.float(45, 60), 0, 0.5, 1 + (i % 3)); }
  const gold = '#ffb020';
  const line = [[0, 0.8, 'snubby', 'aim', 'gang', '#ffd166', 'cap'], [-1.2, 2.6, 'hammer', 'hip', 'hitman', null, 'glasses'], [1.25, 3.0, 'macdaddy', 'crouch', 'gang', '#2fbfa8', 'bandana'], [-2.1, 5.0, 'chopper', 'aim', 'sicario', '#3a3a2a', null], [2.1, 5.4, 'ratchet', 'hip', 'gang', '#8a4fe1', 'hood'], [0.2, 7.4, 'fifty', 'aim', 'cop', null, null]];
  line.forEach(([x, z, w, pose, f, shirt, hat], i) => bot(scene, { x, z, yaw: Math.PI + (x === 0 ? 0.35 : x < 0 ? 0.5 : -0.5), faction: f, shirt: shirt || undefined, accent: gold, hat: hat ?? undefined, weapon: w, pose, pitch: pose === 'hip' ? 0.15 : 0, rng }));
  scene.add(new THREE.HemisphereLight('#fff0d0', '#8a7058', 2.1)); scene.add(new THREE.AmbientLight('#ffe8c8', 0.6));
  sun(scene, '#ffb45a', 3.4, new THREE.Vector3(-18, 9, 30), new THREE.Vector3(0, 0, 4)); // low golden sun behind: warm rim light
  const fill = new THREE.DirectionalLight('#ffe8c8', 1.6); fill.position.set(3, 6, -10); scene.add(fill);
  const spot = new THREE.SpotLight('#ffd166', 80, 25, 0.5, 0.6, 1.2); spot.position.set(0, 9, -2); spot.target.position.set(0, 0, 3); scene.add(spot); scene.add(spot.target);
  cam.position.set(0, 2.0, -4.6); cam.lookAt(0, 1.2, 5); cam.fov = 50; cam.updateProjectionMatrix();
  frontFill(scene, cam, '#fff2e0', 1.3);
  return { exposure: 1.4 };
}
