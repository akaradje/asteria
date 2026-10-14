'use strict';
const {chromium}=require('playwright');let browser;
(async()=>{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4712/');await page.waitForSelector('.card');
 await page.locator('[data-view="reports"]').click();await page.waitForSelector('.progress-card');
 if(await page.locator('.progress-card').count()!==6)throw Error('Expected exactly six assigned character charts');
 if(await page.locator('.progress-section').count()!==2)throw Error('Expected both machines');
 for(const metric of ['damage','dps','coins','exp','kills','deaths','lv']){
  await page.locator('[data-progress-metric]').first().selectOption(metric);
  if(await page.locator('.progress-card').count()!==6)throw Error('Metric picker lost cards');
  if((await page.locator('#body').innerHTML()).includes('NaN'))throw Error('Invalid chart coordinate');
 }
 await page.locator('[data-progress-hours]').first().selectOption('24');await page.locator('[data-progress-metric]').first().selectOption('damage');
 await page.screenshot({path:'logs/character-statistics-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2))throw Error('Mobile horizontal overflow');
 await page.screenshot({path:'logs/character-statistics-mobile.png',fullPage:true});
 await page.waitForTimeout(16000);
 if(await page.locator('[data-progress-metric]').first().inputValue()!=='damage'||await page.locator('[data-progress-hours]').first().inputValue()!=='24')throw Error('Live refresh lost selection');
 if(errors.length)throw Error(errors.join(';'));
 console.log('PASS six assigned charts, both machines, seven metrics, time range, live refresh retention and mobile layout');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();});
