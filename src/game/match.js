// Match orchestrator: actors, spawning, bullets, scoring, streak effects, mode rules, audio.
import * as THREE from 'three';
import { RNG, hashString, clamp } from '../core/rng.js';
import { Player } from './player.js';
import { Bot } from './bot.js';
import { Director } from './director.js';
import { Projectiles } from './projectiles.js';
import { WEAPONS, GUN_GAME_ORDER } from './weapons.js';
import { resolveLoadout, randomLoadout } from './loadouts.js';
import { pickNames, FACTIONS } from './names.js';
import { sfx } from '../audio/sfx.js';
import { buildGunMesh, FFA_COLORS } from './character.js';
import { unitMesh } from './models.js';

const _v = new THREE.Vector3(), _r = new THREE.Vector3();
const BITE = { id: 'bite', name: 'BITE', type: 'melee', slot: 'primary', damage: 55, rpm: 110, mag: 9999, reserve: 0, reload: 1, rangeFull: 2.2, rangeMin: 2.6, minDamage: 0, auto: true, pellets: 1, headshot: 1, adsTime: 0.1, adsFov: 70, speedMult: 1.5, adsSpeedMult: 1, spreadHip: 4, spreadAds: 4, spreadMove: 0, recoilV: 0, recoilH: 0, recoilRecover: 10, sound: 'none', suppressed: true, swapTime: 0.1, tracer: false, model: { len: 0.01, h: 0.01, barrel: 0, mag: 0, stock: 0, pistol: true, color: '#000' } };
const NO_TACTICAL = { id: 'none', name: 'NONE', count: 0, passive: false };
const NO_LETHAL = { id: 'none', name: 'NONE', count: 0, passive: false };
const SENTRY = { ...WEAPONS.ratchet, id: 'sentry', name: 'SENTRY', mag: 9999, reserve: 0, speedMult: 0 };

export class Match {
  constructor({ engine, input, map, mode, settings, seed, loadout, mapId, cinematic = false, bet = 0, playerName = 'YOU' }) {
    this.engine = engine; this.scene = engine.scene; this.camera = engine.camera; this.fx = engine.fx; this.input = input;
    this.map = map; this.mode = mode; this.settings = settings; this.mapId = mapId; this.cinematic = cinematic; this.bet = bet;
    this.seed = seed; this.rng = new RNG(seed ^ 0x9e3779b9);
    this.scene.add(map.group); map.group.traverse((o) => { if (o.userData.kit) o.visible = engine.quality !== 'low'; }); // playset window surrounds: off on low quality
    this.actors = []; this.bots = []; this.player = null; this.crew = [];
    this.time = 0; this.elapsed = 0; this.state = 'pregame'; this.pregameT = cinematic ? 0 : 7; this.frozen = !cinematic;
    this.teamScore = [0, 0]; this.feed = []; this.events = {};
    this.projectiles = new Projectiles(this);
    this.director = new Director(this, seed);
    this.streakState = { active: [], picks: [null, null, null], used: [false, false, false] };
    this.radar = { t: 0, sweep: false, sweepT: 0, jam: 0, intel: 0, intelT: 0, pings: [] };
    this.sentries = []; this.heli = null; this.cars = []; this.mortars = []; this.timed = [];
    this.endResult = null; this.playerName = playerName;
    this.ended = false;
    this._setupActors(loadout);
    this.director.plan_();
  }
  // ---------------- setup ----------------
  _setupActors(loadout) {
    const mode = this.mode, def = this.map.def, rng = this.rng;
    const teamSize = def.teams?.tdm || 5, ffaSize = def.teams?.ffa || 8;
    const n = mode.teams ? teamSize * 2 : ffaSize;
    const names = pickNames(rng, n);
    if (!this.cinematic) {
      const pTeam = mode.teams ? rng.int(0, 1) : null;
      this.player = new Player(this, { name: this.playerName, team: pTeam, faction: 'gang', loadout: resolveLoadout(loadout), rng: new RNG(this.seed + 1), accent: null, plastic: FFA_COLORS[0] });
      this.actors.push(this.player);
    }
    const botCount = this.cinematic ? n : n - 1;
    for (let i = 0; i < botCount; i++) {
      let team = null;
      if (mode.teams) { const counts = [0, 0]; for (const a of this.actors) if (a.team !== null) counts[a.team]++; team = counts[0] <= counts[1] ? 0 : 1; if (counts[0] >= teamSize) team = 1; if (counts[1] >= teamSize) team = 0; }
      const b = new Bot(this, { name: names[i], team, faction: rng.pick(FACTIONS), loadout: resolveLoadout(randomLoadout(rng)), rng: new RNG(this.seed + 100 + i), skill: rng.float(0.3, 0.95), plastic: FFA_COLORS[(i + (this.cinematic ? 0 : 1)) % FFA_COLORS.length] });
      b.level = rng.int(3, 120); b.ping = rng.int(18, 95);
      this.actors.push(b); this.bots.push(b);
    }
    if (mode.id === 'gungame') for (const a of this.actors) { // no loadouts in gun game: same starting pistol, no equipment
      a.gunGameIndex = 0; a.setSingleWeapon(WEAPONS[GUN_GAME_ORDER[0]]);
      a.equip = { tactical: { def: NO_TACTICAL, count: 0 }, lethal: { def: NO_LETHAL, count: 0 } };
    }
    // initial spawns
    for (const a of this.actors) this.spawnActor(a, true);
    if (this.player) this.player.frozen = true;
  }
  sameTeam(a, b) {
    if (a === b) return true;
    if (this.mode.teams) return a.team === b.team;
    return (a.ally && a.ally === b) || (b.ally && b.ally === a) || (a.ally && a.ally === b.ally);
  }
  enemiesOf(a) { return this.actors.filter((x) => x !== a && !this.sameTeam(x, a)); }
  // ---------------- spawning ----------------
  spawnActor(a, initial = false) {
    const spawns = this.mode.teams && a.team !== null ? this.map.spawns[a.team] : this.map.spawns.all;
    const enemies = this.enemiesOf(a).filter((e) => e.alive);
    let best = null, bestScore = -Infinity;
    for (const s of spawns) {
      let minD = 999; for (const e of enemies) minD = Math.min(minD, Math.hypot(e.pos.x - s.x, e.pos.z - s.z));
      let occupied = false; for (const o of this.actors) if (o !== a && o.alive && Math.hypot(o.pos.x - s.x, o.pos.z - s.z) < 2) occupied = true;
      let visible = false; if (!initial && minD < 40) { const p = new THREE.Vector3(s.x, (s.y || 0) + 1.5, s.z); for (const e of enemies) if (e.pos.distanceTo(p) < 40 && this.map.world.los(e.eye(new THREE.Vector3()), p)) { visible = true; break; } }
      const score = Math.min(minD, 45) + this.rng.float(0, 12) - (occupied ? 50 : 0) - (visible ? 30 : 0);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (!best) best = spawns[0];
    a.spawn({ x: best.x, y: best.y || 0, z: best.z }, best.yaw + this.rng.float(-0.3, 0.3));
  }
  // ---------------- bullets ----------------
  /** Trace a bullet: nearest of world and actor hits. forAim ignores the shooter and passes through smoke. */
  traceBullet(shooter, origin, dir, maxDist, forcedHit = null, forAim = false) {
    let best = null;
    const wh = this.map.world.raycast(origin, dir, maxDist);
    if (wh) best = { t: wh.t, point: wh.point, normal: wh.normal, actor: null };
    const maxT = best ? best.t : maxDist;
    if (forcedHit && forcedHit.alive) { const p = forcedHit.chest(new THREE.Vector3()); const t = p.distanceTo(origin); if (t < maxT + 0.5) return { t, point: p, actor: forcedHit, part: 'body' }; }
    for (const a of this.actors) {
      if (a === shooter || !a.alive) continue;
      if (!forAim && shooter && this.sameTeam(a, shooter)) continue; // no friendly fire
      const h = a.hitTest(origin, dir, maxT);
      if (h && (!best || h.t < best.t)) best = { t: h.t, point: origin.clone().addScaledVector(dir, h.t), actor: a, part: h.part };
    }
    return best;
  }
  onShot(actor, def) {
    if (def.suppressed || def.type === 'melee') return;
    for (const b of this.bots) if (b !== actor && b.alive && b.pos.distanceTo(actor.pos) < 45) b.hearShot(actor, actor.pos);
    if (!this.sameTeam(actor, this.player || actor) && this.player) this.radar.pings.push({ pos: actor.pos.clone(), t: 1.2 });
  }
  // ---------------- deaths & scoring ----------------
  onDeath(victim, killer, part) {
    const credit = killer && killer.owner ? killer.owner : killer;
    const weaponName = killer ? (killer.owner ? (killer.isDog ? 'PITBULL' : killer.isSentry ? 'SENTRY' : 'CREW') : part === 'explosion' ? 'EXPLOSIVE' : part === 'burn' ? 'FIRE' : killer.weapon.def.name) : 'SUICIDE';
    if (credit && credit !== victim && !this.sameTeam(credit, victim)) {
      credit.kills++; credit.killStreak++; credit.bestStreak = Math.max(credit.bestStreak, credit.killStreak);
      if (part === 'head') credit.headshots++;
      credit.addScore(100 + (part === 'head' ? 25 : 0), 'kill');
      if (this.mode.teams && credit.team !== null) this.teamScore[credit.team]++;
      // assists
      for (const [a, dmg] of victim.damageTakenFrom) if (a !== credit && a.alive !== undefined && dmg >= 20 && !this.sameTeam(a, victim)) { a.assists++; a.addScore(25, 'assist'); if (a.isPlayer) this.emit('assist', { victim }); }
      if (this.mode.id === 'gungame' && !killer?.owner) { credit.gunGameIndex++; if (credit.gunGameIndex < this.mode.gunCount) { credit.setSingleWeapon(WEAPONS[GUN_GAME_ORDER[credit.gunGameIndex]]); if (credit.isPlayer) this.message(`NEXT GUN: ${WEAPONS[GUN_GAME_ORDER[credit.gunGameIndex]].name}`, 1.4); } }
      if (credit.isPlayer) { this.emit('kill', { victim, part }); if (credit.killStreak === 3) this.message('TRIPLE KILL', 1.5); else if (credit.killStreak === 5) this.message('ON A RAMPAGE', 1.5); else if (credit.killStreak === 10) this.message('UNSTOPPABLE', 1.8); }
    }
    if (victim.isPlayer) { this.emit('death', { killer: credit, weaponName }); }
    this.feed.unshift({ k: credit && credit !== victim ? credit : null, v: victim, w: weaponName, t: 6, head: part === 'head' });
    if (this.feed.length > 6) this.feed.pop();
    if (victim.isCrew) { victim.despawnT = 0.1; }
    this.checkEnd();
  }
  message(text, dur = 1.5) { this.emit('message', { text, dur }); }
  emit(name, data) { const h = this.events[name]; if (h) h(data); }
  // ---------------- equipment & streaks ----------------
  throwEquipment(actor, kind, targetPos = null) {
    const e = actor.equip[kind]; if (!actor.alive || e.count <= 0 || this.frozen) return;
    if (e.def.passive) return;
    e.count--; this.projectiles.throwFrom(actor, e.def, kind, targetPos);
  }
  modsFor(actor) { // streak-driven debuffs on enemies of the player
    const m = { acc: 1, react: 1, incoming: 1 };
    if (this.player && !this.sameTeam(actor, this.player)) { if (this.emp > 0) { m.acc *= 0.4; m.react *= 2; } }
    return m;
  }
  useStreak(player, slot) {
    const s = this.streakState; const def = s.picks[slot]; if (!def || s.used[slot] || !player.alive || this.frozen) return;
    if (player.streakScore < def.cost) return;
    s.used[slot] = true; this.applyStreak(def, player); sfx('streak'); this.emit('streak', { def }); this.message(def.name, 1.6);
  }
  applyStreak(def, p) {
    const P = def.params || {}; const enemies = () => this.enemiesOf(p).filter((e) => e.alive);
    switch (def.effect) {
      case 'radar': this.radar.t = Math.max(this.radar.t, P.duration); this.radar.sweep = !!P.sweep; break;
      case 'counter_radar': this.radar.jam = Math.max(this.radar.jam, P.duration); break;
      case 'intel': this.radar.intel = Math.max(this.radar.intel, P.duration); break;
      case 'armor': p.armor += P.amount; break;
      case 'ammo': for (const w of p.weapons) { w.mag = w.def.mag; w.reserve = w.def.reserve; } p.equip.tactical.count = p.equip.tactical.def.count; p.equip.lethal.count = p.equip.lethal.def.count; break;
      case 'speed': p.fx.speed = Math.max(p.fx.speed, P.duration); break;
      case 'juggernaut': p.maxHealth = 300; p.health = 300; p.fx.jugg = P.duration; break;
      case 'emp': this.emp = P.duration; for (const e of enemies()) { e.fx.flash = Math.max(e.fx.flash, 1.5); if (P.dark) e.fx.flash = 4; } break;
      case 'crew': for (let i = 0; i < P.count; i++) this.spawnCrew(p, P.skin || 'gang', P.duration, false); break;
      case 'dog': for (let i = 0; i < (P.count || 1); i++) this.spawnCrew(p, def.id === 'nola_gator' ? 'gator' : 'dog', P.duration, true); break;
      case 'turret': this.spawnSentry(p, P.duration); break;
      case 'mortar': this.mortars.push({ owner: p, t: P.duration, interval: P.interval, next: 0.5, fire: !!P.fire }); break;
      case 'driveby': this.driveBy(p, !!P.heavy); break;
      case 'heli': this.spawnHeli(p, P.duration); break;
      case 'hitman': this.timed.push({ owner: p, t: P.duration, interval: P.interval, next: 1.0, kind: 'hitman' }); break;
      case 'wipe': this.timed.push({ owner: p, t: P.delay || 0.8, kind: 'wipe' }); break;
      case 'quake': for (const e of enemies()) { e.fx.knock = Math.max(e.fx.knock, P.duration); } p.camShake = 1; this.quakeT = P.duration; sfx('bass'); if (P.fire) for (const e of enemies()) { e.fx.burn = 3; e.fx.burnFrom = p; } break;
      case 'decoy': { p.computeAim(); const d = { pos: p.aimPoint.clone(), t: P.duration, shotT: 0, owner: p, def: { radius: 14 } };
        const band = def.id === 'nola_brass' ? unitMesh('brass', p.model.plastic) : null; // the second line, molded in the caller's colour (visual only)
        if (band) { const g = this.map.nav.nearestWalkable(d.pos.x, d.pos.z, 4, d.pos.y) || d.pos; band.position.set(g.x, g.y || 0, g.z); band.rotation.y = Math.atan2(p.pos.x - g.x, p.pos.z - g.z); this.scene.add(band); d.mesh = band; }
        this.projectiles.decoys.push(d); break; }
      default: break;
    }
  }
  spawnCrew(owner, skin, duration, isDog) {
    const lo = isDog ? { primary: BITE, secondary: BITE, tactical: { id: 'none', name: '', count: 0, passive: true }, lethal: { id: 'none', name: '', count: 0, passive: true } } : resolveLoadout(randomLoadout(this.rng));
    const b = new Bot(this, { name: isDog ? (skin === 'gator' ? 'GATOR' : 'PITBULL') : (skin === 'cop' ? 'OFFICER' : skin === 'sicario' ? 'COLECTIVO' : 'HOMIE'), team: owner.team, faction: isDog ? 'dog' : skin, loadout: lo, rng: new RNG(this.rng.int(1, 1e9)), skill: isDog ? 0.9 : 0.75, persona: 'rusher', accent: owner.model.accent, plastic: owner.model.plastic });
    b.owner = owner; b.isCrew = true; b.isDog = isDog; b.ally = this.mode.teams ? null : owner; b.despawnT = duration; b.aggro = 1; b.level = 0; b.ping = 0;
    if (isDog) b.model.makeDog(skin === 'gator');
    this.actors.push(b); this.bots.push(b); this.crew.push(b);
    const p = this.map.nav.randomPointNear(this.rng, owner.pos.x, owner.pos.z, 6, 12, owner.pos.y) || owner.pos;
    b.spawn({ x: p.x, y: p.y, z: p.z }, owner.body.yaw);
    if (isDog) sfx('dog'); else sfx(skin === 'cop' ? 'siren' : 'engine');
    this.director.mult.set(b, { dmg: 1.2, incoming: 1, acc: 1.2, react: 0.7, attract: 0 });
  }
  spawnSentry(owner, duration) {
    const b = new Bot(this, { name: 'SENTRY', team: owner.team, faction: 'sicario', loadout: { primary: SENTRY, secondary: SENTRY, tactical: { id: 'none', name: '', count: 0, passive: true }, lethal: { id: 'none', name: '', count: 0, passive: true } }, rng: new RNG(this.rng.int(1, 1e9)), skill: 0.85, persona: 'camper', accent: owner.model.accent });
    b.owner = owner; b.isCrew = true; b.isSentry = true; b.stationary = true; b.ally = this.mode.teams ? null : owner; b.despawnT = duration; b.level = 0; b.ping = 0;
    this.actors.push(b); this.bots.push(b); this.crew.push(b);
    const fwd = owner.forward(new THREE.Vector3()); const p = this.map.nav.nearestWalkable(owner.pos.x + fwd.x * 1.5, owner.pos.z + fwd.z * 1.5, 3, owner.pos.y) || owner.pos;
    b.spawn({ x: p.x, y: p.y, z: p.z }, owner.body.yaw); b.body.wantCrouch = true;
    const nest = unitMesh('nest'); if (nest) { nest.position.z = 0.5; nest.scale.setScalar(1.15); b.model.group.add(nest); } // sandbag nest, turns with the gunner (visual only)
  }
  driveBy(owner, heavy) {
    owner.computeAim(); const target = owner.aimPoint.clone(); const dir = target.clone().sub(owner.pos).setY(0).normalize();
    const start = owner.pos.clone().addScaledVector(dir, -10).setY(0); const end = owner.pos.clone().addScaledVector(dir, 70).setY(0);
    const mesh = unitMesh(heavy ? 'lowrider' : 'driveby', owner.model.plastic) || makeCarMesh(heavy ? '#1a1a1a' : '#8c1c1c'); this.scene.add(mesh);
    this.cars.push({ owner, mesh, pos: start, dir, t: 0, dur: 4.5, end, heavy, shotT: 0 });
    sfx('engine');
  }
  spawnHeli(owner, duration) {
    const g = new THREE.Group(); let rotor;
    const toy = unitMesh('heli');
    if (toy) { // generated police helicopter (molded without blades) + a spinning two-blade rotor on its mast
      toy.geometry.computeBoundingBox(); const bb = toy.geometry.boundingBox; toy.position.y = -(bb.max.y - bb.min.y) * 0.45; g.add(toy);
      rotor = new THREE.Group(); rotor.position.set((bb.min.x + bb.max.x) / 2, toy.position.y + bb.max.y + 0.05, (bb.min.z + bb.max.z) / 2 + (bb.max.z - bb.min.z) * 0.08);
      const bm = new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.45 }), span = (bb.max.z - bb.min.z) * 1.05;
      for (const r of [0, Math.PI / 2]) { const b = new THREE.Mesh(new THREE.BoxGeometry(span, 0.06, 0.42), bm); b.rotation.y = r; rotor.add(b); }
      g.add(rotor);
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 7), new THREE.MeshStandardMaterial({ color: '#1a2a3a', roughness: 0.5 })); body.castShadow = true; g.add(body);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 5), body.material); tail.position.set(0, 0.4, -5.5); g.add(tail);
      rotor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: '#111' })); rotor.position.y = 1.2; g.add(rotor);
    }
    this.scene.add(g); this.fx.spot.intensity = 300; this.heli = { owner, mesh: g, rotor, t: duration, ang: 0, shotT: 0, soundT: 0 }; sfx('heli');
  }
  // ---------------- update ----------------
  update(dt) {
    if (this.ended) { for (const a of this.actors) { if (a.isPlayer) a.update(dt, this.input.poll()); else a.update(dt); } this.fx && this.cleanFeed(dt); return; }
    this.time += dt;
    if (this.state === 'pregame') { this.pregameT -= dt; if (this.pregameT <= 0) this.goLive(); }
    else if (this.state === 'live') { this.elapsed += dt; if (this.elapsed >= this.mode.timeLimit) { this.elapsed = this.mode.timeLimit; this.director.update(dt); this.endMatch(); return; } }
    const inp = this.input.poll();
    if (this.player) {
      this.player.update(dt, inp);
      if (inp.pressed.has('score')) this.emit('scoreboard', true); if (inp.pressed.has('scoreUp')) this.emit('scoreboard', false);
      if (inp.pressed.has('loadout') && this.state === 'pregame') this.emit('openLoadout');
      if (inp.pressed.has('esc')) this.emit('pause');
      if (!this.player.alive) { this.player.respawnT -= dt; if (this.player.respawnT <= 0 && this.state === 'live') { this.spawnActor(this.player); this.emit('respawn'); } }
    }
    for (const b of this.bots) {
      b.update(dt);
      if (!b.alive && !b.isCrew) { b.respawnT -= dt; if (b.respawnT <= 0 && this.state === 'live') this.spawnActor(b); }
      if (b.isCrew) { b.despawnT -= dt; if (b.despawnT <= 0) this.removeActor(b); }
    }
    if (this.state === 'live' && !this.cinematic) this.director.update(dt);
    if (this.cinematic) this.cinematicDirector(dt);
    this.projectiles.update(dt);
    this.updateStreakEffects(dt);
    this.updateRadar(dt);
    this.cleanFeed(dt);
    this.timeSinceStart = this.time;
  }
  cleanFeed(dt) { for (let i = this.feed.length - 1; i >= 0; i--) { this.feed[i].t -= dt; if (this.feed[i].t <= 0) this.feed.splice(i, 1); } }
  removeActor(b) { const i = this.actors.indexOf(b); if (i >= 0) this.actors.splice(i, 1); const j = this.bots.indexOf(b); if (j >= 0) this.bots.splice(j, 1); const k = this.crew.indexOf(b); if (k >= 0) this.crew.splice(k, 1); b.dispose(); }
  goLive() { this.state = 'live'; this.frozen = false; if (this.player) this.player.frozen = false; this.emit('live'); this.message('GO', 1.0); }
  updateRadar(dt) {
    const r = this.radar; if (r.t > 0) r.t -= dt; if (r.jam > 0) r.jam -= dt; if (r.intel > 0) { r.intel -= dt; r.intelT -= dt; if (r.intelT <= 0) { r.intelT = 2; const e = this.enemiesOf(this.player).filter((x) => x.alive).sort((a, b) => a.pos.distanceTo(this.player.pos) - b.pos.distanceTo(this.player.pos))[0]; if (e) r.pings.push({ pos: e.pos.clone(), t: 1.8, intel: true }); } }
    if (r.sweep) { r.sweepT -= dt; if (r.sweepT <= 0) { r.sweepT = 3.5; for (const e of this.enemiesOf(this.player)) if (e.alive) r.pings.push({ pos: e.pos.clone(), t: 1.5 }); } }
    for (let i = r.pings.length - 1; i >= 0; i--) { r.pings[i].t -= dt; if (r.pings[i].t <= 0) r.pings.splice(i, 1); }
    if (this.emp > 0) this.emp -= dt;
    if (this.quakeT > 0) { this.quakeT -= dt; if (this.player) this.player.camShake = 0.6; }
    // heartbeat sensor
    if (this.player && this.player.alive && this.player.equip.tactical.def.id === 'heartbeat') { r.hbT = (r.hbT || 0) - dt; if (r.hbT <= 0) { r.hbT = 1.6; for (const e of this.enemiesOf(this.player)) if (e.alive && e.pos.distanceTo(this.player.pos) < 30) r.pings.push({ pos: e.pos.clone(), t: 1.0, hb: true }); } }
  }
  updateStreakEffects(dt) {
    const p = this.player;
    for (let i = this.mortars.length - 1; i >= 0; i--) { const m = this.mortars[i]; m.t -= dt; m.next -= dt; if (m.next <= 0) { m.next = m.interval; const es = this.enemiesOf(m.owner).filter((e) => e.alive); if (es.length) { const e = this.rng.pick(es); const at = e.pos.clone().add(new THREE.Vector3(this.rng.float(-1.5, 1.5), 0.2, this.rng.float(-1.5, 1.5))); if (m.fire) { this.projectiles.fires.push({ pos: at, r: 3.5, t: 4, owner: m.owner, sparkT: 0, light: this.fx.light(at.clone().add(new THREE.Vector3(0, 0.6, 0)), 0xff7020, 8, 8, 4, false) }); this.fx.explosion(at, 2); sfx('explosion', { vol: 0.5 }); } else this.projectiles.explode(at, 5, 120, m.owner, {}); } } if (m.t <= 0) this.mortars.splice(i, 1); }
    for (let i = this.timed.length - 1; i >= 0; i--) { const t = this.timed[i]; t.t -= dt; if (t.kind === 'wipe') { if (t.t <= 0) { for (const e of this.enemiesOf(t.owner)) if (e.alive) { const c = e.chest(new THREE.Vector3()); this.fx.explosion(c, 2); e.takeDamage(1000, t.owner, 'body', c); } sfx('explosion'); this.timed.splice(i, 1); } continue; }
      t.next -= dt; if (t.next <= 0) { t.next = t.interval; const es = this.enemiesOf(t.owner).filter((e) => e.alive); if (es.length) { const e = this.rng.pick(es); const c = e.chest(new THREE.Vector3()); const from = c.clone().add(new THREE.Vector3(this.rng.float(-30, 30), 25, this.rng.float(-30, 30))); this.fx.tracer(from, c); sfx('shot', { kind: 'sniper', vol: 0.6 }); e.takeDamage(1000, t.owner, 'head', c); this.fx.blood(c, e.model.plastic); } } if (t.t <= 0) this.timed.splice(i, 1); }
    for (let i = this.cars.length - 1; i >= 0; i--) { const c = this.cars[i]; c.t += dt; const k = c.t / c.dur; c.pos.lerpVectors(c.pos, c.end, Math.min(1, dt * 1.2)); c.pos.addScaledVector(c.dir, dt * 16); c.mesh.position.copy(c.pos).setY(0); c.mesh.rotation.y = Math.atan2(c.dir.x, c.dir.z); c.shotT -= dt;
      for (const e of this.enemiesOf(c.owner)) { if (!e.alive) continue; const d = e.pos.distanceTo(c.pos); if (d < 2.2) { e.takeDamage(1000, c.owner, 'body', e.chest(new THREE.Vector3())); this.fx.blood(e.chest(new THREE.Vector3()), e.model.plastic); } else if (d < 16 && c.shotT <= 0 && this.map.world.los(c.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), e.chest(new THREE.Vector3()))) { c.shotT = 0.12; const from = c.pos.clone().add(new THREE.Vector3(0, 1.2, 0)); this.fx.tracer(from, e.chest(new THREE.Vector3())); this.fx.muzzle(from, c.dir, 'smg'); sfx('shot', { kind: 'smg', vol: 0.7 }); e.takeDamage(c.heavy ? 40 : 26, c.owner, 'body'); } }
      if (k >= 1) { this.scene.remove(c.mesh); this.cars.splice(i, 1); } }
    if (this.heli) { const h = this.heli; h.t -= dt; h.ang += dt * 0.35; h.rotor.rotation.y += dt * 30; const center = this.player ? this.player.pos : new THREE.Vector3(); h.mesh.position.set(center.x + Math.cos(h.ang) * 28, 32, center.z + Math.sin(h.ang) * 28); h.mesh.rotation.y = -h.ang; h.mesh.rotation.z = 0.15; this.fx.spot.position.copy(h.mesh.position); this.fx.spot.target.position.set(center.x, 0, center.z); this.fx.spot.target.updateMatrixWorld(); h.soundT -= dt; if (h.soundT <= 0) { h.soundT = 4; sfx('heli', { vol: 0.5 }); }
      h.shotT -= dt; if (h.shotT <= 0) { h.shotT = 0.45; const es = this.enemiesOf(h.owner).filter((e) => e.alive && this.map.world.los(h.mesh.position, e.chest(new THREE.Vector3()))); if (es.length) { const e = this.rng.pick(es); const c = e.chest(new THREE.Vector3()).add(new THREE.Vector3(this.rng.float(-0.6, 0.6), 0, this.rng.float(-0.6, 0.6))); this.fx.tracer(h.mesh.position.clone(), c); sfx('shot', { kind: 'lmg', vol: 0.6 }); if (this.rng.chance(0.75)) { e.takeDamage(34, h.owner, 'body', c); this.fx.blood(c, e.model.plastic); } else this.fx.impact(c.clone().setY(0.05), new THREE.Vector3(0, 1, 0)); } }
      if (h.t <= 0) { this.scene.remove(h.mesh); this.heli = null; this.fx.spot.intensity = 0; } }
  }
  cinematicDirector(dt) { // keep bots busy in the title screen
    this.cinT = (this.cinT || 0) - dt; if (this.cinT <= 0) { this.cinT = 4; for (const b of this.bots) if (b.alive && b.rng.chance(0.3)) { b.hunt = b.rng.pick(this.bots.filter((x) => x !== b && x.alive && !this.sameTeam(x, b))) || null; } }
  }
  // ---------------- end ----------------
  checkEnd() {
    if (this.state !== 'live' || this.cinematic) return;
    if (this.mode.teams) { if (this.teamScore[0] >= this.mode.scoreLimit || this.teamScore[1] >= this.mode.scoreLimit) this.endMatch(); }
    else if (this.mode.id === 'gungame') { if (this.actors.some((a) => !a.isCrew && a.gunGameIndex >= this.mode.gunCount)) this.endMatch(); }
    else if (this.actors.some((a) => !a.isCrew && a.kills >= this.mode.scoreLimit)) this.endMatch();
  }
  ranking() { return this.actors.filter((a) => !a.isCrew).slice().sort((a, b) => this.mode.teams ? (b.score - a.score || b.kills - a.kills) : this.director.rankSort(a, b)); }
  endMatch() {
    if (this.ended) return; this.ended = true; this.state = 'ended'; this.frozen = true; if (this.player) { this.player.frozen = true; this.player.ads = false; }
    const rank = this.ranking(); const p = this.player;
    let result;
    if (this.mode.teams) { const win = this.teamScore[p.team] > this.teamScore[1 - p.team]; const draw = this.teamScore[p.team] === this.teamScore[1 - p.team]; result = { win, draw, place: rank.indexOf(p) + 1, teamScore: this.teamScore.slice(), plan: this.director.plan.playerWins }; }
    else { const place = rank.indexOf(p) + 1; result = { win: place === 1, draw: false, place, top3: place <= 3, plan: this.director.plan.placement }; }
    this.endResult = { ...result, rank, mode: this.mode, bet: this.bet, log: this.director.log };
    this.emit('end', this.endResult);
  }
  dispose() { if (this.player && this.player.view) this.engine.vmCamera.remove(this.player.view.root); for (const a of this.actors) a.dispose(); this.projectiles.clear(); this.fx.clear(); for (const c of this.cars) this.scene.remove(c.mesh); if (this.heli) this.scene.remove(this.heli.mesh); this.scene.remove(this.map.group); }
  // ---------------- audio ----------------
  audio(name, actor, pos, opts = {}) {
    if (name === 'none') return;
    const listener = this.camera; const src = pos || (actor ? actor.pos : null);
    if (!src) { sfx(name, opts); return; }
    _v.subVectors(src, listener.position); const dist = _v.length();
    if (dist > 90) return;
    listener.getWorldDirection(_r); const right = new THREE.Vector3().crossVectors(_r, new THREE.Vector3(0, 1, 0)).normalize();
    const pan = dist > 0.5 ? clamp(_v.clone().normalize().dot(right) * 0.8, -1, 1) : 0;
    sfx(name, { ...opts, pan, dist: actor && actor.isPlayer ? 0 : dist });
  }
}

function makeCarMesh(color) {
  const g = new THREE.Group(); const bm = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.4 }), gm = new THREE.MeshStandardMaterial({ color: '#1b2430', roughness: 0.2, metalness: 0.6 }), wm = new THREE.MeshStandardMaterial({ color: '#111' });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 4.4), bm); body.position.y = 0.65; body.castShadow = true; g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), gm); cab.position.set(0, 1.3, -0.2); g.add(cab);
  for (const [wx, wz] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 12), wm); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.34, wz); g.add(w); }
  return g;
}
