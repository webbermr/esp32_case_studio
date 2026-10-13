import { useMemo, useRef, useState } from 'react';
import { searchDevices } from '../lib/search';
import type { Device } from '../types';

interface Props {
  devices: Device[];
  selectedId: string;
  onSelect: (d: Device) => void;
  onCustom: () => void;
}

export function SearchBox({ devices, selectedId, onSelect, onCustom }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchDevices(devices, query), [devices, query]);

  const choose = (d: Device) => {
    onSelect(d);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="search">
      <input
        ref={inputRef}
        type="search"
        placeholder="Search boards — e.g. esp32 s3, lora, heltec, sx1262"
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && results[active]) {
            choose(results[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        aria-label="Search devices"
      />
      {open && (
        <ul className="results" role="listbox">
          {results.map((d, i) => (
            <li
              key={d.id}
              role="option"
              aria-selected={d.id === selectedId}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(d);
              }}
            >
              <span className="r-name">{d.name}</span>
              <span className="r-meta">
                {d.manufacturer} · {d.board.length} × {d.board.width} mm
              </span>
              <span className={`chip chip-${d.category.toLowerCase()}`}>{d.category}</span>
            </li>
          ))}
          {results.length === 0 && <li className="empty">No match in the library.</li>}
          <li
            className="custom"
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen(false);
              onCustom();
            }}
          >
            + Start a custom board from scratch
          </li>
        </ul>
      )}
    </div>
  );
}
