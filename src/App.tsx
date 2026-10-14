import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchBox } from './components/SearchBox';
import { SpecPanel } from './components/SpecPanel';
import { Viewer, type CameraPreset, type ReferenceImage, type ViewOptions } from './components/Viewer';
import { DEVICES, customDevice } from './data/devices';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { buildCase, buildFitCheck, initCsg, lidForPrinting, type CaseParts } from './lib/caseGeometry';
import { download, geometryToStl, layoutOnBed } from './lib/exportStl';
import { cachedLookups, lookupBoard, lookupStatus, type LookupEvent, type LookupStatus } from './lib/lookupClient';
import { DEFAULT_SETTINGS, type CaseSettings, type Device } from './types';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export default function App() {
  const [library, setLibrary] = useState<Device[]>(DEVICES);
  const [baseline, setBaseline] = useState<Device>(DEVICES[0]);
  const [device, setDevice] = useState<Device>(() => clone(DEVICES[0]));
  const [settings, setSettings] = useState<CaseSettings>(DEFAULT_SETTINGS);
  const [parts, setParts] = useState<CaseParts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [view, setView] = useState<ViewOptions>({
    board: true,
    base: true,
    lid: true,
    exploded: true,
    dimensions: true,
    xray: false,
    fitCheck: false,
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const [kernelReady, setKernelReady] = useState(false);
  // Reference photos, per board (object URLs; kept for this browser session).
  const [references, setReferences] = useState<Record<string, ReferenceImage>>({});
  const [camera, setCamera] = useState<{ preset: CameraPreset; n: number }>({ preset: 'iso', n: 0 });
  const moveCamera = (preset: CameraPreset) => setCamera((c) => ({ preset, n: c.n + 1 }));
  /** Part (or mounting hole) being positioned by clicking on the board. */
  const [placing, setPlacing] = useState<{ kind: 'feature'; id: string } | { kind: 'hole'; index: number } | null>(null);
  const [canLookup, setCanLookup] = useState<LookupStatus>('no-server');
  const [lookup, setLookup] = useState<{ query: string; log: LookupEvent[]; error?: string } | null>(null);
  const lookupAbort = useRef<AbortController | null>(null);

  // Lookups need the local server (npm run dev / preview) with an API key.
  useEffect(() => {
    lookupStatus().then(setCanLookup);
    cachedLookups().then((found) => {
      if (found.length) setLibrary((lib) => [...lib, ...found.filter((d) => !lib.some((x) => x.id === d.id))]);
    });
  }, []);

  const runLookup = async (query: string) => {
    lookupAbort.current?.abort();
    const ac = new AbortController();
    lookupAbort.current = ac;
    setLookup({ query, log: [] });
    try {
      const d = await lookupBoard(query, (e) => setLookup((l) => (l ? { ...l, log: [...l.log, e] } : l)), ac.signal);
      setLibrary((lib) => [d, ...lib.filter((x) => x.id !== d.id)]);
      selectDevice(d);
      setLookup(null);
    } catch (e) {
      if (ac.signal.aborted) return;
      setLookup((l) => (l ? { ...l, error: e instanceof Error ? e.message : String(e) } : l));
    }
  };

  const cancelLookup = () => {
    lookupAbort.current?.abort();
    setLookup(null);
  };

  useEffect(() => {
    initCsg(wasmUrl)
      .then(() => setKernelReady(true))
      .catch((e) => {
        console.error(e);
        setError('Could not load the geometry engine (WebAssembly). Try a current Chrome, Firefox, Edge or Safari.');
      });
  }, []);

  // Rebuild the case geometry (debounced; CSG takes a few tens of ms).
  useEffect(() => {
    if (!kernelReady) return;
    setBuilding(true);
    const t = setTimeout(() => {
      try {
        const p = buildCase(device, settings);
        setParts((old) => {
          old?.base.dispose();
          old?.lid.dispose();
          [...(old?.actuators ?? []), ...(old?.extras ?? [])].forEach((a) => {
            a.geometry.dispose();
            a.print.dispose();
          });
          return p;
        });
        setError(null);
      } catch (e) {
        console.error(e);
        setError('Could not build the case with these values. Check for overlapping or zero-size openings.');
      } finally {
        setBuilding(false);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [device, settings, kernelReady]);

  // Only build the fit-check plate while it's shown; downloads build it on demand.
  const fitCheck = useMemo(() => {
    if (!kernelReady || !view.fitCheck) return null;
    try {
      return buildFitCheck(device);
    } catch {
      return null;
    }
  }, [device, kernelReady, view.fitCheck]);

  const edited = useMemo(() => JSON.stringify(device) !== JSON.stringify(baseline), [device, baseline]);

  const selectDevice = (d: Device) => {
    setBaseline(d);
    setDevice(clone(d));
  };

  const slug = device.id || 'case';

  const exportPart = (which: 'base' | 'lid' | 'actuators' | 'stand' | 'fit' | 'all') => {
    if (which === 'fit') {
      download(`${slug}-fit-check.stl`, geometryToStl(buildFitCheck(device)));
      return;
    }
    if (!parts) return;
    const lid = lidForPrinting(parts.lid);
    const small = parts.actuators.map((a) => a.print);
    const stand = parts.extras.map((e) => e.print);
    if (which === 'stand') download(`${slug}-stand.stl`, geometryToStl(layoutOnBed(stand, 6)));
    if (which === 'base') download(`${slug}-base.stl`, geometryToStl(parts.base));
    if (which === 'lid') download(`${slug}-lid.stl`, geometryToStl(lid));
    if (which === 'actuators') download(`${slug}-buttons.stl`, geometryToStl(layoutOnBed(small, 4)));
    if (which === 'all') download(`${slug}-plate.stl`, geometryToStl(layoutOnBed([parts.base, lid, ...small, ...stand])));
    lid.dispose();
  };

  const exportJson = () => {
    download(`${slug}-spec.json`, JSON.stringify({ device, settings }, null, 2), 'application/json');
  };

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const d: Device = data.device ?? data;
      if (!d?.board?.length || !Array.isArray(d.features)) throw new Error('not a device file');
      d.id = d.id || `import-${Date.now().toString(36)}`;
      d.mountingHoles = d.mountingHoles ?? [];
      d.sources = d.sources ?? [];
      d.specs = d.specs ?? {};
      d.aliases = d.aliases ?? [];
      d.tags = d.tags ?? [];
      d.origin = d.origin ?? 'import';
      setLibrary((lib) => [d, ...lib.filter((x) => x.id !== d.id)]);
      selectDevice(d);
      if (data.settings) setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
    } catch {
      setError('That file is not a Case Studio spec (expected the JSON from "Save spec").');
    }
  };

  const toggle = (k: keyof ViewOptions) => setView((v) => ({ ...v, [k]: !v[k] }));

  const reference = references[device.id] ?? null;
  const setReference = (r: ReferenceImage | null) =>
    setReferences((all) => {
      const next = { ...all };
      if (r) next[device.id] = r;
      else delete next[device.id];
      return next;
    });

  const startPlacing = (p: NonNullable<typeof placing>) => {
    setPlacing(p);
    const f = p.kind === 'feature' ? device.features.find((x) => x.id === p.id) : null;
    const fromBelow = f ? f.side === 'bottom' || (f.side !== 'top' && f.z < 0 && reference?.face === 'bottom') : reference?.face === 'bottom';
    moveCamera(fromBelow ? 'bottom' : 'top');
  };

  const pick = (x: number, y: number) => {
    if (!placing) return;
    if (placing.kind === 'hole') {
      setDevice((d) => ({ ...d, mountingHoles: d.mountingHoles.map((h, i) => (i === placing.index ? { ...h, x, y } : h)) }));
    } else {
      setDevice((d) => ({
        ...d,
        features: d.features.map((f) => {
          if (f.id !== placing.id) return f;
          // Edge parts only move along their edge; face parts move freely.
          if (f.side === 'left' || f.side === 'right') return { ...f, y };
          if (f.side === 'front' || f.side === 'back') return { ...f, x };
          return { ...f, x, y };
        }),
      }));
    }
    setPlacing(null);
  };

  useEffect(() => {
    if (!placing) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPlacing(null);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [placing]);

  // While placing, show just the board so nothing blocks the click.
  const shownView: ViewOptions = placing
    ? { board: true, base: false, lid: false, exploded: false, xray: false, dimensions: false, fitCheck: false }
    : view;
  const placingLabel = placing
    ? placing.kind === 'hole'
      ? `mounting hole #${placing.index + 1}`
      : device.features.find((f) => f.id === placing.id)?.label ?? 'part'
    : '';

  return (
    <div className="app">
      <aside className="left">
        <header className="brand">
          <span className="logo" aria-hidden />
          <span>Case Studio</span>
          <span className="sub">enclosures for dev boards</span>
        </header>
        <SearchBox
          devices={library}
          selectedId={device.id}
          onSelect={selectDevice}
          onCustom={() => selectDevice(customDevice())}
          onLookup={runLookup}
          lookupStatus={canLookup}
        />
        {lookup && <LookupProgress lookup={lookup} onCancel={cancelLookup} />}
        <SpecPanel
          device={device}
          settings={settings}
          layout={parts?.layout ?? null}
          edited={edited}
          onDevice={setDevice}
          onSettings={setSettings}
          onReset={() => setDevice(clone(baseline))}
          onHighlight={setHighlight}
          reference={reference}
          onReference={setReference}
          onPlace={startPlacing}
          placing={placing}
        />
      </aside>

      <main className="right">
        <div className="toolbar">
          <div className="toggles">
            {(
              [
                ['board', 'Board'],
                ['base', 'Base'],
                ['lid', 'Lid'],
                ['exploded', 'Exploded'],
                ['xray', 'X-ray'],
                ['dimensions', 'Dimensions'],
                ['fitCheck', 'Fit check'],
              ] as [keyof ViewOptions, string][]
            ).map(([k, label]) => (
              <button key={k} className={`toggle ${view[k] ? 'on' : ''}`} onClick={() => toggle(k)} aria-pressed={view[k]}>
                {label}
              </button>
            ))}
          </div>
          <div className="downloads">
            <button className="primary" disabled={!parts} onClick={() => exportPart('all')}>
              Download STL
            </button>
            <button disabled={!parts} onClick={() => exportPart('base')}>
              Base
            </button>
            <button disabled={!parts} onClick={() => exportPart('lid')}>
              Lid
            </button>
            {parts && parts.actuators.length > 0 && (
              <button onClick={() => exportPart('actuators')} title="Button plungers and switch caps">
                Buttons ({parts.actuators.length})
              </button>
            )}
            {parts && parts.extras.length > 0 && (
              <button onClick={() => exportPart('stand')}>Stand</button>
            )}
            <button
              disabled={!kernelReady}
              onClick={() => exportPart('fit')}
              title="A 1.2 mm plate with a hole at every part. Print it first and lay it on your board to check positions."
            >
              Fit check
            </button>
            <button onClick={exportJson}>Save spec</button>
            <button onClick={() => fileInput.current?.click()}>Load spec</button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJson(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        <Viewer
          device={device}
          parts={parts}
          view={shownView}
          highlight={placing?.kind === 'feature' ? placing.id : highlight}
          reference={placing || !view.lid || !view.base ? reference : null}
          camera={camera}
          onPick={placing ? pick : null}
          fitCheck={fitCheck}
        />
        <div className="view-presets">
          <button onClick={() => moveCamera('top')} title="Look at the top (front) of the board">Top</button>
          <button onClick={() => moveCamera('bottom')} title="Look at the underside (back)">Bottom</button>
          <button onClick={() => moveCamera('iso')}>3D</button>
        </div>
        {placing && (
          <div className="place-banner" role="status">
            <span>
              Click on the board where the <b>{placingLabel}</b> is. Drag to rotate, Esc to cancel.
            </span>
            <button className="link-btn" onClick={() => setPlacing(null)}>
              Cancel
            </button>
          </div>
        )}
        <div className="status">
          {(building || !kernelReady) && !error && <span className="pill">{kernelReady ? 'Rebuilding…' : 'Loading geometry engine…'}</span>}
          {error && <span className="pill err">{error}</span>}
          {parts?.warnings.map((w) => (
            <span key={w} className="pill warn">
              {w}
            </span>
          ))}
          <span className="hint">Drag to rotate · right-drag to pan · scroll to zoom</span>
        </div>
      </main>
    </div>
  );
}

function LookupProgress({
  lookup,
  onCancel,
}: {
  lookup: { query: string; log: LookupEvent[]; error?: string };
  onCancel: () => void;
}) {
  const steps = lookup.log.slice(-6);
  return (
    <div className={`lookup-panel ${lookup.error ? 'failed' : ''}`} role="status" aria-live="polite">
      <div className="lookup-head">
        <span>{lookup.error ? 'Lookup failed' : `Researching “${lookup.query}”`}</span>
        <button className="link-btn" onClick={onCancel}>
          {lookup.error ? 'Dismiss' : 'Cancel'}
        </button>
      </div>
      {lookup.error ? (
        <p className="lookup-error">{lookup.error}</p>
      ) : (
        <ul className="lookup-log">
          {steps.length === 0 && <li>Starting…</li>}
          {steps.map((e, i) => (
            <li key={i}>
              {e.type === 'search' && <>Searching: {e.query}</>}
              {e.type === 'fetch' && <>Reading: {shortUrl(e.url)}</>}
              {e.type === 'status' && <>{e.message}</>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function shortUrl(u: string) {
  try {
    const url = new URL(u);
    return url.hostname + (url.pathname.length > 30 ? url.pathname.slice(0, 30) + '…' : url.pathname);
  } catch {
    return u;
  }
}
