import type { Device } from '../types';

export const DEVICES: Device[] = [
  {
    id: 'rpi-pico',
    name: 'Raspberry Pi Pico',
    manufacturer: 'Raspberry Pi',
    category: 'RP2040',
    aliases: ['pico', 'rp2040'],
    tags: [],
    specs: { MCU: 'RP2040' },
    board: { length: 51, width: 21, thickness: 1, heightAbove: 3.2, heightBelow: 0 },
    mountingHoles: [
      { x: 2, y: 4.8, diameter: 2.1 },
      { x: 2, y: 16.2, diameter: 2.1 },
      { x: 49, y: 4.8, diameter: 2.1 },
      { x: 49, y: 16.2, diameter: 2.1 },
    ],
    features: [
      { id: 'usb', label: 'Micro-USB', kind: 'micro-usb', side: 'left', x: 1.5, y: 10.5, z: 1.4, size: [5, 8, 2.8], cutout: true },
      { id: 'btn', label: 'BOOTSEL', kind: 'button', side: 'top', x: 12, y: 13, z: 1, size: [3.5, 4.5, 2], cutout: true, shape: 'circle' },
    ],
    sources: [],
    confidence: 'partial',
  },
];

export function customDevice(): Device {
  return {
    id: 'custom',
    name: 'Custom board',
    manufacturer: 'Your measurements',
    category: 'Other',
    aliases: [],
    tags: [],
    specs: { Note: 'Enter your own dimensions' },
    board: { length: 50, width: 25, thickness: 1.6, heightAbove: 4, heightBelow: 0 },
    mountingHoles: [],
    features: [
      { id: 'usb', label: 'USB', kind: 'usb-c', side: 'left', x: 1, y: 12.5, z: 1.6, size: [7.4, 9, 3.2], cutout: true },
    ],
    sources: [],
    confidence: 'estimated',
  };
}
