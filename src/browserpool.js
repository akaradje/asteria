// browserpool.js - ONE Chromium browser for the whole farm; every window runs in its own
// isolated BrowserContext.
//
// Six separate browsers paid the per-instance overhead (browser + GPU + network + utility
// processes) six times over, on top of the ~550 MB renderer that actually plays the game.
// A shared browser pays it once. Contexts in Playwright are fully isolated from each other
// (cookies, localStorage, IndexedDB, service workers), which is exactly what keeps six
// accounts from seeing one another - and login does not depend on the old per-window
// profile anyway: GameInstance re-injects the token from the account file on every boot.
//
// Failure model: a renderer crash takes down one window (the supervisor respawns it); the
// shared browser dying takes down all of them at once, and every control loop throws and
// respawns through the existing restart path, relaunching the browser on the way.
'use strict';

const { chromium } = require('playwright');

const LAUNCH_ARGS = ['--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  // Occlusion calculation is meaningless headless, and the back-forward cache (where the
  // build keeps it) retains a FULL copy of the old document after every reload (hardReload,
  // boot retries) - pure waste for a bot that never navigates back or forward.
  '--disable-features=CalculateNativeWinOcclusion,BackForwardCache',
  '--disable-breakpad',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--mute-audio',
  '--hide-scrollbars',
  '--use-angle=d3d11',
  '--enable-unsafe-swiftshader',
];

// With draw calls suppressed there is nothing for the GPU to do, and the headless shell's GPU
// process is what makes one window cost gigabytes: measured at 2.7-3.5 GB per window, against
// ~550 MB for the renderer. Turning the GPU off hands WebGL to SwiftShader, which is pure CPU -
// fine when the only work left is keeping a WebGL context alive.
const NO_GPU_ARGS = [
  '--disable-gpu',
  '--disable-gpu-compositing',
  '--disable-gpu-rasterization',
  '--disable-accelerated-2d-canvas',
];

// Software-rendering overhead flags. With the GPU process shared, a renderer whose frame
// cannot be rastered blocks on it - which is exactly how these windows hang: main thread
// at 10% CPU, not answering evaluate(). These remove the cross-thread handshakes and
// speculative work that make that hand-off expensive, so a busy raster thread costs the
// renderer latency instead of a stall.
const LOW_OVERHEAD_ARGS = [
  '--disable-threaded-animation',
  '--disable-threaded-scrolling',
  '--disable-checker-imaging',
  '--disable-image-animation-resync',
  '--disable-partial-raster',
  '--disable-lcd-text',
  '--num-raster-threads=2',
];

function buildLaunchArgs(opts,platform=process.platform){
 const args=(opts.noDraw&&opts.noGpu?LAUNCH_ARGS.concat(NO_GPU_ARGS):LAUNCH_ARGS.slice()).concat(LOW_OVERHEAD_ARGS);
 if(platform!=='win32'||opts.noGpu){const at=args.indexOf('--use-angle=d3d11');if(at>=0)args.splice(at,1);if(opts.noGpu)args.push('--use-angle=swiftshader');}
 // Hybrid Windows machines otherwise choose Intel/shared system RAM even when
 // a dedicated NVIDIA GPU is available. Scope the preference to this farm's
 // browser; preserve explicit software fallback and Linux profiles.
 if(platform==='win32'&&!opts.noGpu)args.push('--force-high-performance-gpu');
 // Windows with an explicitly enabled hardware GPU can raster its lightweight
 // UI on that GPU. Linux software profiles retain their existing CPU policy.
 if(opts.softwareUi&&!opts.noGpu&&platform!=='win32')args.push('--disable-gpu-compositing','--disable-gpu-rasterization','--disable-accelerated-2d-canvas');
 if(opts.gpuMemoryMb){const mb=Number(opts.gpuMemoryMb);if(!Number.isInteger(mb)||mb<256||mb>2048)throw Error('GPU resource budget must be 256..2048 MB');args.push(`--force-gpu-mem-available-mb=${mb}`,`--force-gpu-mem-discardable-limit-mb=${Math.min(128,mb/4)}`,'--gpu-program-cache-size-kb=16384');}
 return args;
}

class BrowserPool {
  constructor(opts = {}) {
    this.opts = opts;          // headless, noDraw, noGpu, fullChrome, splitBrowsers, log
    this.browser = null;
    this.launching = null;     // serialises (re)launches when many windows recover at once
    this.refs = 0;             // live contexts
    this.idleTimer = null;
    this.log = opts.log || (() => { });
    // Minimum spacing between context creations. Steady-state traffic never queues: farm
    // boot staggers itself (launchStaggerMs, 12s) and a recycle acquires alone. But when the
    // shared browser dies, every window respawns at once and six simultaneous full boots
    // would spike RAM and CPU at the exact moment the machine is most fragile - so burst
    // arrivals are queued and let through one per minAcquireGapMs instead.
    this.minAcquireGapMs = opts.minAcquireGapMs || 5000;
    this.lastAcquireAt = 0;
    this.chain = Promise.resolve();
  }

  /**
   * Open a fresh, empty context for one window. The caller wires up its own init script and
   * asset cache on the returned context; nothing here is shared between windows.
   */
  acquire(viewport,runtimeOwner) {
    // Serialise context creation and pace it (see minAcquireGapMs). Chained rather than a
    // raw queue so each acquire keeps its own rejection path.
    const next = this.chain.then(() => this._acquireNow(viewport,runtimeOwner));
    this.chain = next.catch(() => { });          // keep the chain alive when one acquire fails
    return next;
  }

  async _acquireNow(viewport,runtimeOwner) {
    clearTimeout(this.idleTimer);
    const wait = this.minAcquireGapMs - (Date.now() - this.lastAcquireAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    const browser = this.opts.splitBrowsers
      // A dedicated browser (and so a dedicated GPU process) per window. Shared mode funnels
      // every window's compositing through ONE gpu-process: measured 86% CPU and saturated,
      // which starves all six renderers at once - their main threads sit idle waiting on it,
      // so evaluate() times out and windows go "unresponsive" while using no CPU of their own.
      // Separate browsers give each window its own raster thread to spread over the cores.
      ? await this._launch(runtimeOwner)
      : await this._ensureBrowser(runtimeOwner);
    if(runtimeOwner)require('./registry/browser-ownership').associate(runtimeOwner.root,runtimeOwner.owner,browser.__asteriaOwnerMarker);
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    if (this.opts.splitBrowsers) ctx.__ownBrowser = browser;
    if(runtimeOwner){try{await require('./registry/browser-ownership').track(ctx,runtimeOwner.root,runtimeOwner.owner,browser.__asteriaOwnerMarker);}catch(e){await this.release(ctx);throw e;}}
    this.lastAcquireAt = Date.now();
    this.refs++;
    return ctx;
  }

  /** Close one window's context. Safe to call on an already-dead context. */
  async release(ctx) {
    if(!ctx||ctx.__releaseComplete)return;
    if(ctx.__releasePending)return ctx.__releasePending;
    const closing=this._releaseOwned(ctx);ctx.__releasePending=closing;
    try{return await closing;}finally{ctx.__releasePending=null;}
  }

  async _releaseOwned(ctx) {
    const close=require('./runtime/bounded-close').boundedClose;
    const own = ctx && ctx.__ownBrowser;
    let contextError;try { await close(()=>ctx.close()); } catch(e) {contextError=e;}
    if (own) {
      // A split-mode browser exists only for this window, so it dies with it.
      // A hung context must not prevent this owned browser closing. Failure
      // remains explicit: the supervisor may not start a duplicate session.
      await close(()=>own.close());
    } else if(contextError){throw contextError;}
    this.refs = Math.max(0, this.refs - 1);ctx.__releaseComplete=true;require('./registry/browser-ownership').closed(ctx);
    if (!own) {
      // Grace period rather than instant close: a recycle releases one context and acquires the
      // next seconds later, so a momentarily-idle browser must not be torn down. Only a real
      // stop-all leaves the pool idle for long.
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => { if (this.refs <= 0) this.shutdown(); }, 30000);
      if (this.idleTimer.unref) this.idleTimer.unref();
    }
  }

  async _ensureBrowser(runtimeOwner) {
    if (this.browser && this.browser.isConnected()) return this.browser;
    if (this.launching) return this.launching;
    this.launching = this._launch(runtimeOwner);
    try { return await this.launching; } finally { this.launching = null; }
  }

  async _launch(runtimeOwner) {
    const args = buildLaunchArgs(this.opts);
    const marker=runtimeOwner?require('./registry/browser-ownership').intent(runtimeOwner.root,runtimeOwner.owner):null;if(marker)args.push('--asteria-owner='+marker);
    this.log(`shared browser: launching (${args.includes('--disable-gpu') ? 'GPU off - SwiftShader' : 'GPU on'})`, 'warn');
    const browser = await chromium.launch({
      headless: this.opts.headless,
      // The full Chromium build (chrome.exe with --headless=new) instead of the stripped
      // headless shell. The shell's GPU process is what balloons to gigabytes per window, so
      // this is worth having as an option.
      channel: this.opts.fullChrome ? 'chromium' : undefined,
      args,
      ignoreDefaultArgs: ['--enable-automation'],
    });
    browser.__asteriaOwnerMarker=marker;
    if (this.opts.splitBrowsers) {
      // Owned by one window (see acquire); the pool must not track or close it.
      return browser;
    }
    this.closing = false;
    browser.on('disconnected', () => {
      if (this.closing) return;              // our own shutdown - not a crash
      // Crash or external kill: forget it so the next acquire relaunches. The windows already
      // hold dead contexts; their loops throw and respawn, and each respawn lands on the
      // freshly relaunched browser.
      if (this.browser === browser) this.browser = null;
      this.log('shared browser: connection lost - windows will relaunch onto a new one', 'warn');
    });
    this.browser = browser;
    return browser;
  }

  /** Kill the browser process. Called on farm stop, or by the idle timer after the last window. */
  async shutdown() {
    clearTimeout(this.idleTimer);
    this.closing = true;
    const b = this.browser;
    this.browser = null;
    if (b) {
      this.log('shared browser: closing');
      try { await b.close(); } catch { }
    }
  }
}

let DEFAULT = null;
// Probes and measure scripts build GameInstance directly, without a supervisor; they share a
// process-wide default pool so a one-window run behaves exactly like the farm.
function sharedPool(opts) {
  if (!DEFAULT) DEFAULT = new BrowserPool(opts);
  return DEFAULT;
}

module.exports = { BrowserPool, sharedPool, LAUNCH_ARGS, NO_GPU_ARGS, LOW_OVERHEAD_ARGS, buildLaunchArgs };
