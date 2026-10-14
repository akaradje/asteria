'use strict';

// Windows controller; installed only for --machine=windows with runtime-v2.
function installWindowsRuntime(GameInstance) {
  const proto = GameInstance.prototype;
  if (Object.hasOwn(proto, '_windowsRuntime')) return;
  Object.defineProperty(proto, '_windowsRuntime', { value: true });
  const run = proto.run, walkTo = proto.walkTo, screen = proto.screen, launch = proto.launch;
  proto.launch = async function () {
    await launch.call(this);
    await this.ctx.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, options) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.origin !== location.origin || url.pathname !== '/api/health') return originalFetch(input, options);
        // The client gives health detection only 3s, then starts offline. A third
        // renderer's startup can exceed that; keep a bounded 15s online handshake.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try { return await originalFetch(input, {...options, signal:controller.signal}); }
        finally { clearTimeout(timer); }
      };
    });
  };
  proto.screen = async function () {
    const state = await screen.call(this);
    if (state.startVisible && !state.inGame && !state.loading && !state.lgGuest
        && !state.srvGo && !state.csGo && Date.now() - (this.windowsStartClickAt || 0) > 5000) {
      const action = await this.eval(`(() => {
        const b = document.getElementById('startBtn');
        if (!b || b.disabled || b.hidden || !b.getClientRects().length) return false;
        if (!window.AsteriaNet?.online) return 'offline';
        b.click(); return 'online';
      })()`);
      if (action) this.windowsStartClickAt = Date.now();
      if (action === 'online') this.log('windows: online landing screen -> start adventure');
      if (action === 'offline') {
        this.windowsOfflineReloads = (this.windowsOfflineReloads || 0) + 1;
        if (this.windowsOfflineReloads > 3) throw Error('Server detection failed: refusing offline play');
        this.log('windows: server detection fell back to offline -> retry online boot', 'warn');
        await this.page.reload({waitUntil:'domcontentloaded'});
      }
    }
    if (state.inGame) this.windowsOfflineReloads = 0;
    return state;
  };

  proto.chainWalkTo = async function (mapId) {
    const start = this.livePos && Date.now() - this.livePos.at < 15000
      ? this.livePos.room : this.lastSave?.mapId;
    let observed;
    if(this.runtimeV2){
      try{const state=JSON.parse(require('fs').readFileSync(require('path').join(this.root,'logs/game-knowledge/state.json'),'utf8'));
        const loaded=require('path').basename(this.cache.dir);
        observed=require('../../src/runtime/observed-routes').loadedRoutes(this.root,loaded,this.loadedSourceIdentity?.());
        if(!observed)return false;
        // Routes belong to the loaded client, including during a live update.
      }catch{return false;}
    }
    const path = require('../../src/runtime/observed-routes').route(start || 'town', mapId,observed);
    if (!path) return false;
    this.log(`windows route: ${start || 'town'} -> ${mapId} via ${path.map(g => g.target).join(' -> ')}`);
    await this.expeditionAuto(false);
    for (const gate of path) {
      const crossing=await require('../../src/runtime/gate-walk').cross(this,gate,{from:this.livePos?.room,to:gate.target,timeoutMs:150000});
      if(crossing?.reason==='dead'||crossing?.reason==='campaign-deadline')return false;
      // The position socket, rather than save metadata, confirms each warp.
      const until = Date.now() + 3000;
      while (Date.now() < until && this.livePos?.room !== gate.target) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (this.livePos?.room !== gate.target || Date.now() - this.livePos.at > 8000) {
        this.log(`windows route: stopped at ${this.livePos?.room}, expected ${gate.target}`, 'warn');
        return false;
      }
    }
    this.brain.arrived(mapId);
    await this.expeditionAuto(true);
    return true;
  };

  proto.run = async function (options) {
    while (this.status !== 'stopping') {
      try { return await run.call(this, options); }
      catch (error) {
        if (this.status === 'stopping') return;
        if (!/evaluate timed out/.test(error.message)) throw error;
        if (!require('../../src/runtime/renderer-health').stalledRenderer(this)) {
          this.windowsTimeoutStatus = {at:Date.now(),state:'awaiting-evidence',reason:'single controller timeout is not proof of a frozen renderer'};
          this.log('windows: controller timeout -> retain session; await live evidence', 'warn');
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        this.log('windows: repeated renderer timeouts with stale screen/save -> recover in place', 'warn');
        const recovered = await this.recycle('windows controller timeout');
        if (recovered) this.pendingTravel = null;
      }
    }
  };

  proto.walkTo = async function (x, z, options = {}) {
    const start = this.livePos?.room;
    const originalAbort = options.abort;
    return walkTo.call(this, x, z, {
      ...options,
      // Gates trigger within 1.6 units. Stopping at 1.8 can leave a walker outside.
      tolerance: Math.min(options.tolerance ?? 1.5, 1.0),
      abort: async () => {
        const pos = this.livePos;
        if (start && pos?.room && pos.room !== start && Date.now() - pos.at < 8000) return true;
        return originalAbort ? originalAbort() : false;
      },
    });
  };

  proto.travelTo = async function (mapId) {
    // chainWalkTo already attempted real gates. The world-map GO fallback is known
    // not to move out of town; do not leave a fictitious three-minute pending trip.
    this.pendingTravel = null;
    if (this.brain.travelFailure(mapId)) {
      this.goal = null;
      this.teamGoal = null;
      this.refreshGoal();
    }
    this.log(`windows: gate route to ${mapId} incomplete; resume from actual room on next attempt`, 'warn');
    if(this.livePos?.room && this.livePos.room !== 'town') await this.enableAuto();
    else await this.expeditionAuto(false);
    return { ok: false, reason: 'gate route incomplete' };
  };
}

module.exports = { installWindowsRuntime };
