import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEVICES, customDevice } from '../data/devices';
import { DEFAULT_SETTINGS } from '../types';
import { buildCase, computeLayout, initCsg, lidForPrinting } from './caseGeometry';
import { geometryToStl, layoutOnBed } from './exportStl';

/** Count edges not shared by exactly two triangles (0 for a closed mesh). */
function openEdges(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute('position');
  const key = (i: number) =>
    `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
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

function volume(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    v += a.dot(b.cross(c)) / 6;
  }
  return v;
}

describe('buildCase', () => {
  beforeAll(() => initCsg());

  for (const d of [...DEVICES, customDevice()]) {
    it(`builds a printable case for ${d.name}`, () => {
      const parts = buildCase(d, DEFAULT_SETTINGS);
      const L = computeLayout(d, DEFAULT_SETTINGS);
      parts.base.computeBoundingBox();
      const bb = parts.base.boundingBox!;
      expect(bb.max.x - bb.min.x).toBeCloseTo(L.outerLength, 1);
      expect(bb.max.y - bb.min.y).toBeCloseTo(L.outerWidth, 1);
      expect(bb.min.z).toBeCloseTo(0, 3);
      expect(volume(parts.base)).toBeGreaterThan(0);
      expect(volume(parts.lid)).toBeGreaterThan(0);
      // Base volume must be well below a solid block (it's hollow).
      expect(volume(parts.base)).toBeLessThan(L.outerLength * L.outerWidth * L.baseHeight * 0.8);
      const lid = lidForPrinting(parts.lid);
      lid.computeBoundingBox();
      expect(lid.boundingBox!.min.z).toBeCloseTo(0, 3);
      const stl = geometryToStl(layoutOnBed([parts.base, lid]));
      expect(stl.byteLength).toBeGreaterThan(84);
      // Every edge must be shared by exactly two triangles: watertight and printable.
      expect(openEdges(parts.base)).toBe(0);
      expect(openEdges(parts.lid)).toBe(0);
      for (const a of parts.actuators) {
        expect(openEdges(a.geometry), a.label).toBe(0);
        expect(volume(a.geometry), a.label).toBeGreaterThan(0);
        a.print.computeBoundingBox();
        expect(a.print.boundingBox!.min.z).toBeCloseTo(0, 3);
      }
    });
  }

  it('grows the cavity for parts that overhang the PCB', () => {
    const devkit = DEVICES.find((d) => d.id === 'esp32-devkitc-v4')!;
    const L = computeLayout(devkit, DEFAULT_SETTINGS);
    // 48.26 PCB + 6.04 antenna overhang (Espressif drawing)
    expect(L.innerLength - 2 * DEFAULT_SETTINGS.clearance).toBeCloseTo(54.3, 1);
  });

  it('sizes a top button plunger to pass through the lid', () => {
    const pico = DEVICES.find((d) => d.id === 'rpi-pico')!;
    const parts = buildCase(pico, DEFAULT_SETTINGS);
    expect(parts.warnings).toEqual([]);
    const plunger = parts.actuators.find((a) => a.featureId === 'bootsel')!;
    expect(plunger.type).toBe('plunger');
    plunger.geometry.computeBoundingBox();
    const bb = plunger.geometry.boundingBox!;
    const L = parts.layout;
    const btn = pico.features.find((f) => f.id === 'bootsel')!;
    // Sticks out of the lid, and its tip rests just above the button.
    expect(bb.max.z).toBeCloseTo(L.totalHeight + 1.2, 2);
    expect(bb.min.z).toBeCloseTo(L.boardTopZ + btn.z + btn.size[2] / 2 + 0.2, 2);
  });

  it('makes room for a side button plunger and a slide-switch slot', () => {
    const t3 = DEVICES.find((d) => d.id === 'lilygo-t3-v1-6-1')!;
    const parts = buildCase(t3, DEFAULT_SETTINGS);
    expect(parts.warnings).toEqual([]);
    const slider = parts.actuators.find((a) => a.featureId === 'pwr')!;
    expect(slider.type).toBe('slider');
    slider.geometry.computeBoundingBox();
    // Front wall is at y = 0; the cap must poke out past it.
    expect(slider.geometry.boundingBox!.min.y).toBeLessThan(0);

    const d1 = DEVICES.find((d) => d.id === 'lolin-d1-mini-v4')!;
    const withPlunger = computeLayout(d1, DEFAULT_SETTINGS);
    const without = computeLayout(
      { ...d1, features: d1.features.map((f) => ({ ...f, actuator: false })) },
      DEFAULT_SETTINGS,
    );
    expect(withPlunger.outerWidth).toBeGreaterThan(without.outerWidth);
  });

  it('skips actuators when switched off', () => {
    const pico = DEVICES.find((d) => d.id === 'rpi-pico')!;
    const off = { ...pico, features: pico.features.map((f) => ({ ...f, actuator: false })) };
    expect(buildCase(off, DEFAULT_SETTINGS).actuators).toEqual([]);
  });

  it('keeps the PCB above parts on its underside', () => {
    const d = { ...customDevice(), board: { ...customDevice().board, heightBelow: 9 } };
    const L = computeLayout(d, DEFAULT_SETTINGS);
    expect(L.standoff).toBeGreaterThanOrEqual(9);
  });
});
