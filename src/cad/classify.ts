import type { FeatureKind } from '../types';

/*
 * Guess what a part is from its package/footprint/STEP name, designator and
 * value. Order matters: more specific patterns first.
 */

const RULES: [FeatureKind, RegExp][] = [
  ['display', /\b(LCD|OLED|TFT|DISPLAY|EPD|E-?PAPER|E-?INK)\b|^TP[-_]|[-_ ]TP[-_]/],
  ['usb-c', /TYPE-?C|USB[-_ ]?C\b|USBC|USB-3\.0TYPEC/],
  ['micro-usb', /MICRO[-_ ]?USB|USB[-_ ]?MICRO|MICRO[-_]?B\b|MICROUSB|MICRO-USB/],
  ['usb-a', /USB[-_ ]?A\b|USBA\b|USB[-_ ]?B\b/],
  ['sd', /\bTF\b|^TF[-_]|MICRO[-_ ]?SD|SD[-_ ]?CARD|SDCARD|TF[-_]?CARD|\bTF-SMD/],
  ['switch', /SLIDE|SPDT|DPDT|TOGGLE|\bMSK|\bMST|SS-?12|SK-?12|SWITCH[-_ ]?\dPIN|DIP[-_ ]?SW/],
  ['button', /\bKEY\b|KEY[-_]|TACT|BUTTON|PUSH|\bPTS|EVQ|B3F|B3U|KMR|TS-?0\d|SW[-_ ]?SMD[-_ ]?4P|SW[-_ ]PUSH/],
  ['sma', /\bRP-?SMA|\bSMA\b|SMA[-_]/],
  ['ufl', /U\.?FL|IPEX|IPX\b|MHF|W\.FL|\bI-?PEX/],
  ['barrel', /DC[-_ ]?JACK|BARREL|DC-?00\d|PJ-?0\d/],
  ['battery', /BATT|18650|CR20\d\d|CR1220|BAT[-_]?HOLD/],
  ['led', /\bLED\b|LED[-_]|WS2812|SK6812|APA10\d|NEOPIXEL/],
  ['jst', /\bJST|\bPH[-_]?2|PH2\.0|\bXH\d|XH2\.54|\bGH[-_]?1|\bSH1|SH-?1\.0|HY2\.0|HY-?2|\bZH\d|ZHR|PHR|BX-PH|CONN[-_ A-Z]*[-_ ]\dP\b|CONNECTOR[-_ ]\dP|\bQWIIC|STEMMA/],
  ['header', /\bHDR|HEADER|PIN[-_ ]?HEAD|\b[12]X\d{1,2}\b|CONN[-_ ]\d+X\d+|FEMALE/],
  ['antenna', /\bANT\b|ANTENNA|ANT[-_]/],
  ['module', /ESP32|ESP8266|WROOM|WROVER|MINI-1|WIFIM|WIFI|MODULE|\bRAK\d|SX12\d\d|NRF52|RP2040/],
];

/** Designator prefixes, used when the name says nothing useful. */
const REF_RULES: [FeatureKind, RegExp][] = [
  ['button', /^(SW|S|K|BTN|KEY|B)\d+$/],
  ['led', /^(LED|D)\d+$/],
  ['usb-c', /^USB\d*$/],
];

export function classify(name: string, ref?: string, value?: string): FeatureKind | null {
  // Underscores count as separators so \b works on names like "SW-SMD_MST22D".
  const text = `${name} ${value ?? ''}`.toUpperCase().replace(/_/g, ' ');
  for (const [kind, re] of RULES) if (re.test(text)) return kind;
  const r = (ref ?? '').toUpperCase();
  for (const [kind, re] of REF_RULES) if (re.test(r)) {
    // A "D" designator is only an LED if the package says so.
    if (kind === 'led' && r.startsWith('D') && !/LED/.test(text)) return null;
    return kind;
  }
  return null;
}

export const KIND_LABEL: Record<FeatureKind, string> = {
  'usb-c': 'USB-C',
  'micro-usb': 'Micro-USB',
  'usb-a': 'USB',
  button: 'Button',
  switch: 'Slide switch',
  led: 'LED',
  antenna: 'Antenna',
  sma: 'SMA connector',
  ufl: 'U.FL connector',
  jst: 'Connector',
  display: 'Display',
  sd: 'microSD slot',
  header: 'Header',
  battery: 'Battery holder',
  barrel: 'DC jack',
  module: 'Module',
  other: 'Part',
};

/** Typical body height above the PCB when a format has no 3D data. */
export const TYPICAL_HEIGHT: Record<FeatureKind, number> = {
  'usb-c': 3.3,
  'micro-usb': 2.8,
  'usb-a': 7,
  button: 2,
  switch: 3.5,
  led: 0.8,
  antenna: 1,
  sma: 6.5,
  ufl: 1.2,
  jst: 6,
  display: 4,
  sd: 2,
  header: 8.5,
  battery: 6,
  barrel: 11,
  module: 3.1,
  other: 2,
};
