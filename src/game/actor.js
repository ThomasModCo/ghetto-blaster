// Actor: shared combat entity for the player and bots (health, weapons, equipment, hitboxes, status effects).
import * as THREE from 'three';
import { Body } from '../core/physics.js';
import { CharacterModel } from './character.js';
import { damageAtRange } from './weapons.js';
import { clamp } from '../core/rng.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Vector3();
export const MAX_HEALTH = 100;

export class Actor {
  constructor(match, { name, team = null, faction = 'gang', isPlayer = false, loadout, rng, accent = null, plastic = null }) {
    this.match = match; this.name = name; this.team = team; this.faction = faction; this.isPlayer = isPlayer; this.rng = rng;
    this.body = new Body(match.map.world);
    this.model = new CharacterModel({ faction, team: match.mode.teams ? team : null, accent, plastic: match.mode.teams ? null : plastic, rng });
    match.scene.add(this.model.group);
    this.health = MAX_HEALTH; this.maxHealth = MAX_HEALTH; this.armor = 0; this.alive = false; this.respawnT = 0; this.deadT = 0;
    this.kills = 0; this.deaths = 0; this.assists = 0; this.score = 0; this.streakScore = 0; this.bestStreak = 0; this.killStreak = 0; this.headshots = 0;
    this.pitch = 0; this.lean = 0; this.ads = false; this.sprint = false; this.moving = false; this.firing = false; this.speed = 0;
    this.weapons = []; this.cur = 0; this.reloadT = 0; this.reloading = false; this.fireCd = 0; this.burstLeft = 0; this.burstCd = 0; this.swapT = 0;
    this.lastShotT = -99; this.lastHitBy = null; this.lastHitT = -99; this.damageTakenFrom = new Map();
    this.fx = { flash: 0, stun: 0, speed: 0, jugg: 0, burn: 0, burnFrom: null, slow: 0, revealed: 0, knock: 0 };
    this.setLoadout(loadout);
    this.gunGameIndex = 0;
    this.hidden = false;
    this.spawnProtect = 0;
    this.lastDamageTime = -99;
  }
  setLoadout(lo) {
    this.loadout = lo;
    this.weapons = [lo.primary, lo.secondary].map((w) => ({ def: w, mag: w.mag, reserve: w.reserve }));
    this.cur = 0; this.reloading = false; this.reloadT = 0; this.fireCd = 0; this.burstLeft = 0;
    this.equip = { tactical: { def: lo.tactical, count: lo.tactical.count }, lethal: { def: lo.lethal, count: lo.lethal.count } };
    this.model.setGun(this.weapon.def);
  }
  setSingleWeapon(w) { // gun game
    this.weapons = [{ def: w, mag: w.mag, reserve: w.reserve * 2 }]; this.cur = 0; this.reloading = false; this.fireCd = 0; this.burstLeft = 0; this.model.setGun(w);
  }
  get weapon() { return this.weapons[this.cur]; }
  get pos() { return this.body.pos; }
  muzzleWorld(out) { return this.model.muzzleWorld(out); }
  eye(out = _v) { return out.set(this.body.pos.x, this.body.pos.y + this.body.eyeHeight(), this.body.pos.z); }
  chest(out = _v2) { return out.set(this.body.pos.x, this.body.pos.y + this.body.height * 0.55, this.body.pos.z); }
  forward(out = _q) { return out.set(Math.sin(this.body.yaw), 0, Math.cos(this.body.yaw)); }
  effectiveSpeedMult() { let m = this.weapon.def.speedMult; if (this.ads) m *= this.weapon.def.adsSpeedMult; if (this.body.crouch) m *= 0.55; if (this.body.prone) m *= 0.42; if (this.fx.speed > 0) m *= 1.25; if (this.fx.jugg > 0) m *= 0.8; if (this.fx.stun > 0 || this.fx.slow > 0) m *= 0.45; return m; }
  spawn(pos, yaw) {
    this.body.pos.set(pos.x, pos.y, pos.z); this.body.vel.set(0, 0, 0); this.body.yaw = yaw; this.pitch = 0; this.body.crouch = false; this.body.wantCrouch = false; this.body.prone = false; this.body.wantProne = false; this.body.stance = 'stand'; this.body.height = this.body.standHeight;
    this.health = this.maxHealth; this.armor = 0; this.alive = true; this.deadT = 0; this.respawnT = 0; this.killStreak = 0; this.streakScore = 0;
    for (const w of this.weapons) { w.mag = w.def.mag; w.reserve = w.def.reserve; }
    this.equip.tactical.count = this.equip.tactical.def.count; this.equip.lethal.count = this.equip.lethal.def.count;
    this.cur = 0; this.model.setGun(this.weapon.def); this.reloading = false; this.fireCd = 0; this.ads = false; this.sprint = false; this.lean = 0;
    for (const k of Object.keys(this.fx)) if (typeof this.fx[k] === 'number') this.fx[k] = 0;
    this.model.revive(); this.model.setVisible(!this.hidden); this.damageTakenFrom.clear(); this.spawnProtect = 2.0;
    this.onSpawn && this.onSpawn();
  }
  updateCommon(dt) {
    for (const k of ['flash', 'stun', 'speed', 'jugg', 'slow', 'revealed', 'knock']) if (this.fx[k] > 0) this.fx[k] -= dt;
    if (this.fx.jugg <= 0 && this.maxHealth > MAX_HEALTH) { this.maxHealth = MAX_HEALTH; this.health = Math.min(this.health, MAX_HEALTH); }
    if (this.fx.burn > 0) { this.fx.burn -= dt; if (this.alive) this.takeDamage(12 * dt, this.fx.burnFrom, 'burn', null, true); }
    if (this.spawnProtect > 0) this.spawnProtect -= dt;
    // health regen (COD style) after 4s without damage
    if (this.alive && this.match.time - this.lastDamageTime > 4 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 28 * dt);
    // weapon timers
    if (this.fireCd > 0) this.fireCd -= dt;
    if (this.swapT > 0) this.swapT -= dt;
    if (this.reloading) { this.reloadT += dt; const w = this.weapon; const rt = w.def.reload * (this.fx.speed > 0 ? 0.75 : 1); if (this.reloadT >= rt) { const need = w.def.mag - w.mag; const take = Math.min(need, w.reserve); w.mag += take; w.reserve -= take; this.reloading = false; this.reloadT = 0; } }
    if (this.burstLeft > 0) { this.burstCd -= dt; }
    // model
    this.model.group.position.copy(this.body.pos); this.model.group.rotation.y = this.body.yaw;
    this.model.update(dt, { speed: this.speed, moving: this.moving, sprint: this.sprint, crouch: this.body.crouch, ads: this.ads, onGround: this.body.onGround, pitch: this.pitch, lean: this.lean, dead: !this.alive, reloading: this.reloading, reloadT: this.reloadT, firing: this.firing && this.match.time - this.lastShotT < 0.08, jugg: this.fx.jugg > 0 });
    this.firing = false;
  }
  canFire() { const w = this.weapon; return this.alive && !this.reloading && this.swapT <= 0 && this.fireCd <= 0 && w.mag > 0 && this.fx.stun <= 0 && this.fx.knock <= 0; }
  startReload() { const w = this.weapon; if (!this.alive || this.reloading || w.mag >= w.def.mag || w.reserve <= 0) return false; this.reloading = true; this.reloadT = 0; this.burstLeft = 0; this.match.audio('reload', this); return true; }
  swapWeapon() { if (this.weapons.length < 2 || this.swapT > 0) return; this.cur = (this.cur + 1) % this.weapons.length; this.reloading = false; this.reloadT = 0; this.burstLeft = 0; this.swapT = this.weapon.def.swapTime * (this.fx.speed > 0 ? 0.75 : 1); this.fireCd = Math.max(this.fireCd, 0.1); this.model.setGun(this.weapon.def); this.match.audio('click', this); }
  /** Fire one shot (or one burst trigger) from origin toward dir. accuracyMult scales spread (bots use >1). Returns true if a shot was fired. */
  fire(origin, dir, trigger, accuracyMult = 1, forcedHit = null) {
    const w = this.weapon, d = w.def;
    if (this.burstLeft > 0 && this.burstCd <= 0) { this._shoot(origin, dir, accuracyMult, forcedHit); this.burstLeft--; this.burstCd = 60 / d.rpm; if (this.burstLeft === 0) this.fireCd = d.burstDelay; return true; }
    if (!trigger || !this.canFire()) return false;
    if (d.burst) { this.burstLeft = d.burst; this.burstCd = 0; return this.fire(origin, dir, true, accuracyMult, forcedHit); }
    this._shoot(origin, dir, accuracyMult, forcedHit);
    this.fireCd = 60 / d.rpm;
    return true;
  }
  _shoot(origin, dir, accuracyMult, forcedHit) {
    const w = this.weapon, d = w.def;
    w.mag--; this.lastShotT = this.match.time; this.firing = true;
    const moveFactor = this.moving ? d.spreadMove * clamp(this.speed / 6, 0, 1) : 0;
    let spread = (this.ads ? d.spreadAds : d.spreadHip) + moveFactor * (this.ads ? 0.3 : 1) + (this.body.onGround ? 0 : 1.5);
    spread *= accuracyMult * (this.body.prone ? 0.6 : this.body.crouch ? 0.8 : 1);
    const spreadRad = (spread * Math.PI) / 180;
    const muzzle = this.muzzleWorld(new THREE.Vector3());
    for (let p = 0; p < d.pellets; p++) {
      const sd = dir.clone();
      if (spreadRad > 0) { const a = this.rng.next() * Math.PI * 2, r = Math.sqrt(this.rng.next()) * spreadRad; const u = new THREE.Vector3().crossVectors(sd, Math.abs(sd.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize(); const v = new THREE.Vector3().crossVectors(sd, u); sd.addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).normalize(); }
      const hit = this.match.traceBullet(this, origin, sd, d.rangeMin * 4 + 50, p === 0 ? forcedHit : null);
      const endPoint = hit ? hit.point : origin.clone().addScaledVector(sd, 120);
      if (d.tracer && (p === 0 || d.pellets <= 2 || this.rng.chance(0.5))) this.match.fx.tracer(muzzle, endPoint);
      if (hit) {
        if (hit.actor) {
          const dist = hit.point.distanceTo(origin);
          let dmg = damageAtRange(d, dist) * (hit.part === 'head' ? d.headshot : 1);
          dmg *= this.match.director.damageMult(this, hit.actor);
          hit.actor.takeDamage(dmg, this, hit.part, hit.point);
          this.match.fx.impact(hit.point, sd.clone().negate(), 'blood', hit.actor.model.plastic);
          this.onHit && this.onHit(hit.actor, hit.part, dmg);
        } else {
          this.match.fx.impact(hit.point, hit.normal || new THREE.Vector3(0, 1, 0), 'concrete');
          if (this.rng.chance(0.3)) this.match.audio('ricochet', null, hit.point);
        }
      }
    }
    this.match.fx.muzzle(muzzle, dir, d.type === 'melee' ? 'none' : d.sound, { firstPerson: this.isPlayer });
    if (!d.suppressed || this.isPlayer) this.match.fx.casing(muzzle, new THREE.Vector3(-Math.cos(this.body.yaw), 0, Math.sin(this.body.yaw)));
    this.match.audio('shot', this, null, { kind: d.sound });
    this.match.onShot(this, d);
    if (w.mag === 0 && w.reserve > 0) this.autoReloadT = 0.25;
  }
  takeDamage(amount, attacker, part = 'body', point = null, silent = false) {
    if (!this.alive || amount <= 0) return 0;
    if (attacker && attacker !== this && this.match.sameTeam(attacker, this)) return 0;
    if (this.spawnProtect > 0 && attacker && attacker !== this && part !== 'burn') amount *= 0.35;
    if (this.armor > 0) { const a = Math.min(this.armor, amount * 0.7); this.armor -= a; amount -= a; }
    this.health -= amount; this.lastDamageTime = this.match.time;
    if (attacker && attacker !== this) { this.lastHitBy = attacker; this.lastHitT = this.match.time; this.damageTakenFrom.set(attacker, (this.damageTakenFrom.get(attacker) || 0) + amount); }
    if (!silent) { this.model.hit(); this.onDamaged && this.onDamaged(amount, attacker, point); }
    if (this.health <= 0) { this.health = 0; this.die(attacker, part); }
    return amount;
  }
  die(killer, part = 'body') {
    if (!this.alive) return;
    this.alive = false; this.deaths++; this.deadT = 0; this.respawnT = this.match.mode.respawn; this.ads = false; this.reloading = false; this.fx.burn = 0;
    const dir = killer && killer !== this ? (killer.pos.clone().sub(this.pos).dot(this.forward(new THREE.Vector3())) > 0 ? 1 : -1) : 1;
    this.model.die(dir);
    this.match.onDeath(this, killer, part);
    this.onDied && this.onDied(killer);
  }
  /** Ray test against head sphere + body box. Returns {t, part} or null. */
  hitTest(origin, dir, maxT) {
    if (!this.alive) return null;
    const p = this.body.pos; const h = this.body.height;
    // body: cylinder approximated by AABB in world (character is roughly symmetric)
    const r = 0.3;
    let tmin = -Infinity, tmax = Infinity;
    const mins = [p.x - r, p.y + 0.05, p.z - r], maxs = [p.x + r, p.y + h - 0.2, p.z + r];
    const o = [origin.x, origin.y, origin.z], dd = [dir.x, dir.y, dir.z];
    for (let i = 0; i < 3; i++) { const inv = 1 / dd[i]; let t0 = (mins[i] - o[i]) * inv, t1 = (maxs[i] - o[i]) * inv; if (t0 > t1) [t0, t1] = [t1, t0]; tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1); }
    let best = null;
    if (tmax >= Math.max(tmin, 0) && tmin < maxT) best = { t: Math.max(tmin, 0), part: 'body' };
    // head sphere
    const hc = new THREE.Vector3(p.x, p.y + h - 0.18, p.z); const hr = 0.17;
    const oc = origin.clone().sub(hc); const b = oc.dot(dir); const c = oc.dot(oc) - hr * hr; const disc = b * b - c;
    if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t >= 0 && t < maxT && (!best || t <= best.t + 0.05)) best = { t, part: 'head' }; }
    return best;
  }
  addScore(n, reason) { this.score += n; this.streakScore += n; this.onScore && this.onScore(n, reason); }
  dispose() { this.match.scene.remove(this.model.group); this.model.dispose(); }
}
