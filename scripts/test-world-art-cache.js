'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {AssetCache}=require('../src/assetcache');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-art-'));try{
 let handler;const cache=new AssetCache(root,'test',{liteWorldArt:true});
 await cache.install({route:async(pattern,fn)=>{handler=fn}},{origin:'https://asteria-online.io'});
 const original=Buffer.from('original protected image');
 async function request(url){let result=null;await handler({request:()=>({url:()=>url,method:()=> 'GET'}),fetch:async()=>({body:async()=>original,ok:()=>true,status:()=>200,headers:()=>({'content-type':'image/png'})}),fulfill:async x=>{result=x},continue:async()=>{result='continue'}});return result;}
 const art=await request('https://asteria-online.io/asteria-online-sprites/town/wall.png');
 assert.equal(art.status,200);assert.equal(art.contentType,'image/png');assert.equal(art.body.readUInt32BE(16),128);assert.equal(art.body.readUInt32BE(20),128);
 const tree=await request('https://asteria-online.io/asteria-online-sprites/tree-pine-v2.png');assert.deepEqual(tree.body,art.body);
 const monster=await request('https://asteria-online.io/asteria-online-sprites/monsters/test.png');assert.deepEqual(monster.body,art.body);
 assert.equal(await request('https://asteria-online.io/api/chars'),'continue');
 assert.equal(await request('https://other.example/asteria-online-sprites/town/wall.png'),'continue');
 assert.deepEqual(fs.readdirSync(cache.dir),[]); // Reduced art does not overwrite full cache.
 for(const folder of ['npc-anim','sheets','v2','wings','fx'])assert.deepEqual((await request('https://asteria-online.io/asteria-online-sprites/'+folder+'/test.png')).body,original);
 assert.equal(cache.stats().worldArtReduced,3);assert.equal(cache.stats().hits,0);
 console.log('PASS lightweight scenery/monsters, preserved character/NPC/FX sheets, API/origin isolation and unchanged full assets');
}finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
