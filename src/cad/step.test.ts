import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { analyzeStep, type OcctResult } from './step';

// Elecrow's CrowPanel 10.1" STEP model isn't in the repo (20 MB). Point
// CROWPANEL_STEP at it to run this test.
const STEP =
  process.env.CROWPANEL_STEP ??
  '/home/user/elecrow-rd/crowpanel-advanced-10.1inch-esp32-p4-hmi-ai-display-1024x600-ips-touch-screen/3D file/ESP32-P4-10_1-inch-20251230.stp';

describe.skipIf(!existsSync(STEP))('STEP analysis (CrowPanel 10.1")', () => {
  it('finds the PCB, holes and parts where the library entry has them', async () => {
    const occt = createRequire(import.meta.url)('occt-import-js');
    const m = await occt();
    const res = m.ReadStepFile(new Uint8Array(readFileSync(STEP)), null) as OcctResult;
    const { board, mesh } = analyzeStep(res);
    if (process.env.DEBUG_STEP) console.log(JSON.stringify({ ...board, parts: board.parts.filter((p) => p.kind).map((p) => [p.kind, p.face, p.name.slice(0, 30), p.min, p.max, p.lever]) }, null, 1));
    expect(board.length).toBeCloseTo(247, 1);
    expect(board.width).toBeCloseTo(147, 1);
    expect(board.thickness).toBeCloseTo(1.7, 2);
    expect(board.holes.map((h) => [h.x, h.y, h.diameter])).toEqual([
      [3, 3, 3.2],
      [244, 3, 3.2],
      [3, 144, 3.2],
      [244, 144, 3.2],
    ]);
    const centre = (p: { min: number[]; max: number[] }) => [(p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2];
    const buttons = board.parts.filter((p) => p.kind === 'button').map(centre).sort((a, b) => a[1] - b[1]);
    expect(buttons).toHaveLength(2);
    expect(buttons[0][0]).toBeCloseTo(4.25, 1);
    expect(buttons[0][1]).toBeCloseTo(115.25, 1);
    expect(buttons[1][1]).toBeCloseTo(129.75, 1);
    expect(board.parts.filter((p) => p.kind === 'button').every((p) => p.face === 'back')).toBe(true);
    const sw = board.parts.find((p) => p.kind === 'switch')!;
    expect(sw.face).toBe('back');
    expect(sw.lever).toMatchObject({ axis: 'y' });
    expect(sw.lever!.protrusion).toBeCloseTo(2, 1);
    const usb = board.parts.filter((p) => p.kind === 'usb-c');
    expect(usb).toHaveLength(2);
    expect(usb.every((p) => p.max[0] > 247)).toBe(true); // overhangs the right edge
    const disp = board.parts.find((p) => p.kind === 'display')!;
    expect(disp.face).toBe('front');
    expect(disp.max[0] - disp.min[0]).toBeCloseTo(235, 0);
    expect(mesh.indices.length).toBeGreaterThan(1000);
  }, 300_000);
});
