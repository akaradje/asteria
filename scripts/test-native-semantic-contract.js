'use strict';
const a=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),n=require('../src/knowledge/native-contract');
const text=fs.readFileSync('cache/add136aa/asteria-online.io/asteria-online-visual-polish.html','utf8');
for(const kind of ['craft','refine','rewards','enchant'])a(n.validate(text,kind).allowed,kind);
for(const kind of ['craft','refine','rewards']){
 const cosmetic=text.replace('function recipeWhy(r, o){',"function recipeWhy(r, o){ /* New patch UI notification */");a(n.validate(cosmetic,kind).allowed,'unlisted cosmetic patch is auto-approved');
}
for(const [kind,from,to]of [
 ['refine','NET.social(t, data);','NET.social(t, data); NET.social(t, data);'],
 ['refine','await NET.flush?.();','NET.flush?.();'],
 ['refine','lv >= RMAX || !wornKey(id)','lv >= RMAX || wornKey(id)'],
 ['craft','takeCost(k, n);','takeCost(k, n * 2);'],
 ['craft','if (!recipeReady(r, o)) return;','if (false) return;'],
 ['craft','bag.length < bagMax()','bag.length >= bagMax()']
 ]){a(text.includes(from),'fixture mutation exists: '+from);a(!n.validate(text.replaceAll(from,to),kind).allowed,'changed payment/guard cannot auto-approve: '+from);}
const code="const EXCHANGE=[RX('gear',{item:'new_item'},{coins:100},1)]; const variants=['future_item']; for(const id of variants) EXCHANGE.push(RX('gear',{item:id},{coins:200},2));";
const constructed=n.recipeConstruction(code);a.deepEqual(JSON.parse(JSON.stringify(vm.runInNewContext(constructed,{RX:(type,out,cost,reqLv)=>({type,out,cost,reqLv})}))).map(r=>r.out.item),['new_item','future_item'],'new data is structurally constructed without tier/item/hash exceptions');
for(const bad of ["process.exit()","require('fs')","RX.constructor('return process')()","EXCHANGE['push']['constructor']('return process')()","const f=RX['con'+'structor'];f('return process')()"] )a.throws(()=>n.dataConstruction(bad));
console.log('PASS current native contracts, unlisted UI/data patches, actual doubled-cost/missing-owner/flush/space negatives and isolated recipe construction');
const currentBuild=JSON.parse(fs.readFileSync('machines/fleet-client-release.json')).build,currentText=fs.readFileSync('cache/'+currentBuild+'/asteria-online.io/asteria-online-visual-polish.html','utf8');
if(currentText.includes('while (done < want)')){
 a(n.validate(currentText,'craft').allowed);a(n.validate(currentText,'craft').facts.singleQuantityRequired);
 for(const[from,to]of[['done += n;','done += n * 2;'],['exQty[idx] || 1','99'],['takeCost(c, v);','takeCost(c, v * 2);'],['for (let k = 0; k < n; k++){ for (const [c, v]','for (let k = 0; k <= n; k++){ for (const [c, v]'],['exQty[idx] = 1','exQty[idx] = 99'],['inp.value = exQty[i]','inp.value = 1']]){a(currentText.includes(from));a(!n.validate(currentText.replace(from,to),'craft').allowed,'Bounded single exchange cannot accept '+from+' mutation');}
 console.log('PASS current native bounded exchange queue, unit bill/output, picker binding/reset and no extra debit/iteration');
}
