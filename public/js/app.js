/*
 * Couchcast: screens, keyboard navigation and the player.
 * Data comes from library.js (live server or demo); colours from theme.js.
 */
(function () {
  'use strict';

  const C = window.Couchcast;
  const lib = C.library;
  const theme = C.theme;

  const LATEST_DAYS = 14;
  const SKIP_BACK = 15;
  const SKIP_FWD = 30;
  const SKIP_FINE = 5;
  const DAY = 86400000;
  const PLAY = '▶︎';
  const PAUSE = '❚❚';
  const REWIND = '◀︎◀︎';
  const FFWD = '▶︎▶︎';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  let showById = new Map();
  let epById = new Map();
  function reindex() {
    showById = new Map(lib.shows.map(s => [s.id, s]));
    epById = new Map(lib.episodes.map(e => [e.id, e]));
  }

  const savedVolume = (() => { try { return JSON.parse(localStorage.getItem('couchcast:volume')); } catch { return null; } })();

  const state = {
    view: 'loading',
    showId: null,
    back: null,
    playing: false,
    volume: typeof savedVolume === 'number' ? savedVolume : 0.7,
    memory: {},
    keysOpen: false,
    keysReturn: null,
    query: '',
    results: null,
    searching: false,
    searchError: '',
    confirmKey: '',
    loginError: '',
  };

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const main = $('#main');
  const mini = $('#mini');
  const statusEl = $('#status');
  const osdEl = $('#osd');
  const keysEl = $('#keys');

  // ---- Formatting ----

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function fmtClock(t) {
    t = Math.max(0, Math.floor(t || 0));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }
  function fmtDur(sec) {
    if (!sec) return '';
    const m = Math.max(1, Math.round(sec / 60));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60} min`;
  }
  function fmtAgo(ts) {
    if (!ts) return '';
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    if (ts >= midnight) return 'Today';
    const d = Math.ceil((midnight - ts) / DAY);
    if (d <= 1) return 'Yesterday';
    if (d < 60) return `${d} days ago`;
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtSince(ts) {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    if (mins < 24 * 60) return `${Math.round(mins / 60)} hr ago`;
    return fmtAgo(ts).toLowerCase();
  }
  const fmtPlayed = ts => `Played ${fmtSince(ts)}`;
  const fmtDay = ts => (ts ? new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
  const joinMeta = (...parts) => parts.filter(Boolean).join(' · ');
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // ---- Episode status ----

  const artFor = ep => lib.art(ep.art || showById.get(ep.showId)?.art || '');
  const isRecent = ep => lib.isRecent(ep, LATEST_DAYS);

  function durOf(ep) {
    if (!ep) return 0;
    if (ep.duration) return ep.duration;
    if (audio && loadedId === ep.id && isFinite(audio.duration)) return audio.duration;
    return 0;
  }
  function status(ep) {
    const p = lib.progress[ep.id];
    if (p && p.done) return 'done';
    if (p && p.pos >= 1) return 'started';
    return isRecent(ep) ? 'new' : 'unplayed';
  }
  function pct(ep) {
    const d = durOf(ep), p = lib.progress[ep.id];
    return d && p ? clamp(p.pos / d, 0, 1) * 100 : 0;
  }
  function leftLabel(ep) {
    const d = durOf(ep);
    if (!d) return 'In progress';
    return `${Math.max(1, Math.ceil((d - (lib.progress[ep.id]?.pos || 0)) / 60))} min left`;
  }

  const latestEpisodes = () => lib.episodes.filter(isRecent);
  const recentEpisodes = () => Object.entries(lib.progress)
    .filter(([id, p]) => epById.has(id) && p.last && (p.done || p.pos >= 1 || id === lib.current))
    .sort((a, b) => b[1].last - a[1].last)
    .map(([id]) => epById.get(id));
  const upNext = () => latestEpisodes().find(e => e.id !== lib.current && status(e) !== 'done');

  // ---- Player ----

  let audio = null;
  let loadedId = null;
  let pendingSeek = null;
  let lastPositionState = 0;

  const player = {
    ep() { return lib.current ? epById.get(lib.current) || null : null; },
    pos() { return lib.progress[lib.current]?.pos || 0; },

    // Point the audio at the current episode, resuming from where it was left.
    prepare() {
      const ep = this.ep();
      if (!ep || loadedId === ep.id) return;
      loadedId = ep.id;
      pendingSeek = lib.progress[ep.id]?.done ? 0 : this.pos();
      audio.src = ep.url;
      audio.volume = state.volume;
      setMediaSession(ep);
    },
    load(id) {
      if (!epById.has(id)) return;
      const p = lib.entry(id);
      if (p.done) { p.done = false; p.pos = 0; }
      p.last = Date.now();
      lib.setCurrent(id);
      lib.touch(id, true);
      this.play();
    },
    play() {
      if (!this.ep()) return;
      this.prepare();
      lib.setCurrent(lib.current);
      const started = audio.play();
      if (started && started.catch) {
        started.catch(err => {
          if (err && err.name === 'NotAllowedError') osd(`${PLAY} Press play`);
          else if (err && err.name !== 'AbortError') notify('This episode will not play. The podcast’s website may be down.');
        });
      }
    },
    pause() { if (audio) audio.pause(); },
    toggle() {
      if (!this.ep()) { osd('Nothing playing'); return; }
      if (audio.paused || loadedId !== lib.current) this.play(); else this.pause();
    },
    seekTo(t) {
      const ep = this.ep();
      if (!ep) return;
      this.prepare();
      const d = durOf(ep);
      t = Math.max(0, d ? Math.min(t, d) : t);
      if (pendingSeek != null) pendingSeek = t;
      else { try { audio.currentTime = t; } catch { pendingSeek = t; } }
      const p = lib.entry(ep.id);
      p.pos = t;
      p.last = Date.now();
      lib.touch(ep.id);
      updateTimeUI();
      if (d && t >= d - 0.5) this.finish();
    },
    finish() {
      const ep = this.ep();
      if (!ep) return;
      const p = lib.entry(ep.id);
      p.done = true;
      p.pos = durOf(ep);
      p.last = Date.now();
      lib.touch(ep.id, true);
      const next = upNext();
      if (next) {
        this.load(next.id);
        osd('Up next');
      } else {
        audio.pause();
        osd('All caught up');
      }
      render();
    },
  };

  function wireAudio() {
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
      const ep = epById.get(loadedId);
      if (ep && !ep.duration && isFinite(audio.duration)) ep.duration = Math.round(audio.duration);
      if (pendingSeek != null) {
        try { audio.currentTime = pendingSeek; } catch { /* stays at the start */ }
        pendingSeek = null;
      }
      updateTimeUI();
    });
    audio.addEventListener('play', () => {
      state.playing = true;
      if (hasMediaSession) navigator.mediaSession.playbackState = 'playing';
      updatePlayUI();
    });
    audio.addEventListener('pause', () => {
      state.playing = false;
      if (hasMediaSession) navigator.mediaSession.playbackState = 'paused';
      if (loadedId) lib.touch(loadedId, true);
      updatePlayUI();
    });
    audio.addEventListener('timeupdate', () => {
      if (pendingSeek != null || loadedId !== lib.current || !loadedId) return;
      const p = lib.entry(loadedId);
      p.pos = audio.currentTime;
      p.last = Date.now();
      lib.touch(loadedId);
      updateTimeUI();
      updatePositionState();
    });
    audio.addEventListener('ended', () => player.finish());
    audio.addEventListener('error', () => {
      if (!loadedId) return;
      state.playing = false;
      updatePlayUI();
      notify('This episode will not play. The podcast’s website may be down.');
    });
  }

  let seekAcc = 0, seekAt = 0;
  function skip(seconds) {
    if (!player.ep()) { osd('Nothing playing'); return; }
    player.seekTo(player.pos() + seconds);
    const t = performance.now();
    seekAcc = t - seekAt < 900 && Math.sign(seekAcc) === Math.sign(seconds) ? seekAcc + seconds : seconds;
    seekAt = t;
    osd(`${seekAcc > 0 ? FFWD + ' +' : REWIND + ' −'}${Math.abs(seekAcc)}s`);
  }

  function setVolume(delta) {
    state.volume = clamp(Math.round((state.volume + delta) * 10) / 10, 0, 1);
    if (audio) audio.volume = state.volume;
    try { localStorage.setItem('couchcast:volume', JSON.stringify(state.volume)); } catch { /* storage unavailable */ }
    updateVolUI();
    osd(`<span class="osd-label">Vol</span>${volBlocks()}<span>${Math.round(state.volume * 100)}%</span>`);
  }
  const volBlocks = () => {
    const n = Math.round(state.volume * 10);
    return `<span class="vol-blocks" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
  };

  // ---- Media keys and the phone lock screen ----

  const hasMediaSession = 'mediaSession' in navigator;
  if (hasMediaSession) {
    const handle = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported */ } };
    handle('play', () => player.play());
    handle('pause', () => player.pause());
    handle('seekbackward', () => skip(-SKIP_BACK));
    handle('seekforward', () => skip(SKIP_FWD));
    handle('previoustrack', () => skip(-SKIP_BACK));
    handle('nexttrack', () => skip(SKIP_FWD));
    handle('seekto', d => { if (d && typeof d.seekTime === 'number') player.seekTo(d.seekTime); });
  }
  function setMediaSession(ep) {
    if (!hasMediaSession || !ep) return;
    const s = showById.get(ep.showId);
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: ep.title,
        artist: s ? s.title : '',
        album: 'Couchcast',
        artwork: [{ src: new URL(artFor(ep), location.href).href }],
      });
    } catch { /* unsupported */ }
  }
  function updatePositionState() {
    if (!hasMediaSession || !navigator.mediaSession.setPositionState) return;
    const t = Date.now();
    if (t - lastPositionState < 5000) return;
    lastPositionState = t;
    const d = durOf(player.ep());
    if (!d) return;
    try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(player.pos(), d), playbackRate: 1 }); } catch { /* ignore */ }
  }

  // ---- Now Playing colour ----

  let themeFor = null;
  // Now Playing takes its colour from the episode's artwork, a podcast page from the show's.
  function themeArt() {
    if (state.view === 'now') {
      const ep = player.ep();
      return ep ? artFor(ep) : null;
    }
    if (state.view === 'show') {
      const s = showById.get(state.showId);
      return s && s.art ? lib.art(s.art) : null;
    }
    return null;
  }

  function applyTheme() {
    const root = document.documentElement.style;
    const clear = () => theme.KEYS.forEach(k => root.removeProperty(k));
    const url = themeArt();
    if (!url) { themeFor = null; clear(); return; }
    if (themeFor === url) return;
    themeFor = url;
    theme.hueForImage(url).then(hue => {
      if (themeFor !== url) return;
      if (hue == null) { clear(); return; }
      const palette = theme.paletteFor(hue);
      theme.KEYS.forEach(k => root.setProperty(k, palette[k]));
    });
  }

  // ---- On-screen messages ----

  let osdTimer = 0;
  function osd(html, kind) {
    osdEl.innerHTML = html;
    osdEl.classList.toggle('osd-msg', kind === 'msg');
    osdEl.classList.add('show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => osdEl.classList.remove('show'), kind === 'msg' ? 3500 : 900);
  }
  const notify = text => osd(esc(text), 'msg');

  // Press once to arm, again to confirm. Works the same with a keyboard, mouse or finger.
  let confirmTimer = 0;
  function confirmStep(key, redraw) {
    if (state.confirmKey === key) {
      state.confirmKey = '';
      clearTimeout(confirmTimer);
      return true;
    }
    state.confirmKey = key;
    redraw();
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => { state.confirmKey = ''; redraw(); }, 4000);
    return false;
  }

  // ---- Templates ----

  function badgeFor(ep, cls = 'badge') {
    if (ep.id === lib.current) return `<span class="${cls}" data-playstate></span>`;
    const st = status(ep);
    if (st === 'new') return `<span class="${cls}">New</span>`;
    if (st === 'done') return `<span class="${cls} badge-dim">✓ Played</span>`;
    return '';
  }

  function progressBar(ep) {
    const cur = ep.id === lib.current;
    return status(ep) === 'started' || cur
      ? `<span class="bar"><i ${cur ? 'data-bar' : ''} style="width:${pct(ep)}%"></i></span>`
      : '';
  }

  function tile(ep, metaOverride) {
    const s = showById.get(ep.showId) || { title: '' };
    const st = status(ep);
    const cur = ep.id === lib.current;
    const meta = metaOverride || joinMeta(fmtAgo(ep.date), st === 'started' ? leftLabel(ep) : fmtDur(durOf(ep)));
    const hint = cur ? 'Open player' : st === 'started' ? 'Resume' : st === 'done' ? 'Play again' : 'Play';
    const label = [ep.title, s.title, meta, cur ? 'now playing' : st === 'new' ? 'new' : st === 'done' ? 'played' : ''].filter(Boolean).join(', ');
    return `<button class="tile${st === 'done' && !cur ? ' is-done' : ''}" data-nav data-key="ep:${esc(ep.id)}" data-action="play" data-id="${esc(ep.id)}" aria-label="${esc(label)}">
      <span class="art-wrap">
        <img class="art" src="${esc(artFor(ep))}" alt="" loading="lazy">
        ${badgeFor(ep)}
        <span class="t-hint">${hint}</span>
      </span>
      ${progressBar(ep) || '<span class="bar bar-empty"></span>'}
      <span class="t-title">${esc(ep.title)}</span>
      <span class="t-show">${esc(s.title)}</span>
      <span class="t-meta">${esc(meta)}</span>
    </button>`;
  }

  function showTile(s) {
    const eps = lib.episodes.filter(e => e.showId === s.id);
    const fresh = eps.filter(e => status(e) === 'new').length;
    const meta = eps.length ? `${plural(eps.length, 'episode')} · latest ${fmtAgo(eps[0].date).toLowerCase()}` : 'No episodes yet';
    return `<button class="tile" data-nav data-key="show:${esc(s.id)}" data-action="show" data-id="${esc(s.id)}" aria-label="${esc(s.title)}, ${fresh} new">
      <span class="art-wrap">
        <img class="art" src="${esc(lib.art(s.art))}" alt="" loading="lazy">
        ${fresh ? `<span class="badge">${fresh} New</span>` : ''}
        <span class="t-hint">Episodes</span>
      </span>
      <span class="bar bar-empty"></span>
      <span class="t-title">${esc(s.title)}</span>
      <span class="t-show">${esc(s.author)}</span>
      <span class="t-meta">${esc(meta)}</span>
    </button>`;
  }

  function addTile() {
    return `<button class="tile tile-add" data-nav data-key="add" data-action="tab" data-tab="search" aria-label="Add a podcast">
      <span class="art-wrap add-art"><span class="add-plus" aria-hidden="true">+</span><span class="t-hint">Search</span></span>
      <span class="bar bar-empty"></span>
      <span class="t-title">Add a podcast</span>
      <span class="t-meta">Search by name</span>
    </button>`;
  }

  function row(ep) {
    const st = status(ep);
    const cur = ep.id === lib.current;
    const length = st === 'started' ? leftLabel(ep) : fmtDur(durOf(ep));
    return `<li><button class="row row-ep${st === 'done' && !cur ? ' is-done' : ''}" data-nav data-key="ep:${esc(ep.id)}" data-action="play" data-id="${esc(ep.id)}" aria-label="${esc(joinMeta(ep.title, fmtDay(ep.date), length))}">
      <img class="art row-art" src="${esc(artFor(ep))}" alt="" loading="lazy">
      <span class="row-main">${badgeFor(ep, 'flag') ? `<span class="row-flag">${badgeFor(ep, 'flag')}</span>` : ''}<span class="row-title">${esc(ep.title)}</span>${progressBar(ep)}</span>
      <span class="row-meta"><span>${esc(fmtDay(ep.date))}</span><span>${esc(length)}</span></span>
    </button></li>`;
  }

  function resultRow(r, i) {
    const subbed = lib.isSubscribed(r.feedUrl);
    const confirming = state.confirmKey === 'unsub:' + r.feedUrl;
    const action = confirming ? 'Press again to remove' : subbed ? '✓ Subscribed' : '+ Subscribe';
    return `<li><button class="row row-result${subbed ? ' is-subbed' : ''}${confirming ? ' is-confirming' : ''}" data-nav data-key="res:${i}" data-action="sub-toggle" data-i="${i}" aria-label="${esc(joinMeta(r.title, r.author, subbed ? 'subscribed' : 'not subscribed'))}">
      <img class="art row-art" src="${esc(lib.art(r.art))}" alt="" loading="lazy">
      <span class="row-main"><span class="row-title">${esc(r.title)}</span><span class="row-sub">${esc(r.author)}</span></span>
      <span class="row-action">${action}</span>
    </button></li>`;
  }

  function emptyLibrary() {
    if (lib.refreshing && lib.subs.length) return '<p class="empty">Loading your podcasts…</p>';
    return `<div class="empty-state">
      <p class="empty-title">No podcasts yet</p>
      <p class="empty">Search for the shows you listen to. Their new episodes will appear here.</p>
      <button class="btn" data-nav data-key="go-search" data-action="tab" data-tab="search"><kbd>4</kbd> Search for podcasts</button>
    </div>`;
  }

  const VIEWS = {
    loading() { return '<p class="empty">Loading…</p>'; },

    login() {
      return `<div class="login">
        <div class="login-box">
          <p class="brand login-brand">COUCH<span>CAST</span></p>
          <form class="login-form" data-form="login">
            <label class="login-label" for="pw">Password</label>
            <input class="field" id="pw" name="pw" type="password" data-nav data-key="pw" autocomplete="current-password" enterkeyhint="go">
            <button class="btn" type="submit" data-nav data-key="pw-go">Sign in</button>
          </form>
          <p class="login-msg" id="login-msg" role="alert">${esc(state.loginError)}</p>
          <p class="login-note">You only need to sign in once on each device.</p>
        </div>
      </div>`;
    },

    latest() {
      if (!lib.shows.length) return emptyLibrary();
      const eps = latestEpisodes();
      const body = eps.length
        ? `<div class="grid">${eps.map(e => tile(e)).join('')}</div>`
        : '<p class="empty">Nothing new in the last 14 days. Older episodes are under Podcasts.</p>';
      return `<section aria-labelledby="h-view">
        <h2 class="eyebrow" id="h-view">Latest <span>· last ${LATEST_DAYS} days · ${plural(eps.length, 'episode')}</span></h2>
        ${body}
      </section>`;
    },

    podcasts() {
      if (!lib.shows.length) return emptyLibrary();
      return `<section aria-labelledby="h-view">
        <h2 class="eyebrow" id="h-view">Podcasts <span>· ${plural(lib.shows.length, 'subscription')}</span></h2>
        <div class="grid">${lib.shows.map(showTile).join('')}${lib.mode === 'live' ? addTile() : ''}</div>
      </section>`;
    },

    show() {
      const s = showById.get(state.showId);
      const eps = lib.episodes.filter(e => e.showId === s.id);
      const error = lib.feedErrors[s.feedUrl];
      const confirming = state.confirmKey === 'unsub:' + s.feedUrl;
      return `<div class="show">
        <aside class="show-side">
          <img class="art show-art" src="${esc(lib.art(s.art))}" alt="${esc(s.title)} artwork">
          <div class="show-head">
            <h2 class="show-title">${esc(s.title)}</h2>
            <p class="show-author">${esc(s.author)}</p>
            ${s.blurb ? `<p class="show-blurb">${esc(s.blurb)}</p>` : ''}
            <div class="show-actions">
              <button class="btn btn-sm" data-nav data-key="back" data-action="back"><kbd>Esc</kbd> All podcasts</button>
              ${lib.mode === 'live' ? `<button class="btn btn-sm${confirming ? ' is-confirming' : ''}" data-nav data-key="unsub" data-action="unsub" data-feed="${esc(s.feedUrl)}">${confirming ? 'Press again to unsubscribe' : 'Unsubscribe'}</button>` : ''}
            </div>
          </div>
        </aside>
        <section aria-labelledby="h-view">
          <h2 class="eyebrow" id="h-view">Episodes <span>· ${eps.length}</span></h2>
          ${error ? `<p class="warn-note">This feed did not update: ${esc(error)}</p>` : ''}
          <ol class="rows">${eps.map(row).join('')}</ol>
        </section>
      </div>`;
    },

    recent() {
      const eps = recentEpisodes();
      const body = eps.length
        ? `<div class="grid">${eps.map(e => tile(e, fmtPlayed(lib.progress[e.id].last))).join('')}</div>`
        : '<p class="empty">Nothing played yet. Episodes you start will show up here.</p>';
      return `<section aria-labelledby="h-view">
        <h2 class="eyebrow" id="h-view">Recently played <span>· ${eps.length}</span></h2>
        ${body}
      </section>`;
    },

    search() {
      return `<section aria-labelledby="h-view">
        <h2 class="eyebrow" id="h-view">Search <span>· ${lib.mode === 'live' ? 'Apple Podcasts directory' : 'sample shows only'}</span></h2>
        <form class="search-form" data-form="search" role="search">
          <label class="sr-only" for="q">Podcast name</label>
          <input class="field" id="q" name="q" type="search" data-nav data-key="q" placeholder="Type a podcast name" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" value="${esc(state.query)}">
        </form>
        <p class="search-status" id="search-status" role="status"></p>
        <ol class="rows results" id="results"></ol>
      </section>`;
    },

    now() {
      const ep = player.ep();
      const s = showById.get(ep.showId) || { title: '' };
      const next = upNext();
      return `<div class="np">
        <div class="np-art"><img class="art" src="${esc(artFor(ep))}" alt="${esc(s.title)} artwork"></div>
        <div class="np-info">
          <button class="btn btn-sm np-back" data-nav data-key="np-back" data-action="back"><kbd>Esc</kbd> Library</button>
          <div class="np-head">
            <p class="np-show">${esc(s.title)}</p>
            <h1 class="np-title">${esc(ep.title)}</h1>
            <p class="np-meta">${esc(joinMeta(fmtAgo(ep.date), fmtDur(durOf(ep))))}</p>
          </div>
          <div class="np-seek">
            <div class="np-bar" data-seekbar role="slider" aria-label="Position" aria-valuemin="0"><i data-bar></i><b data-knob></b></div>
            <div class="np-times"><span data-time></span><span data-remain></span></div>
          </div>
          <div class="np-controls">
            <button class="btn big" data-nav data-key="np-b" data-action="back15" aria-label="Back ${SKIP_BACK} seconds"><span aria-hidden="true">${REWIND}</span> ${SKIP_BACK}</button>
            <button class="btn big np-play" data-nav data-key="np-pp" data-action="toggle" data-playbtn></button>
            <button class="btn big" data-nav data-key="np-f" data-action="fwd30" aria-label="Forward ${SKIP_FWD} seconds">${SKIP_FWD} <span aria-hidden="true">${FFWD}</span></button>
          </div>
          <div class="np-vol"><span class="np-label">Vol</span><span data-vol></span><span data-volpct></span></div>
          <p class="np-next"><span class="np-label">Up next</span> ${next ? `${esc(next.title)} <span class="dim">· ${esc(showById.get(next.showId)?.title)}</span>` : '<span class="dim">Nothing. You are all caught up.</span>'}</p>
          <p class="np-keys"><kbd>←</kbd> ${SKIP_BACK}s &nbsp;<kbd>Shift</kbd>+<kbd>←</kbd> ${SKIP_FINE}s &nbsp;<kbd>→</kbd> ${SKIP_FWD}s &nbsp;<kbd>Shift</kbd>+<kbd>→</kbd> ${SKIP_FINE}s &nbsp;<kbd>↑</kbd><kbd>↓</kbd> volume</p>
        </div>
      </div>`;
    },
  };

  // ---- Rendering ----

  const viewKey = () => (state.view === 'show' ? 'show:' + state.showId : state.view);
  const isVisible = el => el.getClientRects().length > 0;

  function render(mode = 'auto') {
    if (state.view === 'show' && !showById.has(state.showId)) state.view = 'podcasts';
    if (state.view === 'now' && !player.ep()) state.view = (state.back && state.back.view) || 'latest';

    const active = document.activeElement;
    const focusWasInContent = !active || active === document.body || main.contains(active) || mini.contains(active);
    const key = viewKey();
    const sameView = main.dataset.view === key;
    const top = main.scrollTop;

    document.body.dataset.view = state.view;
    main.innerHTML = VIEWS[state.view]();
    main.dataset.view = key;
    main.scrollTop = sameView ? top : 0;

    renderChrome();
    applyTheme();
    if (state.view === 'search') renderResults();
    updatePlayUI();
    updateTimeUI();
    updateVolUI();

    if (mode === 'force' || focusWasInContent) focusEl(defaultFocus(), false);
  }

  function renderChrome() {
    const tabView = state.view === 'show' ? 'podcasts' : state.view;
    $$('.tab').forEach(t => t.setAttribute('aria-current', t.dataset.tab === tabView ? 'page' : 'false'));

    const parts = [`<span><span class="led" aria-hidden="true"></span> ${plural(lib.shows.length || lib.subs.length, 'subscription')}</span>`];
    if (lib.mode === 'demo') {
      parts.push('<span class="dim">Sample data · no server connected</span>');
    } else {
      if (lib.refreshing) parts.push('<span>Refreshing…</span>');
      else if (lib.offline) parts.push('<span class="warn">Offline · showing saved episodes</span>');
      else if (lib.lastRefresh) parts.push(`<span class="dim">Updated ${fmtSince(lib.lastRefresh)}</span>`);
      const broken = Object.keys(lib.feedErrors).length;
      if (broken && !lib.offline) parts.push(`<span class="warn">${broken} feed${broken > 1 ? 's' : ''} not updating</span>`);
    }
    statusEl.innerHTML = parts.join('');

    const ep = player.ep();
    mini.hidden = !ep || state.view === 'now' || state.view === 'login' || state.view === 'loading';
    if (mini.hidden) { mini.innerHTML = ''; return; }
    const s = showById.get(ep.showId) || { title: '' };
    mini.innerHTML = `<button class="mini" data-nav data-key="mini" data-action="open-now" aria-label="Open Now Playing: ${esc(ep.title)}">
      <span class="bar mini-bar"><i data-bar></i></span>
      <img class="art mini-art" src="${esc(artFor(ep))}" alt="">
      <span class="mini-state" data-playstate></span>
      <span class="mini-text"><span class="mini-title">${esc(ep.title)}</span><span class="mini-show">${esc(s.title)}</span></span>
      <span class="mini-time"><span data-time></span><span data-total></span></span>
      <span class="mini-key"><kbd>N</kbd> Open</span>
    </button>`;
  }

  function renderResults() {
    const list = $('#results'), msg = $('#search-status');
    if (!list) return;
    const active = document.activeElement;
    const activeKey = list.contains(active) ? active.dataset.key : null;
    let text;
    if (state.searching) text = 'Searching…';
    else if (state.searchError) text = state.searchError;
    else if (state.query && state.results) text = state.results.length ? `${plural(state.results.length, 'result')} · press ↓ to reach them, Enter to subscribe` : 'No podcasts found. Try fewer or different words.';
    else text = 'Type a name and press Enter.';
    msg.textContent = text;
    list.innerHTML = (state.results || []).map(resultRow).join('');
    if (activeKey) focusEl(list.querySelector(`[data-key="${activeKey}"]`) || $('#q'), false);
  }

  function updatePlayUI() {
    $$('[data-playbtn]').forEach(b => { b.textContent = state.playing ? `${PAUSE} Pause` : `${PLAY} Play`; });
    $$('[data-playstate]').forEach(el => { el.textContent = state.playing ? `${PLAY} Playing` : `${PAUSE} Paused`; });
    document.body.classList.toggle('is-playing', state.playing);
  }

  function updateTimeUI() {
    const ep = player.ep();
    if (!ep) return;
    const pos = player.pos();
    const d = durOf(ep);
    const f = d ? clamp(pos / d, 0, 1) * 100 + '%' : '0%';
    $$('[data-time]').forEach(el => { el.textContent = fmtClock(pos); });
    $$('[data-remain]').forEach(el => { el.textContent = d ? '−' + fmtClock(d - pos) : ''; });
    $$('[data-total]').forEach(el => { el.textContent = d ? ' / ' + fmtClock(d) : ''; });
    $$('[data-bar]').forEach(el => { el.style.width = f; });
    $$('[data-knob]').forEach(el => { el.style.left = f; });
    const bar = $('[data-seekbar]');
    if (bar) {
      bar.setAttribute('aria-valuemax', Math.floor(d));
      bar.setAttribute('aria-valuenow', Math.floor(pos));
      bar.setAttribute('aria-valuetext', d ? `${fmtClock(pos)} of ${fmtClock(d)}` : fmtClock(pos));
    }
  }

  function updateVolUI() {
    $$('[data-vol]').forEach(el => { el.innerHTML = volBlocks(); });
    $$('[data-volpct]').forEach(el => { el.textContent = Math.round(state.volume * 100) + '%'; });
  }

  // ---- Navigation ----

  function go(view, mode = 'auto') {
    state.view = view;
    state.showId = null;
    render(mode);
  }

  function openShow(id) {
    state.view = 'show';
    state.showId = id;
    render('force');
  }

  function openNow() {
    if (!player.ep()) { osd('Nothing playing'); return; }
    if (state.view !== 'now') state.back = { view: state.view, showId: state.showId };
    state.view = 'now';
    render('force');
  }

  function goBack() {
    if (state.view === 'now') {
      const b = state.back || { view: 'latest', showId: null };
      state.view = b.view;
      state.showId = b.showId;
      render('force');
    } else if (state.view === 'show') {
      go('podcasts', 'force');
    } else if (state.view !== 'latest' && state.view !== 'login' && state.view !== 'loading') {
      go('latest', 'force');
    }
  }

  function defaultFocus() {
    if (state.view === 'now') return $('[data-key="np-pp"]');
    if (state.view === 'login') return $('#pw');
    const key = state.memory[viewKey()];
    if (key) {
      const el = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (el && isVisible(el)) return el;
    }
    if (state.view === 'show') return main.querySelector('.row-ep') || main.querySelector('[data-nav]');
    return main.querySelector('[data-nav]') || $('.tab');
  }

  function focusEl(el, smooth = true) {
    if (!el) return;
    el.focus({ preventScroll: true });
    if (main.contains(el)) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth && !reduceMotion.matches ? 'smooth' : 'auto' });
    }
  }

  // Spatial navigation: pick the nearest target in the pressed direction.
  function move(dir) {
    const scope = state.keysOpen ? keysEl : document;
    const list = $$('[data-nav]', scope).filter(isVisible);
    const cur = document.activeElement;
    if (!list.includes(cur)) { focusEl(defaultFocus()); return; }
    const a = cur.getBoundingClientRect();
    const acx = a.left + a.width / 2, acy = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const bcx = b.left + b.width / 2, bcy = b.top + b.height / 2;
      let primary, cross;
      if (dir === 'right') { primary = b.left - a.right; cross = Math.abs(bcy - acy); }
      else if (dir === 'left') { primary = a.left - b.right; cross = Math.abs(bcy - acy); }
      else if (dir === 'down') { primary = b.top - a.bottom; cross = Math.abs(bcx - acx); }
      else { primary = a.top - b.bottom; cross = Math.abs(bcx - acx); }
      if (primary < -2) continue;
      const score = Math.max(0, primary) + cross * 2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) focusEl(best);
  }

  // ---- Search, subscribe and sign in ----

  let searchSeq = 0, searchTimer = 0;
  async function runSearch(q) {
    clearTimeout(searchTimer);
    q = q.trim();
    state.query = q;
    const seq = ++searchSeq;
    if (!q) {
      state.results = null;
      state.searching = false;
      state.searchError = '';
      renderResults();
      return;
    }
    state.searching = true;
    state.searchError = '';
    renderResults();
    try {
      const results = await lib.search(q);
      if (seq !== searchSeq) return;
      state.results = results;
    } catch (e) {
      if (seq !== searchSeq) return;
      state.results = null;
      state.searchError = e.message;
      if (e.code === 'login') { state.view = 'login'; render('force'); return; }
    }
    state.searching = false;
    renderResults();
  }

  function toggleSubscription(r) {
    if (lib.isSubscribed(r.feedUrl)) {
      if (lib.mode !== 'live') { notify('The sample shows are built in. Subscribing needs the Couchcast server.'); return; }
      if (!confirmStep('unsub:' + r.feedUrl, renderResults)) return;
      renderResults();
      lib.unsubscribe(r.feedUrl).then(() => osd('Removed')).catch(e => notify(e.message));
    } else {
      osd('Subscribing…');
      lib.subscribe(r).then(() => osd('✓ Subscribed')).catch(e => notify(e.message));
    }
  }

  async function signIn(password) {
    const msg = $('#login-msg');
    if (!password) { msg.textContent = 'Type your password first.'; return; }
    msg.textContent = 'Checking…';
    try {
      const result = await lib.login(password);
      state.loginError = '';
      if (result === 'ok') startApp();
    } catch (e) {
      state.loginError = e.message;
      msg.textContent = e.message;
      const pw = $('#pw');
      if (pw) { pw.select(); pw.focus(); }
    }
  }

  // ---- Actions ----

  function act(action, el) {
    switch (action) {
      case 'tab': go(el.dataset.tab, el.closest('.tabs') ? 'auto' : 'force'); break;
      case 'show': openShow(el.dataset.id); break;
      case 'play': {
        const id = el.dataset.id;
        if (id !== lib.current || lib.progress[id]?.done) player.load(id);
        else if (!state.playing) player.play();
        openNow();
        break;
      }
      case 'open-now': openNow(); break;
      case 'back': goBack(); break;
      case 'toggle': player.toggle(); break;
      case 'back15': skip(-SKIP_BACK); break;
      case 'fwd30': skip(SKIP_FWD); break;
      case 'keys': openKeys(); break;
      case 'keys-close': closeKeys(); break;
      case 'sub-toggle': {
        const r = state.results && state.results[Number(el.dataset.i)];
        if (r) toggleSubscription(r);
        break;
      }
      case 'unsub': {
        const feed = el.dataset.feed;
        if (!confirmStep('unsub:' + feed, () => { if (state.view === 'show') render(); })) break;
        lib.unsubscribe(feed).then(() => { osd('Unsubscribed'); go('podcasts', 'force'); }).catch(e => notify(e.message));
        break;
      }
    }
  }

  function openKeys() {
    state.keysOpen = true;
    state.keysReturn = document.activeElement;
    keysEl.hidden = false;
    $('#keys-close').focus();
  }
  function closeKeys() {
    state.keysOpen = false;
    keysEl.hidden = true;
    if (state.keysReturn && document.contains(state.keysReturn)) state.keysReturn.focus({ preventScroll: true });
    else focusEl(defaultFocus(), false);
  }

  // ---- Input ----

  const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

  function activateFocused() {
    const active = document.activeElement;
    const el = active && active.closest && active.closest('[data-action]');
    if (el) act(el.dataset.action, el);
    else if (active && active.tagName === 'BUTTON') active.click();
    else focusEl(defaultFocus());
  }

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const typing = e.target && e.target.matches && e.target.matches('input, textarea');
    if (!typing) document.body.classList.add('hide-cursor');

    if (k === 'MediaPlayPause') { player.toggle(); e.preventDefault(); return; }
    if (k === 'MediaTrackNext') { skip(SKIP_FWD); e.preventDefault(); return; }
    if (k === 'MediaTrackPrevious') { skip(-SKIP_BACK); e.preventDefault(); return; }

    if (state.keysOpen) {
      if (k === 'Escape' || k === 'Backspace' || k === '?' || k === 'Enter' || k === ' ') closeKeys();
      else if (ARROWS[k]) move(ARROWS[k]);
      else return;
      e.preventDefault();
      return;
    }

    // In a text box, letters type. Up/down leave the box; Esc clears it, then goes back.
    if (typing) {
      if (k === 'ArrowDown' || k === 'ArrowUp') { move(ARROWS[k]); e.preventDefault(); }
      else if (k === 'Escape' && state.view !== 'login') {
        if (e.target.value) { e.target.value = ''; runSearch(''); } else goBack();
        e.preventDefault();
      }
      return;
    }

    if (state.view === 'login' || state.view === 'loading') {
      if (ARROWS[k]) { move(ARROWS[k]); e.preventDefault(); }
      else if (k === 'Enter' || k === ' ') { activateFocused(); e.preventDefault(); }
      return;
    }

    if (k === '?') { openKeys(); e.preventDefault(); return; }
    if (k === 'p' || k === 'P') { player.toggle(); e.preventDefault(); return; }

    if (state.view === 'now') {
      switch (k) {
        case 'ArrowLeft': skip(e.shiftKey ? -SKIP_FINE : -SKIP_BACK); break;
        case 'ArrowRight': skip(e.shiftKey ? SKIP_FINE : SKIP_FWD); break;
        case 'ArrowUp': setVolume(0.1); break;
        case 'ArrowDown': setVolume(-0.1); break;
        case ' ': player.toggle(); break;
        case 'Enter': {
          const el = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-action]');
          if (el) act(el.dataset.action, el); else player.toggle();
          break;
        }
        case 'Escape': case 'Backspace': goBack(); break;
        default: return;
      }
      e.preventDefault();
      return;
    }

    switch (k) {
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': move(ARROWS[k]); break;
      case 'Enter': case ' ': activateFocused(); break;
      case 'Escape': case 'Backspace': goBack(); break;
      case 'n': case 'N': openNow(); break;
      case '1': go('latest', 'force'); break;
      case '2': go('podcasts', 'force'); break;
      case '3': go('recent', 'force'); break;
      case '4': go('search', 'force'); break;
      case '/': go('search', 'force'); focusEl($('#q'), false); break;
      default: return;
    }
    e.preventDefault();
  });

  // Stop Space/Enter from also "clicking" the focused button on key up.
  document.addEventListener('keyup', e => {
    const typing = e.target && e.target.matches && e.target.matches('input, textarea');
    if (!typing && (e.key === ' ' || e.key === 'Enter')) e.preventDefault();
  });

  document.addEventListener('click', e => {
    if (e.target === keysEl) { closeKeys(); return; }
    const el = e.target.closest('[data-action]');
    if (el) act(el.dataset.action, el);
  });

  document.addEventListener('submit', e => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.form === 'search') runSearch(form.elements.q.value);
    else if (form.dataset.form === 'login') signIn(form.elements.pw.value);
  });

  document.addEventListener('input', e => {
    if (e.target.id !== 'q') return;
    clearTimeout(searchTimer);
    const value = e.target.value;
    searchTimer = setTimeout(() => runSearch(value), 450);
  });

  // Remember where the highlight was in each view, so Back returns to the same tile.
  document.addEventListener('focusin', e => {
    const t = e.target;
    if (t.dataset && t.dataset.key && state.view !== 'now' && (main.contains(t) || mini.contains(t))) {
      state.memory[viewKey()] = t.dataset.key;
    }
  });

  // The mouse moves the same highlight as the keyboard. The pointer hides when idle.
  let cursorTimer = 0;
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    document.body.classList.remove('hide-cursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('hide-cursor'), 3000);
    const el = e.target.closest('[data-nav]');
    const active = document.activeElement;
    const typingElsewhere = active && active.matches && active.matches('input') && active !== el;
    if (el && el !== active && !typingElsewhere && !el.matches('input') && (!state.keysOpen || keysEl.contains(el))) {
      el.focus({ preventScroll: true });
    }
  });

  // Click or drag on the Now Playing bar to seek.
  main.addEventListener('pointerdown', e => {
    const bar = e.target.closest('[data-seekbar]');
    const ep = player.ep();
    if (!bar || !ep || !durOf(ep)) return;
    const seek = ev => {
      const r = bar.getBoundingClientRect();
      player.seekTo(clamp((ev.clientX - r.left) / r.width, 0, 0.999) * durOf(ep));
    };
    seek(e);
    bar.setPointerCapture(e.pointerId);
    const end = () => {
      bar.removeEventListener('pointermove', seek);
      bar.removeEventListener('pointerup', end);
      bar.removeEventListener('pointercancel', end);
    };
    bar.addEventListener('pointermove', seek);
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  });

  // ---- Library updates ----

  lib.isBusy = () => state.playing;
  lib.onChange(what => {
    if (what === 'login') { state.view = 'login'; render('force'); return; }
    reindex();
    if (state.view === 'search') { renderChrome(); renderResults(); return; }
    if (state.view === 'now' || state.view === 'login' || state.view === 'loading') { renderChrome(); updatePlayUI(); updateTimeUI(); return; }
    render();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') lib.flush();
    else if (lib.mode === 'live') { lib.maybeRefresh(); lib.sync(); }
  });
  window.addEventListener('pagehide', () => lib.flush());

  // ---- Start ----

  let started = false;
  function startApp() {
    reindex();
    if (!started) {
      started = true;
      audio = lib.mode === 'demo' ? new C.demo.FakeAudio() : new Audio();
      wireAudio();
      if (lib.mode === 'live') setInterval(() => lib.refresh(), 30 * 60000);
      setInterval(() => { if (state.view !== 'now' && state.view !== 'search') renderChrome(); }, 60000);
    }
    state.view = 'latest';
    const ep = player.ep();
    if (ep) setMediaSession(ep);
    render('force');
    if (lib.mode === 'live') lib.refresh();
  }

  (async function boot() {
    render('force');
    let result;
    try {
      result = await lib.init();
    } catch (e) {
      main.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
      return;
    }
    if (result === 'login') { state.view = 'login'; render('force'); return; }
    startApp();
  })();
})();
