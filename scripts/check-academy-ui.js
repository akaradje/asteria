'use strict';
const {chromium}=require('playwright');let browser;
(async()=>{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4712/');await page.waitForSelector('.card');await page.locator('[data-view="academy"]').click();
 await page.waitForSelector('#academyQuery',{timeout:60000});
 await page.waitForFunction(()=>document.querySelectorAll('.curriculum-list').length===6,{},{timeout:120000});
 const text=await page.locator('#body').innerText();for(const name of ['ExampleAccount2','ExampleAccount8','ExampleAccount10','ExampleAccount4','ExampleAccount6','ExampleAccount12'])if(!text.includes(name))throw Error('Missing learner '+name);
 if(!text.includes('ต้องตรวจผล'))throw Error('Missing capability gaps');
 await page.locator('#academyQuery').fill('Lumen Seraph');await page.waitForFunction(()=>document.querySelector('#encyclopediaResults')?.innerText.includes('Lumen Seraph'));
 await page.locator('#academyDomain').selectOption('crafting');await page.waitForFunction(()=>{const rows=[...document.querySelectorAll('.reference-article > summary small')];return rows.length>0&&rows.every(r=>r.textContent.includes('crafting / recipes'));});
 await page.locator('.reference-article').first().locator('summary').first().click();
 await page.screenshot({path:'logs/academy-desktop.png',fullPage:true});await page.locator('#body .sheet').first().screenshot({path:'logs/academy-reference.png'});
 await page.setViewportSize({width:390,height:844});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2))throw Error('Academy mobile overflow');await page.screenshot({path:'logs/academy-mobile.png',fullPage:true});
 await page.waitForTimeout(16000);if(await page.locator('#academyQuery').inputValue()!=='Lumen Seraph')throw Error('Search lost on refresh');
 if((await page.locator('#body').innerText()).includes('NaN'))throw Error('Invalid values');if(errors.length)throw Error(errors.join('\n'));console.log('PASS six curricula, honest capability gaps, recipe search, retained filters, desktop/mobile layout and no page errors');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();});
