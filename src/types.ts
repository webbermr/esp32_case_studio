// All dimensions are millimetres.
//
// Board coordinate system (viewed from above, component side up):
//   origin = bottom-left corner of the PCB
//   +X runs along the board's length  (left edge x=0, right edge x=length)
//   +Y runs along the board's width   (front edge y=0, back edge y=width)
//   +Z is up; z=0 is the TOP surface of the PCB (negative z = underside)

export type Side = 'left' | 'right' | 'front' | 'back' | 'top' | 'bottom';

export type FeatureKind =
  | 'usb-c'
  | 'micro-usb'
  | 'usb-a'
  | 'button'
  | 'switch'
  | 'led'
  | 'antenna'
  | 'sma'
  | 'ufl'
  | 'jst'
  | 'display'
  | 'sd'
  | 'header'
  | 'battery'
  | 'barrel'
  | 'module'
  | 'other';

export interface Feature {
  id: string;
  label: string;
  kind: FeatureKind;
  /** Which face of the enclosure this part is reached through. */
  side: Side;
  /** Centre of the part's body in board coordinates. */
  x: number;
  y: number;
  z: number;
  /** Body size along X, Y, Z. */
  size: [number, number, number];
  /** Cut an opening in the case for this part. */
  cutout: boolean;
  shape?: 'rect' | 'circle';
  note?: string;
  /**
   * Buttons and switches with a cut-out get a printed actuator (button plunger
   * or slide-switch cap) unless this is false.
   */
  actuator?: boolean;
  /** Plunger shaft diameter for buttons. Default: derived from the button size. */
  plungerDiameter?: number;
  /** Slide-switch lever travel, end to end. Default 2 mm. */
  switchTravel?: number;
  /** Slide-switch lever: [width along slide, height, protrusion from body]. Default [1.5, 1.5, 1.5]. */
  leverSize?: [number, number, number];
  /** For switches on the top/bottom face: which board axis the lever slides along. Default 'x'. */
  slideAxis?: 'x' | 'y';
  /**
   * Explicit opening size [width, height] instead of body size + margin. Lets a
   * display window be smaller than the glass so the lid holds the panel in.
   * Width/height are as seen through the side (top/bottom: X × Y).
   */
  opening?: [number, number];
}

export interface MountingHole {
  x: number;
  y: number;
  diameter: number;
}

export interface SourceLink {
  label: string;
  url: string;
}

export type Confidence = 'datasheet' | 'partial' | 'estimated';

export interface Device {
  id: string;
  name: string;
  manufacturer: string;
  category: 'ESP32' | 'ESP8266' | 'LoRa' | 'RP2040' | 'Arduino' | 'nRF52' | 'Other';
  aliases: string[];
  tags: string[];
  specs: Record<string, string>;
  board: {
    length: number;
    width: number;
    thickness: number;
    /** Tallest part above the PCB top surface (headers excluded unless soldered up). */
    heightAbove: number;
    /** Tallest part below the PCB (pins, battery holders...). */
    heightBelow: number;
    color?: string;
  };
  mountingHoles: MountingHole[];
  features: Feature[];
  sources: SourceLink[];
  /** How much of the mechanical data came straight from a manufacturer drawing. */
  confidence: Confidence;
  notes?: string;
  /** Where the entry came from. Lookups are AI-researched and need checking. */
  origin?: 'library' | 'lookup' | 'import';
  /** Case settings this board works best with (applied when it's picked). */
  settings?: Partial<CaseSettings>;
  /** Manufacturer CAD file the positions were measured from (lookups keep a copy on the local server). */
  cadFile?: { path: string; format: 'step' | 'eagle' | 'kicad'; sourceUrl: string };
}

export interface CaseSettings {
  wall: number;
  floor: number;
  /** Gap between PCB edge and inner wall. */
  clearance: number;
  /** Air gap between tallest part and the underside of the lid. */
  topClearance: number;
  /** Height the PCB is lifted off the floor (at least heightBelow). */
  standoff: number;
  lidThickness: number;
  lipHeight: number;
  lipWall: number;
  /** Fit tolerance between lid lip and base walls. */
  tolerance: number;
  cornerRadius: number;
  /** Extra space around each cut-out. */
  cutoutMargin: number;
  /** Pilot-hole diameter in standoffs (e.g. 2.5 for M3 self-tapping, 1.8 for M2). */
  screwHole: number;
  ventSlots: number;
  /** Wall mounting: keyhole slots in the back, or screw tabs on two edges. */
  wallMount: 'none' | 'keyholes' | 'tabs';
  /** Case edge that points up when hung or stood up (the other end rests on the desk). */
  upEdge: 'back' | 'front' | 'left' | 'right';
  /** Printed stand: wedge feet for lying flat, a desk cradle, or a clip-in kickstand. */
  stand: 'none' | 'tilt-feet' | 'cradle' | 'kickstand';
  /** Stand tilt in degrees (from vertical for cradle/kickstand, from flat for tilt feet). */
  standAngle: number;
}

export const DEFAULT_SETTINGS: CaseSettings = {
  wall: 2,
  floor: 2,
  clearance: 0.6,
  topClearance: 2,
  standoff: 4,
  lidThickness: 2,
  lipHeight: 2.5,
  lipWall: 1.2,
  tolerance: 0.25,
  cornerRadius: 2.5,
  cutoutMargin: 0.8,
  screwHole: 2.5,
  ventSlots: 0,
  wallMount: 'none',
  upEdge: 'back',
  stand: 'none',
  standAngle: 20,
};
