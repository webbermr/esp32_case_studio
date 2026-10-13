import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';
import type { Device } from '../src/types';
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

async function readBody(req: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 10_000) throw new Error('Request too large');
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
