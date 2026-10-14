// shot.js - screenshot a URL (used to verify the control panel renders correctly).
//   node scripts/shot.js --url=http://127.0.0.1:4711/ --out=logs/panel.png [--w=1280] [--h=1400] [--wait=4000]
'use strict';

const path = require('path');
const { chromium } = require('playwright');

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const ROOT = path.resolve(__dirname, '..');
const URL = String(argv.url || 'http://127.0.0.1:4711/');
const OUT = path.resolve(ROOT, String(argv.out || 'logs/shot.png'));
const W = +(argv.w || 1280), H = +(argv.h || 1400), WAIT = +(argv.wait || 4000);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(WAIT);
  await page.screenshot({ path: OUT, fullPage: true });
  await browser.close();

  console.log(`screenshot: ${OUT}`);
  console.log(errors.length ? `PAGE ERRORS:\n  ${errors.join('\n  ')}` : 'no page errors');
})();
