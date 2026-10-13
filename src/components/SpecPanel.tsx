import { useState } from 'react';
import type { CaseLayout } from '../lib/caseGeometry';
import { cutoutSize, DEFAULT_LEVER, DEFAULT_TRAVEL, plungerDims, usesActuator } from '../lib/caseGeometry';
import { KIND_COLORS } from '../lib/boardModel';
import type { CaseSettings, Device, Feature, FeatureKind, Side } from '../types';
import { NumberField } from './NumberField';

interface Props {
  device: Device;
  settings: CaseSettings;
  layout: CaseLayout | null;
  edited: boolean;
  onDevice: (d: Device) => void;
  onSettings: (s: CaseSettings) => void;
  onReset: () => void;
  onHighlight: (id: string | null) => void;
}

const SIDES: Side[] = ['left', 'right', 'front', 'back', 'top', 'bottom'];
const KINDS: FeatureKind[] = [
  'usb-c', 'micro-usb', 'usb-a', 'button', 'switch', 'led', 'antenna', 'sma', 'ufl',
  'jst', 'display', 'sd', 'header', 'battery', 'barrel', 'module', 'other',
];

const CONFIDENCE_TEXT: Record<Device['confidence'], string> = {
  datasheet: 'Board outline and holes from the manufacturer drawing. Part positions approximate.',
  partial: 'Board outline from manufacturer docs. Part positions are estimates from photos/pinouts.',
  estimated: 'Estimated dimensions. Measure your board before printing.',
};

export function SpecPanel({ device, settings, layout, edited, onDevice, onSettings, onReset, onHighlight }: Props) {
  const [openFeature, setOpenFeature] = useState<string | null>(null);
  const b = device.board;
  const setBoard = (patch: Partial<Device['board']>) => onDevice({ ...device, board: { ...b, ...patch } });
  const setFeature = (id: string, patch: Partial<Feature>) =>
    onDevice({ ...device, features: device.features.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const set = <K extends keyof CaseSettings>(k: K) => (v: CaseSettings[K]) => onSettings({ ...settings, [k]: v });

  const addFeature = () => {
    const id = `f${Date.now().toString(36)}`;
    const f: Feature = {
      id, label: 'New opening', kind: 'other', side: 'left',
      x: 0, y: b.width / 2, z: 1.5, size: [4, 6, 3], cutout: true,
    };
    onDevice({ ...device, features: [...device.features, f] });
    setOpenFeature(id);
  };

  return (
    <div className="spec-panel">
      <section className="device-head">
        <div className="device-title">
          <h1>{device.name}</h1>
          <span className={`chip chip-${device.category.toLowerCase()}`}>{device.category}</span>
        </div>
        <p className="maker">{device.manufacturer}</p>
        {device.origin === 'lookup' && (
          <p className="confidence conf-estimated">
            Researched by Claude from web sources. Numbers can be wrong: check them against the linked sources and your
            board before printing.
          </p>
        )}
        <p className={`confidence conf-${device.confidence}`}>{CONFIDENCE_TEXT[device.confidence]}</p>
        {device.notes && <p className="notes">{device.notes}</p>}
        {edited && (
          <button className="link-btn" onClick={onReset}>
            Revert to library values
          </button>
        )}
      </section>

      {layout && (
        <section className="summary">
          <div>
            <span className="big">{layout.outerLength.toFixed(1)}</span>
            <span className="cap">length</span>
          </div>
          <div>
            <span className="big">{layout.outerWidth.toFixed(1)}</span>
            <span className="cap">width</span>
          </div>
          <div>
            <span className="big">{layout.totalHeight.toFixed(1)}</span>
            <span className="cap">height</span>
          </div>
          <p className="summary-note">Outside case dimensions, mm (base {layout.baseHeight.toFixed(1)} + lid {settings.lidThickness})</p>
        </section>
      )}

      <details open>
        <summary>Specifications</summary>
        <table className="spec-table">
          <tbody>
            {Object.entries(device.specs).map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {device.sources.length > 0 && (
          <div className="sources">
            <span>Sources:</span>
            {device.sources.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                {s.label} ↗
              </a>
            ))}
          </div>
        )}
      </details>

      <details open>
        <summary>Board dimensions</summary>
        <div className="grid2">
          <NumberField label="PCB length (X)" value={b.length} min={5} onChange={(v) => setBoard({ length: v })} />
          <NumberField label="PCB width (Y)" value={b.width} min={5} onChange={(v) => setBoard({ width: v })} />
          <NumberField label="PCB thickness" value={b.thickness} min={0.4} onChange={(v) => setBoard({ thickness: v })} />
          <NumberField label="Tallest part above" value={b.heightAbove} min={0} onChange={(v) => setBoard({ heightAbove: v })} />
          <NumberField
            label="Tallest part below"
            value={b.heightBelow}
            min={0}
            hint="Pins, battery holders etc. under the PCB. Header pins are ~3 mm; with soldered male headers pointing down use ~8.5 mm."
            onChange={(v) => setBoard({ heightBelow: v })}
          />
        </div>
      </details>

      <details open>
        <summary>
          Ports, buttons &amp; parts <span className="count">{device.features.length}</span>
        </summary>
        <p className="help">Positions are part centres from the PCB's bottom-left corner (X along length, Y along width, Z above the top surface). Tick a part to cut an opening for it.</p>
        <ul className="features">
          {device.features.map((f) => {
            const isOpen = openFeature === f.id;
            const c = cutoutSize(f, settings.cutoutMargin);
            return (
              <li
                key={f.id}
                className={isOpen ? 'open' : ''}
                onMouseEnter={() => onHighlight(f.id)}
                onMouseLeave={() => onHighlight(null)}
              >
                <div className="f-row">
                  <input
                    type="checkbox"
                    checked={f.cutout}
                    onChange={(e) => setFeature(f.id, { cutout: e.target.checked })}
                    aria-label={`Cut opening for ${f.label}`}
                  />
                  <span className="swatch" style={{ background: KIND_COLORS[f.kind] }} />
                  <button className="f-name" onClick={() => setOpenFeature(isOpen ? null : f.id)}>
                    {f.label}
                  </button>
                  <span className="f-side">{f.side}</span>
                  <span className="f-size">
                    {!f.cutout
                      ? '—'
                      : usesActuator(f)
                        ? f.kind === 'button'
                          ? `plunger Ø${plungerDims(f).d.toFixed(1)}`
                          : 'slider cap'
                        : `${c.w.toFixed(1)}×${c.h.toFixed(1)}`}
                  </span>
                </div>
                {isOpen && (
                  <div className="f-edit">
                    <div className="grid2">
                      <label className="sel">
                        <span>Label</span>
                        <input value={f.label} onChange={(e) => setFeature(f.id, { label: e.target.value })} />
                      </label>
                      <label className="sel">
                        <span>Type</span>
                        <select value={f.kind} onChange={(e) => setFeature(f.id, { kind: e.target.value as FeatureKind })}>
                          {KINDS.map((k) => (
                            <option key={k}>{k}</option>
                          ))}
                        </select>
                      </label>
                      <label className="sel">
                        <span>Opening on</span>
                        <select value={f.side} onChange={(e) => setFeature(f.id, { side: e.target.value as Side })}>
                          {SIDES.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                      <label className="sel">
                        <span>Shape</span>
                        <select
                          value={f.shape ?? 'rect'}
                          onChange={(e) => setFeature(f.id, { shape: e.target.value as 'rect' | 'circle' })}
                        >
                          <option value="rect">rectangle</option>
                          <option value="circle">circle</option>
                        </select>
                      </label>
                      <NumberField label="Centre X" value={f.x} onChange={(v) => setFeature(f.id, { x: v })} />
                      <NumberField label="Centre Y" value={f.y} onChange={(v) => setFeature(f.id, { y: v })} />
                      <NumberField label="Centre Z" value={f.z} onChange={(v) => setFeature(f.id, { z: v })} />
                      <span />
                      <NumberField label="Size X" value={f.size[0]} min={0.1} onChange={(v) => setFeature(f.id, { size: [v, f.size[1], f.size[2]] })} />
                      <NumberField label="Size Y" value={f.size[1]} min={0.1} onChange={(v) => setFeature(f.id, { size: [f.size[0], v, f.size[2]] })} />
                      <NumberField label="Size Z" value={f.size[2]} min={0.1} onChange={(v) => setFeature(f.id, { size: [f.size[0], f.size[1], v] })} />
                    </div>
                    {(f.kind === 'button' || f.kind === 'switch') && (
                      <div className="actuator-box">
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={f.actuator !== false}
                            disabled={!f.cutout}
                            onChange={(e) => setFeature(f.id, { actuator: e.target.checked })}
                          />
                          <span>
                            {f.kind === 'button'
                              ? 'Print a plunger to press this button'
                              : 'Print a cap that slides this switch'}
                          </span>
                        </label>
                        {usesActuator(f) && f.kind === 'button' && (
                          <div className="grid2">
                            <NumberField
                              label="Plunger Ø"
                              value={plungerDims(f).d}
                              min={2}
                              onChange={(v) => setFeature(f.id, { plungerDiameter: v })}
                            />
                          </div>
                        )}
                        {usesActuator(f) && f.kind === 'switch' && (
                          <div className="grid2">
                            <NumberField
                              label="Switch travel"
                              value={f.switchTravel ?? DEFAULT_TRAVEL}
                              min={0.5}
                              onChange={(v) => setFeature(f.id, { switchTravel: v })}
                            />
                            <NumberField
                              label="Lever sticks out"
                              value={(f.leverSize ?? DEFAULT_LEVER)[2]}
                              min={0.5}
                              onChange={(v) => setFeature(f.id, { leverSize: [...(f.leverSize ?? DEFAULT_LEVER).slice(0, 2), v] as [number, number, number] })}
                            />
                            <NumberField
                              label="Lever width"
                              value={(f.leverSize ?? DEFAULT_LEVER)[0]}
                              min={0.5}
                              onChange={(v) => {
                                const l = f.leverSize ?? DEFAULT_LEVER;
                                setFeature(f.id, { leverSize: [v, l[1], l[2]] });
                              }}
                            />
                            <NumberField
                              label="Lever height"
                              value={(f.leverSize ?? DEFAULT_LEVER)[1]}
                              min={0.5}
                              onChange={(v) => {
                                const l = f.leverSize ?? DEFAULT_LEVER;
                                setFeature(f.id, { leverSize: [l[0], v, l[2]] });
                              }}
                            />
                          </div>
                        )}
                        {usesActuator(f) && (
                          <p className="help">
                            {f.kind === 'button'
                              ? 'A collar on the inside keeps the plunger from falling out. Fit it into its hole from inside before the board and lid go in.'
                              : 'Push the cap onto the lever through the slot after the board is in. Measure the lever: these are typical values.'}
                          </p>
                        )}
                      </div>
                    )}
                    {f.note && <p className="help">{f.note}</p>}
                    <button
                      className="link-btn danger"
                      onClick={() => onDevice({ ...device, features: device.features.filter((x) => x.id !== f.id) })}
                    >
                      Remove part
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <button className="ghost-btn" onClick={addFeature}>
          + Add opening
        </button>
      </details>

      <details open={device.mountingHoles.length > 0}>
        <summary>
          Mounting holes <span className="count">{device.mountingHoles.length}</span>
        </summary>
        {device.mountingHoles.length === 0 && (
          <p className="help">No mounting holes. The case gets support ledges under the short edges; the lid lip holds the board down.</p>
        )}
        {device.mountingHoles.map((h, i) => (
          <div className="hole-row" key={i}>
            <NumberField
              label={`#${i + 1} X`}
              value={h.x}
              onChange={(v) =>
                onDevice({ ...device, mountingHoles: device.mountingHoles.map((m, j) => (j === i ? { ...m, x: v } : m)) })
              }
            />
            <NumberField
              label="Y"
              value={h.y}
              onChange={(v) =>
                onDevice({ ...device, mountingHoles: device.mountingHoles.map((m, j) => (j === i ? { ...m, y: v } : m)) })
              }
            />
            <NumberField
              label="Ø"
              value={h.diameter}
              min={0.5}
              onChange={(v) =>
                onDevice({ ...device, mountingHoles: device.mountingHoles.map((m, j) => (j === i ? { ...m, diameter: v } : m)) })
              }
            />
            <button
              className="icon-btn"
              aria-label="Remove hole"
              onClick={() => onDevice({ ...device, mountingHoles: device.mountingHoles.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="ghost-btn"
          onClick={() =>
            onDevice({ ...device, mountingHoles: [...device.mountingHoles, { x: 3, y: 3, diameter: 2.5 }] })
          }
        >
          + Add hole
        </button>
      </details>

      <details open>
        <summary>Case settings</summary>
        <div className="grid2">
          <NumberField label="Wall" value={settings.wall} min={0.8} onChange={set('wall')} />
          <NumberField label="Floor" value={settings.floor} min={0.8} onChange={set('floor')} />
          <NumberField label="PCB clearance" value={settings.clearance} min={0} onChange={set('clearance')} />
          <NumberField label="Headroom" value={settings.topClearance} min={0} onChange={set('topClearance')} hint="Gap above the tallest part" />
          <NumberField label="Standoff height" value={settings.standoff} min={0} onChange={set('standoff')} hint="Raised automatically to clear parts under the PCB" />
          <NumberField label="Screw pilot Ø" value={settings.screwHole} min={0.5} onChange={set('screwHole')} hint="2.5 for M3 self-tapping, 1.8 for M2" />
          <NumberField label="Lid thickness" value={settings.lidThickness} min={0.8} onChange={set('lidThickness')} />
          <NumberField label="Lid lip height" value={settings.lipHeight} min={0} onChange={set('lipHeight')} />
          <NumberField label="Lip wall" value={settings.lipWall} min={0.6} onChange={set('lipWall')} />
          <NumberField label="Fit tolerance" value={settings.tolerance} min={0} step={0.05} onChange={set('tolerance')} />
          <NumberField label="Corner radius" value={settings.cornerRadius} min={0} onChange={set('cornerRadius')} />
          <NumberField label="Cut-out margin" value={settings.cutoutMargin} min={0} onChange={set('cutoutMargin')} />
          <NumberField label="Lid vent slots" value={settings.ventSlots} min={0} max={30} step={1} unit="" onChange={(v) => set('ventSlots')(Math.round(v))} />
        </div>
      </details>
    </div>
  );
}
