// Player controller: input -> movement, third-person over-the-shoulder camera, ADS, recoil, lean, equipment.
import * as THREE from 'three';
import { Actor } from './actor.js';
import { clamp, damp, lerp, dampAngle } from '../core/rng.js';
import { ViewModel } from './viewmodel.js';

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3(), _o = new THREE.Vector3(), _t = new THREE.Vector3(), _c = new THREE.Vector3();

export class Player extends Actor {
  constructor(match, opts) {
    super(match, { ...opts, isPlayer: true });
    this.camera = match.camera;
    this.yaw = opts.yaw || 0; this.pitch = 0;
    this.recoilP = 0; this.recoilY = 0; this.kickP = 0; this.kickY = 0;
    this.adsBlend = 0; this.fov = match.settings.fov || 75; this.curFov = this.fov;
    this.crouchToggle = false; this.bobPhase = 0; this.camShake = 0;
    this.camPos = new THREE.Vector3(); this.camTarget = new THREE.Vector3();
    this.frozen = true; // pre-match
    this.autoReloadT = -1;
    this.scopeOverlay = false;
    this.lastFireHeld = false;
    this.leanDir = 0;
    this.aimPoint = new THREE.Vector3();
    this.sensitivity = 1;
    this.view = new ViewModel(match.engine.vmCamera, { plastic: this.model.plastic, skin: this.model.skinTone, bareArms: this.model.hat === 'bandana' });
    this.view.setWeapon(this.weapon.def);
    this.model.setVisible(false); // first person: own body hidden while alive
    this.lastLook = { dx: 0, dy: 0 };
  }
  muzzleWorld(out) { return this.alive ? this.view.muzzleWorld(out) : this.model.muzzleWorld(out); }
  setLoadout(lo) { super.setLoadout(lo); if (this.view) this.view.setWeapon(this.weapon.def); }
  setSingleWeapon(w) { super.setSingleWeapon(w); if (this.view) this.view.setWeapon(w); }
  swapWeapon() { const before = this.cur; super.swapWeapon(); if (this.cur !== before && this.view) this.view.setWeapon(this.weapon.def); }
  onSpawn() { this.yaw = this.body.yaw; this.pitch = 0; this.recoilP = 0; this.recoilY = 0; this.adsBlend = 0; this.crouchToggle = false; this.leanDir = 0; this.snapCamera = true; this.stance = 'stand'; this.slideT = -1; this.slideBlend = 0; this.lastDuckT = -9;
    // loadout or streak changes made mid-match take effect on the next spawn (COD rules)
    if (this.nextLoadout) { this.setLoadout(this.nextLoadout); this.nextLoadout = null; }
    if (this.nextStreaks) { const st = this.match.streakState; this.nextStreaks.forEach((d, i) => { if (d && st.picks[i] !== d) { st.picks[i] = d; st.used[i] = false; } }); this.nextStreaks = null; st.dirty = true; }
  }
  get sliding() { return this.slideT >= 0; }
  /** COD-style slide: duck while sprinting carries your momentum low along the ground, then settles into a crouch. */
  startSlide() {
    const m = this.match, v = this.body.vel, h = Math.hypot(v.x, v.z);
    this.slideDir = h > 0.5 ? new THREE.Vector3(v.x / h, 0, v.z / h) : this.forward(new THREE.Vector3()).clone();
    this.slideSpeed0 = Math.max(h, 6.5) * 1.4; this.slideT = 0; this.slideDur = 0.85; this.slideToProne = false;
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); this.slideSide = this.slideDir.dot(right) > 0.2 ? -1 : 1;
    this.stance = 'crouch'; this.sprint = false; this.kickP -= 0.02;
    m.audio('whoosh', this, null, { vol: 0.9 }); m.input.rumble?.(0.35, 0.15, 300);
  }
  update(dt, input) {
    const m = this.match;
    if (!this.alive) { this.deadT += dt; this.speed = 0; this.moving = false; this.updateCommon(dt); this.updateCamera(dt, true); return; }
    const w = this.weapon.def;
    // ---- look ----
    const adsScale = this.adsBlend > 0.5 ? clamp(w.adsFov / this.fov, 0.25, 1) : 1;
    const sens = 0.0022 * this.sensitivity * adsScale;
    this.lastLook = input.look;
    // controller aim assist: slowdown near enemies, and a short snap toward the closest one when you aim down sights
    let assist = 1;
    const aa = input.pad && m.settings.aimAssist !== false && !this.frozen && this.alive;
    if (aa) {
      const t = this._assistScan(0.02 + (this.ads ? 0.015 : 0));
      if (t) assist = this.ads ? 0.45 : 0.6;
      if (this.ads && !this._wasAds) { this._snap = this._assistScan(0.11); this._snapT = Math.max(0.12, w.adsTime); }
      if (this._snap && this.ads && this._snapT > 0 && this._snap.alive) {
        this._snapT -= dt; const eye = this.eye(new THREE.Vector3()); const c = this._snap.chest(new THREE.Vector3()).sub(eye);
        this.yaw = dampAngle(this.yaw, Math.atan2(c.x, c.z), 9, dt); this.pitch += (Math.atan2(c.y, Math.hypot(c.x, c.z)) - this.pitch) * Math.min(1, dt * 9);
      } else this._snap = null;
    }
    this._wasAds = this.ads;
    input.look.dx *= assist; input.look.dy *= assist;
    if (!this.frozen && this.fx.stun <= 0) { this.yaw -= input.look.dx * sens; this.pitch -= input.look.dy * sens; }
    else if (!this.frozen) { this.yaw -= input.look.dx * sens * 0.3; this.pitch -= input.look.dy * sens * 0.3; }
    this.pitch = clamp(this.pitch, -1.35, 1.35);
    // recoil recovery
    const rec = w.recoilRecover;
    this.recoilP = damp(this.recoilP, 0, rec, dt); this.recoilY = damp(this.recoilY, 0, rec, dt);
    this.kickP = damp(this.kickP, 0, 18, dt); this.kickY = damp(this.kickY, 0, 18, dt);
    this.body.yaw = this.yaw;
    // ---- actions ----
    const P = input.pressed;
    // ---- stance: tap duck = crouch, quick double tap = prone, duck while sprinting = slide ----
    if (this.stance === undefined) { this.stance = 'stand'; this.slideT = -1; this.slideBlend = 0; this.lastDuckT = -9; }
    if (P.has('crouch') && !this.frozen) {
      if (this.sliding) this.slideToProne = true;
      else if (this.sprint && this.body.onGround && this.speed > 4.5) this.startSlide();
      else if (m.time - this.lastDuckT < 0.32 && this.lastDuckResult === 'crouch' && this.stance === 'crouch') this.stance = 'prone';
      else if (this.stance === 'prone') this.stance = 'crouch';
      else this.stance = this.stance === 'crouch' ? 'stand' : 'crouch';
      this.lastDuckT = m.time; this.lastDuckResult = this.stance;
    }
    if (P.has('reload')) this.startReload();
    if (P.has('swap') || P.has('w1') || P.has('w2')) { if (P.has('w1') && this.cur !== 0) this.swapWeapon(); else if (P.has('w2') && this.cur !== 1) this.swapWeapon(); else if (P.has('swap')) this.swapWeapon(); }
    if (P.has('lethal')) m.throwEquipment(this, 'lethal');
    if (P.has('tactical')) m.throwEquipment(this, 'tactical');
    for (let i = 0; i < 3; i++) if (P.has('streak' + (i + 1))) m.useStreak(this, i);
    if (m.input.mobile && !input.pad) { if (P.has('peekR')) this.leanDir = this.leanDir ? 0 : 1; } else this.leanDir = input.peek;
    this.lean = this.leanDir;
    // ADS
    const wantAds = input.ads && !this.frozen && this.swapT <= 0 && this.fx.stun <= 0;
    this.ads = wantAds;
    const crawling = this.body.prone && Math.hypot(input.move.x, input.move.y) > 0.15;
    if (crawling) this.ads = false; // the weapon comes down while you crawl
    this.sprint = input.sprint && input.move.y > 0.3 && !this.ads && !this.reloading && this.fx.stun <= 0 && !this.sliding;
    if (this.sprint && this.stance !== 'stand') { this.stance = 'stand'; } // sprinting gets you up from crouch or prone
    // ---- movement ----
    const mv = input.move; const len = Math.hypot(mv.x, mv.y); const mx = len > 1 ? mv.x / len : mv.x, my = len > 1 ? mv.y / len : mv.y;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    _dir.set(sy * my - cy * mx, 0, cy * my + sy * mx);
    const base = this.sprint ? 7.2 : 5.3;
    let speed = base * this.effectiveSpeedMult();
    if (this.frozen) { _dir.set(0, 0, 0); speed = 0; }
    let jump = P.has('jump') && !this.frozen && this.fx.stun <= 0 && this.fx.knock <= 0;
    if (jump && !this.sliding && this.stance === 'prone') { this.stance = 'crouch'; jump = false; } // jump from prone just gets you up a level
    else if (jump) { if (this.sliding) this.slideT = -1; this.stance = 'stand'; }
    let accel = 14;
    if (this.sliding) {
      this.slideT += dt; const k = Math.min(1, this.slideT / this.slideDur); const ease = 1 - (1 - k) * (1 - k);
      speed = this.slideSpeed0 + (2.4 - this.slideSpeed0) * ease; accel = 40;
      // a little steering from the stick, never a full turn
      if (len > 0.2) { this.slideDir.lerp(new THREE.Vector3(_dir.x, 0, _dir.z).normalize(), Math.min(1, dt * 1.5)).normalize(); }
      _dir.copy(this.slideDir);
      if (this.match.fx._spawn && Math.random() < 0.5) this.match.fx._spawn(this.body.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.05, (Math.random() - 0.5) * 0.4)), new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.6, (Math.random() - 0.5) * 0.6), 0.6, 1.4, new THREE.Color(0.55, 0.52, 0.48), -0.4, 2.5);
      const hv0 = Math.hypot(this.body.vel.x, this.body.vel.z);
      if (k >= 1 || (this.slideT > 0.15 && hv0 < 1.2) || !this.body.onGround && this.slideT > 0.3) { this.slideT = -1; this.stance = this.slideToProne ? 'prone' : 'crouch'; }
    }
    this.body.wantProne = this.stance === 'prone'; this.body.wantCrouch = this.stance !== 'stand';
    this.body.step(dt, _dir, speed, jump, accel);
    const hv = Math.hypot(this.body.vel.x, this.body.vel.z); this.speed = hv; this.moving = hv > 0.4 && (mx !== 0 || my !== 0);
    if (this.moving && this.body.onGround) { this.bobPhase += dt * hv * 1.6; if (Math.sin(this.bobPhase) > 0.98 && !this._stepped) { this._stepped = true; m.audio('step', this, null, { vol: this.sprint ? 0.9 : 0.5 }); } else if (Math.sin(this.bobPhase) < 0) this._stepped = false; }
    // ---- firing ----
    if (this.autoReloadT >= 0) { this.autoReloadT -= dt; if (this.autoReloadT < 0) { this.startReload(); } }
    const trigger = input.fire && !this.frozen && this.fx.stun <= 0 && !crawling;
    if (trigger && this.sprint) this.sprint = false;
    const semiTrigger = w.auto ? trigger : (trigger && !this.lastFireHeld);
    this.lastFireHeld = trigger;
    if ((semiTrigger || this.burstLeft > 0) && this.swapT <= 0) {
      this.computeAim();
      const origin = this.eye(new THREE.Vector3()); const dir = this.aimPoint.clone().sub(origin).normalize();
      if (this.fire(origin, dir, semiTrigger)) {
        const kickMult = this.ads ? 0.65 : 1;
        this.recoilP += w.recoilV * 0.012 * kickMult; this.recoilY += (this.rng.next() - 0.5) * w.recoilH * 0.012 * kickMult;
        this.kickP += w.recoilV * 0.01; this.kickY += (this.rng.next() - 0.5) * w.recoilH * 0.01;
        this.pitch += w.recoilV * 0.0035 * kickMult; // permanent climb (COD-like)
        this.view.onShot(w);
        const heavy = w.type === 'shotgun' || w.type === 'sniper' || w.type === 'revolver';
        m.input.rumble?.(heavy ? 0.55 : 0.2, heavy ? 0.9 : 0.3, heavy ? 140 : 55);
        this.camShake = Math.min(1, this.camShake + (w.type === 'sniper' || w.type === 'shotgun' ? 0.5 : 0.15));
      }
    } else if (trigger && this.weapon.mag === 0 && !this.reloading) { this.startReload(); }
    this.updateCommon(dt);
    this.updateCamera(dt, false);
  }
  /** Closest visible enemy inside the aim-assist cone (radians beyond the target's own angular size). */
  _assistScan(extra) {
    const m = this.match, cam = this.camera; const fwd = cam.getWorldDirection(new THREE.Vector3());
    let best = null, bestA = Infinity;
    for (const a of m.actors) {
      if (a === this || !a.alive || m.sameTeam(a, this) || a.isDog) continue;
      const c = a.chest(new THREE.Vector3()); const to = c.clone().sub(cam.position); const d = to.length(); if (d > 70 || d < 0.5) continue;
      const ang = Math.acos(clamp(to.dot(fwd) / d, -1, 1)); const win = Math.atan(0.7 / d) + extra;
      if (ang < win && ang < bestA && m.map.world.los(cam.position, c)) { bestA = ang; best = a; }
    }
    return best;
  }
  /** Aim point: ray from camera through screen centre, hitting world or actors. */
  computeAim() {
    const cam = this.camera; cam.getWorldDirection(_dir);
    _o.copy(cam.position);
    const hit = this.match.traceBullet(this, _o, _dir, 400, null, true);
    if (hit) this.aimPoint.copy(hit.point); else this.aimPoint.copy(_o).addScaledVector(_dir, 400);
    // never aim behind the eye
    const eye = this.eye(_t); if (this.aimPoint.clone().sub(eye).dot(_dir) < 0.5) this.aimPoint.copy(eye).addScaledVector(_dir, 2);
    return this.aimPoint;
  }
  updateCamera(dt, dead) {
    const w = this.weapon.def; const cam = this.camera; const m = this.match;
    const adsRate = 1 / Math.max(0.08, w.adsTime);
    this.adsBlend = damp(this.adsBlend, this.ads && this.alive ? 1 : 0, adsRate * 3.5, dt);
    const scoped = !!w.scope && this.adsBlend > 0.9;
    this.scopeOverlay = scoped;
    this.slideBlend = damp(this.slideBlend || 0, this.sliding ? 1 : 0, this.sliding ? 12 : 5, dt);
    const targetFov = lerp(this.fov, w.adsFov, this.adsBlend) + (this.sprint ? 5 : 0) + this.slideBlend * 9;
    this.curFov = damp(this.curFov, targetFov, 14, dt);
    if (Math.abs(cam.fov - this.curFov) > 0.05) { cam.fov = this.curFov; cam.updateProjectionMatrix(); }
    const eye = this.eye(new THREE.Vector3());
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const pitch = this.pitch + this.recoilP, yaw = this.yaw + this.recoilY;
    const fwd = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.camShake = damp(this.camShake, 0, 9, dt);
    if (dead) {
      // death cam: pull back and look at the body
      const pivot = new THREE.Vector3(this.body.pos.x, this.body.pos.y + 0.8, this.body.pos.z);
      const desired = pivot.clone().addScaledVector(fwd, -3.2).add(new THREE.Vector3(0, 1.6, 0));
      const toCam = desired.clone().sub(pivot); const dist = toCam.length();
      const hit = m.map.world.raycast(pivot, toCam.clone().divideScalar(dist), dist + 0.25); if (hit) desired.copy(pivot).addScaledVector(toCam.divideScalar(dist), Math.max(0.3, hit.t - 0.25));
      this.camPos.lerp(desired, 1 - Math.exp(-dt * 6));
      cam.position.copy(this.camPos); cam.lookAt(pivot);
      this.model.setVisible(true);
      this.view.update(dt, { dead: true });
      m.engine.updateSunTarget(this.body.pos);
      return;
    }
    this.model.setVisible(false);
    // lean: slide the eye sideways and roll the camera
    const leanOff = this.model.lean * 0.45;
    let desired = eye.clone().addScaledVector(right, leanOff);
    if (leanOff !== 0) { const hit = m.map.world.raycast(eye, right.clone().multiplyScalar(Math.sign(leanOff)), Math.abs(leanOff) + 0.2); if (hit) desired.copy(eye).addScaledVector(right, Math.sign(leanOff) * Math.max(0, hit.t - 0.2)); }
    if (this.snapCamera) { this.camPos.copy(desired); this.snapCamera = false; } else this.camPos.lerp(desired, 1 - Math.exp(-dt * 40));
    // head bob + shake
    const bobA = this.moving && this.body.onGround ? (this.sprint ? 0.045 : 0.018) * (1 - this.adsBlend * 0.8) : 0;
    const bob = new THREE.Vector3().addScaledVector(right, Math.cos(this.bobPhase) * bobA * 0.6).add(new THREE.Vector3(0, Math.abs(Math.sin(this.bobPhase)) * bobA, 0));
    const shake = new THREE.Vector3((this.rng.next() - 0.5), (this.rng.next() - 0.5), 0).multiplyScalar(this.camShake * 0.03);
    cam.position.copy(this.camPos).add(bob).add(shake);
    cam.lookAt(cam.position.clone().add(fwd));
    const crawlSway = this.body.prone && this.moving ? Math.sin(this.bobPhase * 0.5) * 0.025 : 0;
    cam.rotateZ(-this.model.lean * 0.1 + this.kickY * 0.5 + Math.cos(this.bobPhase) * bobA * 0.3 + this.slideBlend * 0.13 * (this.slideSide || 1) + crawlSway);
    cam.rotateX(this.kickP * 0.6);
    cam.updateMatrixWorld();
    const vc = m.engine.vmCamera; vc.position.copy(cam.position); vc.quaternion.copy(cam.quaternion); vc.updateMatrixWorld(true);
    this.view.update(dt, { ads: this.ads, sprint: this.sprint, moving: this.moving, speed: this.speed, onGround: this.body.onGround, reloading: this.reloading, reloadT: this.reloadT, reloadTime: w.reload, look: this.lastLook, bobPhase: this.bobPhase, dead: false, hidden: scoped, lean: this.model.lean, slide: this.sliding, crawl: this.body.prone && this.moving, prone: this.body.prone });
    m.engine.updateSunTarget(this.body.pos);
  }
}
