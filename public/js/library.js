/*
 * The library: subscriptions, episodes and listening progress.
 * Live mode talks to the Couchcast server (worker/index.js). Without a server
 * (the preview link, or opening index.html directly) it falls back to demo data.
 */
(function () {
  'use strict';

  const C = window.Couchcast;
  const DAY = 86400000;
  const MAX_EPISODES_PER_SHOW = 100;
  const CACHED_EPISODES_PER_SHOW = 60;
  const REFRESH_EVERY = 30 * 60000;

  let prefix = 'couchcast:';
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(prefix + key);
        return v == null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch { /* storage full or unavailable */ }
    },
  };

  // Short stable ids, so the same episode has the same id on every device.
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  class ApiError extends Error {
    constructor(message, code) { super(message); this.code = code; }
  }

  async function api(path, { method = 'GET', body, keepalive = false } = {}) {
    let res;
    try {
      res = await fetch('api/' + path, {
        method,
        credentials: 'same-origin',
        keepalive,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('Could not reach the server.', 'offline');
    }
    // Only our own server sets this header; anything else means there is no server here.
    if (!res.headers.get('x-couchcast')) throw new ApiError('No server here.', 'no-api');
    if (res.status === 401) {
      let msg = 'Sign in needed.';
      try { msg = (await res.json()).error || msg; } catch { /* keep default */ }
      throw new ApiError(msg, 'login');
    }
    if (!res.ok) {
      let msg = `The server answered with an error (${res.status}).`;
      try { msg = (await res.json()).error || msg; } catch { /* keep default */ }
      throw new ApiError(msg, 'server');
    }
    const type = res.headers.get('content-type') || '';
    return type.includes('json') ? res.json() : res.text();
  }

  // ---- Feed parsing ----

  const kid = (el, name) => {
    for (const c of el.children) if (c.tagName === name) return c;
    return null;
  };
  const kidText = (el, name) => (kid(el, name)?.textContent || '').trim();

  function plainText(html, max) {
    const text = new DOMParser().parseFromString(html || '', 'text/html').body.textContent || '';
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    const cut = clean.slice(0, max);
    const stop = cut.lastIndexOf('. ');
    return stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(' ')) + '…';
  }

  function parseDuration(raw) {
    if (!raw) return 0;
    if (/^\d+(\.\d+)?$/.test(raw)) return Math.round(parseFloat(raw));
    const parts = raw.split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    return parts.reduce((total, n) => total * 60 + n, 0);
  }

  function parseFeed(xml, sub) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const ch = doc.getElementsByTagName('channel')[0];
    if (!ch || doc.getElementsByTagName('parsererror').length) throw new Error('This feed could not be read.');
    const showId = hash(sub.feedUrl);
    const art = kid(ch, 'itunes:image')?.getAttribute('href') || kid(ch, 'image')?.getElementsByTagName('url')[0]?.textContent.trim() || sub.art || '';
    const show = {
      id: showId,
      feedUrl: sub.feedUrl,
      title: kidText(ch, 'title') || sub.title || 'Untitled podcast',
      author: kidText(ch, 'itunes:author') || sub.author || '',
      blurb: plainText(kidText(ch, 'itunes:summary') || kidText(ch, 'description'), 180),
      art,
    };
    const episodes = [];
    for (const item of ch.getElementsByTagName('item')) {
      if (episodes.length >= MAX_EPISODES_PER_SHOW) break;
      const url = kid(item, 'enclosure')?.getAttribute('url');
      if (!url) continue;
      const guid = kidText(item, 'guid') || url;
      episodes.push({
        id: showId + '~' + hash(guid),
        showId,
        title: kidText(item, 'title') || 'Untitled episode',
        date: Date.parse(kidText(item, 'pubDate')) || 0,
        duration: parseDuration(kidText(item, 'itunes:duration')),
        url,
        art: kid(item, 'itunes:image')?.getAttribute('href') || '',
      });
    }
    return { show, episodes };
  }

  // ---- The library object ----

  const lib = {
    mode: null,          // 'live' | 'demo'
    shows: [],
    episodes: [],
    subs: [],
    progress: {},
    current: null,
    currentAt: 0,
    refreshing: false,
    lastRefresh: 0,
    offline: false,
    feedErrors: {},
    listeners: new Set(),
    dirty: new Set(),
    syncTimer: 0,
    lastSync: 0,
    lastLocalSave: 0,

    isBusy: () => false, // replaced by the app: true while audio is playing
    onChange(fn) { this.listeners.add(fn); },
    emit(what) { this.listeners.forEach(fn => fn(what)); },

    // Artwork in live mode goes through our server so its colours can be read.
    art(url) {
      if (!url || this.mode !== 'live' || url.startsWith('data:')) return url;
      return 'api/img?url=' + encodeURIComponent(url);
    },

    async init() {
      prefix = 'couchcast:live:';
      const hadLive = store.get('used', false);
      this.progress = store.get('progress', {});
      this.current = store.get('current', null);
      this.currentAt = store.get('currentAt', 0);
      try {
        const state = await api('sync', { method: 'POST', body: { progress: this.progress, current: this.currentStamp() } });
        this.mode = 'live';
        store.set('used', true);
        this.adopt(state);
        this.loadCache();
        return 'ok';
      } catch (e) {
        if (e.code === 'login') { this.mode = 'live'; return 'login'; }
        if (e.code === 'offline' && hadLive) {
          this.mode = 'live';
          this.offline = true;
          this.subs = store.get('subs', []);
          this.loadCache();
          return 'ok';
        }
        if (e.code === 'no-api' || e.code === 'offline') { this.startDemo(); return 'demo'; }
        throw e;
      }
    },

    startDemo() {
      prefix = 'couchcast:demo:';
      const d = C.demo;
      this.mode = 'demo';
      this.shows = d.shows;
      this.episodes = d.episodes;
      const saved = store.get('progress', null);
      this.progress = saved || d.sampleProgress();
      this.current = store.get('current', saved ? null : d.startCurrent);
      this.lastRefresh = Date.now();
    },

    async login(password) {
      await api('login', { method: 'POST', body: { password } });
      return this.init();
    },

    currentStamp() { return this.current ? { id: this.current, at: this.currentAt } : null; },

    // Merge what the server knows; for each episode the most recent listen wins.
    adopt(state) {
      for (const [id, p] of Object.entries(state.progress || {})) {
        const mine = this.progress[id];
        if (!mine || p.last > mine.last) this.progress[id] = p;
      }
      // Another device's newer choice of episode wins, unless this one is playing right now.
      if (state.current && state.current.at > this.currentAt && !this.isBusy()) {
        this.current = state.current.id;
        this.currentAt = state.current.at;
      }
      this.subs = state.subs || [];
      store.set('subs', this.subs);
      this.saveLocal(true);
    },

    loadCache() {
      const cache = store.get('library', null);
      if (!cache) return;
      const feeds = new Set(this.subs.map(s => s.feedUrl));
      this.shows = cache.shows.filter(s => feeds.has(s.feedUrl));
      const ids = new Set(this.shows.map(s => s.id));
      this.episodes = cache.episodes.filter(e => ids.has(e.showId));
      this.lastRefresh = cache.at || 0;
    },

    saveCache() {
      const perShow = {};
      const episodes = this.episodes.filter(e => (perShow[e.showId] = (perShow[e.showId] || 0) + 1) <= CACHED_EPISODES_PER_SHOW);
      store.set('library', { at: this.lastRefresh, shows: this.shows, episodes });
    },

    // ---- Feeds ----

    async loadFeed(sub) {
      const xml = await api('feed?url=' + encodeURIComponent(sub.feedUrl));
      return parseFeed(xml, sub);
    },

    mergeFeed({ show, episodes }) {
      this.shows = this.shows.filter(s => s.id !== show.id).concat(show);
      this.episodes = this.episodes.filter(e => e.showId !== show.id).concat(episodes);
    },

    sortLibrary() {
      const order = new Map(this.subs.map((s, i) => [s.feedUrl, i]));
      this.shows.sort((a, b) => (order.get(a.feedUrl) ?? 1e9) - (order.get(b.feedUrl) ?? 1e9));
      this.episodes.sort((a, b) => b.date - a.date);
    },

    async refresh() {
      if (this.mode !== 'live' || this.refreshing) return;
      this.refreshing = true;
      this.emit('status');
      const queue = [...this.subs];
      const errors = {};
      let reached = false;
      const worker = async () => {
        while (queue.length) {
          const sub = queue.shift();
          try {
            this.mergeFeed(await this.loadFeed(sub));
            reached = true;
          } catch (e) {
            if (e.code !== 'offline') reached = true;
            if (e.code === 'login') { this.refreshing = false; this.emit('login'); return; }
            errors[sub.feedUrl] = e.message;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
      this.refreshing = false;
      this.offline = !reached && this.subs.length > 0;
      this.feedErrors = errors;
      if (!this.offline) this.lastRefresh = Date.now();
      this.sortLibrary();
      this.saveCache();
      this.emit('library');
    },

    maybeRefresh() {
      if (Date.now() - this.lastRefresh > REFRESH_EVERY / 2) this.refresh();
    },

    // ---- Subscriptions ----

    isSubscribed(feedUrl) {
      if (this.mode !== 'live') return feedUrl.startsWith('demo:');
      return this.subs.some(s => s.feedUrl === feedUrl);
    },

    async search(query) {
      if (this.mode !== 'live') {
        const q = query.toLowerCase();
        return this.shows.filter(s => s.title.toLowerCase().includes(q))
          .map(s => ({ feedUrl: s.feedUrl || 'demo:' + s.id, title: s.title, author: s.author, art: s.art }));
      }
      return api('search?q=' + encodeURIComponent(query));
    },

    async subscribe(result) {
      if (this.mode !== 'live') throw new Error('Subscribing needs the Couchcast server. This copy only has sample data.');
      this.subs = await api('subs', { method: 'POST', body: result });
      store.set('subs', this.subs);
      this.emit('subs');
      try {
        this.mergeFeed(await this.loadFeed(result));
        delete this.feedErrors[result.feedUrl];
      } catch (e) {
        this.feedErrors[result.feedUrl] = e.message;
      }
      this.sortLibrary();
      this.saveCache();
      this.emit('library');
    },

    async unsubscribe(feedUrl) {
      if (this.mode !== 'live') throw new Error('Unsubscribing needs the Couchcast server. This copy only has sample data.');
      this.subs = await api('subs', { method: 'DELETE', body: { feedUrl } });
      store.set('subs', this.subs);
      const id = hash(feedUrl);
      this.shows = this.shows.filter(s => s.id !== id);
      this.episodes = this.episodes.filter(e => e.showId !== id);
      this.saveCache();
      this.emit('library');
    },

    // ---- Progress ----

    entry(id) {
      return this.progress[id] || (this.progress[id] = { pos: 0, done: false, last: Date.now() });
    },

    touch(id, force) {
      this.dirty.add(id);
      this.saveLocal(force);
      this.scheduleSync(force);
    },

    setCurrent(id) {
      this.current = id;
      this.currentAt = Date.now();
      store.set('current', id);
      store.set('currentAt', this.currentAt);
      this.scheduleSync(true);
    },

    saveLocal(force) {
      const t = Date.now();
      if (!force && t - this.lastLocalSave < 4000) return;
      this.lastLocalSave = t;
      store.set('progress', this.progress);
      store.set('current', this.current);
      store.set('currentAt', this.currentAt);
    },

    scheduleSync(soon) {
      if (this.mode !== 'live') return;
      clearTimeout(this.syncTimer);
      const wait = soon ? 1500 : Math.max(1500, 20000 - (Date.now() - this.lastSync));
      this.syncTimer = setTimeout(() => this.sync(), wait);
    },

    async sync(keepalive = false) {
      if (this.mode !== 'live') return;
      clearTimeout(this.syncTimer);
      const ids = [...this.dirty];
      this.dirty.clear();
      const progress = Object.fromEntries(ids.filter(id => this.progress[id]).map(id => [id, this.progress[id]]));
      this.lastSync = Date.now();
      try {
        const state = await api('sync', { method: 'POST', keepalive, body: { progress, current: this.currentStamp() } });
        if (this.offline) { this.offline = false; this.emit('status'); }
        if (!keepalive) {
          const before = this.current;
          this.adopt(state);
          if (this.current !== before) this.emit('current');
        }
      } catch (e) {
        ids.forEach(id => this.dirty.add(id));
        if (e.code === 'login') this.emit('login');
        else if (e.code === 'offline' && !this.offline) { this.offline = true; this.emit('status'); }
      }
    },

    // Called when the page is hidden or closed.
    flush() {
      this.saveLocal(true);
      if (this.mode === 'live' && this.dirty.size) this.sync(true);
    },

    isRecent(ep, days) { return Date.now() - ep.date <= days * DAY; },
  };

  C.library = lib;
})();
