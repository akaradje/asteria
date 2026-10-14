'use strict';
// Native item generation is bounded pure data construction, not a known hash.
const vm=require('node:vm'),native=require('./native-contract');
function read(text,world,authored){
 const scripts=[...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);let code;
 for(const source of scripts){if(!source.includes('AsteriaWorld.EQUIPMENT'))continue;const tree=require('acorn').parse(source,{ecmaVersion:'latest'});native.walk(tree,n=>{
  if(n.type!=='ForOfStatement'||native.member(n.right)!=='AsteriaWorld.EQUIPMENT')return;
  let writes=false;native.walk(n,x=>{if(x.type==='AssignmentExpression'&&x.left.type==='MemberExpression'&&native.member(x.left.object)==='ITEMS')writes=true;});
  if(writes){if(code)throw Error('Ambiguous native item generator');code=source.slice(n.start,n.end);}
 });}
 if(!code)throw Error('Native item generator unavailable');native.dataConstruction(code);
 const input={AsteriaWorld:{EQUIPMENT:JSON.parse(JSON.stringify(world.EQUIPMENT||[]))},ITEMS:JSON.parse(JSON.stringify(authored)),GEAR_KIND_TH:{},__L:s=>String(s)};
 const raw=vm.runInNewContext(code+'\nJSON.stringify(ITEMS);',input,{timeout:1000,contextCodeGeneration:{strings:false,wasm:false}}),items=JSON.parse(raw);
 for(const item of world.EQUIPMENT||[])if(!items[item.id]||! /^[a-z][a-z0-9_-]{0,40}$/.test(items[item.id].rarity||''))throw Error('Native item metadata incomplete');
 return items;
}
module.exports={read};
