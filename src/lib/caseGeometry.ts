import * as THREE from 'three';
import Module, { type CrossSection, type Manifold, type ManifoldToplevel } from 'manifold-3d';
import type { CaseSettings, Device, Feature, Side } from '../types';

/** Derived numbers shared by the geometry builder and the spec panel. */
export interface CaseLayout {
  innerLength: number;
  innerWidth: number;
  outerLength: number;
  outerWidth: number;
  /** Height of the base part (floor to rim). */
  baseHeight: number;
  /** Overall assembled height including the lid plate. */
  totalHeight: number;
  /** PCB bottom-left corner position in case coordinates. */
  boardOrigin: THREE.Vector3;
  /** Z of the PCB top surface in case coordinates. */
  boardTopZ: number;
  standoff: number;
}

/**
 * Footprint the cavity must hold, in board coordinates. Parts that hang past the
 * PCB edge (module antennas, connectors) grow it, unless they get a cut-out:
 * those pass through the wall instead.
 */
export function boardExtents(device: Device) {
  let minX = 0;
  let minY = 0;
  let maxX = device.board.length;
  let maxY = device.board.width;
  for (const f of device.features) {
    if (f.cutout) continue;
    minX = Math.min(minX, f.x - f.size[0] / 2);
    maxX = Math.max(maxX, f.x + f.size[0] / 2);
    minY = Math.min(minY, f.y - f.size[1] / 2);
    maxY = Math.max(maxY, f.y + f.size[1] / 2);
  }
  return { minX, minY, maxX, maxY };
}

export function computeLayout(device: Device, s: CaseSettings): CaseLayout {
  const b = device.board;
  const e = boardExtents(device);
  const innerLength = e.maxX - e.minX + 2 * s.clearance;
  const innerWidth = e.maxY - e.minY + 2 * s.clearance;
  // The PCB must clear anything hanging off its underside.
  const standoff = Math.max(s.standoff, b.heightBelow + 0.5);
  const boardTopZ = s.floor + standoff + b.thickness;
  const baseHeight = boardTopZ + b.heightAbove + s.topClearance;
  return {
    innerLength,
    innerWidth,
    outerLength: innerLength + 2 * s.wall,
    outerWidth: innerWidth + 2 * s.wall,
    baseHeight,
    totalHeight: baseHeight + s.lidThickness,
    boardOrigin: new THREE.Vector3(s.wall + s.clearance - e.minX, s.wall + s.clearance - e.minY, s.floor + standoff),
    boardTopZ,
    standoff,
  };
}

// ---------------------------------------------------------------------------
// CSG kernel (manifold-3d, WASM). Output is guaranteed watertight.

let kernel: ManifoldToplevel | null = null;

/** Load the WASM kernel once. Pass `wasmUrl` in the browser (Vite asset URL). */
export async function initCsg(wasmUrl?: string): Promise<void> {
  if (kernel) return;
  const m = await Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  m.setup();
  m.setCircularSegments(48);
  kernel = m;
}

export const csgReady = () => kernel !== null;

/**
 * Every Manifold/CrossSection is a WASM heap object that must be freed. A Scope
 * tracks what one build allocates and frees it all at the end.
 */
class Scope {
  private owned: { delete(): void }[] = [];
  constructor(readonly k: ManifoldToplevel) {}
  keep<T extends { delete(): void }>(o: T): T {
    this.owned.push(o);
    return o;
  }
  dispose() {
    for (const o of this.owned) o.delete();
    this.owned = [];
  }

  roundedRect(x: number, y: number, w: number, h: number, r: number): CrossSection {
    const rr = Math.max(0, Math.min(r, w / 2 - 0.01, h / 2 - 0.01));
    const pts: [number, number][] = [];
    if (rr <= 0.01) {
      pts.push([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
    } else {
      const seg = 8;
      const corners: [number, number, number][] = [
        [x + w - rr, y + rr, -Math.PI / 2],
        [x + w - rr, y + h - rr, 0],
        [x + rr, y + h - rr, Math.PI / 2],
        [x + rr, y + rr, Math.PI],
      ];
      for (const [cx, cy, a0] of corners) {
        for (let i = 0; i <= seg; i++) {
          const a = a0 + (i / seg) * (Math.PI / 2);
          pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
        }
      }
    }
    return this.keep(this.k.CrossSection.ofPolygons([pts]));
  }

  extrude(cs: CrossSection, z0: number, z1: number): Manifold {
    const m = this.keep(cs.extrude(z1 - z0));
    return this.keep(m.translate([0, 0, z0]));
  }

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): Manifold {
    const m = this.keep(this.k.Manifold.cube([sx, sy, sz], true));
    return this.keep(m.translate([cx, cy, cz]));
  }

  /** Cylinder centred on (cx,cy,cz) with its axis along `axis`. */
  cylinder(cx: number, cy: number, cz: number, radius: number, length: number, axis: 'x' | 'y' | 'z'): Manifold {
    let m = this.keep(this.k.Manifold.cylinder(length, radius, radius, 48, true));
    if (axis === 'x') m = this.keep(m.rotate([0, 90, 0]));
    if (axis === 'y') m = this.keep(m.rotate([90, 0, 0]));
    return this.keep(m.translate([cx, cy, cz]));
  }

  add(a: Manifold, b: Manifold): Manifold {
    return this.keep(a.add(b));
  }
  sub(a: Manifold, b: Manifold): Manifold {
    return this.keep(a.subtract(b));
  }
  union(parts: Manifold[]): Manifold {
    return this.keep(this.k.Manifold.union(parts));
  }

  toGeometry(m: Manifold): THREE.BufferGeometry {
    const mesh = m.getMesh();
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(mesh.numVert * 3);
    for (let i = 0; i < mesh.numVert; i++) {
      pos[i * 3] = mesh.vertProperties[i * mesh.numProp];
      pos[i * 3 + 1] = mesh.vertProperties[i * mesh.numProp + 1];
      pos[i * 3 + 2] = mesh.vertProperties[i * mesh.numProp + 2];
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1));
    // Flat shading: split vertices so each face gets its own normal.
    const flat = g.toNonIndexed();
    g.dispose();
    flat.computeVertexNormals();
    return flat;
  }
}

// ---------------------------------------------------------------------------
// Cut-outs

/** Size of the opening a feature needs, as seen through its side. */
export function cutoutSize(f: Feature, margin: number): { w: number; h: number } {
  const [sx, sy, sz] = f.size;
  switch (f.side) {
    case 'left':
    case 'right':
      return { w: sy + 2 * margin, h: sz + 2 * margin };
    case 'front':
    case 'back':
      return { w: sx + 2 * margin, h: sz + 2 * margin };
    default:
      return { w: sx + 2 * margin, h: sy + 2 * margin };
  }
}

function sideCutter(S: Scope, f: Feature, s: CaseSettings, L: CaseLayout): Manifold {
  const o = L.boardOrigin;
  const cx = o.x + f.x;
  const cy = o.y + f.y;
  const cz = L.boardTopZ + f.z;
  const { w, h } = cutoutSize(f, s.cutoutMargin);
  // Deep enough to pass through the wall and notch the lid lip behind it.
  const depth = s.wall + s.clearance + s.tolerance + s.lipWall + 1;
  const circle = f.shape === 'circle';
  const r = Math.max(w, h) / 2;

  switch (f.side as Side) {
    case 'left': {
      const x = depth / 2 - 1;
      return circle ? S.cylinder(x, cy, cz, r, depth, 'x') : S.box(x, cy, cz, depth, w, h);
    }
    case 'right': {
      const x = L.outerLength - depth / 2 + 1;
      return circle ? S.cylinder(x, cy, cz, r, depth, 'x') : S.box(x, cy, cz, depth, w, h);
    }
    case 'front': {
      const y = depth / 2 - 1;
      return circle ? S.cylinder(cx, y, cz, r, depth, 'y') : S.box(cx, y, cz, w, depth, h);
    }
    case 'back': {
      const y = L.outerWidth - depth / 2 + 1;
      return circle ? S.cylinder(cx, y, cz, r, depth, 'y') : S.box(cx, y, cz, w, depth, h);
    }
    case 'top': {
      const z0 = L.baseHeight - s.lipHeight - 1;
      const z1 = L.totalHeight + 1;
      const zc = (z0 + z1) / 2;
      return circle ? S.cylinder(cx, cy, zc, r, z1 - z0, 'z') : S.box(cx, cy, zc, w, h, z1 - z0);
    }
    case 'bottom': {
      const zc = s.floor / 2;
      const len = s.floor + 2;
      return circle ? S.cylinder(cx, cy, zc, r, len, 'z') : S.box(cx, cy, zc, w, h, len);
    }
  }
}

// ---------------------------------------------------------------------------
// Parts

export interface CaseParts {
  /** Which device these parts were built for (builds are debounced, so it can lag the selection). */
  deviceId: string;
  base: THREE.BufferGeometry;
  lid: THREE.BufferGeometry;
  layout: CaseLayout;
}

export function buildCase(device: Device, s: CaseSettings): CaseParts {
  if (!kernel) throw new Error('CSG kernel not initialised; await initCsg() first');
  const S = new Scope(kernel);
  try {
    return buildWith(S, device, s);
  } finally {
    S.dispose();
  }
}

function buildWith(S: Scope, device: Device, s: CaseSettings): CaseParts {
  const L = computeLayout(device, s);
  const cut = device.features.filter((f) => f.cutout);
  const o = L.boardOrigin;
  const innerR = Math.max(0.2, s.cornerRadius - s.wall);
  const outline = S.roundedRect(0, 0, L.outerLength, L.outerWidth, s.cornerRadius);

  // ---- Base: outer solid minus cavity, plus standoffs / ledges
  let base = S.sub(
    S.extrude(outline, 0, L.baseHeight),
    S.extrude(S.roundedRect(s.wall, s.wall, L.innerLength, L.innerWidth, innerR), s.floor, L.baseHeight + 1),
  );

  const supports: Manifold[] = [];
  const holes: Manifold[] = [];
  // Supports sink 0.5 mm into the floor so the union never meets a coplanar face.
  const z0 = s.floor - 0.5;
  if (device.mountingHoles.length > 0) {
    for (const h of device.mountingHoles) {
      const px = o.x + h.x;
      const py = o.y + h.y;
      const postR = Math.max(h.diameter * 1.1, s.screwHole / 2 + 1.2);
      supports.push(S.cylinder(px, py, (z0 + o.z) / 2, postR, o.z - z0, 'z'));
      const holeZ0 = s.floor + 0.6;
      holes.push(S.cylinder(px, py, (holeZ0 + o.z + 1) / 2, s.screwHole / 2, o.z + 1 - holeZ0, 'z'));
    }
  } else {
    // No holes: ledges under the two short edges. Pin headers usually run along
    // the long edges, so the short ends are the safest place to support the PCB.
    const ledge = 1.6 + s.clearance;
    const span = L.innerWidth * 0.6;
    const cy = s.wall + L.innerWidth / 2;
    const h = o.z - z0;
    supports.push(S.box(s.wall + ledge / 2 - 0.25, cy, (z0 + o.z) / 2, ledge + 0.5, span, h));
    supports.push(S.box(s.wall + L.innerLength - ledge / 2 + 0.25, cy, (z0 + o.z) / 2, ledge + 0.5, span, h));
  }
  base = S.union([base, ...supports]);

  const baseCuts = [...holes, ...cut.filter((f) => f.side !== 'top').map((f) => sideCutter(S, f, s, L))];
  if (baseCuts.length) base = S.sub(base, S.union(baseCuts));

  // ---- Lid: plate + locating lip that drops inside the walls
  let lid = S.extrude(outline, L.baseHeight, L.totalHeight);
  if (s.lipHeight > 0) {
    const lipOuterL = L.innerLength - 2 * s.tolerance;
    const lipOuterW = L.innerWidth - 2 * s.tolerance;
    const ring = S.keep(
      S.roundedRect(s.wall + s.tolerance, s.wall + s.tolerance, lipOuterL, lipOuterW, innerR).subtract(
        S.roundedRect(
          s.wall + s.tolerance + s.lipWall,
          s.wall + s.tolerance + s.lipWall,
          lipOuterL - 2 * s.lipWall,
          lipOuterW - 2 * s.lipWall,
          Math.max(0.2, innerR - s.lipWall),
        ),
      ),
    );
    lid = S.add(lid, S.extrude(ring, L.baseHeight - s.lipHeight, L.baseHeight + Math.min(0.5, s.lidThickness / 2)));
  }

  const lidCuts = cut.filter((f) => f.side !== 'bottom').map((f) => sideCutter(S, f, s, L));
  if (s.ventSlots > 0) {
    const pitch = 4;
    const span = (s.ventSlots - 1) * pitch;
    const slotLen = Math.max(4, L.innerWidth * 0.5);
    const cx = L.outerLength / 2;
    for (let i = 0; i < s.ventSlots; i++) {
      const x = cx - span / 2 + i * pitch;
      lidCuts.push(S.box(x, L.outerWidth / 2, L.totalHeight - s.lidThickness / 2, 1.6, slotLen, s.lidThickness + 2));
    }
  }
  if (lidCuts.length) lid = S.sub(lid, S.union(lidCuts));

  return { deviceId: device.id, base: S.toGeometry(base), lid: S.toGeometry(lid), layout: L };
}

/** Rotate the lid upside down so its flat top sits on the print bed. */
export function lidForPrinting(lid: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = lid.clone();
  g.rotateX(Math.PI);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  g.translate(-bb.min.x, -bb.min.y, -bb.min.z);
  return g;
}
