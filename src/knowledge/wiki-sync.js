'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
async function refresh(root,{build,fetcher=fetch,now=Date.now,sourceText}={}){
 const url='https://asteria-online.io/wiki/data.json';let text=sourceText;if(text===undefined){const response=await fetcher(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Wiki HTTP '+response.status);text=await response.text();}if(typeof text!=='string'||text.length>8000000)throw Error('Wiki too large or invalid');const wiki=JSON.parse(text);if(!Array.isArray(wiki.crafting?.recipes)||!wiki.items?.equipment||!wiki.monsters?.monsters)throw Error('Unknown Wiki structure');
 const economy=require('../economy'),wings=economy.loadWings(root,build),verified=require('../verify-wing-recipes').verify(root,build,wings,wiki.crafting.recipes),wingReady=Object.keys(wings).length>0&&verified.length===Object.keys(wings).length&&verified.every(r=>r.verified);
 const health=await fetcher('https://asteria-online.io/api/health',{signal:AbortSignal.timeout(10000)});if(!health.ok)throw Error('Build confirmation unavailable');const actual=JSON.parse(await health.text());if(!actual.ok||actual.build!==build)throw Error('Game build changed during Wiki collection; retry after loaded build update');
 const sha256=crypto.createHash('sha256').update(text).digest('hex'),file=path.join(root,'data/wiki.json');let previous;try{previous=JSON.parse(fs.readFileSync(file));}catch{}
 const changed=previous?._source?.sha256!==sha256;
 const domains={wings:{state:wingReady?'READY':'REVIEW_REQUIRED',build,verifiedRecipes:verified.filter(r=>r.verified).length,reason:wingReady?null:'Wiki/native wing mismatch; affected recipes require native validation'},cards:{state:'DISCOVERED',build,authority:'wiki_not_runtime_outcome'}};
 // Unchanged Wiki content can be verified against a newer game build. Keep
 // that validation separate from content changes, without rewriting on every poll.
 const metadataChanged=!changed&&(previous?._source?.verifiedBuild!==build||previous?._source?.verifiedWingRecipes!==verified.length);
 if(changed||metadataChanged){wiki._source={url,fetchedAt:changed?now():previous._source.fetchedAt,verifiedAt:now(),sha256,verifiedBuild:build,verifiedWingRecipes:domains.wings.verifiedRecipes,domains,coverage:wingReady?'validated_wing_recipes':'partial_domain_review_required'};fs.mkdirSync(path.dirname(file),{recursive:true});if(previous)fs.copyFileSync(file,file+'.previous');fs.writeFileSync(file+'.tmp',JSON.stringify(wiki,null,2));fs.renameSync(file+'.tmp',file);}
 return {checkedAt:now(),build,sha256,changed,metadataChanged,verifiedWingRecipes:domains.wings.verifiedRecipes,domains,status:changed?'updated':metadataChanged?'revalidated':'unchanged'};
}
module.exports={refresh};
