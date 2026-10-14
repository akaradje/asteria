// assetcache.js - a local disk cache for the game's static assets.
//
// Why this exists: the game serves every asset with `Cache-Control: no-cache`, so a
// browser revalidates each file on every load. On a slow link (~40 KB/s here) a single
// fresh boot pulls ~2.5 MB plus a round trip per sprite, which makes N windows
// impractical. We intercept same-origin static requests and answer them from a local
// directory filled on first use. Only /api/* and the websocket reach the real server.
//
// This is semantically an HTTP cache, not a modification: the bytes served are exactly
// the bytes the server sent for that URL.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CT = {
  html: 'text/html; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  css: 'text/css; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  txt: 'text/plain; charset=utf-8',
};

const extOf = p => (path.extname(p).slice(1) || '').toLowerCase();

// Audio assets this farm never listens to (--no-audio). Decoded OGG becomes PCM in the
// renderer: the ~38MB of sound files in the cache balloon to a few hundred MB of decoded
// buffers per window, which is pure waste for a bot.
const AUDIO_RE = /\.(mp3|ogg|wav|m4a)$/i;
// Only decorative 3D scenery, never UI icons, character art, APIs or scripts.
const WORLD_ART_RE = /^\/asteria-online-sprites\/(?:(?:town|monsters)\/(?:[^/]+\/)*[^/]+\.png|(?:tree-broadleaf-v2|tree-pine-v2|rock-cluster-v2|fern-cluster-v2|desert-cactus-v2|frost-crystal-prop-v2|ashen-dead-tree-v2|abyss-waystone-v2|town-cobblestone-seamless-v1|town-limestone-wall-v2|town-blue-slate-roof-v2|town-walkway-seamless-v1|town-fountain-plaza-v1)\.png)$/;
// Sheet decoders split source pixels into frames; a 1x1 image yields zero-width frames.
const EMPTY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAABSklEQVR4nO3SMQEAAAiAMPuX1hgebAk4mCVtvgP4ZYA4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0DcAa0TDvKxsgmiAAAAAElFTkSuQmCC', 'base64');

/** URL -> a stable, filesystem-safe relative path (extension kept last). */
function keyFor(u) {
  const url = new URL(u);
  const search = url.search ? '-' + crypto.createHash('sha1').update(url.search).digest('hex').slice(0, 8) : '';
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index';
  const ext = path.extname(p);                 // keep ".png" at the end so content-type lookup works
  let stem = p.slice(0, p.length - ext.length).replace(/^\/+/, '').replace(/[<>:"|?*\x00-\x1f]/g, '_');
  if (stem.length > 150) stem = stem.slice(0, 110) + '-' + crypto.createHash('sha1').update(stem).digest('hex').slice(0, 16);
  if (!stem) stem = 'root';
  return path.join(url.host.replace(/[:<>"|?*]/g, '_'), stem + search + (ext || ''));
}

class AssetCache {
  constructor(root, namespace, opts = {}) {
    this.dir = path.join(root, 'cache', namespace || 'default');
    this.hits = 0;
    this.misses = 0;
    this.bytesFromNetwork = 0;
    this.bytesFromDisk = 0;
    this.failures = [];
    this.blockAudio = !!opts.blockAudio;
    this.audioBlocked = 0;
    this.liteWorldArt = !!opts.liteWorldArt;
    this.worldArtReduced = 0;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  stats() {
    return {
      hits: this.hits, misses: this.misses,
      netMB: +(this.bytesFromNetwork / 1048576).toFixed(2),
      diskMB: +(this.bytesFromDisk / 1048576).toFixed(2),
      failures: this.failures.slice(-5),
      audioBlocked: this.audioBlocked,
      worldArtReduced: this.worldArtReduced,
    };
  }

  /**
   * Install the cache on a browser context.
   * @param {import('playwright').BrowserContext} context
   * @param {{origin:string, log?:Function, skip?:RegExp[]}} o
   */
  install(context, o) {
    const origin = o.origin;
    const log = o.log || (() => { });
    const skip = o.skip || [/\/api\//, /\/ws(\?|$)/];

    return context.route('**/*', async route => {
      const req = route.request();
      const url = req.url();
      if (!/^https?:/i.test(url)) return route.continue();

      let u;
      try { u = new URL(url); } catch { return route.continue(); }

      const sameOrigin = u.origin === origin;
      const isCdn = /cdnjs\.cloudflare\.com$/.test(u.host);
      if (!sameOrigin && !isCdn) return route.continue();
      if (skip.some(re => re.test(u.pathname))) return route.continue();
      if (req.method() !== 'GET') return route.continue();

      // Successful tiny-image response preserves load callbacks. Opt-in only
      // for no-draw farms; never overwrite the full-resolution disk cache.
      if (sameOrigin && this.liteWorldArt && WORLD_ART_RE.test(u.pathname)) {
        this.worldArtReduced++;
        return route.fulfill({status:200,contentType:'image/png',body:EMPTY_PNG});
      }

      // Opt-in (--no-audio): abort audio before it can be downloaded or decoded. A page
      // whose boot path awaited a sound could stall on this, so it is a flag, not a
      // default - try it with a single-window probe before trusting it on the farm.
      if (this.blockAudio && AUDIO_RE.test(u.pathname)) {
        this.audioBlocked++;
        return route.abort();
      }

      // "/" answers with a 302 to the current build file, whose name changes between
      // releases. Resolve it once, remember the mapping, and serve the document itself
      // from then on so no window ever talks to the network to boot.
      if (sameOrigin && u.pathname === '/') {
        const marker = path.join(this.dir, 'asteria-online.io', '_root.json');
        try {
          if (fs.existsSync(marker)) {
            const { target } = JSON.parse(fs.readFileSync(marker, 'utf8'));
            const body = fs.readFileSync(path.join(this.dir, keyFor(target)));
            this.hits++;
            this.bytesFromDisk += body.length;
            return route.fulfill({ status: 200, headers: { 'content-type': CT.html }, body:require('./runtime/pvp-mission').patch(body,path.resolve(this.dir,'../..')) });
          }
        } catch { /* fall through and resolve it live */ }
        try {
          const res = await route.fetch({ timeout: 180000 });
          const body = await res.body();
          const finalUrl = res.url() || url;
          const target = path.join(this.dir, keyFor(finalUrl));
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, body);
          fs.mkdirSync(path.dirname(marker), { recursive: true });
          fs.writeFileSync(marker, JSON.stringify({ target: finalUrl, at: Date.now() }));
          this.misses++;
          this.bytesFromNetwork += body.length;
          log(`resolved / -> ${finalUrl} (${(body.length / 1024).toFixed(0)}KB) and cached it`);
          return route.fulfill({ status: 200, headers: { 'content-type': CT.html }, body:require('./runtime/pvp-mission').patch(body,path.resolve(this.dir,'../..')) });
        } catch (e) {
          this.failures.push(`/ -> ${e.message}`);
          log('root document fetch failed: ' + e.message, 'warn');
          return route.continue();
        }
      }

      const file = path.join(this.dir, keyFor(url));

      // Serve from disk when we already have the bytes.
      if (fs.existsSync(file)) {
        try {
          const body = fs.readFileSync(file);
          this.hits++;
          this.bytesFromDisk += body.length;
          return route.fulfill({
            status: 200,
            headers: { 'content-type': CT[extOf(file)] || 'application/octet-stream' },
            body:extOf(file)==='html'?require('./runtime/pvp-mission').patch(body,path.resolve(this.dir,'../..')):body,
          });
        } catch { /* fall through to network */ }
      }

      // Miss: fetch once, store, serve. Large sprites over a slow link do time out, so
      // give each miss a couple of tries before giving up.
      try {
        let res = null, lastErr = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            res = await route.fetch({ timeout: 180000 });
            break;
          } catch (e) {
            lastErr = e;
            if (/disposed|Target closed/i.test(e.message || '')) throw e;
            await new Promise(r => setTimeout(r, 800 * attempt));
          }
        }
        if (!res) throw lastErr;
        const body = await res.body();
        if (res.ok()) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const tmp = file + '.tmp' + process.pid;
          fs.writeFileSync(tmp, body);
          fs.renameSync(tmp, file);
          this.misses++;
          this.bytesFromNetwork += body.length;
        }
        const headers = Object.assign({}, res.headers());
        delete headers['content-encoding'];
        delete headers['content-length'];
        delete headers['cache-control'];
        return route.fulfill({ status: res.status(), headers, body:extOf(file)==='html'?require('./runtime/pvp-mission').patch(body,path.resolve(this.dir,'../..')):body });
      } catch (e) {
        const msg = e.message || String(e);
        // "Request context disposed" is normal: the window closed mid-flight.
        const expected = /disposed|Target closed|closed/i.test(msg);
        this.failures.push(`${u.pathname} -> ${msg.split('\n')[0]}`);
        if (!expected && this.failures.length <= 3) {
          log(`asset fetch failed: ${u.pathname} (${msg.split('\n')[0]})`, 'warn');
        }
        return route.abort();
      }
    });
  }
}

module.exports = { AssetCache, keyFor };
