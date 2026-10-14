'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { installResourceMode } = require('../src/resource-mode');
let nativeId = 0;
const frames = new Map();
const window = {
  addEventListener(type,cb){this.pointer=cb;},removeEventListener(type,cb){if(this.pointer===cb)this.pointer=null;},
  requestAnimationFrame(cb) { frames.set(++nativeId, cb); return nativeId; },
  cancelAnimationFrame(id) { frames.delete(id); },
};
let now = 0;
vm.runInNewContext(`(${installResourceMode})();`, {
  window, performance: { now: () => now },
  setTimeout(cb) { frames.set(++nativeId, cb); return nativeId; },
  clearTimeout(id) { frames.delete(id); },
});
function advance(ts) {
  now = ts;
  const callbacks = [...frames.values()]; frames.clear();
  callbacks.forEach(cb => cb(ts));
}
let count = 0;
function loop() { count++; window.requestAnimationFrame(loop); }
window.requestAnimationFrame(loop);
const cancelled = window.requestAnimationFrame(() => assert.fail('cancelled callback ran'));
window.cancelAnimationFrame(cancelled);
for (let i = 0; i < 60; i++) advance(i * 1000 / 60);
assert.equal(count, 30);
assert.equal(frames.size, 1);
// Match Three r128 UMD: assign an empty export object, then populate it.
window.THREE = {};
let draws = 0, matrices = 0;
class Renderer { constructor() { this.render = () => ++draws; } }
window.THREE.WebGLRenderer = Renderer;
const renderer = new window.THREE.WebGLRenderer();
assert.ok(renderer instanceof Renderer);
const scene = { updateMatrixWorld() { matrices++; } };
const camera = { parent: null, isPerspectiveCamera:true, updateMatrixWorld() { matrices++; } };
renderer.render(scene, camera);
assert.equal(draws, 0);
assert.equal(matrices, 2);
window.__allowDraw = true;
renderer.render(scene, camera);
assert.equal(draws, 1);
window.__allowDraw = false;
renderer.render(scene, camera);
assert.equal(draws, 1);
const before=matrices;for(let n=0;n<10;n++)renderer.render(scene,camera);assert.equal(matrices-before,10,'only camera traverses each frame');
now+=251;const periodic=matrices;renderer.render(scene,camera);assert.equal(matrices-periodic,2,'periodic scene update plus camera');
assert(window.__setFarmResourceProfile({sceneSyncMs:1000}));assert.equal(window.__resourceProfile.targetFps,30);now+=251;const reduced=matrices;renderer.render(scene,camera);assert.equal(matrices-reduced,1,'adaptive scene traversal reduced, camera remains fresh');window.pointer();const refreshed=matrices;renderer.render(scene,camera);assert.equal(matrices-refreshed,1,'input forced full sync without waiting for adaptive interval');assert(window.__setFarmResourceProfile({sceneSyncMs:250}));assert(!window.__setFarmResourceProfile({sceneSyncMs:NaN}));
const input=matrices;window.pointer();assert.equal(matrices-input,1,'pointer input refreshes scene immediately');renderer.dispose();assert.equal(window.pointer,null);
const graded=new window.THREE.WebGLRenderer();window.THREE.Vector3=class{constructor(x,y,z){Object.assign(this,{x,y,z})}project(c){return Object.assign(this,c.point)}};
window.innerWidth=800;window.innerHeight=600;camera.point={x:.5,y:.5,z:0};
let quads=0;const quadScene={updateMatrixWorld(){quads++}},quadCamera={isOrthographicCamera:true,parent:null,updateMatrixWorld(){},point:{x:99,y:99,z:0}};
graded.render(scene,camera);graded.render(quadScene,quadCamera);assert.equal(window.__farmProjectPoint(182,2.6,15.8).x,600,'postprocess camera cannot replace native NPC world projection');
const worldMatrices=matrices;for(let n=0;n<10;n++){graded.render(scene,camera);graded.render(quadScene,quadCamera)}assert.equal(matrices-worldMatrices,10,'grading passes do not force full scene traversal each frame');assert.equal(quads,0,'nondrawing screen quad needs no scene traversal');graded.dispose();
const offscreenWindow={addEventListener(){},removeEventListener(){}};
vm.runInNewContext(`(${installResourceMode})({targetFps:20,skipOffscreen:true});`,{window:offscreenWindow,performance:{now:()=>0},setTimeout(){return 1;},clearTimeout(){}});
const backend=[];
class OffscreenRenderer{
  constructor(){this.target=null;}
  setRenderTarget(target,face,mip){this.target=target;backend.push(['target',target,face,mip]);}
  getRenderTarget(){return this.target;}
  render(){backend.push(['draw',this.target]);}
  clear(){backend.push(['clear',this.target]);}
  readRenderTargetPixels(target,x,y,w,h,pixels){pixels[0]=123;backend.push(['read',target]);return 'pixels';}
  getContext(){return {getExtension:()=>({UNMASKED_RENDERER_WEBGL:1}),getParameter:()=>'ANGLE native test renderer'};}
}
offscreenWindow.THREE={WebGLRenderer:OffscreenRenderer};
const offscreen=new offscreenWindow.THREE.WebGLRenderer(),rt={name:'grading'},pixels=new Uint8Array(4);
offscreen.setRenderTarget(rt,2,3);offscreen.clear();offscreen.render(scene,camera);offscreen.readRenderTargetPixels(rt,0,0,1,1,pixels);
assert.equal(offscreen.getRenderTarget(),rt);assert.equal(pixels[0],0);assert.equal(backend.length,0,'no offscreen GPU commands while farm does not draw');
offscreenWindow.__allowDraw=true;offscreen.render(scene,camera);
assert.deepEqual(backend,[['target',rt,2,3],['draw',rt]],'preview flushes logical target including face/mip before drawing');
offscreen.clear();assert.equal(offscreen.readRenderTargetPixels(rt,0,0,1,1,pixels),'pixels');assert.equal(pixels[0],123,'preview retains native pixel read');
offscreenWindow.__allowDraw=false;const calls=backend.length;offscreen.setRenderTarget(null);assert.equal(offscreen.getRenderTarget(),null);offscreen.clear();assert.equal(backend.length,calls);
offscreenWindow.__allowDraw=true;offscreen.clear();assert.equal(offscreen.target,null,'preview clear restores pending default target');
assert.equal(offscreenWindow.__resourceProfile.skipOffscreen,true);assert.equal(offscreenWindow.__resourceProfile.targetFps,20);
assert.equal(offscreenWindow.__resourceProfile.renderer,'ANGLE native test renderer','actual backend reported without guessing from launch flags');
assert(require('fs').readFileSync('src/instance.js','utf8').includes('skipOffscreen:!!this.pool.opts.softwareUi'),'software-rendered Windows and VPS use the same offscreen guard; hardware profile remains opt-in');
class CssEffect{constructor(iterations,state='running'){this.playState=state;this.effect={target:{isConnected:true},getTiming:()=>({iterations})};}pause(){this.playState='paused';}play(){this.playState='running';}}
const pulse=new CssEffect(Infinity),finite=new CssEffect(1),nativePaused=new CssEffect(Infinity,'paused'),scriptEffect={playState:'running',effect:{getTiming:()=>({iterations:Infinity})},pause(){assert.fail('script animation must stay native');}};
const ambientWindow={CSSAnimation:CssEffect,addEventListener(){},removeEventListener(){}},style={};
let ambientNow=0;
vm.runInNewContext(`(${installResourceMode})({lowUi:true});`,{window:ambientWindow,document:{documentElement:{appendChild(){}},createElement:()=>style,getAnimations:()=>[pulse,finite,nativePaused,scriptEffect]},performance:{now:()=>ambientNow},setTimeout:()=>1,clearTimeout(){}});
ambientWindow.THREE={WebGLRenderer:Renderer};const ambientRenderer=new ambientWindow.THREE.WebGLRenderer();ambientRenderer.render(scene,camera);
assert.equal(pulse.playState,'paused');assert.equal(finite.playState,'running');ambientWindow.__allowDraw=true;ambientRenderer.render(scene,camera);assert.equal(pulse.playState,'running');assert.equal(nativePaused.playState,'paused','preview does not resume a client-paused effect');ambientWindow.__allowDraw=false;ambientRenderer.render(scene,camera);assert.equal(pulse.playState,'paused');
 assert(style.textContent.includes('#overlay>.pop:not(.bossmv),#lootFeed{display:none!important}'),'only decorative overlay/feed have suppressed layout; native boss warning retained');assert(!style.disabled);ambientWindow.__allowDraw=true;ambientRenderer.render(scene,camera);assert.equal(style.disabled,true,'native screenshot restores all decorative layers');ambientWindow.__allowDraw=false;ambientRenderer.render(scene,camera);assert.equal(style.disabled,false,'background returns to cheaper layout');
console.log('PASS: real-time FPS, cancellation, render/offscreen suppression, projection/input matrices, infinite CSS-only pause, finite/script animation preservation, native preview opt-in');

assert(window.__setFarmResourceProfile({sceneSyncMs:1000,targetFps:5}));assert.equal(window.__resourceProfile.targetFps,20,'automatic pressure never drives simulation below20');const ticksBefore=count;for(let n=1;n<=60;n++)advance(now+1000/60);assert(count-ticksBefore>=19&&count-ticksBefore<=21,'adaptive cadence still uses real elapsed time, no synthetic frames');assert(window.__setFarmResourceProfile({sceneSyncMs:250,targetFps:30}));assert.equal(window.__resourceProfile.targetFps,30,'restore configured cadence');
