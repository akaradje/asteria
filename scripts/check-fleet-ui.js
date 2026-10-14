'use strict';
const {chromium}=require('playwright');let browser;
(async()=>{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4712/');await page.waitForSelector('.card',{timeout:30000});
 const cards=await page.locator('.card').count();if(cards!==6)throw Error('Expected six cards');
 await page.screenshot({path:'logs/fleet-dashboard-desktop.png',fullPage:true});
 for(const machine of ['windows','tum'])for(const route of ['char','plan','reports','map','team-brain']){
  const result=await page.evaluate(async({machine,route})=>{const r=await fetch('/api/'+route+'?machine='+machine+'&slot=0');const value=await r.json();return {code:r.status,ok:value.ok,error:value.error};},{machine,route});
  if(result.code!==200||result.ok===false)throw Error(machine+'/'+route+': '+result.error);console.log(machine+'/'+route+' passed');
 }
 for(const route of ['map','plan','reports','team-brain']){
  await page.locator('[data-view="'+route+'"]').click();
  await page.waitForFunction(()=>{const body=document.getElementById('body').textContent;return body.includes('windows')&&body.includes('tum');},{},{timeout:30000});
  if(await page.locator('#selection').inputValue()!=='all')throw Error('Expected combined team view');
 }
 await page.locator('[data-view="overview"]').click();await page.locator('[data-member="tum:0"]').click();await page.waitForFunction(()=>document.getElementById('body').textContent.includes('ExampleAccount2'));
 if(await page.locator('.equipment').count()===0)throw Error('Equipment layout missing');
 if(await page.locator('.attribute').count()!==6)throw Error('Six attributes missing');
 await page.screenshot({path:'logs/fleet-character-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'logs/fleet-character-mobile.png',fullPage:true});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Character mobile overflow');
 for(const option of await page.locator('#selection option').evaluateAll(options=>options.map(o=>({key:o.value,name:o.textContent.split(' · ')[0]})))){
  await page.locator('#selection').selectOption(option.key);await page.waitForFunction(name=>document.querySelector('.detail-top h2')?.textContent===name,option.name,{timeout:30000});
 }
 await page.locator('[data-view="overview"]').click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'logs/fleet-dashboard-mobile.png',fullPage:true});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');if(errors.length)throw Error(errors.join(';'));
 const forbidden=await page.request.post('http://127.0.0.1:4712/api/stop?machine=windows');if(forbidden.status()!==403)throw Error('Command origin guard failed');
 await browser.close();console.log('Six cards, both machines, all read menus, mobile layout and command origin guard passed');
})().catch(async e=>{console.error(e.message);if(browser)await browser.close();process.exitCode=1;});
