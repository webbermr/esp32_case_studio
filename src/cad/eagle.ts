import { XMLParser } from 'fast-xml-parser';
import type { MountingHole } from '../types';
import { classify, TYPICAL_HEIGHT } from './classify';
import type { CadBoard, CadPart, Vec3 } from './types';

/*
 * Eagle .brd (XML). Part centres and rotations are exact; body outlines come
 * from each package's documentation/silkscreen layers; heights are typical
 * values because Eagle has no 3D data.
 *
 * "Front" is Eagle's top layer. For display modules (display on the other
 * side) use "Turn over" after importing.
 */

type Node = Record<string, unknown>;
const arr = <T = Node>(v: unknown): T[] => (v == null ? [] : Array.isArray(v) ? (v as T[]) : [v as T]);
const num = (v: unknown) => Number(v ?? 0);

interface Pt {
  x: number;
  y: number;
}

/** Package outline in package coordinates, by preference: docu → silkscreen → copper. */
function packageBox(pkg: Node): { min: Pt; max: Pt; drills: number[]; holes: { x: number; y: number; d: number }[] } | null {
  const sets: Record<string, Pt[]> = { docu: [], place: [], copper: [] };
  const layerSet = (layer: number) => (layer === 51 || layer === 52 ? 'docu' : layer === 21 || layer === 22 ? 'place' : null);
  for (const w of arr(pkg.wire)) {
    const s = layerSet(num(w['@_layer']));
    if (s) sets[s].push({ x: num(w['@_x1']), y: num(w['@_y1']) }, { x: num(w['@_x2']), y: num(w['@_y2']) });
  }
  for (const r of arr(pkg.rectangle)) {
    const s = layerSet(num(r['@_layer']));
    if (s) sets[s].push({ x: num(r['@_x1']), y: num(r['@_y1']) }, { x: num(r['@_x2']), y: num(r['@_y2']) });
  }
  for (const c of arr(pkg.circle)) {
    const s = layerSet(num(c['@_layer']));
    const r = num(c['@_radius']);
    if (s) sets[s].push({ x: num(c['@_x']) - r, y: num(c['@_y']) - r }, { x: num(c['@_x']) + r, y: num(c['@_y']) + r });
  }
  for (const p of arr(pkg.smd)) {
    const dx = num(p['@_dx']) / 2;
    const dy = num(p['@_dy']) / 2;
    const rot = /R(90|270)/.test(String(p['@_rot'] ?? '')) ? [dy, dx] : [dx, dy];
    sets.copper.push({ x: num(p['@_x']) - rot[0], y: num(p['@_y']) - rot[1] }, { x: num(p['@_x']) + rot[0], y: num(p['@_y']) + rot[1] });
  }
  const drills: number[] = [];
  const holes: { x: number; y: number; d: number }[] = [];
  for (const p of arr(pkg.pad)) {
    const d = num(p['@_diameter']) || num(p['@_drill']) * 1.6;
    sets.copper.push({ x: num(p['@_x']) - d / 2, y: num(p['@_y']) - d / 2 }, { x: num(p['@_x']) + d / 2, y: num(p['@_y']) + d / 2 });
    drills.push(num(p['@_drill']));
    holes.push({ x: num(p['@_x']), y: num(p['@_y']), d: num(p['@_drill']) });
  }
  for (const h of arr(pkg.hole)) {
    holes.push({ x: num(h['@_x']), y: num(h['@_y']), d: num(h['@_drill']) });
    drills.push(num(h['@_drill']));
  }
  const pts = sets.docu.length ? sets.docu : sets.place.length ? sets.place : sets.copper;
  if (!pts.length && !holes.length) return null;
  const all = pts.length ? pts : holes.map((h) => ({ x: h.x, y: h.y }));
  return {
    min: { x: Math.min(...all.map((p) => p.x)), y: Math.min(...all.map((p) => p.y)) },
    max: { x: Math.max(...all.map((p) => p.x)), y: Math.max(...all.map((p) => p.y)) },
    drills,
    holes,
  };
}

function transform(p: Pt, rot: string): Pt {
  const mirror = rot.includes('M');
  const a = (Number(rot.replace(/[^0-9.]/g, '')) || 0) * (Math.PI / 180);
  const x = p.x * Math.cos(a) - p.y * Math.sin(a);
  const y = p.x * Math.sin(a) + p.y * Math.cos(a);
  return { x: mirror ? -x : x, y };
}

export function parseEagle(xml: string): CadBoard {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml) as Node;
  const board = ((doc.eagle as Node)?.drawing as Node)?.board as Node | undefined;
  if (!board) throw new Error('Not an Eagle board file (no <board> element).');
  const warnings: string[] = [];

  // Outline: wires on the Dimension layer (20).
  const outline: Pt[] = [];
  for (const w of arr((board.plain as Node)?.wire)) {
    if (num(w['@_layer']) !== 20) continue;
    outline.push({ x: num(w['@_x1']), y: num(w['@_y1']) }, { x: num(w['@_x2']), y: num(w['@_y2']) });
  }
  for (const c of arr((board.plain as Node)?.circle)) {
    if (num(c['@_layer']) !== 20) continue;
    const r = num(c['@_radius']);
    outline.push({ x: num(c['@_x']) - r, y: num(c['@_y']) - r }, { x: num(c['@_x']) + r, y: num(c['@_y']) + r });
  }
  if (!outline.length) throw new Error('The board has no outline on the Dimension layer.');
  const x0 = Math.min(...outline.map((p) => p.x));
  const y0 = Math.min(...outline.map((p) => p.y));
  const L = Math.max(...outline.map((p) => p.x)) - x0;
  const W = Math.max(...outline.map((p) => p.y)) - y0;
  const t = 1.6;

  // Packages by library + name.
  const packages = new Map<string, Node>();
  for (const lib of arr(((board.libraries as Node)?.library) ?? [])) {
    for (const pkg of arr((lib.packages as Node)?.package)) packages.set(`${lib['@_name']}|${pkg['@_name']}`, pkg);
  }

  const parts: CadPart[] = [];
  const holes: MountingHole[] = [];
  for (const h of arr((board.plain as Node)?.hole)) {
    const d = num(h['@_drill']);
    if (d >= 1.5) holes.push({ x: round(num(h['@_x']) - x0), y: round(num(h['@_y']) - y0), diameter: d });
  }

  for (const el of arr((board.elements as Node)?.element)) {
    const ref = String(el['@_name'] ?? '');
    const pkgName = String(el['@_package'] ?? '');
    const value = String(el['@_value'] ?? '');
    const rot = String(el['@_rot'] ?? 'R0');
    const ex = num(el['@_x']);
    const ey = num(el['@_y']);
    const pkg = packages.get(`${el['@_library']}|${pkgName}`);
    const box = pkg ? packageBox(pkg) : null;

    // Mounting holes: hole packages, or a lone big drilled pad.
    if (/HOLE|MOUNT|\bM[234](\.\d)?\b|THO-M/i.test(pkgName) && box) {
      const big = box.holes.filter((h) => h.d >= 1.5).sort((a, b) => b.d - a.d)[0];
      if (big) {
        const p = transform({ x: big.x, y: big.y }, rot);
        holes.push({ x: round(ex + p.x - x0), y: round(ey + p.y - y0), diameter: big.d });
        continue;
      }
    }

    const kind = classify(pkgName, ref, value);
    if (!kind) continue;
    const face = rot.includes('M') ? 'back' : 'front';
    const corners = box
      ? [box.min, { x: box.max.x, y: box.min.y }, box.max, { x: box.min.x, y: box.max.y }].map((p) => transform(p, rot))
      : [{ x: -1, y: -1 }, { x: 1, y: 1 }];
    const xs = corners.map((p) => ex + p.x - x0);
    const ys = corners.map((p) => ey + p.y - y0);
    const h = TYPICAL_HEIGHT[kind];
    const min: Vec3 = [Math.min(...xs), Math.min(...ys), face === 'front' ? 0 : -t - h];
    const max: Vec3 = [Math.max(...xs), Math.max(...ys), face === 'front' ? h : -t];
    parts.push({ ref, name: pkgName, value, kind, face, min: min.map(round) as Vec3, max: max.map(round) as Vec3, heightKnown: false });
  }

  if (!holes.length) warnings.push('No mounting holes found.');
  warnings.push('Eagle files have no heights: part heights are typical values. Check tall parts.');
  return { source: 'eagle', length: round(L), width: round(W), thickness: t, holes, parts, warnings };
}

const round = (x: number) => Math.round(x * 100) / 100;
