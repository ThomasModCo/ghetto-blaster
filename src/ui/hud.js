// In-game HUD bound to a Match.
import * as THREE from 'three';
import { sfx } from '../audio/sfx.js';
import { NameTags } from './nametags.js';
import { streakIcon } from './icons.js';

const $ = (id) => document.getElementById(id);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// glossy molded bar: green, amber under half, red under a quarter
const healthFill = (f) => f > 0.5 ? 'linear-gradient(180deg,#9ff7a8,#45c95c 55%,#25913b)' : f > 0.25 ? 'linear-gradient(180deg,#ffe08a,#f2a91e 55%,#b06f08)' : 'linear-gradient(180deg,#ff9a8a,#e8473a 55%,#9b2018)';

export class HUD {
  constructor() {
    this.el = $('hud'); this.mm = $('minimap'); this.ctx = this.mm.getContext('2d');
    this.msgT = 0; this.streakMsgT = 0; this.hitT = 0; this.flashA = 0; this.dmgA = 0; this.inds = []; this.textT = 0;
    this.lastFeedKey = '';
    this.streakSlots = [];
    this.tags = new NameTags($('nametags'));
  }
  bind(match, { onOpenLoadout, onScoreboard, onPause }) {
    this.m = match; const p = match.player;
    match.events.kill = ({ victim, part }) => { this.hitmark(true); sfx('hit', { kill: true }); this.notify(part === 'head' ? `HEADSHOT ${victim.name}` : `KILLED ${victim.name}`, 100 + (part === 'head' ? 25 : 0), part === 'head' ? 'head' : 'kill'); };
    match.events.assist = ({ victim }) => { this.notify(`ASSIST ${victim.name}`, 25, 'assist'); };
    match.events.death = ({ killer, weaponName }) => { match.input.rumble?.(0.7, 1, 420); this.message(killer ? `KILLED BY ${killer.name.toUpperCase()}` : 'YOU DIED', 2.5); this.dmgA = 1; };
    match.events.message = ({ text, dur }) => this.message(text, dur);
    match.events.streak = ({ def }) => { this.streakMsg(def.name); };
    match.events.scoreboard = (on) => onScoreboard(on);
    match.events.openLoadout = () => onOpenLoadout();
    match.events.pause = () => onPause();
    match.events.respawn = () => { this.dmgA = 0; };
    p.onHit = (actor, part, dmg) => { this.hitmark(false, part === 'head'); if (actor.health > 0) sfx('hit'); };
    p.onDamaged = (amount, attacker, point) => { this.dmgA = Math.min(1, this.dmgA + amount / 60); sfx('hurt', { vol: 0.6 }); match.input.rumble?.(0.35, Math.min(1, 0.4 + amount / 80), 180); if (attacker) this.inds.push({ from: attacker.pos.clone(), t: 1.2 }); };
    p.onScore = () => { this.renderStreaks(); };
    this.el.classList.remove('hidden'); $('mobile-controls').classList.toggle('hidden', !match.input.mobile);
    $('btn-loadout').onclick = () => onOpenLoadout();
    this.renderStreaks(true);
    this.textT = 0; this.lastFeedKey = '';
    $('hud-name').textContent = '';
  }
  notify(text, score, kind = 'kill') {
    const box = $('kill-notify'); const d = document.createElement('div'); d.className = 'kn ' + kind; d.innerHTML = `<div class="kn-t">${text}</div><div class="kn-s">+${score}</div>`; box.prepend(d);
    while (box.children.length > 3) box.removeChild(box.lastChild);
    setTimeout(() => d.classList.add('out'), 1400); setTimeout(() => d.remove(), 1800);
  }
  hitmark(kill, head) { const h = $('hitmarker'); h.classList.remove('fade'); h.classList.toggle('kill', !!kill); h.classList.add('show'); h.style.transform = `translate(-50%,-50%) rotate(45deg) scale(${kill ? 1.4 : head ? 1.15 : 1})`; this.hitT = 0.12; }
  message(text, dur = 1.5) { const e = $('hud-msg'); e.textContent = text; e.classList.add('show'); this.msgT = dur; }
  streakMsg(text) { const e = $('hud-streak-msg'); e.textContent = text + ' READY'; e.classList.add('show'); this.streakMsgT = 2.2; }
  renderStreaks(rebuild = false) {
    const bar = $('streaks-bar'); const st = this.m.streakState; const p = this.m.player;
    if (rebuild || bar.children.length !== 3) {
      bar.innerHTML = '';
      st.picks.forEach((def, i) => { const d = document.createElement('div'); d.className = 'sk'; d.innerHTML = `<div class="fill"></div><span class="key kb">${this.m.input.mobile ? '' : i + 3}</span><span class="key pad">${['◀', '▲', '▶'][i]}</span>${def ? `<img class="sk-ico" src="${streakIcon(def.effect, '#ffffff', 64)}" alt="">` : '<span class="nm">-</span>'}<span class="cost">${def ? def.cost : ''}</span>`; if (def) d.title = def.name; d.onclick = () => this.m.useStreak(p, i); bar.appendChild(d); });
      this.readyFlags = [false, false, false];
    }
    st.picks.forEach((def, i) => { const d = bar.children[i]; if (!def) return; const ready = !st.used[i] && p.streakScore >= def.cost; const k = st.used[i] ? 0 : Math.min(1, p.streakScore / def.cost); d.querySelector('.fill').style.height = `${k * 100}%`; d.classList.toggle('ready', ready); d.style.opacity = st.used[i] ? 0.35 : 1; if (ready && !this.readyFlags[i]) { this.readyFlags[i] = true; this.streakMsg(def.name); sfx('ui'); } });
  }
  update(dt) {
    const m = this.m; if (!m) return; const p = m.player; const w = p.weapon;
    // timers
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) $('hitmarker').classList.add('fade'); }
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) $('hud-msg').classList.remove('show'); }
    if (this.streakMsgT > 0) { this.streakMsgT -= dt; if (this.streakMsgT <= 0) $('hud-streak-msg').classList.remove('show'); }
    // flash / stun / damage overlays
    const flash = Math.min(1, p.fx.flash / 2.5); $('flash').style.opacity = flash.toFixed(2);
    this.dmgA = Math.max(0, this.dmgA - dt * 0.8); const lowHp = p.alive ? (1 - p.health / p.maxHealth) * 0.7 : 0; $('damage-vignette').style.opacity = Math.max(this.dmgA, lowHp).toFixed(2);
    $('scope').classList.toggle('on', !!p.scopeOverlay);
    $('crosshair').classList.toggle('hide', !!p.scopeOverlay || !p.alive || p.sprint || p.adsBlend > 0.6);
    const spread = (p.ads ? w.spreadAds : w.spreadHip) + (p.moving ? w.spreadMove * 0.5 : 0) + (p.body.onGround ? 0 : 1.5) + p.kickP * 40;
    $('crosshair').style.setProperty('--gap', `${6 + spread * 4}px`);
    // damage indicators
    const ind = $('dmg-indicators'); while (ind.children.length < this.inds.length) { const d = document.createElement('div'); d.className = 'dmg-ind'; ind.appendChild(d); } while (ind.children.length > this.inds.length) ind.removeChild(ind.lastChild);
    for (let i = this.inds.length - 1; i >= 0; i--) { const it = this.inds[i]; it.t -= dt; if (it.t <= 0) { this.inds.splice(i, 1); continue; } const d = ind.children[i]; const a = Math.atan2(it.from.x - p.pos.x, it.from.z - p.pos.z) - p.yaw; d.style.transform = `rotate(${-a}rad)`; d.style.opacity = Math.min(1, it.t); }
    // text (throttled)
    this.textT -= dt; if (this.textT <= 0) { this.textT = 0.08; this.updateText(); }
    this.drawMinimap();
    this.tags.update(m);
  }
  updateText() {
    const m = this.m, p = m.player, w = p.weapon;
    $('health-bar').style.width = `${(p.health / p.maxHealth) * 100}%`; $('health-bar').style.background = p.armor > 0 ? 'linear-gradient(180deg,#c9f2ff,#6fc7f5 55%,#2f86c4)' : p.fx.jugg > 0 ? 'linear-gradient(180deg,#ffe58a,#f2b41e 60%,#b07a08)' : healthFill(p.health / p.maxHealth);
    $('hud-weapon').textContent = w.def.name + (m.mode.id === 'gungame' ? ` (${p.gunGameIndex + 1}/${m.mode.gunCount})` : '');
    $('ammo-mag').textContent = w.def.mag > 1000 ? '∞' : w.mag; $('ammo-res').textContent = w.def.mag > 1000 ? '' : `/ ${w.reserve}`; $('ammo-mag').parentElement.classList.toggle('low', w.mag <= Math.max(3, w.def.mag * 0.2));
    const el = p.equip.lethal, et = p.equip.tactical;
    $('eq-lethal').innerHTML = `<b>${el.count}</b>${el.def.name}`; $('eq-lethal').classList.toggle('empty', el.count === 0); $('eq-lethal').classList.toggle('hidden', el.def.id === 'none');
    $('eq-tactical').innerHTML = `<b>${et.def.passive ? '●' : et.count}</b>${et.def.name}`; $('eq-tactical').classList.toggle('empty', et.count === 0 && !et.def.passive); $('eq-tactical').classList.toggle('hidden', et.def.id === 'none');
    const rem = Math.max(0, m.mode.timeLimit - m.elapsed); $('hud-timer').textContent = m.state === 'pregame' ? `STARTS IN ${Math.ceil(m.pregameT)}` : fmt(rem);
    if (m.mode.teams) $('hud-score').innerHTML = `<span class="t0">${m.teamScore[0]}</span><span class="sep">${p.team === 0 ? '◀' : '▶'}</span><span class="t1">${m.teamScore[1]}</span>`;
    else { const rank = m.ranking(); const i = rank.indexOf(p); const lead = rank[0]; const score = m.mode.id === 'gungame' ? (a) => a.gunGameIndex : (a) => a.kills; $('hud-score').innerHTML = `<span class="me">#${i + 1}</span><span class="sep">YOU ${score(p)}</span><span class="sep">·</span><span>${lead === p ? (rank[1] ? rank[1].name + ' ' + score(rank[1]) : '') : lead.name + ' ' + score(lead)}</span>`; }
    $('hud-objective').textContent = m.mode.teams ? `FIRST TO ${m.mode.scoreLimit}` : m.mode.id === 'gungame' ? `FIRST THROUGH ${m.mode.gunCount} GUNS` : `FIRST TO ${m.mode.scoreLimit} KILLS`;
    $('btn-loadout').classList.toggle('hidden', m.state !== 'pregame');
    // killfeed
    const key = m.feed.map((f) => (f.k ? f.k.name : '') + f.v.name + f.t.toFixed(0)).join('|');
    if (key !== this.lastFeedKey) { this.lastFeedKey = key; const cls = (a) => a.isPlayer ? 'me' : m.mode.teams ? 't' + a.team : 'ffa'; $('killfeed').innerHTML = m.feed.map((f) => `<div class="kf">${f.k ? `<span class="k ${cls(f.k)}">${f.k.name}</span><span class="w">${f.head ? '☠ ' : ''}${f.w}</span>` : `<span class="w">${f.w}</span>`}<span class="v ${cls(f.v)}">${f.v.name}</span></div>`).join(''); }
    if (m.streakState.dirty) { m.streakState.dirty = false; this.renderStreaks(true); } else this.renderStreaks();
    if (p.streakScore > 0) $('hud-name').textContent = `SCORE ${p.streakScore}`; else $('hud-name').textContent = p.killStreak > 1 ? `${p.killStreak} STREAK` : '';
  }
  drawMinimap() {
    const m = this.m, p = m.player, ctx = this.ctx, S = this.mm.width, R = S / 2; const map = m.map;
    const scale = S / 90; // 90 m across the minimap
    ctx.clearRect(0, 0, S, S); ctx.save(); ctx.beginPath(); ctx.arc(R, R, R - 2, 0, Math.PI * 2); ctx.clip();
    ctx.translate(R, R); ctx.rotate(p.yaw + Math.PI); ctx.scale(scale, scale); ctx.translate(-p.pos.x, -p.pos.z); // forward (sin yaw, cos yaw) now points up
    const k = map.minimap.width / map.size;
    ctx.save(); ctx.translate(-map.size / 2, -map.size / 2); ctx.scale(1 / k, 1 / k); ctx.globalAlpha = 0.9; ctx.drawImage(map.minimap, 0, 0); ctx.restore();
    const dot = (x, z, color, r = 1.6) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, z, r, 0, Math.PI * 2); ctx.fill(); };
    // allies
    for (const a of m.actors) { if (a === p || !a.alive) continue; if (m.sameTeam(a, p)) dot(a.pos.x, a.pos.z, a.isCrew ? '#ffd166' : '#60a5fa'); }
    // enemies: radar / pings
    const radarOn = m.radar.t > 0 && !m.radar.sweep;
    for (const a of m.actors) { if (a === p || !a.alive || m.sameTeam(a, p)) continue; if (radarOn || a.fx.revealed > 0 || (m.quakeT > 0)) dot(a.pos.x, a.pos.z, '#f87171', 1.8); }
    for (const ping of m.radar.pings) dot(ping.pos.x, ping.pos.z, ping.hb ? `rgba(74,222,128,${ping.t})` : ping.intel ? `rgba(255,209,102,${Math.min(1, ping.t)})` : `rgba(248,113,113,${Math.min(1, ping.t)})`, ping.hb ? 2.2 : 1.8);
    for (const c of m.projectiles.placed) if (c.owner === p) dot(c.pos.x, c.pos.z, '#4ade80', 1.2);
    ctx.restore();
    // player arrow
    ctx.save(); ctx.translate(R, R); ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.restore();
    // view cone
    ctx.save(); ctx.translate(R, R); ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); ctx.closePath(); ctx.fill(); ctx.restore();
    if (m.radar.jam > 0 || m.emp > 0) { ctx.fillStyle = 'rgba(74,222,128,0.9)'; ctx.font = 'bold 14px Impact, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('JAMMING', R, S - 14); }
  }
  hide() { this.el.classList.add('hidden'); this.m = null; this.tags.clear(); }
}
