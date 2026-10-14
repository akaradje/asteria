'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{chromium}=require('playwright'),{AssetCache}=require('../src/assetcache');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-art-browser-'));let browser;try{
 const cache=new AssetCache(root,'test',{liteWorldArt:true});let handler;await cache.install({route:async(_,fn)=>{handler=fn}},{origin:'https://asteria-online.io'});let body;
 await handler({request:()=>({url:()=> 'https://asteria-online.io/asteria-online-sprites/monsters/test.png',method:()=> 'GET'}),fulfill:async r=>{body=r.body}});
 const build=require('../src/economy').newestBuild(path.resolve(__dirname,'..'));
 const source=fs.readFileSync(path.join(__dirname,'../cache',build,'asteria-online.io/asteria-online-visual-polish.html'),'utf8'),start=source.indexOf('function walkFramesFromAtlas('),end=source.indexOf('\nfunction sideWalkFramesFromStrip(',start);assert(start>=0&&end>start);
 browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto('about:blank');
 await page.addScriptTag({content:'const mc=(w,h)=>{const c=document.createElement("canvas");c.width=w;c.height=h;return [c,c.getContext("2d",{willReadFrequently:true})]};const tex=c=>({image:c});'+source.slice(start,end)});
 const result=await page.evaluate(async data=>{const load=src=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src;});const i=await load('data:image/png;base64,'+data),frames=walkFramesFromAtlas(i,128,160);return {width:i.naturalWidth,height:i.naturalHeight,directions:Object.keys(frames.directionWalk).length,frames:Object.values(frames.directionWalk).flatMap(Object.values).length};},body.toString('base64'));
 assert.deepEqual(result,{width:128,height:128,directions:8,frames:32});
 console.log('PASS real Chromium and loaded game atlas decoder: 8 directions/32 frames, no zero-sized image reads');
}finally{if(browser)await browser.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
