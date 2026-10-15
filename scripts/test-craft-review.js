'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),economy=require('../src/economy'),review=require('../src/knowledge/development-source');
// Native .iname now contains ex-tag spans; equal names can use different bills.
{
 const select=require('../src/runtime/exchange-selection').select;let clicks=0;
 const row=(cost,{disabled=false,tags=true,name='Zenith Aegis'}={})=>({disabled,dataset:{ex:'42'},click(){clicks++;},closest(){return {querySelector(){return {cloneNode(){const node={textContent:name+(tags?'อาวุธรองสูตรแคว้นฟ้า':''),querySelectorAll(){return tags?[{remove(){node.textContent=name;}}]:[];}};return node;}};},querySelectorAll(){return Object.entries(cost).map(([key,n])=>({getAttribute:()=>key,querySelector:s=>s==='small'?(key==='Copper'?null:{textContent:'/'+n}):{textContent:Number(n).toLocaleString('en-US')}}));}};}});
 const bill={'Valkyr Wing Plate':1,Starmetal:18,Copper:250000},right=row(bill),wrong=row({...bill,Starmetal:30});
 const doc=rows=>({querySelectorAll:()=>rows});
 assert.equal(select(doc([wrong,right]),'Zenith Aegis',bill).ok,true);assert.equal(clicks,1);
 assert.equal(select(doc([wrong]),'Zenith Aegis',bill).ok,false);
 assert.equal(select(doc([right,right]),'Zenith Aegis',bill).reason,'ambiguous-exact-recipe');
 assert.equal(select(doc([row(bill,{disabled:true})]),'Zenith Aegis',bill).ok,false);
 assert.equal(select(doc([row(bill,{name:'Zenith Aegis II'})]),'Zenith Aegis',bill).ok,false);
 assert.equal(select(doc([row({...bill,Starmetal:NaN})]),'Zenith Aegis',bill).ok,false);assert.equal(clicks,1);
}
const root=process.cwd(),build=JSON.parse(fs.readFileSync(path.join(root,'machines/fleet-client-release.json'))).build,cat=economy.loadCatalog(root,build),wiki=economy.loadWiki(root),text=fs.readFileSync(path.join(root,'cache',build,'asteria-online.io/asteria-online-visual-polish.html'),'utf8');
{
 const select=require('../src/runtime/exchange-selection').select;let clicks=0,eventCount=0,paidUnits=0;
 const q={value:'99',closest:()=>({dataset:{exq:'7'}}),dispatchEvent(){eventCount++;this.value=String(Math.max(1,Math.min(99,Math.floor(+this.value)||1)));}};
 const row={querySelector:s=>s==='.iname'?{cloneNode:()=>({textContent:'Future Gear',querySelectorAll:()=>[]})}:s==='.ex-go .buyq input'?q:s==='.ex-go .buyq'?{}:null,querySelectorAll:()=>[{getAttribute:()=> 'Copper',querySelector:()=>({textContent:'100'})}]};
 const b={dataset:{ex:'7'},disabled:false,closest:()=>row,click(){clicks++;paidUnits=+q.value;}};
 assert(select({querySelectorAll:()=>[b]},'Future Gear',{Copper:100},true).ok);assert.equal(clicks,1);assert.equal(eventCount,1);assert.equal(paidUnits,1,'Existing native quantity99 must be reset before the sole intent');
 q.closest=()=>({dataset:{exq:'8'}});assert.equal(select({querySelectorAll:()=>[b]},'Future Gear',{Copper:100},true).reason,'native-quantity-owner-mismatch');assert.equal(clicks,1);
}
assert(require('../src/knowledge/native-contract').validate(text,'craft').allowed);
{
 const snippet="const EXCHANGE=[];for(const w of AsteriaWorld.EQUIPMENT.filter(i=>(i.jobs||[]).every(AsteriaWorld.newClassOpen)))EXCHANGE.push(RX('gear',{item:w.id},{coins:100},1));";
 const world={NEWCLASS:{future:{open:false},released:{open:true}},EQUIPMENT:[{id:'future_item',jobs:['future']},{id:'open_item',jobs:['released']},{id:'old_item',jobs:['existing']}],newClassOpen:id=>!NEWCLASS[id]||!!NEWCLASS[id].open};
 assert.deepEqual(review.constructedRecipes(snippet,{world}).map(r=>r.out.item),['open_item','old_item'],'sandbox preserves native class availability without host callbacks');
 for(const fn of [()=>true,id=>process.exit(),id=>!NEWCLASS[id]||!!NEWCLASS[id].enabled])assert.throws(()=>review.constructedRecipes(snippet,{world:{...world,newClassOpen:fn}}),/predicate requires review/);
}
{
 const pinned=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-pinned-native-'));
 try{
  const base=path.join(pinned,'cache',build,'asteria-online.io');fs.mkdirSync(base,{recursive:true});
  for(const name of ['asteria-online-visual-polish.html','asteria-world-system.js','asteria-net.js'])fs.copyFileSync(path.join(root,'cache',build,'asteria-online.io',name),path.join(base,name));
  fs.mkdirSync(path.join(pinned,'machines'));fs.copyFileSync(path.join(root,'machines/fleet-client-release.json'),path.join(pinned,'machines/fleet-client-release.json'));
  const old=path.join(pinned,'cache','f3dc944','asteria-online.io');fs.mkdirSync(old,{recursive:true});const future=new Date(Date.now()+3600000);fs.utimesSync(old,future,future);
  assert.equal(economy.newestBuild(pinned),build,'A historical fixture extraction timestamp cannot override explicit bound native sources');
 }finally{fs.rmSync(pinned,{recursive:true,force:true});}
}
if(review.craftFingerprint(text)==='b901587dd651d7f4e9e9267b54822c99faebf3ade90485dee4f558d2968e54a8')assert.equal(review.craftFingerprint(text.replace(", songweaver: 'aria_harp'",'')),'470d94df7d75080d5217d5362a0b010e68f8c2595358e489bb3465fa64f0eb63','only the reviewed class3 output mapping changed; payment/guards/other output unchanged');
for(const name of ['Aegis Wing','Halo Feather Wing'])assert(review.check(root,build,'craft',[name,'wing'],cat,wiki).allowed);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-craft-review-'));try{const folder=path.join(temp,'cache','fixture','asteria-online.io');fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,'asteria-online-visual-polish.html');fs.writeFileSync(file,text+'\n<!-- unrelated UI change -->');assert(review.source(temp,'fixture',cat,'craft'));assert(review.source(temp,'fixture',cat,'refine'),'semantic contract accepts an unlisted build, independent of approved hash lists');fs.writeFileSync(file,text.replace("forgeSend('rfup',","forgeSend('stup',"));assert.throws(()=>review.source(temp,'fixture',cat,'refine'),/native .*dispatch|required|changed|contract|missing/);if(text.includes('const refChance =')){fs.writeFileSync(file,text.replace('Math.min(100, REFINE_CHANCE[lv] +','Math.min(50, REFINE_CHANCE[lv] +'));assert(review.source(temp,'fixture',cat,'refine'),'notification/display chance change does not override authoritative world chance or dispatch contract');}fs.writeFileSync(file,text.replace('player.coins -= n','player.coins -= n * 2'));assert.throws(()=>review.source(temp,'fixture',cat,'craft'),/native .*dispatch|required|changed|contract|missing/);assert.equal(review.craftFingerprint('incomplete'),null);}finally{fs.rmSync(temp,{recursive:true,force:true});}
console.log('PASS: exact live wing recipes, unchanged paid kernel, UI-only changes accepted, altered payment rejected and craft/refine cache isolation');
if(text.includes('Leviathan Heart')){
 const native=review.nativeEquipmentRecipes(root,build,cat),crown=native.find(r=>r.out.item==='tidelord_s_crown'),boots=native.find(r=>r.out.item==='abyssal_treads');
 assert(crown&&boots,'reviewed new native construction must expose both boss uniques');
 assert.deepEqual(JSON.parse(JSON.stringify(crown.cost)),{'Leviathan Heart':6,tokens:200});assert.equal(crown.reqLv,118);
 assert.deepEqual(JSON.parse(JSON.stringify(boots.cost)),{'Leviathan Heart':5,tokens:160});
 if(text.includes("{ src: 'sea' }")){
  const bow=native.filter(r=>r.out.item==='skyrender_bow');
  assert.equal(bow.length,2);assert.deepEqual(bow.map(r=>r.src),['sky','sea']);
  assert.deepEqual(JSON.parse(JSON.stringify(bow[0].cost)),{'Sovereign Starheart':1,Starmetal:30,'Valkyr Wing Plate':1,coins:250000});
  assert.deepEqual(JSON.parse(JSON.stringify(bow[1].cost)),{'Leviathan Heart':1,Starmetal:30,"Siren's Tear":1,coins:250000});
 }
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-native-sea-'));try{
  const dir=path.join(temp,'cache/fixture/asteria-online.io');fs.mkdirSync(dir,{recursive:true});
  const a=text.indexOf('for (const w of AsteriaWorld.EQUIPMENT.filter(i => i.tier === 7'),b=text.indexOf('/* save / load',a),builder=text.slice(a,b);
  assert(builder.includes('coins: 250000'));
  fs.writeFileSync(path.join(dir,'asteria-online-visual-polish.html'),text.slice(0,a)+builder.replace('coins: 250000','coins: 999999')+text.slice(b));
  assert(review.nativeEquipmentRecipes(temp,'fixture',cat).some(r=>r.cost.coins===999999),'new native recipe price updates catalog automatically; exact cost preflight still required');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
 console.log('PASS exact native unique costs/levels and automatic updated price construction');
}
{
 const target=Object.values(cat.items).find(i=>i.slot==='weapon'),save={equip:{weapon:target.id},refine:{[target.id]:0}},opts={targetId:target.id,maxAttempts:1,guaranteedOnly:true};
 assert.equal(review.source(root,build,cat,'refine').refineSafeTenOnly,false);
 assert(review.check(root,build,'refine',[opts],cat,wiki,save).allowed);
 assert(review.check(root,build,'refine',[{...opts,guaranteedOnly:false}],cat,wiki,{...save,refine:{[target.id]:10}}).allowed,'native >10 source contract approved; risk/guardian/reserves independently required');
 for(const [o,s]of [[{...opts,maxAttempts:2},save],[opts,{...save,equip:{}}],[opts,{...save,refine:{[target.id]:15}}],[opts,{...save,refine:{[target.id]:3}}]])assert(!review.check(root,build,'refine',[o],cat,wiki,s).allowed);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-refine-contract-'));try{const folder=path.join(temp,'cache','fixture','asteria-online.io');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'asteria-online-visual-polish.html'),text.replace('const material = R.ore(tier);','const material = R.star;'));assert.throws(()=>review.source(temp,'fixture',cat,'refine'),/native .*dispatch|required|changed|contract|missing/);}finally{assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));fs.rmSync(temp,{recursive:true,force:true});}
 console.log('PASS native max15 source approval; exact equipped/single attempt/chance/ore contract, no +10 source cap');
}
