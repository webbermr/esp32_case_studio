import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { parseEagle } from '../src/cad/eagle';
import { parseKicad } from '../src/cad/kicad';
import { analyzeStep, type OcctResult } from '../src/cad/step';
import type { CadBoard } from '../src/cad/types';

/*
 * Download a manufacturer CAD file found by the lookup and read it with the
 * same code the browser import uses. Handles GitHub page links, Git LFS
 * pointers and zip archives.
 */

export type CadFormat = 'step' | 'eagle' | 'kicad';
const MAX_BYTES = 80 * 1024 * 1024;
export const CAD_DIR = path.resolve('lookups', 'cad');

/** GitHub "blob" page links → raw file URLs. */
export function rawUrl(url: string): string {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(url);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  return url;
}

/** raw.githubusercontent.com → the LFS media URL, for files stored in Git LFS. */
export function lfsUrl(url: string): string | null {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(.+)$/.exec(url);
  return m ? `https://media.githubusercontent.com/media/${m[1]}/${m[2]}/${m[3]}` : null;
}

export function formatOf(name: string): CadFormat | 'zip' | null {
  const n = name.toLowerCase().split('?')[0];
  if (n.endsWith('.step') || n.endsWith('.stp')) return 'step';
  if (n.endsWith('.brd')) return 'eagle';
  if (n.endsWith('.kicad_pcb')) return 'kicad';
  if (n.endsWith('.zip')) return 'zip';
  return null;
}

function sniff(data: Uint8Array): CadFormat | 'zip' | 'lfs' | null {
  const head = new TextDecoder().decode(data.subarray(0, 400));
  if (data[0] === 0x50 && data[1] === 0x4b) return 'zip';
  if (head.startsWith('version https://git-lfs')) return 'lfs';
  if (head.includes('ISO-10303-21')) return 'step';
  if (head.includes('<eagle')) return 'eagle';
  if (head.trimStart().startsWith('(kicad_pcb')) return 'kicad';
  return null;
}

async function download(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const r = await fetch(url, { signal, redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error(`too large (${(len / 1e6).toFixed(0)} MB)`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) throw new Error('too large');
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export interface FetchedCad {
  format: CadFormat;
  data: Uint8Array;
  fileName: string;
  sourceUrl: string;
}

/** Download and unwrap (LFS, zip) a CAD file. Returns null when nothing usable is inside. */
export async function fetchCad(url: string, signal?: AbortSignal): Promise<FetchedCad | null> {
  const first = rawUrl(url);
  let data = await download(first, signal);
  let kind = sniff(data);
  if (kind === 'lfs') {
    const media = lfsUrl(first);
    if (!media) return null;
    data = await download(media, signal);
    kind = sniff(data);
  }
  const fileName = decodeURIComponent(first.split('/').pop()?.split('?')[0] ?? 'board');
  if (kind === 'zip') {
    const files = unzipSync(data, { filter: (f) => formatOf(f.name) !== null && formatOf(f.name) !== 'zip' });
    const pick = (fmt: CadFormat) => Object.entries(files).find(([n]) => formatOf(n) === fmt);
    const found = pick('step') ?? pick('eagle') ?? pick('kicad');
    if (!found) return null;
    const fmt = formatOf(found[0]) as CadFormat;
    return { format: fmt, data: found[1], fileName: found[0].split('/').pop()!, sourceUrl: url };
  }
  if (kind === 'step' || kind === 'eagle' || kind === 'kicad') return { format: kind, data, fileName, sourceUrl: url };
  return null;
}

let occt: Promise<{ ReadStepFile: (d: Uint8Array, p: unknown) => OcctResult }> | null = null;

export async function parseCad(f: FetchedCad): Promise<CadBoard> {
  if (f.format === 'eagle') return parseEagle(new TextDecoder().decode(f.data));
  if (f.format === 'kicad') return parseKicad(new TextDecoder().decode(f.data));
  occt ??= createRequire(import.meta.url)('occt-import-js')();
  const m = await occt!;
  return analyzeStep(m.ReadStepFile(f.data, null)).board;
}

/** Keep a copy so the browser can load the 3D model later (served at /api/cad/<name>). */
export async function storeCad(f: FetchedCad): Promise<string> {
  const ext = f.format === 'step' ? 'step' : f.format === 'eagle' ? 'brd' : 'kicad_pcb';
  const name = `${createHash('sha1').update(f.sourceUrl).digest('hex').slice(0, 16)}.${ext}`;
  await mkdir(CAD_DIR, { recursive: true });
  await writeFile(path.join(CAD_DIR, name), f.data);
  return name;
}
