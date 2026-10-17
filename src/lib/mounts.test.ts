import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEVICES } from '../data/devices';
import { DEFAULT_SETTINGS, type CaseSettings } from '../types';
import { buildCase, computeLayout, initCsg } from './caseGeometry';
import { MOUNT_BOSS } from './mounts';

function openEdges(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute('position');
  const key = (i: number) => `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
  const counts = new Map<string, number>();
  for (let t = 0; t < pos.count; t += 3) {
    const k = [key(t), key(t + 1), key(t + 2)];
    for (let e = 0; e < 3; e++) {
      const a = k[e], b = k[(e + 1) % 3];
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const c of counts.values()) if (c % 2 !== 0) open++;
  return open;
}

const bbox = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};

const boards = ['rpi-pico', 'heltec-wifi-lora-32-v3', 'crowpanel-advanced-10-1-esp32-p4'].map((id) => DEVICES.find((d) => d.id === id)!);
const variants: Partial<CaseSettings>[] = [
  { wallMount: 'keyholes' },
  { wallMount: 'tabs' },
  { wallMount: 'tabs', upEdge: 'right' },
  { stand: 'tilt-feet' },
  { stand: 'cradle' },
  { stand: 'kickstand', upEdge: 'left' },
  { wallMount: 'keyholes', stand: 'kickstand', upEdge: 'front', standAngle: 30 },
];

describe('wall mounts and stands', () => {
  beforeAll(() => initCsg());

  for (const d of boards) {
    for (const v of variants) {
      it(`${d.id} ${JSON.stringify(v)} builds watertight parts`, () => {
        const s = { ...DEFAULT_SETTINGS, ...v };
        const parts = buildCase(d, s);
        expect(openEdges(parts.base)).toBe(0);
        for (const e of parts.extras) {
          expect(openEdges(e.geometry), e.label).toBe(0);
          expect(openEdges(e.print), e.label).toBe(0);
        }
        if (v.stand === 'tilt-feet') expect(parts.extras).toHaveLength(2);
        if (v.stand === 'cradle' || v.stand === 'kickstand') expect(parts.extras).toHaveLength(1);
      });
    }
  }

  it('lifts the board over keyhole bosses', () => {
    const d = boards[1];
    const plain = computeLayout(d, DEFAULT_SETTINGS);
    const keyed = computeLayout(d, { ...DEFAULT_SETTINGS, wallMount: 'keyholes' });
    expect(keyed.standoff).toBeCloseTo(Math.max(DEFAULT_SETTINGS.standoff, d.board.heightBelow + 0.5 + MOUNT_BOSS), 5);
    expect(keyed.standoff).toBeGreaterThanOrEqual(plain.standoff);
  });

  it('puts screw tabs beyond the up and down edges', () => {
    const d = boards[0];
    const L = computeLayout(d, DEFAULT_SETTINGS);
    const back = bbox(buildCase(d, { ...DEFAULT_SETTINGS, wallMount: 'tabs' }).base);
    expect(back.min.y).toBeCloseTo(-12, 1);
    expect(back.max.y).toBeCloseTo(L.outerWidth + 12, 1);
    const right = bbox(buildCase(d, { ...DEFAULT_SETTINGS, wallMount: 'tabs', upEdge: 'right' }).base);
    expect(right.min.x).toBeCloseTo(-12, 1);
    expect(right.max.x).toBeCloseTo(L.outerLength + 12, 1);
  });

  it('cuts keyholes through the back', () => {
    const d = boards[2];
    const parts = buildCase(d, { ...DEFAULT_SETTINGS, wallMount: 'keyholes' });
    // Two keyholes for a wide case: count downward-facing triangles on the outside of the
    // floor that are missing compared to a plain case, via the floor's area.
    const floorArea = (g: THREE.BufferGeometry) => {
      const p = g.getAttribute('position');
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      let area = 0;
      for (let i = 0; i < p.count; i += 3) {
        a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
        if (Math.abs(a.z) + Math.abs(b.z) + Math.abs(c.z) > 1e-6) continue;
        area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
      }
      return area;
    };
    const plain = floorArea(buildCase(d, DEFAULT_SETTINGS).base);
    const keyed = floorArea(parts.base);
    // Entry hole + the slot beyond it + the slot's round end.
    const oneKeyhole = Math.PI * 4.25 ** 2 + 4.4 * (9 - 4.25) + (Math.PI * 2.2 ** 2) / 2;
    expect((plain - keyed) / oneKeyhole).toBeCloseTo(2, 0);
  });

  it('stands the cradle and kickstand on the desk and keeps them out of the case', () => {
    const d = boards[2];
    for (const stand of ['cradle', 'kickstand'] as const) {
      const parts = buildCase(d, { ...DEFAULT_SETTINGS, stand });
      const e = parts.extras[0];
      // Printing orientation sits on the bed.
      const pb = bbox(e.print);
      expect(pb.max.z - pb.min.z).toBeGreaterThan(3);
      // In case coordinates, the stand stays behind the back (z <= small) except the tenon/lip.
      const cb = bbox(e.geometry);
      expect(cb.min.z).toBeLessThan(0);
    }
  });
});
