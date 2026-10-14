import * as THREE from 'three';
import Module, { type CrossSection, type Manifold, type ManifoldToplevel } from 'manifold-3d';
import type { CaseSettings, Device, Feature, Side } from '../types';
import { buildMounts, MOUNT_BOSS } from './mounts';

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
  // The PCB must clear anything hanging off its underside, and leave room for
  // the collar of any plunger that presses a button through the floor.
  // Keyhole and kickstand bosses stand up from the floor, so lift the board over them.
  const floorBoss = s.wallMount === 'keyholes' || s.stand === 'kickstand' ? MOUNT_BOSS : 0;
  let standoff = Math.max(s.standoff, b.heightBelow + 0.5 + floorBoss);
  for (const f of device.features) {
    if (!usesActuator(f) || f.kind !== 'button' || f.side !== 'bottom') continue;
    const faceBelowPcb = -(f.z - f.size[2] / 2) - b.thickness;
    standoff = Math.max(standoff, plungerDims(f).need - faceBelowPcb);
  }
  const boardTopZ = s.floor + standoff + b.thickness;
  let baseHeight = boardTopZ + b.heightAbove + s.topClearance;

  // Button plungers need room between the button and the wall for their
  // retaining collar. Grow the cavity (or raise the lid) where they don't fit.
  for (const f of device.features) {
    if (!usesActuator(f) || f.kind !== 'button') continue;
    const need = plungerDims(f).need;
    const [sx, sy, sz] = f.size;
    switch (f.side) {
      case 'top':
        baseHeight = Math.max(baseHeight, boardTopZ + f.z + sz / 2 + need);
        break;
      case 'left':
        e.minX = Math.min(e.minX, f.x - sx / 2 - (need - s.clearance));
        break;
      case 'right':
        e.maxX = Math.max(e.maxX, f.x + sx / 2 + (need - s.clearance));
        break;
      case 'front':
        e.minY = Math.min(e.minY, f.y - sy / 2 - (need - s.clearance));
        break;
      case 'back':
        e.maxY = Math.max(e.maxY, f.y + sy / 2 + (need - s.clearance));
        break;
    }
  }

  const innerLength = e.maxX - e.minX + 2 * s.clearance;
  const innerWidth = e.maxY - e.minY + 2 * s.clearance;
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
export class Scope {
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

  polygon(pts: [number, number][]): CrossSection {
    // Manifold fills counter-clockwise contours; flip clockwise ones.
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      area += x0 * y1 - x1 * y0;
    }
    return this.keep(this.k.CrossSection.ofPolygons([area < 0 ? [...pts].reverse() : pts]));
  }

  union2d(parts: CrossSection[]): CrossSection {
    return this.keep(this.k.CrossSection.union(parts));
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

  /** Cylinder/cone along +Z from z0 to z1 (radii r0 at z0, r1 at z1). */
  cone(z0: number, z1: number, r0: number, r1 = r0): Manifold {
    const m = this.keep(this.k.Manifold.cylinder(z1 - z0, r0, r1, 48, false));
    return this.keep(m.translate([0, 0, z0]));
  }

  transform(m: Manifold, mat: THREE.Matrix4): Manifold {
    return this.keep(m.transform(mat.elements as unknown as Parameters<Manifold['transform']>[0]));
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
  if (f.opening) return { w: f.opening[0], h: f.opening[1] };
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
// Printed actuators: button plungers and slide-switch caps

/** Radial clearance between a plunger and its hole. */
const PLUNGER_CLEARANCE = 0.3;
/** Gap between the plunger tip and the button at rest. */
const REST_GAP = 0.2;
/** Gap between the collar and the wall: how far the plunger can be pushed. */
const TRAVEL_GAP = 0.5;
const COLLAR_FLAT = 0.8;
/** Collar overhang; chamfered at 45° so it prints without supports. */
const COLLAR_STEP = 1.2;
/** How far a plunger or switch cap sticks out of the case. */
const PROTRUDE = 1.2;
const CAP_WALL = 1.0;
const POCKET_CLEARANCE = 0.15;
const SLOT_CLEARANCE = 0.25;

export const DEFAULT_TRAVEL = 2;
export const DEFAULT_LEVER: [number, number, number] = [1.5, 1.5, 1.5];

export function usesActuator(f: Feature): boolean {
  return f.cutout && (f.kind === 'button' || f.kind === 'switch') && f.actuator !== false;
}

/** The two body dimensions across the axis the part is pressed along. */
function lateralSize(f: Feature): [number, number] {
  const [sx, sy, sz] = f.size;
  if (f.side === 'top' || f.side === 'bottom') return [sx, sy];
  if (f.side === 'left' || f.side === 'right') return [sy, sz];
  return [sx, sz];
}

export function plungerDims(f: Feature) {
  // Size from the button's narrower side: a body measured with its solder legs is longer than the cap.
  const d = f.plungerDiameter ?? Math.min(7, Math.max(3, 0.8 * Math.min(...lateralSize(f))));
  return { d, need: REST_GAP + COLLAR_FLAT + COLLAR_STEP + TRAVEL_GAP };
}

interface PartFrame {
  /** local X = slide direction, local Y = height, local Z = outward normal */
  matrix: THREE.Matrix4;
  /** Distance along the normal from the part's face to the inside of the wall/lid. */
  inner: number;
  /** ...and to the outside surface. */
  outer: number;
  wallName: string;
}

function partFrame(f: Feature, s: CaseSettings, L: CaseLayout): PartFrame {
  const o = L.boardOrigin;
  const c = new THREE.Vector3(o.x + f.x, o.y + f.y, L.boardTopZ + f.z);
  const [sx, sy, sz] = f.size;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  let t: THREE.Vector3, w: THREE.Vector3, n: THREE.Vector3, face: THREE.Vector3;
  let inner: number, outer: number, wallName: string;
  switch (f.side) {
    case 'top':
      [t, w, n] = f.slideAxis === 'y' ? [V(0, 1, 0), V(-1, 0, 0), V(0, 0, 1)] : [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)];
      face = c.clone().setZ(c.z + sz / 2);
      inner = L.baseHeight - face.z;
      outer = L.totalHeight - face.z;
      wallName = 'lid';
      break;
    case 'bottom':
      [t, w, n] = f.slideAxis === 'y' ? [V(0, 1, 0), V(1, 0, 0), V(0, 0, -1)] : [V(1, 0, 0), V(0, -1, 0), V(0, 0, -1)];
      face = c.clone().setZ(c.z - sz / 2);
      inner = face.z - s.floor;
      outer = face.z;
      wallName = 'floor';
      break;
    case 'left':
      [t, w, n] = [V(0, 1, 0), V(0, 0, -1), V(-1, 0, 0)];
      face = c.clone().setX(c.x - sx / 2);
      inner = face.x - s.wall;
      outer = face.x;
      wallName = 'left wall';
      break;
    case 'right':
      [t, w, n] = [V(0, 1, 0), V(0, 0, 1), V(1, 0, 0)];
      face = c.clone().setX(c.x + sx / 2);
      inner = L.outerLength - s.wall - face.x;
      outer = L.outerLength - face.x;
      wallName = 'right wall';
      break;
    case 'front':
      [t, w, n] = [V(1, 0, 0), V(0, 0, 1), V(0, -1, 0)];
      face = c.clone().setY(c.y - sy / 2);
      inner = face.y - s.wall;
      outer = face.y;
      wallName = 'front wall';
      break;
    default:
      [t, w, n] = [V(1, 0, 0), V(0, 0, -1), V(0, 1, 0)];
      face = c.clone().setY(c.y + sy / 2);
      inner = L.outerWidth - s.wall - face.y;
      outer = L.outerWidth - face.y;
      wallName = 'back wall';
  }
  const matrix = new THREE.Matrix4().makeBasis(t, w, n).setPosition(face);
  return { matrix, inner, outer, wallName };
}

export interface Actuator {
  featureId: string;
  label: string;
  type: 'plunger' | 'slider';
  /** In case coordinates, assembled. */
  geometry: THREE.BufferGeometry;
  /** Same part laid flat on the bed for printing. */
  print: THREE.BufferGeometry;
  /** Lives in the lid (moves with it in the exploded view). */
  inLid: boolean;
}

interface ActuatorPlan {
  part: Manifold;
  cutter: Manifold;
  type: Actuator['type'];
  warning?: string;
}

function planActuator(S: Scope, f: Feature, s: CaseSettings, L: CaseLayout): ActuatorPlan | { warning: string } {
  const fr = partFrame(f, s, L);

  if (f.kind === 'button') {
    const { d } = plungerDims(f);
    const r = d / 2;
    const collarTop = fr.inner - TRAVEL_GAP;
    let flat = COLLAR_FLAT;
    let step = COLLAR_STEP;
    const avail = collarTop - REST_GAP;
    if (avail < flat + step) {
      step = Math.min(step, avail - 0.4);
      flat = avail - step;
    }
    if (step < 0.4) {
      return {
        warning: `${f.label}: not enough room between the button and the ${fr.wallName} for a plunger; using a plain hole.`,
      };
    }
    const collarBottom = collarTop - flat - step;
    const local = S.union([
      S.cone(REST_GAP, fr.outer + PROTRUDE, r),
      S.cone(collarBottom, collarBottom + flat, r + step),
      S.cone(collarBottom + flat, collarTop, r + step, r),
    ]);
    const hole = S.cone(fr.inner - 0.6, fr.outer + 1, r + PLUNGER_CLEARANCE);
    return { part: S.transform(local, fr.matrix), cutter: S.transform(hole, fr.matrix), type: 'plunger' };
  }

  // Slide switch: a cap that pushes onto the lever and pokes out through a slot.
  const [lw, lh, ll] = f.leverSize ?? DEFAULT_LEVER;
  const travel = f.switchTravel ?? DEFAULT_TRAVEL;
  const pw = lw + 2 * POCKET_CLEARANCE;
  const ph = lh + 2 * POCKET_CLEARANCE;
  const cw = pw + 2 * CAP_WALL;
  const ch = ph + 2 * CAP_WALL;
  const capStart = 0.3; // leave a gap to the switch body
  const capEnd = fr.outer + PROTRUDE + 0.8;
  const cap = S.sub(
    S.box(0, 0, (capStart + capEnd) / 2, cw, ch, capEnd - capStart),
    S.box(0, 0, (capStart - 1 + ll) / 2, pw, ph, ll - capStart + 1 + 0.01),
  );
  const slotLen = cw + travel + 2 * SLOT_CLEARANCE;
  const slotH = ch + 2 * SLOT_CLEARANCE;
  const slotDepth = fr.outer - fr.inner + 2;
  const slot = S.box(0, 0, fr.inner + slotDepth / 2 - 1, slotLen, slotH, slotDepth);
  return { part: S.transform(cap, fr.matrix), cutter: S.transform(slot, fr.matrix), type: 'slider' };
}

/** Stand a part on its outer end so it prints without supports. */
function printOrientation(g: THREE.BufferGeometry, f: Feature, s: CaseSettings, L: CaseLayout): THREE.BufferGeometry {
  const fr = partFrame(f, s, L);
  const p = g.clone();
  // Back to the part's local frame (outward = +Z), then flip so outward faces the bed.
  p.applyMatrix4(fr.matrix.clone().invert());
  p.rotateX(Math.PI);
  p.computeBoundingBox();
  const bb = p.boundingBox!;
  p.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
  return p;
}

// ---------------------------------------------------------------------------
// Parts

export interface CaseParts {
  /** Which device these parts were built for (builds are debounced, so it can lag the selection). */
  deviceId: string;
  base: THREE.BufferGeometry;
  lid: THREE.BufferGeometry;
  actuators: Actuator[];
  /** Stands and other loose printed parts. */
  extras: ExtraPart[];
  warnings: string[];
  layout: CaseLayout;
}

export interface ExtraPart {
  id: string;
  label: string;
  /** Case coordinates (for the viewer). */
  geometry: THREE.BufferGeometry;
  /** Printing orientation (not yet placed on the bed). */
  print: THREE.BufferGeometry;
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
  const o = L.boardOrigin;
  const warnings: string[] = [];

  // Buttons/switches with a printed actuator get the actuator's hole or slot
  // instead of the plain cut-out.
  const actuatorPlans = new Map<string, ActuatorPlan>();
  for (const f of device.features) {
    if (!usesActuator(f)) continue;
    const plan = planActuator(S, f, s, L);
    if ('part' in plan) actuatorPlans.set(f.id, plan);
    if (plan.warning) warnings.push(plan.warning);
  }
  const cutterFor = (f: Feature) => actuatorPlans.get(f.id)?.cutter ?? sideCutter(S, f, s, L);
  const cut = device.features.filter((f) => f.cutout);
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
  const mounts = buildMounts(S, s, L);
  warnings.push(...mounts.warnings);
  base = S.union([base, ...supports, ...mounts.adds]);

  const baseCuts = [...holes, ...mounts.cuts, ...cut.filter((f) => f.side !== 'top').map(cutterFor)];
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

  const lidCuts = cut.filter((f) => f.side !== 'bottom').map(cutterFor);
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

  const actuators: Actuator[] = [];
  for (const f of device.features) {
    const plan = actuatorPlans.get(f.id);
    if (!plan) continue;
    const geometry = S.toGeometry(plan.part);
    actuators.push({
      featureId: f.id,
      label: f.label,
      type: plan.type,
      geometry,
      print: printOrientation(geometry, f, s, L),
      inLid: f.side === 'top',
    });
  }

  return {
    deviceId: device.id,
    base: S.toGeometry(base),
    lid: S.toGeometry(lid),
    actuators,
    extras: mounts.parts.map((p) => ({ id: p.id, label: p.label, geometry: S.toGeometry(p.part), print: S.toGeometry(p.print) })),
    warnings,
    layout: L,
  };
}

// ---------------------------------------------------------------------------
// Fit-check plate: a thin board-sized plate with a hole at every part, to print
// in a few minutes and lay on the real board before printing the whole case.

export const FIT_CHECK_THICKNESS = 1.2;
const FIT_KINDS = new Set(['usb-c', 'micro-usb', 'usb-a', 'button', 'switch', 'led', 'sma', 'ufl', 'jst', 'sd', 'barrel', 'battery']);

export function buildFitCheck(device: Device): THREE.BufferGeometry {
  if (!kernel) throw new Error('CSG kernel not initialised; await initCsg() first');
  const S = new Scope(kernel);
  try {
    const { length: Lb, width: Wb } = device.board;
    const t = FIT_CHECK_THICKNESS;
    let plate = S.extrude(S.roundedRect(0, 0, Lb, Wb, 1), 0, t);
    const cuts: Manifold[] = [];
    const zc = t / 2;
    const h = t + 2;

    for (const m of device.mountingHoles) cuts.push(S.cylinder(m.x, m.y, zc, m.diameter / 2, h, 'z'));

    // Orientation key: chamfered corner at the origin (front-left, seen from the top).
    cuts.push(S.extrude(S.polygon([[-1, -1], [6, -1], [-1, 6]]), -1, t + 1));

    const notch = 2.5;
    for (const f of device.features) {
      const [sx, sy] = f.size;
      const big = sx * sy > 0.3 * Lb * Wb;
      if (big || !(f.cutout || FIT_KINDS.has(f.kind))) continue;
      const pad = 0.3;
      switch (f.side) {
        case 'left':
          cuts.push(S.box(notch / 2 - 1, f.y, zc, notch + 2, sy + 2 * pad, h));
          break;
        case 'right':
          cuts.push(S.box(Lb - notch / 2 + 1, f.y, zc, notch + 2, sy + 2 * pad, h));
          break;
        case 'front':
          cuts.push(S.box(f.x, notch / 2 - 1, zc, sx + 2 * pad, notch + 2, h));
          break;
        case 'back':
          cuts.push(S.box(f.x, Wb - notch / 2 + 1, zc, sx + 2 * pad, notch + 2, h));
          break;
        default:
          cuts.push(
            f.shape === 'circle'
              ? S.cylinder(f.x, f.y, zc, Math.max(sx, sy) / 2 + pad, h, 'z')
              : S.box(f.x, f.y, zc, sx + 2 * pad, sy + 2 * pad, h),
          );
      }
    }
    if (cuts.length) plate = S.sub(plate, S.union(cuts));
    return S.toGeometry(plate);
  } finally {
    S.dispose();
  }
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
