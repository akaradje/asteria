'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const cache=new Map();
function parse(source,maps){
 const town=source.match(/\bconst TOWN\s*=\s*\{([^}]+)\}/)?.[1];if(!town)return {};
 const center={};for(const key of ['cx','cz']){const v=town.match(new RegExp('\\b'+key+'\\s*:\\s*(-?[\\d.]+)'))?.[1];if(v===undefined||!Number.isFinite(+v))return {};center[key]=+v;}
 function coordinate(text){const m=text.trim().match(/^(?:TOWN\.(cx|cz)\s*(?:([+-])\s*(\d+(?:\.\d+)?))?|(-?\d+(?:\.\d+)?))$/);return m?m[4]!==undefined?+m[4]:center[m[1]]+(m[2]==='-'?-1:1)*(+(m[3]||0)):NaN;}
 const rows=source.match(/\{[^{}\n]*kind:\s*'worldMap'[^{}\n]*\}/g)||[],result={};
 for(const row of rows){const id=row.match(/targetMap:\s*'([\w-]+)'/)?.[1],x=coordinate(row.match(/\bx:\s*([^,}]+)/)?.[1]||''),z=coordinate(row.match(/\bz:\s*([^,}]+)/)?.[1]||''),map=maps.find(m=>m.id===id);
  if(!id||!Number.isFinite(x)||!Number.isFinite(z)||Math.abs(x)>10000||Math.abs(z)>10000)return {};
  if(!map||!Number.isInteger(map.levelMin)||map.levelMin<1)continue;
  if(result[id])return {};result[id]={x,z,label:map.name||id,levelMin:map.levelMin};
 }
 return result;
}
function parseGraph(source,maps){
 const townGates=parse(source,maps),links={},fieldGates={};let valid=true,base=false;
 for(const block of source.matchAll(/const\s+([A-Z_]*MAP_LINKS)\s*=\s*\{([^;]+)\};/g)){
  if(block[1]==='MAP_LINKS')base=true;
  else if(!new RegExp('Object\\.assign\\(MAP_LINKS,\\s*'+block[1]+'\\)').test(source)){valid=false;break;}
  const remainder=block[2].replace(/([a-z]\d+):\{prev:(null|'[a-z]\d+'),next:(null|'[a-z]\d+')\}/g,(_,id,prev,next)=>{links[id]={prev:prev==='null'?null:prev.slice(1,-1),next:next==='null'?null:next.slice(1,-1)};return '';});
  if(remainder.replace(/[\s,]/g,'')){valid=false;break;}
 }
 const field=source.match(/const\s+FIELD_GATES\s*=\s*\{([^;]+)\};/)?.[1];
 if(field)for(const key of ['home','previous','next']){const m=field.match(new RegExp('\\b'+key+':\\s*\\[\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*\\]'));if(m)fieldGates[key]={x:+m[1],z:+m[2]};}
 return {townGates,links:valid&&base?links:{},fieldGates};
}
function read(file,maps,graph=false){
 // Some host filesystems can preserve identical metadata across rapid replacements.
 // Bind cached routes to actual source bytes so removed/unknown gates fail closed.
 try{const source=fs.readFileSync(file,'utf8'),key=file+':'+graph+':'+crypto.createHash('sha256').update(source).digest('hex')+':'+JSON.stringify(maps.map(m=>[m.id,m.name,m.levelMin]));if(!cache.has(key)){if(cache.size>=8)cache.clear();cache.set(key,graph?parseGraph(source,maps):parse(source,maps));}return cache.get(key);}catch{return {};}
}
function forBuild(root,build,maps){
 if(!require('../knowledge/build-id').valid(build))return {};
 return read(path.join(root,'cache',build,'asteria-online.io/asteria-online-visual-polish.html'),maps||[]);
}
function load(actor){return read(path.join(actor.cache.dir,'asteria-online.io/asteria-online-visual-polish.html'),require('../economy').loadWiki(actor.root)?.maps?.maps||[]);}
function graphForBuild(root,build,maps){if(!require('../knowledge/build-id').valid(build))return {};return read(path.join(root,'cache',build,'asteria-online.io/asteria-online-visual-polish.html'),maps||[],true);}
module.exports={parse,parseGraph,load,forBuild,graphForBuild};
