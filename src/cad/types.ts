import type { FeatureKind, MountingHole } from '../types';

/*
 * A board read from a manufacturer CAD file, in board coordinates:
 * origin at the PCB's bottom-left corner seen from the front, z = 0 on the
 * front face, negative z behind it (see src/types.ts).
 */

export type Vec3 = [number, number, number];

export interface CadPart {
  /** Designator (Eagle/KiCad), e.g. "K3". */
  ref?: string;
  /** Package, footprint or STEP part name. */
  name: string;
  value?: string;
  kind: FeatureKind | null;
  face: 'front' | 'back';
  min: Vec3;
  max: Vec3;
  /** False when the height is a typical value (Eagle/KiCad carry no 3D). */
  heightKnown: boolean;
  /** Face-mounted slide switch lever, measured from a STEP model. */
  lever?: { size: Vec3; axis: 'x' | 'y'; protrusion: number };
}

export interface CadBoard {
  source: 'step' | 'eagle' | 'kicad';
  length: number;
  width: number;
  thickness: number;
  holes: MountingHole[];
  parts: CadPart[];
  warnings: string[];
}

/** Triangle mesh of the whole assembly in board coordinates, for the viewer. */
export interface CadMesh {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}
