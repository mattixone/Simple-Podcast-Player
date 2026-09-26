/*
 * Couchcast prototype.
 * Playback is simulated with a clock so the controls can be tried without real audio.
 * The real build swaps `player` for an <audio> element; everything else stays.
 */
(function () {
  'use strict';

  const { shows, episodes, sampleProgress } = window.PODCAST_DATA;
  const showById = new Map(shows.map(s => [s.id, s]));
  const epById = new Map(episodes.map(e => [e.id, e]));

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

  // ---- Storage (per browser for now; cross-device sync comes with the backend) ----

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('couchcast:' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('couchcast:' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
  };

  const savedProgress = store.get('progress', null);
  const progress = savedProgress || sampleProgress();

  const state = {
    view: 'latest',
    showId: null,
    back: null,
    current: store.get('current', savedProgress ? null : 'kitchen-0'),
    playing: false,
    volume: store.get('volume', 0.7),
    art: store.get('art', 'colour'),
    memory: {},
    keysOpen: false,
    keysReturn: null,
  };
  if (state.current && !epById.has(state.current)) state.current = null;

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const main = $('#main');
  const mini = $('#mini');
  const statusEl = $('#status');
  const osdEl = $('#osd');
  const keysEl = $('#keys');

  // ---- Formatting ----

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function fmtClock(t) {
    t = Math.max(0, Math.floor(t));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }
  function fmtDur(sec) {
    const m = Math.round(sec / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60} min`;
  }
  function fmtAgo(ts) {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    if (ts >= midnight) return 'Today';
    const d = Math.ceil((midnight - ts) / DAY);
    return d <= 1 ? 'Yesterday' : `${d} days ago`;
  }
  function fmtPlayed(ts) {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 60) return `Played ${Math.max(1, mins)} min ago`;
    if (mins < 24 * 60) return `Played ${Math.round(mins / 60)} hr ago`;
    return `Played ${fmtAgo(ts).toLowerCase()}`;
  }
  const fmtDay = ts => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  // ---- Episode status ----

  const isRecent = ep => Date.now() - ep.date <= LATEST_DAYS * DAY;
  function status(ep) {
    const p = progress[ep.id];
    if (p && p.done) return 'done';
    if (p && p.pos >= 1) return 'started';
    return isRecent(ep) ? 'new' : 'unplayed';
  }
  const pct = ep => (progress[ep.id] ? clamp(progress[ep.id].pos / ep.duration, 0, 1) * 100 : 0);
  const minsLeft = ep => Math.max(1, Math.ceil((ep.duration - (progress[ep.id]?.pos || 0)) / 60));

  const latestEpisodes = () => episodes.filter(isRecent);
  const recentEpisodes = () => Object.entries(progress)
    .filter(([id, p]) => epById.has(id) && p.last && (p.done || p.pos >= 1 || id === state.current))
    .sort((a, b) => b[1].last - a[1].last)
    .map(([id]) => epById.get(id));
  const upNext = () => latestEpisodes().find(e => e.id !== state.current && status(e) !== 'done');

  // ---- Player (simulated clock) ----

  let lastSave = 0;
  function save(force) {
    const t = Date.now();
    if (!force && t - lastSave < 4000) return;
    lastSave = t;
    store.set('progress', progress);
    store.set('current', state.current);
  }

  const player = {
    timer: 0,
    last: 0,
    ep() { return state.current ? epById.get(state.current) : null; },
    pos() { return progress[state.current]?.pos || 0; },
    load(id) {
      const ep = epById.get(id);
      if (!ep) return;
      state.current = id;
      let p = progress[id];
      if (!p || p.done) p = progress[id] = { pos: 0, done: false, last: Date.now() };
      p.last = Date.now();
      save(true);
      setMediaSession(ep);
      this.play();
    },
    play() {
      if (!this.ep()) return;
      state.playing = true;
      this.last = performance.now();
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), 250);
      if (hasMediaSession) navigator.mediaSession.playbackState = 'playing';
      updatePlayUI();
    },
    pause() {
      state.playing = false;
      clearInterval(this.timer);
      save(true);
      if (hasMediaSession) navigator.mediaSession.playbackState = 'paused';
      updatePlayUI();
    },
    toggle() {
      if (!this.ep()) { osd('Nothing playing'); return; }
      if (state.playing) this.pause(); else this.play();
    },
    tick() {
      const t = performance.now();
      const dt = (t - this.last) / 1000;
      this.last = t;
      this.seekTo(this.pos() + dt, true);
    },
    seekTo(t, ticking) {
      const ep = this.ep();
      if (!ep) return;
      const p = progress[ep.id] || (progress[ep.id] = { pos: 0, done: false, last: Date.now() });
      p.pos = clamp(t, 0, ep.duration);
      p.last = Date.now();
      if (p.pos >= ep.duration) { this.finish(); return; }
      save(!ticking);
      updateTimeUI();
    },
    finish() {
      const p = progress[state.current];
      p.done = true;
      p.pos = this.ep().duration;
      save(true);
      const next = upNext();
      if (next) {
        this.load(next.id);
        osd(`Up next`);
      } else {
        this.pause();
        osd('All caught up');
      }
      render();
    },
  };

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
    store.set('volume', state.volume);
    updateVolUI();
    osd(`<span class="osd-label">Vol</span>${volBlocks()}<span>${Math.round(state.volume * 100)}%</span>`);
  }
  const volBlocks = () => {
    const n = Math.round(state.volume * 10);
    return `<span class="vol-blocks" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
  };

  // ---- Media keys / lock screen ----

  const hasMediaSession = 'mediaSession' in navigator;
  if (hasMediaSession) {
    const handle = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported */ } };
    handle('play', () => player.play());
    handle('pause', () => player.pause());
    handle('seekbackward', () => skip(-SKIP_BACK));
    handle('seekforward', () => skip(SKIP_FWD));
    handle('previoustrack', () => skip(-SKIP_BACK));
    handle('nexttrack', () => skip(SKIP_FWD));
  }
  function setMediaSession(ep) {
    if (!hasMediaSession) return;
    const s = showById.get(ep.showId);
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: ep.title, artist: s.title, album: 'Couchcast',
        artwork: [{ src: s.art, sizes: '480x480', type: 'image/jpeg' }],
      });
    } catch { /* unsupported */ }
  }

  // ---- On-screen display ----

  let osdTimer = 0;
  function osd(html) {
    osdEl.innerHTML = html;
    osdEl.classList.add('show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => osdEl.classList.remove('show'), 900);
  }

  // ---- Templates ----

  function badgeFor(ep) {
    if (ep.id === state.current) return `<span class="badge" data-playstate></span>`;
    const st = status(ep);
    if (st === 'new') return '<span class="badge">New</span>';
    if (st === 'done') return '<span class="badge badge-dim">✓ Played</span>';
    return '';
  }

  function tile(ep, metaOverride) {
    const s = showById.get(ep.showId);
    const st = status(ep);
    const cur = ep.id === state.current;
    const bar = st === 'started' || cur
      ? `<span class="bar"><i ${cur ? 'data-bar' : ''} style="width:${pct(ep)}%"></i></span>`
      : '<span class="bar bar-empty"></span>';
    const meta = metaOverride || (st === 'started'
      ? `${fmtAgo(ep.date)} · ${minsLeft(ep)} min left`
      : `${fmtAgo(ep.date)} · ${fmtDur(ep.duration)}`);
    const hint = cur ? 'Open player' : st === 'started' ? 'Resume' : st === 'done' ? 'Play again' : 'Play';
    const label = [ep.title, s.title, meta, cur ? 'now playing' : st === 'new' ? 'new' : st === 'done' ? 'played' : ''].filter(Boolean).join(', ');
    return `<button class="tile${st === 'done' && !cur ? ' is-done' : ''}" data-nav data-key="ep:${ep.id}" data-action="play" data-id="${ep.id}" aria-label="${esc(label)}">
      <span class="art-wrap">
        <img class="art" src="${s.art}" alt="">
        ${badgeFor(ep)}
        <span class="t-hint">${hint}</span>
      </span>
      ${bar}
      <span class="t-title">${esc(ep.title)}</span>
      <span class="t-show">${esc(s.title)}</span>
      <span class="t-meta">${meta}</span>
    </button>`;
  }

  function showTile(s) {
    const eps = episodes.filter(e => e.showId === s.id);
    const fresh = eps.filter(e => status(e) === 'new').length;
    return `<button class="tile" data-nav data-key="show:${s.id}" data-action="show" data-id="${s.id}" aria-label="${esc(s.title)}, ${fresh} new">
      <span class="art-wrap">
        <img class="art" src="${s.art}" alt="">
        ${fresh ? `<span class="badge">${fresh} New</span>` : ''}
        <span class="t-hint">Episodes</span>
      </span>
      <span class="t-title">${esc(s.title)}</span>
      <span class="t-show">${esc(s.author)}</span>
      <span class="t-meta">${eps.length} episodes · latest ${fmtAgo(eps[0].date).toLowerCase()}</span>
    </button>`;
  }

  function row(ep) {
    const st = status(ep);
    const cur = ep.id === state.current;
    const bar = st === 'started' || cur
      ? `<span class="bar"><i ${cur ? 'data-bar' : ''} style="width:${pct(ep)}%"></i></span>` : '';
    const length = st === 'started' ? `${minsLeft(ep)} min left` : fmtDur(ep.duration);
    return `<li><button class="row${st === 'done' && !cur ? ' is-done' : ''}" data-nav data-key="ep:${ep.id}" data-action="play" data-id="${ep.id}" aria-label="${esc(`${ep.title}, ${fmtDay(ep.date)}, ${length}`)}">
      <span class="row-flag">${badgeFor(ep).replace('class="badge', 'class="flag')}</span>
      <span class="row-main"><span class="row-title">${esc(ep.title)}</span>${bar}</span>
      <span class="row-meta"><span>${fmtDay(ep.date)}</span><span>${length}</span></span>
    </button></li>`;
  }

  const VIEWS = {
    latest() {
      const eps = latestEpisodes();
      return `<section aria-labelledby="h-view">
        <h2 class="eyebrow" id="h-view">Latest <span>· last ${LATEST_DAYS} days · ${eps.length} episodes</span></h2>
        <div class="grid">${eps.map(e => tile(e)).join('')}</div>
      </section>`;
    },
    podcasts() {
      return `<section aria-labelledby="h-view">
        <h2 class="eyebrow" id="h-view">Podcasts <span>· ${shows.length} subscriptions</span></h2>
        <div class="grid">${shows.map(showTile).join('')}</div>
      </section>`;
    },
    show() {
      const s = showById.get(state.showId);
      const eps = episodes.filter(e => e.showId === s.id);
      return `<div class="show">
        <aside class="show-side">
          <img class="art show-art" src="${s.art}" alt="${esc(s.title)} artwork">
          <div class="show-head">
            <h2 class="show-title">${esc(s.title)}</h2>
            <p class="show-author">${esc(s.author)}</p>
            <p class="show-blurb">${esc(s.blurb)}</p>
            <button class="btn btn-sm" data-nav data-key="back" data-action="back"><kbd>Esc</kbd> All podcasts</button>
          </div>
        </aside>
        <section aria-labelledby="h-view">
          <h2 class="eyebrow" id="h-view">Episodes <span>· ${eps.length}</span></h2>
          <ol class="rows">${eps.map(row).join('')}</ol>
        </section>
      </div>`;
    },
    recent() {
      const eps = recentEpisodes();
      const body = eps.length
        ? `<div class="grid">${eps.map(e => tile(e, fmtPlayed(progress[e.id].last))).join('')}</div>`
        : `<p class="empty">Nothing played yet. Episodes you start will show up here.</p>`;
      return `<section aria-labelledby="h-view">
        <h2 class="eyebrow" id="h-view">Recently played <span>· ${eps.length}</span></h2>
        ${body}
      </section>`;
    },
    now() {
      const ep = player.ep();
      const s = showById.get(ep.showId);
      const next = upNext();
      return `<div class="np">
        <div class="np-art"><img class="art" src="${s.art}" alt="${esc(s.title)} artwork"></div>
        <div class="np-info">
          <button class="btn btn-sm np-back" data-nav data-key="np-back" data-action="back"><kbd>Esc</kbd> Library</button>
          <div class="np-head">
            <p class="np-show">${esc(s.title)}</p>
            <h1 class="np-title">${esc(ep.title)}</h1>
            <p class="np-meta">${fmtAgo(ep.date)} · ${fmtDur(ep.duration)}</p>
          </div>
          <div class="np-seek">
            <div class="np-bar" data-seekbar role="slider" aria-label="Position" aria-valuemin="0" aria-valuemax="${ep.duration}"><i data-bar></i><b data-knob></b></div>
            <div class="np-times"><span data-time></span><span data-remain></span></div>
          </div>
          <div class="np-controls">
            <button class="btn big" data-nav data-key="np-b" data-action="back15" aria-label="Back ${SKIP_BACK} seconds"><span aria-hidden="true">${REWIND}</span> ${SKIP_BACK}</button>
            <button class="btn big np-play" data-nav data-key="np-pp" data-action="toggle" data-playbtn></button>
            <button class="btn big" data-nav data-key="np-f" data-action="fwd30" aria-label="Forward ${SKIP_FWD} seconds">${SKIP_FWD} <span aria-hidden="true">${FFWD}</span></button>
          </div>
          <div class="np-vol"><span class="np-label">Vol</span><span data-vol></span><span data-volpct></span></div>
          <p class="np-next"><span class="np-label">Up next</span> ${next ? `${esc(next.title)} <span class="dim">· ${esc(showById.get(next.showId).title)}</span>` : '<span class="dim">Nothing. You are all caught up.</span>'}</p>
          <p class="np-keys"><kbd>←</kbd> ${SKIP_BACK}s &nbsp;<kbd>Shift</kbd>+<kbd>←</kbd> ${SKIP_FINE}s &nbsp;<kbd>→</kbd> ${SKIP_FWD}s &nbsp;<kbd>Shift</kbd>+<kbd>→</kbd> ${SKIP_FINE}s &nbsp;<kbd>↑</kbd><kbd>↓</kbd> volume</p>
        </div>
      </div>`;
    },
  };

  // ---- Rendering ----

  const viewKey = () => (state.view === 'show' ? 'show:' + state.showId : state.view);
  const isVisible = el => el.getClientRects().length > 0;

  function render(mode = 'auto') {
    const active = document.activeElement;
    const focusWasInContent = !active || active === document.body || main.contains(active) || mini.contains(active);
    const key = viewKey();
    const sameView = main.dataset.view === key;
    const top = main.scrollTop;

    document.body.dataset.view = state.view;
    document.body.classList.toggle('art-phosphor', state.art === 'phosphor');
    main.innerHTML = VIEWS[state.view]();
    main.dataset.view = key;
    main.scrollTop = sameView ? top : 0;

    renderChrome();
    updatePlayUI();
    updateTimeUI();
    updateVolUI();

    if (mode === 'force' || focusWasInContent) focusEl(defaultFocus(), false);
  }

  function renderChrome() {
    const tabView = state.view === 'show' ? 'podcasts' : state.view;
    $$('.tab').forEach(t => t.setAttribute('aria-current', t.dataset.tab === tabView ? 'page' : 'false'));
    $('#art-btn').textContent = `Art: ${state.art === 'phosphor' ? 'Phosphor' : 'Colour'}`;
    statusEl.innerHTML = `<span><span class="led" aria-hidden="true"></span> ${shows.length} subscriptions</span>
      <span>${latestEpisodes().filter(e => status(e) === 'new').length} new this fortnight</span>
      <span class="dim">Sample data</span>`;

    const ep = player.ep();
    mini.hidden = !ep || state.view === 'now';
    if (!ep) { mini.innerHTML = ''; return; }
    const s = showById.get(ep.showId);
    mini.innerHTML = `<button class="mini" data-nav data-key="mini" data-action="open-now" aria-label="Open Now Playing: ${esc(ep.title)}">
      <span class="bar mini-bar"><i data-bar></i></span>
      <img class="art mini-art" src="${s.art}" alt="">
      <span class="mini-state" data-playstate></span>
      <span class="mini-text"><span class="mini-title">${esc(ep.title)}</span><span class="mini-show">${esc(s.title)}</span></span>
      <span class="mini-time"><span data-time></span> / ${fmtClock(ep.duration)}</span>
      <span class="mini-key"><kbd>N</kbd> Open</span>
    </button>`;
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
    const f = clamp(pos / ep.duration, 0, 1) * 100 + '%';
    $$('[data-time]').forEach(el => { el.textContent = fmtClock(pos); });
    $$('[data-remain]').forEach(el => { el.textContent = '−' + fmtClock(ep.duration - pos); });
    $$('[data-bar]').forEach(el => { el.style.width = f; });
    $$('[data-knob]').forEach(el => { el.style.left = f; });
    const bar = $('[data-seekbar]');
    if (bar) {
      bar.setAttribute('aria-valuenow', Math.floor(pos));
      bar.setAttribute('aria-valuetext', `${fmtClock(pos)} of ${fmtClock(ep.duration)}`);
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
    } else if (state.view !== 'latest') {
      go('latest', 'force');
    }
  }

  function defaultFocus() {
    if (state.view === 'now') return $('[data-key="np-pp"]');
    const key = state.memory[viewKey()];
    if (key) {
      const el = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (el && isVisible(el)) return el;
    }
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
    const eps = 2;
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
      if (primary < -eps) continue;
      const score = Math.max(0, primary) + cross * 2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) focusEl(best);
  }

  // ---- Actions ----

  function act(action, el) {
    switch (action) {
      case 'tab': go(el.dataset.tab); break;
      case 'show': openShow(el.dataset.id); break;
      case 'play': {
        const id = el.dataset.id;
        if (id !== state.current || progress[id]?.done) player.load(id);
        else if (!state.playing) player.play();
        openNow();
        break;
      }
      case 'open-now': openNow(); break;
      case 'back': goBack(); break;
      case 'toggle': player.toggle(); break;
      case 'back15': skip(-SKIP_BACK); break;
      case 'fwd30': skip(SKIP_FWD); break;
      case 'art': toggleArt(); break;
      case 'keys': openKeys(); break;
      case 'keys-close': closeKeys(); break;
    }
  }

  function toggleArt() {
    state.art = state.art === 'phosphor' ? 'colour' : 'phosphor';
    store.set('art', state.art);
    document.body.classList.toggle('art-phosphor', state.art === 'phosphor');
    $('#art-btn').textContent = `Art: ${state.art === 'phosphor' ? 'Phosphor' : 'Colour'}`;
    osd(`Art · ${state.art === 'phosphor' ? 'Phosphor' : 'Colour'}`);
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

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    document.body.classList.add('hide-cursor');
    const k = e.key;

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

    if (k === '?') { openKeys(); e.preventDefault(); return; }
    if (k === 'a' || k === 'A') { toggleArt(); e.preventDefault(); return; }
    if (k === 'p' || k === 'P') { player.toggle(); e.preventDefault(); return; }

    if (state.view === 'now') {
      switch (k) {
        case 'ArrowLeft': skip(e.shiftKey ? -SKIP_FINE : -SKIP_BACK); break;
        case 'ArrowRight': skip(e.shiftKey ? SKIP_FINE : SKIP_FWD); break;
        case 'ArrowUp': setVolume(0.1); break;
        case 'ArrowDown': setVolume(-0.1); break;
        case ' ': player.toggle(); break;
        case 'Enter': {
          const el = document.activeElement?.closest?.('[data-action]');
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
      case 'Enter': case ' ': {
        const el = document.activeElement?.closest?.('[data-action]');
        if (el) act(el.dataset.action, el); else focusEl(defaultFocus());
        break;
      }
      case 'Escape': case 'Backspace': goBack(); break;
      case 'n': case 'N': openNow(); break;
      case '1': go('latest', 'force'); break;
      case '2': go('podcasts', 'force'); break;
      case '3': go('recent', 'force'); break;
      default: return;
    }
    e.preventDefault();
  });

  // Stop Space/Enter from also "clicking" the focused button on key up.
  document.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') e.preventDefault(); });

  document.addEventListener('click', e => {
    if (e.target === keysEl) { closeKeys(); return; }
    const el = e.target.closest('[data-action]');
    if (el) act(el.dataset.action, el);
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
    if (el && el !== document.activeElement && (!state.keysOpen || keysEl.contains(el))) el.focus({ preventScroll: true });
  });

  // Click or drag on the Now Playing bar to seek.
  main.addEventListener('pointerdown', e => {
    const bar = e.target.closest('[data-seekbar]');
    const ep = player.ep();
    if (!bar || !ep) return;
    const seek = ev => {
      const r = bar.getBoundingClientRect();
      player.seekTo(clamp((ev.clientX - r.left) / r.width, 0, 0.999) * ep.duration);
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

  window.addEventListener('pagehide', () => save(true));

  // ---- Start ----

  if (player.ep()) setMediaSession(player.ep());
  render('force');
})();
