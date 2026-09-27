// Small 2D helpers. Points are {x, y}; polygons are arrays of points.
export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function rotate(x, y, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
}

// Wrap an angle difference into [-π, π].
export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

export function polygonCentroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-9) return { x: poly[0].x, y: poly[0].y };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// Sutherland–Hodgman against one half-plane: keeps points where nx*x + ny*y <= c.
export function clipHalfPlane(poly, nx, ny, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = nx * a.x + ny * a.y - c;
    const db = nx * b.x + ny * b.y - c;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

// Voronoi cells of `seeds`, each clipped to the convex polygon `poly`.
// A seed's cell is the polygon cut by the perpendicular bisector with every other seed.
export function voronoiCells(poly, seeds) {
  const cells = [];
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    let cell = poly;
    for (let j = 0; j < seeds.length && cell.length >= 3; j++) {
      if (i === j) continue;
      const o = seeds[j];
      const nx = o.x - s.x, ny = o.y - s.y;
      if (nx === 0 && ny === 0) continue;
      const c = (nx * (s.x + o.x) + ny * (s.y + o.y)) / 2;
      cell = clipHalfPlane(cell, nx, ny, c);
    }
    if (cell.length >= 3) cells.push(cell);
  }
  return cells;
}

// A random convex blob: points on an ellipse, in order, centred on its centroid.
export function makeBlob(size) {
  const n = 6 + Math.floor(Math.random() * 4);
  const aspect = 0.7 + Math.random() * 0.3;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + (Math.random() - 0.5) * 0.6) / n) * TAU;
    pts.push({ x: Math.cos(a) * size, y: Math.sin(a) * size * aspect });
  }
  const c = polygonCentroid(pts);
  return pts.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
}
