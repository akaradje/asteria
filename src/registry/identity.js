'use strict';
const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function selectCharacter(chars,{charId,charName}={}){
 if(!Array.isArray(chars))throw Error('identity: invalid native character list');
 if(charId!=null){const match=chars.filter(c=>String(c.id)===String(charId));
  if(match.length!==1)throw Error('identity: assigned native character is missing or ambiguous');
  return match[0];
 }
 if(charName){const match=chars.filter(c=>c.name===charName);
  if(match.length!==1)throw Error('identity: assigned character name is missing or ambiguous');
  return match[0];
 }
 throw Error('identity: explicit character assignment is required');
}
function identity({nativeId,accountRef,realm,epoch,name,host,slot}){
 if(nativeId==null||!accountRef||!realm||!epoch)throw Error('identity: incomplete namespace');
 // Display name, slot and host never participate in actor identity.
 return {actorId:'actor-'+hash(JSON.stringify([realm,epoch,String(nativeId)])).slice(0,32),
  accountId:'account-'+hash(JSON.stringify([realm,epoch,accountRef])).slice(0,32),
  realm,epoch,nativeId:String(nativeId),name:name||null,assignment:{host:host||null,slot:slot??null}};
}
module.exports={selectCharacter,identity};
