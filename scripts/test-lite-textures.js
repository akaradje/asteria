'use strict';
const assert=require('assert/strict'),vm=require('vm'),{installResourceMode}=require('../src/resource-mode');
const window={},surface={width:0,height:0};vm.runInNewContext(`(${installResourceMode})({liteTextures:true,targetFps:30})`,{window,document:{createElement:()=>surface},performance:{now:()=>0},setTimeout:()=>1,clearTimeout(){}});
window.THREE={};class Texture{constructor(image){this.image=image;}dispose(){this.disposed=true}}
window.THREE.CanvasTexture=Texture;const source={width:2048,height:2048},a=new window.THREE.CanvasTexture(source),b=new window.THREE.CanvasTexture(source);assert(a instanceof Texture);assert.notEqual(a,b);assert.equal(a.image,surface);assert.equal(surface.width,1);assert.equal(source.width,2048);a.dispose();assert(!b.disposed);assert(window.__liteTextures);console.log('PASS lite textures release retained sprite surfaces while preserving identities/disposal; original canvases unchanged');
