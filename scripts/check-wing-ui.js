'use strict';
const {chromium}=require('playwright');let browser;
(async()=>{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4712/');await page.waitForSelector('.card');await page.locator('[data-view="char"]').click();await page.locator('#selection').selectOption('tum:1');
 await page.waitForFunction(()=>document.querySelector('#body')?.innerText.includes('Halo Feather Wing'),{},{timeout:60000});
 const text=await page.locator('#body').innerText();for(const term of ['Lumen Seraph Wing','มีจริง','ต้องใช้','กันไว้','ยังขาด','Celestial Plume','150,000'])if(!text.includes(term))throw Error('Missing wing detail: '+term);
 await page.screenshot({path:'logs/wing-accuracy-desktop.png',fullPage:true});await page.locator('.sheet').filter({has:page.locator('h3',{hasText:'พัฒนาปีก'})}).screenshot({path:'logs/wing-detail-desktop.png'});await page.setViewportSize({width:390,height:844});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2))throw Error('Wing detail causes mobile overflow');await page.screenshot({path:'logs/wing-accuracy-mobile.png',fullPage:true});
 await page.locator('[data-view="plan"]').click();await page.waitForFunction(()=>document.querySelector('#body')?.innerText.includes('Halo Feather Wing'),{},{timeout:60000});
 if((await page.locator('#body').innerText()).includes('NaN'))throw Error('Invalid calculation displayed');if(errors.length)throw Error(errors.join('\n'));console.log('PASS ExampleAccount8 active/final wing, exact requirement columns, complete material list, plan view and desktop/mobile layout');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();});
