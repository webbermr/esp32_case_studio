/// <reference lib="webworker" />
// Reads a STEP file off the main thread (it can take tens of seconds for a big model).
import occtimportjs from 'occt-import-js';
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import { analyzeStep, type OcctResult } from './step';

let occt: Promise<{ ReadStepFile: (data: Uint8Array, params: unknown) => OcctResult }> | null = null;

self.onmessage = async (e: MessageEvent<ArrayBuffer>) => {
  try {
    occt ??= occtimportjs({ locateFile: () => wasmUrl });
    const m = await occt;
    self.postMessage({ type: 'status', message: 'Measuring parts…' });
    const res = m.ReadStepFile(new Uint8Array(e.data), null);
    const { board, mesh } = analyzeStep(res);
    self.postMessage({ type: 'done', board, mesh }, [mesh.positions.buffer, mesh.colors.buffer, mesh.indices.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
