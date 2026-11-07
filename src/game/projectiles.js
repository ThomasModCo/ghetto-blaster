// Thrown and placed equipment: physics, fuses, detonation effects.
import * as THREE from 'three';
import { buildThrowableMesh } from './character.js';
import { GRAVITY } from '../core/physics.js';

export class Projectiles {
  constructor(match) { this.m = match; this.list = []; this.placed = []; this.decoys = []; this.fires = []; }
  throwFrom(actor, def, kind, targetPos = null) {
    const m = this.m;
    const eye = actor.eye(new THREE.Vector3());
    let dir;
    if (actor.isPlayer) { actor.computeAim(); dir = actor.aimPoint.clone().sub(eye).normalize(); }
    else { const tp = targetPos || actor.pos.clone().addScaledVector(actor.forward(new THREE.Vector3()), 10); dir = tp.clone().sub(eye); const dist = dir.length(); dir.normalize(); dir.y += Math.min(0.6, dist / 40); dir.normalize(); }
    if (def.placed) { // claymore: place in front on the ground
      const p = actor.pos.clone().addScaledVector(actor.forward(new THREE.Vector3()), 1.2); const floor = m.map.world.floorAt(p.x, p.z, actor.pos.y + 0.5, 0.2, 2); p.y = floor + 0.15;
      const mesh = buildThrowableMesh(def, actor.model.plastic); mesh.position.copy(p); mesh.rotation.y = actor.body.yaw; m.scene.add(mesh);
      this.placed.push({ def, kind, owner: actor, mesh, pos: p, yaw: actor.body.yaw, armT: 1.2, team: actor.team });
      m.audio('click', actor); return;
    }
    const mesh = buildThrowableMesh(def, actor.model.plastic); mesh.position.copy(eye).addScaledVector(dir, 0.5); m.scene.add(mesh);
    const vel = dir.clone().multiplyScalar(def.throwSpeed).add(new THREE.Vector3(actor.body.vel.x * 0.5, 0, actor.body.vel.z * 0.5));
    this.list.push({ def, kind, owner: actor, mesh, pos: mesh.position.clone(), vel, fuse: def.fuse, stuck: false, spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, 0), team: actor.team, cooked: 0 });
    m.audio('whoosh', actor);
  }
  update(dt) {
    const m = this.m, w = m.map.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]; const d = p.def;
      if (!p.stuck) {
        p.vel.y -= GRAVITY * dt;
        const step = p.vel.clone().multiplyScalar(dt); const len = step.length();
        let hitSomething = false;
        if (len > 0) {
          const dir = step.clone().divideScalar(len);
          // actors (impact weapons kill on hit)
          if (d.impact || d.sticky) { for (const a of m.actors) { if (a === p.owner || !a.alive) continue; const h = a.hitTest(p.pos, dir, len + 0.3); if (h) { if (d.impact) { a.takeDamage(d.damage * m.director.damageMult(p.owner, a), p.owner, 'head', p.pos); m.fx.blood(p.pos, a.model.plastic); if (!d.burn) { this._remove(i, p); hitSomething = true; break; } } else { p.stuck = true; p.stuckTo = a; p.stuckOff = p.pos.clone().sub(a.pos); hitSomething = true; break; } } } if (hitSomething && !this.list.includes(p)) continue; }
          if (hitSomething) continue;
          const hit = w.raycast(p.pos, dir, len + 0.15);
          if (hit) {
            if (d.impact) { this.detonate(p, hit.point); this._remove(i, p); continue; }
            if (d.sticky) { p.stuck = true; p.pos.copy(hit.point).addScaledVector(hit.normal, 0.05); p.vel.set(0, 0, 0); }
            else { // bounce
              p.pos.copy(hit.point).addScaledVector(hit.normal, 0.08);
              const vn = hit.normal.clone().multiplyScalar(p.vel.dot(hit.normal)); p.vel.sub(vn.multiplyScalar(1 + (d.bounce || 0.3))); p.vel.multiplyScalar(0.6);
              if (p.vel.length() < 1.5 && hit.normal.y > 0.5) p.vel.set(0, 0, 0);
              if (p.vel.length() > 2) m.audio('click', null, p.pos, { vol: 0.4 });
            }
          } else p.pos.add(step);
        }
        if (p.pos.y < 0.06) { p.pos.y = 0.06; p.vel.y = Math.abs(p.vel.y) * (d.bounce || 0.3); p.vel.x *= 0.7; p.vel.z *= 0.7; if (Math.abs(p.vel.y) < 1) p.vel.y = 0; }
      } else if (p.stuckTo) { p.pos.copy(p.stuckTo.pos).add(p.stuckOff); }
      p.mesh.position.copy(p.pos); if (!p.stuck) { p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.y += p.spin.y * dt; }
      p.fuse -= dt;
      if (p.fuse <= 0) { this.detonate(p, p.pos); this._remove(i, p); }
    }
    // claymores
    for (let i = this.placed.length - 1; i >= 0; i--) {
      const c = this.placed[i]; if (!c) continue; if (c.armT > 0) { c.armT -= dt; continue; }
      const fwd = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
      let trig = false;
      for (const a of m.actors) { if (!a.alive || a === c.owner || m.sameTeam(a, c.owner)) continue; const d = a.pos.clone().sub(c.pos); const dist = d.length(); if (dist < c.def.triggerRange && d.normalize().dot(fwd) > 0.3) { trig = true; break; } }
      // destroyed by explosions nearby handled in explode()
      if (trig) { this.explode(c.pos, c.def.radius, c.def.damage, c.owner, c.def); m.scene.remove(c.mesh); this.placed.splice(i, 1); }
    }
    // decoys (fake gunfire)
    for (let i = this.decoys.length - 1; i >= 0; i--) { const d = this.decoys[i]; d.t -= dt; d.shotT -= dt; if (d.shotT <= 0) { d.shotT = 0.1 + Math.random() * 0.5; m.audio('shot', null, d.pos, { kind: 'ar', vol: 0.7 }); m.fx.muzzle(d.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(1, 0, 0), 'ar'); for (const b of m.bots) if (b.alive && !m.sameTeam(b, d.owner) && b.pos.distanceTo(d.pos) < d.def.radius * 2.5) b.hearShot(null, d.pos); } if (d.t <= 0) { if (d.mesh) m.scene.remove(d.mesh); this.decoys.splice(i, 1); } }
    // fires (molotov)
    for (let i = this.fires.length - 1; i >= 0; i--) { const f = this.fires[i]; f.t -= dt; f.sparkT -= dt; if (f.sparkT <= 0) { f.sparkT = 0.05; for (let k = 0; k < 3; k++) m.fx.sparkTrail(f.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * f.r * 1.6, 0.1, (Math.random() - 0.5) * f.r * 1.6))); } for (const a of m.actors) { if (!a.alive) continue; if (a.pos.distanceTo(f.pos) < f.r && a.pos.y < f.pos.y + 1.5) { if (a.fx.burn <= 0.5) { a.fx.burn = 2.0; a.fx.burnFrom = f.owner; } } } if (f.t <= 0) { if (f.light) { f.light.life = 0; f.light.l.intensity = 0; } this.fires.splice(i, 1); } }
  }
  _remove(i, p) { this.m.scene.remove(p.mesh); const idx = this.list.indexOf(p); if (idx >= 0) this.list.splice(idx, 1); }
  detonate(p, at) {
    const m = this.m, d = p.def;
    if (p.kind === 'tactical') {
      if (d.id === 'smoke') { m.fx.smoke(at.clone(), d.radius, 14); m.audio('whoosh', null, at); }
      else if (d.id === 'flashbang' || d.id === 'stun') { m.fx.explosion(at.clone().add(new THREE.Vector3(0, 0.3, 0)), 1.5); m.audio('explosion', null, at, { vol: 0.5 }); for (const a of m.actors) { if (!a.alive) continue; const dist = a.pos.distanceTo(at); if (dist > d.radius) continue; if (m.sameTeam(a, p.owner) && a !== p.owner) continue; const eye = a.eye(new THREE.Vector3()); if (!m.map.world.los(eye, at.clone().add(new THREE.Vector3(0, 0.3, 0)))) continue; const k = 1 - dist / d.radius; if (d.id === 'flashbang') { const facing = a.forward(new THREE.Vector3()).dot(at.clone().sub(a.pos).normalize()); a.fx.flash = Math.max(a.fx.flash, (facing > 0 ? 3.5 : 1.5) * (0.4 + k)); if (a.isPlayer) m.audio('flash'); } else { a.fx.stun = Math.max(a.fx.stun, 1.5 + k * 2); a.fx.slow = a.fx.stun; } } }
      else if (d.id === 'decoy') { this.decoys.push({ pos: at.clone(), t: d.duration, shotT: 0, owner: p.owner, def: d }); }
      return;
    }
    if (d.burn) { m.fx.explosion(at.clone(), 2); m.audio('explosion', null, at, { vol: 0.6 }); const light = m.fx.light(at.clone().add(new THREE.Vector3(0, 0.6, 0)), 0xff7020, 12, 10, d.burn, false); this.fires.push({ pos: at.clone(), r: d.radius, t: d.burn, owner: p.owner, sparkT: 0, light }); return; }
    this.explode(at, d.radius, d.damage, p.owner, d);
  }
  explode(at, radius, damage, owner, def) {
    const m = this.m;
    m.fx.explosion(at.clone(), radius); m.audio('explosion', null, at);
    for (const a of m.actors) {
      if (!a.alive) continue;
      const c = a.chest(new THREE.Vector3()); const dist = c.distanceTo(at); if (dist > radius) continue;
      if (!m.map.world.los(at.clone().add(new THREE.Vector3(0, 0.4, 0)), c) && dist > 1.5) continue;
      const k = 1 - dist / radius; const dmg = damage * (0.3 + 0.7 * k) * m.director.damageMult(owner, a);
      a.takeDamage(dmg, owner, 'explosion', at);
      if (a.alive) { a.fx.knock = Math.max(a.fx.knock, 0.4); if (a.isPlayer) a.camShake = 1; }
    }
    // chain / destroy claymores nearby
    for (let i = this.placed.length - 1; i >= 0; i--) if (this.placed[i].pos.distanceTo(at) < radius) { m.scene.remove(this.placed[i].mesh); this.placed.splice(i, 1); }
    m.onExplosion && m.onExplosion(at, owner);
  }
  clear() { for (const p of this.list) this.m.scene.remove(p.mesh); for (const c of this.placed) this.m.scene.remove(c.mesh); for (const f of this.fires) if (f.light) { f.light.life = 0; f.light.l.intensity = 0; } this.list.length = 0; this.placed.length = 0; for (const d of this.decoys) if (d.mesh) this.m.scene.remove(d.mesh); this.decoys.length = 0; this.fires.length = 0; }
}
