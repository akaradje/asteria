// gen-build.js - extract the class build tables from the shipped game client.
//
// The game's own data is the authority for "what should this class spend points on":
//   * JOBS[job].bonus   - how much each stat contributes to that class
//   * JOBS[job].skills  - the learnable skill list, in intended progression order
//                         (canLearn() requires membership of this list)
//   * JOBS[job].hotbar  - the skills the game itself puts on the action bar
//
// Copying those by hand invites drift when the game updates, so this reads them out of the
// client and writes src/build.js. Re-run it whenever the build hash changes.
//
//   node scripts/gen-build.js [--from=<html>]
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const OUT = path.join(ROOT, 'src', 'build.js');

/** The build the server is actually serving right now, or '' if it cannot be reached. */
function liveBuild() {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['-e', `
      fetch('https://asteria-online.io/api/health')
        .then(r => r.json())
        .then(j => console.log(j.build || ''))
        .catch(() => console.log(''));
    `], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', d => (out += d));
    child.on('close', () => resolve(out.trim()));
    child.on('error', () => resolve(''));
  });
}

/**
 * Prefer the locally cached copy of the client; only go to the network if we must.
 *
 * The cache is keyed by the server's build hash and accumulates one directory per deploy, so
 * "the first .html I find" is not the same as "the current client" - readdirSync happens to
 * return these in name order, which once made this extract a 45-minute-old client and report
 * success. Bind the choice to the build /api/health reports, and fall back to the newest
 * cached copy (by mtime) only when the server cannot be reached.
 */
async function findClient() {
  if (argv.from) return { file: String(argv.from), source: 'argument' };
  const cacheRoot = path.join(ROOT, 'cache');
  const candidates = [];
  if (fs.existsSync(cacheRoot)) {
    for (const build of fs.readdirSync(cacheRoot)) {
      const dir = path.join(cacheRoot, build, 'asteria-online.io');
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.html')) continue;
        const file = path.join(dir, f);
        candidates.push({ build, file, mtime: fs.statSync(file).mtimeMs });
      }
    }
  }

  const want = await liveBuild();
  if (want) {
    const exact = candidates.find(c => c.build === want);
    if (exact) return { file: exact.file, source: `cache/${exact.build} (live build)` };
    console.log(`live build is ${want} and it is not cached yet - fetching the current client ...`);
    return download();
  }

  if (!candidates.length) return download();
  candidates.sort((a, b) => b.mtime - a.mtime);
  console.log(`could not read the live build; using the newest cached client (cache/${candidates[0].build})`);
  return { file: candidates[0].file, source: `cache/${candidates[0].build} (newest cached)` };
}

function download() {
  return new Promise((resolve, reject) => {
    console.log('no cached client found; downloading ...');
    const out = path.join(ROOT, 'logs', 'client.html');
    const child = spawn(process.execPath, ['-e', `
      const fs=require('fs');
      fetch('https://asteria-online.io/').then(r=>r.text()).then(t=>{fs.writeFileSync(process.argv[1],t);console.log('downloaded',t.length,'bytes')});
    `, out], { cwd: ROOT, stdio: 'inherit' });
    child.on('close', c => c === 0 ? resolve({ file: out, source: 'download' }) : reject(new Error('download failed')));
    child.on('error', reject);
  });
}

/** Pull the JOBS object literal out of the client source. */
function extractJobs(src) {
  const start = src.indexOf('const JOBS = {');
  if (start < 0) throw new Error('JOBS table not found in the client');
  // Walk braces so nested objects (bonus, look, req) do not end the scan early.
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (let p = i; p < src.length; p++) {
    const c = src[p];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = p; break; } }
  }
  if (end < 0) throw new Error('unterminated JOBS table');
  const body = src.slice(i + 1, end);

  // Split top-level entries: "  name: { ... }," at two-or-more spaces of indentation
  // (the client is not consistent - some entries use three).
  const entries = [];
  const re = /(?:^|\n)[ \t]{2,}([a-z0-9_]+):[ \t]*\{/g;
  let m;
  while ((m = re.exec(body))) {
    let p = m.index + m[0].length - 1, d = 0, stop = -1;
    for (let q = p; q < body.length; q++) {
      if (body[q] === '{') d++;
      else if (body[q] === '}') { d--; if (d === 0) { stop = q; break; } }
    }
    if (stop > 0) entries.push([m[1], body.slice(p, stop + 1)]);
  }

  const arr = (text, key) => {
    const mm = new RegExp(key + ':\\s*\\[([^\\]]*)\\]').exec(text);
    return mm ? (mm[1].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1)) : [];
  };
  const obj = text => {
    const mm = /bonus:\s*\{([^}]*)\}/.exec(text);
    if (!mm) return {};
    const out = {};
    const kv = /([a-z]+):\s*([0-9.]+)/g;
    let k;
    while ((k = kv.exec(mm[1]))) out[k[1]] = +k[2];
    return out;
  };

  const jobs = {};
  for (const [id, text] of entries) {
    jobs[id] = {
      bonus: obj(text),
      skills: arr(text, 'skills'),
      hotbar: arr(text, 'hotbar'),
      base: (/base:\s*'([a-z]+)'/.exec(text) || [])[1] || null,
    };
  }
  return jobs;
}

/** Every skill the client declares for a class, so we can flag unreachable ones. */
function extractDeclaredSkills(src) {
  const out = {};
  const re = /\n[ \t]{2,}([a-z_0-9]+):[ \t]*\{[ \t]*name:[ \t]*'([^']+)',[ \t]*job:[ \t]*'([a-z]+)'/g;
  let m;
  while ((m = re.exec(src))) (out[m[3]] = out[m[3]] || []).push({ id: m[1], name: m[2] });
  return out;
}

(async () => {
  let src = await findClient();
  if (!src) src = await download();
  console.log(`client: ${src.source} (${src.file})`);
  const html = fs.readFileSync(src.file, 'utf8');

  const jobs = extractJobs(html);
  const declared = extractDeclaredSkills(html);
  const names = Object.keys(jobs);
  if (!names.length) throw new Error('parsed zero classes - the client format probably changed');

  // Report the gap between "declared for this class" and "actually learnable".
  const unreachable = [];
  for (const job of names) {
    const learnable = new Set(jobs[job].skills);
    for (const s of declared[job] || []) {
      if (!learnable.has(s.id)) unreachable.push({ job, id: s.id, name: s.name });
    }
  }

  const header = `// GENERATED by scripts/gen-build.js - do not edit by hand.
//
// Source: the shipped game client (JOBS table), extracted ${new Date().toISOString().slice(0, 10)}.
//   STAT_WEIGHTS  = JOBS[job].bonus   - how much each stat contributes to that class
//   SKILL_ORDER   = JOBS[job].skills  - the learnable list, in intended progression order
//   HOTBAR        = JOBS[job].hotbar  - the skills the game puts on the action bar
//
// A skill must appear in JOBS[job].skills to be learnable at all: canLearn() checks
// membership, so anything declared with a matching job but missing from that list can never
// be learned. gen-build.js reports those.
'use strict';
`;

  const body = `
const STAT_WEIGHTS = ${JSON.stringify(Object.fromEntries(names.map(n => [n, jobs[n].bonus])), null, 2)};

const SKILL_ORDER = ${JSON.stringify(Object.fromEntries(names.map(n => [n, jobs[n].skills])), null, 2)};

const HOTBAR = ${JSON.stringify(Object.fromEntries(names.map(n => [n, jobs[n].hotbar])), null, 2)};

// Declared as belonging to a class but absent from that class's learnable list.
const UNREACHABLE_SKILLS = ${JSON.stringify(unreachable, null, 2)};

/** Stats a class should raise, most important first, weighted by the game's own bonus table. */
function statPlan(job, points, { ignoreNovice = true } = {}) {
  // Points are not refunded when the class changes (only a paid reset does that), so as a
  // Wayfarer it is better to bank them than to guess a build that will be thrown away.
  if (ignoreNovice && (!job || job === 'novice')) return [];
  const w = STAT_WEIGHTS[job];
  if (!w) return [];
  const keys = Object.keys(w);
  if (!keys.length) return [];

  // Largest-remainder apportionment: hand out 'points' in proportion to the weights, so the
  // order stays faithful to the class instead of rounding one stat up and starving another.
  const total = keys.reduce((s, k) => s + w[k], 0);
  const exact = keys.map(k => points * w[k] / total);
  const out = keys.map((k, i) => ({ k, n: Math.floor(exact[i]), frac: exact[i] - Math.floor(exact[i]) }));
  let left = points - out.reduce((s, o) => s + o.n, 0);
  out.slice().sort((a, b) => b.frac - a.frac).forEach(o => { if (left > 0) { o.n++; left--; } });
  // Interleave so the character grows evenly rather than dumping everything into one stat.
  const seq = [];
  let remaining = out.filter(o => o.n > 0);
  while (remaining.length) {
    remaining.sort((a, b) => b.n / (b.n + 1) - a.n / (a.n + 1));
    for (const o of remaining) if (o.n > 0) { seq.push(o.k); o.n--; }
    remaining = remaining.filter(o => o.n > 0);
  }
  return seq;
}

/** Skill ids to learn, in priority order (the client's own list order). */
function skillPlan(job, { preferHotbar = false } = {}) {
  const list = SKILL_ORDER[job] || [];
  if (!preferHotbar) return list.slice();
  const hot = (HOTBAR[job] || []).filter(id => list.includes(id));
  return [...hot, ...list.filter(id => !hot.includes(id))];
}

module.exports = { STAT_WEIGHTS, SKILL_ORDER, HOTBAR, UNREACHABLE_SKILLS, statPlan, skillPlan };
`;

  fs.writeFileSync(OUT, header + body);
  console.log(`wrote ${OUT}`);
  console.log(`classes: ${names.length}`);

  if (unreachable.length) {
    console.log(`\nUnreachable skills (declared for a class but missing from its learnable list):`);
    for (const u of unreachable) console.log(`  ${u.job.padEnd(12)} ${u.id.padEnd(18)} ${u.name}`);
    console.log(`  -> these can never be learned; canLearn() requires membership of JOBS[job].skills`);
  } else {
    console.log('\nNo unreachable skills.');
  }
})();
