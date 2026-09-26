/*
 * Couchcast server: a Cloudflare Worker.
 *
 * - Serves the app (the files in /public).
 * - Password sign-in (the APP_PASSWORD secret), remembered with a cookie for a year.
 * - /api/search  looks up podcasts in Apple's public directory.
 * - /api/feed    fetches a podcast feed for the app (feeds block web pages from reading them directly).
 * - /api/img     passes artwork through, so the app can read its colours for Now Playing.
 * - /api/sync    keeps listening progress the same on every device.
 * - /api/subs    adds and removes subscriptions.
 *
 * Everything you save lives in one Durable Object ("Store"), which is free-tier friendly.
 */
import { DurableObject } from 'cloudflare:workers';

const SESSION_COOKIE = 'cc_session';
const SESSION_DAYS = 365;
const USER_AGENT = 'Couchcast/1.0 (personal podcast player)';
const MAX_SUBS = 500;
const FORGET_AFTER_DAYS = 400;

const BASE_HEADERS = { 'x-couchcast': '1', 'cache-control': 'no-store' };

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}
const fail = (status, error) => json({ error }, status);

// ---- Sign-in ----

const encoder = new TextEncoder();

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

// Compares digests so the check takes the same time whatever the input.
async function sameText(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(x, y);
}

// The session value is derived from the password, so changing the password signs every device out.
async function sessionValue(env) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.APP_PASSWORD), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode('couchcast-session-v1')));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

async function isSignedIn(request, env) {
  if (!env.APP_PASSWORD) return false;
  const got = readCookie(request, SESSION_COOKIE);
  return got ? sameText(got, await sessionValue(env)) : false;
}

// ---- Helpers ----

function webAddress(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

const cleanText = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// ---- Routes ----

async function login(request, env) {
  if (!env.APP_PASSWORD) {
    return fail(500, 'The server has no password yet. Add a secret called APP_PASSWORD in Cloudflare, then try again.');
  }
  const { password } = await readJson(request);
  if (typeof password !== 'string' || !(await sameText(password, env.APP_PASSWORD))) {
    await new Promise(r => setTimeout(r, 800)); // slows down guessing
    return fail(401, 'That password is not right.');
  }
  const cookie = `${SESSION_COOKIE}=${await sessionValue(env)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
  return json({ ok: true }, 200, { 'set-cookie': cookie });
}

async function search(url, env) {
  const term = (url.searchParams.get('q') || '').trim().slice(0, 100);
  if (!term) return json([]);
  // SEARCH_URL is only for testing on your own computer; normally Apple's directory is used.
  const itunes = new URL(env.SEARCH_URL || 'https://itunes.apple.com/search');
  itunes.search = new URLSearchParams({ media: 'podcast', entity: 'podcast', limit: '25', term }).toString();
  const res = await fetch(itunes, { headers: { 'user-agent': USER_AGENT }, cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) {
    console.error('Apple search answered', res.status);
    return fail(502, `Apple’s podcast directory did not answer (${res.status}). Try again in a moment.`);
  }
  const data = await res.json();
  const results = (data.results || [])
    .filter(r => r.feedUrl)
    .map(r => ({
      feedUrl: r.feedUrl,
      title: r.collectionName || r.trackName || 'Untitled podcast',
      author: r.artistName || '',
      art: r.artworkUrl600 || r.artworkUrl100 || '',
    }));
  return json(results);
}

async function passThrough(url, { accept, cacheSeconds, check, contentType }) {
  const target = webAddress(url.searchParams.get('url'));
  if (!target) return fail(400, 'That address is not a web address.');
  let res;
  try {
    res = await fetch(target, {
      headers: { 'user-agent': USER_AGENT, accept },
      cf: { cacheTtl: cacheSeconds, cacheEverything: true },
      redirect: 'follow',
    });
  } catch {
    return fail(502, 'That website could not be reached.');
  }
  if (!res.ok) return fail(502, `That website answered with an error (${res.status}).`);
  const type = res.headers.get('content-type') || '';
  if (check && !check(type)) return fail(415, 'That address did not return the expected kind of file.');
  return new Response(res.body, {
    headers: {
      'x-couchcast': '1',
      'content-type': contentType || type,
      'cache-control': `private, max-age=${cacheSeconds}`,
      'x-content-type-options': 'nosniff',
    },
  });
}

async function api(request, env, url) {
  const route = url.pathname.slice('/api/'.length);
  const method = request.method;

  if (route === 'login' && method === 'POST') return login(request, env);
  if (!(await isSignedIn(request, env))) {
    return fail(401, env.APP_PASSWORD ? 'Sign in needed.' : 'The server has no password yet. Add a secret called APP_PASSWORD in Cloudflare.');
  }

  const store = env.STORE.get(env.STORE.idFromName('me'));

  if (route === 'sync' && method === 'POST') return json(await store.sync(await readJson(request)));

  if (route === 'subs' && method === 'POST') {
    const body = await readJson(request);
    const feed = webAddress(body.feedUrl);
    if (!feed) return fail(400, 'That podcast has no usable feed address.');
    return json(await store.addSub({
      feedUrl: feed.toString(),
      title: cleanText(body.title, 300),
      author: cleanText(body.author, 300),
      art: webAddress(body.art) ? String(body.art).slice(0, 2000) : '',
    }));
  }
  if (route === 'subs' && method === 'DELETE') {
    const { feedUrl } = await readJson(request);
    return json(await store.removeSub(String(feedUrl || '')));
  }

  if (route === 'search' && method === 'GET') return search(url, env);

  if (route === 'feed' && method === 'GET') {
    return passThrough(url, {
      accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
      cacheSeconds: 900,
      contentType: 'application/xml; charset=utf-8',
    });
  }

  if (route === 'img' && method === 'GET') {
    return passThrough(url, {
      accept: 'image/avif, image/webp, image/jpeg, image/png, image/*;q=0.8',
      cacheSeconds: 7 * 86400,
      check: type => type.startsWith('image/') && !type.includes('svg'),
    });
  }

  return fail(404, 'Unknown request.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await api(request, env, url);
    } catch (err) {
      console.error(err);
      return fail(500, 'Something went wrong on the server.');
    }
  },
};

// ---- Saved data: subscriptions, progress and the current episode ----

export class Store extends DurableObject {
  async read() {
    const got = await this.ctx.storage.get(['subs', 'progress', 'current']);
    return {
      subs: got.get('subs') || [],
      progress: got.get('progress') || {},
      current: got.get('current') || null,
    };
  }

  // Merge progress from one device. For each episode the most recent listen wins.
  async sync({ progress = {}, current = null } = {}) {
    const state = await this.read();
    let changed = false;
    for (const [id, p] of Object.entries(progress || {})) {
      if (typeof id !== 'string' || id.length > 200 || !p || typeof p !== 'object') continue;
      const entry = { pos: Number(p.pos) || 0, done: !!p.done, last: Number(p.last) || 0 };
      const old = state.progress[id];
      if (!old || entry.last > old.last) {
        state.progress[id] = entry;
        changed = true;
      }
    }
    const cutoff = Date.now() - FORGET_AFTER_DAYS * 86400000;
    for (const [id, p] of Object.entries(state.progress)) {
      if (p.last < cutoff) { delete state.progress[id]; changed = true; }
    }
    if (changed) await this.ctx.storage.put('progress', state.progress);

    if (current && typeof current.id === 'string' && current.id.length <= 200 && Number(current.at) > (state.current?.at || 0)) {
      state.current = { id: current.id, at: Number(current.at) };
      await this.ctx.storage.put('current', state.current);
    }
    return state;
  }

  async addSub(sub) {
    const { subs } = await this.read();
    if (!subs.some(s => s.feedUrl === sub.feedUrl) && subs.length < MAX_SUBS) {
      subs.push(sub);
      await this.ctx.storage.put('subs', subs);
    }
    return subs;
  }

  async removeSub(feedUrl) {
    const { subs } = await this.read();
    const kept = subs.filter(s => s.feedUrl !== feedUrl);
    await this.ctx.storage.put('subs', kept);
    return kept;
  }
}
