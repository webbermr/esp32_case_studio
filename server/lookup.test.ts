import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCase, initCsg } from '../src/lib/caseGeometry';
import { DEFAULT_SETTINGS } from '../src/types';
import { readFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import { parseKicad } from '../src/cad/kicad';
import { cadToDevice } from '../src/cad/toDevice';
import { formatOf, lfsUrl, rawUrl } from './cadFetch';
import { BoardSchema, composeLookupDevice, toDevice } from './lookup';

const none = { slideAxis: 'none' as const, leverWidth: 0, leverHeight: 0, leverProtrusion: 0, switchTravel: 0, openingWidth: 0, openingHeight: 0 };

const sample = {
  found: true,
  notFoundReason: '',
  name: 'Wireless Tracker',
  manufacturer: 'Heltec',
  category: 'LoRa' as const,
  aliases: ['ht-it01'],
  tags: ['lora', 'gnss'],
  specs: [{ label: 'MCU', value: 'ESP32-S3' }],
  board: { length: 65, width: 28, thickness: 1.6, heightAbove: 5, heightBelow: 0 },
  mountingHoles: [{ x: 3, y: 3, diameter: 2 }, { x: 3, y: 25, diameter: 0 }],
  features: [
    { label: 'USB-C', kind: 'usb-c' as const, side: 'left' as const, x: 2.5, y: 14, z: 1.65, sizeX: 7.4, sizeY: 9, sizeZ: 3.3, cutout: true, shape: 'rect' as const, dimensioned: false, note: '', ...none },
    { label: 'Bad size', kind: 'other' as const, side: 'top' as const, x: 30, y: 14, z: 1, sizeX: 0, sizeY: -2, sizeZ: 2, cutout: false, shape: 'rect' as const, dimensioned: false, note: 'Estimated', ...none },
    { label: 'Power', kind: 'switch' as const, side: 'bottom' as const, x: 60, y: 10, z: -3, sizeX: 3.5, sizeY: 9, sizeZ: 3.4, cutout: true, shape: 'rect' as const, dimensioned: true, note: '', ...none, slideAxis: 'y' as const, leverWidth: 1.5, leverHeight: 1.5, leverProtrusion: 2, switchTravel: 2 },
  ],
  sources: [{ label: 'Wiki', url: 'https://example.com/a' }, { label: 'bogus', url: 'not a url' }],
  confidence: 'partial' as const,
  notes: '',
  cadFiles: [],
};

describe('lookup conversion', () => {
  beforeAll(() => initCsg());

  it('schema converts to a structured-output format', () => {
    expect(() => betaZodOutputFormat(BoardSchema)).not.toThrow();
    expect(BoardSchema.parse(sample)).toBeTruthy();
  });

  it('maps the model output onto a buildable Device', () => {
    const d = toDevice('heltec wireless tracker', BoardSchema.parse(sample));
    expect(d.id).toBe('lookup-heltec-wireless-tracker');
    expect(d.origin).toBe('lookup');
    expect(d.specs.MCU).toBe('ESP32-S3');
    expect(d.mountingHoles).toHaveLength(1); // zero-diameter hole dropped
    expect(d.sources.map((s) => s.url)).toEqual(['https://example.com/a']);
    expect(d.features[1].size.every((n) => n > 0)).toBe(true);
    expect(d.aliases).toContain('heltec wireless tracker');
    const sw = d.features[2];
    expect(sw).toMatchObject({ slideAxis: 'y', leverSize: [1.5, 1.5, 2], switchTravel: 2 });
    expect(d.features[0].leverSize).toBeUndefined();
    const parts = buildCase(d, DEFAULT_SETTINGS);
    expect(parts.base.getAttribute('position').count).toBeGreaterThan(0);
  });
});

describe('lookup with a CAD file', () => {
  it('turns GitHub page links into raw and LFS URLs', () => {
    const blob = 'https://github.com/Elecrow-RD/Repo/blob/master/3D%20file/board.stp';
    expect(rawUrl(blob)).toBe('https://raw.githubusercontent.com/Elecrow-RD/Repo/master/3D%20file/board.stp');
    expect(lfsUrl(rawUrl(blob))).toBe('https://media.githubusercontent.com/media/Elecrow-RD/Repo/master/3D%20file/board.stp');
    expect(formatOf('x/Board V1.2.brd')).toBe('eagle');
    expect(formatOf('model.STEP?raw=true')).toBe('step');
  });

  it('positions come from the file, names from Claude, missing parts from research', () => {
    const cad = parseKicad(readFileSync(new URL('../src/cad/fixtures/tiny.kicad_pcb', import.meta.url), 'utf8'));
    const cadDevice = cadToDevice(cad, { name: 'Tiny', sourceLabel: 'tiny.kicad_pcb' });
    const research = toDevice('tiny', BoardSchema.parse({
      ...sample,
      features: [
        { ...sample.features[0], kind: 'display', label: 'OLED', side: 'top', x: 25, y: 12, z: 2, sizeX: 20, sizeY: 10, sizeZ: 2 },
      ],
    }));
    const usb = cadDevice.features.findIndex((f) => f.kind === 'usb-c');
    const d = composeLookupDevice(
      research,
      cadDevice,
      { turnOver: false, reason: '', parts: [{ index: usb, label: 'USB-C (power)', cutout: true }] },
      { path: 'api/cad/0123456789abcdef.kicad_pcb', format: 'kicad', sourceUrl: 'https://example.com/tiny.kicad_pcb' },
    );
    expect(d.name).toBe(research.name);
    expect(d.confidence).toBe('datasheet');
    expect(d.features.find((f) => f.kind === 'usb-c')).toMatchObject({ label: 'USB-C (power)', side: 'left' });
    expect(d.features.find((f) => f.kind === 'display')?.note).toMatch(/web research/);
    expect(d.sources.at(-1)?.url).toBe('https://example.com/tiny.kicad_pcb');

    const flipped = composeLookupDevice(research, cadDevice, { turnOver: true, reason: 'display side', parts: [] });
    expect(flipped.features.find((f) => f.kind === 'button')?.side).toBe('top');
  });

  it('finds the CAD file inside a zip', async () => {
    const { fetchCad } = await import('./cadFetch');
    const kicad = readFileSync(new URL('../src/cad/fixtures/tiny.kicad_pcb', import.meta.url));
    const zip = zipSync({ 'docs/readme.txt': new TextEncoder().encode('hi'), 'pcb/tiny.kicad_pcb': new Uint8Array(kicad) });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(zip)) as typeof fetch;
    try {
      const f = await fetchCad('https://example.com/files.zip');
      expect(f).toMatchObject({ format: 'kicad', fileName: 'tiny.kicad_pcb' });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

const CROW_STEP =
  '/home/user/elecrow-rd/crowpanel-advanced-10.1inch-esp32-p4-hmi-ai-display-1024x600-ips-touch-screen/3D file/ESP32-P4-10_1-inch-20251230.stp';

describe.skipIf(!(await import('node:fs')).existsSync(CROW_STEP))('server-side STEP reading', () => {
  it('downloads (GitHub blob link) and measures a STEP model in Node', async () => {
    const { fetchCad, parseCad } = await import('./cadFetch');
    const bytes = readFileSync(CROW_STEP);
    const realFetch = globalThis.fetch;
    let asked = '';
    globalThis.fetch = (async (u: string) => {
      asked = u;
      return new Response(bytes);
    }) as typeof fetch;
    try {
      const f = await fetchCad('https://github.com/Elecrow-RD/x/blob/master/3D%20file/board.stp');
      expect(asked).toMatch(/^https:\/\/raw\.githubusercontent\.com\//);
      expect(f?.format).toBe('step');
      const cad = await parseCad(f!);
      expect(cad.holes).toHaveLength(4);
      expect(cad.parts.filter((p) => p.kind === 'button')).toHaveLength(2);
    } finally {
      globalThis.fetch = realFetch;
    }
  }, 300_000);
});
