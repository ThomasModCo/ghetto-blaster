// The Director: decides the outcome before the match starts and steers the simulation to land on it,
// while keeping everything looking like a real, competitive match.
//
// Levers (all invisible to the player):
//  - per-team / per-actor damage, accuracy and reaction multipliers ("the winning side gets stronger as it falls behind")
//  - rigged duels: a bot is told to engage a specific victim and cannot miss for a few seconds
//  - fate kills: bot-vs-bot kills resolved directly when the victim is out of the player's sight
//  - hunters: bots sent to find the player when the player needs to die
//  - hard guards at the score limits so the pre-rolled result can never be overtaken
import * as THREE from 'three';
import { RNG } from '../core/rng.js';

const _v = new THREE.Vector3();

export class Director {
  constructor(match, seed) {
    this.m = match; this.rng = new RNG(seed);
    this.mode = match.mode; this.tickT = 0; this.fateT = 0; this.rigged = new Map(); this.mult = new Map();
    this.plan = null; this.log = []; this.pace = 1; this.guard = null;
  }
  // ---------------- planning ----------------
  plan_() {
    const m = this.m, mode = m.mode, p = m.player;
    if (!p) { this.plan = null; for (const a of m.actors) this.mult.set(a, { dmg: 1, incoming: 1, acc: 1, react: 1, attract: 0 }); return; }
    if (mode.id === 'tdm') {
      const playerWins = this.rng.chance(0.5);
      const W = playerWins ? p.team : 1 - p.team;
      const loserFinal = m.mode.scoreLimit - this.rng.int(3, Math.max(4, Math.round(m.mode.scoreLimit * 0.35)));
      this.plan = { kind: 'tdm', W, L: 1 - W, loserFinal, playerWins };
    } else {
      const bots = m.bots.slice();
      const n = bots.length + 1;
      // placement: mildly weighted toward the middle so results feel believable
      const weights = []; for (let r = 1; r <= n; r++) weights.push(1 + Math.sin((r / (n + 1)) * Math.PI) * 0.8);
      const tot = weights.reduce((a, b) => a + b, 0); let x = this.rng.next() * tot, placement = 1;
      for (let r = 0; r < n; r++) { x -= weights[r]; if (x <= 0) { placement = r + 1; break; } }
      this.rng.shuffle(bots);
      // stronger bots are more likely to be planned above the player
      bots.sort((a, b) => (b.skill + this.rng.float(-0.35, 0.35)) - (a.skill + this.rng.float(-0.35, 0.35)));
      const above = bots.slice(0, placement - 1), below = bots.slice(placement - 1);
      above.forEach((b, i) => { b.plannedRank = i + 1; }); p.plannedRank = placement; below.forEach((b, i) => { b.plannedRank = placement + 1 + i; });
      this.plan = { kind: mode.id, placement, above, below, n, winner: placement === 1 ? p : above[0] };
    }
    for (const a of m.actors) this.mult.set(a, { dmg: 1, incoming: 1, acc: 1, react: 1, attract: 0 });
    this.log.push(`plan: ${JSON.stringify({ ...this.plan, above: undefined, below: undefined, winner: this.plan.winner?.name })}`);
  }
  // ---------------- queries used by actors ----------------
  _mu(a) { let x = this.mult.get(a); if (!x) { x = { dmg: 1, incoming: 1, acc: 1, react: 1, attract: 0 }; this.mult.set(a, x); } return x; }
  damageMult(attacker, victim) {
    if (!attacker || !victim) return 1;
    let k = this._mu(attacker).dmg * this._mu(victim).incoming;
    if (!attacker.isPlayer && !victim.isPlayer) k *= 0.5 * this.pace; // bots don't melt each other; global pace throttle
    else if (!attacker.isPlayer) k *= Math.min(1, this.pace);
    const r = this.rigged.get(attacker); if (r && r.victim === victim && r.t > 0) k *= 4;
    if (this.guard) k *= this.guard(attacker, victim);
    return k;
  }
  spreadMult(bot, target) { const r = this.rigged.get(bot); if (r && r.victim === target && r.t > 0) return 0.15; return 1 / Math.max(0.3, this._mu(bot).acc * this.m.modsFor(bot).acc); }
  aimErrorMult(bot, target) { const r = this.rigged.get(bot); if (r && r.victim === target && r.t > 0) return 0.1; return 1 / Math.max(0.3, this._mu(bot).acc * this.m.modsFor(bot).acc); }
  reactionMult(bot) { return this._mu(bot).react * this.m.modsFor(bot).react; }
  forcedHit(bot, target) { const r = this.rigged.get(bot); if (r && r.victim === target && r.t > 0) return target; return null; }
  playerAttractBias(bot) { return this._mu(bot).attract; }
  // ---------------- steering ----------------
  update(dt) {
    if (!this.plan) return;
    for (const [a, r] of this.rigged) { r.t -= dt; if (r.t <= 0 || !r.victim.alive || !a.alive) this.rigged.delete(a); }
    this.fateT -= dt;
    this.tickT -= dt; if (this.tickT > 0) return; this.tickT = 0.5;
    if (this.plan.kind === 'tdm') this.tickTDM(); else this.tickRanked();
  }
  _visibleToPlayer(a) {
    const p = this.m.player; if (!p || !a) return false;
    const d = a.pos.distanceTo(p.pos); if (d > 60) return false;
    const cam = this.m.camera; cam.getWorldDirection(_v);
    const to = a.chest(new THREE.Vector3()).sub(cam.position); const dist = to.length(); to.divideScalar(dist);
    if (to.dot(_v) < 0.45) return false; // outside a generous view cone
    return this.m.map.world.los(cam.position, a.chest(new THREE.Vector3()));
  }
  /** Make `killer` kill `victim`: rig a real duel if they can see each other, resolve directly if hidden from the player. */
  fateKill(killer, victim, allowVisible = false) {
    if (!killer || !victim || !killer.alive || !victim.alive || killer === victim) return false;
    if (this.guard && this.guard(killer, victim) < 0.1) return false; // never break a hard guard
    const m = this.m;
    const kEye = killer.eye(new THREE.Vector3()), vChest = victim.chest(new THREE.Vector3());
    const dist = kEye.distanceTo(vChest);
    const canSee = dist < 45 && m.map.world.los(kEye, vChest);
    if (canSee) { // rigged duel: looks completely natural
      killer.target = victim; killer.targetAcqT = m.time; killer.targetSeenT = m.time; killer.lastKnown.copy(victim.pos); killer.state = 'engage'; killer.hunt = victim;
      this.rigged.set(killer, { victim, t: 4 });
      this.log.push(`rig ${killer.name}->${victim.name}`);
      return true;
    }
    if (!this._visibleToPlayer(victim) || allowVisible) { // off-screen resolution
      m.audio('shot', null, victim.pos, { kind: killer.weapon.def.sound, vol: 0.5 });
      victim.takeDamage(1000, killer, this.rng.chance(0.2) ? 'head' : 'body', vChest);
      m.fx.blood(vChest, victim.model.plastic);
      this.log.push(`fate ${killer.name}->${victim.name}`);
      return true;
    }
    // can't resolve invisibly: send the killer hunting (they will get rigged when they arrive)
    killer.hunt = victim; killer.setDest(m.map.nav.randomPointNear(killer.rng, victim.pos.x, victim.pos.z, 8), 'hunt');
    return false;
  }
  _alive(list) { return list.filter((a) => a.alive); }
  // ---------------- Team Deathmatch ----------------
  tickTDM() {
    const m = this.m, P = this.plan, p = m.player;
    const limit = m.mode.scoreLimit, T = m.mode.timeLimit, f = Math.min(1, m.elapsed / T), rem = T - m.elapsed;
    const sW = m.teamScore[P.W], sL = m.teamScore[P.L];
    const desiredW = limit * Math.min(1, f / 0.92), desiredL = P.loserFinal * Math.min(1, f / 0.92);
    const defW = desiredW - sW, overL = sL - desiredL;
    const botsW = m.bots.filter((b) => b.team === P.W), botsL = m.bots.filter((b) => b.team === P.L);
    const playerOnW = p.team === P.W;
    // global pace: keep total kills near the planned trajectory so the match lasts the intended time
    const desiredTotal = (limit + P.loserFinal) * Math.min(1, f / 0.95) + 2, actualTotal = sW + sL + 1;
    this.pace = clamp(this.pace * 0.8 + 0.2 * clamp(desiredTotal / actualTotal, 0.25, 1.5), 0.25, 1.5);
    // base multipliers: winners strengthen as they fall behind plan, losers weaken as they get ahead of plan (with tolerance bands)
    const dW = Math.max(0, defW - 3), oL = Math.max(0, overL - 3);
    const wBuff = clamp(1 + dW * 0.08, 0.75, 2.4), lNerf = clamp(1 - oL * 0.08, 0.35, 1.25);
    for (const b of botsW) { const mu = this._mu(b); mu.dmg = wBuff; mu.acc = clamp(1 + dW * 0.05, 0.6, 1.8); mu.react = clamp(1 - dW * 0.03, 0.5, 1.3); mu.incoming = clamp(1 - dW * 0.03, 0.6, 1.2); mu.attract = 0; }
    for (const b of botsL) { const mu = this._mu(b); mu.dmg = lNerf; mu.acc = clamp(1 - oL * 0.06, 0.5, 1.3); mu.react = clamp(1 + oL * 0.04, 0.8, 1.6); mu.incoming = clamp(1 + oL * 0.04, 0.9, 1.6); mu.attract = 0; }
    // the player: never feel cheated. Only gentle adjustments, and hunters when the losing side must bleed.
    const pm = this._mu(p);
    if (playerOnW) { pm.dmg = clamp(1 + dW * 0.02, 0.9, 1.3); pm.incoming = clamp(1 - dW * 0.02, 0.8, 1.1); }
    else { pm.dmg = clamp(1 - oL * 0.03, 0.75, 1.05); pm.incoming = clamp(1 + oL * 0.04, 0.9, 1.5); if (oL > 2) for (const b of botsW.slice(0, Math.min(botsW.length, 1 + Math.floor(overL / 3)))) { this._mu(b).attract = 30; if (!b.hunt && b.rng.chance(0.5)) { b.hunt = p; } } else for (const b of botsW) { if (b.hunt === p) b.hunt = null; } }
    // fate kill pacing
    let rate = 0; // kills per second for W
    if (dW > 2) rate += Math.min(0.6, (dW - 2) * 0.05);
    if (oL > 4) rate += Math.min(0.4, (oL - 4) * 0.05);
    if (rem < 40 && sW < Math.max(sL + 1, limit - 2)) rate += 0.5 + (limit - sW) / Math.max(5, rem);
    if (sL >= limit - 1) rate += 1.0; // hard: finish it now
    // hard guards
    this.guard = (a, v) => {
      let k = 1;
      if (a.team === P.L && sL >= limit - 1) k *= 0.02; // the loser cannot reach the limit
      else if (a.team === P.L && sL >= P.loserFinal) k *= a.isPlayer ? 0.45 : 0.08;
      if (v && v.team === P.W && sL >= limit - 1) k *= 0.02;
      return k;
    };
    if (rate > 0 && this.fateT <= 0) {
      const killers = this._alive(botsW), victims = this._alive(botsL).filter((v) => !v.isPlayer);
      if (killers.length && victims.length) { const k = this.rng.pick(killers); victims.sort((x, y) => (this._visibleToPlayer(x) ? 1 : 0) - (this._visibleToPlayer(y) ? 1 : 0) + this.rng.float(-0.4, 0.4)); if (this.fateKill(k, victims[0], rem < 6)) this.fateT = 1 / rate; else this.fateT = 0.5; }
    }
    // balance the other way if W is running away (keep it tense)
    if (sW - desiredW > 6 && overL < 0) { for (const b of botsW) { const mu = this._mu(b); mu.dmg *= 0.6; mu.acc *= 0.7; } for (const b of botsL) { const mu = this._mu(b); mu.dmg *= 1.35; mu.acc *= 1.3; } if (this.fateT <= 0 && this.rng.chance(0.6)) { const k = this.rng.pick(this._alive(botsL)); const v = this.rng.pick(this._alive(botsW)); if (k && v && this.fateKill(k, v)) this.fateT = 2; } }
    // final seconds: absolute guarantee
    if (rem < 2.5 && sW <= sL) { const killers = this._alive(botsW), victims = this._alive(botsL).filter((v) => !v.isPlayer); let need = sL - sW + 1; for (let i = 0; i < need && killers.length && victims.length; i++) { const v = victims.pop(); this.fateKill(this.rng.pick(killers), v, true); } }
  }
  // ---------------- FFA / Gun Game ----------------
  _score(a) { return this.plan.kind === 'gungame' ? a.gunGameIndex : a.kills; }
  tickRanked() {
    const m = this.m, P = this.plan, p = m.player, gg = P.kind === 'gungame';
    const limit = gg ? m.mode.gunCount : m.mode.scoreLimit, T = m.mode.timeLimit, f = Math.min(1, m.elapsed / T), rem = T - m.elapsed;
    const ps = this._score(p);
    const pm = this._mu(p); pm.dmg = 1; pm.incoming = 1;
    const totalKills = m.actors.reduce((a, x) => a + (x.isCrew ? 0 : x.kills), 0) + 1;
    const desiredTotal = limit * (P.n * 0.4) * Math.min(1, f / 0.92) + 2; // the winner reaches the limit at ~90% time; others trail
    this.pace = clamp(this.pace * 0.8 + 0.2 * clamp(desiredTotal / totalKills, 0.25, 1.5), 0.25, 1.5);
    // desired pace for the winner so the match ends around 90% of the time limit
    const winner = P.winner; const desiredWin = limit * Math.min(1, f / 0.92);
    const above = P.above, below = P.below;
    let fateRate = 0; const wants = []; // [killer, deficit]
    above.forEach((b, i) => {
      const margin = above.length - i; // rank 1 keeps the biggest margin over the player
      const desired = Math.max(ps + margin, b === winner ? desiredWin : (ps + margin));
      const def = desired - this._score(b);
      const mu = this._mu(b); mu.dmg = clamp(1 + def * 0.12, 0.9, 2.5); mu.acc = clamp(1 + def * 0.08, 0.9, 1.9); mu.react = clamp(1 - def * 0.05, 0.5, 1.1); mu.incoming = clamp(1 - def * 0.06, 0.5, 1.0); mu.attract = def > 0 ? 10 : 0;
      if (def > 0 && !(this._score(b) >= limit - 1 && !above.every((x) => x === b || this._score(x) >= ps))) { wants.push([b, def]); fateRate += Math.min(0.4, def * 0.06); }
    });
    below.forEach((b) => {
      const cap = ps; const over = this._score(b) - cap; // ties go to the player (planned rank), so below bots may reach ps but never pass it
      const mu = this._mu(b); mu.dmg = over >= 0 ? 0.05 : clamp(1 - over * 0.1, 0.5, 1.3); mu.acc = over >= 0 ? 0.4 : clamp(1 - over * 0.1, 0.6, 1.2); mu.react = over >= 0 ? 1.8 : 1; mu.incoming = over >= 0 ? 1.4 : 1; mu.attract = 0;
    });
    // the player must die more when planned low: hunters from the above set
    const aliveAbove = this._alive(above);
    const playerTooGood = above.some((b) => this._score(b) < ps + 1);
    for (const b of aliveAbove) { if (playerTooGood && b.rng.chance(0.3)) { b.hunt = p; this._mu(b).attract = 30; } else if (b.hunt === p && !playerTooGood) b.hunt = null; }
    if (playerTooGood) pm.incoming = 1.25;
    // hard guards. Final ordering only needs: every planned-above bot >= player, every planned-below bot < player (ties go to planned rank).
    const aboveOk = above.every((b) => this._score(b) >= ps), belowOk = below.every((b) => this._score(b) <= ps);
    this.guard = (a, v) => {
      let k = 1;
      if (a === p) {
        if (P.placement > 1 && ps >= limit - 1 && this._score(winner) < limit) k *= 0.03; // player can't finish before the planned winner
        if (P.placement > 1 && !aboveOk) k *= 0.35; // let the planned-above bots catch up
      } else if (below.includes(a) && this._score(a) >= ps) k *= 0.03;
      if (P.placement === 1 && a !== p && this._score(a) >= limit - 1) k *= 0.03; // nobody beats the player to the limit
      if (a !== p && this._score(a) >= limit - 1 && !(aboveOk && belowOk)) k *= 0.03; // nobody closes it out before the ordering holds
      return k;
    };
    if (!aboveOk) fateRate += 0.5;
    // endgame pacing: the planned winner must close it out
    if (winner !== p && rem < 45 && this._score(winner) < limit) fateRate += 0.6 + (limit - this._score(winner)) / Math.max(4, rem);
    if (P.placement > 1 && ps >= limit - 1) fateRate += 1.2;
    if (fateRate > 0 && this.fateT <= 0 && wants.length) {
      wants.sort((a, b) => b[1] - a[1]); const killer = wants[0][0];
      if (killer.alive) {
        // victims: prefer below-set bots, never the player via fate (the player dies in real fights only)
        // any other bot is a safe victim: deaths never affect the ordering (prefer the planned-below set)
        let victims = this._alive(below).filter((v) => v !== killer);
        if (!victims.length) victims = this._alive(above).filter((v) => v !== killer);
        if (!victims.length) victims = this._alive(m.crew).filter((v) => v !== killer && !m.sameTeam(v, killer));
        if (victims.length) { victims.sort((x, y) => (this._visibleToPlayer(x) ? 1 : 0) - (this._visibleToPlayer(y) ? 1 : 0) + this.rng.float(-0.4, 0.4)); if (this.fateKill(killer, victims[0], rem < 6)) this.fateT = 1 / Math.max(0.2, fateRate); else this.fateT = 0.5; }
      }
    }
    // keep the below set busy killing each other so the leaderboard looks alive (but below the player)
    if (this.fateT <= 0 && this.rng.chance(0.25)) { const cand = this._alive(below).filter((b) => this._score(b) < ps - 1); const vic = this._alive(below); if (cand.length && vic.length > 1) { const k = this.rng.pick(cand); const v = this.rng.pick(vic.filter((x) => x !== k)); if (v && this.fateKill(k, v)) this.fateT = 3; } }
    // final seconds guarantee: ordering must hold at time-out
    if (rem < 2.5) {
      for (let i = above.length - 1; i >= 0; i--) { const b = above[i]; const need = (ps + (above.length - i)) - this._score(b); for (let k = 0; k < need; k++) { const victims = this._alive(below).concat(this._alive(above)).filter((x) => x !== b); if (!victims.length) break; const v = this.rng.pick(victims); if (b.alive) { this.fateKill(b, v, true); } else { v.takeDamage(1000, b, 'body'); } } }
    }
  }
  // final ranking tie-break for ranked modes (kills desc, then planned rank)
  rankSort(a, b) { const sa = this._score(a), sb = this._score(b); if (sb !== sa) return sb - sa; return (a.plannedRank || 99) - (b.plannedRank || 99); }
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
