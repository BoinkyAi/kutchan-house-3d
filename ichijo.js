/* Ichijo Komuten (一条工務店) rules + catalogue fittings for "Plan B — Ichijo"
   (index.html?house=7, edit.html?plan=e) and its variants "compact" (house 8, plan f,
   ref-model-f.json) and "3 up, 1 down" (house 9, plan g, ref-model-g.json): everything
   here works from the model it is given. Shared by app.js and edit.js.

   The model (ref-model-e.json, refplan.js format) keeps Plan B as drawn by Toby;
   model.ichijo holds the builder's rules and room.fit the per-room catalogue
   choices (catalog.json ids). derive() turns that into the model the 3D builds:
     heights  1F clear h1 (2.6), the gym floor -gymDrop when gymSunken (2.8 clear),
              2F floor h1 + buildUp (3.05), 2F flat ceiling h2 (2.4)
     roof     ONE mono-pitch plane over the whole 2F at `pitch` sun (寸/10; default 3.5 =
              Ichijo standard: its sheet has 3.5寸 roof materials only), high on side
              ichijo.view ('e' = the living wing's end, sloping down to the kitchen;
              'n' = the carport side; 's' = the big-glass side): the lowest such plane
              that clears every flat 2F ceiling by roofClear (the low end governs)
     sloped   zone = the part of the living nearest its high-side wall, slopeDepth deep
              (capped so it is <= slopeMaxArea m2); its ceiling IS the roof's underside
              (Ichijo's 勾配天井 follows the rafters), a bulkhead closes it off from the
              flat ceilings
     windows  head = min(drawn head, sill + winMaxH, ceiling - winCeilGap); wider than
              maxWindowW -> n equal units with `mullion` between; a transom
              (transomH x <= transomMaxW, over a transomGap strip) where the ceiling
              leaves >= transomTopGap above it, unless switched off per window
     doors    every interior door at the catalogue door height
     fittings kitchen (I / peninsula / island), unit bath or unit shower, vanity, toilet:
              placed in the room's clear rectangle, with a fit verdict (bathrooms: the unit
              at the far end, the toilet zone, the vanity in a line, >= 0.6 m standing space,
              door swing / entry and windows clear: see fitRoom)
   info (returned with the model) = readouts, window schedule, fit verdicts, the
   fitted pieces' footprints (for the editor) and the ceilings (for the 3D).
   The panel checks the roof's highest point (info.roof.maxH) against heightLimit (lot 9:
   12 m), the north-side slope limit (northH + northK x the distance to the site's north
   boundary, at the roof's north edge) and totals the glass on the view facade (viewWall). */
'use strict';
import { levelGraph, inPoly, polyArea } from './refplan.js?v=6';

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const PITCH_STD = 3.5;                                           /* sun: Ichijo's standard roof pitch (the panel labels it) */
const clone = (o) => JSON.parse(JSON.stringify(o));
const SIDE = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
/* lot 9 (plan2.json site, the model's frame: -y = north): the fallback when a model has no site.bounds */
const SITE9 = [-12.9543, -12.6841, 9.3101, 10.8712];
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
export const ICHIJO_DEFAULTS = {
  h1: 2.6, gymSunken: true, gymDrop: 0.2, buildUp: 0.45, h2: 2.4,
  view: 'e', slopeDepth: 99, slopeMaxArea: 22, pitch: 3.5, roofClear: 0.15, roofTh: 0.34, overhang: 0.6,
  heightLimit: 12, northH: 5, northK: 1.25, viewWall: 's', viewGap: 0.1,
  winMaxH: 2.2, winCeilGap: 0.1, transomH: 0.3, transomMaxW: 1.8, transomGap: 0.15, transomTopGap: 0.1,
  maxWindowW: 2.6, mullion: 0.1, transom: {}, doorH: 2.0,
  ubMargin: 0.15, walkway: 0.85, cupboardD: 0.45, toiletZone: 0.8, vanityStand: 0.6, endPassage: 0.85, needsMax: 0.3,
  showerMargin: 0.05, toiletW: 0.38, toiletD: 0.76,                 /* v19: shower = install space, else size + 50 mm / side; toilet = TOTO ZJ2 383 x 759 */
};
export const opts = (m) => Object.assign({}, ICHIJO_DEFAULTS, (m && m.ichijo) || {});

/* ------------------------------------------------------------- catalogue */
export async function loadCatalog(url) {
  let c = { items: [] };
  try { const r = await fetch(url); if (r.ok) c = await r.json(); } catch (e) { console.warn('catalog', url, e); }
  c.items = c.items || [];
  c.byId = new Map(c.items.map(e => [e.id, e]));
  return c;
}
const listOf = (cat, category, pred) => (cat ? cat.items : []).filter(e => e.category === category && (!pred || pred(e)));
function pickItem(cat, id, category, pred) {
  const e = cat && cat.byId && cat.byId.get(id);
  if (e && e.category === category) return e;
  const c = listOf(cat, category, pred);
  return c.find(x => x.standard && !x.provisional) || c.find(x => x.standard) || c[0] || null;
}
export function kitchenDepth(item, layout) {
  if (layout === 'I') return 0.65;
  const d = item && item.depth_mm ? item.depth_mm / 1000 : 0.95;
  return Math.max(0.9, Math.min(1.0, d));
}
const vanityDepth = (it) => (it && it.depth_mm ? it.depth_mm / 1000 : 0.55);
export function ubSize(it) {                                     /* nominal inner size (m), e.g. 1616 -> 1.6 x 1.6 */
  if (!it) return null;
  if (it.width_mm && it.depth_mm) return [it.width_mm / 1000, it.depth_mm / 1000];
  const c = String(it.size_code || '');
  return /^\d{4}$/.test(c) ? [+c.slice(0, 2) / 10, +c.slice(2) / 10] : null;
}
export function doorHeight(cat, I) {
  const it = cat && cat.byId && cat.byId.get(I.door);
  return it && it.height_mm ? it.height_mm / 1000 : (I.doorH || 2.0);
}

/* ------------------------------------------------------------- geometry */
const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
function wallFrame(w) {
  const d = sub(w.b, w.a), L = Math.hypot(d[0], d[1]) || 1e-9, u = [d[0] / L, d[1] / L], n = [-u[1], u[0]];
  const off = w.off || 0, t = w.t || 0;
  return { L, u, n, q0: off - t / 2, q1: off + t / 2 };
}
/* a room's face + its clear rectangle (the largest axis-aligned rectangle inside the
   face once every bounding wall's body is taken off) + what lies beyond each side */
function roomGeo(L, G, f) {
  const walls = L.walls || [];
  /* the face boundary without back-and-forth spikes (walls ending inside the room) */
  let he = f.he.slice();
  for (let changed = true; changed;) {
    changed = false;
    for (let k = 0; k < he.length && he.length > 2; k++) {
      const a = he[k], b = he[(k + 1) % he.length];
      if (G.H[a].twin === b) { he = he.filter((_, i) => i !== k && i !== (k + 1) % he.length); changed = true; break; }
    }
  }
  const poly = he.map(j => G.V[G.H[j].from]);
  const edges = he.map(j => {
    const h = G.H[j], E = G.E[h.e], w = walls[E.wall];
    const a = G.V[h.from], b = G.V[h.to], d = sub(b, a), len = Math.hypot(d[0], d[1]) || 1;
    let nx = -d[1] / len, ny = d[0] / len;
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!inPoly(poly, m[0] + nx * 0.01, m[1] + ny * 0.01)) { nx = -nx; ny = -ny; }   /* (nx, ny) points into the room */
    let inset = 0;
    if (w && w.t > 0) {
      const F = wallFrame(w), into = F.n[0] * nx + F.n[1] * ny;
      inset = into > 0 ? Math.max(0, F.q1) : Math.max(0, -F.q0);
    }
    const tw = G.H[h.twin].face, other = G.faces[tw];
    return { a, b, len, nx, ny, inset, w, wi: E.wall, ext: !!(w && w.t >= 0.3), div: !(w && w.t > 0), nb: other && other.bounded && other.room ? other.room : null };
  });
  /* inner (clear) polygon of an orthogonal face: every edge moved in by its inset */
  const off = edges.map(e => Math.abs(e.ny) > 0.5 ? { h: true, c: e.a[1] + e.ny * e.inset, e } : { h: false, c: e.a[0] + e.nx * e.inset, e });
  const IP = [];
  for (let k = 0; k < off.length; k++) {
    const p = off[(k - 1 + off.length) % off.length], q = off[k], at = q.e.a;
    if (p.h !== q.h) IP.push(p.h ? [q.c, p.c] : [p.c, q.c]);
    else { if (p.h) { IP.push([at[0], p.c]); IP.push([at[0], q.c]); } else { IP.push([p.c, at[1]]); IP.push([q.c, at[1]]); } }
  }
  const xs = [...new Set(IP.map(p => r4(p[0])))].sort((a, b) => a - b), ys = [...new Set(IP.map(p => r4(p[1])))].sort((a, b) => a - b);
  const inside = (x, y) => inPoly(IP, x, y);
  const cell = xs.slice(0, -1).map((x, i) => ys.slice(0, -1).map((y, j) => inside((x + xs[i + 1]) / 2, (y + ys[j + 1]) / 2)));
  let best = null;
  for (let i0 = 0; i0 < xs.length - 1; i0++) for (let i1 = i0 + 1; i1 < xs.length; i1++)
    for (let j0 = 0; j0 < ys.length - 1; j0++) for (let j1 = j0 + 1; j1 < ys.length; j1++) {
      const A = (xs[i1] - xs[i0]) * (ys[j1] - ys[j0]);
      if (best && A <= best.A) continue;
      let ok = true;
      for (let i = i0; i < i1 && ok; i++) for (let j = j0; j < j1 && ok; j++) if (!cell[i][j]) ok = false;
      if (ok) best = { A, r: [xs[i0], ys[j0], xs[i1], ys[j1]] };
    }
  const rect = best ? best.r : [0, 0, 0, 0];
  /* each side of the rectangle: the (longest) boundary edge on it, or open (inside the room) */
  const sides = {};
  for (const s of ['n', 's', 'w', 'e']) {
    const hor = s === 'n' || s === 's', c = { n: rect[1], s: rect[3], w: rect[0], e: rect[2] }[s];
    let pick = null;
    for (const o of off) {
      if (o.h !== hor || Math.abs(o.c - c) > 2e-3) continue;
      const [lo, hi] = hor ? [Math.min(o.e.a[0], o.e.b[0]), Math.max(o.e.a[0], o.e.b[0])] : [Math.min(o.e.a[1], o.e.b[1]), Math.max(o.e.a[1], o.e.b[1])];
      const [r0, r1] = hor ? [rect[0], rect[2]] : [rect[1], rect[3]];
      const ov = Math.min(hi, r1) - Math.max(lo, r0);
      if (ov > 0.05 && (!pick || ov > pick.ov)) pick = { ov, e: o.e };
    }
    sides[s] = pick ? { ext: pick.e.ext, div: pick.e.div, nb: pick.e.nb, wi: pick.e.wi } : { open: true };
  }
  /* door openings on this room's boundary: centre point 5 cm inside (p), the centre on the
     wall face (c), the wall direction (u), the normal into the room (n), the width, and
     whether a hinged leaf swings into this room (o.side: +1 toward the wall's +n, the editor's
     convention); and the windows on it (same frame + sill) */
  const doors = [], windows = [];
  walls.forEach(w => {
    if (!(w.t > 0) || !w.ops) return;
    const F = wallFrame(w);
    for (const o of w.ops) {
      const isDoor = /door|double|sliding|entry|slide/.test(o.type), isWin = o.type === 'window';
      if (!isDoor && !isWin) continue;
      const s = o.at + o.w / 2, c = [w.a[0] + F.u[0] * s, w.a[1] + F.u[1] * s];
      for (const sg of [1, -1]) {
        const qf = sg > 0 ? F.q1 : F.q0, qq = qf + sg * 0.05, p = [c[0] + F.n[0] * qq, c[1] + F.n[1] * qq];
        if (!inPoly(poly, p[0], p[1])) continue;
        const rec = { p, w: o.w, c: [c[0] + F.n[0] * qf, c[1] + F.n[1] * qf], u: F.u, n: [F.n[0] * sg, F.n[1] * sg], id: o.src || o.id };
        if (isWin) windows.push(Object.assign(rec, { sill: o.sill || 0 }));
        else doors.push(Object.assign(rec, { swingIn: /^(door|entry|double)$/.test(o.type) && Math.sign(o.side || 1) === sg }));
      }
    }
  });
  return { poly, IP, rect, sides, doors, windows, area: f.netArea };
}
function sideLabel(side, s, lang, I18) {
  const T = I18[lang];
  const dir = T.dirs[s];
  if (!side || side.open) return T.sideOpen(dir);
  if (side.div) return T.sideDiv(dir, side.nb ? nm(side.nb, lang) : '');
  if (side.ext) return T.sideExt(dir);
  return T.sideWall(dir, side.nb ? nm(side.nb, lang) : '');
}
export const nm = (r, lang) => (lang === 'ja' ? (r.ja || r.name) : (r.ja && r.ja !== r.name ? r.name + ' (' + r.ja + ')' : r.name));
/* which side to move for a shortfall along an axis: open/divider (free) < partition < outside wall */
function moveSide(sides, a, b) {
  const cost = (s) => !s || s.open || s.div ? 0 : s.ext ? 3 : !s.nb ? 1 : /bath|wc|stair|sauna/i.test(s.nb.name) ? 2 : /closet/i.test(s.nb.name) ? 1.2 : 1;
  return cost(sides[a]) <= cost(sides[b]) ? a : b;
}
function verdictOf(shorts, I) {
  const m = Math.max(0, ...shorts.map(s => s.cm));
  return m <= 0.5 ? 'FITS' : m <= I.needsMax * 100 ? 'NEEDS' : 'NO';
}
/* item angle with its back (local -y) against side s (see refplan itemToProp / makeProp) */
const backA = { n: 0, s: Math.PI, w: -Math.PI / 2, e: Math.PI / 2 };

/* ------------------------------------------------------------- derive */
export function derive(model, cat, lang) {
  lang = lang || 'en';
  const I = opts(model);
  const M = clone(model);
  const L1 = M.levels[0], L2 = M.levels[1];
  const info = { opts: I, windows: [], fits: [], pieces: [], zone: null, roof: null, heights: null, ceilings: null };
  /* ---- heights */
  L1.h = I.h1; L1.ct = I.buildUp; L1.base = 0;
  if (L2) { L2.base = r4(I.h1 + I.buildUp); L2.h = I.h2; }
  for (const r of L1.rooms || []) if (r.gym || /^gym/i.test(r.name)) { if (I.gymSunken) r.dz = -I.gymDrop; else delete r.dz; }
  const FL2 = L2 ? L2.base : I.h1 + I.buildUp;
  info.heights = { h1: I.h1, gym: I.gymSunken ? r4(I.h1 + I.gymDrop) : I.h1, fl2: FL2, h2: I.h2, ground: M.ground === undefined ? -0.585 : M.ground };
  const G2 = L2 ? levelGraph(L2) : null;
  /* ---- the roof (one plane over the whole 2F, high on side ichijo.view) and the
     sloped zone of the living under it (its ceiling = the roof's underside) */
  const k = I.pitch / 10;
  let zone = null;
  if (L2) {
    const fl = G2.rooms.find(f => f.room && (f.room.living || /^living/i.test(f.room.name)));
    if (fl) {
      const xs = fl.poly.map(p => p[0]), ys = fl.poly.map(p => p[1]);
      const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      /* sides of the living bounded by an outside wall: the roof's possible high sides */
      const extSide = (s) => (L2.walls || []).some(w => {
        if (!(w.t >= 0.3)) return false;
        const F = wallFrame(w), c = { n: bb[1], s: bb[3], w: bb[0], e: bb[2] }[s], hor = s === 'n' || s === 's';
        if (hor ? Math.abs(F.u[1]) > 1e-3 || Math.abs(w.a[1] - c) > 0.01 : Math.abs(F.u[0]) > 1e-3 || Math.abs(w.a[0] - c) > 0.01) return false;
        const lo = hor ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]), hi = hor ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]);
        return lo < (hor ? bb[0] : bb[1]) + 0.1 && hi > (hor ? bb[2] : bb[3]) - 0.1;
      });
      const avail = ['e', 'n', 's', 'w'].filter(extSide);
      const view = avail.includes(I.view) ? I.view : (avail[0] || 'e');
      const hor = view === 'n' || view === 's';
      /* the roof: the lowest plane at this pitch whose underside clears the flat 2F ceilings
         by roofClear; it rises from the low side's inner face, so that end governs */
      const pts = G2.rooms.flatMap(f => f.poly);
      const B2 = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
      const t = Math.max(0.1, ...(L2.walls || []).filter(w => w.t > 0).map(w => w.t));
      const low = OPP[view], sideOf = (s, b) => ({ n: b[1], s: b[3], w: b[0], e: b[2] })[s];
      const lowIn = sideOf(low, B2), hiIn = sideOf(view, B2);
      const h0 = r4(FL2 + I.h2 + I.roofClear);                     /* underside at the low side's inner face */
      const span = Math.abs(hiIn - lowIn);
      const up = (x, z) => view === 'n' ? lowIn - z : view === 's' ? z - lowIn : view === 'e' ? x - lowIn : lowIn - x;   /* metres up-slope */
      const under = (x, z) => h0 + k * up(x, z);                       /* the roof's underside (absolute) */
      const underD = (dd) => h0 + k * dd;
      const rf = { id: 'ichijo', levels: [1], custom: 1, k, th: I.roofTh, over: { n: I.overhang, s: I.overhang, e: I.overhang, w: I.overhang },
        rect: [r4(B2[0] - t), r4(B2[1] - t), r4(B2[2] + t), r4(B2[3] + t)] };
      if (hor) Object.assign(rf, { low: low === 's' ? 's' : 'n', y0: lowIn, h0 });
      else Object.assign(rf, { axis: 'x', low, x0: lowIn, h0 });
      const gnd = info.heights.ground;
      /* north-side slope (northH + northK x the distance to the site's north boundary, from
         the ground): the margin is linear over the roof, so its minimum is at a corner of the
         roof's outline (the 2F faces grown by wall + overhang), on the north edge */
      const SB = (M.site && M.site.bounds) || SITE9, d = t + I.overhang;
      const hg = { e: [k, 0], w: [-k, 0], n: [0, -k], s: [0, k] }[view], mg = [-hg[0], I.northK - hg[1]];
      let nb = null;
      for (const p of pts) {
        const c = [p[0] - d * Math.sign(mg[0]), p[1] - d * Math.sign(mg[1])];
        const h = under(c[0], c[1]) + I.roofTh - gnd, lim = I.northH + I.northK * (c[1] - SB[1]);
        if (!nb || lim - h < nb.margin) nb = { at: c, h, lim, margin: lim - h };
      }
      info.roof = { k, pitch: I.pitch, pitchDeg: r4(Math.atan(k) * 180 / Math.PI), view, span: r4(span),
        eave: r4(underD(-t) + I.roofTh - gnd),                                  /* top of the roof at the low side's outer wall face */
        maxH: r4(underD(span + t + I.overhang) + I.roofTh - gnd),              /* its top edge at the end of the high-side overhang */
        ridge: r4(underD(span + t) + I.roofTh - gnd),
        maxUnder: r4(underD(span + t + I.overhang) - FL2),
        north: nb && { h: r4(nb.h), lim: r4(nb.lim), margin: r4(nb.margin), ok: nb.margin >= -0.005, dist: r4(nb.at[1] - SB[1]), at: nb.at.map(r4), base: I.northH, per: I.northK } };
      M.roofs = [rf];
      info.roofPlane = rf;
      /* the zone: the living's part nearest the high-side wall */
      const width = hor ? bb[2] - bb[0] : bb[3] - bb[1], depthAll = hor ? bb[3] - bb[1] : bb[2] - bb[0];
      const maxD = Math.min(depthAll, I.slopeMaxArea / width);
      const dz = Math.max(0.3, Math.min(I.slopeDepth > 0 ? I.slopeDepth : maxD, maxD));
      let rect;
      if (view === 'n') rect = [bb[0], bb[1], bb[2], bb[1] + dz];
      else if (view === 's') rect = [bb[0], bb[3] - dz, bb[2], bb[3]];
      else if (view === 'e') rect = [bb[2] - dz, bb[1], bb[2], bb[3]];
      else rect = [bb[0], bb[1], bb[0] + dz, bb[3]];
      const inner = { n: rect[3], s: rect[1], e: rect[0], w: rect[2] }[view], outer = { n: rect[1], s: rect[3], e: rect[2], w: rect[0] }[view];
      const along = (c) => hor ? under(0, c) : under(c, 0);
      const lo = r4(along(inner) - FL2), hi = r4(along(outer) - FL2);
      zone = { room: fl.room.id, rect: rect.map(r4), view, avail, width: r4(width), depth: r4(dz), maxDepth: r4(maxD), area: r4(width * dz), k, inner,
        y: under, low: lo, high: hi, peak: hi, pitchDeg: r4(Math.atan(k) * 180 / Math.PI) };
    }
  }
  info.zone = zone && Object.assign({}, zone, { y: undefined });
  /* ---- ceiling height at a point (above the level's floor) */
  const ceilAt = (li, x, z) => {
    if (li === 0) return I.h1;
    if (zone && x > zone.rect[0] - 1e-3 && x < zone.rect[2] + 1e-3 && z > zone.rect[1] - 1e-3 && z < zone.rect[3] + 1e-3) return zone.y(x, z) - FL2;
    return I.h2;
  };
  info.ceilAt = ceilAt;
  info.ceilings = { fl2: FL2, h2: I.h2, zone: zone && { rect: zone.rect, view: zone.view, inner: zone.inner, k, low: zone.low, high: zone.high } };
  /* ---- windows + doors (+ the glass on the view facade: info.south) */
  const DH = doorHeight(cat, I);
  const south = { dir: I.viewWall, glass: 0, wall: 0, pct: 0, windows: 0 };
  M.levels.forEach((L, li) => {
    const G = li === 1 ? G2 : levelGraph(L);
    for (const w of L.walls || []) {
      if (!(w.t > 0)) continue;
      const F = wallFrame(w), isExt = w.t >= 0.3;
      if (!w.ops && !isExt) continue;
      /* outward side of an outside wall: where there is no room */
      let outN = 0, wdir = '';
      if (isExt) {
        const m = [w.a[0] + F.u[0] * F.L / 2, w.a[1] + F.u[1] * F.L / 2], dd = Math.max(Math.abs(F.q0), Math.abs(F.q1)) + 0.05;
        const inRoom = (p) => G.rooms.some(f => inPoly(f.poly, p[0], p[1]));
        outN = !inRoom([m[0] + F.n[0] * dd, m[1] + F.n[1] * dd]) ? 1 : -1;
        const dv = [F.n[0] * outN, F.n[1] * outN];
        wdir = Math.abs(dv[0]) > Math.abs(dv[1]) ? (dv[0] > 0 ? 'e' : 'w') : (dv[1] > 0 ? 's' : 'n');
        /* the view facade's wall area: each floor up to its flat ceiling */
        if (wdir === I.viewWall) south.wall += F.L * (li === 0 ? I.h1 : I.h2);
      }
      if (!w.ops) continue;
      const ops = [];
      for (const o of w.ops) {
        if (o.type === 'window' && isExt) {
          const c0 = [w.a[0] + F.u[0] * o.at, w.a[1] + F.u[1] * o.at], c1 = [w.a[0] + F.u[0] * (o.at + o.w), w.a[1] + F.u[1] * (o.at + o.w)];
          const inq = -outN * 0.05;                                   /* sample the ceiling just inside the wall */
          const ceilSpan = (s0, s1) => Math.min(...[s0, (s0 + s1) / 2, s1].map(s => ceilAt(li, w.a[0] + F.u[0] * s + F.n[0] * inq, w.a[1] + F.u[1] * s + F.n[1] * inq)));
          const m = I.mullion, n = Math.max(1, Math.ceil((o.w + m - 1e-6) / (I.maxWindowW + m)));
          const uw = (o.w - (n - 1) * m) / n;
          /* the room behind it: the most-sampled named room with a floor, 30 cm inside */
          const hits = new Map();
          for (const tt of [0.12, 0.3, 0.5, 0.7, 0.88]) {
            const s = o.at + o.w * tt, p = [w.a[0] + F.u[0] * s - F.n[0] * outN * 0.3, w.a[1] + F.u[1] * s - F.n[1] * outN * 0.3];
            const f = G.rooms.find(ff => ff.room && ff.room.floor !== 'void' && inPoly(ff.poly, p[0], p[1]));
            if (f) hits.set(f, (hits.get(f) || 0) + 1);
          }
          const room = [...hits.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])[0];
          const dir = wdir;
          const rec = { id: o.id, src: o.src || o.id, level: li, room: room && room.room ? { id: room.room.id, name: room.room.name, ja: room.room.ja } : null, dir,
            drawn: { w: r4(o.w), sill: r4(o.sill), head: r4(o.head) }, n, unitW: r4(uw), units: [], transomOn: I.transom[o.id] !== false };
          for (let i = 0; i < n; i++) {
            const at = o.at + i * (uw + m), cs = ceilSpan(at, at + uw);
            const head = r4(Math.max(o.sill + 0.3, Math.min(o.head, o.sill + I.winMaxH, cs - I.winCeilGap)));
            const tw = Math.min(uw, I.transomMaxW), ts = head + I.transomGap, tt = ts + I.transomH;
            const fits = cs - tt >= I.transomTopGap - 1e-6;
            const u = { at: r4(at), w: r4(uw), sill: o.sill, head, ceil: r4(cs), transom: fits && rec.transomOn, fits };
            rec.units.push(u);
            ops.push(Object.assign({}, o, { id: o.id + (n > 1 ? '_' + i : ''), at: r4(at), w: r4(uw), head, style: o.style || '' }));
            if (u.transom) ops.push({ id: o.id + '_t' + i, type: 'window', style: 'transom', at: r4(at + (uw - tw) / 2), w: r4(tw), sill: r4(ts), head: r4(tt), src: o.src });
          }
          rec.head = rec.units[0].head;
          rec.transomFits = rec.units.some(u => u.fits);
          rec.transoms = rec.units.filter(u => u.transom).length;
          rec.glass = r4(rec.units.reduce((a, u) => a + u.w * (u.head - u.sill) + (u.transom ? Math.min(u.w, I.transomMaxW) * I.transomH : 0), 0));
          if (dir === I.viewWall) { south.glass += rec.glass; south.windows++; }
          info.windows.push(rec);
        } else if (/door|double|sliding|slide|entry/.test(o.type)) {
          if (!isExt) ops.push(Object.assign({}, o, { head: r4(DH) }));
          else {
            const s = o.at + o.w / 2, p = [w.a[0] + F.u[0] * s - F.n[0] * outN * 0.05, w.a[1] + F.u[1] * s - F.n[1] * outN * 0.05];
            ops.push(Object.assign({}, o, { head: r4(Math.min(o.head, ceilAt(li, p[0], p[1]) - I.winCeilGap)) }));
          }
        } else ops.push(o);
      }
      w.ops = ops;
    }
  });
  info.doorH = DH;
  south.glass = r4(south.glass); south.wall = r4(south.wall); south.pct = south.wall > 0 ? r4(100 * south.glass / south.wall) : 0;
  info.south = south;
  /* ---- fittings */
  M.levels.forEach((L, li) => {
    const G = li === 1 ? G2 : levelGraph(L);
    for (const f of G.rooms) {
      const r = f.room;
      if (!r || !r.fit) continue;
      fitRoom(M, L, li, G, f, r, cat, I, info, lang);
    }
  });
  return { model: M, info };
}

const inFace = (f, x, y) => inPoly(f.poly, x, y) && !(f.holes || []).some(h => inPoly(h, x, y));
let _pid = 0;
const pid = (p) => p + 'x' + (_pid++).toString(36);

function fitRoom(M, L, li, G, f, r, cat, I, info, lang) {
  const geo = roomGeo(L, G, f), R = geo.rect;
  const items = L.items || (L.items = []);
  const mine = (fx) => items.filter(it => it.fx === fx && inFace(f, it.x, it.y));
  const drop = (list) => { for (const it of list) items.splice(items.indexOf(it), 1); };
  const W = R[2] - R[0], D = R[3] - R[1];
  const base = { roomId: r.id, room: { id: r.id, name: r.name, ja: r.ja }, level: li, inner: [r4(W), r4(D)], rect: R };
  const add = (rec) => { info.fits.push(Object.assign({}, base, rec)); };
  const piece = (kind, x, y, w, d, a, extra) => {
    if (/^ghost(No|Needs)$/.test(kind)) {                       /* does not fit: fill clipped to the room, outline at full size */
      const q = Math.abs(Math.sin(a)) > 0.5, hx = (q ? d : w) / 2, hy = (q ? w : d) / 2;
      const x0 = Math.max(x - hx, R[0]), x1 = Math.min(x + hx, R[2]), y0 = Math.max(y - hy, R[1]), y1 = Math.min(y + hy, R[3]);
      items.push(Object.assign({ id: pid('ich'), kind: kind.replace('ghost', 'ghostLine'), x: r4(x), y: r4(y), w: r4(w), d: r4(d), a: r4(a), fitted: 1 }, extra || {}));
      if (x1 - x0 < 0.05 || y1 - y0 < 0.05) return null;
      return piece(kind + 'Fill', (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, 0, extra);
    }
    const it = Object.assign({ id: pid('ich'), kind, x: r4(x), y: r4(y), w: r4(w), d: r4(d), a: r4(a), fitted: 1 }, extra || {});
    items.push(it);
    return it;
  };
  const foot = (fit, x, y, w, d, a, verdict, label) => {
    const ca = Math.cos(a), sa = Math.sin(a);
    const poly = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([px, py]) => [r4(x + px * ca - py * sa), r4(y + px * sa + py * ca)]);
    info.pieces.push({ level: li, fit, poly, verdict, label, room: r.id });
  };
  const F = r.fit;
  /* ---------------- kitchen: run along the wall the drawn kitchen stood against */
  if (F.kitchen) {
    const lay = ['I', 'peninsula', 'island'].includes(F.layout) ? F.layout : 'peninsula';
    const it = pickItem(cat, F.kitchen, 'kitchen', e => lay === 'I' ? e.layout === 'I' : e.layout === 'peninsula' || e.layout === 'island');
    const old = mine('kitchen');
    /* back wall = the side with the most drawn counter length against it */
    const score = { n: 0, s: 0, w: 0, e: 0 };
    for (const o of old) {
      const ca = Math.abs(Math.cos(o.a)), sa = Math.abs(Math.sin(o.a)), hx = (o.w * ca + o.d * sa) / 2, hy = (o.w * sa + o.d * ca) / 2;
      if (o.x - hx < R[0] + 0.15) score.w += 2 * hy; if (o.x + hx > R[2] - 0.15) score.e += 2 * hy;
      if (o.y - hy < R[1] + 0.15) score.n += 2 * hx; if (o.y + hy > R[3] - 0.15) score.s += 2 * hx;
    }
    /* never against the view wall (an outside wall facing ichijo.viewWall: the south glass) */
    const isView = (s) => s === I.viewWall && !!geo.sides[s] && !!geo.sides[s].ext;
    const usable = (s) => !geo.sides[s].open && !geo.sides[s].div && !isView(s);
    const cand = ['w', 'e', 'n', 's'].filter(usable);
    const back = (cand.length ? cand : ['w', 'e', 'n', 's'].filter(s => !isView(s))).sort((a, b) => score[b] - score[a])[0];
    drop(old);
    const alongX = back === 'n' || back === 's';
    const run = alongX ? W : D, depthAv = alongX ? D : W;
    const kw = it ? (it.width_mm || 2550) / 1000 : 2.55, kd = kitchenDepth(it, lay);
    const needD = lay === 'I' ? kd + I.walkway + I.cupboardD : I.cupboardD + I.walkway + kd;
    const needR = kw + (lay === 'island' ? 2 * I.endPassage : lay === 'peninsula' ? I.endPassage : 0);
    const shorts = [];
    const ends = alongX ? ['w', 'e'] : ['n', 's'];
    if (needR > run + 1e-6) shorts.push({ cm: Math.round((needR - run) * 100), side: moveSide(geo.sides, ends[0], ends[1]) });
    if (needD > depthAv + 1e-6) shorts.push({ cm: Math.round((needD - depthAv) * 100), side: OPP[back] });
    let verdict = verdictOf(shorts, I);
    /* placement: I against the back wall, cupboard across the walkway; peninsula / island: cupboard on the back wall */
    const nIn = SIDE[OPP[back]];                                   /* pointing into the room from the back wall */
    const wallC = { n: R[1], s: R[3], w: R[0], e: R[2] }[back];
    const along0 = alongX ? R[0] : R[1], along1 = alongX ? R[2] : R[3];
    const P = (dAlong, dIn) => alongX ? [dAlong, wallC + nIn[1] * dIn] : [wallC + nIn[0] * dIn, dAlong];
    const aRun = lay === 'I' ? backA[back] : backA[OPP[back]];      /* the run's fronts face into the room (I) / the cook (peninsula, island) */
    let runC = (along0 + along1) / 2;
    if (lay === 'peninsula') {                                      /* one end against an end wall (never the view wall) */
      const e0 = ends[0], e1 = ends[1], endWall = usable(e0) ? e0 : usable(e1) ? e1 : isView(e0) ? e1 : e0;
      runC = endWall === ends[0] ? along0 + kw / 2 : along1 - kw / 2;
    } else if (lay === 'I' && kw < run && isView(ends[0]) !== isView(ends[1])) {
      runC = isView(ends[0]) ? along1 - kw / 2 : along0 + kw / 2;   /* I: slid to the end away from the view wall */
    }
    const cupW = Math.min(kw, run), cupC = runC;
    let kc, cc;
    if (lay === 'I') { kc = P(runC, kd / 2); cc = P(cupC, kd + I.walkway + I.cupboardD / 2); }
    else { cc = P(cupC, I.cupboardD / 2); kc = P(runC, I.cupboardD + I.walkway + kd / 2); }
    /* a run or cupboard that would still stand against the view wall: NO */
    const aCup = lay === 'I' ? backA[OPP[back]] : backA[back];
    const box = (c, w, dd, a) => { const q = Math.abs(Math.sin(a)) > 0.5, hx = (q ? dd : w) / 2, hy = (q ? w : dd) / 2; return [c[0] - hx, c[1] - hy, c[0] + hx, c[1] + hy]; };
    const gapTo = (b, sd) => sd === 'n' ? b[1] - R[1] : sd === 's' ? R[3] - b[3] : sd === 'w' ? b[0] - R[0] : R[2] - b[2];
    const vs = ['n', 's', 'w', 'e'].find(sd => isView(sd) && [box(kc, kw, kd, aRun), box(cc, cupW, I.cupboardD, aCup)].some(b => gapTo(b, sd) < I.viewGap));
    if (vs) shorts.push({ cm: 0, side: vs, view: true });
    if (!cand.length && !vs) shorts.push({ cm: 0, side: I.viewWall, view: true });
    if (shorts.some(x => x.view)) verdict = 'NO';
    const ghost = verdict === 'NO' || (verdict === 'NEEDS' && Math.max(...shorts.map(x => x.cm)) > 10);
    const lbl = (it ? catLabel(it, lang, true, true) : '?') + ' · ' + LAYOUT[lang][lay];
    if (ghost) piece(verdict === 'NO' ? 'ghostNo' : 'ghostNeeds', kc[0], kc[1], kw, kd, aRun, { h: 0.9 });
    else piece('island', kc[0], kc[1], kw, kd, aRun, { h: 0.85, kitchen: lay });
    piece('tall', cc[0], cc[1], cupW, I.cupboardD, aCup, { h: lay === 'I' ? 0.9 : 2.2 });
    foot('kitchen', kc[0], kc[1], kw, kd, aRun, verdict, lbl);
    foot('cupboard', cc[0], cc[1], cupW, I.cupboardD, aCup, 'INFO', STR[lang].cupboard);
    add({ fit: 'kitchen', set: it ? it.id : null, label: lbl, layout: lay, need: [r4(needR), r4(needD)], verdict, shorts: shorts.map(s => Object.assign(s, { text: sideLabel(geo.sides[s.side], s.side, lang, STR) })) });
  }
  /* ---------------- bathrooms (v19): in a line along one long wall (wallS), from the far end
     (away from the door): the unit (shower room / unit bath), the toilet zone, the vanity; a
     standing strip of >= vanityStand in front of each along the other long wall; every door's
     swing (hinged, into the room) and entry (vanityStand deep) clear of the fittings; a unit
     never stands in front of a window. Unit footprint: a shower's published installation space,
     else its size + showerMargin per side; a unit bath's size + ubMargin per side. The unit is
     tried with its long side along wallS (door onto the standing strip), then across the far end
     (door toward the toilet zone, against the strip's wall); the first that fits wins.
     WC (toilet only): the toilet at the far short end, facing along the room. */
  if (F.ub || F.vanity || F.toilet) {
    const longX = W >= D, Lx = longX ? W : D, Wx = longX ? D : W;
    const ends = longX ? ['w', 'e'] : ['n', 's'], longs = longX ? ['n', 's'] : ['w', 'e'];
    /* the far end = away from the door */
    const dpos = geo.doors.length ? geo.doors.map(d => longX ? d.p[0] : d.p[1]) : [longX ? R[2] : R[3]];
    const dm = dpos.reduce((a, b) => a + b, 0) / dpos.length, mid = longX ? (R[0] + R[2]) / 2 : (R[1] + R[3]) / 2;
    const far = dm > mid ? ends[0] : ends[1];
    /* fixtures stand on the long wall without a door (else the first) */
    const doorOn = (s) => geo.doors.some(d => Math.abs((s === 'n' ? R[1] : s === 's' ? R[3] : s === 'w' ? R[0] : R[2]) - (longX ? d.p[1] : d.p[0])) < 0.35);
    const wallS = doorOn(longs[0]) && !doorOn(longs[1]) ? longs[1] : longs[0];
    const farC = { n: R[1], s: R[3], w: R[0], e: R[2] }[far], dirIn = far === ends[0] ? 1 : -1;    /* along the long axis, away from the far end */
    const wallC = { n: R[1], s: R[3], w: R[0], e: R[2] }[wallS], inW = SIDE[OPP[wallS]];
    const at = (along, acr) => longX ? [farC + dirIn * along, wallC + inW[1] * acr] : [wallC + inW[0] * acr, farC + dirIn * along];
    const box2 = (a0, a1, c0, c1) => { const p = at(a0, c0), q = at(a1, c1); return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])]; };
    const cm = (v) => Math.round(v * 100);
    const stand = I.vanityStand;
    const toilets = mine('toilet');
    const hasToilet = F.toilet !== undefined && toilets.length > 0;
    const unitSet = !!F.ub && F.ub !== 'hinoki';
    const textOf = (shorts) => shorts.map(s => Object.assign(s, { text: sideLabel(geo.sides[s.side], s.side, lang, STR) }));
    /* the toilet (catalogue size, else toiletW x toiletD: TOTO ZJ2) */
    const tIt = hasToilet ? pickItem(cat, F.toilet, 'toilet') : null;
    const tW = tIt && tIt.width_mm ? tIt.width_mm / 1000 : I.toiletW, tD = tIt && tIt.depth_mm ? tIt.depth_mm / 1000 : I.toiletD;
    const tLbl = tIt ? catLabel(tIt, lang, true) : '?';
    /* doors: a hinged leaf swinging in must not reach a fitting; every door needs an entry at
       least min(width, vanityStand) wide and vanityStand deep free of fittings */
    const doorShorts = (rects) => {
      const out = {};
      const push = (k, s) => (out[k] = out[k] || []).push(s);
      const ov = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0.01 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.01;
      for (const d of geo.doors) {
        const zone = (depth) => { const P = [-1, 1].flatMap(sg => [0, depth].map(q => [d.c[0] + d.u[0] * sg * d.w / 2 + d.n[0] * q, d.c[1] + d.u[1] * sg * d.w / 2 + d.n[1] * q])); return [Math.min(...P.map(p => p[0])), Math.min(...P.map(p => p[1])), Math.max(...P.map(p => p[0])), Math.max(...P.map(p => p[1]))]; };
        const corners = (r) => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
        const along = (r) => { const t = corners(r).map(p => (p[0] - d.c[0]) * d.u[0] + (p[1] - d.c[1]) * d.u[1]); return [Math.min(...t), Math.max(...t)]; };
        const depth = (r) => Math.max(0, Math.min(...corners(r).map(p => (p[0] - d.c[0]) * d.n[0] + (p[1] - d.c[1]) * d.n[1])));
        const acc = zone(stand), sw = d.swingIn ? zone(d.w) : null, blocked = [];
        for (const [k, r] of Object.entries(rects)) {
          if (!r) continue;
          if (sw && ov(r, sw)) push(k, { cm: cm(d.w - depth(r)), side: wallS, door: d.id });
          if (ov(r, acc)) blocked.push([k, along(r)]);
        }
        if (!blocked.length) continue;
        const iv = blocked.map(b => [Math.max(-d.w / 2, b[1][0]), Math.min(d.w / 2, b[1][1])]).filter(v => v[1] > v[0]).sort((a, b) => a[0] - b[0]);
        let free = 0, cur = -d.w / 2;
        for (const [a0, a1] of iv) { free = Math.max(free, a0 - cur); cur = Math.max(cur, a1); }
        free = Math.max(free, d.w / 2 - cur);
        const need = Math.min(d.w, stand);
        if (free < need - 0.005) for (const [k] of blocked) push(k, { cm: cm(need - free), side: wallS, door: d.id });
      }
      return out;
    };
    if (F.ub === 'hinoki') {
      add({ fit: 'ub', set: 'hinoki', label: STR[lang].hinoki, verdict: 'CUSTOM', shorts: [] });
      for (const o of mine('ub')) { const ca = Math.cos(o.a), sa = Math.sin(o.a); info.pieces.push({ level: li, fit: 'ub', poly: [[-o.w / 2, -o.d / 2], [o.w / 2, -o.d / 2], [o.w / 2, o.d / 2], [-o.w / 2, o.d / 2]].map(([px, py]) => [r4(o.x + px * ca - py * sa), r4(o.y + px * sa + py * ca)]), verdict: 'CUSTOM', label: '', room: r.id }); }
    }
    if (unitSet || (F.vanity && hasToilet)) {
      /* the unit */
      let U = null;
      if (unitSet) {
        const ce = cat && cat.byId && cat.byId.get(F.ub);
        const shower = ce ? ce.category === 'shower' : (F.ub === 'shower' || String(F.ub).indexOf('shower') >= 0);
        const it = shower ? pickItem(cat, F.ub, 'shower') : pickItem(cat, F.ub, 'unit_bath');
        const nom = shower ? (it && it.width_mm && it.depth_mm ? [it.width_mm / 1000, it.depth_mm / 1000] : [0.9, 0.9]) : ubSize(it) || [1.6, 1.6];
        const inst = shower && it && it.install_w_mm && it.install_d_mm ? [it.install_w_mm / 1000, it.install_d_mm / 1000] : null;
        const m = shower ? I.showerMargin : I.ubMargin;
        const fp = inst || [nom[0] + 2 * m, nom[1] + 2 * m];
        const wall = shower ? 0.03 : 0.05;                                  /* the unit's own panels, inside its footprint */
        const sh = [Math.min(nom[0] + 2 * wall, fp[0]), Math.min(nom[1] + 2 * wall, fp[1])];
        U = { it, shower, Lu: Math.max(...fp), Su: Math.min(...fp), sLu: Math.max(...sh), sSu: Math.min(...sh), inst: !!inst,
          label: it ? catLabel(it, lang, true) : (shower ? STR[lang].showerOnly : '?') };
      }
      const vIt = F.vanity ? pickItem(cat, F.vanity, 'vanity') : null;
      const vw = F.vanity ? (vIt && vIt.width_mm ? vIt.width_mm / 1000 : 0.75) : 0, vd = F.vanity ? vanityDepth(vIt) : 0;
      const tz = hasToilet ? I.toiletZone : 0;
      const layout = (ori) => {
        const L = { ori, sh: { ub: [], toilet: [], vanity: [] }, rect: {} };
        let used = 0;
        if (U) {
          const ua = ori === 'along' ? U.Lu : U.Su, uc = ori === 'along' ? U.Su : U.Lu;
          if (ori === 'along' ? uc + stand > Wx + 0.005 : uc > Wx + 0.005) L.sh.ub.push({ cm: cm(ori === 'along' ? uc + stand - Wx : uc - Wx), side: moveSide(geo.sides, longs[0], longs[1]) });
          const needL = ua + (hasToilet ? tz : F.vanity ? 0 : ori === 'across' ? stand : 0);
          if (needL > Lx + 0.005) L.sh.ub.push({ cm: cm(needL - Lx), side: moveSide(geo.sides, ends[0], ends[1]) });
          L.rect.ub = ori === 'along' ? box2(0, ua, 0, uc) : box2(0, ua, Math.max(0, Wx - uc), Math.max(Wx, uc));
          L.ua = ua; L.uc = uc; L.need = [ori === 'along' ? uc + stand : uc, needL];
          used = ua;
        }
        if (hasToilet) {
          if (tD + stand > Wx + 0.005) L.sh.toilet.push({ cm: cm(tD + stand - Wx), side: moveSide(geo.sides, longs[0], longs[1]) });
          if (!U && used + tz > Lx + 0.005) L.sh.toilet.push({ cm: cm(used + tz - Lx), side: moveSide(geo.sides, ends[0], ends[1]) });
          L.rect.toilet = box2(used + tz / 2 - tW / 2, used + tz / 2 + tW / 2, 0.01, 0.01 + tD);
          L.tC = at(used + tz / 2, 0.01 + tD / 2);
          used += tz;
        }
        if (F.vanity) {
          const left = Lx - used, vl = Math.min(vw, Math.max(left, 0.3));
          if (vw > left + 0.005) L.sh.vanity.push({ cm: cm(vw - left), side: moveSide(geo.sides, ends[0], ends[1]) });
          if (vd + stand > Wx + 0.005) L.sh.vanity.push({ cm: cm(vd + stand - Wx), side: moveSide(geo.sides, longs[0], longs[1]) });
          L.rect.vanity = box2(used, used + vl, 0, vd);
          L.vC = at(used + vl / 2, vd / 2);
        }
        /* windows: the unit (about 2.1 m tall, own walls and ceiling) must not stand in front of one */
        if (U) for (const wn of geo.windows) {
          if (wn.sill > 2.0) continue;
          const zone = [-1, 1].flatMap(sg => [0, 0.15].map(q => [wn.c[0] + wn.u[0] * sg * wn.w / 2 + wn.n[0] * q, wn.c[1] + wn.u[1] * sg * wn.w / 2 + wn.n[1] * q]));
          const z = [Math.min(...zone.map(p => p[0])), Math.min(...zone.map(p => p[1])), Math.max(...zone.map(p => p[0])), Math.max(...zone.map(p => p[1]))], b = L.rect.ub;
          const ox = Math.min(z[2], b[2]) - Math.max(z[0], b[0]), oy = Math.min(z[3], b[3]) - Math.max(z[1], b[1]);
          if (ox > 0.02 && oy > 0.005) L.sh.ub.push({ cm: cm(Math.abs(wn.u[0]) > 0.5 ? ox : oy), side: wallS, win: wn.id });
        }
        const ds = doorShorts(L.rect);
        for (const k of Object.keys(ds)) L.sh[k].push(...ds[k]);
        L.worst = Math.max(0, ...Object.values(L.sh).flat().map(x => x.cm));
        return L;
      };
      const cands = U ? ['along', 'across'].map(layout) : [layout('none')];
      const B = cands.find(c => c.worst <= 0.5) || cands.slice().sort((a, b) => (a.worst - b.worst) || (a.ori === 'across' ? -1 : 1))[0];
      const real = (v, sh) => v === 'FITS' || (v === 'NEEDS' && Math.max(...sh.map(x => x.cm)) <= 10);
      if (U) {
        drop(mine('ub'));
        const sh = B.sh.ub, verdict = verdictOf(sh, I), b = B.rect.ub, c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
        if (real(verdict, sh)) {
          const along = B.ori === 'along', a = along ? backA[wallS] : backA[far];
          const extra = { h: 2.15 };
          if (U.shower && !along) {
            /* door toward the standing strip: the middle of the unit's front beside the toilet */
            const c0 = Math.max(hasToilet ? 0.01 + tD : vd, Wx - B.uc), want = (c0 + Wx) / 2 - (Wx - B.uc / 2);
            const ax = [Math.cos(a), Math.sin(a)], acr = [inW[0], inW[1]];
            extra.dx = r4(want * (ax[0] * acr[0] + ax[1] * acr[1]));
          }
          piece(U.shower ? 'shbox' : 'ubox', c[0], c[1], U.sLu, U.sSu, a, extra);
        } else piece(verdict === 'NO' ? 'ghostNo' : 'ghostNeeds', c[0], c[1], b[2] - b[0], b[3] - b[1], 0, { h: 2.15 });
        foot('ub', c[0], c[1], b[2] - b[0], b[3] - b[1], 0, verdict, U.label);
        add({ fit: 'ub', set: U.it ? U.it.id : F.ub, label: U.label, need: [r4(B.need[0]), r4(B.need[1])], verdict, layout: B.ori, inst: U.inst, shorts: textOf(sh) });
      }
      if (hasToilet) {
        const t = toilets[0], sh = B.sh.toilet, verdict = verdictOf(sh, I);
        t.x = r4(B.tC[0]); t.y = r4(B.tC[1]); t.a = r4(backA[wallS] + Math.PI); t.w = r4(tW); t.d = r4(tD);
        t.model = tIt ? tIt.id : null;
        foot('toilet', t.x, t.y, tW, tD, backA[wallS], verdict, tLbl);
        add({ fit: 'toilet', set: tIt ? tIt.id : null, label: tLbl, need: [r4(tD + stand), r4(tz)], verdict, shorts: textOf(sh) });
      }
      if (F.vanity) {
        drop(mine('vanity'));
        const sh = B.sh.vanity, verdict = verdictOf(sh, I), lbl = vIt ? catLabel(vIt, lang, true) : '?', a = backA[wallS];
        if (real(verdict, sh)) piece('vanity', B.vC[0], B.vC[1], vw, vd, a, { h: 0.85 });
        else piece(verdict === 'NO' ? 'ghostNo' : 'ghostNeeds', B.vC[0], B.vC[1], vw, vd, a, { h: 0.85 });
        foot('vanity', B.vC[0], B.vC[1], vw, vd, a, verdict, lbl);
        add({ fit: 'vanity', set: vIt ? vIt.id : null, label: lbl, need: [r4(vw), r4(vd + stand)], verdict, shorts: textOf(sh) });
      }
    } else {
      /* WC: the toilet at the far short end, its back to that wall, facing along the room */
      if (hasToilet) {
        const t = toilets[0], sh = [];
        if (tD + stand > Lx + 0.005) sh.push({ cm: cm(tD + stand - Lx), side: moveSide(geo.sides, ends[0], ends[1]) });
        if (I.toiletZone > Wx + 0.005) sh.push({ cm: cm(I.toiletZone - Wx), side: moveSide(geo.sides, longs[0], longs[1]) });
        const cx = longX ? farC + dirIn * (0.01 + tD / 2) : (R[0] + R[2]) / 2, cy = longX ? (R[1] + R[3]) / 2 : farC + dirIn * (0.01 + tD / 2);
        const q = !longX, hx = (q ? tW : tD) / 2, hy = (q ? tD : tW) / 2;
        const ds = doorShorts({ toilet: [cx - hx, cy - hy, cx + hx, cy + hy] });
        sh.push(...(ds.toilet || []));
        const verdict = verdictOf(sh, I);
        t.x = r4(cx); t.y = r4(cy); t.a = r4(backA[far] + Math.PI); t.w = r4(tW); t.d = r4(tD);
        t.model = tIt ? tIt.id : null;
        foot('toilet', t.x, t.y, tW, tD, backA[far], verdict, tLbl);
        add({ fit: 'toilet', set: tIt ? tIt.id : null, label: tLbl, need: [r4(I.toiletZone), r4(tD + stand)], verdict, shorts: textOf(sh) });
      }
      /* wash room: the vanity at the drawn counter's place (its wall + centre); needs its width along that wall */
      if (F.vanity) {
        const it = pickItem(cat, F.vanity, 'vanity');
        const vw = it && it.width_mm ? it.width_mm / 1000 : 0.75, vd = vanityDepth(it);
        const old = mine('vanity');
        const shorts = [];
        const o = old[0];
        let side = 'e', cx = (R[0] + R[2]) / 2, cy = (R[1] + R[3]) / 2;
        if (o) {
          const ds = { w: Math.abs(o.x - R[0]), e: Math.abs(R[2] - o.x), n: Math.abs(o.y - R[1]), s: Math.abs(R[3] - o.y) };
          side = Object.keys(ds).sort((p, q) => ds[p] - ds[q])[0]; cx = o.x; cy = o.y;
        }
        const alongX = side === 'n' || side === 's', run = alongX ? W : D, dep = alongX ? D : W;
        if (vw > run + 0.005) shorts.push({ cm: Math.round((vw - run) * 100), side: moveSide(geo.sides, alongX ? 'w' : 'n', alongX ? 'e' : 's') });
        if (vd + I.vanityStand > dep + 0.005) shorts.push({ cm: Math.round((vd + I.vanityStand - dep) * 100), side: OPP[side] });
        const half = vw / 2, lo = alongX ? R[0] + half : R[1] + half, hi = alongX ? R[2] - half : R[3] - half;
        const along = Math.max(lo, Math.min(hi, alongX ? cx : cy));
        const wc = { n: R[1], s: R[3], w: R[0], e: R[2] }[side], ni = SIDE[OPP[side]];
        const c = alongX ? [along, wc + ni[1] * vd / 2] : [wc + ni[0] * vd / 2, along];
        const a = backA[side];
        drop(old);
        const verdict = verdictOf(shorts, I);
        const lbl = it ? catLabel(it, lang, true) : '?';
        if (verdict === 'FITS' || (verdict === 'NEEDS' && Math.max(...shorts.map(x => x.cm)) <= 10)) piece('vanity', c[0], c[1], vw, vd, a, { h: 0.85 });
        else piece(verdict === 'NO' ? 'ghostNo' : 'ghostNeeds', c[0], c[1], vw, vd, a, { h: 0.85 });
        foot('vanity', c[0], c[1], vw, vd, a, verdict, lbl);
        add({ fit: 'vanity', set: it ? it.id : null, label: lbl, need: [r4(vw), r4(vd + I.vanityStand)], verdict, shorts: textOf(shorts) });
      }
    }
  }
}

/* ------------------------------------------------------------- plan (refplan toPlan output) */
/* after toPlan(derived model): the outside stair from the ground (its own riser
   height, the landing at the 2F floor), porch steps at the 1F outside doors,
   2F outside walls up to the roof (wallRun clips them to its plane) */
export function postPlan(plan, D) {
  const M = D.model, info = D.info, I = info.opts;
  const L0 = plan.levels[0], L1 = plan.levels[1];
  const ground = plan.ground;
  plan.ichijo = { info, outside: [], porches: [] };
  /* the shower room's door offset (dx): refplan's itemToProp carries only a few extras */
  M.levels.forEach((L, li) => {
    const P = plan.levels[li], dx = new Map((L.items || []).filter(it => it.dx !== undefined).map(it => [it.id, it.dx]));
    if (P && P.furniture && dx.size) for (const p of P.furniture) if (dx.has(p.id)) p.dx = dx.get(p.id);
  });
  for (const s of M.stairs || []) {
    if (!s.outside) continue;
    const e = plan.stairs3.find(x => x.id === s.id);
    if (!e) continue;
    const top = (L1 ? L1.base : L0.h + L0.ct) - L0.base, y0 = s.y0 !== undefined ? s.y0 : ground;
    const nf = e.treads.length - (s.landing ? 1 : 0), per = (top - y0) / (nf + 1);
    e.treads.forEach((t, k) => { t.top = r4(k < nf ? y0 + (k + 1) * per : top); });
    e.rise = r4(top - y0); e.n = nf + 1; e.hidden = 1; e.y0 = y0; e.landing = s.landing ? 1 : 0; e.outside = 1;
    plan.ichijo.outside.push(e);
  }
  /* porch steps: 1F outside doors with their sill at the floor, the ground below */
  if (ground < -0.15) {
    for (const w of L0.walls) {
      if (w.kind !== 'ext') continue;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), u = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
      for (const o of w.doors) {
        if (o.kind === 'WINDOW' || o.kind === 'HOLE' || o.bottom < -0.05) continue;
        const s0 = o.off - 0.3, s1 = o.off + o.w + 0.3, q = w.t;
        const P = (s, d) => [w.a[0] + u[0] * s + w.n[0] * (q + d), w.a[1] + u[1] * s + w.n[1] * (q + d)];
        /* skip where the outside stair or its landing stands */
        const c = P((s0 + s1) / 2, 0.45);
        if (plan.ichijo.outside.some(e => e.treads.some(t => inPoly(t.poly, c[0], c[1])))) continue;
        const nStep = Math.max(1, Math.round(-ground / 0.2)), rise = -ground / (nStep + 1);
        const steps = [];
        for (let i = 0; i <= nStep; i++) {
          const d0 = i === 0 ? -q : 0.9 + (i - 1) * 0.3, d1 = i === 0 ? 0.9 : d0 + 0.3;     /* the top step runs in under the door (the threshold) */
          steps.push({ poly: [P(s0, d0), P(s1, d0), P(s1, d1), P(s0, d1)], top: r4(-i * rise - 0.02) });
        }
        plan.ichijo.porches.push({ id: 'porch' + o.id, level: 0, rise: -ground, n: nStep + 1, solid: steps.length, hidden: 1, treads: steps });
      }
    }
    plan.stairs3.push(...plan.ichijo.porches);
  }
  /* 2F outside walls run up to the roof (wallRun clips them to the plane) */
  if (L1 && info.roof) for (const w of L1.walls) if (w.kind === 'ext') w.top = r4(info.roof.maxUnder + 0.5);
  plan.carport7 = M.site && M.site.carport ? Object.assign({}, M.site.carport) : null;
  return plan;
}

/* ------------------------------------------------------------- strings */
const LAYOUT = { ja: { I: 'I型', peninsula: 'ペニンシュラ', island: 'アイランド' }, en: { I: 'I-type', peninsula: 'peninsula', island: 'island' } };
const MAKER_JA = { ichijo: '一条', panasonic: 'パナソニック', lixil: 'LIXIL', toto: 'TOTO', housetec: 'ハウステック' };
const MAKER_EN = { ichijo: 'Ichijo', panasonic: 'Panasonic', lixil: 'LIXIL', toto: 'TOTO', housetec: 'Housetec' };
const yen = (v) => v === null || v === undefined ? '' : v === 0 ? '' : '+¥' + Math.round(v).toLocaleString('en-US');
/* a catalogue entry in one line: maker line size (layout) [price] [provisional] */
export function catLabel(e, lang, short, noLayout) {
  if (!e) return '';
  const ja = lang === 'ja';
  const jaLine = (e.line_ja || (e.line && /[^\x00-\x7f]/.test(e.line) ? e.line : e.name_ja || e.line || '')).replace(/\s*\(.*$/, '');
  const enLine = (e.line_en || (e.line && !/[^\x00-\x7f]/.test(e.line) ? e.line : '') || (e.name_en || '').replace(/\s*[\(,].*$/, '').replace(/^(Ichijo|TOTO|LIXIL|Panasonic|Housetec)\s+/i, '')).replace(/\s*\(.*$/, '').trim();
  let size = '';
  if (e.category === 'unit_bath' && e.size_code) size = e.size_code;
  else if (e.category === 'interior_door' && e.height_mm) size = 'H' + e.height_mm.toLocaleString('en-US');
  else if (e.width_mm) size = (e.category === 'shower' && e.depth_mm ? e.width_mm + '×' + e.depth_mm : 'W' + e.width_mm.toLocaleString('en-US'));
  if (e.category === 'toilet' && e.size_code) size = e.size_code;
  const model = e.category === 'toilet' ? (e.name_en || '').replace(/^.*?(TOTO|LIXIL|Panasonic)\s*/i, '').replace(/\s*\(.*$/, '').slice(0, 28) : '';
  const lay = e.category === 'kitchen' && e.layout && !noLayout ? ' ' + LAYOUT[lang][e.layout] : '';
  const mk = ja ? MAKER_JA[e.maker] || e.maker : MAKER_EN[e.maker] || e.maker;
  let line = ja ? jaLine : (enLine + (jaLine && jaLine !== enLine && /[^\x00-\x7f]/.test(jaLine) && !short ? ' (' + jaLine + ')' : ''));
  if (e.category === 'toilet') line = ja ? (e.name_ja || line) : (model || line);
  const tag = e.provisional ? (ja ? ' ［仮］' : ' [provisional]') : '';
  const list = /^list/.test(e.price_basis || '');                 /* maker list price, not an Ichijo upcharge */
  const price = e.standard ? (ja ? ' 標準' : ' std') : (e.price_jpy_low ? (list ? (ja ? ' 定価¥' : ' list ¥') + Math.round(e.price_jpy_low).toLocaleString('en-US') : ' ' + yen(e.price_jpy_low)) : '');
  return (mk + ' ' + line + ' ' + size + lay).replace(/\s+/g, ' ').trim() + price + tag;
}
export const STR = {
  ja: {
    title: '一条仕様 / Ichijo spec', show: '一条仕様', hide: '閉じる',
    heights: '高さ', h1: '1階天井', gym: 'ジム床を下げる（土間）', fl2: '2階床', h2: '2階天井',
    slope: '屋根・勾配天井（リビング）', view: '屋根の高い側', depth: '奥行', pitch: '勾配', area: '面積',
    sides: { e: 'リビング棟の端（キッチン側へ下る）', n: 'カーポート側', s: '大開口側（羊蹄山側）', w: '西側' },
    ceil: (lo, hi) => 'リビングの天井高 ' + lo.toFixed(2) + 'm（勾配の始まり）〜 ' + hi.toFixed(2) + 'm（ガラス側）・2階床から',
    eave: (e) => '軒の高さ ' + e.toFixed(2) + 'm（地面から）', maxH: (h) => '最高高さ ' + h.toFixed(2) + 'm（地面から）',
    sun: (p, d) => p.toFixed(1) + '寸（' + d.toFixed(1) + '°）', pitchStd: '一条標準',
    hlim: '高さ制限（低層住居専用地域）', hlOver: (h, l) => '最高高さ ' + h.toFixed(2) + 'm ＞ 制限（' + (h - l).toFixed(2) + 'm 超過）', hlOk: (h) => '最高高さ ' + h.toFixed(2) + 'm ≤ 制限',
    north: (N) => '北側斜線' + (N.ok ? ' OK' : ' ' + (-N.margin).toFixed(2) + 'm 超過') + '：屋根の北端 ' + N.h.toFixed(2) + 'm ' + (N.ok ? '≤' : '＞') + ' ' + N.lim.toFixed(2) + 'm（' + N.base + 'm＋' + N.per + '×' + N.dist.toFixed(2) + 'm）',
    south: (S) => '南面（眺望側）のガラス ' + S.glass.toFixed(1) + '㎡・南面の壁（床〜平天井）の' + Math.round(S.pct) + '%',
    viewFix: '眺望側（南）の壁の前には置けない',
    slopeNote: '勾配天井の価格はカタログでは4坪（13.2㎡）まで・22㎡は要確認',
    areaRead: (a, m) => a.toFixed(1) + ' / ' + m + ' m²',
    dirs: { n: '北', s: '南', e: '東', w: '西' },
    windows: '窓（高さ最大2.2m）', maxW: '最大幅', transomNote: '欄間窓（0.3×1.8 m）は久坂氏の口頭説明のみ・カタログ未掲載', schedule: '窓リスト', transom: '欄間', noRoom: '天井が低く不可',
    winRow: (w) => w.n > 1 ? w.n + '枚 × ' + Math.round(w.unitW * 1000) + '（方立100）' : Math.round(w.unitW * 1000) + '',
    fittings: '設備', kitchen: 'キッチン', layout: '型', ub: 'ユニットバス／シャワー', vanity: '洗面化粧台', toilet: 'トイレ', door: '室内ドアの高さ', allDoors: 'すべての室内ドア',
    hinoki: 'ひのき浴槽（図面どおり・造作）', showerOnly: 'シャワーユニット', cupboard: 'カップボード', summary: 'カタログ適合',
    fitRules: '判定：シャワーユニットはメーカーの据付寸法（未公表なら本体＋各辺50mm）、ユニットバスは本体＋各辺150mm。バスルームは奥からユニット・トイレ（幅0.8m、便器0.38×0.76m＝TOTO ZJ2）・洗面化粧台を一列に並べ、それぞれの前に0.6m以上の立つスペース。ドアの開き・出入り口は設備に当たらないこと、ユニットは窓の前に置かない。トイレ室は便器＋前0.6m×幅0.8m。',
    doorFix: (c, id) => 'ドア' + (id ? '（' + id + '）' : '') + 'の開き・出入りに当たる：ドアか設備を' + c + 'cm 移動', winFix: (c, id) => '窓' + (id ? '（' + id + '）' : '') + 'の前：窓を' + c + 'cm 移動',
    FITS: '収まる', NEEDS: (c) => '+' + c + 'cm 必要', NO: '収まらない', CUSTOM: '造作', MODEL: '機種のみ', INFO: '',
    fix: (c, t) => t + 'を' + c + 'cm 広げる', sideWall: (d, n) => d + '側の壁' + (n ? '（' + n + '側）' : ''), sideExt: (d) => d + '側の外壁', sideDiv: (d, n) => d + '側の境界' + (n ? '（' + n + '・壁なし）' : '（壁なし）'), sideOpen: (d) => d + '側',
    inner: '内法', need: '必要', drawn: '図面', ichijo: '一条', units: '枚', head: '上端', prov: '［仮］はカタログ未確認の暫定値',
    col: { fit: '設備', room: '部屋', inner: '内法', set: '機種', verdict: '判定' },
    roomCol: '部屋', winCol: '窓', drawnCol: '図面 幅×高', ichijoCol: '一条', trCol: '欄間',
  },
  en: {
    title: '一条仕様 / Ichijo spec', show: 'Ichijo spec', hide: 'Close',
    heights: 'HEIGHTS', h1: '1F ceiling', gym: 'Gym floor sunk (slab)', fl2: '2F floor', h2: '2F ceiling',
    slope: 'ROOF · SLOPED CEILING (LIVING)', view: 'Roof high side', depth: 'Depth', pitch: 'Pitch', area: 'Area',
    sides: { e: 'Living-wing end (slopes down to the kitchen)', n: 'Carport side', s: 'Big-glass side (Mt Yotei)', w: 'West side' },
    ceil: (lo, hi) => 'Living ceiling ' + lo.toFixed(2) + ' m at the zone edge → ' + hi.toFixed(2) + ' m at the glass (above the 2F floor)',
    eave: (e) => 'Eave ' + e.toFixed(2) + ' m above ground', maxH: (h) => 'Max height ' + h.toFixed(2) + ' m above ground',
    sun: (p, d) => p.toFixed(1) + ' sun (' + d.toFixed(1) + '°)', pitchStd: 'Ichijo std',
    hlim: 'Height limit (low-rise zone)', hlOver: (h, l) => 'Max height ' + h.toFixed(2) + ' m > limit (+' + (h - l).toFixed(2) + ' m)', hlOk: (h) => 'Max height ' + h.toFixed(2) + ' m ≤ limit',
    north: (N) => 'North-side slope: ' + (N.ok ? 'OK' : 'exceeded by ' + (-N.margin).toFixed(2) + ' m') + ' — roof\u2019s north edge ' + N.h.toFixed(2) + ' m ' + (N.ok ? '≤' : '>') + ' ' + N.lim.toFixed(2) + ' m (' + N.base + ' + ' + N.per + ' × ' + N.dist.toFixed(2) + ' m)',
    south: (S) => 'South (view) glass ' + S.glass.toFixed(1) + ' m² · ' + Math.round(S.pct) + '% of the south walls (floor to flat ceiling)',
    viewFix: 'not in front of the view (south) wall',
    slopeNote: 'Sloped-ceiling price in the sheet covers up to 4 tsubo (13.2 m²); 22 m² needs a quote',
    areaRead: (a, m) => a.toFixed(1) + ' / ' + m + ' m²',
    dirs: { n: 'N', s: 'S', e: 'E', w: 'W' },
    windows: 'WINDOWS (max 2.2 m tall)', maxW: 'Max width', transomNote: 'Transom (0.3 × 1.8 m) per Hisasaka verbally — not in the catalogue, confirm in writing', schedule: 'Window schedule', transom: 'Transom', noRoom: 'ceiling too low',
    winRow: (w) => w.n > 1 ? w.n + ' × ' + Math.round(w.unitW * 1000) + ' (100 mullions)' : Math.round(w.unitW * 1000) + '',
    fittings: 'FITTINGS', kitchen: 'Kitchen', layout: 'Layout', ub: 'Unit bath / shower', vanity: 'Vanity', toilet: 'Toilet', door: 'Interior door height', allDoors: 'all interior doors',
    hinoki: 'Hinoki tubs as drawn (custom)', showerOnly: 'Unit shower', cupboard: 'Cupboard', summary: 'CATALOGUE FIT',
    fitRules: 'Fit rules: unit shower = the maker\u2019s installation space where published, else its size + 50 mm per side; unit bath = size + 150 mm per side. Bathrooms: from the far end the unit, a 0.8 m toilet zone (toilet 0.38 × 0.76 m, TOTO ZJ2), the vanity, in a line along one wall, with ≥ 0.6 m standing space in front of each; door swing and entry clear of the fittings; no unit in front of a window. WC: toilet + 0.6 m in front, 0.8 m wide.',
    doorFix: (c, id) => 'clear of door ' + (id || '') + ': move the door or the fitting ' + c + ' cm', winFix: (c, id) => 'in front of window ' + (id || '') + ': move the window ' + c + ' cm',
    FITS: 'FITS', NEEDS: (c) => 'NEEDS +' + c + ' cm', NO: 'NO', CUSTOM: 'CUSTOM', MODEL: 'model only', INFO: '',
    fix: (c, t) => 'move ' + t + ' out ' + c + ' cm', sideWall: (d, n) => 'the ' + d + ' wall' + (n ? ' (' + n + ')' : ''), sideExt: (d) => 'the ' + d + ' outside wall', sideDiv: (d, n) => 'the open ' + d + ' side' + (n ? ' (' + n + ', no wall)' : ''), sideOpen: (d) => 'the ' + d + ' side',
    inner: 'clear', need: 'needs', drawn: 'drawn', ichijo: 'Ichijo', units: 'units', head: 'head', prov: '[provisional] = not yet confirmed by a catalogue',
    col: { fit: 'Fitting', room: 'Room', inner: 'Clear', set: 'Set', verdict: 'Verdict' },
    roomCol: 'Room', winCol: 'Window', drawnCol: 'Drawn W×H', ichijoCol: 'Ichijo', trCol: 'Transom',
  },
};
export function verdictText(f, lang) {
  const T = STR[lang];
  if (f.verdict === 'NEEDS') return T.NEEDS(Math.max(...f.shorts.map(s => s.cm)));
  return typeof T[f.verdict] === 'function' ? T[f.verdict](0) : (T[f.verdict] || f.verdict);
}
export function fixText(f, lang) {
  if (!f.shorts || !f.shorts.length) return '';
  const T = STR[lang];
  return f.shorts.map(s => s.view ? T.viewFix : s.door ? T.doorFix(s.cm, s.door) : s.win ? T.winFix(s.cm, s.win) : T.fix(s.cm, s.text)).join(lang === 'ja' ? '、' : '; ');
}

/* ------------------------------------------------------------- panel (DOM, both pages) */
const CSS = `
.ichp{position:fixed;z-index:15;background:rgba(17,22,28,.94);backdrop-filter:blur(8px);border:1px solid #2c3a4a;border-radius:12px;color:#e8eef5;
  font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Hiragino Sans","Noto Sans JP",sans-serif;width:340px;max-height:calc(100vh - 80px);overflow:auto;padding:8px 10px;
  -webkit-user-select:none;user-select:none}
.ichp[hidden]{display:none}
.ichp h4{margin:2px 0 6px;font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:6px}
.ichp h5{margin:9px 0 3px;font-size:10px;letter-spacing:.06em;opacity:.65;font-weight:600}
.ichp .row{display:flex;align-items:center;gap:6px;margin:3px 0;flex-wrap:wrap}
.ichp .row>label{flex:1;min-width:92px;opacity:.85}
.ichp .rd{font-size:11px;opacity:.9;margin:2px 0}
.ichp .rd b{color:#ffd58a;font-weight:600}
.ichp select,.ichp input[type=number]{background:#1b2430;color:#e8eef5;border:1px solid #2c3a4a;border-radius:7px;padding:3px 5px;font:inherit;max-width:100%}
.ichp select{width:100%}
.ichp input[type=range]{width:120px;accent-color:#5ac8fa}
.ichp input[type=number]{width:64px}
.ichp button{background:#1b2430;color:#e8eef5;border:1px solid #2c3a4a;border-radius:7px;padding:3px 8px;font:inherit;cursor:pointer}
.ichp .fit{border-top:1px solid #253141;padding:5px 0 3px;margin-top:4px}
.ichp .fit .t{display:flex;justify-content:space-between;gap:6px;align-items:baseline}
.ichp .fit .t span:first-child{font-weight:600}
.ichp .bd{font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px;white-space:nowrap}
.ichp .FITS{background:#123d27;color:#8ff0b5;border:1px solid #2a7a4c}.ichp .NEEDS{background:#3d3110;color:#ffd58a;border:1px solid #7a6020}
.ichp .NO{background:#46161a;color:#ff9da3;border:1px solid #8a2a31}.ichp .CUSTOM,.ichp .MODEL{background:#1d2a3a;color:#9fc7ea;border:1px solid #2f4a66}
.ichp .fx{font-size:10.5px;opacity:.8;margin-top:2px}
.ichp table{border-collapse:collapse;width:100%;font-size:10.5px;margin-top:3px}
.ichp td,.ichp th{border-bottom:1px solid #253141;padding:2px 3px;text-align:left;vertical-align:top}
.ichp th{opacity:.6;font-weight:600}
.ichp .thumb{height:34px;border-radius:4px;background:#fff;margin-left:4px;vertical-align:middle}
.ichp details summary{cursor:pointer;opacity:.8;margin:3px 0}
.ichp .note{font-size:10px;opacity:.55;margin-top:6px}
.ichp .hlflag.over{color:#ff6b6b;font-weight:600}
.ichp .row.pitch{margin-bottom:12px}
.ichp .note.pnote{margin:-4px 0 4px}
.ichp .pw{position:relative;display:inline-flex}
.ichp .pw input{margin:2px}
.ichp .pw .std{position:absolute;top:100%;margin-top:1px;transform:translateX(-50%);font-size:9.5px;line-height:1;opacity:.75;white-space:nowrap;pointer-events:none}
.ichp .pw .std::before{content:'';position:absolute;left:50%;top:-4px;height:3px;border-left:1px solid currentColor}
@media (max-width:640px){.ichp{width:auto;left:6px!important;right:6px!important;max-height:52vh}}
`;
export function mountPanel(host, o) {
  /* o = { model() -> current model, cat, lang() -> 'ja'|'en', info() -> info, change(fn(m)), place(el) } */
  if (!document.getElementById('ichp-css')) { const s = document.createElement('style'); s.id = 'ichp-css'; s.textContent = CSS; document.head.appendChild(s); }
  const el = document.createElement('div');
  el.className = 'ichp'; el.id = 'ichijoPanel';
  host.appendChild(el);
  const E = (tag, attrs, kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn); else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v); }
    for (const c of kids || []) if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
  };
  const stop = (e) => e.stopPropagation();
  el.addEventListener('keydown', stop); el.addEventListener('pointerdown', stop); el.addEventListener('wheel', stop, { passive: true });
  let openDetails = new Set();
  let timer = 0;
  const set = (fn, live) => {
    if (live) { clearTimeout(timer); timer = setTimeout(() => o.change(fn), 220); }
    else o.change(fn);
  };
  function select(opts, val, fn) {
    const s = E('select', { on: { change: () => fn(s.value) } });
    let grp = null;
    for (const [v, t, g] of opts) {
      if (g && (!grp || grp.label !== g)) { grp = E('optgroup', { label: g }); s.appendChild(grp); }
      const op = E('option', { value: v, text: t }); if (String(v) === String(val)) op.selected = true;
      (g ? grp : s).appendChild(op);
    }
    return s;
  }
  const byMaker = (list, lang, pre) => list.map(e => [e.id, (pre || '') + catLabel(e, lang), (lang === 'ja' ? MAKER_JA : MAKER_EN)[e.maker] || e.maker]);
  function render() {
    const lang = o.lang(), T = STR[lang], M = o.model(), I = opts(M), info = o.info(), cat = o.cat;
    for (const d of el.querySelectorAll('details')) if (d.open) openDetails.add(d.dataset.k); else openDetails.delete(d.dataset.k);
    const sc = el.scrollTop;
    el.innerHTML = '';
    el.appendChild(E('h4', {}, [E('span', { text: T.title }), o.closeBtn ? E('button', { text: '×', on: { click: o.closeBtn } }) : null]));
    /* heights */
    el.appendChild(E('h5', { text: T.heights }));
    const H = info.heights;
    el.appendChild(E('div', { class: 'rd', html: T.h1 + ' <b>' + H.h1.toFixed(2) + ' m</b> · ' + T.fl2 + ' <b>' + H.fl2.toFixed(2) + ' m</b> · ' + T.h2 + ' <b>' + H.h2.toFixed(2) + ' m</b>' }));
    const cb = E('input', { type: 'checkbox', id: 'ichGym' }); cb.checked = !!I.gymSunken;
    cb.addEventListener('change', () => set(m => { m.ichijo.gymSunken = cb.checked; }));
    el.appendChild(E('div', { class: 'row' }, [cb, E('label', { for: 'ichGym', text: T.gym + ' −' + I.gymDrop.toFixed(2) + ' m → ' + H.gym.toFixed(2) + ' m' })]));
    /* roof + sloped zone */
    const Z = info.zone, RF = info.roof;
    if (Z) {
      el.appendChild(E('h5', { text: T.slope }));
      el.appendChild(E('div', { class: 'row' }, [E('label', { text: T.view }), select(Z.avail.map(s => [s, T.sides[s] || T.dirs[s]]), Z.view, (v) => set(m => { m.ichijo.view = v; }))]));
      const dIn = E('input', { type: 'range', min: '0.5', max: String(Math.max(0.6, Z.maxDepth).toFixed(2)), step: '0.05', value: String(Math.min(I.slopeDepth > 0 ? I.slopeDepth : Z.maxDepth, Z.maxDepth)) });
      const dV = E('b', { text: Z.depth.toFixed(2) + ' m' });
      dIn.addEventListener('input', () => { dV.textContent = (+dIn.value).toFixed(2) + ' m'; set(m => { m.ichijo.slopeDepth = +dIn.value; }, true); });
      el.appendChild(E('div', { class: 'row' }, [E('label', { text: T.depth }), dIn, dV]));
      el.appendChild(E('div', { class: 'rd', html: T.area + ' <b>' + T.areaRead(Z.area, I.slopeMaxArea) + '</b>' }));
      const pIn = E('input', { type: 'range', min: '1', max: '6', step: '0.5', value: String(I.pitch) });
      const pV = E('b', { text: T.sun(I.pitch, Z.pitchDeg) });
      pIn.addEventListener('input', () => { pV.textContent = T.sun(+pIn.value, Math.atan(+pIn.value / 10) * 180 / Math.PI); set(m => { m.ichijo.pitch = +pIn.value; }, true); });
      /* 3.5 sun = Ichijo standard (its sheet: 3.5寸 roof materials only): marked + labelled under the slider */
      const fr = (PITCH_STD - +pIn.min) / (+pIn.max - +pIn.min);
      const std = E('span', { class: 'std', text: T.pitchStd, style: 'left:calc(10px + (100% - 20px) * ' + fr.toFixed(4) + ')' });
      el.appendChild(E('div', { class: 'row pitch' }, [E('label', { text: T.pitch }), E('span', { class: 'pw' }, [pIn, std]), pV]));
      /* v21: the model's caveat about its pitch (a string, or { en, ja }) as a small grey line under the slider */
      const pn = M.ichijo && M.ichijo.pitchNote, pnText = pn && (typeof pn === 'string' ? pn : (pn[lang] || pn.en || ''));
      if (pnText) el.appendChild(E('div', { class: 'note pnote', text: pnText }));
      el.appendChild(E('div', { class: 'rd ceil', html: '<b>' + T.ceil(Z.low, Z.high) + '</b>' }));
      if (RF) {
        el.appendChild(E('div', { class: 'rd eave', html: '<b>' + T.eave(RF.eave) + '</b>' }));
        el.appendChild(E('div', { class: 'rd maxh', html: '<b>' + T.maxH(RF.maxH) + '</b>' }));
        /* zoning: the roof's highest point against heightLimit, to the cm shown */
        const hl = E('input', { type: 'number', class: 'hlim', min: '1', max: '60', step: '0.5', value: String(I.heightLimit) });
        hl.addEventListener('change', () => { const v = +hl.value; if (v > 0) set(m => { m.ichijo.heightLimit = v; }); });
        el.appendChild(E('div', { class: 'row' }, [E('label', { text: T.hlim }), hl, 'm']));
        const over = Math.round(RF.maxH * 100) > Math.round(I.heightLimit * 100);
        el.appendChild(E('div', { class: 'rd hlflag' + (over ? ' over' : ''), text: over ? T.hlOver(RF.maxH, I.heightLimit) : T.hlOk(RF.maxH) }));
        if (RF.north) el.appendChild(E('div', { class: 'rd hlflag north' + (RF.north.ok ? '' : ' over'), text: T.north(RF.north) }));
      }
      el.appendChild(E('div', { class: 'note', text: T.slopeNote }));
    }
    /* windows */
    el.appendChild(E('h5', { text: T.windows }));
    if (info.south && info.south.wall > 0) el.appendChild(E('div', { class: 'rd south', html: '<b>' + T.south(info.south) + '</b>' }));
    const mw = E('input', { type: 'number', min: '0.6', max: '6', step: '0.1', value: String(I.maxWindowW) });
    mw.addEventListener('change', () => { const v = +mw.value; if (v >= 0.6) set(m => { m.ichijo.maxWindowW = v; }); });
    el.appendChild(E('div', { class: 'row' }, [E('label', { text: T.maxW + ' (m)' }), mw]));
    const det = E('details', { 'data-k': 'win' });
    if (openDetails.has('win')) det.open = true;
    det.appendChild(E('summary', { text: T.schedule + ' (' + info.windows.length + ')' }));
    const tb = E('table');
    tb.appendChild(E('tr', {}, [E('th', { text: T.winCol }), E('th', { text: T.roomCol }), E('th', { text: T.drawnCol }), E('th', { text: T.ichijoCol }), E('th', { text: T.trCol })]));
    for (const w of info.windows) {
      const tcb = E('input', { type: 'checkbox' });
      tcb.checked = w.transomOn && w.transomFits; tcb.disabled = !w.transomFits;
      tcb.title = w.transomFits ? T.transom : T.noRoom;
      tcb.addEventListener('change', () => set(m => { m.ichijo.transom = m.ichijo.transom || {}; if (tcb.checked) delete m.ichijo.transom[w.id]; else m.ichijo.transom[w.id] = false; }));
      tb.appendChild(E('tr', {}, [
        E('td', { text: (['1F', '2F'][w.level] || '') + ' ' + T.dirs[w.dir] + ' ' + w.src }),
        E('td', { text: w.room ? (lang === 'ja' ? w.room.ja : w.room.name) : '' }),
        E('td', { text: Math.round(w.drawn.w * 1000) + '×' + Math.round((w.drawn.head - w.drawn.sill) * 1000) }),
        E('td', { text: T.winRow(w) + ' × ' + Math.round((w.head - w.drawn.sill) * 1000) }),
        E('td', {}, [tcb, w.transomFits ? ' ' + w.transoms + '/' + w.n : ' –']),
      ]));
    }
    det.appendChild(tb);
    el.appendChild(det);
    el.appendChild(E('div', { class: 'note', text: T.transomNote }));
    /* fittings: one block per room */
    el.appendChild(E('h5', { text: T.fittings }));
    const rooms = M.levels.flatMap((L, li) => (L.rooms || []).filter(r => r.fit).map(r => ({ r, li })));
    const setFit = (rid, key, v) => set(m => { for (const L of m.levels) for (const r of L.rooms || []) if (r.id === rid) { r.fit[key] = v; if (key === 'layout') { const it = pickItem(cat, r.fit.kitchen, 'kitchen'); if (it && ((v === 'I') !== (it.layout === 'I'))) { const alt = listOf(cat, 'kitchen', e => v === 'I' ? e.layout === 'I' : e.layout === 'peninsula' || e.layout === 'island'); const best = alt.filter(e => e.maker === it.maker).sort((a, b) => Math.abs(a.width_mm - it.width_mm) - Math.abs(b.width_mm - it.width_mm))[0] || alt[0]; if (best) r.fit.kitchen = best.id; } } } });
    const badge = (f) => f ? E('span', { class: 'bd ' + f.verdict, text: verdictText(f, lang) }) : null;
    const thumb = (id) => { const e = cat.byId.get(id); return e && e.img ? E('img', { class: 'thumb', src: e.img, alt: '' }) : null; };
    for (const { r, li } of rooms) {
      const fits = info.fits.filter(f => f.roomId === r.id);
      const box = E('div', { class: 'fit' });
      box.appendChild(E('div', { class: 't' }, [E('span', { text: (['1F', '2F'][li]) + ' ' + nm(r, lang) }), E('span', { class: 'fx', text: T.inner + ' ' + (fits[0] ? fits[0].inner.map(v => v.toFixed(2)).join(' × ') + ' m' : '') })]));
      if (r.fit.kitchen !== undefined) {
        const f = fits.find(x => x.fit === 'kitchen');
        const lay = r.fit.layout || 'peninsula';
        box.appendChild(E('div', { class: 'row' }, [E('label', { text: T.layout }), select([['I', LAYOUT[lang].I], ['peninsula', LAYOUT[lang].peninsula], ['island', LAYOUT[lang].island]], lay, v => setFit(r.id, 'layout', v)), badge(f)]));
        const list = listOf(cat, 'kitchen', e => lay === 'I' ? e.layout === 'I' : e.layout === 'peninsula' || e.layout === 'island');
        box.appendChild(E('div', { class: 'row' }, [select(byMaker(list, lang), f ? f.set : r.fit.kitchen, v => setFit(r.id, 'kitchen', v)), thumb(f && f.set)]));
        if (f && f.shorts.length) box.appendChild(E('div', { class: 'fx', text: fixText(f, lang) }));
      }
      if (r.fit.ub !== undefined) {
        const f = fits.find(x => x.fit === 'ub');
        const list = [];
        if (r.fit.ub === 'hinoki' || /bath$/i.test(r.name) && li === 0) list.push(['hinoki', T.hinoki]);
        list.push(...byMaker(listOf(cat, 'unit_bath'), lang));
        list.push(...byMaker(listOf(cat, 'shower'), lang, T.showerOnly + ' · ').map(x => [x[0], x[1], T.showerOnly]));
        box.appendChild(E('div', { class: 'row' }, [E('label', { text: T.ub }), badge(f)]));
        box.appendChild(E('div', { class: 'row' }, [select(list, r.fit.ub === 'hinoki' ? 'hinoki' : (f ? f.set : r.fit.ub), v => setFit(r.id, 'ub', v)), thumb(f && f.set)]));
        if (f && f.shorts.length) box.appendChild(E('div', { class: 'fx', text: fixText(f, lang) }));
      }
      if (r.fit.vanity !== undefined) {
        const f = fits.find(x => x.fit === 'vanity');
        box.appendChild(E('div', { class: 'row' }, [E('label', { text: T.vanity }), badge(f)]));
        box.appendChild(E('div', { class: 'row' }, [select(byMaker(listOf(cat, 'vanity'), lang), f ? f.set : r.fit.vanity, v => setFit(r.id, 'vanity', v)), thumb(f && f.set)]));
        if (f && f.shorts.length) box.appendChild(E('div', { class: 'fx', text: fixText(f, lang) }));
      }
      if (r.fit.toilet !== undefined) {
        const f = fits.find(x => x.fit === 'toilet');
        box.appendChild(E('div', { class: 'row' }, [E('label', { text: T.toilet }), badge(f)]));
        box.appendChild(E('div', { class: 'row' }, [select(byMaker(listOf(cat, 'toilet'), lang), f ? f.set : r.fit.toilet, v => setFit(r.id, 'toilet', v))]));
        if (f && f.shorts.length) box.appendChild(E('div', { class: 'fx', text: fixText(f, lang) }));
      }
      el.appendChild(box);
    }
    el.appendChild(E('div', { class: 'note fitrules', text: T.fitRules }));
    /* interior doors */
    const doors = [];
    const seenH = new Set();
    for (const e of listOf(cat, 'interior_door')) {
      const h = e.height_mm || 0;
      if (seenH.has(h)) continue;
      seenH.add(h);
      doors.push([e.id, (h ? h.toLocaleString('en-US') + ' mm · ' : '') + catLabel(e, lang).replace(/\sH[\d,]+/, '')]);
    }
    if (doors.length) {
      const box = E('div', { class: 'fit' });
      box.appendChild(E('div', { class: 'row' }, [E('label', { text: T.door + ' (' + T.allDoors + ')' })]));
      const cur = doors.find(d => d[0] === I.door) ? I.door : (doors.find(d => { const e = cat.byId.get(d[0]); const c = cat.byId.get(I.door); return e && c && e.height_mm === c.height_mm; }) || doors[0])[0];
      box.appendChild(E('div', { class: 'row' }, [select(doors, cur, v => set(m => { m.ichijo.door = v; }))]));
      el.appendChild(box);
    }
    /* catalogue fit summary */
    el.appendChild(E('h5', { text: T.summary }));
    const st = E('table');
    st.appendChild(E('tr', {}, [E('th', { text: T.col.fit }), E('th', { text: T.col.room }), E('th', { text: T.col.inner }), E('th', { text: T.col.verdict })]));
    for (const f of info.fits) {
      if (f.verdict === 'MODEL') continue;
      st.appendChild(E('tr', {}, [E('td', { text: T[f.fit] || f.fit }), E('td', { text: nm(f.room, lang) }), E('td', { text: f.inner.map(v => v.toFixed(2)).join('×') }),
        E('td', {}, [badge(f), f.shorts.length ? E('div', { class: 'fx', text: fixText(f, lang) }) : null])]));
    }
    el.appendChild(st);
    if (cat.items.some(e => e.provisional)) el.appendChild(E('div', { class: 'note', text: T.prov }));
    el.scrollTop = sc;
  }
  return { el, render, show(v) { el.hidden = !v; } };
}
