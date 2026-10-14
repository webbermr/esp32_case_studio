import { rotate180, turnOver } from '../lib/transform';
import type { Device, Feature, Side } from '../types';
import { KIND_LABEL } from './classify';
import type { CadBoard, CadPart } from './types';

/*
 * CadBoard → Device. Positions are taken as-is; this decides which face of
 * the case each part is reached through and whether it gets an opening.
 */

const PORTS = new Set(['usb-c', 'micro-usb', 'usb-a', 'sd', 'barrel', 'sma']);
const EDGE_REACH = 3; // a port this close to an edge is reached through that wall

function nearestEdge(p: CadPart, L: number, W: number): { side: Side; dist: number } {
  const d: [Side, number][] = [
    ['left', p.min[0]],
    ['right', L - p.max[0]],
    ['front', p.min[1]],
    ['back', W - p.max[1]],
  ];
  d.sort((a, b) => a[1] - b[1]);
  return { side: d[0][0], dist: d[0][1] };
}

export interface CadMeta {
  name: string;
  manufacturer?: string;
  sourceLabel: string;
  sourceUrl?: string;
}

export function cadToDevice(cad: CadBoard, meta: CadMeta): Device {
  const { length: L, width: W, thickness: t } = cad;
  const features: Feature[] = [];
  const counts = new Map<string, number>();

  // Unidentified parts only matter for clearance heights (below); keep the list to things you'd cut or check.
  for (const part of cad.parts.filter((q) => q.kind)) {
    let p = part;
    const kind = p.kind ?? 'other';
    const faceSide: Side = p.face === 'front' ? 'top' : 'bottom';
    const edge = nearestEdge(p, L, W);
    let side: Side = faceSide;
    let cutout = false;
    const extra: Partial<Feature> = {};

    if (PORTS.has(kind)) {
      if (edge.dist <= EDGE_REACH) {
        side = edge.side;
        cutout = true;
      }
    } else if (kind === 'button') {
      // Overhanging the edge means a side-pressed button; otherwise pressed from its face.
      side = edge.dist < 0 ? edge.side : faceSide;
      cutout = true;
    } else if (kind === 'switch') {
      if (p.lever) {
        side = faceSide;
        cutout = true;
        extra.slideAxis = p.lever.axis;
        extra.leverSize = p.lever.size;
        // Body only: the lever sits on top of it.
        if (p.face === 'front') p = { ...p, max: [p.max[0], p.max[1], p.max[2] - p.lever.protrusion] };
        else p = { ...p, min: [p.min[0], p.min[1], p.min[2] + p.lever.protrusion] };
      } else if (edge.dist <= 2) {
        side = edge.side;
        cutout = true;
      } else {
        side = faceSide;
        cutout = true;
        extra.slideAxis = p.max[0] - p.min[0] >= p.max[1] - p.min[1] ? 'x' : 'y';
      }
    } else if (kind === 'display') {
      cutout = true;
      const w = p.max[0] - p.min[0];
      const h = p.max[1] - p.min[1];
      if (w > 20 && h > 20) extra.opening = [round(w - 6), round(h - 6)];
    } else if (kind === 'jst' && edge.dist <= 2) {
      side = edge.side;
    }

    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    const label = p.ref
      ? `${KIND_LABEL[kind]} (${p.ref})`
      : `${KIND_LABEL[kind]}${cad.parts.filter((q) => q.kind === kind).length > 1 ? ` ${n}` : ''}`;

    features.push({
      id: `${kind}-${n}`,
      label,
      kind,
      side,
      x: round((p.min[0] + p.max[0]) / 2),
      y: round((p.min[1] + p.max[1]) / 2),
      z: round((p.min[2] + p.max[2]) / 2),
      size: [round(p.max[0] - p.min[0]), round(p.max[1] - p.min[1]), round(p.max[2] - p.min[2])],
      cutout,
      note: [p.name, p.value].filter(Boolean).join(' · ') + (p.heightKnown ? '' : ' · height is a typical value'),
      ...extra,
    });
  }

  const above = Math.max(0.5, ...cad.parts.map((p) => p.max[2]));
  const below = Math.max(0, ...cad.parts.map((p) => -p.min[2] - t));
  const sourceName = { step: 'STEP model', eagle: 'Eagle board file', kicad: 'KiCad PCB file' }[cad.source];
  const slug = meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';

  return {
    id: `import-${slug}`,
    name: meta.name,
    manufacturer: meta.manufacturer ?? `Imported ${sourceName}`,
    category: 'Other',
    aliases: [],
    tags: [],
    specs: {
      Source: `${sourceName}: ${meta.sourceLabel}`,
      Parts: `${features.length} recognised (${features.filter((f) => f.cutout).length} with openings)`,
    },
    board: { length: L, width: W, thickness: t, heightAbove: round(above), heightBelow: round(below) },
    mountingHoles: cad.holes,
    features,
    sources: meta.sourceUrl ? [{ label: sourceName, url: meta.sourceUrl }] : [],
    confidence: cad.source === 'step' ? 'datasheet' : 'partial',
    notes:
      `Positions read from the manufacturer's ${sourceName}. ` +
      (cad.source === 'step' ? 'Sizes and heights come from the 3D model. ' : 'Heights are typical values. ') +
      'Check part names and which side is the front (Fix positions → Turn over). ' +
      cad.warnings.join(' '),
    origin: 'import',
  };
}

/**
 * Take positions from a CAD import but keep the board's identity (name,
 * specs, sources, settings), the labels/options of matching parts, and parts
 * the CAD file doesn't contain (e.g. a display that isn't in a PCB file).
 *
 * The import is flipped/rotated to whichever orientation best matches the
 * existing layout, since PCB files are drawn from the component side.
 * Without 3D data (Eagle/KiCad), existing heights are kept.
 */
export type CadAlignment = 'none' | 'rotate180' | 'turnOver' | 'turnOver+rotate180';

export function mergeCadInto(
  current: Device,
  imported: Device,
  source: CadBoard['source'],
): { device: Device; alignment: CadAlignment } {
  const candidates = [imported, rotate180(imported), turnOver(imported), rotate180(turnOver(imported))];
  const names: CadAlignment[] = ['none', 'rotate180', 'turnOver', 'turnOver+rotate180'];
  const cost = (cand: Device) => {
    let total = 0;
    let matched = 0;
    for (const f of cand.features) {
      const same = current.features.filter((c) => c.kind === f.kind && c.side !== undefined);
      if (!same.length) continue;
      const faceOf = (x: Feature) => (x.z >= -cand.board.thickness / 2 ? 'front' : 'back');
      const d = Math.min(...same.map((c) => Math.hypot(c.x - f.x, c.y - f.y) + (faceOf(c) === faceOf(f) ? 0 : 20)));
      total += Math.min(d, 60);
      matched++;
    }
    return matched ? total / matched : 0;
  };
  const costs = candidates.map(cost);
  const bestIndex = costs.indexOf(Math.min(...costs));
  const best = candidates[bestIndex];

  const used = new Set<string>();
  const has3d = source === 'step';
  const features = best.features.map((f) => {
    const match = current.features
      .filter((c) => c.kind === f.kind && !used.has(c.id))
      .map((c) => ({ c, d: Math.hypot(c.x - f.x, c.y - f.y) }))
      .sort((a, b) => a.d - b.d)[0];
    if (!match || match.d > 25) return f;
    used.add(match.c.id);
    const { label, actuator, plungerDiameter, switchTravel, leverSize, id } = match.c;
    const merged: Feature = { ...f, id, label, actuator, plungerDiameter, switchTravel: switchTravel ?? f.switchTravel };
    if (!has3d) {
      // Keep the known height; take only the position from the file.
      merged.z = match.c.z;
      merged.size = [f.size[0], f.size[1], match.c.size[2]];
      merged.leverSize = leverSize ?? f.leverSize;
    }
    return merged;
  });
  const importedKinds = new Set(best.features.map((f) => f.kind));
  const kept = current.features.filter((c) => !importedKinds.has(c.kind));

  const device: Device = {
    ...current,
    board: has3d
      ? { ...best.board, color: current.board.color }
      : { ...current.board, length: best.board.length, width: best.board.width },
    mountingHoles: best.mountingHoles.length ? best.mountingHoles : current.mountingHoles,
    features: [...features, ...kept],
    confidence: 'datasheet',
    notes: `${best.notes}${current.notes ? ` Previous notes: ${current.notes}` : ''}`,
  };
  return { device, alignment: names[bestIndex] };
}

/** The same alignment as a matrix, for the imported 3D model (board coords, z = 0 on the front face). */
export function alignmentMatrix(a: CadAlignment, L: number, W: number, t: number): number[] {
  // Row-major 4×4.
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const rot = [-1, 0, 0, L, 0, -1, 0, W, 0, 0, 1, 0, 0, 0, 0, 1];
  const turn = [1, 0, 0, 0, 0, -1, 0, W, 0, 0, -1, -t, 0, 0, 0, 1];
  const mul = (A: number[], B: number[]) =>
    Array.from({ length: 16 }, (_, i) => {
      const r = Math.floor(i / 4);
      const c = i % 4;
      return A[r * 4] * B[c] + A[r * 4 + 1] * B[4 + c] + A[r * 4 + 2] * B[8 + c] + A[r * 4 + 3] * B[12 + c];
    });
  return a === 'none' ? id : a === 'rotate180' ? rot : a === 'turnOver' ? turn : mul(rot, turn);
}

const round = (x: number) => Math.round(x * 100) / 100;
