import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

export function geometryToStl(geometry: THREE.BufferGeometry): ArrayBuffer {
  const mesh = new THREE.Mesh(geometry);
  mesh.updateMatrixWorld();
  const data = new STLExporter().parse(mesh, { binary: true }) as DataView;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/** Lay several parts out side by side on the bed (Z=0), separated by `gap`. */
export function layoutOnBed(parts: THREE.BufferGeometry[], gap = 8): THREE.BufferGeometry {
  let x = 0;
  const placed: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    const g = p.clone();
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    g.translate(x - bb.min.x, -bb.min.y, -bb.min.z);
    x += bb.max.x - bb.min.x + gap;
    placed.push(g);
  }
  return mergeNonIndexed(placed);
}

function mergeNonIndexed(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const arrays = parts.map((p) => (p.index ? p.toNonIndexed() : p).getAttribute('position').array as Float32Array);
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

export function download(name: string, data: BlobPart, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
