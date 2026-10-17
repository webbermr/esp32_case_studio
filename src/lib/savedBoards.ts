import type { CaseSettings, Device } from '../types';

/*
 * Boards you have corrected (positions, sizes, case settings) are saved so the
 * next time you pick the board you get your version, not the original.
 *
 * With the local server running they go to lookups/saved.json (shared by every
 * browser on this machine); a copy is always kept in this browser's storage so
 * a static deploy still remembers them.
 */

export interface SavedBoard {
  device: Device;
  settings: CaseSettings;
  savedAt: string;
}

export type SavedBoards = Record<string, SavedBoard>;

const KEY = 'case-studio:saved-boards';

function readLocal(): SavedBoards {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as SavedBoards;
  } catch {
    return {};
  }
}

function writeLocal(all: SavedBoards) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Private mode or storage full: the server copy (if any) still holds it.
  }
}

/** Newest copy of each board wins. */
function merge(a: SavedBoards, b: SavedBoards): SavedBoards {
  const out = { ...a };
  for (const [id, rec] of Object.entries(b)) {
    if (!out[id] || rec.savedAt > out[id].savedAt) out[id] = rec;
  }
  return out;
}

export async function loadSaved(): Promise<SavedBoards> {
  const local = readLocal();
  try {
    const r = await fetch('./api/saved');
    if (r.ok && r.headers.get('content-type')?.includes('json')) {
      const all = merge(local, (await r.json()) as SavedBoards);
      writeLocal(all);
      return all;
    }
  } catch {
    // no server
  }
  return local;
}

/** Returns where it was saved. */
export async function saveBoard(rec: SavedBoard): Promise<'server' | 'browser'> {
  writeLocal({ ...readLocal(), [rec.device.id]: rec });
  try {
    const r = await fetch(`./api/saved/${encodeURIComponent(rec.device.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec),
    });
    if (r.ok) return 'server';
  } catch {
    // no server
  }
  return 'browser';
}

export async function deleteSaved(id: string): Promise<void> {
  const local = readLocal();
  delete local[id];
  writeLocal(local);
  try {
    await fetch(`./api/saved/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch {
    // no server
  }
}
