// All non-HUD screens. Pure DOM; the game state machine in main.js drives these.
import { Podium } from './podium.js';
import { STOCK_LOADOUTS, allLoadouts, getSave, persist, resolveLoadout } from '../game/loadouts.js';
import { WEAPONS, PRIMARIES, SECONDARIES, weaponStats, GUN_GAME_ORDER } from '../game/weapons.js';
import { TACTICALS, LETHALS } from '../game/equipment.js';
import { streaksForMap } from '../game/streaks.js';
import { MODES } from '../game/modes.js';
import { sfx } from '../audio/sfx.js';
import { weaponIcon, equipmentIcon, streakIcon } from './icons.js';
import { btn } from './padglyphs.js';

let engineRef = null;
export function setEngine(e) { engineRef = e; }
const wIcon = (w) => engineRef ? weaponIcon(engineRef, w) : '';
const eIcon = (e) => engineRef ? equipmentIcon(engineRef, e) : '';

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');
export const SCREENS = ['screen-title', 'screen-modes', 'screen-lobby', 'screen-loadout', 'screen-scoreboard', 'screen-results', 'screen-dialog'];
export function hideAll() { for (const s of SCREENS) hide(s); }

// ---------------- title ----------------
export function showTitle(mapName, wallet) { hideAll(); show('screen-title'); $('title-map-name').textContent = mapName.toUpperCase(); $('title-wallet').textContent = `$${wallet}`; }

// ---------------- modes ----------------
export function showModes(arts, wallet, onPick) {
  hide('screen-title'); show('screen-modes'); requestAnimationFrame(() => $('screen-modes').classList.add('show'));
  $('modes-wallet').textContent = `BANKROLL $${wallet}`;
  const grid = $('modes-grid'); grid.innerHTML = '';
  Object.values(MODES).forEach((mode, i) => {
    const d = document.createElement('div'); d.className = 'mode-panel';
    d.innerHTML = `<div class="mode-art" style="background-image:url(${arts[i % arts.length] || ''})"></div><div class="mode-shade"></div><div class="mode-text"><h2>${mode.name}</h2><p>${mode.desc}</p><span class="mode-tag">${mode.tag}</span></div>`;
    d.onclick = () => { sfx('ui'); onPick(mode); };
    grid.appendChild(d);
  });
}
export function hideModes() { $('screen-modes').classList.remove('show'); hide('screen-modes'); }

// ---------------- lobby ----------------
export function showLobby(mode, mapDef, wallet, onBet) {
  hideAll(); show('screen-lobby');
  $('lobby-status').textContent = 'SEARCHING FOR LOBBY'; $('lobby-mode').textContent = mode.name; $('lobby-map').textContent = `${mapDef.name.toUpperCase()} — ${mapDef.city.toUpperCase()}`;
  const slots = $('lobby-slots'); slots.innerHTML = ''; slots.className = 'lobby-slots' + (mode.teams ? '' : ' ffa');
  const bet = $('lobby-bet'); const amounts = [0, 50, 100, 250, 500, 1000].filter((a) => a <= wallet);
  let cur = Math.min(100, wallet);
  const render = () => { bet.innerHTML = `<div class="bet-title">BET ON YOURSELF — ${mode.bet.label} PAYS ${mode.bet.odds}x</div><div class="bet-chips">${amounts.map((a) => `<button class="chip ${a === cur ? 'on' : ''}" data-a="${a}">${a === 0 ? 'NO BET' : '$' + a}</button>`).join('')}</div><div class="bet-odds">Bankroll $${wallet}. Win ${mode.bet.label} to collect $${Math.round(cur * mode.bet.odds)}.</div>`; bet.querySelectorAll('.chip').forEach((c) => { c.onclick = () => { cur = +c.dataset.a; sfx('click'); render(); onBet(cur); }; }); };
  render(); onBet(cur);
}
export function lobbyStatus(text) { $('lobby-status').textContent = text; }
export function lobbySlots(mode, players, total) {
  const slots = $('lobby-slots'); slots.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const p = players[i]; const d = document.createElement('div');
    if (!p) { d.className = 'lobby-slot empty'; d.textContent = 'searching...'; }
    else { d.className = `lobby-slot ${mode.teams ? 't' + p.team : ''} ${p.isPlayer ? 'you' : ''}`; d.innerHTML = `<span>${p.name}</span><span class="lvl">LVL ${p.level ?? '-'}</span><span class="ping">${p.ping ?? 0}ms</span>`; }
    slots.appendChild(d);
  }
}

// ---------------- loadout selector (pre-game) ----------------
const TIER_COLORS = { starter: '#7cd3ff', medium: '#ffd166', powerful: '#ff7a1a' };
export function showLoadoutSelector(mapId, current, onPick, onReady, opts = {}) {
  show('screen-loadout');
  const list = $('loadout-list'); const detail = $('loadout-detail'); const sp = $('streak-pick');
  const streaks = streaksForMap(mapId); const save = getSave();
  const picks = current.streaks || save.lastStreaks?.[mapId] || [streaks.starter[0].id, streaks.medium[0].id, streaks.powerful[0].id];
  let sel = current.loadoutId || 'runner';
  const render = () => {
    $('loadout-title').textContent = opts.gunGame ? 'GUN GAME' : 'SELECT LOADOUT';
    if (opts.gunGame) {
      // no loadouts in gun game: show the ladder everyone climbs, keep the streak picks
      list.innerHTML = `<div class="gg-intro"><div class="gg-k">NO LOADOUTS</div><div class="gg-t">Everyone starts with the same pistol and no equipment. Every kill hands you the next gun on the ladder.</div><div class="gg-start"><img src="${wIcon(WEAPONS[GUN_GAME_ORDER[0]])}" alt=""><span>YOU START WITH</span><b>${WEAPONS[GUN_GAME_ORDER[0]].name}</b></div></div>`;
      detail.innerHTML = `<div class="lo-head-row"><h3>THE LADDER</h3><div class="desc">${GUN_GAME_ORDER.length} guns. First kill with the last one wins.</div></div><div class="gg-ladder">${GUN_GAME_ORDER.map((id, i) => `<div class="gg-step ${i === 0 ? 'start' : ''} ${i === GUN_GAME_ORDER.length - 1 ? 'final' : ''}"><b>${i + 1}</b><img src="${wIcon(WEAPONS[id])}" alt=""><span>${WEAPONS[id].name}</span></div>`).join('')}</div>`;
      renderStreaks(); return;
    }
    list.innerHTML = '';
    for (const lo of allLoadouts()) {
      const d = document.createElement('div'); d.className = `lo-item ${lo.custom ? 'custom' : ''} ${lo.empty ? 'empty' : ''} ${lo.id === sel ? 'on' : ''}`;
      const r = lo.empty ? null : resolveLoadout(lo);
      d.innerHTML = `${r ? `<img class="lo-ico" src="${wIcon(r.primary)}" alt="">` : '<div class="lo-ico lo-ico-empty">+</div>'}<div><div class="lo-name">${lo.name}</div><div class="lo-sub">${lo.empty ? 'not configured' : `${r.primary.name} · ${r.secondary.name}`}</div></div>`;
      if (!lo.empty) d.onclick = () => { sel = lo.id; sfx('click'); render(); emit(); };
      list.appendChild(d);
    }
    const lo = allLoadouts().find((l) => l.id === sel) || STOCK_LOADOUTS[0]; const r = resolveLoadout(lo);
    const bar = (label, v) => `<div class="stat-bar"><span>${label}</span><div><i style="width:${Math.round(v * 100)}%"></i></div></div>`;
    const st = weaponStats(r.primary), st2 = weaponStats(r.secondary);
    detail.innerHTML = `<div class="lo-head-row"><h3>${lo.name}</h3><div class="desc">${lo.desc || 'Custom loadout.'}</div></div>
      <div class="lo-cards">
        <div class="lo-card primary"><span class="lo-k">PRIMARY</span><img src="${wIcon(r.primary)}" alt=""><div class="lo-card-name">${r.primary.name}</div><div class="lo-card-type">${r.primary.type.toUpperCase()} · ${r.primary.mag} RND</div><div class="stat-bars">${bar('DMG', st.damage)}${bar('RATE', st.rate)}${bar('RANGE', st.range)}${bar('ACC', st.accuracy)}${bar('MOB', st.mobility)}</div></div>
        <div class="lo-card secondary"><span class="lo-k">SECONDARY</span><img src="${wIcon(r.secondary)}" alt=""><div class="lo-card-name">${r.secondary.name}</div><div class="lo-card-type">${r.secondary.type.toUpperCase()} · ${r.secondary.mag} RND</div><div class="stat-bars small">${bar('DMG', st2.damage)}${bar('RATE', st2.rate)}${bar('RANGE', st2.range)}</div></div>
        <div class="lo-card eq"><span class="lo-k">TACTICAL</span><img src="${eIcon(r.tactical)}" alt=""><div class="lo-card-name">${r.tactical.name}</div><div class="lo-card-type">${r.tactical.passive ? 'PASSIVE' : 'x' + r.tactical.count}</div><div class="lo-card-desc">${r.tactical.desc}</div></div>
        <div class="lo-card eq"><span class="lo-k">LETHAL</span><img src="${eIcon(r.lethal)}" alt=""><div class="lo-card-name">${r.lethal.name}</div><div class="lo-card-type">x${r.lethal.count}</div><div class="lo-card-desc">${r.lethal.desc}</div></div>
      </div>`;
    renderStreaks();
  };
  const renderStreaks = () => {
    sp.innerHTML = '';
    [['STARTER', streaks.starter, 0, 'starter'], ['MEDIUM', streaks.medium, 1, 'medium'], ['POWERFUL', streaks.powerful, 2, 'powerful']].forEach(([title, arr, i, tier]) => {
      const t = document.createElement('div'); t.className = 'streak-tier'; t.innerHTML = `<h4>${title}</h4><div class="st-row"></div>`; const row = t.querySelector('.st-row');
      for (const s of arr) { const o = document.createElement('div'); o.className = `st-tile ${picks[i] === s.id ? 'on' : ''}`; o.title = s.desc; o.innerHTML = `<img src="${streakIcon(s.effect, picks[i] === s.id ? TIER_COLORS[tier] : '#d8d8e0')}" alt=""><span class="st-name">${s.name}</span><b class="st-cost">${s.cost}</b>`; o.onclick = () => { picks[i] = s.id; sfx('click'); render(); emit(); }; row.appendChild(o); }
      const cur = arr.find((x) => x.id === picks[i]); const dd = document.createElement('div'); dd.className = 'st-desc'; dd.textContent = cur ? `${cur.name} — ${cur.desc}` : ''; t.appendChild(dd);
      sp.appendChild(t);
    });
  };
  const emit = () => { save.lastStreaks = save.lastStreaks || {}; save.lastStreaks[mapId] = picks.slice(); save.lastLoadout = sel; persist(); onPick({ loadoutId: sel, streaks: picks.slice() }); };
  render(); emit();
  $('loadout-ready').onclick = () => { sfx('ui'); hide('screen-loadout'); onReady(); };
}
export function loadoutTimer(t) { $('loadout-timer').textContent = t > 0 ? `MATCH STARTS IN ${Math.ceil(t)}` : 'MATCH LIVE'; }
export function hideLoadoutSelector() { hide('screen-loadout'); }

// ---------------- scoreboard ----------------
export function renderScoreboard(match, final = false) {
  const sb = $('scoreboard'); const m = match; const p = m.player;
  const row = (a, i) => `<tr class="${a.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td>${a.name}</td><td class="num">${a.score}</td><td class="num">${m.mode.id === 'gungame' ? a.gunGameIndex : a.kills}</td><td class="num">${a.deaths}</td><td class="num">${a.assists}</td></tr>`;
  const head = `<tr><th>#</th><th>PLAYER</th><th>SCORE</th><th>${m.mode.id === 'gungame' ? 'GUN' : 'KILLS'}</th><th>DEATHS</th><th>ASSISTS</th></tr>`;
  const rank = m.ranking();
  let html = `<div class="sb-title"><span>${m.mode.name} — ${m.map.def.name.toUpperCase()}</span><span>${final ? 'FINAL' : ''}</span></div>`;
  if (m.mode.teams) html += `<div class="sb-teams">${[0, 1].map((t) => `<div class="sb-team t${t}"><h3>${t === 0 ? 'BLUE CREW' : 'RED CREW'} — ${m.teamScore[t]}</h3><table class="sb">${head}${rank.filter((a) => a.team === t).map(row).join('')}</table></div>`).join('')}</div>`;
  else html += `<table class="sb">${head}${rank.map(row).join('')}</table>`;
  if (!final) html += `<div style="margin-top:10px;text-align:right"><button class="pill" id="sb-quit">QUIT MATCH</button></div>`;
  sb.innerHTML = html; return sb;
}
export function showScoreboard(match, onQuit) { renderScoreboard(match); show('screen-scoreboard'); const q = $('sb-quit'); if (q) q.onclick = onQuit; }
export function hideScoreboard() { hide('screen-scoreboard'); }

// ---------------- results ----------------
let podium = null;
export function showResults(result, match, payout, wallet, onAgain, onMenu) {
  hideAll(); show('screen-results');
  const t = $('results-title'); t.className = 'results-title ' + (result.win ? 'win' : result.draw ? 'draw' : 'lose');
  t.textContent = match.mode.teams ? (result.win ? 'VICTORY' : result.draw ? 'DRAW' : 'DEFEAT') : (result.place === 1 ? 'WINNER' : `#${result.place} PLACE`);
  const p = match.player; $('results-sub').textContent = `${match.mode.name} · ${match.map.def.name.toUpperCase()} · ${p.kills} KILLS / ${p.deaths} DEATHS · BEST STREAK ${p.bestStreak}`;
  $('results-board').innerHTML = renderScoreboard(match, true).innerHTML;
  $('results-bet').innerHTML = match.bet > 0 ? (payout > 0 ? `<span class="won">BET WON +$${payout}</span>` : `<span class="lost">BET LOST -$${match.bet}</span>`) + ` <span style="color:#9a9aa3;font-size:14px">BANKROLL $${wallet}</span>` : `<span style="color:#9a9aa3;font-size:14px">NO BET · BANKROLL $${wallet}</span>`;
  podium = podium || new Podium($('results-podium')); podium.show(match);
  $('results-again').onclick = () => { podium.hide(); sfx('ui'); onAgain(); }; $('results-menu').onclick = () => { podium.hide(); sfx('ui'); onMenu(); };
}

// ---------------- dialogs ----------------
export function closeDialog() { hide('screen-dialog'); }
export function openDialog(title, bodyHtml, onClose) { show('screen-dialog'); $('dialog-title').textContent = title; $('dialog-body').innerHTML = bodyHtml; $('dialog-close').onclick = () => { sfx('click'); closeDialog(); onClose && onClose(); }; }

export function openControls(mobile, onClose, input = null) {
  const touchRows = [['Move', 'Left joystick (push to the edge to sprint)'], ['Look', 'Drag anywhere on the right half'], ['Fire', 'Red button (drag it to aim while firing)'], ['ADS', 'ADS button (toggle)'], ['Jump / Duck / Peek', 'Buttons above fire'], ['Prone / Slide', 'Double-tap DUCK to go prone · DUCK while running to slide'], ['Swap / Reload', 'Small buttons'], ['Lethal / Tactical', 'LETHAL and TAC buttons'], ['Score streaks', 'Tap the streak icons bottom-left'], ['Scoreboard', 'SCORE button at the top']];
  const kbRows = [['Move', '<kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>'], ['Look / Fire / ADS', 'Mouse · <kbd>LMB</kbd> · <kbd>RMB</kbd>'], ['Sprint', '<kbd>SHIFT</kbd>'], ['Jump', '<kbd>SPACE</kbd>'], ['Duck', '<kbd>C</kbd> or <kbd>CTRL</kbd>'], ['Prone', 'Double-tap <kbd>C</kbd>'], ['Slide', '<kbd>C</kbd> while sprinting'], ['Peek left / right', '<kbd>Q</kbd> / <kbd>E</kbd>'], ['Switch weapon', '<kbd>1</kbd> <kbd>2</kbd> or scroll / <kbd>V</kbd>'], ['Reload', '<kbd>R</kbd>'], ['Lethal / Tactical', '<kbd>G</kbd> / <kbd>F</kbd>'], ['Score streaks', '<kbd>3</kbd> <kbd>4</kbd> <kbd>5</kbd>'], ['Scoreboard', 'hold <kbd>TAB</kbd>'], ['Loadout (pre-game)', '<kbd>L</kbd>'], ['Pause / release mouse', '<kbd>ESC</kbd>']];
  const t = input ? input.padType : 'xbox'; const g = (n) => btn(t, n);
  const padRows = [['Move', 'Left stick'], ['Look', 'Right stick'], ['Fire', g('RT')], ['Aim down sights', g('LT')], ['Sprint', `Click ${g('LS')}`], ['Jump', g('A')], ['Duck', g('B')], ['Prone', `Double-tap ${g('B')}`], ['Slide', `${g('B')} while sprinting`], ['Reload', g('X')], ['Switch weapon', g('Y')], ['Lethal / Tactical', `${g('RB')} / ${g('LB')}`], ['Peek', `Hold ${g('RS')} (left stick picks the side)`], ['Score streaks', 'D-pad ◀ ▲ ▶'], ['Loadout (pre-game)', 'D-pad ▼'], ['Scoreboard', `Hold ${g('BACK')}`], ['Pause', g('START')], ['Menus', `D-pad or left stick, ${g('A')} select, ${g('B')} back`]];
  const tabs = [[mobile ? 'TOUCH' : 'KEYBOARD & MOUSE', mobile ? touchRows : kbRows], ['CONTROLLER', padRows]];
  let cur = input && input.padActive ? 1 : 0;
  const render = () => {
    $('dialog-body').innerHTML = `<div class="ctl-tabs">${tabs.map((tb, i) => `<button class="ctl-tab ${i === cur ? 'on' : ''}" data-i="${i}">${tb[0]}</button>`).join('')}</div>${cur === 1 ? '<div class="ctl-note">PS5 DualSense and Xbox controllers supported. Plug in or pair, then press any button.</div>' : ''}<table class="controls-table">${tabs[cur][1].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
    $('dialog-body').querySelectorAll('.ctl-tab').forEach((b) => { b.onclick = () => { cur = +b.dataset.i; sfx('click'); render(); }; });
  };
  openDialog('CONTROLS', '', onClose); render();
}
export function openSettings(settings, apply) {
  const s = settings;
  const html = `
    <div class="setting"><label>Player name<small>Shown on the scoreboard</small></label><input type="text" id="st-name" maxlength="14" value="${s.name || ''}" placeholder="YOU"></div>
    <div class="setting"><label>Mouse sensitivity<small>${s.sensitivity.toFixed(2)}</small></label><input type="range" id="st-sens" min="0.2" max="3" step="0.05" value="${s.sensitivity}"></div>
    <div class="setting"><label>Touch sensitivity<small>${s.touchSensitivity.toFixed(2)}</small></label><input type="range" id="st-tsens" min="0.3" max="3" step="0.05" value="${s.touchSensitivity}"></div>
    <div class="setting"><label>Controller sensitivity<small>${(s.padSensitivity ?? 1).toFixed(2)}</small></label><input type="range" id="st-psens" min="0.3" max="2.5" step="0.05" value="${s.padSensitivity ?? 1}"></div>
    <div class="setting"><label>Aim assist<small>Controller only</small></label><div class="toggle" id="st-aa"><button class="${s.aimAssist !== false ? 'on' : ''}" data-v="1">ON</button><button class="${s.aimAssist === false ? 'on' : ''}" data-v="0">OFF</button></div></div>
    <div class="setting"><label>Controller vibration</label><div class="toggle" id="st-vib"><button class="${s.vibration !== false ? 'on' : ''}" data-v="1">ON</button><button class="${s.vibration === false ? 'on' : ''}" data-v="0">OFF</button></div></div>
    <div class="setting"><label>Field of view<small>${s.fov}</small></label><input type="range" id="st-fov" min="60" max="100" step="1" value="${s.fov}"></div>
    <div class="setting"><label>Volume</label><input type="range" id="st-vol" min="0" max="1" step="0.05" value="${s.volume}"></div>
    <div class="setting"><label>Invert look</label><div class="toggle" id="st-inv"><button class="${!s.invertY ? 'on' : ''}" data-v="0">OFF</button><button class="${s.invertY ? 'on' : ''}" data-v="1">ON</button></div></div>
    <div class="setting"><label>ADS</label><div class="toggle" id="st-ads"><button class="${s.adsHold ? 'on' : ''}" data-v="1">HOLD</button><button class="${!s.adsHold ? 'on' : ''}" data-v="0">TOGGLE</button></div></div>
    <div class="setting"><label>Graphics quality<small>Lower this if the game stutters</small></label><select id="st-q"><option value="low" ${s.quality === 'low' ? 'selected' : ''}>LOW</option><option value="medium" ${s.quality === 'medium' ? 'selected' : ''}>MEDIUM</option><option value="high" ${s.quality === 'high' ? 'selected' : ''}>HIGH</option></select></div>`;
  openDialog('SETTINGS', html, () => apply(s));
  const b = $('dialog-body');
  b.querySelector('#st-name').oninput = (e) => { s.name = e.target.value.trim().slice(0, 14) || null; };
  b.querySelector('#st-sens').oninput = (e) => { s.sensitivity = +e.target.value; e.target.previousElementSibling.querySelector('small').textContent = s.sensitivity.toFixed(2); };
  b.querySelector('#st-tsens').oninput = (e) => { s.touchSensitivity = +e.target.value; e.target.previousElementSibling.querySelector('small').textContent = s.touchSensitivity.toFixed(2); };
  b.querySelector('#st-psens').oninput = (e) => { s.padSensitivity = +e.target.value; e.target.previousElementSibling.querySelector('small').textContent = s.padSensitivity.toFixed(2); apply(s); };
  b.querySelector('#st-fov').oninput = (e) => { s.fov = +e.target.value; e.target.previousElementSibling.querySelector('small').textContent = s.fov; };
  b.querySelector('#st-vol').oninput = (e) => { s.volume = +e.target.value; apply(s); };
  b.querySelector('#st-q').onchange = (e) => { s.quality = e.target.value; apply(s); };
  for (const [id, key] of [['st-inv', 'invertY'], ['st-ads', 'adsHold'], ['st-aa', 'aimAssist'], ['st-vib', 'vibration']]) b.querySelector('#' + id).querySelectorAll('button').forEach((btn) => { btn.onclick = () => { s[key] = btn.dataset.v === '1'; btn.parentElement.querySelectorAll('button').forEach((x) => x.classList.remove('on')); btn.classList.add('on'); apply(s); }; });
}
export function openLoadoutEditor() {
  const save = getSave(); let slot = 0;
  const render = () => {
    const c = save.custom[slot] || { name: `CUSTOM ${slot + 1}`, primary: 'stick', secondary: 'nine', tactical: 'flashbang', lethal: 'frag' };
    const opts = (arr, cur, label) => arr.map((w) => `<option value="${w.id}" ${w.id === cur ? 'selected' : ''}>${w.name} — ${w.desc}</option>`).join('');
    $('dialog-body').innerHTML = `<div class="editor"><div class="ed-list">${[0, 1, 2].map((i) => `<div class="lo-item ${i === slot ? 'on' : ''} ${!save.custom[i] ? 'empty' : ''}" data-i="${i}"><div class="lo-name">${save.custom[i]?.name || 'CUSTOM ' + (i + 1)}</div><div class="lo-sub">${save.custom[i] ? WEAPONS[save.custom[i].primary].name + ' · ' + WEAPONS[save.custom[i].secondary].name : 'empty'}</div></div>`).join('')}</div>
      <div class="ed-form">
        <div class="slot-row"><span class="slot-k">NAME</span><input type="text" id="ed-name" maxlength="14" value="${c.name}"></div>
        <div class="slot-row"><span class="slot-k">PRIMARY</span><select id="ed-primary">${opts(PRIMARIES, c.primary)}</select></div>
        <div class="slot-row"><span class="slot-k">SECONDARY</span><select id="ed-secondary">${opts(SECONDARIES, c.secondary)}</select></div>
        <div class="slot-row"><span class="slot-k">TACTICAL</span><select id="ed-tactical">${opts(Object.values(TACTICALS), c.tactical)}</select></div>
        <div class="slot-row"><span class="slot-k">LETHAL</span><select id="ed-lethal">${opts(Object.values(LETHALS), c.lethal)}</select></div>
        <div class="ed-preview"><img id="ed-pv-primary" src="${wIcon(WEAPONS[c.primary])}" alt=""><img id="ed-pv-secondary" src="${wIcon(WEAPONS[c.secondary])}" alt=""><img id="ed-pv-tactical" class="sm" src="${eIcon(TACTICALS[c.tactical])}" alt=""><img id="ed-pv-lethal" class="sm" src="${eIcon(LETHALS[c.lethal])}" alt=""></div>
        <div class="ed-actions"><button class="big-btn" id="ed-save" style="padding:10px 24px;font-size:18px">SAVE</button><button class="pill" id="ed-clear">CLEAR</button></div></div></div>`;
    const b = $('dialog-body');
    b.querySelectorAll('.ed-list .lo-item').forEach((d) => { d.onclick = () => { slot = +d.dataset.i; sfx('click'); render(); }; });
    b.querySelector('#ed-primary').onchange = (e) => { b.querySelector('#ed-pv-primary').src = wIcon(WEAPONS[e.target.value]); };
    b.querySelector('#ed-secondary').onchange = (e) => { b.querySelector('#ed-pv-secondary').src = wIcon(WEAPONS[e.target.value]); };
    b.querySelector('#ed-tactical').onchange = (e) => { b.querySelector('#ed-pv-tactical').src = eIcon(TACTICALS[e.target.value]); };
    b.querySelector('#ed-lethal').onchange = (e) => { b.querySelector('#ed-pv-lethal').src = eIcon(LETHALS[e.target.value]); };
    b.querySelector('#ed-save').onclick = () => { save.custom[slot] = { name: (b.querySelector('#ed-name').value.trim() || `CUSTOM ${slot + 1}`).toUpperCase().slice(0, 14), primary: b.querySelector('#ed-primary').value, secondary: b.querySelector('#ed-secondary').value, tactical: b.querySelector('#ed-tactical').value, lethal: b.querySelector('#ed-lethal').value, desc: 'Custom loadout.' }; persist(); sfx('ui'); render(); };
    b.querySelector('#ed-clear').onclick = () => { save.custom[slot] = null; persist(); sfx('click'); render(); };
  };
  openDialog('CUSTOM LOADOUTS', ''); render();
}
