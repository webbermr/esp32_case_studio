import * as THREE from 'three';
import type { Manifold } from 'manifold-3d';
import type { CaseSettings } from '../types';
import type { CaseLayout, Scope } from './caseGeometry';

/*
 * Wall mounts (built into the base) and stands (separate printed parts).
 *
 * Everything is designed in an "up-edge" frame and mapped onto the case:
 *   a = across the case, b = from the bottom edge toward the up edge,
 *   z = case height (0 = outside of the back/floor).
 */

/** Height of the bosses inside the floor that hold keyholes and the kickstand socket. */
export const MOUNT_BOSS = 4.2;

const KEYHOLE = { head: 8.5, shank: 4.4, slot: 9, channel: 2.6 };
const TAB = { length: 12, width: 16, thick: 3, hole: 4.5, sink: 9.2 };
const PEG = { r: 1.5, len: 1.8, hole: 1.7 };
const KICK = { width: 8, thick: 5, clearance: 0.2 };

export interface MountParts {
  adds: Manifold[];
  cuts: Manifold[];
  /** Separate printed parts: `part` in case coordinates, `print` in printing orientation. */
  parts: { id: string; label: string; part: Manifold; print: Manifold }[];
  warnings: string[];
}

interface EdgeFrame {
  caseW: number;
  caseH: number;
  /** (a, b, z) → case (x, y, z) */
  toCase: THREE.Matrix4;
}

function edgeFrame(s: CaseSettings, L: CaseLayout): EdgeFrame {
  const X = L.outerLength;
  const Y = L.outerWidth;
  const m = new THREE.Matrix4();
  switch (s.upEdge) {
    case 'front':
      m.set(-1, 0, 0, X, 0, -1, 0, Y, 0, 0, 1, 0, 0, 0, 0, 1);
      return { caseW: X, caseH: Y, toCase: m };
    case 'right':
      m.set(0, 1, 0, 0, -1, 0, 0, Y, 0, 0, 1, 0, 0, 0, 0, 1);
      return { caseW: Y, caseH: X, toCase: m };
    case 'left':
      m.set(0, -1, 0, X, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
      return { caseW: Y, caseH: X, toCase: m };
    default:
      return { caseW: X, caseH: Y, toCase: m.identity() };
  }
}

/**
 * Standing frame (X along the bottom edge, Y away from the viewer, Z up) →
 * case-local (a, b, z), for a case leaning back by `theta` with its
 * bottom-back corner at (Y = 0, Z = zCorner).
 */
function standingToLocal(theta: number, zCorner: number, aOffset: number): THREE.Matrix4 {
  const c = Math.cos(theta);
  const sn = Math.sin(theta);
  return new THREE.Matrix4().set(1, 0, 0, aOffset, 0, sn, c, -zCorner * c, 0, -c, sn, -zCorner * sn, 0, 0, 0, 1);
}

/** Profile drawn in (u, v) and extruded along w → standing frame (X = w, Y = u, Z = v). */
const PROFILE_TO_STANDING = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const deg = (d: number) => (d * Math.PI) / 180;

export function buildMounts(S: Scope, s: CaseSettings, L: CaseLayout): MountParts {
  const out: MountParts = { adds: [], cuts: [], parts: [], warnings: [] };
  const F = edgeFrame(s, L);
  const local = (m: Manifold) => S.transform(m, F.toCase);
  const at = (m: Manifold, x: number, y: number, z = 0) => S.keep(m.translate([x, y, z]));
  const floorTop = s.floor;

  // ---- Wall mount: keyholes in the back
  if (s.wallMount === 'keyholes') {
    const k = KEYHOLE;
    const minH = 2 * s.wall + k.head + k.slot + 4;
    if (F.caseH < minH || F.caseW < k.head + 2 * s.wall + 6) {
      out.warnings.push(`The case is too small for keyhole slots (needs ${minH.toFixed(0)} mm toward the up edge). Try screw tabs.`);
    } else {
      const b = Math.min(F.caseH * 0.62, F.caseH - s.wall - k.slot - k.head / 2 - 2);
      const spread = Math.min(F.caseW * 0.3, 80);
      const as = F.caseW < 70 ? [F.caseW / 2] : [F.caseW / 2 - spread, F.caseW / 2 + spread];
      for (const a of as) {
        const bossH = MOUNT_BOSS + 0.5;
        out.adds.push(
          local(S.box(a, b + k.slot / 2, floorTop - 0.5 + bossH / 2, k.head + 6, k.slot + k.head + 6, bossH)),
        );
        // Entry hole for the screw head, the narrow slot the shank slides along,
        // and the channel behind it that captures the head.
        const top = floorTop + k.channel;
        out.cuts.push(local(at(S.cone(-1, top, k.head / 2), a, b)));
        out.cuts.push(local(S.box(a, b + k.slot / 2, (floorTop - 1) / 2 + 0.005, k.shank, k.slot, floorTop + 1.01)));
        out.cuts.push(local(at(S.cone(-1, floorTop + 0.01, k.shank / 2), a, b + k.slot)));
        out.cuts.push(local(S.box(a, b + k.slot / 2, floorTop + k.channel / 2 - 0.005, k.head, k.slot, k.channel + 0.01)));
        out.cuts.push(local(at(S.cone(floorTop - 0.01, top, k.head / 2), a, b + k.slot)));
      }
    }
  }

  // ---- Wall mount: screw tabs on the up and down edges
  if (s.wallMount === 'tabs') {
    const t = TAB;
    const a = F.caseW / 2;
    for (const [b0, b1, hole] of [
      [-t.length, 0.6, -t.length / 2 + 1],
      [F.caseH - 0.6, F.caseH + t.length, F.caseH + t.length / 2 - 1],
    ] as const) {
      const bOuter = b0 < 0 ? b0 + t.width / 2 : b1 - t.width / 2;
      out.adds.push(local(S.union([S.box(a, (b0 + b1) / 2, t.thick / 2, t.width, b1 - b0, t.thick), at(S.cone(0, t.thick, t.width / 2), a, bOuter)])));
      out.cuts.push(local(at(S.cone(-1, t.thick + 1, t.hole / 2), a, hole)));
      // Countersink on the front face, so a flat-head screw sits flush.
      out.cuts.push(local(at(S.cone(t.thick - (t.sink - t.hole) / 2, t.thick + 0.01, t.hole / 2, t.sink / 2), a, hole)));
    }
  }

  const theta = deg(clamp(s.standAngle, 5, 45));

  // ---- Stand: wedge feet that peg into the back and tilt the case up
  if (s.stand === 'tilt-feet') {
    const b0 = F.caseH * 0.06;
    const b1 = F.caseH * 0.94;
    const h0 = 3;
    const h1 = h0 + (b1 - b0) * Math.tan(theta);
    const w = clamp(F.caseW * 0.12, 8, 14);
    const profile = S.polygon([
      [b0, 0],
      [b0, -h0],
      [b1, -h1],
      [b1, 0],
    ]);
    // Profile is (b, z) extruded along a → local (a, b, z).
    const toLocal = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
    const pegBs = [b0 + (b1 - b0) * 0.2, b0 + (b1 - b0) * 0.8];
    for (const [i, aC] of [F.caseW * 0.18, F.caseW * 0.82].entries()) {
      const wedge = S.transform(S.keep(profile.extrude(w)), new THREE.Matrix4().makeTranslation(aC - w / 2, 0, 0).multiply(toLocal));
      const pegs = pegBs.map((b) => at(S.cone(-0.5, PEG.len, PEG.r), aC, b));
      const foot = S.union([wedge, ...pegs]);
      for (const b of pegBs) out.cuts.push(local(at(S.cone(-1, floorTop + 0.5, PEG.hole), aC, b)));
      // Print standing on the face that touches the desk.
      const print = S.transform(foot, new THREE.Matrix4().makeRotationX(theta));
      out.parts.push({ id: `foot-${i}`, label: `Tilt foot ${i + 1}`, part: local(foot), print });
    }
  }

  // ---- Stand: desk cradle the case stands in, leaning back
  if (s.stand === 'cradle') {
    const T = L.totalHeight;
    const t = 4;
    const g = 0.4;
    const lipT = 4;
    const Hs = clamp(F.caseH * 0.35, 25, 70);
    const width = clamp(F.caseW * 0.5, 40, 120);
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    const Fy = -T * c;
    const Fz = t + T * sn;
    const lip0 = Fy - g - lipT;
    const supTopY = g + Hs * sn;
    const supTopZ = t + Hs * c;
    const yEnd = supTopY + 5 + 12;
    const cs = S.union2d([
      S.polygon([
        [lip0, 0],
        [yEnd, 0],
        [yEnd, t],
        [lip0, t],
      ]),
      S.polygon([
        [lip0, 0],
        [lip0 + lipT, 0],
        [lip0 + lipT, Fz + 4],
        [lip0, Fz + 4],
      ]),
      S.polygon([
        [g, 0],
        [yEnd, 0],
        [supTopY + 5, supTopZ],
        [supTopY, supTopZ],
        [g, t],
      ]),
    ]);
    const standing = S.transform(S.keep(cs.extrude(width)), PROFILE_TO_STANDING);
    const toLocal = standingToLocal(theta, t, F.caseW / 2 - width / 2);
    out.parts.push({ id: 'cradle', label: 'Desk cradle', part: local(S.transform(standing, toLocal)), print: standing });
  }

  // ---- Stand: kickstand leg that plugs into a socket in the back
  if (s.stand === 'kickstand') {
    const k = KICK;
    const d = Math.min(F.caseH * 0.62, F.caseH - s.wall - 10);
    const depth = floorTop + MOUNT_BOSS - 1.2;
    const a = F.caseW / 2;
    out.adds.push(local(S.box(a, d, floorTop - 0.5 + (MOUNT_BOSS + 0.5) / 2, k.width + 8, k.thick + 8, MOUNT_BOSS + 0.5)));
    out.cuts.push(local(S.box(a, d, (depth - 1) / 2, k.width + 2 * k.clearance, k.thick + 2 * k.clearance, depth + 1)));

    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    const P: [number, number] = [d * sn, d * c];
    const o: [number, number] = [c, -sn]; // out of the back
    const bd: [number, number] = [sn, c]; // up the back
    const pt = (sAlong: number, tAcross: number): [number, number] => [
      P[0] + sAlong * o[0] + tAcross * bd[0],
      P[1] + sAlong * o[1] + tAcross * bd[1],
    ];
    const tenonDepth = depth - 0.3;
    const Q = pt(3, 0);
    const cs = S.union2d([
      S.polygon([pt(-tenonDepth, -k.thick / 2), pt(3, -k.thick / 2), pt(3, k.thick / 2), pt(-tenonDepth, k.thick / 2)]),
      S.polygon([
        [Q[0] - 3, 0],
        [Q[0] + 3, 0],
        [Q[0] + 3, Q[1] + 2.5],
        [Q[0] - 3, Q[1] + 2.5],
      ]),
      S.polygon([
        [Q[0] - 10, 0],
        [Q[0] + 10, 0],
        [Q[0] + 10, 3],
        [Q[0] - 10, 3],
      ]),
    ]);
    const profile = S.keep(cs.extrude(k.width));
    const standing = S.transform(profile, PROFILE_TO_STANDING);
    const toLocal = standingToLocal(theta, 0, a - k.width / 2);
    // Print lying flat on its side: the profile extrusion is already that way up.
    out.parts.push({ id: 'kickstand', label: 'Kickstand', part: local(S.transform(standing, toLocal)), print: profile });
  }

  return out;
}
