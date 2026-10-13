import type { Device } from '../types';

export type LookupEvent =
  | { type: 'status'; message: string }
  | { type: 'search'; query: string }
  | { type: 'fetch'; url: string }
  | { type: 'done'; device: Device }
  | { type: 'error'; message: string };

/**
 * - enabled:   local server with an API key
 * - no-key:    local server running, but no ANTHROPIC_API_KEY
 * - no-server: static hosting (or an old server without the lookup API)
 */
export type LookupStatus = 'enabled' | 'no-key' | 'no-server';

export async function lookupStatus(): Promise<LookupStatus> {
  try {
    const r = await fetch('./api/status');
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) return 'no-server';
    return (await r.json()).lookup ? 'enabled' : 'no-key';
  } catch {
    return 'no-server';
  }
}

export async function cachedLookups(): Promise<Device[]> {
  try {
    const r = await fetch('./api/lookups');
    return r.ok ? ((await r.json()) as Device[]) : [];
  } catch {
    return [];
  }
}

/** Run a lookup, calling `onEvent` for each progress update. Resolves with the device. */
export async function lookupBoard(query: string, onEvent: (e: LookupEvent) => void, signal?: AbortSignal): Promise<Device> {
  const r = await fetch('./api/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal,
  });
  if (!r.ok || !r.body) {
    const msg = await r.json().then((j) => j.error as string).catch(() => `Lookup failed (${r.status})`);
    throw new Error(msg);
  }
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const e = JSON.parse(line) as LookupEvent;
      if (e.type === 'done') return e.device;
      if (e.type === 'error') throw new Error(e.message);
      onEvent(e);
    }
  }
  throw new Error('Lookup ended without a result.');
}
