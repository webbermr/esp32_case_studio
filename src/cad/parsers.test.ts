import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEagle } from './eagle';
import { parseKicad } from './kicad';
import { DEVICES } from '../data/devices';
import { cadToDevice, mergeCadInto } from './toDevice';
import type { CadBoard } from './types';

const centre = (p: { min: number[]; max: number[] }) => [(p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2];

describe('KiCad', () => {
  const cad = parseKicad(readFileSync(new URL('./fixtures/tiny.kicad_pcb', import.meta.url), 'utf8'));

  it('reads the outline (y flipped so the board reads from the front)', () => {
    expect(cad.length).toBe(50);
    expect(cad.width).toBe(25);
    expect(cad.thickness).toBe(1.2);
    expect(cad.holes).toEqual([{ x: 3.5, y: 21.5, diameter: 3.2 }]);
  });

  it('places and classifies footprints, skipping passives', () => {
    expect(cad.parts.map((p) => [p.ref, p.kind, p.face])).toEqual([
      ['J1', 'usb-c', 'front'],
      ['SW1', 'button', 'back'],
    ]);
    const usb = cad.parts[0];
    const [x, y] = centre(usb);
    expect(y).toBeCloseTo(12.5, 1);
    // Rotated 270°: the 8.94 mm wide body now runs along Y.
    expect(usb.max[1] - usb.min[1]).toBeCloseTo(8.94, 2);
    expect(x).toBeLessThan(5);
    const [bx, by] = centre(cad.parts[1]);
    expect([bx, by]).toEqual([30, 20]);
  });

  it('becomes a device with the USB on the left wall and the button pressed through the back', () => {
    const d = cadToDevice(cad, { name: 'Tiny', sourceLabel: 'tiny.kicad_pcb' });
    expect(d.features.find((f) => f.kind === 'usb-c')).toMatchObject({ side: 'left', cutout: true, label: 'USB-C (J1)' });
    expect(d.features.find((f) => f.kind === 'button')).toMatchObject({ side: 'bottom', cutout: true });
    expect(d.board.heightBelow).toBeGreaterThan(0);
  });
});

const BRD =
  '/home/user/elecrow-rd/crowpanel-advanced-10.1inch-esp32-p4-hmi-ai-display-1024x600-ips-touch-screen/Eagle_SCH&PCB/1.2/ESP32-P4 Display 10.1 inch V1.2.brd';

describe.skipIf(!existsSync(BRD))('Eagle (CrowPanel V1.2)', () => {
  it('matches the STEP-measured positions (seen from the component side)', () => {
    const cad = parseEagle(readFileSync(BRD, 'utf8'));
    expect(cad.length).toBeCloseTo(247, 0);
    expect(cad.width).toBeCloseTo(147, 0);
    expect(cad.holes).toHaveLength(4);
    for (const h of cad.holes) expect(h.diameter).toBeCloseTo(3.2, 1);
    const byRef = Object.fromEntries(cad.parts.map((p) => [p.ref, p]));
    // Eagle's top is the back of this display, so Y is mirrored relative to the library entry.
    expect(centre(byRef.K3)[0]).toBeCloseTo(4.25, 0);
    expect(cad.width - centre(byRef.K3)[1]).toBeCloseTo(115.25, 0);
    expect(cad.width - centre(byRef.K4)[1]).toBeCloseTo(129.75, 0);
    expect(byRef.SW1.kind).toBe('switch');
    expect(byRef.J1.kind).toBe('usb-c');
  });

  it('merges into the library entry: flipped to match, labels and display kept', () => {
    const crow = DEVICES.find((d) => d.id === 'crowpanel-advanced-10-1-esp32-p4')!;
    const imported = cadToDevice(parseEagle(readFileSync(BRD, 'utf8')), { name: 'x', sourceLabel: 'x.brd' });
    const { device, alignment } = mergeCadInto(crow, imported, 'eagle');
    expect(alignment).toBe('turnOver');
    const reset = device.features.find((f) => f.label === 'RESET button (K4)')!;
    expect(reset.side).toBe('bottom');
    expect(reset.x).toBeCloseTo(4.25, 0);
    expect(reset.y).toBeCloseTo(129.75, 0);
    expect(device.features.find((f) => f.id === 'screen')).toBeTruthy();
    expect(device.board.heightAbove).toBe(crow.board.heightAbove);
  });
});

describe('cadToDevice', () => {
  it('handles levers, displays and edge ports', () => {
    const cad: CadBoard = {
      source: 'step',
      length: 100,
      width: 60,
      thickness: 1.6,
      holes: [],
      warnings: [],
      parts: [
        { name: 'LCD', kind: 'display', face: 'front', min: [5, 5, 0], max: [95, 55, 4], heightKnown: true },
        { name: 'USB-C', kind: 'usb-c', face: 'back', min: [93, 20, -4.9], max: [101, 29, -1.6], heightKnown: true },
        {
          name: 'MST', kind: 'switch', face: 'back', min: [50, 20, -7.6], max: [53.5, 29, -1.6], heightKnown: true,
          lever: { size: [1.5, 1.5, 2], axis: 'y', protrusion: 2 },
        },
      ],
    };
    const d = cadToDevice(cad, { name: 'X', sourceLabel: 'x.step' });
    const [disp, usb, sw] = d.features;
    expect(disp).toMatchObject({ side: 'top', opening: [84, 44] });
    expect(usb).toMatchObject({ side: 'right', cutout: true });
    expect(sw).toMatchObject({ side: 'bottom', slideAxis: 'y', leverSize: [1.5, 1.5, 2] });
    // Body only, lever removed: -5.6 .. -1.6
    expect(sw.size[2]).toBeCloseTo(4, 3);
  });
});
