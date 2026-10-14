'use strict';

// Browser init script: avoid render-list building, texture uploads and shaders.
//
// `targetFps` is a knob because a farm of N windows shares N_cpu cores: with software
// rendering (SwiftShader) every frame costs CPU, and 6 windows at 30fps oversubscribes a
// 4-core box hard enough to freeze renderers (measured: ~280% CPU demand, load 5 on 4
// cores, windows going unresponsive every few minutes). The game advances its simulation by
// frame delta with a cap, so 20fps still runs at full speed - below 20 it goes slow-motion.
function installResourceMode(opts) {
  const initialTargetFps = (opts && Number(opts.targetFps)) > 0 ? Number(opts.targetFps) : 30;
  let targetFps=initialTargetFps,frameMs = 1000 / targetFps;
  let sceneSyncMs=Math.max(250,Math.min(1000,Number(opts?.sceneSyncMs)||250));
  window.__resourceProfile={version:3,targetFps,sceneSyncMs,liteTextures:!!opts?.liteTextures,lowUi:!!opts?.lowUi,skipOffscreen:!!opts?.skipOffscreen};
  // Housekeeping and real-time cadence adapt within the configured rate and
  // full-speed floor. Camera/input projection and socket timing stay current.
  window.__setFarmResourceProfile=value=>{
    if(!Number.isFinite(value?.sceneSyncMs))return false;
    sceneSyncMs=Math.max(250,Math.min(1000,value.sceneSyncMs));
    if(Number.isFinite(value.targetFps)){
      targetFps=Math.min(initialTargetFps,Math.max(20,value.targetFps));frameMs=1000/targetFps;
      window.__resourceProfile.targetFps=targetFps;
    }
    window.__resourceProfile.sceneSyncMs=sceneSyncMs;return true;
  };
  let uiStyle;
  const ambient=new Set();let ambientScanAt=-Infinity,ambientDrawing=false;
  const syncAmbient=draw=>{
    if(!opts?.lowUi||typeof window.CSSAnimation!=='function'||typeof document.getAnimations!=='function')return;
    const now=performance.now();
    if(draw){if(!ambientDrawing)for(const animation of ambient){try{if(animation.playState==='paused')animation.play();}catch{}}ambient.clear();ambientDrawing=true;return;}
    if(!ambientDrawing&&now-ambientScanAt<5000)return;
    ambientDrawing=false;ambientScanAt=now;
    for(const animation of ambient)if(animation.playState==='idle'||animation.effect?.target?.isConnected===false)ambient.delete(animation);
    // Infinite CSS effects are decorative; leave finite transitions/animations
    // and script-driven Web Animations untouched. Preview restores only effects
    // paused by this farm, never an effect the native client already paused.
    for(const animation of document.getAnimations().slice(0,500)){
      if(!(animation instanceof window.CSSAnimation)||animation.playState!=='running'||animation.effect?.getTiming?.().iterations!==Infinity)continue;
      try{animation.pause();ambient.add(animation);}catch{}
    }
    window.__resourceProfile.ambientPaused=ambient.size;
  };
  if(opts?.lowUi){
    // Background farm screenshots are off. Avoid software-compositor blur/shadow
    // passes while preserving layout, animation timing, visibility and input.
    // Keep native nodes/counters and boss warnings available to readers. Only
    // decorative damage numbers and the loot toast feed skip layout/painting.
    // Preview disables this exact style before drawing, restoring the native UI.
    const install=()=>{if(uiStyle)return;uiStyle=document.createElement('style');uiStyle.id='asteria-farm-low-ui';uiStyle.textContent='*,*::before,*::after{backdrop-filter:none!important;filter:none!important;box-shadow:none!important;text-shadow:none!important}#overlay>.pop:not(.bossmv),#lootFeed{display:none!important}';(document.head||document.documentElement).appendChild(uiStyle);};
    if(document.documentElement)install();else window.addEventListener('DOMContentLoaded',install,{once:true});
  }
  let three;
  Object.defineProperty(window, 'THREE', {
    configurable: true,
    get: () => three,
    set(value) {
      three = value;
      if(opts?.liteTextures){
        // Farm mode does not draw the world. Keep texture identities/disposal,
        // but don't retain thousands of generated sprite canvases in memory.
        const surface=document.createElement('canvas');surface.width=surface.height=1;
        const surfaces=new Map(),small=image=>{
          const w=image?.naturalWidth||image?.width||1,h=image?.naturalHeight||image?.height||1;
          if(!(w>0&&h>0&&Number.isFinite(w/h)))return surface;
          const ratio=w/h;if(ratio===1)return surface;
          const width=ratio>=1?8:Math.max(1,Math.round(8*ratio)),height=ratio>=1?Math.max(1,Math.round(8/ratio)):8,key=width+'x'+height;
          if(!surfaces.has(key)){const c=document.createElement('canvas');c.width=width;c.height=height;surfaces.set(key,c);}return surfaces.get(key);
        };
        const wrapTexture=Original=>new Proxy(Original,{construct(Target,args,NewTarget){
          let image=small(args[0]);const texture=Reflect.construct(Target,[image,...args.slice(1)],NewTarget);
          // The client replaces image after asynchronous loading; don't retain that large surface.
          Object.defineProperty(texture,'image',{configurable:true,enumerable:true,get:()=>image,set:next=>{image=small(next);}});return texture;
        }});
        for(const key of ['Texture','CanvasTexture']){let Texture=value[key]?wrapTexture(value[key]):undefined;
          Object.defineProperty(value,key,{configurable:true,enumerable:true,get:()=>Texture,set:Original=>{Texture=wrapTexture(Original);}});
        }
        window.__liteTextures=true;
      }
      let Renderer;
      const wrap = Original => new Proxy(Original, {
        construct(Target, args, NewTarget) {
          const renderer = Reflect.construct(Target, args, NewTarget);
          try{
            const gl=renderer.getContext?.(),ext=gl?.getExtension?.('WEBGL_debug_renderer_info');
            if(ext)window.__resourceProfile.renderer=String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).slice(0,180);
          }catch{}
          const render = renderer.render;
          // The client's grading/minimap passes switch targets and read pixels
          // even when render() is suppressed. Keep their logical target state,
          // avoiding software GPU work until a real preview requests drawing.
          let flushTarget=()=>{};
          if(opts?.skipOffscreen&&typeof renderer.setRenderTarget==='function'){
            const setTarget=renderer.setRenderTarget;
            let targetArgs=[renderer.getRenderTarget?.()??null],pending=false;
            flushTarget=()=>{if(pending){setTarget.apply(renderer,targetArgs);pending=false;}};
            renderer.setRenderTarget=function(...args){targetArgs=args;pending=true;if(window.__allowDraw)flushTarget();};
            renderer.getRenderTarget=()=>targetArgs[0];
            for(const method of ['clear','clearColor','clearDepth','clearStencil','readRenderTargetPixels']){
              const original=renderer[method];if(typeof original!=='function')continue;
              renderer[method]=function(...args){if(!window.__allowDraw)return;flushTarget();return original.apply(this,args);};
            }
          }
          let lastScene=null,lastCamera=null,lastMatrixAt=-Infinity;
          // Read-only projection uses the same camera as the client NPC hit test.
          const project=(x,y,z)=>{
            if(!lastCamera||typeof three.Vector3!=='function')return null;
            const point=new three.Vector3(x,y,z).project(lastCamera);
            return {x:(point.x*.5+.5)*window.innerWidth,y:(-point.y*.5+.5)*window.innerHeight,vis:point.z<1&&point.z> -1};
          };
          // Background farming needs fresh camera projection every frame. Full
          // scene traversal is only needed periodically and before pointer input.
          const sync=()=>{if(lastScene?.autoUpdate!==false)lastScene?.updateMatrixWorld();lastMatrixAt=performance.now();};
          window.addEventListener?.('pointerdown',sync,true);
          const dispose=renderer.dispose;
          renderer.dispose=function(...args){window.removeEventListener?.('pointerdown',sync,true);lastScene=null;lastCamera=null;if(window.__farmProjectPoint===project)delete window.__farmProjectPoint;return dispose?.apply(this,args);};
          renderer.render = function (scene, camera) {
            // Grading draws the world followed by an orthographic screen quad;
            // the minimap uses another orthographic camera. NPC hit-testing uses
            // the world's perspective camera, never the last postprocess pass.
            const worldPass=camera.isPerspectiveCamera===true||!lastCamera&&camera.isOrthographicCamera!==true;
            if(worldPass){lastCamera=camera;window.__farmProjectPoint=project;}
            if(uiStyle)uiStyle.disabled=!!window.__allowDraw;
            syncAmbient(!!window.__allowDraw);
            if (window.__allowDraw) {flushTarget();return render.apply(this, arguments);}
            // Preserve matrices used by projection and raycast-based input.
            const now=performance.now();if(worldPass&&(scene!==lastScene||now-lastMatrixAt>=sceneSyncMs)){lastScene=scene;sync();}
            if (camera.parent === null) camera.updateMatrixWorld();
          };
          window.__resourceMode = 'render-skipped';
          return renderer;
        },
      });
      if (value.WebGLRenderer) Renderer = wrap(value.WebGLRenderer);
      Object.defineProperty(value, 'WebGLRenderer', {
        configurable: true, enumerable: true,
        get: () => Renderer,
        set: Original => { Renderer = wrap(Original); },
      });
    },
  });

  // A headless software compositor can delay native rAF even without drawings.
  // Use monotonic real time, never synthetic game time or catch-up steps.
  const raf = cb => setTimeout(() => cb(performance.now()),
    Math.max(1, frameMs - (performance.now() - last)));
  const cancel = clearTimeout;
  const pending = new Map();
  let id = 0, scheduled = null, last = -Infinity;
  function tick(ts) {
    scheduled = null;
    if (ts - last >= frameMs - 1) {
      last = ts;
      for (const key of [...pending.keys()]) {
        const cb = pending.get(key);
        if (!cb) continue;
        pending.delete(key);
        try { cb(ts); } catch (error) { setTimeout(() => { throw error; }); }
      }
    }
    if (pending.size && scheduled === null) scheduled = raf(tick);
  }
  window.requestAnimationFrame = cb => {
    if (typeof cb !== 'function') throw new TypeError('rAF callback must be a function');
    const key = ++id;
    pending.set(key, cb);
    if (scheduled === null) scheduled = raf(tick);
    return key;
  };
  window.cancelAnimationFrame = key => {
    pending.delete(key);
    if (!pending.size && scheduled !== null) { cancel(scheduled); scheduled = null; }
  };
}

module.exports = { installResourceMode };
