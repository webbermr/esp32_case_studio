import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';
import type { Device } from '../src/types';
import { CAD_DIR } from './cadFetch';
import { describeError, lookupBoard, lookupEnabled, type LookupEvent } from './lookup';

/*
 * Local API for board lookups, mounted on Vite's dev and preview servers:
 *   GET  /api/status   -> { lookup: boolean }
 *   GET  /api/lookups  -> Device[] previously looked up (cached on disk)
 *   POST /api/lookup   { query } -> NDJSON stream of LookupEvent
 *
 * Results are cached in lookups/boards.json so a board is only researched once.
 */

const CACHE_DIR = path.resolve('lookups');
const CACHE_FILE = path.join(CACHE_DIR, 'boards.json');
const SAVED_FILE = path.join(CACHE_DIR, 'saved.json');

async function readSaved(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(SAVED_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function writeSaved(all: Record<string, unknown>) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(SAVED_FILE, JSON.stringify(all, null, 2));
}

interface Cache {
  /** normalised query -> device id */
  queries: Record<string, string>;
  devices: Record<string, Device>;
}

const normalise = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function loadCache(): Promise<Cache> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, 'utf8')) as Cache;
  } catch {
    return { queries: {}, devices: {} };
  }
}

async function saveCache(c: Cache) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(c, null, 2));
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 10_000): Promise<string> {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > limit) throw new Error('Request too large');
  }
  return data;
}

// One lookup at a time per query, so a double-click doesn't pay twice.
const inFlight = new Map<string, Promise<Device>>();

const api: Connect.NextHandleFunction = async (req, res, next) => {
  const url = req.url?.split('?')[0];
  try {
    if (req.method === 'GET' && url === '/api/status') {
      return json(res, 200, { lookup: lookupEnabled() });
    }
    if (req.method === 'GET' && url?.startsWith('/api/cad/')) {
      const name = url.slice('/api/cad/'.length);
      if (!/^[0-9a-f]{16}\.(step|brd|kicad_pcb)$/.test(name)) return json(res, 400, { error: 'Bad file name' });
      try {
        const data = await readFile(path.join(CAD_DIR, name));
        res.setHeader('Content-Type', 'application/octet-stream');
        return res.end(data);
      } catch {
        return json(res, 404, { error: 'Not found' });
      }
    }
    if (url === '/api/saved' && req.method === 'GET') {
      return json(res, 200, await readSaved());
    }
    if (url?.startsWith('/api/saved/')) {
      const id = decodeURIComponent(url.slice('/api/saved/'.length));
      if (!/^[\w.-]{1,120}$/.test(id)) return json(res, 400, { error: 'Bad id' });
      const all = await readSaved();
      if (req.method === 'PUT') {
        const body = await readBody(req, 2_000_000);
        const rec = JSON.parse(body) as { device?: { id?: string } };
        if (rec?.device?.id !== id) return json(res, 400, { error: 'Board id mismatch' });
        all[id] = rec;
        await writeSaved(all);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        delete all[id];
        await writeSaved(all);
        return json(res, 200, { ok: true });
      }
    }
    if (req.method === 'GET' && url === '/api/lookups') {
      const cache = await loadCache();
      return json(res, 200, Object.values(cache.devices));
    }
    if (req.method === 'POST' && url === '/api/lookup') {
      if (!lookupEnabled()) {
        return json(res, 503, { error: 'Set ANTHROPIC_API_KEY in .env and restart the dev server to enable lookups.' });
      }
      const { query } = JSON.parse(await readBody(req)) as { query?: string };
      const q = (query ?? '').trim().slice(0, 120);
      if (!q) return json(res, 400, { error: 'Missing query' });

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Cache-Control', 'no-cache');
      const emit = (e: LookupEvent) => res.write(JSON.stringify(e) + '\n');

      const key = normalise(q);
      const cache = await loadCache();
      const cachedId = cache.queries[key];
      if (cachedId && cache.devices[cachedId]) {
        emit({ type: 'done', device: cache.devices[cachedId] });
        return res.end();
      }

      const abort = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) abort.abort();
      });

      try {
        let job = inFlight.get(key);
        if (!job) {
          job = lookupBoard(q, emit, abort.signal);
          inFlight.set(key, job);
        }
        const device = await job;
        const fresh = await loadCache();
        fresh.devices[device.id] = device;
        fresh.queries[key] = device.id;
        await saveCache(fresh);
        emit({ type: 'done', device });
      } catch (e) {
        console.error('[lookup]', e);
        emit({ type: 'error', message: describeError(e) });
      } finally {
        inFlight.delete(key);
        res.end();
      }
      return;
    }
  } catch (e) {
    console.error('[api]', e);
    if (!res.headersSent) return json(res, 500, { error: 'Internal error' });
    return res.end();
  }
  next();
};

function logStatus() {
  if (lookupEnabled()) {
    console.log('  \x1b[32m✓\x1b[0m Online board lookup enabled (API key found)');
  } else {
    console.log(
      `  \x1b[33m!\x1b[0m Online board lookup disabled: no ANTHROPIC_API_KEY found.\n` +
        `    Put ANTHROPIC_API_KEY=sk-ant-... in ${path.resolve('.env')} and restart.`,
    );
  }
}

export function boardLookupApi(): Plugin {
  return {
    name: 'board-lookup-api',
    configureServer(server) {
      server.middlewares.use(api);
      server.httpServer?.once('listening', logStatus);
    },
    configurePreviewServer(server) {
      server.middlewares.use(api);
      server.httpServer?.once('listening', logStatus);
    },
  };
}
