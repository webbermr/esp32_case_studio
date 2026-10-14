import type { MountingHole } from '../types';
import { classify, TYPICAL_HEIGHT } from './classify';
import type { CadBoard, CadPart, Vec3 } from './types';

/*
 * KiCad .kicad_pcb (S-expressions, KiCad 6+ and most 5.x files). Footprint
 * positions are exact; body outlines come from Fab → courtyard → pads;
 * heights are typical values.
 */

type SExpr = string | SExpr[];

export function parseSExpr(text: string): SExpr {
  let i = 0;
  const n = text.length;
  const stack: SExpr[][] = [[]];
  while (i < n) {
    const c = text[i];
    if (c === '(') {
      const list: SExpr[] = [];
      stack[stack.length - 1].push(list);
      stack.push(list);
      i++;
    } else if (c === ')') {
      stack.pop();
      i++;
    } else if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < n) j++;
        s += text[j++];
      }
      stack[stack.length - 1].push(s);
      i = j + 1;
    } else if (/\s/.test(c)) {
      i++;
    } else {
      let j = i;
      while (j < n && !/[\s()"]/.test(text[j])) j++;
      stack[stack.length - 1].push(text.slice(i, j));
      i = j;
    }
  }
  return stack[0][0] ?? [];
}

const isList = (e: SExpr): e is SExpr[] => Array.isArray(e);
const head = (e: SExpr) => (isList(e) ? e[0] : undefined);
const children = (e: SExpr, name: string): SExpr[][] => (isList(e) ? (e.filter((c) => isList(c) && c[0] === name) as SExpr[][]) : []);
const child = (e: SExpr, name: string) => children(e, name)[0];
const nums = (e: SExpr[] | undefined, from = 1) => (e ? e.slice(from).map((v) => Number(v)).filter((v) => !Number.isNaN(v)) : []);
const layerOf = (e: SExpr) => {
  const l = child(e, 'layer');
  return l ? String(l[1]) : '';
};

interface Pt {
  x: number;
  y: number;
}

export function parseKicad(text: string): CadBoard {
  const root = parseSExpr(text);
  if (!isList(root) || head(root) !== 'kicad_pcb') throw new Error('Not a KiCad PCB file.');
  const warnings: string[] = [];
  const t = nums(child(child(root, 'general') ?? [], 'thickness'))[0] || 1.6;

  // Outline from Edge.Cuts graphics.
  const edge: Pt[] = [];
  for (const g of root) {
    if (!isList(g) || !/^gr_(line|rect|arc|circle|poly)$/.test(String(g[0])) || layerOf(g) !== 'Edge.Cuts') continue;
    for (const key of ['start', 'end', 'mid', 'center']) {
      const p = nums(child(g, key));
      if (p.length >= 2) edge.push({ x: p[0], y: p[1] });
    }
    if (head(g) === 'gr_circle') {
      const c = nums(child(g, 'center'));
      const e = nums(child(g, 'end'));
      const r = Math.hypot(e[0] - c[0], e[1] - c[1]);
      edge.push({ x: c[0] - r, y: c[1] - r }, { x: c[0] + r, y: c[1] + r });
    }
    for (const xy of children(child(g, 'pts') ?? [], 'xy')) edge.push({ x: Number(xy[1]), y: Number(xy[2]) });
  }
  if (!edge.length) throw new Error('The PCB has no Edge.Cuts outline.');
  const x0 = Math.min(...edge.map((p) => p.x));
  const yMax = Math.max(...edge.map((p) => p.y));
  const L = Math.max(...edge.map((p) => p.x)) - x0;
  const W = yMax - Math.min(...edge.map((p) => p.y));
  // KiCad's y points down: flip so the board reads the right way seen from the front.
  const toBoard = (p: Pt): [number, number] => [p.x - x0, yMax - p.y];

  const parts: CadPart[] = [];
  const holes: MountingHole[] = [];

  for (const fp of root) {
    if (!isList(fp) || (head(fp) !== 'footprint' && head(fp) !== 'module')) continue;
    const name = String(fp[1] ?? '');
    const at = nums(child(fp, 'at'));
    const [fx, fy, angle = 0] = at;
    const a = (angle * Math.PI) / 180;
    // Footprint-local → board, KiCad rotates counter-clockwise on screen (y down).
    const world = (lx: number, ly: number): Pt => ({
      x: fx + lx * Math.cos(a) + ly * Math.sin(a),
      y: fy - lx * Math.sin(a) + ly * Math.cos(a),
    });
    const back = layerOf(fp).startsWith('B.');
    const prop = (key: string) => {
      const p = children(fp, 'property').find((c) => c[1] === key);
      if (p) return String(p[2]);
      const ft = children(fp, 'fp_text').find((c) => c[1] === key.toLowerCase());
      return ft ? String(ft[2]) : '';
    };
    const ref = prop('Reference');
    const value = prop('Value');

    const pads = children(fp, 'pad');
    if (/MountingHole/i.test(name)) {
      const drill = Math.max(0, ...pads.map((p) => nums(child(p, 'drill'))[0] ?? 0));
      const fromName = Number(/(\d+(?:\.\d+)?)mm/i.exec(name)?.[1]);
      const d = drill || fromName || 3.2;
      const [x, y] = toBoard({ x: fx, y: fy });
      holes.push({ x: round(x), y: round(y), diameter: d });
      continue;
    }

    const kind = classify(name, ref, value);
    if (!kind) continue;

    const pick = (suffix: string) => {
      const pts: Pt[] = [];
      for (const g of fp) {
        if (!isList(g) || !/^fp_(line|rect|circle|arc|poly)$/.test(String(g[0])) || !layerOf(g).endsWith(suffix)) continue;
        for (const key of ['start', 'end', 'mid', 'center']) {
          const p = nums(child(g, key));
          if (p.length >= 2) pts.push(world(p[0], p[1]));
        }
        for (const xy of children(child(g, 'pts') ?? [], 'xy')) pts.push(world(Number(xy[1]), Number(xy[2])));
      }
      return pts;
    };
    let pts = pick('.Fab');
    if (pts.length < 2) pts = pick('.CrtYd');
    if (pts.length < 2) {
      for (const p of pads) {
        const [px, py] = nums(child(p, 'at'));
        const [w, h] = nums(child(p, 'size'));
        for (const [dx, dy] of [[-w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2], [w / 2, -h / 2]]) pts.push(world(px + dx, py + dy));
      }
    }
    if (pts.length < 2) pts = [world(-1, -1), world(1, 1)];
    const bxy = pts.map(toBoard);
    const hgt = TYPICAL_HEIGHT[kind];
    const min: Vec3 = [Math.min(...bxy.map((p) => p[0])), Math.min(...bxy.map((p) => p[1])), back ? -t - hgt : 0];
    const max: Vec3 = [Math.max(...bxy.map((p) => p[0])), Math.max(...bxy.map((p) => p[1])), back ? -t : hgt];
    parts.push({ ref, name, value, kind, face: back ? 'back' : 'front', min: min.map(round) as Vec3, max: max.map(round) as Vec3, heightKnown: false });
  }

  if (!holes.length) warnings.push('No MountingHole footprints found.');
  warnings.push('KiCad files have no heights here: part heights are typical values. Check tall parts.');
  return { source: 'kicad', length: round(L), width: round(W), thickness: t, holes, parts, warnings };
}

const round = (x: number) => Math.round(x * 100) / 100;
