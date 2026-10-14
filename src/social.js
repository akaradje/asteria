// social.js - party, guild, dungeon, trade and pet commands.
//
// Everything in this file rides on ONE fact about the shipped client, read out of it rather
// than guessed:
//
//   asteria-net.js ends with  root.AsteriaNet = NET;  (root === window)
//   NET.social = (t, data) => sendWs(Object.assign({ t }, data));
//
// So `window.AsteriaNet.social('pinv', {name})` puts `{t:'pinv',name}` on the game's own
// websocket. That is the same frame the client sends when a player clicks "เชิญ" in the party
// panel, and it needs no walking, no raycasting and no clicking - which matters because the
// social/dungeon/trade/pet UI has no 3-D NPC at all.
//
// Two other things make this workable:
//
//   * Every panel in `#menu` is a plain DOM button - `#menu button[data-p="social"]` etc. -
//     so a panel opens with one click. (The town *services* are 3-D objects and still need
//     openTownService(); these do not.)
//   * asteria-net.js routes every server frame through `NET.handlers.message`, a single
//     hook. The client already owns it, so we chain to it rather than replace it, and keep a
//     bounded ring buffer of frames for the controller to read back.
//
// Payload shapes, taken from the client's own call sites:
//   pinv {name}   pans {from, ok}   pleave            pkick/plead {aid}
//   ginv {name}   gans {from, ok}   gcreate {name}    gleave   gkick {aid}  grune/grank/gnote/gdon
//   dgq           dgstart {id}      dgjoin {id}       dgquit
//   twq  twstart {aid}  twjoin {aid}  twquit  trq  troffer {…}  trlock  trconfirm  trcancel
//   prq  prbuy {id}  prwear {id}  prquest {…}  prgift {…}  psup {…}
//   bagup  (buy the next bag page)  loginq/loginclaim  opt {…}
'use strict';

/**
 * In-page helpers. Prepended to every evaluate() exactly like H, so selectors stay short and
 * the tap is installed once per page (guarded), no matter how often this runs.
 */
const SOCIAL = `
  const afNet = () => window.AsteriaNet || null;

  // Chain to the client's own frame handler instead of replacing it: the client needs every
  // frame (it drives the UI and the save), we only want a copy.
  if (window.AsteriaNet && !window.__afTap) {
    const tap = { frames: [], latest: {}, max: 500 };
    window.__afTap = tap;
    const prev = window.AsteriaNet.handlers && window.AsteriaNet.handlers.message;
    if (window.AsteriaNet.handlers) {
      window.AsteriaNet.handlers.message = m => {
        try {
          const frame = { at: Date.now(), t: m && m.t, m };
          tap.frames.push(frame);
          if(m?.t) tap.latest[m.t] = frame;
          if (tap.frames.length > tap.max) tap.frames.shift();
        } catch (e) {}
        if (prev) { try { prev(m); } catch (e) {} }
      };
    }
  }

  const afOnline = () => { const n = afNet(); return !!(n && n.isConnected && n.isConnected()); };
  const afSend = (kind, data) => {
    const n = afNet();
    if (!n || !n.social) return { ok: false, reason: 'no-net' };
    if (!afOnline()) return { ok: false, reason: 'offline' };
    try { n.social(kind, data || {}); return { ok: true }; }
    catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
  };
  const afFrames = (t, since) => {
    const tap = window.__afTap; if (!tap) return [];
    return tap.frames.filter(f => (!t || f.t === t) && (!since || f.at > since));
  };
  const afLast = t => { const frames = afFrames(t); const f = window.__afTap?.latest?.[t] || frames[frames.length-1]; return f ? {...f.m, _receivedAt:f.at} : null; };
  const afClear = () => { if (window.__afTap) window.__afTap.frames.length = 0; };

  // Panels live behind the menu buttons; one click, then wait for #pBody to say it opened.
  const afPanelName = () => { const p = document.getElementById('pBody'); return (p && p.dataset.panel) || null; };
  const afOpenPanel = async name => {
    // The current native client calls its settings panel/menu button "menu".
    // Keep the logical name for existing callers, but verify the actual panel
    // identity after clicking; a matching label alone never grants success.
    let panel = name;
    let btn = document.querySelector('#menu button[data-p="' + panel + '"]');
    if (!btn && name === 'settings') {
      panel = 'menu';
      btn = document.querySelector('#menu button[data-p="menu"]');
    }
    if (!btn) return { ok: false, reason: 'no-button' };
    if (afPanelName() === panel && !document.getElementById('panel')?.hidden) {await new Promise(r=>setTimeout(r,600));return { ok: true, already: true, panel };}
    btn.click();
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 120));
      if (afPanelName() === panel) {await new Promise(r=>setTimeout(r,600));return { ok: true, panel };}
    }
    return { ok: false, reason: 'did-not-open', now: afPanelName() };
  };
  const afClosePanel = () => { const c = document.getElementById('pClose'); if (c) c.click(); };
  const afPanelText = () => { const p = document.getElementById('pBody'); return p ? p.innerText : ''; };
  // Click the first button inside the open panel whose text matches.
  const afClickButton = re => {
    const p = document.getElementById('pBody'); if (!p) return false;
    const b = Array.from(p.querySelectorAll('button')).find(x => re.test((x.innerText || '').trim()));
    if (!b) return false;
    b.click(); return true;
  };
  const afInviteCards = () => Array.from(document.querySelectorAll('#invites [data-inv], #invites .inv, #invites > *'))
    .map(el => (el.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean);
`;

/** Thin controller-side wrappers. `inst.eval` is the instance's page.evaluate. */
const api_ = {
  dailyQuotas: inst => inst.eval(`(() => { ${SOCIAL} return [afSend('twq', {}), afSend('gdq', {})]; })()`),
  send: (inst, kind, data) => inst.eval(`(() => { ${SOCIAL} return afSend(${JSON.stringify(kind)}, ${JSON.stringify(data || {})}); })()`),
  online: inst => inst.eval(`(() => { ${SOCIAL} return afOnline(); })()`),
  frames: (inst, t, since) => inst.eval(`(() => { ${SOCIAL} return afFrames(${JSON.stringify(t || null)}, ${Number(since) || 0}).map(f => f.m); })()`),
  last: (inst, t) => inst.eval(`(() => { ${SOCIAL} return afLast(${JSON.stringify(t)}); })()`),
  clear: inst => inst.eval(`(() => { ${SOCIAL} afClear(); return true; })()`),
  panelName: inst => inst.eval(`(() => { ${SOCIAL} return afPanelName(); })()`),
  openPanel: (inst, name) => inst.eval(`(async () => { ${SOCIAL} return await afOpenPanel(${JSON.stringify(name)}); })()`),
  closePanel: inst => inst.eval(`(() => { ${SOCIAL} afClosePanel(); return true; })()`),
  panelText: inst => inst.eval(`(() => { ${SOCIAL} return afPanelText(); })()`),
  clickButton: (inst, source) => inst.eval(`(() => { ${SOCIAL} return afClickButton(new RegExp(${JSON.stringify(source)})); })()`),
  inviteCards: inst => inst.eval(`(() => { ${SOCIAL} return afInviteCards(); })()`),
};

module.exports = { SOCIAL, api: api_ };
