// Controller navigation for every menu: spatial focus with the D-pad / left stick, A to select, B to go back,
// Start to confirm, LB/RB to cycle loadouts. Gameplay controller input is blocked while a menu is open.
import { PAD } from '../core/input.js';
import { btn } from './padglyphs.js';
import { sfx } from '../audio/sfx.js';

const $ = (id) => document.getElementById(id);
const shown = (id) => !$(id).classList.contains('hidden');
const vis = (el) => !!el && el.getClientRects().length > 0;
const SEL = 'button, .mode-panel, .lo-item, .st-tile, .chip, select, input';

export class PadNav {
  constructor(input) {
    this.input = input; this.ctx = null; this.focused = null; this.dir = null; this.repeatT = 0; this.wasActive = false; this.hintKey = '';
    this.hints = $('pad-hints');
  }
  context() {
    if (shown('screen-dialog')) return 'dialog';
    if (shown('screen-loadout')) return 'loadout';
    if (shown('screen-results')) return 'results';
    if (shown('screen-lobby')) return 'lobby';
    if (shown('screen-modes')) return 'modes';
    if (shown('screen-title')) return 'title';
    return null;
  }
  root(ctx) { return { dialog: $('dialog'), loadout: $('screen-loadout'), results: $('screen-results'), lobby: $('screen-lobby'), modes: $('screen-modes'), title: $('screen-title') }[ctx]; }
  focusables(ctx) {
    if (!ctx) return [];
    return [...this.root(ctx).querySelectorAll(SEL)].filter((e) => vis(e) && !e.disabled && !(ctx === 'loadout' && e.classList.contains('lo-item') && e.classList.contains('empty')));
  }
  defaultFocus(ctx, els) {
    const pick = (sel) => els.find((e) => e.matches(sel));
    if (ctx === 'title') return null;
    if (ctx === 'modes') return pick('.mode-panel');
    if (ctx === 'lobby') return pick('.chip.on') || pick('.chip') || pick('button');
    if (ctx === 'loadout') return pick('.lo-item.on') || els[0];
    if (ctx === 'results') return pick('#results-again') || els[0];
    if (ctx === 'dialog') return pick('#p-resume') || els.find((e) => e.id !== 'dialog-close') || els[0];
    return els[0] || null;
  }
  setFocus(el, quiet = false) {
    if (this.focused === el) return;
    if (this.focused) this.focused.classList.remove('pad-focus');
    this.focused = el || null;
    if (el) { el.classList.add('pad-focus'); try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* ignore */ } if (!quiet) sfx('click', { vol: 0.25 }); }
  }
  update(dt) {
    const inp = this.input; const ctx = this.context();
    inp.menuActive = !!ctx;
    if (ctx !== this.ctx) { this.ctx = ctx; this.setFocus(null, true); this.needDefault = true; this.dir = null; }
    this.renderHints(ctx);
    if (!inp.padActive) { if (this.wasActive) this.setFocus(null, true); this.wasActive = false; return; }
    if (!this.wasActive) { this.wasActive = true; this.needDefault = true; }
    if (!ctx || !inp.pad) return;
    let els = this.focusables(ctx);
    if (this.focused && !this.focused.isConnected) this.focused = null;
    if (!this.focused && this.needDefault) { this.setFocus(this.defaultFocus(ctx, els), true); this.needDefault = false; }
    // direction with auto-repeat (D-pad or left stick)
    const held = inp.padPrev, ax = inp.padAxes;
    let d = null;
    if (held[PAD.UP] || ax[1] < -0.6) d = 'up'; else if (held[PAD.DOWN] || ax[1] > 0.6) d = 'down'; else if (held[PAD.LEFT] || ax[0] < -0.6) d = 'left'; else if (held[PAD.RIGHT] || ax[0] > 0.6) d = 'right';
    if (d !== this.dir) { this.dir = d; if (d) { this.navigate(d, ctx, els); this.repeatT = 0.38; } }
    else if (d) { this.repeatT -= dt; if (this.repeatT <= 0) { this.navigate(d, ctx, els); this.repeatT = 0.11; } }
    const J = inp.padJust;
    if (J.has(PAD.A)) this.activate(ctx, this.focusables(ctx));
    else if (J.has(PAD.B)) this.back(ctx);
    else if (J.has(PAD.START)) this.start(ctx);
    else if (ctx === 'loadout' && (J.has(PAD.LB) || J.has(PAD.RB))) this.cycleLoadout(J.has(PAD.RB) ? 1 : -1);
  }
  navigate(d, ctx, els) {
    const f = this.focused;
    if (f && (d === 'left' || d === 'right') && (f.tagName === 'SELECT' || (f.tagName === 'INPUT' && f.type === 'range'))) { this.adjust(f, d === 'right' ? 1 : -1); return; }
    if (!f || !els.includes(f)) { const def = this.defaultFocus(ctx, els) || els[0]; if (def) this.setFocus(def); return; }
    const r = f.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bs = Infinity;
    for (const e of els) {
      if (e === f) continue;
      const q = e.getBoundingClientRect(), dx = q.left + q.width / 2 - cx, dy = q.top + q.height / 2 - cy;
      const primary = d === 'left' ? -dx : d === 'right' ? dx : d === 'up' ? -dy : dy;
      const ortho = d === 'left' || d === 'right' ? Math.abs(dy) : Math.abs(dx);
      if (primary <= 4) continue;
      const score = primary + ortho * 2.2;
      if (score < bs) { bs = score; best = e; }
    }
    if (best) this.setFocus(best);
  }
  adjust(el, dir) {
    if (el.tagName === 'SELECT') { const n = el.options.length; el.selectedIndex = (el.selectedIndex + dir + n) % n; el.dispatchEvent(new Event('change', { bubbles: true })); }
    else { const step = +el.step || 1; el.value = String(+el.value + dir * step); el.dispatchEvent(new Event('input', { bubbles: true })); }
    sfx('click', { vol: 0.3 });
  }
  /** Click an element and keep focus on the same slot if the click re-rendered the list. */
  clickKeep(el, ctx) {
    const before = this.focusables(ctx); const idx = before.indexOf(this.focused);
    el.click();
    const now = this.context();
    if (now !== ctx) return;
    if (!this.focused || !this.focused.isConnected) { const after = this.focusables(ctx); this.focused = null; if (after[idx]) this.setFocus(after[idx], true); }
  }
  activate(ctx, els) {
    const f = this.focused;
    if (!f) {
      if (ctx === 'title') { $('screen-title').dispatchEvent(new MouseEvent('click', { bubbles: true })); return; }
      const def = this.defaultFocus(ctx, els); if (def) this.setFocus(def); return;
    }
    if (f.tagName === 'INPUT' && f.type === 'text') { f.focus(); return; }
    if (f.tagName === 'INPUT' && f.type === 'range') return;
    if (f.tagName === 'SELECT') { this.adjust(f, 1); return; }
    this.clickKeep(f, ctx);
  }
  back(ctx) {
    const tryClick = (sel) => { const e = document.querySelector(sel); if (vis(e)) { e.click(); return true; } return false; };
    if (ctx === 'dialog') tryClick('#dialog-close');
    else if (ctx === 'loadout') tryClick('#loadout-ready');
    else if (ctx === 'lobby') tryClick('#lobby-cancel');
    else if (ctx === 'modes') tryClick('#screen-modes [data-back]');
    else if (ctx === 'results') tryClick('#results-menu');
  }
  start(ctx) {
    const tryClick = (sel) => { const e = document.querySelector(sel); if (vis(e)) { e.click(); return true; } return false; };
    if (ctx === 'dialog') { if (!tryClick('#p-resume')) tryClick('#dialog-close'); }
    else if (ctx === 'loadout') tryClick('#loadout-ready');
    else if (ctx === 'title') $('screen-title').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    else if (ctx === 'results') tryClick('#results-again');
  }
  cycleLoadout(dir) {
    const items = [...$('loadout-list').querySelectorAll('.lo-item:not(.empty)')]; if (!items.length) return;
    const i = Math.max(0, items.findIndex((e) => e.classList.contains('on')));
    const next = items[(i + dir + items.length) % items.length];
    const onList = this.focused && this.focused.classList.contains('lo-item');
    this.clickKeep(next, 'loadout');
    if (onList) { const on = $('loadout-list').querySelector('.lo-item.on'); if (on) this.setFocus(on, true); }
  }
  renderHints(ctx) {
    const t = this.input.padType; const key = (ctx || '') + t;
    if (key === this.hintKey) return; this.hintKey = key;
    const H = {
      title: '',
      modes: `${btn(t, 'A')} SELECT <i></i> ${btn(t, 'B')} BACK`,
      lobby: `${btn(t, 'A')} BET <i></i> ${btn(t, 'B')} CANCEL`,
      loadout: `${btn(t, 'A')} SELECT <i></i> ${btn(t, 'LB')}${btn(t, 'RB')} LOADOUT <i></i> ${btn(t, 'B')} READY`,
      dialog: `${btn(t, 'A')} SELECT <i></i> ◀ ▶ ADJUST <i></i> ${btn(t, 'B')} BACK`,
      results: `${btn(t, 'A')} SELECT <i></i> ${btn(t, 'B')} MAIN MENU`,
    };
    this.hints.innerHTML = ctx ? H[ctx] : '';
    this.hints.classList.toggle('on', !!(ctx && H[ctx]));
  }
}
