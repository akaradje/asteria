'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { installResourceMode } = require('../src/resource-mode');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage();
    await page.addInitScript(installResourceMode);
    await page.goto('about:blank');
    await page.addScriptTag({ path: path.resolve(__dirname, '../cache/f323279/cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js') });
    const result = await page.evaluate(() => {
      const renderer = new THREE.WebGLRenderer();
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.z = 5;
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
      renderer.render(scene, camera);
      const skipped = renderer.info.render.calls;
      window.__allowDraw = true;
      renderer.render(scene, camera);
      const drawn = renderer.info.render.calls;
      renderer.dispose();
      return { mode: window.__resourceMode, skipped, drawn };
    });
    assert.deepEqual(result, { mode: 'render-skipped', skipped: 0, drawn: 1 });
    console.log('PASS: actual Chromium + Three r128 skips render and restores preview');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
