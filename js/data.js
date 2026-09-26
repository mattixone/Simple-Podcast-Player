/*
 * Sample library for the prototype.
 * Everything here is made up. The real build replaces it with your subscribed feeds.
 * Release dates are relative to "now", so the Latest grid always has fresh episodes.
 */
(function () {
  'use strict';

  const DAY = 86400000;
  const now = Date.now();

  // [days ago, minutes, title]
  const SHOWS = [
    {
      id: 'signal', title: 'Signal & Noise', author: 'Priya Raman & Tom Okafor',
      blurb: 'A weekly look at the technology in your pocket and the companies behind it.',
      colors: { bg: '#12304f', fg: '#f4efe6', ac: '#ffb347' }, pattern: 'waves', face: 'sans',
      episodes: [
        [1.2, 52, 'The quiet death of the headphone jack, revisited'],
        [5.1, 47, 'Why every app wants to be a bank'],
        [8.3, 55, 'Batteries, but make them boring'],
        [12.4, 49, 'Listener mailbag: routers, backups and regret'],
        [19.2, 51, 'Open standards and who pays for them'],
        [26.2, 58, 'The year in small gadgets'],
      ],
    },
    {
      id: 'longhaul', title: 'The Long Haul', author: 'Dee Marsh',
      blurb: 'Stories from the people who spend their lives on the road.',
      colors: { bg: '#7a2e1f', fg: '#f7e3c4', ac: '#e9a23b' }, pattern: 'road', face: 'serif',
      episodes: [
        [0.4, 71, 'Twelve hours on the Nullarbor'],
        [7.5, 64, "What dispatchers know that drivers don't"],
        [13.5, 69, 'Night markets and truck stop coffee'],
        [21.5, 66, 'The last manual gearbox'],
      ],
    },
    {
      id: 'nightshift', title: 'Night Shift Radio', author: 'Callum Reyes',
      blurb: 'Late-night calls from listeners with one strange story to tell.',
      colors: { bg: '#141032', fg: '#f1e9ff', ac: '#e84a8a' }, pattern: 'moon', face: 'sans',
      episodes: [
        [0.9, 38, "Caller 4: the lighthouse keeper's daughter"],
        [3.9, 41, "The bus that didn't stop"],
        [6.9, 36, 'A wrong number that lasted a decade'],
        [10.9, 44, 'Snowed in at the observatory'],
        [17.9, 40, 'The locksmith who never locked his door'],
      ],
    },
    {
      id: 'deepfield', title: 'Deep Field', author: 'Dr. Ana Ferreira',
      blurb: 'Astronomy news, explained slowly.',
      colors: { bg: '#05070f', fg: '#e6f1ff', ac: '#8fc7ff' }, pattern: 'stars', face: 'sans',
      episodes: [
        [2.3, 33, 'What the new telescope saw this month'],
        [9.3, 29, "A star that shouldn't exist"],
        [16.3, 31, 'How to weigh a galaxy'],
      ],
    },
    {
      id: 'kitchen', title: 'Kitchen Table Economics', author: 'Sam & Jo Whitfield',
      blurb: 'Money questions from everyday life, answered in under half an hour.',
      colors: { bg: '#f0e3c2', fg: '#1f3d28', ac: '#c8553d' }, pattern: 'checker', face: 'serif',
      episodes: [
        [1.8, 27, 'Why is butter so expensive?'],
        [4.8, 25, 'Rent, explained with a pizza'],
        [8.8, 30, 'The hidden cost of free shipping'],
        [11.8, 26, 'Do loyalty cards actually save you money?'],
        [22.8, 28, 'Inflation from the checkout line'],
      ],
    },
    {
      id: 'loworbit', title: 'Low Orbit', author: 'Mika Lindqvist',
      blurb: 'The business and engineering of getting things into space.',
      colors: { bg: '#d94f2b', fg: '#fff4e8', ac: '#1c1c1c' }, pattern: 'rings', face: 'sans',
      episodes: [
        [6.2, 62, 'Reusable rockets, ten years on'],
        [20.2, 58, 'Who cleans up space junk?'],
      ],
    },
    {
      id: 'tapehiss', title: 'Tape Hiss', author: 'Rosa Delgado',
      blurb: 'Music history told through the machines that played it.',
      colors: { bg: '#262626', fg: '#f5f0e1', ac: '#f5c518' }, pattern: 'cassette', face: 'sans',
      episodes: [
        [2.9, 45, 'The mixtape as a love letter'],
        [9.9, 48, 'How the Walkman changed walking'],
        [23.9, 43, 'Pirate radio on the North Sea'],
      ],
    },
    {
      id: 'smallhours', title: 'Small Hours', author: 'Elliot Park',
      blurb: 'Calm, curious history for the end of the day.',
      colors: { bg: '#3e5641', fg: '#efe8d2', ac: '#c9d6a3' }, pattern: 'dots', face: 'serif',
      episodes: [
        [0.2, 24, 'The history of the lighthouse lens'],
        [3.2, 22, 'A slow walk through an old library'],
        [7.2, 26, 'The canals of Birmingham'],
        [10.2, 23, 'How salt built cities'],
        [13.2, 25, 'Clockmakers of the Jura'],
      ],
    },
  ];

  // ---- Placeholder artwork, drawn once on a canvas ----------------------

  function rng(seed) {
    let a = 0;
    for (const ch of seed) a = (a * 31 + ch.charCodeAt(0)) | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Each pattern fills roughly the top 60% of the square; the title sits below.
  const PATTERNS = {
    waves(g, S, c) {
      g.strokeStyle = c.ac;
      g.lineWidth = S * 0.014;
      for (let i = 0; i < 9; i++) {
        g.globalAlpha = 1 - i * 0.08;
        g.beginPath();
        const y0 = S * (0.1 + i * 0.058);
        for (let x = 0; x <= S; x += 4) {
          const y = y0 + Math.sin((x / S) * Math.PI * (3 + i * 0.35) + i) * S * 0.028 * (1 + i * 0.15);
          if (x) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
    },
    road(g, S, c) {
      g.fillStyle = c.ac;
      g.beginPath();
      g.moveTo(S * 0.47, S * 0.1);
      g.lineTo(S * 0.53, S * 0.1);
      g.lineTo(S * 0.98, S * 0.6);
      g.lineTo(S * 0.02, S * 0.6);
      g.closePath();
      g.fill();
      g.fillStyle = c.fg;
      for (let i = 0; i < 6; i++) {
        const t = i / 6;
        const y = S * (0.12 + t * t * 0.46);
        const w = S * (0.006 + t * 0.022);
        const h = S * (0.012 + t * 0.05);
        g.fillRect(S / 2 - w / 2, y, w, h);
      }
    },
    moon(g, S, c, r) {
      g.fillStyle = c.fg;
      for (let i = 0; i < 70; i++) {
        g.globalAlpha = 0.25 + r() * 0.75;
        const d = S * (0.004 + r() * 0.006);
        g.fillRect(r() * S, r() * S * 0.6, d, d);
      }
      g.globalAlpha = 1;
      g.fillStyle = c.ac;
      g.beginPath();
      g.arc(S * 0.64, S * 0.3, S * 0.18, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = c.bg;
      g.beginPath();
      g.arc(S * 0.71, S * 0.25, S * 0.16, 0, Math.PI * 2);
      g.fill();
    },
    stars(g, S, c, r) {
      const grad = g.createRadialGradient(S * 0.5, S * 0.3, 0, S * 0.5, S * 0.3, S * 0.4);
      grad.addColorStop(0, c.ac);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, S, S * 0.65);
      g.fillStyle = c.fg;
      for (let i = 0; i < 220; i++) {
        g.globalAlpha = 0.2 + r() * 0.8;
        const d = S * (0.002 + r() * r() * 0.01);
        g.fillRect(r() * S, r() * S * 0.62, d, d);
      }
      g.globalAlpha = 1;
      g.strokeStyle = c.fg;
      g.lineWidth = S * 0.006;
      g.beginPath();
      g.ellipse(S * 0.5, S * 0.3, S * 0.32, S * 0.08, -0.35, 0, Math.PI * 2);
      g.stroke();
    },
    checker(g, S, c) {
      const n = 8, w = S / n;
      g.fillStyle = c.ac;
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < n; x++) if ((x + y) % 2) g.fillRect(x * w, y * w, w, w);
      }
    },
    rings(g, S, c) {
      g.strokeStyle = c.ac;
      g.lineWidth = S * 0.012;
      for (let i = 1; i <= 7; i++) {
        g.beginPath();
        g.arc(S * 0.5, S * 0.3, S * 0.035 * i + S * 0.03, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = c.fg;
      g.beginPath();
      g.arc(S * 0.5 + S * 0.24, S * 0.3 - S * 0.12, S * 0.03, 0, Math.PI * 2);
      g.fill();
    },
    cassette(g, S, c) {
      g.strokeStyle = c.ac;
      g.lineWidth = S * 0.018;
      g.beginPath();
      g.roundRect(S * 0.12, S * 0.1, S * 0.76, S * 0.46, S * 0.03);
      g.stroke();
      g.strokeRect(S * 0.24, S * 0.2, S * 0.52, S * 0.18);
      for (const x of [0.36, 0.64]) {
        g.beginPath();
        g.arc(S * x, S * 0.29, S * 0.055, 0, Math.PI * 2);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(S * 0.3, S * 0.56);
      g.lineTo(S * 0.34, S * 0.47);
      g.lineTo(S * 0.66, S * 0.47);
      g.lineTo(S * 0.7, S * 0.56);
      g.stroke();
    },
    dots(g, S, c) {
      g.fillStyle = c.ac;
      const cols = 14, step = S / cols;
      for (let y = 0; y < 9; y++) {
        for (let x = 0; x < cols; x++) {
          const t = (x / cols + (8 - y) / 9) / 2;
          g.beginPath();
          g.arc(x * step + step / 2, y * step + step / 2, step * 0.45 * t, 0, Math.PI * 2);
          g.fill();
        }
      }
    },
  };

  function wrap(g, text, max) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (g.measureText(test).width > max && line) { lines.push(line); line = w; } else line = test;
    }
    lines.push(line);
    return lines;
  }

  function makeArt(show, S = 480) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const c = show.colors;
    g.fillStyle = c.bg;
    g.fillRect(0, 0, S, S);
    PATTERNS[show.pattern](g, S, c, rng(show.id));

    const text = show.face === 'serif' ? show.title : show.title.toUpperCase();
    let size = S * (show.face === 'serif' ? 0.13 : 0.105);
    let lines;
    do {
      g.font = show.face === 'serif'
        ? `italic bold ${size}px Georgia, "Times New Roman", serif`
        : `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
      lines = wrap(g, text, S * 0.84);
      size *= 0.92;
    } while (lines.length > 3);

    g.fillStyle = c.fg;
    g.textBaseline = 'alphabetic';
    const lh = size * 1.12;
    let y = S * 0.93 - (lines.length - 1) * lh;
    for (const l of lines) { g.fillText(l, S * 0.08, y); y += lh; }
    return cv.toDataURL('image/jpeg', 0.86);
  }

  // ---- Build the library ------------------------------------------------

  const shows = SHOWS.map(s => ({ ...s, art: makeArt(s) }));
  const episodes = [];
  for (const s of shows) {
    s.episodes.forEach(([days, mins, title], i) => {
      episodes.push({
        id: `${s.id}-${i}`,
        showId: s.id,
        title,
        date: now - days * DAY,
        duration: mins * 60 + ((i * 37 + s.id.length * 11) % 60),
      });
    });
    delete s.episodes;
  }
  episodes.sort((a, b) => b.date - a.date);

  // A little listening history so Recent and the progress bars have something to show.
  function sampleProgress() {
    const H = 3600000;
    const byId = id => episodes.find(e => e.id === id);
    const at = (id, frac, hoursAgo, done) => [id, {
      pos: done ? byId(id).duration : Math.round(byId(id).duration * frac),
      done: !!done,
      last: now - hoursAgo * H,
    }];
    return Object.fromEntries([
      at('kitchen-0', 0.58, 1),
      at('signal-0', 0.22, 26),
      at('nightshift-1', 1, 30, true),
      at('smallhours-1', 1, 50, true),
      at('deepfield-0', 0.1, 76),
    ]);
  }

  window.PODCAST_DATA = { shows, episodes, sampleProgress };
})();
