/* Reference-house model -> walkthrough plan.
   Shared by the 3D page (app.js, ?house=3) and the plan editor (edit.html).

   MODEL (ref-model.json; metres, x east, y SOUTH, like Floor Plan Creator):
   levels[] { id, name, base, h (clear height), ct (floor build-up above it),
     walls[] { id, a:[x,y], b:[x,y], t, off?, h? (low wall: height), ops?[] }
        a wall is its reference (grid) line a->b; its body is t thick, shifted
        `off` along the line's normal (-dy, dx); t = 0 = room divider (no wall,
        it only splits rooms: an entrance step, a stair foot)
        ops[] { id, type: window|door|double|sliding|slide|entry|hole, at
          (start, metres from a along a->b), w, sill, head (from the floor), leaves? }
     rooms[] { id, name, ja, at:[x,y], floor: oak|tile|stone|concrete|void, dz? }
        a room is the region the walls close round its `at` point
     items[] { id, kind, x, y, w, d, a, ... } }
   stairs[] { id, from (level index), treads[] (polygons, bottom step first) }
   roofs[] { id, levels[], rect:[x0,y0,x1,y1], over{n,s,e,w}, y0, h0, k, th, low:'s', posts? }
   wallsUp? (opt-in): partitions with no floor above run up to the floor above / the roof

   Rooms are not stored as outlines: they are the faces of the planar graph of
   the walls' reference lines, so moving a wall reshapes every room it bounds. */
'use strict';

const TOL = 1e-3;
export const OP_KIND = { window: 'WINDOW', door: 'DOOR', double: 'DOUBLE_DOOR', sliding: 'SLIDING_HUNG_DOOR', slide: 'DOUBLE_DOOR', entry: 'DOOR', hole: 'HOLE' };

/* ------------------------------------------------------------- 2D helpers */
const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const mul = (p, s) => [p[0] * s, p[1] * s];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
const cross = (p, q) => p[0] * q[1] - p[1] * q[0];
const len = (p) => Math.hypot(p[0], p[1]);
const near = (p, q, t) => Math.abs(p[0] - q[0]) <= (t || TOL) && Math.abs(p[1] - q[1]) <= (t || TOL);
export function polyArea(P) {           /* signed, shoelace (y down: clockwise on screen > 0) */
  let a = 0;
  for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
export function inPoly(P, x, y) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function centroid(P) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < P.length; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % P.length], k = x0 * y1 - x1 * y0;
    a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
  }
  if (Math.abs(a) < 1e-12) return P[0].slice();
  return [cx / (3 * a), cy / (3 * a)];
}
/* a point well inside a polygon (for labels): the centroid if it is inside,
   else the middle of the widest horizontal chord through the centroid's height */
export function labelPoint(P, holes) {
  const c = centroid(P);
  const ok = (x, y) => inPoly(P, x, y) && !(holes || []).some(h => inPoly(h, x, y));
  if (ok(c[0], c[1])) return c;
  let best = null;
  const ys = P.map(p => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let k = 1; k < 20; k++) {
    const y = y0 + (y1 - y0) * k / 20, xs = [];
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length];
      if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i], m = (xs[i] + xs[i + 1]) / 2;
      if ((!best || w > best.w) && ok(m, y)) best = { w, p: [m, y] };
    }
  }
  return best ? best.p : c;
}

/* ----------------------------------------------------------- planar graph */
/* Split every reference line at every other line's end point lying on it and
   at proper crossings; return vertices + undirected edges (wall index kept). */
function buildGraph(walls) {
  const V = [], E = [];
  const vid = (p) => {
    for (let i = 0; i < V.length; i++) if (near(V[i], p, 2e-3)) return i;
    V.push([p[0], p[1]]); return V.length - 1;
  };
  const segs = walls.map((w, i) => ({ i, a: w.a, b: w.b })).filter(s => len(sub(s.b, s.a)) > 0.005);
  for (const s of segs) {
    const d = sub(s.b, s.a), L = len(d), u = mul(d, 1 / L);
    const cuts = [0, L];
    for (const o of segs) {
      if (o === s) continue;
      for (const p of [o.a, o.b]) {                       /* end point on this line */
        const r = sub(p, s.a), t = dot(r, u), off = Math.abs(cross(u, r));
        if (off < 2e-3 && t > 2e-3 && t < L - 2e-3) cuts.push(t);
      }
      const e = sub(o.b, o.a), den = cross(d, e);       /* proper crossing */
      if (Math.abs(den) > 1e-9) {
        const r = sub(o.a, s.a), t = cross(r, e) / den, v = cross(r, d) / den;
        if (t > 1e-4 && t < 1 - 1e-4 && v > 1e-4 && v < 1 - 1e-4) cuts.push(t * L);
      }
    }
    cuts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < cuts.length; k++) {
      if (cuts[k + 1] - cuts[k] < 2e-3) continue;
      const p = add(s.a, mul(u, cuts[k])), q = add(s.a, mul(u, cuts[k + 1]));
      const va = vid(p), vb = vid(q);
      if (va === vb) continue;
      if (E.some(e => (e.v[0] === va && e.v[1] === vb) || (e.v[0] === vb && e.v[1] === va))) continue;   /* overlapping walls: keep one */
      E.push({ v: [va, vb], wall: s.i, s0: cuts[k], s1: cuts[k + 1] });
    }
  }
  return { V, E };
}
/* faces of the planar graph: half-edges, next = the most clockwise turn */
function buildFaces(V, E) {
  const H = [];                                     /* half-edges */
  E.forEach((e, k) => { H.push({ from: e.v[0], to: e.v[1], e: k, dir: 1 }); H.push({ from: e.v[1], to: e.v[0], e: k, dir: -1 }); });
  H.forEach((h, k) => { h.twin = k ^ 1; const d = sub(V[h.to], V[h.from]); h.ang = Math.atan2(d[1], d[0]); });
  const out = V.map(() => []);
  H.forEach((h, k) => out[h.from].push(k));
  for (const o of out) o.sort((p, q) => H[p].ang - H[q].ang);
  /* arriving along h at v: the next half-edge leaves v; take the one just
     before the reversed direction in angular order -> walks faces with the
     face on the LEFT in a y-up frame = on the RIGHT on screen (y down) */
  for (let k = 0; k < H.length; k++) {
    const h = H[k], o = out[h.to], back = h.twin;
    const i = o.indexOf(back);
    H[k].next = o[(i - 1 + o.length) % o.length];
  }
  const faces = [];
  const seen = new Array(H.length).fill(false);
  for (let k = 0; k < H.length; k++) {
    if (seen[k]) continue;
    const cyc = [];
    let j = k, guard = 0;
    while (!seen[j] && guard++ < 100000) { seen[j] = true; cyc.push(j); j = H[j].next; }
    const poly = cyc.map(j => V[H[j].from]);
    const f = { he: cyc, poly, area: polyArea(poly) };
    for (const j of cyc) H[j].face = faces.length;
    faces.push(f);
  }
  return { H, faces };
}

/* every level's rooms: faces, holes, which room anchor is in which face */
export function levelGraph(L) {
  const walls = L.walls || [];
  const { V, E } = buildGraph(walls);
  const { H, faces } = buildFaces(V, E);
  /* the walk keeps each face on its left (in the coordinates as given), so
     bounded faces have positive shoelace area, each component's outside negative */
  for (const f of faces) f.bounded = f.area > 1e-6;
  /* connected components (a free-standing loop of walls inside a room is a hole in it) */
  const comp = V.map((_, i) => i);
  const find = (i) => { while (comp[i] !== i) { comp[i] = comp[comp[i]]; i = comp[i]; } return i; };
  for (const e of E) comp[find(e.v[0])] = find(e.v[1]);
  for (const f of faces) f.comp = f.he.length ? find(H[f.he[0]].from) : -1;
  const bounded = faces.filter(f => f.bounded);
  for (const f of faces) {
    if (f.bounded || f.poly.length < 3 || Math.abs(f.area) < 1e-6) continue;
    let host = null;
    for (const g of bounded) {
      if (g.comp === f.comp) continue;
      if (!f.poly.every(q => inPoly(g.poly, q[0], q[1]))) continue;
      if (!host || Math.abs(g.area) < Math.abs(host.area)) host = g;
    }
    f.host = host;
    if (host) (host.holes = host.holes || []).push(f.poly);
  }
  const rooms = [];
  for (const f of bounded) {
    f.holes = f.holes || [];
    const anchor = (L.rooms || []).find(r => inPoly(f.poly, r.at[0], r.at[1]) && !f.holes.some(h => inPoly(h, r.at[0], r.at[1])));
    f.room = anchor || null;
    f.netArea = Math.abs(f.area) - f.holes.reduce((s, h) => s + Math.abs(polyArea(h)), 0);
    rooms.push(f);
  }
  /* which face is outside: the unbounded side (or a hole's outside) */
  const isOut = (fi) => fi === undefined || !faces[fi] || (!faces[fi].bounded && !faces[fi].host);
  return { V, E, H, faces, rooms, isOut };
}
export function faceAt(G, x, y) {
  let best = null;
  for (const f of G.rooms) if (inPoly(f.poly, x, y) && !f.holes.some(h => inPoly(h, x, y))) if (!best || Math.abs(f.area) < Math.abs(best.area)) best = f;
  return best;
}

/* -------------------------------------------------------------- the walls */
/* per wall: unit direction u, normal n = (-u.y, u.x), body [q0, q1] along n */
function wallFrame(w) {
  const d = sub(w.b, w.a), L = len(d) || 1, u = mul(d, 1 / L), n = [-u[1], u[0]];
  const off = w.off || 0, t = w.t || 0;
  return { L, u, n, q0: off - t / 2, q1: off + t / 2 };
}
/* how far a body [q0,q1] along normal n reaches from point O along direction v */
function reach(fr, v) {
  const c = dot(v, fr.n);
  if (Math.abs(c) < 0.1) return null;                 /* (nearly) parallel */
  return Math.max(fr.q0 / c, fr.q1 / c);
}
/* extension (+) or trim (-) at each end of each wall, so that every corner is
   filled exactly once: a wall running through a junction (or a straight pair of
   walls meeting end to end) owns it and the others stop 1 cm inside it; at a
   corner of walls that all end there, the one ENDING (b) there owns it and runs
   on to the far face of the others. */
function joins(walls) {
  const F = walls.map(wallFrame);
  const ext = walls.map(() => [0, 0]);              /* [at a, at b]: + = extend beyond the end */
  const capEnd = walls.map(() => [false, false]);
  const solid = walls.map(w => (w.t || 0) > 0);
  const nodes = [];
  const nodeOf = (p) => { let n = nodes.find(q => near(q.p, p, 2e-3)); if (!n) { n = { p, ends: [], thru: [] }; nodes.push(n); } return n; };
  walls.forEach((w, i) => { if (!solid[i]) return; nodeOf(w.a).ends.push({ i, end: 0 }); nodeOf(w.b).ends.push({ i, end: 1 }); });
  for (const n of nodes) {
    walls.forEach((w, i) => {
      if (!solid[i]) return;
      const fr = F[i], r = sub(n.p, w.a), t = dot(r, fr.u);
      if (Math.abs(cross(fr.u, r)) < 2e-3 && t > 2e-3 && t < fr.L - 2e-3) n.thru.push(i);
    });
  }
  const awayDir = (e) => { const fr = F[e.i]; return e.end === 0 ? fr.u : mul(fr.u, -1); };
  for (const n of nodes) {
    if (!n.ends.length) continue;
    let owners = n.thru.slice();
    const ends = n.ends.slice();
    /* straight pairs that meet end to end act as one wall through the node */
    if (!owners.length) {
      for (let x = 0; x < ends.length; x++) for (let y = x + 1; y < ends.length; y++) {
        if (dot(awayDir(ends[x]), awayDir(ends[y])) < -0.999 && !owners.length) owners = [ends[x].i, ends[y].i];
      }
    }
    if (owners.length) {
      for (const e of ends) {
        if (owners.includes(e.i)) continue;
        const v = awayDir(e);
        let s = null;
        for (const o of owners) { const r = reach(F[o], v); if (r !== null) s = s === null ? r : Math.max(s, r); }
        if (s !== null) ext[e.i][e.end] = -(s - 0.01);
      }
      continue;
    }
    if (ends.length < 2) continue;                   /* a free end */
    /* a corner: the wall ending (b) here owns it; ties -> thicker, then first */
    const cand = ends.slice().sort((p, q) => (q.end - p.end) || ((walls[q.i].t || 0) - (walls[p.i].t || 0)) || (p.i - q.i));
    const own = cand[0], ov = mul(awayDir(own), -1);  /* the owner runs on past the node along ov */
    let e = 0;
    for (const x of ends) { if (x === own) continue; const r = reach(F[x.i], ov); if (r !== null) e = Math.max(e, r); }
    ext[own.i][own.end] = e;
    capEnd[own.i][own.end] = e > 0.01;
    for (const x of ends) {
      if (x === own) continue;
      const r = reach(F[own.i], awayDir(x));
      if (r !== null) ext[x.i][x.end] = -Math.max(0, r - 0.01);
    }
  }
  return { F, ext, capEnd };
}

/* ------------------------------------------------------------------ plan */
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const pt = (p) => [r4(p[0]), r4(p[1])];

export function toPlan(model) {
  const levels = model.levels || [];
  const LG = levels.map(levelGraph);
  const out = { house: 3, levels: [], stairs: [], stairs3: [], roofs: [], chimney: model.chimney ? Object.assign({}, model.chimney) : null, ground: model.ground === undefined ? -0.585 : model.ground, model };
  /* roofs marked auto sit on the outside faces of their floors' walls (so they
     follow the walls when the plan is edited); attach = start at that roof's edge */
  for (const r0 of model.roofs || []) {
    const r = JSON.parse(JSON.stringify(r0));
    if (r.auto) {
      const pts = r.levels.flatMap(li => (LG[li] ? LG[li].rooms.flatMap(f => f.poly) : []));
      if (pts.length) {
        const o = r.outer === undefined ? 0.114 : r.outer;
        r.rect = [Math.min(...pts.map(p => p[0])) - o, Math.min(...pts.map(p => p[1])) - o, Math.max(...pts.map(p => p[0])) + o, Math.max(...pts.map(p => p[1])) + o];
        r.y0 = r.low === 'n' ? r.rect[1] : r.rect[3];
      }
    }
    out.roofs.push(r);
  }
  for (const r of out.roofs) if (r.attach) { const m = out.roofs.find(q => q.id === r.attach); if (m) r.rect[0] = m.rect[2]; }
  /* the chimney stands over the wood stove */
  for (const L of levels) for (const it of L.items || []) if (it.kind === 'stove' && out.chimney) { out.chimney.x = it.x; out.chimney.y = it.y; }
  /* stair holes through the floor each flight arrives at */
  const holes = levels.map(() => []);
  for (const s of model.stairs || []) if (levels[s.from + 1]) for (const t of s.treads) holes[s.from + 1].push(t);

  const joinsUp = model.wallsUp ? levels.map((L, li) => levels[li + 1] ? joins(levels[li + 1].walls || []) : null) : [];
  levels.forEach((L, li) => {
    const G = LG[li], next = levels[li + 1];
    const wallTopExt = next ? next.base - L.base : L.h;
    const lv = { id: L.id, title: L.name, base: L.base, h: L.h, ct: L.ct, rooms: [], furniture: [], walls: [], patches: [], floors: [], faces: [] };
    /* rooms (faces) */
    G.rooms.forEach((f, k) => {
      const r = f.room || {};
      const fin = r.floor || 'oak';
      const poly = f.poly.map(pt);
      lv.rooms.push({ id: (r.id || 'f') + '_' + k, poly, area: r4(f.netArea), voids: [], furniture: [], holes: f.holes.map(h => h.map(pt)) });
      lv.faces.push({ poly, holes: f.holes.map(h => h.map(pt)), area: r4(f.netArea), name: r.name || '', ja: r.ja || '', floor: fin, dz: r.dz || 0, label: pt(r.at || labelPoint(f.poly, f.holes)), anchored: !!f.room });
      if (fin !== 'void') lv.floors.push({ poly, holes: f.holes.map(h => h.map(pt)).concat(holes[li].map(h => h.map(pt))), mat: fin, dz: r.dz || 0 });
    });
    /* walls -> runs */
    const W = L.walls || [];
    const J = joins(W);
    W.forEach((w, wi) => {
      if (!(w.t > 0)) return;
      const fr = J.F[wi];
      if (fr.L < 0.02) return;
      /* sides along the wall: sample both sides every few cm */
      const sideOut = (s, sg) => {
        const p = add(add(w.a, mul(fr.u, s)), mul(fr.n, sg * (Math.max(Math.abs(fr.q0), Math.abs(fr.q1)) + 0.03)));
        return !faceAt(G, p[0], p[1]);
      };
      const N = Math.max(4, Math.ceil(fr.L / 0.05));
      const cls = [];
      for (let k = 0; k < N; k++) {
        const s = (k + 0.5) / N * fr.L, L0 = sideOut(s, 1), R0 = sideOut(s, -1);
        cls.push(L0 && !R0 ? 1 : (R0 && !L0 ? -1 : 0));   /* +1: outside on +n, -1: on -n, 0: interior / free */
      }
      /* fill tiny gaps (junction slivers) with their neighbours */
      for (let k = 1; k + 1 < N; k++) if (cls[k] !== cls[k - 1] && cls[k - 1] === cls[k + 1]) cls[k] = cls[k - 1];
      const runs = [];
      for (let k = 0; k < N; k++) {
        const s0 = k / N * fr.L, s1 = (k + 1) / N * fr.L;
        if (runs.length && runs[runs.length - 1].c === cls[k]) runs[runs.length - 1].s1 = s1;
        else runs.push({ c: cls[k], s0, s1 });
      }
      /* snap run boundaries to the wall's junction points (where another wall meets it) */
      const juncs = [0, fr.L];
      for (const v of W) for (const p of [v.a, v.b]) {
        const r = sub(p, w.a), t = dot(r, fr.u);
        if (Math.abs(cross(fr.u, r)) < 2e-3 && t > 0 && t < fr.L) juncs.push(t);
      }
      for (let k = 1; k < runs.length; k++) {
        const b = runs[k].s0; let best = b;
        for (const j of juncs) if (Math.abs(j - b) < 0.2 && Math.abs(j - b) < Math.abs(best - b) + 1e-9) best = j;
        runs[k].s0 = best; runs[k - 1].s1 = best;
      }
      const e0 = J.ext[wi][0], e1 = J.ext[wi][1];
      for (const rf of out.roofs) {
        if (!rf.levels.includes(li)) continue;
        const [x0, y0r, x1, y1r] = rf.rect;
        const cutsAt = [];
        if (Math.abs(fr.u[0]) > 1e-6) for (const X of [x0, x1]) cutsAt.push((X - w.a[0]) / fr.u[0]);
        if (Math.abs(fr.u[1]) > 1e-6) for (const Y of [y0r, y1r]) cutsAt.push((Y - w.a[1]) / fr.u[1]);
        for (const c of cutsAt) {
          if (!(c > 0.02 && c < fr.L - 0.02)) continue;
          const k = runs.findIndex(r => c > r.s0 + 0.02 && c < r.s1 - 0.02);
          if (k < 0) continue;
          const r = runs[k];
          runs.splice(k, 1, { c: r.c, s0: r.s0, s1: c }, { c: r.c, s0: c, s1: r.s1 });
        }
      }
      /* model.wallsUp (opt-in, the revised plan): a partition with no floor
         above it on one side runs up to the floor above; with none on either
         side (rooms under a sloped ceiling) it runs on up to the roof, except
         where a wall of the floor above stands on it. Runs are split where
         that changes, at the exact lines / wall faces above. */
      if (model.wallsUp && next) {
        const GU = LG[li + 1], JN = joinsUp[li], NW = next.walls || [];
        const dq = Math.max(Math.abs(fr.q0), Math.abs(fr.q1)) + 0.05, qc = (fr.q0 + fr.q1) / 2;
        const openUp = (s, sg) => {
          const p = add(add(w.a, mul(fr.u, s)), mul(fr.n, sg * dq)), f = faceAt(GU, p[0], p[1]);
          return !f || !!(f.room && f.room.floor === 'void');
        };
        const covered = (s) => {
          const c = add(add(w.a, mul(fr.u, s)), mul(fr.n, qc));
          return NW.some((v, vi) => {
            if (!(v.t > 0)) return false;
            const f = JN.F[vi], r = sub(c, v.a), t = dot(r, f.u), q = dot(r, f.n);
            return t > -JN.ext[vi][0] + 1e-3 && t < f.L + JN.ext[vi][1] - 1e-3 && q > f.q0 + 1e-3 && q < f.q1 - 1e-3;
          });
        };
        /* where the answer can change: this floor's junctions, the floor
           above's lines crossing / ending on this one, its wall bodies' ends */
        const ju = juncs.slice();
        NW.forEach((v, vi) => {
          for (const p of [v.a, v.b]) { const r = sub(p, w.a); if (Math.abs(cross(fr.u, r)) < 2e-3) ju.push(dot(r, fr.u)); }
          const e = sub(v.b, v.a), den = cross(fr.u, e);
          if (Math.abs(den) > 1e-9) { const r = sub(v.a, w.a), tv = cross(r, fr.u) / den; if (tv > -1e-6 && tv < 1 + 1e-6) ju.push(cross(r, e) / den); }
          if (v.t > 0) {
            const f = JN.F[vi];
            for (const sv of [-JN.ext[vi][0], f.L + JN.ext[vi][1]]) for (const q of [f.q0, f.q1]) ju.push(dot(sub(add(add(v.a, mul(f.u, sv)), mul(f.n, q)), w.a), fr.u));
          }
        });
        /* a partition across a flight from this floor (at its top or foot) stays
           storey height: the stair passes over it, a raised top would be a lip */
        const across = (model.stairs || []).filter(st => st.from === li && st.treads.length > 1).map(st => {
          const cen = (t) => t.reduce((a, p) => [a[0] + p[0] / t.length, a[1] + p[1] / t.length], [0, 0]);
          const d = sub(cen(st.treads[st.treads.length - 1]), cen(st.treads[0]));
          return { u: mul(d, 1 / (len(d) || 1)), treads: st.treads };
        }).filter(st => Math.abs(dot(st.u, fr.u)) < 0.3);
        const overTread = (s) => across.some(st => st.treads.some(t => [fr.q0 + 0.005, qc, fr.q1 - 0.005].some(q => {
          const p = add(add(w.a, mul(fr.u, s)), mul(fr.n, q)); return inPoly(t, p[0], p[1]);
        })));
        const split = [];
        for (const run of runs) {
          if (run.c !== 0) { split.push(run); continue; }
          const m = Math.max(2, Math.ceil((run.s1 - run.s0) / 0.025)), cat = [];
          for (let k = 0; k < m; k++) {
            const s = run.s0 + (k + 0.5) / m * (run.s1 - run.s0);
            let c = (openUp(s, 1) ? 1 : 0) + (openUp(s, -1) ? 1 : 0);
            if (c === 2 && covered(s)) c = 1;
            if (c && overTread(s)) c = 0;
            cat.push(c);
          }
          let cur = null;
          for (let k = 0; k < m; k++) {
            const a = run.s0 + k / m * (run.s1 - run.s0), b = run.s0 + (k + 1) / m * (run.s1 - run.s0);
            if (cur && cur.up === cat[k]) { cur.s1 = b; continue; }
            let s0 = a;
            if (cur) {
              let best = null;
              for (const j of ju) if (Math.abs(j - a) < 0.04 && (best === null || Math.abs(j - a) < Math.abs(best - a))) best = j;
              if (best !== null && best > cur.s0 + 1e-3 && best < b - 1e-3) s0 = best;
              cur.s1 = s0;
            }
            cur = { c: 0, s0, s1: b, up: cat[k] };
            split.push(cur);
          }
        }
        runs.length = 0; runs.push(...split);
      }
      runs.forEach((run, ri) => {
        const first = ri === 0, last = ri === runs.length - 1;
        const sA = first ? -e0 : run.s0, sB = last ? fr.L + e1 : run.s1;
        if (sB - sA < 0.01) return;
        const ops = [];
        for (const o of w.ops || []) {
          const a0 = Math.max(o.at, sA), a1 = Math.min(o.at + o.w, sB);
          if (a1 - a0 < 0.02) continue;
          const kind = OP_KIND[o.type] || 'WINDOW';
          ops.push({ kind, off: r4(a0 - sA), w: r4(a1 - a0), top: o.head, bottom: o.sill, id: o.id, solid: (o.type === 'entry' || o.solid) ? 1 : 0, leaves: o.leaves || 0, style: o.style || '' });
        }
        /* lowest floor beside this run (a sunken entrance / porch): the wall starts there */
        let y0 = 0;
        for (const f of [0.25, 0.5, 0.75]) for (const sg of [1, -1]) {
          const s = sA + (sB - sA) * f, p = add(add(w.a, mul(fr.u, s)), mul(fr.n, sg * (Math.max(Math.abs(fr.q0), Math.abs(fr.q1)) + 0.03)));
          const fc = faceAt(G, p[0], p[1]); if (fc && fc.room && fc.room.dz) y0 = Math.min(y0, fc.room.dz);
        }
        if (run.c === 0) {
          const c = (fr.q0 + fr.q1) / 2;
          const A = add(add(w.a, mul(fr.u, sA)), mul(fr.n, c)), B = add(add(w.a, mul(fr.u, sB)), mul(fr.n, c));
          /* 1F partition with a single-storey room on one side (porch, storage):
             nothing rests on it there, so it runs up to the roof like an outside wall */
          let top = 0;
          if (model.wallsUp && next) { if (run.up === 2 && li > 0) top = r4(wallTopExt + next.h); else if (run.up) top = wallTopExt; }
          else if (li === 0 && next) {
            const GU = LG[li + 1], sm = (sA + sB) / 2;
            for (const sg of [1, -1]) {
              const p = add(add(w.a, mul(fr.u, sm)), mul(fr.n, sg * (Math.max(Math.abs(fr.q0), Math.abs(fr.q1)) + 0.05)));
              const up = faceAt(GU, p[0], p[1]);
              if (!up || (up.room && up.room.floor === 'void')) top = wallTopExt;
            }
          }
          if (w.h) top = w.h;                          /* a low wall (under a stair, a parapet) */
          lv.walls.push({ kind: 'int', a: pt(A), b: pt(B), t: r4(w.t), doors: ops, src: w.id, dz0: y0, top: top || undefined });
        } else {
          /* exterior: a-b on the INNER face, body grows along nOut by t */
          const nOut = mul(fr.n, run.c), qIn = run.c > 0 ? fr.q0 : fr.q1;
          const A = add(add(w.a, mul(fr.u, sA)), mul(fr.n, qIn)), B = add(add(w.a, mul(fr.u, sB)), mul(fr.n, qIn));
          const capB = last && J.capEnd[wi][1], capA = first && J.capEnd[wi][0];
          lv.walls.push({ kind: 'ext', a: pt(A), b: pt(B), t: r4(w.t), n: pt(nOut), ext1: 0, pre: 0, cap: capB ? 1 : 0, capA: capA ? 1 : 0, doors: ops, src: w.id, top: r4(wallTopExt), dz0: y0 });
        }
      });
    });
    /* items */
    for (const it of L.items || []) lv.furniture.push(itemToProp(it));
    out.levels.push(lv);
  });
  /* openings taller than their wall carry on into the wall above on the same line */
  levels.forEach((L, li) => {
    const lv = out.levels[li], up = out.levels[li + 1];
    if (!up) return;
    const H = up.base - lv.base;
    for (const w of lv.walls) for (const o of w.doors) {
      if (!(o.top > H + 0.01)) continue;
      const d = sub(w.b, w.a), Lw = len(d), u = mul(d, 1 / Lw);
      const p0 = add(w.a, mul(u, o.off)), p1 = add(w.a, mul(u, o.off + o.w));
      for (const v of up.walls) {
        if (v.kind !== w.kind) continue;
        const dv = sub(v.b, v.a), Lv = len(dv), uv = mul(dv, 1 / Lv);
        if (Math.abs(cross(uv, u)) > 1e-3 || Math.abs(cross(uv, sub(p0, v.a))) > 0.02) continue;
        const t0 = dot(sub(p0, v.a), uv), t1 = dot(sub(p1, v.a), uv), a0 = Math.max(0, Math.min(t0, t1)), a1 = Math.min(Lv, Math.max(t0, t1));
        if (a1 - a0 < 0.05) continue;
        v.doors.push(Object.assign({}, o, { off: r4(a0), w: r4(a1 - a0), bottom: r4(o.bottom - H), top: r4(o.top - H), id: o.id + '^' }));
        o.carried = true;
      }
      if (!o.carried) { o.top = H; continue; }
      /* the glass is drawn once, upstairs; here only the wall is cut away under it */
      if (o.bottom >= H - 0.01) o.drop = true;
      else { o.kind = 'HOLE'; o.top = H; }
    }
    lv.walls.forEach(w => { w.doors = w.doors.filter(o => !o.drop); });
  });
  for (const lv of out.levels) for (const w of lv.walls) w.doors.sort((p, q) => p.off - q.off);
  /* stairs: treads with their tops (equal risers to the floor above) */
  for (const s of model.stairs || []) {
    const L = levels[s.from], U = levels[s.from + 1];
    if (!L) continue;
    const rise = U ? U.base - L.base : L.h + L.ct, n = s.treads.length + 1;
    out.stairs3.push({ id: s.id, level: s.from, rise: r4(rise), n, solid: s.solid === undefined ? s.treads.length : s.solid,
      treads: s.treads.map((p, k) => ({ poly: p.map(pt), top: r4((k + 1) * rise / n) })) });
  }
  return out;
}

/* model item -> makeProp object (app.js): x/y centre, w along local x, d along
   local y, angle a; local -y = the item's back / head (beds, cupboards' backs) */
export function itemToProp(it) {
  const p = { name: it.kind, x: it.x, y: it.y, w: it.w, d: it.d, a: it.a || 0, top: 0, bottom: 0, colors: [], treads: 0, rot: 0, id: it.id };
  const H = { bed: 0.92, desk: 0.72, chair: 0.8, closet: 2.3, ub: 2.1, vanity: 0.85, toilet: 0.8, washer: 0.9, dryer: 1.75, rail: 1.95, shelves: 2.1,
    sofa: 0.8, rugRound: 0.01, stove: 0.75, table: 0.72, bench: 0.44, island: 0.9, tall: 2.3, fridge: 1.8, post: 2.6, beam: 2.665, shower: 2.1, wardrobe: 1.9,
    gymRack: 2.3, treadmill: 1.45, gymBench: 0.45, mat: 0.01, saunaBench: 0.45, saunaHeater: 0.75, tube: 0.6, railing: 1.1 };
  p.top = it.h || H[it.kind] || 0.8;
  for (const k of ['chaise', 'hearth', 'depth', 'leaves']) if (it[k] !== undefined) p[k] = it[k];
  if (it.top !== undefined) p.topMode = it.top;
  return p;
}

/* --------------------------------------------------- share links (#m=...) */
export async function packModel(m) {
  const txt = JSON.stringify(m);
  const bytes = new TextEncoder().encode(txt);
  const cs = new CompressionStream('deflate-raw');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function unpackModel(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64), b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  const ds = new DecompressionStream('deflate-raw');
  const txt = await new Response(new Blob([b]).stream().pipeThrough(ds)).text();
  return JSON.parse(txt);
}
export const STORE_KEY = 'h3dRefModel';
/* the model to show: a shared link (#m=) wins, then the editor's saved copy
   (localStorage[storeKey]: one per built-in plan), then the original */
export async function loadModel(defaultUrl, storeKey) {
  const hash = location.hash.match(/[#&]m=([^&]+)/);
  if (hash) { try { return { model: await unpackModel(hash[1]), from: 'link' }; } catch (e) { console.warn('bad #m', e); } }
  const q = new URLSearchParams(location.search);
  if (!q.has('orig')) {
    try { const s = localStorage.getItem(storeKey || STORE_KEY); if (s) return { model: JSON.parse(s), from: 'edited' }; } catch (e) { /* private mode */ }
  }
  const r = await fetch(defaultUrl);
  return { model: await r.json(), from: 'original' };
}
