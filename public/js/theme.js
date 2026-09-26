/*
 * Now Playing colour: find the main colour of a piece of artwork and turn it into a
 * full set of CRT screen colours. Kept free of newer CSS/JS features so it behaves
 * the same on an iPhone as on the couch PC.
 */
(function () {
  'use strict';

  const C = (window.Couchcast = window.Couchcast || {});

  const KEYS = ['--ph', '--ph-rgb', '--ph-2', '--dim', '--faint', '--bg', '--bg-lift', '--panel', '--ink'];
  const SAMPLE = 40;

  function hslToRgb(h, s, l) {
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)];
  }
  const luminance = rgb => rgb
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const to255 = rgb => rgb.map(c => Math.round(c * 255));
  const toHex = rgb => '#' + to255(rgb).map(c => c.toString(16).padStart(2, '0')).join('');

  // The colour of hue h and saturation s that is just bright enough to reach the target luminance.
  // Setting brightness by luminance keeps text readable whatever the hue (blue needs a paler tint than green).
  function shadeRgb(h, s, target) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (luminance(hslToRgb(h, s, mid)) < target) lo = mid; else hi = mid;
    }
    return hslToRgb(h, s, hi);
  }
  const shade = (h, s, target) => toHex(shadeRgb(h, s, target));

  function paletteFor(h) {
    const ph = shadeRgb(h, 1, 0.45); // about 9:1 on the background
    return {
      '--ph': toHex(ph),
      '--ph-rgb': to255(ph).join(', '),
      '--ph-2': shade(h, 0.85, 0.28),
      '--dim': shade(h, 0.7, 0.2), // stays above 4.5:1
      '--faint': shade(h, 0.6, 0.022),
      '--bg': shade(h, 0.5, 0.0025),
      '--bg-lift': shade(h, 0.55, 0.007),
      '--panel': shade(h, 0.55, 0.005),
      '--ink': shade(h, 0.5, 0.001),
    };
  }

  // The most common clearly coloured hue in RGBA pixel data. Near-black, near-white and
  // grey pixels are ignored, so a mostly black cover still picks up its accent colour.
  function hueFromPixels(data) {
    const bins = new Array(36).fill(0), xs = new Array(36).fill(0), ys = new Array(36).fill(0);
    let counted = 0;
    for (let i = 0; i < data.length; i += 4) {
      counted++;
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      const l = (max + min) / 2;
      if (d < 0.08 || l < 0.15 || l > 0.94) continue;
      const sat = d / (1 - Math.abs(2 * l - 1));
      if (sat < 0.25) continue;
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      const bin = Math.floor(h / 10) % 36, w = 0.5 + sat;
      bins[bin] += w;
      xs[bin] += Math.cos((h * Math.PI) / 180) * w;
      ys[bin] += Math.sin((h * Math.PI) / 180) * w;
    }
    let best = 0;
    for (let i = 1; i < 36; i++) if (bins[i] > bins[best]) best = i;
    if (bins[best] < counted * 0.02) return null; // no real colour: keep the green
    return ((Math.atan2(ys[best], xs[best]) * 180) / Math.PI + 360) % 360;
  }

  function hueFromSource(source) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = SAMPLE;
    const g = cv.getContext('2d');
    g.drawImage(source, 0, 0, SAMPLE, SAMPLE);
    return hueFromPixels(g.getImageData(0, 0, SAMPLE, SAMPLE).data);
  }

  // Remembered hues, keyed by artwork address. Web addresses are also kept between visits.
  const hues = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem('couchcast:hues') || '{}');
    for (const k in saved) hues.set(k, saved[k]);
  } catch { /* storage unavailable */ }

  function remember(url, hue) {
    hues.set(url, hue);
    if (url.startsWith('data:')) return;
    try {
      const keep = [...hues].filter(([k]) => !k.startsWith('data:')).slice(-300);
      localStorage.setItem('couchcast:hues', JSON.stringify(Object.fromEntries(keep)));
    } catch { /* storage unavailable */ }
  }

  // Artwork must be same-origin (the server passes it through), or the browser refuses to let us read it.
  function hueForImage(url) {
    if (hues.has(url)) return Promise.resolve(hues.get(url));
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        let hue = null;
        try { hue = hueFromSource(img); } catch { hue = null; }
        remember(url, hue);
        resolve(hue);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  C.theme = { KEYS, paletteFor, hueFromSource, hueForImage, remember };
})();
