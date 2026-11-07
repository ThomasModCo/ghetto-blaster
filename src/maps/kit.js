// Playset kit: the geometry helpers that make the procedural city read as a cast/molded toy diorama.
// Visual only: nothing in here registers colliders or draws from the map RNG, so layouts, nav and bot behaviour
// (and therefore pre-planned match outcomes) are unchanged.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Box with flat chamfered edges and corners (6 faces + 12 edge strips + 8 corner tris = 44 triangles).
 * Same face order, groups and UV conventions as THREE.BoxGeometry (+x, -x, +y, -y, +z, -z; each face 0..1),
 * so multi-material buildings and tiled textures map exactly as before. c = chamfer width.
 */
export function chamferBox(w, h, d, c = 0.05) {
  const W = w / 2, H = h / 2, D = d / 2;
  c = Math.min(c, W * 0.45, H * 0.45, D * 0.45);
  if (c < 0.008) return new THREE.BoxGeometry(w, h, d);
  // the three points a corner is cut into: on its x-face, y-face and z-face
  const P = (sx, sy, sz, f) => f === 0 ? [sx * W, sy * (H - c), sz * (D - c)] : f === 1 ? [sx * (W - c), sy * H, sz * (D - c)] : [sx * (W - c), sy * (H - c), sz * D];
  // UVs follow BoxGeometry: side faces v up; +x u toward -z, -x u toward +z, +z u toward +x, -z u toward -x; +y v toward -z, -y v toward +z
  const uvOf = (g, p) => {
    const [x, y, z] = p;
    switch (g) {
      case 0: return [(D - z) / d, (y + H) / h];
      case 1: return [(z + D) / d, (y + H) / h];
      case 2: return [(x + W) / w, (D - z) / d];
      case 3: return [(x + W) / w, (z + D) / d];
      case 4: return [(x + W) / w, (y + H) / h];
      default: return [(W - x) / w, (y + H) / h];
    }
  };
  const groupOf = (n) => { const a = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)]; const i = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2; return i * 2 + ((i === 0 ? n.x : i === 1 ? n.y : n.z) < 0 ? 1 : 0); };
  const tris = [[], [], [], [], [], []];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), E1 = new THREE.Vector3(), E2 = new THREE.Vector3();
  const tri = (a, b, cc) => {
    A.fromArray(a); B.fromArray(b); C.fromArray(cc);
    N.crossVectors(E1.subVectors(B, A), E2.subVectors(C, A)).normalize();
    const cen = new THREE.Vector3().add(A).add(B).add(C);
    if (N.dot(cen) < 0) { const t = b; b = cc; cc = t; N.negate(); } // outward winding (the box is convex)
    tris[groupOf(N)].push({ p: [a, b, cc], n: N.clone() });
  };
  const quad = (a, b, cc, dd) => { tri(a, b, cc); tri(a, cc, dd); };
  const S = [-1, 1];
  // main faces
  for (const s of S) {
    quad(P(s, -1, -1, 0), P(s, 1, -1, 0), P(s, 1, 1, 0), P(s, -1, 1, 0));
    quad(P(-1, s, -1, 1), P(1, s, -1, 1), P(1, s, 1, 1), P(-1, s, 1, 1));
    quad(P(-1, -1, s, 2), P(1, -1, s, 2), P(1, 1, s, 2), P(-1, 1, s, 2));
  }
  // edge strips
  for (const a of S) for (const b of S) {
    quad(P(a, b, -1, 0), P(a, b, 1, 0), P(a, b, 1, 1), P(a, b, -1, 1)); // x/y edges, along z
    quad(P(a, -1, b, 0), P(a, 1, b, 0), P(a, 1, b, 2), P(a, -1, b, 2)); // x/z edges, along y
    quad(P(-1, a, b, 1), P(1, a, b, 1), P(1, a, b, 2), P(-1, a, b, 2)); // y/z edges, along x
  }
  // corners
  for (const sx of S) for (const sy of S) for (const sz of S) tri(P(sx, sy, sz, 0), P(sx, sy, sz, 1), P(sx, sy, sz, 2));
  const pos = [], nor = [], uv = [], geo = new THREE.BufferGeometry();
  let start = 0;
  tris.forEach((list, g) => {
    for (const t of list) for (const p of t.p) { pos.push(...p); nor.push(t.n.x, t.n.y, t.n.z); uv.push(...uvOf(g, p)); }
    geo.addGroup(start, list.length * 3, g); start += list.length * 3;
  });
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

/** Split a grouped, non-indexed geometry into one geometry per list of group indices (e.g. walls vs roof). */
export function splitGroups(geo, sets) {
  return sets.map((ids) => {
    const parts = geo.groups.filter((g) => ids.includes(g.materialIndex)), out = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(geo.attributes)) {
      const n = a.itemSize, arr = new Float32Array(parts.reduce((t, g) => t + g.count, 0) * n); let o = 0;
      for (const g of parts) { arr.set(a.array.subarray(g.start * n, (g.start + g.count) * n), o); o += g.count * n; }
      out.setAttribute(name, new THREE.BufferAttribute(arr, n));
    }
    return out;
  });
}
/** Scale the UVs of one or more face groups (same signature as the old BoxGeometry helper: per-face [su, sv] or null). */
export function scaleFaceUVs(geo, ...faces) {
  const uv = geo.attributes.uv, idx = geo.index;
  for (const g of geo.groups) {
    const f = faces[g.materialIndex]; if (!f) continue;
    const seen = new Set();
    for (let i = g.start; i < g.start + g.count; i++) { const v = idx ? idx.getX(i) : i; if (seen.has(v)) continue; seen.add(v); uv.setXY(v, uv.getX(v) * f[0], uv.getY(v) * f[1]); }
  }
  uv.needsUpdate = true;
}

/** Trim colour for a facade: cast-stone cream on brick, a lighter or darker shade of the wall otherwise. */
export function trimColor(wall, style) {
  const c = new THREE.Color(wall);
  if (style === 'brick' || style === 'tenement') return new THREE.Color('#d6cbb4');
  const hsl = {}; c.getHSL(hsl);
  return c.clone().offsetHSL(0, -0.05, hsl.l > 0.55 ? -0.16 : 0.12);
}

// Unit window surround (1 x 1 opening facing +Z on the wall plane): sill, head and two jambs, all chamfered.
let FRAME = null;
export function windowFrameGeo() {
  if (FRAME) return FRAME;
  // plain boxes (48 triangles): there are thousands of these per map, and at window scale a chamfer doesn't read
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
  const parts = [box(1.34, 0.12, 0.2, 0, -0.56, 0.1), box(1.24, 0.11, 0.12, 0, 0.555, 0.06), box(0.09, 1.0, 0.07, -0.545, 0, 0.035), box(0.09, 1.0, 0.07, 0.545, 0, 0.035)];
  for (const p of parts) p.clearGroups();
  FRAME = mergeGeometries(parts, false);
  return FRAME;
}

/**
 * Window centres for a facade built by MapBuilder.building(): the facade texture tiles R bays across a face and
 * ry two-floor tiles up it, with 3 x 2 windows per tile (see textures.js facade). Returns [{t, y, ww, wh}] in
 * face-local coordinates (t along the face from its centre, y from the ground).
 */
export function facadeWindows(len, h, R, ry) {
  const out = [], tileW = len / R, tileH = h / ry, ww = tileW / 6, wh = tileH * 0.275;
  for (let i = 0; i < Math.ceil(ry); i++) for (let r = 0; r < 2; r++) {
    const vc = i + (1 - (r * 0.5 + 0.2375)); if (vc + 0.1375 > ry + 1e-3) continue;
    for (let k = 0; k < 3 * R; k++) out.push({ t: ((k + 0.5) / (3 * R) - 0.5) * len, y: (vc / ry) * h, ww, wh });
  }
  return out;
}
