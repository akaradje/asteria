'use strict';
// Run in the owned game page. Only native settings clicks; the client retains
// cooldown, range, heal reserve, LINK timing, targeting and Overdrive decisions.
function configure(plan){
 const q=s=>document.querySelector(s),out={applied:{},expected:{},missing:[]};
 const tab=id=>{const b=q('[data-set-tab="'+id+'"]');if(!b)return false;b.click();return true;};
 const check=(id,key,value)=>{const b=document.getElementById(id);if(!b||b.disabled){out.missing.push(id);return;}if(b.checked!==value)b.click();out.applied[key]=b.checked===value;if(out.applied[key])out.expected[key]=value;};
 const seg=(id,key,value)=>{const b=q('[data-seg="'+id+'"] [data-v="'+value+'"]');if(!b||b.disabled){out.missing.push(id);return;}if(!b.classList.contains('on'))b.click();out.applied[key]=b.classList.contains('on');if(out.applied[key])out.expected[key]=value;};
 if(!tab('combat')&&!tab('auto'))return {...out,status:'unsupported_combat_tab'};
 check('optSkills','skills',true);check('optBuffs','buffs',true);check('optBasic','basic',true);
 seg('order','order','smart');seg('od','od','boss');
 if([0,8,16,28,120].includes(plan.radius))seg('radius','radius',plan.radius);
 if(!tab('potion'))return {...out,status:'unsupported_potion_tab'};
 check('optHeal','heal',true);seg('hpPot','hp','auto');seg('mpPot','mp','auto');
 if(typeof plan.potHand==='boolean')check('optPotHand','ph',plan.potHand);
 if([25,35,50,70,90].includes(plan.potPct))seg('potPct','potPct',plan.potPct);
 if(plan.offlineBot){if(!tab('loot'))tab('auto');check('optOffBot','offlineBot',true);}
 return {...out,status:out.missing.length?'partial':'applied',evidence:'native_settings_controls_not_save_confirmation'};
}
function manaSkills(plan){
 const q=s=>document.querySelector(s),tab=q('[data-set-tab="combat"]')||q('[data-set-tab="auto"]');
 const held=(plan.held||[]).map(r=>typeof r==='string'?{id:r,mode:'on'}:r).filter(r=>r&&typeof r.id==='string'&&['on','boss'].includes(r.mode));
 if(!tab)return {held,status:'unsupported_combat_tab'};tab.click();
 const chip=id=>q('[data-auto-sk="'+id+'"]'),mode=b=>['off','boss','on'].find(m=>b?.classList.contains('am-'+m))||null;
 const set=(id,want)=>{for(let n=0;n<3;n++){const b=chip(id),m=mode(b);if(m===want)return true;if(!m||b.disabled)return false;b.click();}return mode(chip(id))===want;};
 if(plan.conserve){for(const id of plan.skills||[]){if(held.some(r=>r.id===id))continue;const before=mode(chip(id));if(before==='on'||before==='boss'){held.push({id,mode:before});set(id,'off');}}}
 else{for(let n=held.length-1;n>=0;n--){const r=held[n];if(mode(chip(r.id))===r.mode||set(r.id,r.mode))held.splice(n,1);}}
 const basic=document.getElementById('optBasic');if(basic&&!basic.disabled&&!basic.checked)basic.click();
 const potion=q('[data-set-tab="potion"]');if(potion){potion.click();const heal=document.getElementById('optHeal');if(heal&&!heal.disabled&&!heal.checked)heal.click();const mp=q('[data-seg="mpPot"] [data-v="auto"]');if(mp&&!mp.disabled&&!mp.classList.contains('on'))mp.click();}
 return {held,status:held.length?'conserving_or_restore_pending':'restored'};
}
function observed(settings,save,at){
 if(!settings)return settings;
 const expected=settings.expected||{},keys=Object.keys(expected),o=save.autoOpt||{};
 const matches=keys.length>0&&keys.every(k=>(k==='offlineBot'?save.offBot:o[k])===expected[k]);
 return {...settings,observedAt:at,confirmed:matches,evidence:'observed_native_save_not_server_ack',actual:Object.fromEntries(keys.map(k=>[k,k==='offlineBot'?save.offBot:o[k]??null]))};
}
module.exports={configure,manaSkills,observed};
