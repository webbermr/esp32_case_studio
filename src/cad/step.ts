import type { MountingHole } from '../types';
import { classify } from './classify';
import type { CadBoard, CadMesh, CadPart, Vec3 } from './types';

/*
 * Turn a tessellated STEP assembly (from occt-import-js) into a CadBoard.
 *
 * 1. Find the PCB: the thin plate with the most parts sitting on its faces.
 * 2. Decide which face is the front: the display side if there is one,
 *    otherwise the side carrying more parts.
 * 3. Map everything into board coordinates and measure each part.
 * 4. Find round mounting holes in the PCB's faces.
 *
 * Assumes the PCB is aligned with the model's axes (true for nearly every
 * manufacturer model); warns when it isn't.
 */

export interface OcctMesh {
  name?: string;
  color?: number[];
  attributes: { position: { array: ArrayLike<number> } };
  index?: { array: ArrayLike<number> };
}
export interface OcctNode {
  name?: string;
  meshes: number[];
  children: OcctNode[];
}
export interface OcctResult {
  success: boolean;
  root: OcctNode;
  meshes: OcctMesh[];
}

interface Item {
  name: string;
  mesh: OcctMesh;
  min: Vec3;
  max: Vec3;
}

const size = (it: { min: Vec3; max: Vec3 }) => [0, 1, 2].map((i) => it.max[i] - it.min[i]) as Vec3;

function bounds(a: ArrayLike<number>): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < a.length; k += 3) {
    for (let j = 0; j < 3; j++) {
      const v = a[k + j];
      if (v < min[j]) min[j] = v;
      if (v > max[j]) max[j] = v;
    }
  }
  return { min, max };
}

export function analyzeStep(res: OcctResult): { board: CadBoard; mesh: CadMesh } {
  if (!res.success || !res.meshes.length) throw new Error('The STEP file could not be read, or contains no solids.');
  const warnings: string[] = [];

  // ---- Collect meshes with their assembly path names
  const items: Item[] = [];
  const walk = (node: OcctNode, path: string[]) => {
    const p = node.name ? [...path, node.name] : path;
    for (const i of node.meshes) {
      const mesh = res.meshes[i];
      const name = [...p.slice(-2), mesh.name].filter((x) => x && x !== 'SOLID').join(' / ') || 'part';
      items.push({ name, mesh, ...bounds(mesh.attributes.position.array) });
    }
    for (const c of node.children) walk(c, p);
  };
  walk(res.root, []);

  // ---- 1. The PCB
  let pcb: Item | null = null;
  let best = -1;
  for (const it of items) {
    const s = size(it);
    const order = [0, 1, 2].sort((a, b) => s[a] - s[b]);
    const thin = s[order[0]];
    if (thin < 0.4 || thin > 3.2 || s[order[1]] < 8 * thin) continue;
    const n = order[0];
    const [u, v] = [order[1], order[2]];
    let touching = 0;
    for (const o of items) {
      if (o === it) continue;
      const onFace = Math.abs(o.min[n] - it.max[n]) < 0.6 || Math.abs(o.max[n] - it.min[n]) < 0.6;
      const over =
        o.max[u] > it.min[u] && o.min[u] < it.max[u] && o.max[v] > it.min[v] && o.min[v] < it.max[v];
      if (onFace && over) touching++;
    }
    const named = /PCB|PCBA|BOARD/i.test(it.name) ? 1000 : 0;
    const score = named + touching + (s[order[1]] * s[order[2]]) / 1e6;
    if (score > best) {
      best = score;
      pcb = it;
    }
  }
  if (!pcb) throw new Error('Could not find a PCB in this STEP model (no thin plate 0.4–3.2 mm thick).');

  const ps = size(pcb);
  const order = [0, 1, 2].sort((a, b) => ps[a] - ps[b]);
  const n = order[0];
  const u = order[2]; // length axis
  const v = order[1]; // width axis
  const thickness = ps[n];

  // ---- 2. Front face
  const isDisplay = (it: Item) => classify(it.name) === 'display';
  let front = 0;
  let back = 0;
  let displaySide = 0;
  for (const it of items) {
    if (it === pcb) continue;
    const c = (it.min[n] + it.max[n]) / 2;
    const side = c > (pcb.min[n] + pcb.max[n]) / 2 ? 1 : -1;
    if (isDisplay(it)) displaySide += side;
    if (side > 0) front++;
    else back++;
  }
  const sign = displaySide !== 0 ? Math.sign(displaySide) : front >= back ? 1 : -1;
  const face = sign > 0 ? pcb.max[n] : pcb.min[n];

  // Keep the model's own "up" along the board's width (so a display's top edge
  // stays at the top), and mirror the length axis if needed to stay
  // right-handed when seen from the front.
  const e = (i: number): Vec3 => [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const handed = cross(e(u), e(v))[n];
  const su = sign * handed;
  const L = ps[u];
  const W = ps[v];
  const toBoard = (p: ArrayLike<number>, k: number): Vec3 => [
    su > 0 ? p[k + u] - pcb!.min[u] : pcb!.max[u] - p[k + u],
    p[k + v] - pcb!.min[v],
    sign * (p[k + n] - face),
  ];

  // ---- 3. Parts
  const parts: CadPart[] = [];
  const margin = 5;
  for (const it of items) {
    if (it === pcb) continue;
    const a = it.mesh.attributes.position.array;
    const all = { min: [Infinity, Infinity, Infinity] as Vec3, max: [-Infinity, -Infinity, -Infinity] as Vec3 };
    const clip = { min: [Infinity, Infinity, Infinity] as Vec3, max: [-Infinity, -Infinity, -Infinity] as Vec3 };
    const kind = classify(it.name);
    for (let k = 0; k < a.length; k += 3) {
      const p = toBoard(a, k);
      for (let j = 0; j < 3; j++) {
        all.min[j] = Math.min(all.min[j], p[j]);
        all.max[j] = Math.max(all.max[j], p[j]);
      }
      // Only count the bit of a part over the board (a USB overhang yes, a cable no).
      const inside = p[0] > -margin && p[0] < L + margin && p[1] > -margin && p[1] < W + margin;
      if (inside) {
        for (let j = 0; j < 3; j++) {
          clip.min[j] = Math.min(clip.min[j], p[j]);
          clip.max[j] = Math.max(clip.max[j], p[j]);
        }
      }
    }
    const cx = (all.min[0] + all.max[0]) / 2;
    const cy = (all.min[1] + all.max[1]) / 2;
    // Parts hanging off on a cable (cameras, antennas) are not part of the board.
    if (cx < -3 || cx > L + 3 || cy < -3 || cy > W + 3 || !Number.isFinite(clip.min[0])) continue;
    const box = kind === 'display' ? displayBox(it, toBoard, thickness, L, W) ?? clip : clip;
    const s = size(box);
    const vol = s[0] * s[1] * s[2];
    if (!kind && vol < 20) continue; // pins, solder, tiny passives
    const zc = (box.min[2] + box.max[2]) / 2;
    const part: CadPart = {
      name: it.name,
      kind,
      face: zc > -thickness / 2 ? 'front' : 'back',
      min: box.min,
      max: box.max,
      heightKnown: true,
    };
    if (kind === 'switch') part.lever = measureLever(it, toBoard, part.face, thickness) ?? undefined;
    parts.push(part);
  }

  // Merge display layers (LCD + touch glass) per face into one display.
  const merged: CadPart[] = [];
  for (const p of parts) {
    const same = p.kind === 'display' && merged.find((m) => m.kind === 'display' && m.face === p.face);
    if (same) {
      for (let j = 0; j < 3; j++) {
        same.min[j] = Math.min(same.min[j], p.min[j]);
        same.max[j] = Math.max(same.max[j], p.max[j]);
      }
      same.name = `${same.name} + ${p.name}`;
    } else merged.push(p);
  }

  // Keep the largest unclassified parts only (for heights and the preview).
  const known = merged.filter((p) => p.kind);
  const unknown = merged
    .filter((p) => !p.kind)
    .sort((a, b) => volume(b) - volume(a))
    .slice(0, 30);

  // ---- 4. Mounting holes
  const holes = findHoles(pcb, n, toBoard);
  if (!holes.length) warnings.push('No round mounting holes found in the PCB.');

  const board: CadBoard = {
    source: 'step',
    length: round(L),
    width: round(W),
    thickness: round(thickness),
    holes,
    parts: [...known, ...unknown].map(roundPart),
    warnings,
  };
  return { board, mesh: buildMesh(items, pcb, toBoard) };
}

const round = (x: number) => Math.round(x * 100) / 100;
const volume = (p: { min: Vec3; max: Vec3 }) => size(p).reduce((a, b) => a * b, 1);
function roundPart(p: CadPart): CadPart {
  return { ...p, min: p.min.map(round) as Vec3, max: p.max.map(round) as Vec3 };
}

type ToBoard = (p: ArrayLike<number>, k: number) => Vec3;

/** A display's bounds from the vertices on its own side of the PCB and inside the outline. */
function displayBox(it: Item, toBoard: ToBoard, t: number, L: number, W: number) {
  const a = it.mesh.attributes.position.array;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let frontish = 0;
  for (let k = 0; k < a.length; k += 3) if (toBoard(a, k)[2] > -t / 2) frontish++;
  const front = frontish * 3 >= a.length / 2;
  for (let k = 0; k < a.length; k += 3) {
    const p = toBoard(a, k);
    if (p[0] < -2 || p[0] > L + 2 || p[1] < -2 || p[1] > W + 2) continue;
    if (front ? p[2] < -t / 2 : p[2] > -t / 2) continue;
    for (let j = 0; j < 3; j++) {
      min[j] = Math.min(min[j], p[j]);
      max[j] = Math.max(max[j], p[j]);
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

/**
 * A face-mounted slide switch has a small lever standing above its body.
 * Walk down from the top until the footprint suddenly widens: that's the body.
 */
function measureLever(it: Item, toBoard: ToBoard, face: 'front' | 'back', t: number): CadPart['lever'] | null {
  const a = it.mesh.attributes.position.array;
  const pts: Vec3[] = [];
  for (let k = 0; k < a.length; k += 3) {
    const p = toBoard(a, k);
    // Height above the face the switch sits on.
    pts.push([p[0], p[1], face === 'front' ? p[2] : -t - p[2]]);
  }
  const top = Math.max(...pts.map((p) => p[2]));
  const footprint = (lo: number, hi: number) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p[2] < lo || p[2] > hi) continue;
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
    return { w: x1 - x0, h: y1 - y0, area: (x1 - x0) * (y1 - y0) };
  };
  const lever = footprint(top - 0.25, top + 0.01);
  if (!Number.isFinite(lever.area) || lever.area <= 0) return null;
  // The lever's outline at the very top; everything outside it is body (or legs).
  let lx0 = Infinity, lx1 = -Infinity, ly0 = Infinity, ly1 = -Infinity;
  for (const p of pts) {
    if (p[2] < top - 0.25) continue;
    lx0 = Math.min(lx0, p[0]);
    lx1 = Math.max(lx1, p[0]);
    ly0 = Math.min(ly0, p[1]);
    ly1 = Math.max(ly1, p[1]);
  }
  const tol = 0.05;
  let bodyTop = -Infinity;
  for (const p of pts) {
    const inLever = p[0] >= lx0 - tol && p[0] <= lx1 + tol && p[1] >= ly0 - tol && p[1] <= ly1 + tol;
    if (!inLever) bodyTop = Math.max(bodyTop, p[2]);
  }
  const protrusion = top - bodyTop;
  if (!Number.isFinite(protrusion) || protrusion < 0.4) return null;
  // Slide along the body's long side.
  const body = footprint(0.05, bodyTop + 0.01);
  if (!Number.isFinite(body.area) || body.area < 2.5 * lever.area) return null;
  const axis: 'x' | 'y' = body.w >= body.h ? 'x' : 'y';
  const along = axis === 'x' ? lever.w : lever.h;
  const across = axis === 'x' ? lever.h : lever.w;
  return { size: [round(along), round(across), round(protrusion)], axis, protrusion: round(protrusion) };
}

/** Round holes in the PCB's two faces, as boundary loops of the face triangles. */
function findHoles(pcb: Item, n: number, toBoard: ToBoard): MountingHole[] {
  const a = pcb.mesh.attributes.position.array;
  const idx = pcb.mesh.index?.array;
  if (!idx) return [];
  const found: MountingHole[] = [];
  for (const plane of [pcb.min[n], pcb.max[n]]) {
    const edges = new Map<string, [number, number]>();
    const key = (i: number) => `${a[3 * i].toFixed(3)},${a[3 * i + 1].toFixed(3)},${a[3 * i + 2].toFixed(3)}`;
    for (let t = 0; t < idx.length; t += 3) {
      const tri = [idx[t], idx[t + 1], idx[t + 2]];
      if (!tri.every((i) => Math.abs(a[3 * i + n] - plane) < 1e-3)) continue;
      for (let e = 0; e < 3; e++) {
        const p = tri[e];
        const q = tri[(e + 1) % 3];
        const kp = key(p);
        const kq = key(q);
        const id = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
        if (edges.has(id)) edges.delete(id);
        else edges.set(id, [p, q]);
      }
    }
    // Boundary edges → loops
    const adj = new Map<string, string[]>();
    const pos = new Map<string, number>();
    for (const [p, q] of edges.values()) {
      const kp = key(p);
      const kq = key(q);
      pos.set(kp, p);
      pos.set(kq, q);
      (adj.get(kp) ?? adj.set(kp, []).get(kp)!).push(kq);
      (adj.get(kq) ?? adj.set(kq, []).get(kq)!).push(kp);
    }
    const seen = new Set<string>();
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const loop: Vec3[] = [];
      const stack = [start];
      while (stack.length) {
        const k = stack.pop()!;
        if (seen.has(k)) continue;
        seen.add(k);
        loop.push(toBoard(a, 3 * pos.get(k)!));
        for (const q of adj.get(k) ?? []) stack.push(q);
      }
      if (loop.length < 12) continue;
      const xs = loop.map((p) => p[0]);
      const ys = loop.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      if (w < 1.5 || w > 7 || Math.abs(w - h) > 0.1 * w) continue;
      const r = w / 2;
      if (loop.some((p) => Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - r) > 0.12 * r)) continue;
      if (found.some((f) => Math.hypot(f.x - cx, f.y - cy) < 0.5)) continue;
      found.push({ x: round(cx), y: round(cy), diameter: round(w) });
    }
  }
  return found.sort((p, q) => p.y - q.y || p.x - q.x);
}

function buildMesh(items: Item[], pcb: Item, toBoard: ToBoard): CadMesh {
  let nv = 0;
  let ni = 0;
  for (const it of items) {
    nv += it.mesh.attributes.position.array.length / 3;
    ni += it.mesh.index?.array.length ?? it.mesh.attributes.position.array.length / 3;
  }
  const positions = new Float32Array(nv * 3);
  const colors = new Float32Array(nv * 3);
  const indices = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const it of items) {
    const a = it.mesh.attributes.position.array;
    const c = it === pcb ? [0.12, 0.42, 0.26] : (it.mesh.color ?? [0.62, 0.65, 0.68]);
    const count = a.length / 3;
    for (let i = 0; i < count; i++) {
      const p = toBoard(a, 3 * i);
      positions.set(p, (vo + i) * 3);
      colors.set(c.slice(0, 3), (vo + i) * 3);
    }
    const idx = it.mesh.index?.array;
    if (idx) for (let i = 0; i < idx.length; i++) indices[io + i] = idx[i] + vo;
    else for (let i = 0; i < count; i++) indices[io + i] = vo + i;
    io += idx ? idx.length : count;
    vo += count;
  }
  return { positions, colors, indices };
}
