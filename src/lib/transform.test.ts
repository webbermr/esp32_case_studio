import { describe, expect, it } from 'vitest';
import { DEVICES } from '../data/devices';
import { mirrorX, mirrorY, rotate180, rotate90, turnOver } from './transform';

const t3 = DEVICES.find((d) => d.id === 'lilygo-t3-v1-6-1')!;
/** Round every number so float noise in the source data doesn't matter. */
const norm = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x)));

describe('board transforms', () => {
  it('are their own inverse (mirrors, 180°, turn over) or cycle in 4 (90°)', () => {
    for (const fn of [mirrorX, mirrorY, rotate180, turnOver]) {
      expect(norm(fn(fn(t3)))).toEqual(norm(t3));
    }
    expect(norm(rotate90(rotate90(rotate90(rotate90(t3)))))).toEqual(norm(t3));
  });

  it('mirrors positions and swaps the side a part is reached through', () => {
    const m = mirrorX(t3);
    const usb = m.features.find((f) => f.id === 'usb')!;
    expect(usb.side).toBe('right');
    expect(usb.x).toBeCloseTo(t3.board.length - 2.4, 3);
    expect(m.mountingHoles[0].x).toBeCloseTo(2.56, 3);
  });

  it('rotates 90° counter-clockwise and swaps length/width', () => {
    const r = rotate90(t3);
    expect(r.board.length).toBe(t3.board.width);
    const usb = r.features.find((f) => f.id === 'usb')!;
    // USB was on the left edge; after a CCW quarter-turn it faces front.
    expect(usb.side).toBe('front');
    expect(usb.size[0]).toBe(t3.features.find((f) => f.id === 'usb')!.size[1]);
  });

  it('turning over moves top parts underneath', () => {
    const o = turnOver(t3);
    const rst = o.features.find((f) => f.id === 'rst')!;
    expect(rst.side).toBe('bottom');
    expect(rst.z).toBeLessThan(-t3.board.thickness);
    expect(o.board.heightBelow).toBe(t3.board.heightAbove);
  });
});
