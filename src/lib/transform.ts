import type { Device, Feature, MountingHole, Side } from '../types';

/*
 * Whole-board transforms for fixing a layout that was entered (or looked up)
 * mirrored, rotated, or with the wrong face up. Each one keeps the board in the
 * standard frame: origin at the bottom-left corner, z = 0 on the top face.
 */

type PointMap = (x: number, y: number, z: number) => [number, number, number];

function apply(
  d: Device,
  point: PointMap,
  side: Record<Side, Side>,
  size: (s: Feature['size']) => Feature['size'],
  board: Device['board'],
): Device {
  const hole = (h: MountingHole): MountingHole => {
    const [x, y] = point(h.x, h.y, 0);
    return { ...h, x: round(x), y: round(y) };
  };
  return {
    ...d,
    board,
    mountingHoles: d.mountingHoles.map(hole),
    features: d.features.map((f) => {
      const [x, y, z] = point(f.x, f.y, f.z);
      const turned = size !== same;
      const flat = f.side === 'top' || f.side === 'bottom';
      return {
        ...f,
        x: round(x),
        y: round(y),
        z: round(z),
        side: side[f.side],
        size: size(f.size),
        // A quarter turn swaps the axes of face-mounted openings and switches.
        ...(turned && flat && f.opening ? { opening: [f.opening[1], f.opening[0]] as [number, number] } : {}),
        ...(turned && flat && f.kind === 'switch'
          ? { slideAxis: (f.slideAxis ?? 'x') === 'x' ? ('y' as const) : ('x' as const) }
          : {}),
      };
    }),
  };
}

const same = (s: Feature['size']) => s;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Mirror left ↔ right (x → length − x). */
export function mirrorX(d: Device): Device {
  const L = d.board.length;
  return apply(
    d,
    (x, y, z) => [L - x, y, z],
    { left: 'right', right: 'left', front: 'front', back: 'back', top: 'top', bottom: 'bottom' },
    same,
    d.board,
  );
}

/** Mirror front ↔ back (y → width − y). */
export function mirrorY(d: Device): Device {
  const W = d.board.width;
  return apply(
    d,
    (x, y, z) => [x, W - y, z],
    { left: 'left', right: 'right', front: 'back', back: 'front', top: 'top', bottom: 'bottom' },
    same,
    d.board,
  );
}

/** Rotate 180° about the vertical axis. */
export function rotate180(d: Device): Device {
  return mirrorY(mirrorX(d));
}

/** Rotate 90° counter-clockwise seen from above. Length and width swap. */
export function rotate90(d: Device): Device {
  const W = d.board.width;
  return apply(
    d,
    (x, y, z) => [W - y, x, z],
    { front: 'right', right: 'back', back: 'left', left: 'front', top: 'top', bottom: 'bottom' },
    ([sx, sy, sz]) => [sy, sx, sz],
    { ...d.board, length: d.board.width, width: d.board.length },
  );
}

/**
 * Turn the board over about its long (X) axis: the underside becomes the top.
 * Use when a display module was entered with its components side up.
 */
export function turnOver(d: Device): Device {
  const { width: W, thickness: t } = d.board;
  return apply(
    d,
    (x, y, z) => [x, W - y, -t - z],
    { left: 'left', right: 'right', front: 'back', back: 'front', top: 'bottom', bottom: 'top' },
    same,
    { ...d.board, heightAbove: d.board.heightBelow, heightBelow: d.board.heightAbove },
  );
}
