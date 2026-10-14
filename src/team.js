// team.js - the bot team: named accounts with passwords, stored on disk.
//
// Why not guests: a guest account lives in one browser profile's localStorage. Reinstall, move
// the project, or clear that profile and the character is gone. A named account can be signed
// into again from anywhere - which is what makes a team reusable and lets you log in yourself.
//
// The file is plain JSON with the passwords in it, because you need to read them to sign in by
// hand. Treat it as a credential file: it is listed in .gitignore, and it should not leave this
// machine. See the note at the top of the file it writes.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const api = require('./api');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** The server rate-limits signups: "สมัครบ่อยเกินไป ลองใหม่ภายหลัง". */
const isRateLimited = e => /บ่อยเกินไป|too many|rate ?limit/i.test(String(e));
/** A username that is already taken - that one we should replace, not retry. */
const isTaken = e => /มีอยู่แล้ว|ถูกใช้|ซ้ำ|taken|exists|already/i.test(String(e));

const DEFAULT_FILE = 'team.json';

// The six base classes a Wayfarer can choose between at Job Lv 10, in the game's own order.
// A team is normally assigned one class per member so that between them they cover all six.
const BASE_CLASSES = ['knight', 'assassin', 'mage', 'priest', 'ranger', 'monk'];

// A character name is permanent - the game has no rename, only a fresh character - so it is
// worth choosing one. 2-16 characters, Thai allowed, no spaces.
const DEFAULT_CHAR_NAMES = {
  knight: 'ExampleAccount2',
  assassin: 'ExampleAccount4',
  mage: 'ExampleAccount6',
  priest: 'ExampleAccount8',
  ranger: 'ExampleAccount10',
  monk: 'ExampleAccount12',
};
const WORDS = ['ember', 'frost', 'gale', 'hollow', 'iron', 'lumen', 'moss', 'nova', 'onyx', 'pike',
  'quartz', 'rune', 'sage', 'thorn', 'umber', 'vale', 'wisp', 'xeno', 'yew', 'zephyr'];

/** A readable but strong password: three words, a number and a symbol, ~20 chars. */
function generatePassword() {
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  const n = crypto.randomInt(100, 999);
  const sym = '!@#$%&*+-='[crypto.randomInt(10)];
  return `${pick()}-${pick()}${n}${sym}${pick()}`.replace(/\s/g, '');
}

/** Usernames must match [A-Za-z0-9_]{3,20}. */
function generateUsername(prefix, index) {
  const clean = String(prefix).replace(/[^A-Za-z0-9_]/g, '').slice(0, 12) || 'bot';
  return `${clean}${String(index).padStart(2, '0')}`.slice(0, 20);
}

class Team {
  constructor(root, fileName = DEFAULT_FILE) {
    this.file = path.join(root, fileName);
    this.members = [];
    this.meta = {};
    this.load();
  }

  load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.members = Array.isArray(d.members) ? d.members : [];
      this.meta = d.meta || {};
    } catch {
      this.members = [];
      this.meta = {};
    }
    return this.members;
  }

  save() {
    const doc = {
      _readme: [
        'Asteria Farm - bot team credentials.',
        'These are game accounts created on asteria-online.io. The passwords are here in plain',
        'text so you can sign in to them yourself from the game website or another device.',
        'Keep this file on this machine. Anyone with it can take the accounts.',
      ],
      meta: Object.assign({ created: new Date().toISOString() }, this.meta),
      members: this.members,
    };
    fs.writeFileSync(this.file, JSON.stringify(doc, null, 2));
    // Best effort on Windows; the file lives in the project directory either way.
    try { fs.chmodSync(this.file, 0o600); } catch { }
    return this.file;
  }

  bySlot(slot) {
    return this.members.find(m => m.slot === slot) || null;
  }

  byUsername(username) {
    const u = String(username).toLowerCase();
    return this.members.find(m => m.username.toLowerCase() === u) || null;
  }

  /**
   * Make sure the team has `count` members, registering any that are missing.
   *
   * Idempotent: a member that already exists in the file is only re-validated by signing in, so
   * running this again never creates duplicates and never loses an account.
   *
   * @param {{count:number, prefix:string, onProgress?:Function}} o
   */
  async provision({ count, prefix, onProgress = () => { }, attempts = 8 }) {
    const report = [];
    for (let slot = 0; slot < count; slot++) {
      let member = this.bySlot(slot);

      // Already known: just confirm the credentials still work.
      if (member && member.password) {
        const r = await api.login(member.username, member.password);
        if (r.ok) {
          member.token = r.token;
          member.verifiedAt = new Date().toISOString();
          report.push({ slot, username: member.username, action: 'signed in', ok: true });
          onProgress(report[report.length - 1]);
          continue;
        }
        report.push({ slot, username: member.username, action: `sign-in failed: ${r.error}`, ok: false });
        onProgress(report[report.length - 1]);
        continue;                                  // do not silently mint a replacement
      }

      // New member: find a free username, then register.
      let username = generateUsername(prefix, slot + 1);
      for (let bump = 0; bump < 20 && this.byUsername(username); bump++) {
        username = generateUsername(prefix, slot + 1 + (bump + 1) * 100);
      }
      const password = generatePassword();

      // Registration is rate-limited, so back off and wait rather than hammering it - and only
      // swap the username when the name itself is the problem, never on a rate limit. (An
      // earlier version replaced the name on every failure, which both burned names and made
      // the limiting worse.)
      let r = null, attempt = 0, backoff = 4000;
      while (attempt < attempts) {
        attempt++;
        r = await api.register(username, password);
        if (r.ok) break;
        if (isTaken(r.error)) {
          username = generateUsername(prefix, slot + 1 + attempt * 1000);
          onProgress({ slot, username, action: `name taken, trying ${username}`, ok: false });
          await sleep(1500);
          continue;
        }
        if (isRateLimited(r.error)) {
          onProgress({ slot, username, action: `rate limited; waiting ${Math.round(backoff / 1000)}s (attempt ${attempt})`, ok: false });
          await sleep(backoff);
          backoff = Math.min(60000, Math.round(backoff * 1.7));
          continue;
        }
        await sleep(3000);                       // unknown error: one more try, slower
      }

      if (!r.ok) {
        report.push({ slot, username, action: `could not register: ${r.error}`, ok: false });
        onProgress(report[report.length - 1]);
        continue;
      }

      member = {
        slot,
        username,
        password,
        kind: 'password',
        token: r.token,
        createdAt: new Date().toISOString(),
      };
      this.members.push(member);
      this.save();
      report.push({ slot, username, action: 'registered', ok: true, password });
      onProgress(report[report.length - 1]);
      await sleep(2500);                          // stay under the signup rate limit
    }

    this.members.sort((a, b) => a.slot - b.slot);
    this.meta = Object.assign(this.meta, { count: this.members.length, prefix });
    this.save();
    return report;
  }

  /**
   * Make sure every member has a character carrying its assigned name, and make it the active one.
   *
   * The game has no rename and no delete, only "create" and "select" (up to MAX_CHARS per
   * account), so a member whose character was made before naming gets a second, correctly named
   * character which the farm then uses. The old one stays on the account unused.
   */
  async ensureCharacters({ onProgress = () => { }, staggerMs = 2500, maxChars = 3, slots = null, loginAttempts = 6 } = {}) {
    const out = [];
    const wanted = slots && slots.length ? new Set(slots) : null;
    for (const m of this.members.slice().sort((a, b) => a.slot - b.slot)) {
      if (wanted && !wanted.has(m.slot)) continue;
      const note = (action, ok = true, extra = {}) => {
        const r = Object.assign({ slot: m.slot, username: m.username, charName: m.charName, action, ok }, extra);
        out.push(r); onProgress(r);
      };

      if (!m.charName) { note('no character name assigned', false); continue; }

      const r = await api.loginRetry(m.username, m.password, {
        attempts: loginAttempts,
        onWait: (ms, i, n) => note(`login rate-limited; waiting ${Math.round(ms / 1000)}s (${i}/${n})`, false),
      });
      if (!r.ok) { note(`sign-in failed: ${r.error}`, false); continue; }
      m.token = r.token;

      const data = await api.listChars(r.token);
      const chars = (data.chars || []);
      const hit = chars.find(c => c.name === m.charName);

      if (hit) {
        await api.selectChar(r.token, hit.id);
        m.charId = hit.id;
        note(`already exists (lv ${hit.lv} ${hit.job}) and is now selected`);
        continue;
      }

      const max = data.max || maxChars;
      if (chars.length >= max) {
        note(`cannot create "${m.charName}": ${chars.length}/${max} characters already used`, false);
        continue;
      }

      try {
        const c = await api.createChar(r.token, m.charName);
        await api.selectChar(r.token, c.id);
        m.charId = c.id;
        note(`created (id ${c.id}) and selected`);
      } catch (e) {
        note(`could not create: ${e.message}`, false);
      }
      await sleep(staggerMs);
    }
    this.save();
    return out;
  }

  /** A slot -> credentials map for the farm. */
  credentials() {
    const out = {};
    for (const m of this.members) {
      out[m.slot] = {
        username: m.username,
        storageSlot: m.storageSlot ?? m.slot,
        password: m.password,
        job: m.job || null,
        charName: m.charName || null,
      };
    }
    return out;
  }

  /**
   * Give each member its own class. Pass a list to set them explicitly, or nothing to spread
   * the six base classes across the team in order - which is the point of a six-member team:
   * between them they cover every class the game offers.
   */
  assignJobs(list) {
    const wanted = (list && list.length) ? list : BASE_CLASSES;
    const sorted = this.members.slice().sort((a, b) => a.slot - b.slot);
    sorted.forEach((m, i) => { m.job = wanted[i % wanted.length]; });
    this.save();
    return sorted.map(m => ({ slot: m.slot, username: m.username, job: m.job }));
  }

  /**
   * Give each member a character name. The game has no rename, so this only matters before the
   * character exists - but it is much easier to pick now than to delete and re-level later.
   */
  assignCharNames(list) {
    const sorted = this.members.slice().sort((a, b) => a.slot - b.slot);
    sorted.forEach((m, i) => {
      const explicit = list && list[i];
      m.charName = sanitiseName(explicit || DEFAULT_CHAR_NAMES[m.job] || null);
    });
    this.save();
    return sorted.map(m => ({ slot: m.slot, username: m.username, job: m.job, charName: m.charName }));
  }
}

/** Character names are 2-16 characters, no spaces; anything else is stripped. */
function sanitiseName(name) {
  if (!name) return null;
  const clean = String(name).replace(/\s+/g, '').slice(0, 16);
  return clean.length >= 2 ? clean : null;
}

module.exports = { Team, generatePassword, generateUsername, sanitiseName, DEFAULT_FILE, BASE_CLASSES, DEFAULT_CHAR_NAMES };
