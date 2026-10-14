'use strict';
const amount=x=>Number.isSafeInteger(x)&&x>=0;
function reserved(claims){
 const unique=new Map();
 for(const c of claims||[]){
  if(!c||typeof c.id!=='string'||!c.id||typeof c.resource!=='string'||!amount(c.n))return {known:false};
  const old=unique.get(c.id);if(old&&(old.resource!==c.resource||old.n!==c.n))return {known:false};
  unique.set(c.id,c);
 }
 const totals={};for(const c of unique.values()){totals[c.resource]=(totals[c.resource]||0)+c.n;if(!amount(totals[c.resource]))return {known:false};}
 return {known:true,totals};
}
function classify({item,kind,owned,claims,requirementsComplete=false,copySelectionVerified=false}={}){
 const r=reserved(claims);
 if(!requirementsComplete||!r.known||!amount(owned))return {item,action:'retain',reason:'team_requirements_or_reservations_incomplete',surplus:0};
 if(kind==='gear'&&!copySelectionVerified)return {item,action:'retain',reason:'native_copy_selection_not_verified',surplus:0};
 const n=Math.max(0,owned-(r.totals[item]||0));return {item,action:n?'surplus_candidate':'retain',surplus:n,reserved:r.totals[item]||0,executable:false};
}
function history(rows){
 const values=(rows||[]).filter(r=>amount(r.price)&&r.n>0&&amount(r.n)).map(r=>r.price/r.n).sort((a,b)=>a-b);
 if(values.length<5)return {known:false,samples:values.length,reason:'insufficient_completed_sales',saleProbability:null};
 const median=values[Math.floor(values.length/2)],mad=values.map(x=>Math.abs(x-median)).sort((a,b)=>a-b)[Math.floor(values.length/2)];
 return {known:true,samples:values.length,median,mad,range:[values[0],values.at(-1)],outliers:values.filter(x=>Math.abs(x-median)>Math.max(1,3*mad)).length,independenceVerified:false,saleProbability:null};
}
function analyze({board,generation,now=Date.now(),inventory={},claims=[],requirementsComplete=false,heldCopper=0,reserveCopper=0,wallet=null,needs=[]}={}){
 const base={at:now,mode:'shadow_no_transactions',claimedIncome:0,executable:false};
 if(!board||board.generation!==generation||now<board.at||now-board.at>30000||!board.rowsValid)return {...base,state:'WAIT_NATIVE_BOARD',offers:[]};
 const rules=[board.tax,board.fee,board.max].every(x=>x!==null),byItem=new Map();
 for(const row of board.list){if(row.mine!==false||row.status&&row.status!=='open')continue;const previous=byItem.get(row.item);if(!previous||row.unitPrice<previous.unitPrice)byItem.set(row.item,row);}
 const offers=[...byItem.values()].slice(0,100).map(row=>({item:row.item,kind:row.kind,listingId:row.id,totalPrice:row.price,n:row.n,unitPrice:row.unitPrice,owned:amount(inventory[row.item])?inventory[row.item]:null,observedAskOnly:true,...classify({item:row.item,kind:row.kind,owned:inventory[row.item],claims,requirementsComplete})}));
 const buys=needs.slice(0,32).map(need=>{
  const row=byItem.get(need.item),budget=amount(wallet)&&amount(heldCopper)&&amount(reserveCopper)?Math.max(0,wallet-heldCopper-reserveCopper):null;
  return {item:need.item,listingId:row?.id||null,reason:!row?(board.queryComplete?'not_in_this_query':'query_incomplete'):budget===null?'budget_unknown':row.price>budget?'preserve_progression_reserve':'requires_full_cycle_eta_and_native_purchase_contract',totalPrice:row?.price??null,unitPrice:row?.unitPrice??null,executable:false};
 });
 return {...base,state:rules?'OBSERVED':'WAIT_NATIVE_RULES',boardAt:board.at,parameters:{tax:board.tax,fee:board.fee,max:board.max},queryComplete:board.queryComplete,visible:board.list.length,offers,buys,reason:'asking_prices_are_not_completed_sales_or_income'};
}
function observe(i,now=Date.now()){
 const market=i.socialInbox?.market,b=market?.board;if(!b||i.marketShadow?.boardAt===b.at)return i.marketShadow;
 const s=i.lastSave||{},inventory={...(s.materials||{}),...(s.consumables||{}),'Red Potion':s.potions};
 for(const item of s.bag||[]){const id=typeof item==='string'?item:item.id;if(id)inventory[id]=(inventory[id]||0)+1;}
 for(const [id,n]of Object.entries(s.cards||{}))inventory['cd:'+id]=n;
 const needs=(i.personalBrain?.craft?.missing||[]).filter(x=>typeof x.name==='string').map(x=>({item:x.name}));
 // Fleet demand completeness is deliberately not inferred from a local bag.
 const catalog=i.catalog();i.marketShadow=analyze({board:b,generation:market.generation,now,inventory,requirementsComplete:false,wallet:s.coins,heldCopper:i.v2?.reservations?.totals()?.Copper||0,reserveCopper:require('../upgrade-reserve').reserve(s,catalog.world),needs});return i.marketShadow;
}
module.exports={reserved,classify,history,analyze,observe};
