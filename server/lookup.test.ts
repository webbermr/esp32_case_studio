import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCase, initCsg } from '../src/lib/caseGeometry';
import { DEFAULT_SETTINGS } from '../src/types';
import { BoardSchema, toDevice } from './lookup';

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
    { label: 'USB-C', kind: 'usb-c' as const, side: 'left' as const, x: 2.5, y: 14, z: 1.65, sizeX: 7.4, sizeY: 9, sizeZ: 3.3, cutout: true, shape: 'rect' as const, dimensioned: false, note: '' },
    { label: 'Bad size', kind: 'other' as const, side: 'top' as const, x: 30, y: 14, z: 1, sizeX: 0, sizeY: -2, sizeZ: 2, cutout: false, shape: 'rect' as const, dimensioned: false, note: 'Estimated' },
  ],
  sources: [{ label: 'Wiki', url: 'https://example.com/a' }, { label: 'bogus', url: 'not a url' }],
  confidence: 'partial' as const,
  notes: '',
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
    const parts = buildCase(d, DEFAULT_SETTINGS);
    expect(parts.base.getAttribute('position').count).toBeGreaterThan(0);
  });
});
