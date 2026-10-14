import type { Device, Feature } from '../types';

/*
 * Board library.
 *
 * PCB outlines and mounting holes come from the manufacturer drawings/datasheets
 * linked in each entry's `sources`. Where a source doesn't dimension a part
 * (most buttons, LEDs and some connectors) its position is estimated from the
 * drawing image and the part carries a `note` saying so. Connector body sizes
 * are typical values for that connector type, not per-board measurements.
 *
 * Coordinates: see src/types.ts. Every board is oriented with its USB end at
 * x = 0 (the case's left wall).
 */

// Typical connector bodies [x depth, y width, z height]
const MICRO_USB: [number, number, number] = [5.8, 7.6, 2.8];
const USB_C: [number, number, number] = [7.4, 9.0, 3.3];
const SMA_BULKHEAD: [number, number, number] = [3, 6.5, 6.5];

const EST = 'Position estimated from the manufacturer drawing image (not dimensioned).';
const UNKNOWN = 'Position not documented by the manufacturer. Measure your board and set it, then tick to cut.';
const HEADERS_DOWN =
  'Ships with pin headers soldered pointing down, so the case leaves 8.5 mm under the PCB. Set "Tallest part below" to ~2 if you remove them.';

/** A round hole for an SMA bulkhead antenna in the case wall. Not a board part. */
function smaBulkhead(side: Feature['side'], x: number, y: number, z: number): Feature {
  return {
    id: 'sma-bulkhead',
    label: 'Antenna bulkhead hole (SMA)',
    kind: 'sma',
    side,
    x,
    y,
    z,
    size: side === 'left' || side === 'right' ? SMA_BULKHEAD : [SMA_BULKHEAD[1], SMA_BULKHEAD[0], SMA_BULKHEAD[2]],
    cutout: true,
    shape: 'circle',
    note: 'Optional 6.5 mm hole for a U.FL-to-SMA pigtail bulkhead. Move it or untick it as needed.',
  };
}

export const DEVICES: Device[] = [
  // ------------------------------------------------------------------ ESP32
  {
    id: 'esp32-devkitc-v4',
    name: 'ESP32-DevKitC V4',
    manufacturer: 'Espressif',
    category: 'ESP32',
    aliases: ['devkitc', 'esp32 devkit', 'wroom-32', 'esp32-wroom-32e', 'devkit v4'],
    tags: ['wifi', 'bluetooth', 'esp32'],
    specs: {
      Module: 'ESP32-WROOM-32E (or -32UE / WROVER-E variants)',
      USB: 'Micro-USB (USB-UART bridge)',
      Buttons: 'EN (reset), Boot',
      Antenna: 'PCB antenna on module; U variants have a U.FL connector',
      Headers: '2 × 19 pins, 2.54 mm pitch, rows 25.4 mm apart',
      'Antenna overhang': '6.04 mm past the PCB edge',
    },
    board: { length: 48.26, width: 27.94, thickness: 1.6, heightAbove: 3.3, heightBelow: 8.5 },
    mountingHoles: [],
    features: [
      { id: 'usb', label: 'Micro-USB', kind: 'micro-usb', side: 'left', x: 2.4, y: 13.97, z: 1.4, size: MICRO_USB, cutout: true },
      { id: 'en', label: 'EN (reset) button', kind: 'button', side: 'top', x: 4.5, y: 22.5, z: 1, size: [4, 3, 2], cutout: true, shape: 'circle', note: EST },
      { id: 'boot', label: 'Boot button', kind: 'button', side: 'top', x: 4.5, y: 5.4, z: 1, size: [4, 3, 2], cutout: true, shape: 'circle', note: EST },
      {
        id: 'module', label: 'WROOM-32 module (antenna end)', kind: 'module', side: 'top',
        x: 48.26 + 6.04 - 12.75, y: 13.97, z: 1.55, size: [25.5, 18, 3.1], cutout: false,
        note: 'Module is 18 × 25.5 mm; its antenna overhangs the PCB by 6.04 mm (Espressif drawing). The case is lengthened to fit it.',
      },
    ],
    sources: [
      { label: 'User guide', url: 'https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html' },
      { label: 'Dimension drawing (PDF)', url: 'https://dl.espressif.com/dl/schematics/esp32_devkitc_v4_dimensions.pdf' },
    ],
    confidence: 'partial',
    notes: `PCB thickness and part heights are not published; typical values used. ${HEADERS_DOWN}`,
  },
  {
    id: 'esp32-s3-devkitc-1',
    name: 'ESP32-S3-DevKitC-1 v1.1',
    manufacturer: 'Espressif',
    category: 'ESP32',
    aliases: ['s3 devkitc', 'esp32s3 devkit', 'esp32-s3-wroom-1'],
    tags: ['wifi', 'bluetooth', 'esp32-s3', 'usb otg'],
    specs: {
      Module: 'ESP32-S3-WROOM-1 / WROOM-2 (WROOM-1U has U.FL)',
      USB: '2 × Micro-USB: UART and native USB (OTG)',
      Buttons: 'Boot, Reset',
      LED: 'RGB LED on GPIO38 (v1.1)',
      Headers: '2 rows, 2.54 mm pitch',
    },
    board: { length: 62.74, width: 25.4, thickness: 1.6, heightAbove: 3.3, heightBelow: 8.5 },
    mountingHoles: [],
    features: [
      { id: 'usb-uart', label: 'Micro-USB (UART)', kind: 'micro-usb', side: 'left', x: 2.4, y: 18.4, z: 1.4, size: MICRO_USB, cutout: true, note: EST },
      { id: 'usb-otg', label: 'Micro-USB (native USB)', kind: 'micro-usb', side: 'left', x: 2.4, y: 7.0, z: 1.4, size: MICRO_USB, cutout: true, note: EST },
      { id: 'boot', label: 'Boot button', kind: 'button', side: 'top', x: 8.5, y: 18.4, z: 1, size: [4, 3, 2], cutout: true, shape: 'circle', note: EST },
      { id: 'rst', label: 'Reset button', kind: 'button', side: 'top', x: 8.5, y: 7.0, z: 1, size: [4, 3, 2], cutout: true, shape: 'circle', note: EST },
      { id: 'led', label: 'RGB LED', kind: 'led', side: 'top', x: 13, y: 12.7, z: 0.5, size: [1.6, 1.6, 1], cutout: false, note: EST },
      {
        id: 'module', label: 'WROOM-1 module (antenna end)', kind: 'module', side: 'top',
        x: 62.74 + 6.3 - 12.75, y: 12.7, z: 1.55, size: [25.5, 18, 3.1], cutout: false,
        note: 'Antenna overhang (~6.3 mm) measured from Espressif DXF.',
      },
    ],
    sources: [
      { label: 'User guide v1.1', url: 'https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html' },
      { label: 'Dimension drawing (PDF)', url: 'https://dl.espressif.com/dl/schematics/esp_idf/DXF_ESP32-S3-DevKitC-1_V1.1_20220429.pdf' },
    ],
    confidence: 'partial',
    notes: HEADERS_DOWN,
  },
  {
    id: 'esp32-c3-devkitm-1',
    name: 'ESP32-C3-DevKitM-1',
    manufacturer: 'Espressif',
    category: 'ESP32',
    aliases: ['c3 devkit', 'esp32c3 devkitm', 'esp32-c3-mini-1'],
    tags: ['wifi', 'bluetooth le', 'risc-v', 'esp32-c3'],
    specs: {
      Module: 'ESP32-C3-MINI-1 (MINI-1U has U.FL)',
      USB: 'Micro-USB (USB-UART bridge)',
      Buttons: 'Boot, RST',
      LED: 'RGB LED on GPIO8',
      Headers: '2 rows, 2.54 mm pitch, 22.86 mm apart',
    },
    board: { length: 38.91, width: 25.4, thickness: 1.6, heightAbove: 2.9, heightBelow: 8.5 },
    mountingHoles: [],
    features: [
      { id: 'usb', label: 'Micro-USB', kind: 'micro-usb', side: 'left', x: 2.4, y: 12.7, z: 1.4, size: MICRO_USB, cutout: true },
      { id: 'boot', label: 'Boot button', kind: 'button', side: 'top', x: 4, y: 19.8, z: 1, size: [4, 3, 2], cutout: true, shape: 'circle', note: EST },
      { id: 'rst', label: 'RST button', kind: 'button', side: 'top', x: 4, y: 5.6, z: 1, size: [4, 3, 2], cutout: true, shape: 'circle', note: EST },
      { id: 'led', label: 'RGB LED', kind: 'led', side: 'top', x: 11, y: 12.7, z: 0.5, size: [1.6, 1.6, 1], cutout: false, note: EST },
      {
        id: 'module', label: 'MINI-1 module (antenna end)', kind: 'module', side: 'top',
        x: 38.91 + 5.3 - 8.3, y: 12.7, z: 1.2, size: [16.6, 13.2, 2.4], cutout: false,
        note: 'Antenna overhang (~5.3 mm) measured from Espressif DXF.',
      },
    ],
    sources: [
      { label: 'User guide', url: 'https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32c3/esp32-c3-devkitm-1/user_guide.html' },
      { label: 'Dimension drawing (PDF)', url: 'https://dl.espressif.com/dl/schematics/DIMENSION_ESP32-C3-DEVKITM-1_V1_20200915AA.pdf' },
    ],
    confidence: 'partial',
    notes: HEADERS_DOWN,
  },
  {
    id: 'xiao-esp32s3',
    name: 'XIAO ESP32S3',
    manufacturer: 'Seeed Studio',
    category: 'ESP32',
    aliases: ['xiao s3', 'seeed xiao esp32s3', 'xiao esp32 s3'],
    tags: ['wifi', 'bluetooth', 'esp32-s3', 'tiny'],
    specs: {
      MCU: 'ESP32-S3',
      USB: 'USB-C',
      Buttons: 'BOOT, RESET',
      Antenna: 'U.FL connector (external antenna)',
      Pins: '2 × 7 castellated, 2.54 mm pitch',
      Battery: 'BAT+/− pads on the underside',
    },
    board: { length: 21, width: 17.8, thickness: 1.2, heightAbove: 3.3, heightBelow: 0.5 },
    mountingHoles: [],
    features: [
      { id: 'usb', label: 'USB-C', kind: 'usb-c', side: 'left', x: 2.5, y: 8.9, z: 1.65, size: USB_C, cutout: true },
      { id: 'boot', label: 'BOOT button', kind: 'button', side: 'top', x: 7.5, y: 2.6, z: 0.4, size: [2, 1.6, 0.8], cutout: true, shape: 'circle', note: EST },
      { id: 'rst', label: 'RESET button', kind: 'button', side: 'top', x: 7.5, y: 15.2, z: 0.4, size: [2, 1.6, 0.8], cutout: true, shape: 'circle', note: EST },
      { id: 'ufl', label: 'U.FL antenna connector', kind: 'ufl', side: 'top', x: 18.5, y: 2.5, z: 0.6, size: [3, 3, 1.2], cutout: false, note: 'Bottom-left of the front side per Seeed wiki; exact position estimated.' },
    ],
    sources: [
      { label: 'Seeed wiki', url: 'https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/' },
      { label: 'Dimension DXF', url: 'https://files.seeedstudio.com/wiki/SeeedStudio-XIAO-ESP32S3/res/XIAO_ESP32S3_v1.1_Dimensioning.dxf' },
    ],
    confidence: 'partial',
    notes: 'PCB thickness not published (1.2 mm assumed). Tiny buttons sit below the lid: use a toothpick through the holes or untick them.',
  },
  {
    id: 'xiao-esp32c3',
    name: 'XIAO ESP32C3',
    manufacturer: 'Seeed Studio',
    category: 'ESP32',
    aliases: ['xiao c3', 'seeed xiao esp32c3'],
    tags: ['wifi', 'bluetooth le', 'risc-v', 'esp32-c3', 'tiny'],
    specs: {
      MCU: 'ESP32-C3',
      USB: 'USB-C',
      Buttons: 'BOOT, RESET',
      Antenna: 'U.FL connector (external antenna)',
      Pins: '2 × 7 castellated, 2.54 mm pitch',
      Battery: 'BAT+/− pads on the underside',
    },
    board: { length: 20.955, width: 17.78, thickness: 1.2, heightAbove: 3.3, heightBelow: 0.5 },
    mountingHoles: [],
    features: [
      { id: 'usb', label: 'USB-C', kind: 'usb-c', side: 'left', x: 2.5, y: 8.89, z: 1.65, size: USB_C, cutout: true },
      { id: 'boot', label: 'BOOT button', kind: 'button', side: 'top', x: 7.5, y: 2.6, z: 0.4, size: [2, 1.6, 0.8], cutout: true, shape: 'circle', note: EST },
      { id: 'rst', label: 'RESET button', kind: 'button', side: 'top', x: 7.5, y: 15.2, z: 0.4, size: [2, 1.6, 0.8], cutout: true, shape: 'circle', note: EST },
      { id: 'ufl', label: 'U.FL antenna connector', kind: 'ufl', side: 'top', x: 18.5, y: 2.5, z: 0.6, size: [3, 3, 1.2], cutout: false, note: UNKNOWN },
    ],
    sources: [
      { label: 'Seeed wiki', url: 'https://wiki.seeedstudio.com/XIAO_ESP32C3_Getting_Started/' },
      { label: 'Dimension DXF (zip)', url: 'https://files.seeedstudio.com/wiki/Seeed-Studio-XIAO-ESP32/XIAO_ESP32C3_v1.2_Dimensioning.zip' },
    ],
    confidence: 'partial',
    notes: 'Outline 20.955 × 17.78 mm from the Seeed DXF. PCB thickness not published (1.2 mm assumed).',
  },
  {
    id: 'feather-esp32-s3',
    name: 'Feather ESP32-S3',
    manufacturer: 'Adafruit',
    category: 'ESP32',
    aliases: ['adafruit feather esp32s3', 'feather s3', 'pid 5323'],
    tags: ['wifi', 'bluetooth', 'esp32-s3', 'feather', 'lipo', 'stemma qt'],
    specs: {
      MCU: 'ESP32-S3 module (PID 5323; PID 5885 has w.FL)',
      USB: 'USB-C',
      Buttons: 'Reset, Boot',
      Battery: 'JST connector for LiPo',
      Extras: 'STEMMA QT, NeoPixel',
      Footprint: 'Feather: 2.0" × 0.9"',
    },
    board: { length: 50.8, width: 22.86, thickness: 1.6, heightAbove: 4.5, heightBelow: 1 },
    mountingHoles: [
      { x: 2.54, y: 1.905, diameter: 2.5 },
      { x: 2.54, y: 20.955, diameter: 2.5 },
      { x: 48.26, y: 1.905, diameter: 2.3 },
      { x: 48.26, y: 20.955, diameter: 2.3 },
    ],
    features: [
      { id: 'usb', label: 'USB-C', kind: 'usb-c', side: 'left', x: 2.5, y: 11.43, z: 1.65, size: USB_C, cutout: true },
      {
        id: 'jst', label: 'Battery JST', kind: 'jst', side: 'back', x: 10.92, y: 19.5, z: 2.3, size: [8, 6, 4.6], cutout: false,
        note: 'Centre position from the Adafruit fab print; body size is a typical JST PH. Tick to cut a cable exit.',
      },
      { id: 'rst', label: 'Reset button', kind: 'button', side: 'top', x: 22, y: 5, z: 0.8, size: [3, 4, 1.6], cutout: true, shape: 'circle', note: EST },
      { id: 'boot', label: 'Boot button', kind: 'button', side: 'top', x: 27, y: 5, z: 0.8, size: [3, 4, 1.6], cutout: true, shape: 'circle', note: EST },
      { id: 'module', label: 'ESP32-S3 module', kind: 'module', side: 'top', x: 40.64, y: 11.43, z: 1.6, size: [20.32, 18, 3.2], cutout: false, note: 'Starts 1.20" from the left edge (fab print). Antenna at the right end.' },
    ],
    sources: [
      { label: 'Product page', url: 'https://www.adafruit.com/product/5323' },
      { label: 'Downloads / fab print', url: 'https://learn.adafruit.com/adafruit-esp32-s3-feather/downloads' },
    ],
    confidence: 'datasheet',
    notes: 'Outline, holes, USB and JST positions from the Adafruit fab print (converted from inches). Hole diameters read from the print labels.',
  },
  {
    id: 'lolin-d1-mini-v4',
    name: 'D1 mini v4.0.0',
    manufacturer: 'WEMOS / LOLIN',
    category: 'ESP8266',
    aliases: ['wemos d1 mini', 'lolin d1 mini', 'd1mini', 'esp8266'],
    tags: ['wifi', 'esp8266'],
    specs: {
      MCU: 'ESP8266EX',
      USB: 'USB-C (v4.0.0)',
      Buttons: 'Reset',
      Antenna: 'PCB antenna',
      Weight: '3 g',
    },
    board: { length: 34.3, width: 25.4, thickness: 1.0, heightAbove: 3.5, heightBelow: 2 },
    mountingHoles: [
      { x: 31.8, y: 2.5, diameter: 2 },
      { x: 31.8, y: 22.9, diameter: 2 },
    ],
    features: [
      { id: 'usb', label: 'USB-C', kind: 'usb-c', side: 'left', x: 2.9, y: 12.7, z: 1.65, size: USB_C, cutout: true, note: 'Centred on the short edge (estimated).' },
      { id: 'rst', label: 'Reset button', kind: 'button', side: 'front', x: 3.5, y: 1.5, z: 1, size: [4, 3, 2], cutout: true, note: UNKNOWN },
    ],
    sources: [
      { label: 'Product page', url: 'https://www.wemos.cc/en/latest/d1/d1_mini.html' },
      { label: 'Dimension drawing (PDF)', url: 'https://www.wemos.cc/en/latest/_static/files/dim_d1_mini_v4.0.0.pdf' },
    ],
    confidence: 'partial',
    notes: 'The drawing says 34.3 × 25.4 mm, the product page 34.2 × 25.6. Hole spacing (20.4 mm) is from the drawing; distance from the end is estimated at 2.5 mm.',
  },

  // ------------------------------------------------------------------- LoRa
  {
    id: 'heltec-wifi-lora-32-v3',
    name: 'WiFi LoRa 32 V3',
    manufacturer: 'Heltec',
    category: 'LoRa',
    aliases: ['heltec v3', 'heltec lora 32', 'ht-wb32la', 'meshtastic heltec'],
    tags: ['lora', 'sx1262', 'esp32-s3', 'oled', 'meshtastic', 'wifi', 'bluetooth'],
    specs: {
      MCU: 'ESP32-S3',
      Radio: 'SX1262 LoRa',
      Display: '0.96" OLED, 128 × 64',
      USB: 'USB-C',
      Buttons: 'PRG, RST',
      'LoRa antenna': 'IPEX 1.0 (U.FL)',
      'Wi-Fi antenna': '2.4 GHz spring antenna',
      Battery: 'SH1.25 2-pin connector',
      'Overall size': '50.2 × 25.5 × 10.2 mm (datasheet)',
    },
    board: { length: 49.2, width: 25.5, thickness: 1.6, heightAbove: 5, heightBelow: 3.6 },
    mountingHoles: [],
    features: [
      { id: 'usb', label: 'USB-C', kind: 'usb-c', side: 'left', x: 2.7, y: 12.75, z: 1.65, size: USB_C, cutout: true },
      { id: 'prg', label: 'PRG button', kind: 'button', side: 'top', x: 3.5, y: 21.5, z: 1, size: [3, 4, 2], cutout: true, shape: 'circle', note: EST },
      { id: 'rst', label: 'RST button', kind: 'button', side: 'top', x: 3.5, y: 4, z: 1, size: [3, 4, 2], cutout: true, shape: 'circle', note: EST },
      {
        id: 'oled', label: 'OLED window', kind: 'display', side: 'top', x: 49.2 - 33.28 / 2, y: 12.75, z: 4.2, size: [27.28, 14, 1.6], cutout: true,
        note: 'Length (27.28 mm active, 33.28 mm glass to the right end) from the Heltec drawing. Window height is an estimate.',
      },
      { id: 'ufl', label: 'LoRa IPEX connector', kind: 'ufl', side: 'top', x: 44, y: 3.5, z: 0.6, size: [3, 3, 1.2], cutout: false, note: UNKNOWN },
      smaBulkhead('right', 49.2 + 1.4, 12.75, 2),
    ],
    sources: [
      { label: 'Heltec wiki', url: 'https://wiki.heltec.org/docs/devices/open-source-hardware/esp32-series/lora-32/wifi-lora-32-v3/' },
      { label: 'Datasheet (p.14 dimensions)', url: 'https://resource.heltec.cn/download/WiFi_LoRa_32_V3/HTIT-WB32LA_V3.2.pdf' },
    ],
    confidence: 'partial',
    notes:
      'Heltec gives 50.2 mm overall including the USB-C overhang; PCB length here is 49.2 mm (estimated). The height split above/below the PCB is interpreted from the side views. A STEP model is in the Heltec resource folder if you need more precision.',
  },
  {
    id: 'lilygo-t3-v1-6-1',
    name: 'TTGO LoRa32 T3 V1.6.1',
    manufacturer: 'LilyGO',
    category: 'LoRa',
    aliases: ['t3 v1.6', 'ttgo lora32', 'lilygo t3', 'lora32 v2.1'],
    tags: ['lora', 'sx1276', 'sx1278', 'esp32', 'oled', 'sd card', 'meshtastic'],
    specs: {
      MCU: 'ESP32',
      Radio: 'SX1276 / SX1278 LoRa',
      Display: '0.96" OLED',
      USB: 'Micro-USB',
      'LoRa antenna': 'SMA (IPEX on IPEX SKUs)',
      Storage: 'microSD (TF) slot',
      Battery: 'JST GH 2-pin, 1.25 mm',
    },
    board: { length: 64.47, width: 27.0, thickness: 1.6, heightAbove: 5.5, heightBelow: 3 },
    mountingHoles: [
      { x: 64.47 - 2.56, y: 27.0 - 3.44, diameter: 2 },
      { x: 64.47 - 2.56, y: 27.0 - 3.44 - 22.15, diameter: 2 },
    ],
    features: [
      { id: 'usb', label: 'Micro-USB', kind: 'micro-usb', side: 'left', x: 2.4, y: 13.5, z: 1.4, size: MICRO_USB, cutout: true, note: EST },
      {
        id: 'sma', label: 'LoRa SMA connector', kind: 'sma', side: 'back', x: 14.5, y: 27.0 + 2, z: 0, size: [6.5, 9, 6.5], cutout: true, shape: 'circle',
        note: 'Footprint 14.5 mm from the USB end per the LilyGO drawing (interpreted). Edge-mount SMA assumed.',
      },
      { id: 'pwr', label: 'Power switch', kind: 'switch', side: 'front', x: 8, y: 1.5, z: 1.5, size: [7, 3, 3], cutout: true, note: EST },
      { id: 'rst', label: 'Reset button', kind: 'button', side: 'top', x: 6, y: 21, z: 1, size: [3, 4, 2], cutout: true, shape: 'circle', note: UNKNOWN },
      { id: 'oled', label: 'OLED window', kind: 'display', side: 'top', x: 64.47 - 18, y: 13.5, z: 4.8, size: [24, 13, 1.5], cutout: true, note: 'Near the top (antenna) end; size and position estimated.' },
    ],
    sources: [
      { label: 'Product page', url: 'https://lilygo.cc/en-ca/products/lora3' },
      { label: 'LilyGO dimension files (GitHub)', url: 'https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series' },
    ],
    confidence: 'partial',
    notes: 'Outline and the two Ø2 mm holes from LilyGO drawings (V1.6.2 drawing shows 27.13 mm width). Heights are estimates.',
  },
  {
    id: 'lilygo-t-beam-v1',
    name: 'T-Beam V1.1 / V1.2',
    manufacturer: 'LilyGO',
    category: 'LoRa',
    aliases: ['tbeam', 't beam', 'ttgo t-beam', 'meshtastic t-beam'],
    tags: ['lora', 'gps', 'gnss', 'esp32', '18650', 'meshtastic', 'oled'],
    specs: {
      MCU: 'ESP32',
      Radio: 'LoRa (SX1276/SX1262 depending on SKU)',
      GPS: 'GNSS module with ceramic patch antenna',
      Display: '0.96" 128 × 64 SSD1306 OLED (not fitted on some SKUs)',
      USB: 'Micro-USB',
      Buttons: 'Power, IO38, Reset',
      Battery: '18650 holder on the underside',
    },
    board: { length: 100.13, width: 32.89, thickness: 1.5, heightAbove: 9.2, heightBelow: 19.3 },
    mountingHoles: [
      { x: 2.36, y: 2.59, diameter: 2 },
      { x: 2.36, y: 30.3, diameter: 2 },
      { x: 97.46, y: 2.59, diameter: 2 },
      { x: 97.46, y: 30.3, diameter: 2 },
    ],
    features: [
      { id: 'usb', label: 'Micro-USB', kind: 'micro-usb', side: 'left', x: 2.4, y: 16.45, z: 1.4, size: MICRO_USB, cutout: true, note: UNKNOWN },
      {
        id: 'sma', label: 'LoRa antenna connector', kind: 'sma', side: 'back', x: 39.3, y: 32.89 + 3.25, z: 0, size: [6.5, 6.5, 6.5], cutout: true, shape: 'circle',
        note: 'Coaxial connector ~6.5 mm past the edge in the LilyGO STEP model (interpreted as the LoRa SMA).',
      },
      {
        id: 'overhang', label: 'Unidentified overhang (STEP)', kind: 'other', side: 'front', x: 52.5, y: -9.5 + 3.45, z: 1.6, size: [13.6, 6.9, 3.15], cutout: false,
        note: 'A 13.6 × 6.9 × 3.15 mm part sits ~9.5 mm past this edge in the STEP model. Remove it if your board has nothing there.',
      },
      { id: 'pwr', label: 'Power button', kind: 'button', side: 'top', x: 20, y: 6, z: 1, size: [4, 3, 2], cutout: false, note: UNKNOWN },
      { id: 'io38', label: 'IO38 button', kind: 'button', side: 'top', x: 26, y: 6, z: 1, size: [4, 3, 2], cutout: false, note: UNKNOWN },
      { id: 'rst', label: 'Reset button', kind: 'button', side: 'top', x: 32, y: 6, z: 1, size: [4, 3, 2], cutout: false, note: UNKNOWN },
    ],
    sources: [
      { label: 'Product page', url: 'https://lilygo.cc/products/t-beam' },
      { label: 'LilyGO dimension files (GitHub)', url: 'https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series' },
    ],
    confidence: 'partial',
    notes:
      'Outline (2 mm corner radius), holes, thickness and heights measured from the LilyGO STEP model. Button and USB positions are not documented: buttons start un-ticked so they won\'t cut holes until you place them.',
  },
  {
    id: 'rak19007-rak4631',
    name: 'WisBlock RAK19007 + RAK4631',
    manufacturer: 'RAKwireless',
    category: 'LoRa',
    aliases: ['rak4631', 'rak19007', 'wisblock', 'rak meshtastic starter'],
    tags: ['lora', 'sx1262', 'nrf52840', 'meshtastic', 'bluetooth le', 'solar'],
    specs: {
      Core: 'RAK4631 (nRF52840 + SX1262)',
      Base: 'RAK19007, 60 × 30 × 1.0 mm',
      USB: 'USB-C',
      Buttons: 'Reset',
      Battery: 'JST PHR-2 (2.0 mm)',
      Solar: 'JST ZHR-2 (1.5 mm)',
      Slots: 'CPU, IO, sensor A–D',
    },
    board: { length: 60, width: 30, thickness: 1.0, heightAbove: 7.5, heightBelow: 0.5 },
    mountingHoles: [
      { x: 4, y: 4, diameter: 2.7 },
      { x: 4, y: 26, diameter: 2.7 },
      { x: 56, y: 4, diameter: 2.7 },
      { x: 58, y: 28, diameter: 2.7 },
    ],
    features: [
      { id: 'usb', label: 'USB-C', kind: 'usb-c', side: 'left', x: 2.9, y: 15, z: 1.65, size: USB_C, cutout: true, note: 'Mid-edge, estimated from the RAK drawing.' },
      { id: 'rst', label: 'Reset button', kind: 'button', side: 'left', x: 1.5, y: 7, z: 1, size: [3, 4, 2], cutout: true, note: 'Left edge below the USB (RAK interface drawing); exact offset estimated.' },
      { id: 'bat', label: 'Battery JST PH', kind: 'jst', side: 'top', x: 7, y: 25, z: 2.3, size: [6, 8, 4.6], cutout: false, note: EST },
      { id: 'solar', label: 'Solar JST ZH', kind: 'jst', side: 'top', x: 7, y: 5, z: 1.8, size: [4.5, 6, 3.5], cutout: false, note: EST },
      { id: 'core', label: 'RAK4631 core', kind: 'module', side: 'top', x: 26, y: 15, z: 3.5, size: [20, 30, 3], cutout: false, note: 'Core is 20 × 30 mm. Stack height above the base board is estimated.' },
      smaBulkhead('right', 60 + 1.4, 15, 4),
    ],
    sources: [
      { label: 'RAK19007 datasheet', url: 'https://docs.rakwireless.com/product-categories/wisblock/rak19007/datasheet/' },
      { label: 'RAK4631 datasheet', url: 'https://docs.rakwireless.com/product-categories/wisblock/rak4631/datasheet/' },
    ],
    confidence: 'datasheet',
    notes: 'Outline, thickness and mounting holes from the RAK19007 datasheet drawing (one hole\'s Y position estimated from the drawing). Module stack height is an estimate.',
  },

  // --------------------------------------------------------------- Displays
  {
    id: 'crowpanel-advanced-10-1-esp32-p4',
    name: 'CrowPanel Advanced 10.1" ESP32-P4 HMI Display',
    manufacturer: 'Elecrow',
    category: 'ESP32',
    aliases: ['crowpanel 10.1', 'crowpanel advanced', 'esp32-p4 display', 'dhe04310d', 'elecrow p4 hmi', 'crowpanel p4'],
    tags: ['esp32-p4', 'display', 'hmi', 'touch', 'lcd', '1024x600', 'wifi 6', 'esp32-c6'],
    specs: {
      MCU: 'ESP32-P4 (+ ESP32-C6 module for Wi-Fi 6 / BLE)',
      Display: '10.1" IPS, 1024 × 600, capacitive touch (GT911)',
      USB: '2 × USB-C on the right edge (UART0 programming + USB 2.0)',
      Buttons: 'RESET (K4), BOOT (K3) on the back, left edge',
      Power: 'POWER slide switch on the back, right edge; lever points out of the back',
      Storage: 'microSD slot, opening on the top edge',
      Connectors: 'XH2.54-4P UART3-IN (power in), 2 × HY2.0-4P (UART/I2C), PH2.0-2P BAT and speaker',
      'Mounting holes': '4 × M3 (Ø3.2), 3 mm in from each corner',
      'PCB size': '247 × 147 × 1.7 mm',
    },
    // Oriented display side up, as you look at the screen. Everything else is on the back (negative z).
    board: { length: 247, width: 147, thickness: 1.7, heightAbove: 6.8, heightBelow: 8.1, color: '#1b4a7a' },
    mountingHoles: [
      { x: 3, y: 3, diameter: 3.2 },
      { x: 244, y: 3, diameter: 3.2 },
      { x: 3, y: 144, diameter: 3.2 },
      { x: 244, y: 144, diameter: 3.2 },
    ],
    features: [
      {
        id: 'screen', label: 'Display window', kind: 'display', side: 'top', x: 123.5, y: 73.5, z: 3.4,
        size: [235, 143, 6.8], opening: [229, 137], cutout: true,
        note: 'Glass is 235 × 143 mm (STEP model). The window is 3 mm smaller all round so the lid holds the panel; set Headroom to ~0.3 mm so the glass sits against the lid.',
      },
      { id: 'usb-j16', label: 'USB-C (J16)', kind: 'usb-c', side: 'right', x: 244.21, y: 83.97, z: -2.78, size: [7.58, 8.94, 4.16], cutout: true, note: 'Mid-mount connector. One port is UART0 (programming), the other USB 2.0: check the silkscreen.' },
      { id: 'usb-j1', label: 'USB-C (J1)', kind: 'usb-c', side: 'right', x: 244.21, y: 63.03, z: -2.78, size: [7.58, 8.94, 4.16], cutout: true },
      {
        id: 'power', label: 'POWER switch (SW1)', kind: 'switch', side: 'bottom', x: 242.25, y: 46.06, z: -3.13,
        size: [3.5, 9.0, 3.45], cutout: true, slideAxis: 'y', leverSize: [1.5, 1.5, 2.0], switchTravel: 2,
        note: 'Slide switch on the back with its lever pointing out of the back (not on the edge). Lever 1.5 × 1.5 mm, 2 mm tall, measured from the STEP model; travel 2 mm inferred from the lever offset.',
      },
      { id: 'reset', label: 'RESET button (K4)', kind: 'button', side: 'bottom', x: 4.25, y: 129.75, z: -3.95, size: [4.5, 4.5, 4.5], cutout: true, plungerDiameter: 3.5 },
      { id: 'boot', label: 'BOOT button (K3)', kind: 'button', side: 'bottom', x: 4.25, y: 115.25, z: -3.95, size: [4.5, 4.5, 4.5], cutout: true, plungerDiameter: 3.5 },
      { id: 'sd', label: 'microSD slot', kind: 'sd', side: 'back', x: 19.38, y: 136.9, z: -2.43, size: [16.15, 15.2, 2.65], cutout: true, note: 'Card goes in from the top edge.' },
      { id: 'led-pwr', label: 'PWR / CHG LEDs', kind: 'led', side: 'bottom', x: 242.2, y: 73.5, z: -2.0, size: [5.6, 1.62, 0.61], cutout: false, note: 'Two LEDs 4.8 mm apart on the back. Tick to cut a viewing slot.' },
      { id: 'uart3', label: 'UART3-IN / power (XH2.54-4P, J10)', kind: 'jst', side: 'bottom', x: 242.15, y: 105.69, z: -3.7, size: [5.7, 12.5, 10.0], cutout: false, note: 'Vertical connector: the cable leaves through the back. Tick to cut an opening.' },
      { id: 'hy-a', label: 'HY2.0-4P (J2)', kind: 'jst', side: 'front', x: 18.0, y: 5.09, z: -5.6, size: [12.0, 6.21, 8.4], cutout: false, note: 'UART / I2C. Tick to cut a cable opening in the bottom edge.' },
      { id: 'hy-b', label: 'HY2.0-4P (J13)', kind: 'jst', side: 'front', x: 40.0, y: 5.09, z: -5.6, size: [12.0, 6.21, 8.4], cutout: false, note: 'UART / I2C. Tick to cut a cable opening in the bottom edge.' },
      { id: 'ph-a', label: 'PH2.0-2P (J4)', kind: 'jst', side: 'back', x: 35.75, y: 140.66, z: -4.38, size: [8.01, 8.5, 5.6], cutout: false, note: 'Battery or speaker: check the silkscreen.' },
      { id: 'ph-b', label: 'PH2.0-2P (J6)', kind: 'jst', side: 'back', x: 215.0, y: 140.66, z: -4.38, size: [8.01, 8.5, 5.6], cutout: false, note: 'Battery or speaker: check the silkscreen.' },
      { id: 'ph-c', label: 'PH2.0-2P (J3)', kind: 'jst', side: 'back', x: 231.0, y: 140.66, z: -4.38, size: [8.01, 8.5, 5.6], cutout: false, note: 'Battery or speaker: check the silkscreen.' },
      { id: 'c6', label: 'ESP32-C6 wireless module', kind: 'module', side: 'bottom', x: 8.3, y: 26.6, z: -2.86, size: [16.6, 13.2, 2.51], cutout: false },
      { id: 'socket', label: 'Wireless module socket (J9/J11)', kind: 'header', side: 'bottom', x: 223.0, y: 11.14, z: -4.05, size: [20.4, 18.28, 5.3], cutout: false },
      { id: 'gpio', label: 'Expansion header', kind: 'header', side: 'bottom', x: 123.5, y: 142.5, z: -2.75, size: [51.2, 6.6, 4.9], cutout: false },
      { id: 'cam', label: 'Camera FPC connector', kind: 'other', side: 'bottom', x: 123.5, y: 94.8, z: -3.23, size: [18.6, 5.4, 3.15], cutout: false },
    ],
    sources: [
      { label: 'Elecrow wiki', url: 'https://elecrow.com/wiki/CrowPanel_Advanced_10.1inch_ESP32-P4_HMI_AI_Display_1024x600_IPS.html' },
      { label: 'Product page', url: 'https://www.elecrow.com/crowpanel-advanced-10-1inch-esp32-p4-hmi-ai-display-1024x600-ips-touch-screen-wifi-6.html' },
      { label: 'STEP model + Eagle files (GitHub)', url: 'https://github.com/Elecrow-RD/CrowPanel-Advanced-10.1inch-ESP32-P4-HMI-AI-Display-1024x600-IPS-Touch-Screen' },
    ],
    confidence: 'datasheet',
    notes:
      'Every position is measured from Elecrow\'s STEP model (ESP32-P4-10_1-inch-20251230.stp, board V1.2); button and switch designators from the V1.2 Eagle board file. The optional camera module hangs off the bottom edge on its cable and is not modelled. Plungers and the power-switch cap stick out of the back by ~1.2–2 mm.',
  },

  // ------------------------------------------------------------------ Other
  {
    id: 'rpi-pico',
    name: 'Raspberry Pi Pico',
    manufacturer: 'Raspberry Pi',
    category: 'RP2040',
    aliases: ['pico', 'rp2040', 'rpi pico'],
    tags: ['rp2040', 'microcontroller'],
    specs: {
      MCU: 'RP2040',
      USB: 'Micro-USB (overhangs the edge ~1.3 mm)',
      Buttons: 'BOOTSEL',
      Pins: '40 × 2.54 mm, plus 3-pin SWD',
      PCB: '51 × 21 × 1 mm, single-sided',
    },
    board: { length: 51, width: 21, thickness: 1, heightAbove: 3.2, heightBelow: 0 },
    mountingHoles: [
      { x: 2, y: 4.8, diameter: 2.1 },
      { x: 2, y: 16.2, diameter: 2.1 },
      { x: 49, y: 4.8, diameter: 2.1 },
      { x: 49, y: 16.2, diameter: 2.1 },
    ],
    features: [
      { id: 'usb', label: 'Micro-USB', kind: 'micro-usb', side: 'left', x: 1.6, y: 10.5, z: 1.4, size: [5.8, 8, 2.8], cutout: true },
      { id: 'bootsel', label: 'BOOTSEL button', kind: 'button', side: 'top', x: 12, y: 7, z: 1, size: [4.2, 3.2, 2], cutout: true, shape: 'circle', note: EST },
    ],
    sources: [{ label: 'Pico datasheet (Fig. 3)', url: 'https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf' }],
    confidence: 'datasheet',
    notes: 'Headers ship unsoldered. If you solder them pointing down, set "Tallest part below" to 8.5 mm.',
  },
  {
    id: 'rpi-pico-w',
    name: 'Raspberry Pi Pico W',
    manufacturer: 'Raspberry Pi',
    category: 'RP2040',
    aliases: ['pico w', 'picow', 'rp2040 wifi'],
    tags: ['rp2040', 'wifi', 'bluetooth', 'cyw43439'],
    specs: {
      MCU: 'RP2040',
      Wireless: 'Infineon CYW43439 (Wi-Fi + Bluetooth)',
      USB: 'Micro-USB (overhangs the edge ~1.3 mm)',
      Buttons: 'BOOTSEL',
      Antenna: 'On-board, at the end opposite USB (keep metal clear)',
      PCB: '51 × 21 × 1 mm',
    },
    board: { length: 51, width: 21, thickness: 1, heightAbove: 3.2, heightBelow: 0 },
    mountingHoles: [
      { x: 2, y: 4.8, diameter: 2.1 },
      { x: 2, y: 16.2, diameter: 2.1 },
      { x: 49, y: 4.8, diameter: 2.1 },
      { x: 49, y: 16.2, diameter: 2.1 },
    ],
    features: [
      { id: 'usb', label: 'Micro-USB', kind: 'micro-usb', side: 'left', x: 1.6, y: 10.5, z: 1.4, size: [5.8, 8, 2.8], cutout: true },
      { id: 'bootsel', label: 'BOOTSEL button', kind: 'button', side: 'top', x: 12, y: 7, z: 1, size: [4.2, 3.2, 2], cutout: true, shape: 'circle', note: EST },
    ],
    sources: [{ label: 'Pico W datasheet (Fig. 3)', url: 'https://datasheets.raspberrypi.com/picow/pico-w-datasheet.pdf' }],
    confidence: 'datasheet',
    notes: 'Plastic cases are fine for the antenna. Don\'t put screws, foil or metal within the 14 × 9 mm keep-out at the antenna end.',
  },
  {
    id: 'arduino-uno-r3',
    name: 'Arduino Uno R3',
    manufacturer: 'Arduino',
    category: 'Arduino',
    aliases: ['uno', 'uno rev3', 'a000066', 'atmega328p'],
    tags: ['avr', 'atmega328p', 'arduino'],
    specs: {
      MCU: 'ATmega328P',
      USB: 'USB-B',
      Power: '2.1 × 5.5 mm DC barrel jack',
      Buttons: 'Reset',
      Weight: '25 g',
    },
    board: { length: 68.6, width: 53.4, thickness: 1.6, heightAbove: 11, heightBelow: 2 },
    mountingHoles: [
      { x: 13.97, y: 2.6, diameter: 3.2 },
      { x: 15.24, y: 50.86, diameter: 3.2 },
      { x: 66.04, y: 35.62, diameter: 3.2 },
      { x: 66.04, y: 7.68, diameter: 3.2 },
    ],
    features: [
      { id: 'usb', label: 'USB-B', kind: 'usb-a', side: 'left', x: 1.7, y: 37.7, z: 5.5, size: [16, 12.2, 11], cutout: true, note: 'Overhang and exact span estimated (not dimensioned in the datasheet).' },
      { id: 'jack', label: 'DC barrel jack', kind: 'barrel', side: 'left', x: 5.0, y: 7.8, z: 5.5, size: [13.7, 9, 11], cutout: true, note: 'Overhang and exact span estimated.' },
      { id: 'rst', label: 'Reset button', kind: 'button', side: 'top', x: 6.5, y: 49.5, z: 1.5, size: [6, 3.5, 3], cutout: true, shape: 'circle', note: EST },
    ],
    sources: [
      { label: 'Datasheet A000066 (§5.4)', url: 'https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf' },
      { label: 'Store page', url: 'https://store.arduino.cc/products/arduino-uno-rev3' },
    ],
    confidence: 'datasheet',
    notes: 'Three hole positions come from the Arduino datasheet. The bottom-left hole\'s X (13.97 mm) is the commonly used reference value; the datasheet doesn\'t dimension it.',
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
    specs: { Note: 'Measure your board with calipers and enter the values below.' },
    board: { length: 50, width: 25, thickness: 1.6, heightAbove: 4, heightBelow: 0 },
    mountingHoles: [],
    features: [{ id: 'usb', label: 'USB', kind: 'usb-c', side: 'left', x: 2.5, y: 12.5, z: 1.65, size: USB_C, cutout: true }],
    sources: [],
    confidence: 'estimated',
  };
}
