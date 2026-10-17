import * as THREE from 'three';
import type { Device, FeatureKind } from '../types';

export const KIND_COLORS: Record<FeatureKind, string> = {
  'usb-c': '#c0c6cc',
  'micro-usb': '#c0c6cc',
  'usb-a': '#c0c6cc',
  button: '#2b2b2b',
  switch: '#3a3a3a',
  led: '#ff5a4f',
  antenna: '#d9a441',
  sma: '#e2b33c',
  ufl: '#e2b33c',
  jst: '#f2f2ee',
  display: '#10151c',
  sd: '#9aa3ab',
  header: '#1d1d1d',
  battery: '#4a6fa5',
  barrel: '#222222',
  module: '#9da5ad',
  other: '#7f8c8d',
};

/**
 * A simplified visual stand-in for the board. Positioned so that the PCB's
 * bottom-left corner sits at `origin`, matching the case layout.
 */
export function buildBoardModel(
  device: Device,
  origin: THREE.Vector3,
  cadModel?: THREE.BufferGeometry | null,
): THREE.Group {
  const g = new THREE.Group();
  const b = device.board;

  if (cadModel) {
    // The manufacturer's model, in board coordinates with z = 0 on the front face.
    const real = new THREE.Mesh(cadModel, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 }));
    real.position.z = b.thickness;
    // Owned by the app (shared across rebuilds): the viewer must not dispose it.
    real.userData.keepGeometry = true;
    g.add(real);
  } else {
    const pcb = new THREE.Mesh(
      new THREE.BoxGeometry(b.length, b.width, b.thickness),
      new THREE.MeshStandardMaterial({ color: b.color ?? '#1f6f43', roughness: 0.7 }),
    );
    pcb.position.set(b.length / 2, b.width / 2, b.thickness / 2);
    g.add(pcb);
  }

  const holeMat = new THREE.MeshStandardMaterial({ color: '#d4b25a', metalness: 0.6, roughness: 0.3 });
  for (const h of device.mountingHoles) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(h.diameter / 2 + 0.3, 0.3, 8, 24), holeMat);
    ring.position.set(h.x, h.y, b.thickness + 0.01);
    g.add(ring);
  }

  for (const f of device.features) {
    const color = KIND_COLORS[f.kind] ?? '#888';
    const metallic = ['usb-c', 'micro-usb', 'usb-a', 'sd', 'module', 'sma', 'ufl'].includes(f.kind);
    const mat = new THREE.MeshStandardMaterial({
      color,
      metalness: metallic ? 0.7 : 0.1,
      roughness: metallic ? 0.35 : 0.6,
      emissive: f.kind === 'led' ? new THREE.Color('#ff2010') : new THREE.Color('#000'),
      emissiveIntensity: f.kind === 'led' ? 0.6 : 0,
    });
    const [sx, sy, sz] = f.size;
    const geo =
      f.shape === 'circle' && (f.side === 'left' || f.side === 'right')
        ? new THREE.CylinderGeometry(sz / 2, sz / 2, sx, 24).rotateZ(Math.PI / 2)
        : f.shape === 'circle' && (f.side === 'front' || f.side === 'back')
          ? new THREE.CylinderGeometry(sz / 2, sz / 2, sy, 24)
          : f.shape === 'circle'
            ? new THREE.CylinderGeometry(sx / 2, sx / 2, sz, 24).rotateX(Math.PI / 2)
            : new THREE.BoxGeometry(sx, sy, sz);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(f.x, f.y, b.thickness + f.z);
    m.userData.featureId = f.id;
    if (cadModel) {
      // With the real model showing, draw parts as outlines so you can see what each one maps to.
      mat.transparent = true;
      mat.opacity = 0.12;
      mat.depthWrite = false;
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#38bdf8' }));
      m.add(outline);
    }
    g.add(m);
  }

  g.position.copy(origin);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}
