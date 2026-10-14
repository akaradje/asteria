// audit-client.js - static bug hunt in the game's own client code.
//
// Nothing here touches the network or the server: it reads the shipped client out of the local
// asset cache and cross-checks its own tables against each other. Every finding below is a
// statement about the client's data or logic that can be verified by reading it.
//
//   node scripts/audit-client.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let bugs = 0, smells = 0;
const bug = m => { bugs++; console.log('  BUG   ' + m); };
const smell = m => { smells++; console.log('  smell ' + m); };
const head = m => console.log('\n' + m);
const note = m => console.log('        ' + m);

/** Locate the newest client in the asset cache. */
function findClient() {
  const root = path.join(ROOT, 'cache');
  if (!fs.existsSync(root)) return null;
  for (const build of fs.readdirSync(root).sort().reverse()) {
    const dir = path.join(root, build, 'asteria-online.io');
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    const html = files.find(f => f.endsWith('.html'));
    const world = files.find(f => f === 'asteria-world-system.js');
    const net = files.find(f => f === 'asteria-net.js');
    if (html) return { build, dir, html: path.join(dir, html), world: world && path.join(dir, world), net: net && path.join(dir, net) };
  }
  return null;
}

/** Slice a balanced {...} or [...] literal starting at the first opener at/after `from`. */
function sliceBalanced(src, from, open, close) {
  let i = src.indexOf(open, from);
  if (i < 0) return null;
  let depth = 0;
  for (let p = i; p < src.length; p++) {
    const c = src[p];
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return { text: src.slice(i, p + 1), start: i, end: p }; }
  }
  return null;
}

const idsIn = text => (text.match(/'([a-z_0-9]+)'/g) || []).map(s => s.slice(1, -1));

/** Every top-level {...} inside a block, brace-balanced (quest objects contain nested objects). */
function topLevelObjects(text) {
  const out = [];
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start >= 0) { out.push(text.slice(start, i + 1)); start = -1; } }
  }
  return out;
}

/** Ids inside a JSON-ish array of objects: "id":"w1" (DATA) or {id:'dx' (INSTANCE_MAPS). */
const jsonIds = text => [...text.matchAll(/"id"\s*:\s*"([a-z0-9_]+)"/g)].map(m => m[1]);
const bareIds = text => [...text.matchAll(/\{id:'([a-z0-9_]+)'/g)].map(m => m[1]);

/** Parse the top-level entries of an object literal at two-or-more spaces of indentation. */
function entriesOf(body) {
  const out = {};
  const re = /(?:^|\n)[ \t]{2,}([a-z0-9_]+):[ \t]*\{/g;
  let m;
  while ((m = re.exec(body))) {
    const s = sliceBalanced(body, m.index + m[0].length - 1, '{', '}');
    if (s) out[m[1]] = s.text;
  }
  return out;
}

(async () => {
  const c = findClient();
  if (!c) {
    console.log('No cached client found. Run the game once (or scripts/run.js --probe) so');
    console.log('cache/<build>/ is populated, then try again.');
    process.exit(1);
  }
  console.log(`client: build ${c.build}`);
  console.log(c.dir);

  const html = fs.readFileSync(c.html, 'utf8');
  const game = fs.readFileSync(path.join(c.dir, 'asteria-online-visual-polish.html'), 'utf8') === html
    ? html : html;   // the html holds the inline game script
  const world = c.world ? fs.readFileSync(c.world, 'utf8') : '';
  const net = c.net ? fs.readFileSync(c.net, 'utf8') : '';

  // Pull the inline game script (the big one).
  let inline = '';
  const sre = /<script([^>]*)>/g;
  let sm;
  while ((sm = sre.exec(html))) {
    const end = html.indexOf('</script>', sm.index + sm[0].length);
    const body = html.slice(sm.index + sm[0].length, end);
    if (body.length > inline.length) inline = body;
  }

  // ------------------------------------------------------------------ 1. duplicate element ids
  head('1. Duplicate element ids');
  {
    // Scan the MARKUP only. The inline game script contains template literals with id="..."
    // inside if/else branches, and only one of those is ever rendered - counting them would
    // produce false positives (it did, for toJobs and socName, before this was fixed).
    const markup = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    const counts = {};
    for (const m of markup.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)) counts[m[1]] = (counts[m[1]] || 0) + 1;
    const dups = Object.entries(counts).filter(([, n]) => n > 1);
    note(`${Object.keys(counts).length} ids in static markup`);
    if (!dups.length) note('no duplicates in the markup');
    for (const [id, n] of dups) {
      bug(`id "${id}" appears ${n} times in the markup - getElementById() returns only the first`);
      note(`so a handler bound to it silently ignores the other ${n - 1} element(s)`);
    }

    // Ids that exist only inside template literals are worth listing, not flagging: they are
    // rendered one at a time by design.
    const inScript = new Set([...html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map(m => m[1]));
    const dynamic = [...inScript].filter(id => !counts[id]);
    if (dynamic.length) note(`${dynamic.length} id(s) appear only inside script templates (rendered one branch at a time - not a bug)`);
  }

  // ------------------------------------------------------------------ 2. skill tables
  head('2. Skill table consistency');
  const jobSeg = sliceBalanced(inline, inline.indexOf('const JOBS = {'), '{', '}');
  const jobs = jobSeg ? entriesOf(jobSeg.text.slice(1, -1)) : {};
  const skSeg = sliceBalanced(inline, inline.indexOf('const SK = {'), '{', '}');
  const skIds = skSeg ? new Set(Object.keys(entriesOf(skSeg.text.slice(1, -1)))) : new Set();
  note(`parsed ${Object.keys(jobs).length} classes, ${skIds.size} skills`);

  if (skIds.size) {
    // declared per class, via `job: 'x'`
    const declared = {};
    const dre = /\n[ \t]{2,}([a-z_0-9]+):[ \t]*\{[ \t]*name:[ \t]*'([^']+)',[ \t]*job:[ \t]*'([a-z]+)'/g;
    let dm;
    while ((dm = dre.exec(inline))) (declared[dm[3]] = declared[dm[3]] || []).push({ id: dm[1], name: dm[2] });

    const unreachable = [];
    for (const [job, body] of Object.entries(jobs)) {
      const sk = (body.match(/skills:[ \t]*\[([^\]]*)\]/) || [])[1];
      const hb = (body.match(/hotbar:[ \t]*\[([^\]]*)\]/) || [])[1];
      const list = sk ? idsIn(sk) : [];
      const hot = hb ? idsIn(hb) : [];
      const set = new Set(list);

      for (const s of declared[job] || []) {
        if (!set.has(s.id)) unreachable.push({ job, id: s.id, name: s.name });
      }
      for (const id of list) {
        if (skIds.size && !skIds.has(id)) bug(`${job}: skill list names "${id}" but it is not defined in SK - the panel would throw`);
      }
      for (const id of hot) {
        if (!set.has(id)) bug(`${job}: hotbar names "${id}" but it is not in the learnable list - that slot can never be filled`);
      }
      const hbMax = (body.match(/maxJob:[ \t]*(\d+)/) || [])[1];
      if (hbMax && list.length) {
        const cost = lv => (lv <= 5 ? 1 : lv <= 8 ? 2 : 3);
        const toMax = lv => { let n = 0; for (let l = 1; l <= lv; l++) n += cost(l); return n; };
        const total = list.length * toMax(10);
        note(`${job.padEnd(12)} ${list.length} skills, ${total} points to take them all to Lv10, maxJob ${hbMax}`);
      }
    }
    if (unreachable.length) {
      bug(`${unreachable.length} skills are declared for a class but missing from that class's learnable list:`);
      for (const u of unreachable) note(`${u.job.padEnd(12)} ${u.id.padEnd(18)} ${u.name}`);
      note('canLearn() requires membership of JOBS[job].skills, so these can never be learned by anyone');
    } else note('every declared skill is reachable');
  } else {
    smell('could not parse SK; skipped the skill cross-checks');
  }

  // ------------------------------------------------------------------ 3. monsters and maps
  head('3. Quests, monsters and map links');
  // The world data lives in a JSON literal `const DATA = {...}` (maps/monsters arrays), plus
  // INSTANCE_MAPS for the rift and the tower.
  const dataSeg = sliceBalanced(world, world.indexOf('const DATA = {'), '{', '}');
  const mapsArr = dataSeg ? sliceBalanced(dataSeg.text, dataSeg.text.indexOf('"maps"'), '[', ']') : null;
  const monsArr = dataSeg ? sliceBalanced(dataSeg.text, dataSeg.text.indexOf('"monsters"'), '[', ']') : null;
  const instSeg = sliceBalanced(world, world.indexOf('const INSTANCE_MAPS=['), '[', ']');
  const monsters = new Set([...(monsArr ? jsonIds(monsArr.text) : [])]);
  const maps = new Set([
    ...(mapsArr ? jsonIds(mapsArr.text) : []),
    ...(instSeg ? bareIds(instSeg.text) : []),
  ]);
  note(`parsed ${monsters.size} monsters, ${maps.size} maps`);

  const questSeg = sliceBalanced(inline, inline.indexOf('const QUESTS = ['), '[', ']');
  const quests = questSeg ? topLevelObjects(questSeg.text) : [];
  note(`parsed ${quests.length} quests`);

  if (!monsters.size || !maps.size) {
    smell('could not parse the world data; skipping the cross-reference checks rather than guessing');
  } else {
    const badTargets = [], badMaps = [];
    for (const q of quests) {
      const k = (q.match(/k:\s*'([a-z_0-9]+)'/) || [])[1];
      const t = (q.match(/targetId:\s*'([a-z_0-9]+)'/) || [])[1];
      const mid = (q.match(/mapId:\s*'([a-z0-9]+)'/) || [])[1];
      if (t && !monsters.has(t)) badTargets.push(`${k} -> ${t}`);
      if (mid && !maps.has(mid)) badMaps.push(`${k} -> ${mid}`);
    }
    if (badTargets.length) { bug(`${badTargets.length} quest(s) hunt a monster id that does not exist - they can never complete`); badTargets.forEach(x => note(x)); }
    else note(`every kill quest targets a real monster (checked ${quests.filter(q => /targetId:/.test(q)).length})`);
    if (badMaps.length) { bug(`${badMaps.length} quest(s) point at a map that does not exist`); badMaps.forEach(x => note(x)); }
    else note('every quest map id exists');

    // MAP_LINKS chain
    const linkSeg = sliceBalanced(inline, inline.indexOf('const MAP_LINKS = {'), '{', '}');
    if (linkSeg) {
      const broken = [];
      const re = /([a-z0-9]+):\{prev:(?:'([a-z0-9]+)'|null),next:(?:'([a-z0-9]+)'|null)\}/g;
      let lm, n = 0;
      while ((lm = re.exec(linkSeg.text))) {
        n++;
        const [, from, prev, next] = lm;
        if (!maps.has(from)) broken.push(`MAP_LINKS has an entry for unknown map "${from}"`);
        if (prev && !maps.has(prev)) broken.push(`${from}.prev -> "${prev}" which is not a map`);
        if (next && !maps.has(next)) broken.push(`${from}.next -> "${next}" which is not a map`);
      }
      if (broken.length) { bug('the field-map travel chain references maps that do not exist'); broken.forEach(x => note(x)); }
      else note(`MAP_LINKS chain is intact (${n} entries, all referencing real maps)`);
    } else smell('could not parse MAP_LINKS; skipped');
  }

  // ------------------------------------------------------------------ 4. text vs code
  head('4. UI text that disagrees with the code');
  {
    const statCost = (inline.match(/const statCost = v => Math\.floor\(\(v - 1\) \/ (\d+)\) \+ 1/) || [])[1];
    const claim = (inline.match(/ค่าใช้แต้มเพิ่มขึ้นทุก (\d+) ระดับ/) || [])[1];
    if (statCost && claim) {
      if (statCost !== claim) {
        bug(`the status panel says the point cost rises every ${claim} points, but statCost() steps every ${statCost}`);
        note(`players are told the wrong cost curve; a stat is much cheaper than the text implies`);
      } else note(`status point cost text matches the code (every ${statCost})`);
    } else note('could not find both the statCost code and its UI text');
  }

  // ------------------------------------------------------------------ 5. dead client surface
  head('5. Client API surface with no caller');
  if (net) {
    const exports = [...net.matchAll(/^NET\.([a-zA-Z]+)[ \t]*=/gm)].map(m => m[1]);
    const both = inline + net;
    const dead = exports.filter(name => {
      const uses = (both.match(new RegExp('NET\\.' + name + '\\b', 'g')) || []).length;
      return uses <= 1;                       // only the definition itself
    });
    note(`${exports.length} NET.* members exported`);
    if (dead.length) {
      for (const d of dead) smell(`NET.${d} is defined but nothing calls it`);
      if (dead.includes('wipe')) note('NET.wipe issues DELETE /api/save - a dormant destructive endpoint');
    } else note('every exported member is used');
  }

  // ------------------------------------------------------------------ 6. map-state consistency
  head('6. Functions that change the map but not the state derived from it');
  {
    // Two globals describe "where am I": currentMapId and inTown. Several things derive from
    // them - the biome (via currentMapId[0]), obstacle filtering, the nav grid. So a function
    // that flips one without the other leaves those derivations stale. This is the shape of the
    // town-walking bug: warpTo() sets inTown but never touches currentMapId.
    const fnOf = pos => {
      const before = inline.lastIndexOf('\n  function ', pos);
      const m = before >= 0 ? inline.slice(before, before + 120).match(/function ([A-Za-z0-9_]+)/) : null;
      return m ? m[1] : '(top level)';
    };
    const writers = name => {
      const out = {};
      const re = new RegExp(name + '\\s*=(?!=)', 'g');
      let m;
      while ((m = re.exec(inline))) {
        const f = fnOf(m.index);
        out[f] = (out[f] || 0) + 1;
      }
      return out;
    };
    const mapW = writers('currentMapId');
    const townW = writers('inTown');
    note(`currentMapId is assigned in: ${Object.keys(mapW).join(', ')}`);
    note(`inTown is assigned in:      ${Object.keys(townW).join(', ')}`);

    const both = Object.keys(townW).filter(f => mapW[f]);
    const townOnly = Object.keys(townW).filter(f => !mapW[f] && f !== '(top level)');
    if (townOnly.length) {
      for (const f of townOnly) {
        bug(`${f}() sets inTown but never currentMapId - anything derived from currentMapId stays stale`);
        note('  the biome is derived from currentMapId[0], and obstacle filtering depends on the biome,');
        note('  so the previous map\'s obstacles stay active here (see CLIENT-BUGS.md finding 1)');
      }
    } else note('every function that changes inTown also sets currentMapId');

    const navReset = (inline.match(/navGrid\s*=\s*null/g) || []).length;
    note(`navGrid is invalidated in ${navReset} place(s)`);
    if (!/navGrid/.test(inline.slice(inline.indexOf('function warpTo(where)'), inline.indexOf('function warpTo(where)') + 1200))) {
      smell('warpTo() does not clear navGrid, while travelToMap() and the instance warps do');
      note('  a grid built before the warp keeps the previous map\'s obstacles baked in');
    }
  }

  // ------------------------------------------------------------------ 7. playable classes
  head('7. Which classes a player can actually reach');
  {
    const order = (inline.match(/const JOB_ORDER = \[([^\]]*)\]/) || [])[1];
    const baseOrder = order ? idsIn(order) : [];
    const promoteLv = (inline.match(/const PROMOTE_LV = (\d+)/) || [])[1];
    const canPromote = (inline.match(/const canPromote = \(\) =>([^;]+);/) || [])[1] || '';
    const canChange = (inline.match(/const canChangeTo = j =>([^;]+);/) || [])[1] || '';
    const maxChars = (net.match(/const MAX_CHARS = (\d+)/) || [])[1];

    const thirdOf = {};
    for (const [job, body] of Object.entries(jobs)) {
      const b = (body.match(/base:[ \t]*'([a-z]+)'/) || [])[1];
      if (b) thirdOf[b] = job;
    }

    note(`JOB_ORDER (offered to a Wayfarer at Job Lv 10): ${baseOrder.length} -> ${baseOrder.join(', ')}`);
    note(`MAX_CHARS per account: ${maxChars}`);
    note('');
    note('base class -> its only promotion');
    for (const b of baseOrder) {
      const jb = jobs[b] || {};
      const name = (jb.match(/name:[ \t]*'([^']+)'/) || [])[1] || b;
      const third = thirdOf[b];
      const tname = third ? ((jobs[third].match(/name:[ \t]*'([^']+)'/) || [])[1] || third) : null;
      const maxJob = (jb.match(/maxJob:[ \t]*(\d+)/) || [])[1];
      note(`  ${name.padEnd(13)} (${b})`.padEnd(30) + `-> ${tname ? `${tname} (${third})` : 'NONE'}   at Job ${maxJob} + Lv ${promoteLv}`);
    }
    const total = baseOrder.length + Object.keys(thirdOf).length;
    note(`\nplayable classes: ${baseOrder.length} to choose + ${Object.keys(thirdOf).length} promotions = ${total}`);

    const unreachable = Object.keys(jobs).filter(j =>
      j !== 'novice' && !baseOrder.includes(j) && !Object.values(thirdOf).includes(j));
    if (unreachable.length) bug(`classes in the table that no player can reach: ${unreachable.join(', ')}`);
    else note('every class in the table is reachable by some route');

    if (!/job === 'novice' \? player\.jobLv >= 10/.test(canChange)) {
      smell('canChangeTo() no longer gates a Wayfarer on Job Lv 10 - check the class-change rules');
    } else {
      note('a Wayfarer may choose a base class at Job Lv 10');
    }
    if (!/CLASS3_OF\[player\.job\] === j/.test(canChange)) {
      smell('canChangeTo() no longer restricts a base class to its own promotion');
    } else {
      note('a base class may ONLY promote to its own 3rd class - it cannot switch to another base class');
    }
    if (!/player\.jobLv >= JOBS\[player\.job\]\.maxJob/.test(canPromote)) {
      smell('canPromote() no longer requires the job level to be maxed');
    }
    note(`\nso: one character can experience at most 2 of the ${total} classes (its base and its promotion),`);
    note(`and an account with ${maxChars} characters can cover at most ${(Number(maxChars) || 3) * 2} of them.`);
  }

  // ------------------------------------------------------------------ summary
  console.log(`\n${bugs} bug(s), ${smells} code smell(s)`);
  console.log('\nEverything above is a statement about the client code itself. Nothing here touches');
  console.log('the server, and nothing was executed against the live game to produce it.');
})();
