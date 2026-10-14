// api.js - the REST surface of asteria-online.io, reverse-engineered from the client.
// Every call here is something the real browser client does; we only skip the UI.
'use strict';

const BASE = 'https://asteria-online.io';

async function api(path, { method = 'GET', body, token, timeout = 20000 } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(BASE + path, {
      method, headers, signal: ctl.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status, ok: res.ok, json };
  } finally {
    clearTimeout(t);
  }
}

/** Create a throwaway guest account. Returns { token, username, guest } or throws. */
async function createGuest() {
  const r = await api('/api/guest', { method: 'POST', body: {} });
  if (!r.ok || !r.json.token) throw new Error(`guest creation failed: HTTP ${r.status}`);
  return {
    kind: 'guest',
    token: r.json.token,
    username: r.json.account.username,
    guest: r.json.guest,
  };
}

/**
 * Register a named account. Unlike a guest, this one can be signed into again from anywhere,
 * which is what makes a bot team durable and reusable.
 * Usernames are [A-Za-z0-9_]{3,20}; passwords 6-72 characters.
 */
async function register(username, password) {
  const r = await api('/api/register', { method: 'POST', body: { username, password } });
  return {
    ok: r.ok,
    status: r.status,
    error: r.ok ? null : (r.json && r.json.error) || `HTTP ${r.status}`,
    token: r.ok ? r.json.token : null,
    account: r.ok ? r.json.account : null,
  };
}

/** Sign in to a named account. Returns { ok, status, error, token, account }. */
async function login(username, password) {
  const r = await api('/api/login', { method: 'POST', body: { username, password } });
  return {
    ok: r.ok,
    status: r.status,
    error: r.ok ? null : (r.json && r.json.error) || `HTTP ${r.status}`,
    token: r.ok ? r.json.token : null,
    account: r.ok ? r.json.account : null,
  };
}

/**
 * Sign in, waiting out the login rate limit.
 *
 * `/api/login` answers 429 "ลองเข้าสู่ระบบบ่อยเกินไป" when several accounts sign in at once -
 * which is exactly what a team does when it starts from cold profiles. Backing off here is what
 * lets six windows come up together instead of failing.
 */
async function loginRetry(username, password, { attempts = 6, onWait } = {}) {
  let wait = 5000;
  let last = null;
  for (let i = 1; i <= attempts; i++) {
    last = await login(username, password);
    if (last.ok || last.status !== 429) return last;
    if (onWait) onWait(wait, i, attempts);
    await new Promise(r => setTimeout(r, wait));
    wait = Math.min(45000, Math.round(wait * 1.6));
  }
  return last;
}

/** Validate a stored token. */
async function whoami(token) {
  const r = await api('/api/me', { token });
  return r.ok ? r.json.account : null;
}

async function listChars(token) {
  const r = await api('/api/chars', { token });
  if (!r.ok) throw new Error(`chars failed: HTTP ${r.status}`);
  return r.json;
}

async function createChar(token, name) {
  const r = await api('/api/chars', { method: 'POST', body: { name }, token });
  if (!r.ok) throw new Error(`char creation failed: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  return r.json.char;
}

async function selectChar(token, id) {
  const r = await api('/api/chars/select', { method: 'POST', body: { id }, token });
  if (!r.ok) throw new Error(`char select failed: HTTP ${r.status}`);
  return r.json.account;
}

async function health() {
  const r = await api('/api/health');
  return r.ok ? r.json : null;
}

module.exports = { BASE, api, createGuest, whoami, listChars, createChar, selectChar, health, register, login, loginRetry };
