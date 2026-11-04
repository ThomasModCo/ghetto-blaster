// Procedural humanoid rig + gun meshes. No external models; everything is boxes with a simple joint hierarchy.
import * as THREE from 'three';
import { SKIN_TONES, HOODIE_COLORS } from './names.js';
import { clamp, damp } from '../core/rng.js';

const matCache = new Map();
const M = (c, r = 0.85, m = 0.02) => { const k = c + r + m; if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: r, metalness: m })); return matCache.get(k); };
const bx = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = false; return m; };

export const TEAM_COLORS = ['#3b82f6', '#ef4444'];

let GUN_ENV = null;
const gunMats = new Set();
/** Reflection map for weapon materials (set once by the engine). */
export function setGunEnvironment(t) { GUN_ENV = t; for (const m of gunMats) { m.envMap = t; m.envMapIntensity = 0.85; m.needsUpdate = true; } }
function gunEnv(group) { group.traverse((o) => { if (o.isMesh && o.material && !gunMats.has(o.material)) { gunMats.add(o.material); if (GUN_ENV) { o.material.envMap = GUN_ENV; o.material.envMapIntensity = 0.85; o.material.needsUpdate = true; } } }); return group; }

export function buildGunMesh(w) {
  const d = w.model; const g = new THREE.Group();
  const metal = M(d.metal || '#2a2a2a', 0.5, 0.6), body = M(d.color || '#2a2a2a', 0.6, 0.4);
  const h = d.h, len = d.len;
  if (d.pistol) {
    g.add(bx(0.04, h * 0.6, len, metal, 0, 0, len / 2)); // slide
    g.add(bx(0.035, 0.11, 0.045, body, 0, -h * 0.3 - 0.055, len * 0.25)); // grip
    if (d.mag) g.add(bx(0.03, d.mag, 0.04, metal, 0, -h * 0.3 - 0.11 - d.mag / 2, len * 0.25));
    if (d.revolver) { const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), metal); cyl.rotation.x = Math.PI / 2; cyl.position.set(0, -0.005, len * 0.45); g.add(cyl); if (d.barrel) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, d.barrel, 6), metal); b.rotation.x = Math.PI / 2; b.position.set(0, 0.0, len + d.barrel / 2); g.add(b); } }
    if (d.suppressor) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8), metal); s.rotation.x = Math.PI / 2; s.position.set(0, 0, len + 0.07); g.add(s); }
    g.userData.muzzle = new THREE.Vector3(0, 0, len + (d.suppressor ? 0.14 : 0) + (d.barrel || 0));
    g.userData.pistol = true;
    return gunEnv(g);
  }
  g.add(bx(0.06, h, len, body, 0, 0, len / 2)); // receiver
  g.add(bx(0.05, h * 0.5, len * 0.55, metal, 0, h * 0.1, len * 0.5)); // upper
  if (d.barrel) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, d.barrel, 8), metal); b.rotation.x = Math.PI / 2; b.position.set(0, h * 0.15, len + d.barrel / 2); g.add(b); }
  if (d.suppressor) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 8), metal); s.rotation.x = Math.PI / 2; s.position.set(0, h * 0.15, len + d.barrel + 0.1); g.add(s); }
  if (d.stock) g.add(bx(0.05, h * 0.75, d.stock, body, 0, -h * 0.1, -d.stock / 2));
  g.add(bx(0.04, 0.12, 0.045, body, 0, -h / 2 - 0.06, len * 0.22)); // grip
  if (d.mag) { const m = bx(0.04, d.mag, 0.07, metal, 0, -h / 2 - d.mag / 2, len * 0.42); if (d.magCurve) m.rotation.x = 0.35; g.add(m); }
  if (d.drum) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 12), metal); c.rotation.z = Math.PI / 2; c.position.set(0, -h / 2 - 0.06, len * 0.42); g.add(c); }
  if (d.box) g.add(bx(0.09, 0.12, 0.14, M('#4a5a3a', 0.9), 0, -h / 2 - 0.06, len * 0.4));
  if (d.scope) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, d.scope, 8), metal); s.rotation.x = Math.PI / 2; s.position.set(0, h / 2 + 0.035, len * 0.45); g.add(s); g.add(bx(0.03, 0.03, 0.03, metal, 0, h / 2 + 0.015, len * 0.45)); }
  else if (d.rail) g.add(bx(0.02, 0.03, 0.08, metal, 0, h / 2 + 0.015, len * 0.3));
  else g.add(bx(0.012, 0.03, 0.012, metal, 0, h / 2 + 0.015, len * 0.1)); // iron sight
  if (d.pump) g.add(bx(0.05, 0.05, 0.14, body, 0, -h * 0.3, len + 0.1));
  if (d.bipod) for (const s of [-1, 1]) { const l = bx(0.012, 0.16, 0.012, metal, s * 0.03, -0.1, len + 0.05); l.rotation.z = s * 0.3; g.add(l); }
  g.userData.muzzle = new THREE.Vector3(0, h * 0.15, len + (d.barrel || 0) + (d.suppressor ? 0.2 : 0));
  return gunEnv(g);
}

export function buildThrowableMesh(eq) {
  const c = eq.color || '#555';
  if (eq.shape === 'can') { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 8), M(c, 0.5, 0.5)); return m; }
  if (eq.shape === 'ball') { const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), M(c, 0.7, 0.3)); return m; }
  if (eq.shape === 'axe') { const g = new THREE.Group(); g.add(bx(0.02, 0.02, 0.4, M('#5a3a1a'), 0, 0, 0)); g.add(bx(0.03, 0.14, 0.1, M('#aaa', 0.3, 0.8), 0, 0.06, 0.15)); return g; }
  if (eq.shape === 'bottle') { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.2, 8), M('#5a8a3a', 0.2, 0.3))); const f = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshStandardMaterial({ color: '#ffb020', emissive: '#ff7000', emissiveIntensity: 2 })); f.position.y = 0.15; g.add(f); return g; }
  return new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.16), M(c, 0.7, 0.3));
}

/** Humanoid rig. forward = +Z local. */
export class CharacterModel {
  constructor({ faction = 'gang', team = null, accent = null, rng, big = false }) {
    this.group = new THREE.Group();
    this.faction = faction;
    const skin = M(rng ? rng.pick(SKIN_TONES) : SKIN_TONES[2], 0.7);
    const acc = accent || (team !== null && team !== undefined ? TEAM_COLORS[team] : '#ffd166');
    let shirt, pants, shoes, headMat, hat = null, extra = [];
    if (faction === 'gang') { shirt = M(rng && rng.chance(0.5) ? acc : rng ? rng.pick(HOODIE_COLORS) : '#2b2b2b', 0.95); pants = M(rng && rng.chance(0.5) ? '#2a3a5a' : '#1e1e1e', 0.95); shoes = M('#eee', 0.6); headMat = skin; hat = rng && rng.chance(0.6) ? (rng.chance(0.5) ? 'hood' : 'cap') : 'bandana'; }
    else if (faction === 'hitman') { shirt = M('#111', 0.7); pants = M('#111', 0.7); shoes = M('#111', 0.3, 0.3); headMat = skin; hat = 'glasses'; extra.push(['tie', M('#fff', 0.8)]); }
    else if (faction === 'sicario') { shirt = M('#1a1a1a', 0.95); pants = M('#5a5a3a', 0.95); shoes = M('#222', 0.8); headMat = M('#111', 0.95); extra.push(['vest', M('#4a5a3a', 0.95)]); }
    else { shirt = M('#4f7fbf', 0.9); pants = M('#1a2340', 0.9); shoes = M('#111', 0.5); headMat = skin; hat = 'cap'; extra.push(['badge', M('#ffd166', 0.3, 0.8)], ['belt', M('#111', 0.5)]); }
    this.accent = acc;
    const s = big ? 1.15 : 1;
    // hierarchy
    this.hips = new THREE.Group(); this.hips.position.y = 0.95 * s; this.group.add(this.hips);
    this.torso = new THREE.Group(); this.hips.add(this.torso);
    const torsoMesh = bx(0.46 * s, 0.62 * s, 0.26 * s, shirt, 0, 0.31 * s, 0); this.torso.add(torsoMesh);
    // arms (shoulder pivots)
    this.armR = new THREE.Group(); this.armR.position.set(-0.3 * s, 0.56 * s, 0); this.torso.add(this.armR);
    this.armL = new THREE.Group(); this.armL.position.set(0.3 * s, 0.56 * s, 0); this.torso.add(this.armL);
    for (const [arm, side] of [[this.armR, -1], [this.armL, 1]]) { arm.add(bx(0.13 * s, 0.3 * s, 0.13 * s, shirt, 0, -0.15 * s, 0)); const fore = bx(0.11 * s, 0.3 * s, 0.11 * s, faction === 'sicario' ? shirt : skin, 0, -0.44 * s, 0); arm.add(fore); const hand = bx(0.1 * s, 0.1 * s, 0.1 * s, faction === 'sicario' ? M('#111') : skin, 0, -0.62 * s, 0); arm.add(hand); }
    // head
    this.neck = new THREE.Group(); this.neck.position.y = 0.64 * s; this.torso.add(this.neck);
    const head = bx(0.26 * s, 0.28 * s, 0.26 * s, headMat, 0, 0.16 * s, 0); this.neck.add(head); this.headMesh = head;
    if (hat === 'hood') { const h = bx(0.3 * s, 0.32 * s, 0.3 * s, shirt, 0, 0.17 * s, -0.03 * s); this.neck.add(h); const face = bx(0.2 * s, 0.2 * s, 0.03 * s, skin, 0, 0.14 * s, 0.14 * s); this.neck.add(face); }
    else if (hat === 'cap') { this.neck.add(bx(0.28 * s, 0.1 * s, 0.28 * s, faction === 'cop' ? M('#1a2340') : M(acc, 0.9), 0, 0.28 * s, 0)); this.neck.add(bx(0.26 * s, 0.03 * s, 0.14 * s, faction === 'cop' ? M('#111') : M(acc, 0.9), 0, 0.25 * s, 0.18 * s)); }
    else if (hat === 'bandana') { this.neck.add(bx(0.27 * s, 0.07 * s, 0.27 * s, M(acc, 0.9), 0, 0.26 * s, 0)); }
    else if (hat === 'glasses') { this.neck.add(bx(0.24 * s, 0.05 * s, 0.03 * s, M('#111', 0.2, 0.5), 0, 0.19 * s, 0.14 * s)); }
    // eyes
    for (const e of [-0.06, 0.06]) if (faction !== 'sicario' && hat !== 'glasses') { const eye = bx(0.03 * s, 0.03 * s, 0.01, M('#111'), e * s, 0.19 * s, 0.135 * s); this.neck.add(eye); }
    for (const [kind, m] of extra) {
      if (kind === 'tie') this.torso.add(bx(0.06 * s, 0.4 * s, 0.01, m, 0, 0.36 * s, 0.135 * s));
      if (kind === 'vest') this.torso.add(bx(0.5 * s, 0.46 * s, 0.32 * s, m, 0, 0.34 * s, 0));
      if (kind === 'badge') this.torso.add(bx(0.05 * s, 0.06 * s, 0.01, m, -0.14 * s, 0.48 * s, 0.135 * s));
      if (kind === 'belt') this.hips.add(bx(0.48 * s, 0.07 * s, 0.28 * s, m, 0, 0.02 * s, 0));
    }
    // legs (hip pivots)
    this.legR = new THREE.Group(); this.legR.position.set(-0.12 * s, 0, 0); this.hips.add(this.legR);
    this.legL = new THREE.Group(); this.legL.position.set(0.12 * s, 0, 0); this.hips.add(this.legL);
    for (const leg of [this.legR, this.legL]) { leg.add(bx(0.18 * s, 0.5 * s, 0.2 * s, pants, 0, -0.25 * s, 0)); leg.add(bx(0.16 * s, 0.4 * s, 0.18 * s, pants, 0, -0.68 * s, 0)); leg.add(bx(0.17 * s, 0.1 * s, 0.26 * s, shoes, 0, -0.9 * s, 0.04 * s)); }
    // gun mount (chest-right, pointing forward)
    this.gunMount = new THREE.Group(); this.torso.add(this.gunMount);
    this.gunMesh = null;
    this.scale = s;
    this.phase = 0; this.bobY = 0; this.aimPitch = 0; this.lean = 0; this.dead = false; this.deathT = 0; this.flinch = 0;
    this.adsBlend = 0; this.crouchBlend = 0; this.sprintBlend = 0;
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    this.shadowOnly = false;
  }
  setGun(weapon) {
    if (this.gunMesh) { this.gunMount.remove(this.gunMesh); }
    this.gunMesh = weapon ? buildGunMesh(weapon) : null;
    if (this.gunMesh) { this.gunMount.add(this.gunMesh); this.gunIsPistol = !!this.gunMesh.userData.pistol; }
  }
  muzzleWorld(out) { if (this.isDog) return out.set(0, 0.6, 0.6).applyMatrix4(this.group.matrixWorld); if (!this.gunMesh) return out.set(0, 1.4, 0).applyMatrix4(this.group.matrixWorld); return out.copy(this.gunMesh.userData.muzzle).applyMatrix4(this.gunMesh.matrixWorld); }
  /** state: { speed (m/s), moving(bool), sprint, crouch, ads, onGround, pitch, lean(-1..1), dead, reloading, firing } */
  update(dt, st) {
    if (this.isDog) return this.updateDog(dt, st);
    const s = this.scale;
    if (st.dead) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT * 2.2);
      const ease = 1 - Math.pow(1 - t, 3);
      this.hips.rotation.x = -ease * (Math.PI / 2) * (this.deathDir || 1);
      this.hips.position.y = (0.95 - ease * 0.72) * s;
      this.torso.rotation.set(0, 0, 0); this.neck.rotation.set(0, 0, 0);
      this.legL.rotation.x = ease * 0.3; this.legR.rotation.x = -ease * 0.2; this.armL.rotation.x = -ease * 1.2; this.armR.rotation.x = -ease * 0.8; this.armL.rotation.z = ease * 1.2; this.armR.rotation.z = -ease * 0.6;
      return;
    }
    this.deathT = 0;
    this.adsBlend = damp(this.adsBlend, st.ads ? 1 : 0, 14, dt);
    this.crouchBlend = damp(this.crouchBlend, st.crouch ? 1 : 0, 12, dt);
    this.sprintBlend = damp(this.sprintBlend, st.sprint && st.moving ? 1 : 0, 8, dt);
    this.lean = damp(this.lean, st.lean || 0, 10, dt);
    this.flinch = Math.max(0, this.flinch - dt * 6);
    const spd = st.speed;
    const stride = st.crouch ? 1.9 : 1.55;
    if (st.moving && st.onGround) this.phase += dt * spd * stride; else this.phase = damp(this.phase, Math.round(this.phase / Math.PI) * Math.PI, 10, dt);
    const amp = st.onGround ? clamp(spd / 6.5, 0, 1) * (0.55 + this.sprintBlend * 0.35) : 0.25;
    const sw = Math.sin(this.phase) * amp, sw2 = Math.sin(this.phase + Math.PI) * amp;
    const crouch = this.crouchBlend;
    // legs
    this.legL.rotation.x = sw - crouch * 0.9 + (!st.onGround ? -0.5 : 0);
    this.legR.rotation.x = sw2 - crouch * 0.9 + (!st.onGround ? -0.3 : 0);
    // hips bob & crouch
    const bob = Math.abs(Math.cos(this.phase)) * 0.045 * amp;
    this.hips.position.y = (0.95 - crouch * 0.42 + bob) * s;
    this.hips.rotation.x = 0;
    this.hips.rotation.z = this.lean * 0.15;
    this.hips.position.x = -this.lean * 0.25 * s;
    // torso: aim pitch + sprint lean + lean
    const pitch = clamp(st.pitch || 0, -1.1, 1.1);
    this.aimPitch = damp(this.aimPitch, pitch, 16, dt);
    this.torso.rotation.x = -this.aimPitch * 0.35 + this.sprintBlend * 0.28 + crouch * 0.25 + this.flinch * 0.2;
    this.torso.rotation.z = this.lean * 0.2;
    this.torso.rotation.y = Math.sin(this.phase) * 0.06 * amp - this.adsBlend * 0.1;
    this.neck.rotation.x = -this.aimPitch * 0.45 - this.sprintBlend * 0.2;
    // arms: hold weapon
    const ads = this.adsBlend, sprint = this.sprintBlend;
    const holdR = -1.35 + sprint * 0.9 - this.aimPitch * 0.5, holdL = -1.3 + sprint * 0.9 - this.aimPitch * 0.5;
    this.armR.rotation.x = holdR; this.armR.rotation.z = 0.15 - ads * 0.1; this.armR.rotation.y = -0.2 + ads * 0.25;
    this.armL.rotation.x = holdL + (this.gunIsPistol ? 0.1 : -0.1); this.armL.rotation.z = -0.45 + ads * 0.2; this.armL.rotation.y = 0.5 - ads * 0.25;
    if (st.reloading) { const r = Math.sin(st.reloadT * 9) * 0.35; this.armL.rotation.x = -0.8 + r; this.armL.rotation.z = -0.3; }
    if (sprint > 0.5 && !st.ads) { this.armR.rotation.x = -0.4 - Math.sin(this.phase + Math.PI) * 0.5 * amp; this.armL.rotation.x = -0.4 - Math.sin(this.phase) * 0.5 * amp; this.armL.rotation.y = 0.1; this.armL.rotation.z = -0.1; }
    // gun mount position follows arms
    const gx = (-0.2 + ads * 0.2) * s, gy = (0.38 + this.aimPitch * 0.05) * s, gz = (0.22 + ads * 0.08) * s;
    this.gunMount.position.set(gx, gy, gz);
    this.gunMount.rotation.set(-this.aimPitch * 0.6 + (sprint > 0.5 && !st.ads ? 0.6 : 0) + (st.reloading ? -0.25 : 0), (sprint > 0.5 && !st.ads ? -0.5 : 0), 0);
    if (st.firing) this.gunMount.position.z -= 0.03;
  }
  makeDog() {
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    this.isDog = true; const m = M('#4a3a30', 0.95), d = M('#2a2420', 0.95);
    this.hips = new THREE.Group(); this.hips.position.y = 0.55; this.group.add(this.hips);
    this.torso = new THREE.Group(); this.hips.add(this.torso);
    this.torso.add(bx(0.32, 0.34, 0.8, m, 0, 0, 0));
    this.neck = new THREE.Group(); this.neck.position.set(0, 0.12, 0.45); this.torso.add(this.neck);
    this.neck.add(bx(0.24, 0.22, 0.3, m, 0, 0.05, 0.12)); this.neck.add(bx(0.14, 0.1, 0.16, d, 0, -0.02, 0.32));
    for (const e of [-0.09, 0.09]) this.neck.add(bx(0.06, 0.08, 0.04, d, e, 0.17, 0.08));
    this.legs = [];
    for (const [x, z] of [[-0.11, 0.3], [0.11, 0.3], [-0.11, -0.3], [0.11, -0.3]]) { const l = new THREE.Group(); l.position.set(x, -0.15, z); l.add(bx(0.1, 0.42, 0.12, m, 0, -0.2, 0)); this.torso.add(l); this.legs.push(l); }
    const tail = bx(0.06, 0.06, 0.3, m, 0, 0.1, -0.5); tail.rotation.x = -0.6; this.torso.add(tail);
    this.armR = new THREE.Group(); this.armL = new THREE.Group(); this.legR = new THREE.Group(); this.legL = new THREE.Group(); this.gunMount = new THREE.Group(); this.torso.add(this.gunMount); this.gunMesh = null;
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }
  updateDog(dt, st) {
    if (st.dead) { this.deathT += dt; const t = Math.min(1, this.deathT * 2.5); this.hips.rotation.z = t * Math.PI / 2; this.hips.position.y = 0.55 - t * 0.35; return; }
    this.deathT = 0; this.hips.rotation.z = 0; this.hips.position.y = 0.55;
    if (st.moving && st.onGround) this.phase += dt * st.speed * 2.2;
    const amp = Math.min(1, st.speed / 8) * 0.8;
    this.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.phase + (i % 3 === 0 ? 0 : Math.PI)) * amp; });
    this.hips.position.y = 0.55 + Math.abs(Math.sin(this.phase)) * 0.06 * amp;
    this.neck.rotation.x = -(st.pitch || 0) * 0.5;
  }
  die(dir = 1) { this.dead = true; this.deathDir = dir; this.deathT = 0; }
  revive() { this.dead = false; this.deathT = 0; this.hips.rotation.set(0, 0, 0); this.hips.position.set(0, 0.95 * this.scale, 0); }
  hit() { this.flinch = 1; }
  setVisible(v) { this.group.visible = v; }
  dispose() { this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
}
