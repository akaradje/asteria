'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),{chromium}=require('playwright');
(async()=>{
 const html=fs.readFileSync('src/public/fleet.html','utf8');
 for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
 const browser=await chromium.launch({...(process.platform==='win32'?{channel:'chrome'}:{}),headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({path:'src/public/fleet-dom.js'});
  const result=await page.evaluate(()=>{
   const root=document.getElementById('root');
   const markup=n=>'<article data-live-key="a"><b>'+n+'</b><details><summary>More</summary><div style="height:40px;overflow:auto"><p style="height:400px">Log</p></div></details><input value="server"><button>Details</button><svg><path d="M0 0 L'+n+' 10"></path></svg></article><article data-live-key="b">B</article>';
   updateFleetDOM(root,markup(1));const card=root.firstChild,input=card.querySelector('input'),details=card.querySelector('details'),scroll=details.querySelector('div');
   details.open=true;scroll.scrollTop=70;input.focus();input.value='typing';input.setSelectionRange(2,2);
   let removed=0;const observer=new MutationObserver(()=>{});observer.observe(root,{childList:true,subtree:true});
   for(let n=2;n<=101;n++)updateFleetDOM(root,markup(n));
   for(const r of observer.takeRecords())removed+=r.removedNodes.length;
   const stable={card:card===root.firstChild,input:input===document.activeElement,value:input.value,caret:input.selectionStart,open:details.open,scroll:scroll.scrollTop,removed,text:card.querySelector('b').textContent,svg:card.querySelector('path').getAttribute('d')};
   updateFleetDOM(root,'<article data-live-key="b">B2</article>'+markup(102).split('<article data-live-key="b">')[0]);
   stable.reorder=card===root.lastChild;
   updateFleetDOM(root,'<p>Empty</p>');stable.empty=root.children.length===1&&root.textContent==='Empty';return stable;
  });
  assert.deepEqual(result,{card:true,input:true,value:'typing',caret:2,open:true,scroll:70,removed:0,text:'101',svg:'M0 0 L101 10',reorder:true,empty:true});
  console.log('PASS: 100 refreshes preserve DOM identity, focus/caret, disclosures, scroll; changed data/SVG, keyed reorder and removal work; inline script parses');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
