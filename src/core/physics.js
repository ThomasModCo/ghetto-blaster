// Simple, fast collision world: axis-aligned boxes in a uniform grid, plus capsule-ish actors.
import * as THREE from 'three';
import { clamp } from './rng.js';

export const GRAVITY = 22;
export const STEP_HEIGHT = 0.55;

export class Box {
  constructor(minX, minY, minZ, maxX, maxY, maxZ, tag = 'solid') {
    this.min = new THREE.Vector3(minX, minY, minZ);
    this.max = new THREE.Vector3(maxX, maxY, maxZ);
    this.tag = tag; // 'solid' | 'cover' | 'noclimb'
    this.walkable = true;
  }
  static fromCenter(x, y, z, w, h, d, tag) { return new Box(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, tag); }
}

export class World {
  constructor(size = 200, cell = 8) {
    this.size = size; this.cell = cell; this.n = Math.ceil(size / cell) + 2;
    this.grid = new Array(this.n * this.n).fill(null).map(() => []);
    this.boxes = [];
    this.bounds = { minX: -size / 2, maxX: size / 2, minZ: -size / 2, maxZ: size / 2 };
    this.groundY = 0;
  }
  _idx(x, z) {
    const gx = clamp(Math.floor((x + this.size / 2) / this.cell) + 1, 0, this.n - 1);
    const gz = clamp(Math.floor((z + this.size / 2) / this.cell) + 1, 0, this.n - 1);
    return gz * this.n + gx;
  }
  add(box) {
    this.boxes.push(box);
    const x0 = Math.floor((box.min.x + this.size / 2) / this.cell) + 1, x1 = Math.floor((box.max.x + this.size / 2) / this.cell) + 1;
    const z0 = Math.floor((box.min.z + this.size / 2) / this.cell) + 1, z1 = Math.floor((box.max.z + this.size / 2) / this.cell) + 1;
    for (let z = clamp(z0, 0, this.n - 1); z <= clamp(z1, 0, this.n - 1); z++)
      for (let x = clamp(x0, 0, this.n - 1); x <= clamp(x1, 0, this.n - 1); x++) this.grid[z * this.n + x].push(box);
    return box;
  }
  // iterate boxes near a point with radius
  near(x, z, r, cb) {
    const x0 = Math.floor((x - r + this.size / 2) / this.cell) + 1, x1 = Math.floor((x + r + this.size / 2) / this.cell) + 1;
    const z0 = Math.floor((z - r + this.size / 2) / this.cell) + 1, z1 = Math.floor((z + r + this.size / 2) / this.cell) + 1;
    const seen = this._seen || (this._seen = new Set()); seen.clear();
    for (let gz = clamp(z0, 0, this.n - 1); gz <= clamp(z1, 0, this.n - 1); gz++)
      for (let gx = clamp(x0, 0, this.n - 1); gx <= clamp(x1, 0, this.n - 1); gx++) {
        const cellArr = this.grid[gz * this.n + gx];
        for (let i = 0; i < cellArr.length; i++) { const b = cellArr[i]; if (seen.has(b)) continue; seen.add(b); if (cb(b) === false) return; }
      }
  }
  // Highest floor under point (x,z) with top <= y + step. Returns y of floor.
  floorAt(x, z, y, radius = 0.3, step = STEP_HEIGHT) {
    let best = this.groundY;
    this.near(x, z, radius, (b) => {
      if (!b.walkable) return;
      if (x + radius > b.min.x && x - radius < b.max.x && z + radius > b.min.z && z - radius < b.max.z) {
        if (b.max.y <= y + step && b.max.y > best && b.min.y < y + step) best = b.max.y;
      }
    });
    return best;
  }
  // Ceiling above the actor: lowest box bottom above y within radius
  ceilingAt(x, z, y, radius = 0.3) {
    let best = Infinity;
    this.near(x, z, radius, (b) => {
      if (x + radius > b.min.x && x - radius < b.max.x && z + radius > b.min.z && z - radius < b.max.z) {
        if (b.min.y >= y && b.min.y < best) best = b.min.y;
      }
    });
    return best;
  }
  // Push a vertical capsule (cylinder) out of boxes in XZ. pos is feet position. Returns true if collided.
  resolve(pos, radius, height, footY) {
    let hit = false;
    const y0 = footY + STEP_HEIGHT + 0.02, y1 = footY + height - 0.02; // ignore things we can step over
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.near(pos.x, pos.z, radius + 0.5, (b) => {
        if (b.max.y <= y0 || b.min.y >= y1) return;
        const cx = clamp(pos.x, b.min.x, b.max.x), cz = clamp(pos.z, b.min.z, b.max.z);
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) return;
        hit = true; moved = true;
        if (d2 < 1e-8) {
          // inside the box: push out along the smallest axis
          const l = pos.x - b.min.x, r = b.max.x - pos.x, t = pos.z - b.min.z, bt = b.max.z - pos.z;
          const m = Math.min(l, r, t, bt);
          if (m === l) pos.x = b.min.x - radius; else if (m === r) pos.x = b.max.x + radius; else if (m === t) pos.z = b.min.z - radius; else pos.z = b.max.z + radius;
        } else {
          const d = Math.sqrt(d2); const push = radius - d;
          pos.x += (dx / d) * push; pos.z += (dz / d) * push;
        }
      });
      if (!moved) break;
    }
    // world bounds
    const B = this.bounds, m = 0.6;
    if (pos.x < B.minX + m) { pos.x = B.minX + m; hit = true; }
    if (pos.x > B.maxX - m) { pos.x = B.maxX - m; hit = true; }
    if (pos.z < B.minZ + m) { pos.z = B.minZ + m; hit = true; }
    if (pos.z > B.maxZ - m) { pos.z = B.maxZ - m; hit = true; }
    return hit;
  }
  // Ray vs boxes. Returns {t, point, normal, box} or null. maxT in world units.
  raycast(origin, dir, maxT = 300, filter = null) {
    // DDA-ish: step through grid cells along the ray and test boxes (dedupe)
    let bestT = maxT, bestBox = null, bestN = null;
    const seen = this._rseen || (this._rseen = new Set()); seen.clear();
    const invX = 1 / dir.x, invY = 1 / dir.y, invZ = 1 / dir.z;
    const test = (b) => {
      if (seen.has(b)) return; seen.add(b);
      if (filter && !filter(b)) return;
      let tmin = (b.min.x - origin.x) * invX, tmax = (b.max.x - origin.x) * invX;
      if (tmin > tmax) [tmin, tmax] = [tmax, tmin];
      let tymin = (b.min.y - origin.y) * invY, tymax = (b.max.y - origin.y) * invY;
      if (tymin > tymax) [tymin, tymax] = [tymax, tymin];
      if (tmin > tymax || tymin > tmax) return;
      let axis = 0;
      if (tymin > tmin) { tmin = tymin; axis = 1; }
      if (tymax < tmax) tmax = tymax;
      let tzmin = (b.min.z - origin.z) * invZ, tzmax = (b.max.z - origin.z) * invZ;
      if (tzmin > tzmax) [tzmin, tzmax] = [tzmax, tzmin];
      if (tmin > tzmax || tzmin > tmax) return;
      if (tzmin > tmin) { tmin = tzmin; axis = 2; }
      if (tzmax < tmax) tmax = tzmax;
      if (tmax < 0 || tmin > bestT) return;
      const t = tmin < 0 ? 0 : tmin;
      if (t < bestT) {
        bestT = t; bestBox = b;
        bestN = axis === 0 ? new THREE.Vector3(-Math.sign(dir.x), 0, 0) : axis === 1 ? new THREE.Vector3(0, -Math.sign(dir.y), 0) : new THREE.Vector3(0, 0, -Math.sign(dir.z));
      }
    };
    // walk cells
    const cell = this.cell, half = this.size / 2;
    let x = origin.x, z = origin.z;
    const steps = Math.ceil(maxT / (cell * 0.5)) + 1;
    const sx = dir.x * cell * 0.5, sz = dir.z * cell * 0.5;
    for (let i = 0; i <= steps; i++) {
      const gx = Math.floor((x + half) / cell) + 1, gz = Math.floor((z + half) / cell) + 1;
      if (gx < 0 || gz < 0 || gx >= this.n || gz >= this.n) break;
      // visit this cell + neighbours (ray may clip corners)
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const cx = gx + dx, cz = gz + dz; if (cx < 0 || cz < 0 || cx >= this.n || cz >= this.n) continue;
        const arr = this.grid[cz * this.n + cx]; for (let k = 0; k < arr.length; k++) test(arr[k]);
      }
      if (i * cell * 0.5 > bestT) break;
      x += sx; z += sz;
    }
    // ground plane
    if (dir.y < 0) {
      const tg = (this.groundY - origin.y) / dir.y;
      if (tg > 0 && tg < bestT) { bestT = tg; bestBox = null; bestN = new THREE.Vector3(0, 1, 0); }
    }
    if (bestT >= maxT) return null;
    return { t: bestT, point: origin.clone().addScaledVector(dir, bestT), normal: bestN, box: bestBox };
  }
  // Line of sight between two points (true if clear)
  los(a, b, filter = null) {
    const d = new THREE.Vector3().subVectors(b, a); const len = d.length(); if (len < 1e-4) return true;
    d.divideScalar(len);
    return this.raycast(a, d, len - 0.01, filter) === null;
  }
}

// Shared character physics (player and bots use the same code so they move identically).
export class Body {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.radius = 0.36;
    this.standHeight = 1.8; this.crouchHeight = 1.25; this.proneHeight = 0.6;
    this.stance = 'stand'; this.prone = false; this.wantProne = false;
    this.height = 1.8;
    this.onGround = false;
    this.crouch = false;
    this.wantCrouch = false;
    this.yaw = 0;
    this.lastFloor = 0;
  }
  // moveDir: world-space XZ vector (not necessarily normalized), speed: target m/s
  step(dt, moveDir, speed, jump, accelGround = 14, accelAir = 3) {
    const w = this.world;
    // stance transitions: going down is instant, going up needs head room
    const H = { stand: this.standHeight, crouch: this.crouchHeight, prone: this.proneHeight };
    const want = this.wantProne ? 'prone' : this.wantCrouch ? 'crouch' : 'stand';
    if (want !== this.stance) {
      if (H[want] <= H[this.stance]) this.stance = want;
      else if (w.ceilingAt(this.pos.x, this.pos.z, this.pos.y + 0.1, this.radius) - this.pos.y > H[want] + 0.05) this.stance = want;
    }
    this.crouch = this.stance !== 'stand'; this.prone = this.stance === 'prone';
    const targetH = H[this.stance];
    const rate = this.prone || this.height < this.crouchHeight - 0.05 ? 6.5 : 14; // getting down to / up from prone takes longer
    this.height += (targetH - this.height) * Math.min(1, dt * rate);

    const tx = moveDir.x * speed, tz = moveDir.z * speed;
    const accel = this.onGround ? accelGround : accelAir;
    const k = Math.min(1, accel * dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;

    if (jump && this.onGround) { this.vel.y = 7.4; this.onGround = false; }
    this.vel.y -= GRAVITY * dt;
    if (this.vel.y < -40) this.vel.y = -40;

    // integrate XZ, resolve
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    const hit = w.resolve(this.pos, this.radius, this.height, this.pos.y);
    if (hit) { // kill velocity into walls softly
      // (approximation: damp; a precise approach would project along the normal)
      this.vel.x *= 0.6; this.vel.z *= 0.6;
    }
    // vertical
    this.pos.y += this.vel.y * dt;
    const floor = w.floorAt(this.pos.x, this.pos.z, this.pos.y, this.radius * 0.8, this.onGround ? STEP_HEIGHT : 0.12);
    if (this.pos.y <= floor) { this.pos.y = floor; if (this.vel.y < 0) this.vel.y = 0; this.onGround = true; this.lastFloor = floor; }
    else if (this.pos.y - floor < 0.05 && this.vel.y <= 0) { this.pos.y = floor; this.vel.y = 0; this.onGround = true; }
    else this.onGround = false;
    const ceil = w.ceilingAt(this.pos.x, this.pos.z, this.pos.y + 0.3, this.radius * 0.8);
    if (ceil < this.pos.y + this.height) { this.pos.y = ceil - this.height; if (this.vel.y > 0) this.vel.y = 0; }
  }
  eyeHeight() { return this.height - 0.15; }
}
