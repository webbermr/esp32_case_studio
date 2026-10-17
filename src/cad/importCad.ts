import { parseEagle } from './eagle';
import { parseKicad } from './kicad';
import type { CadBoard, CadMesh } from './types';

export const CAD_ACCEPT = '.step,.stp,.brd,.kicad_pcb';

export function cadFormat(fileName: string): 'step' | 'eagle' | 'kicad' | null {
  const n = fileName.toLowerCase();
  if (n.endsWith('.step') || n.endsWith('.stp')) return 'step';
  if (n.endsWith('.brd')) return 'eagle';
  if (n.endsWith('.kicad_pcb')) return 'kicad';
  return null;
}

/** Read a STEP, Eagle .brd or KiCad .kicad_pcb file into a CadBoard (plus a 3D mesh for STEP). */
export async function importCadFile(file: File, onStatus: (msg: string) => void): Promise<{ cad: CadBoard; mesh?: CadMesh }> {
  const format = cadFormat(file.name);
  if (format === 'eagle') return { cad: parseEagle(await file.text()) };
  if (format === 'kicad') return { cad: parseKicad(await file.text()) };
  if (format !== 'step') throw new Error('Use a STEP (.step/.stp), Eagle (.brd) or KiCad (.kicad_pcb) file.');

  onStatus(`Reading ${file.name} (${(file.size / 1e6).toFixed(1)} MB). Big models take up to a minute…`);
  const buffer = await file.arrayBuffer();
  const worker = new Worker(new URL('./stepWorker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'status') onStatus(m.message);
        if (m.type === 'done') resolve({ cad: m.board, mesh: m.mesh });
        if (m.type === 'error') reject(new Error(m.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'The STEP reader crashed.'));
      worker.postMessage(buffer, [buffer]);
    });
  } finally {
    worker.terminate();
  }
}
