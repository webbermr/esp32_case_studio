import { useEffect, useState } from 'react';

interface Props {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  hint?: string;
}

/** Number input that lets you type freely and only commits valid numbers. */
export function NumberField({ label, value, onChange, step = 0.1, min, max, unit = 'mm', hint }: Props) {
  const [text, setText] = useState(String(round(value)));
  useEffect(() => setText(String(round(value))), [value]);

  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (Number.isNaN(n)) return;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <label className="num-field" title={hint}>
      <span className="num-label">{label}</span>
      <span className="num-input">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => setText(String(round(value)))}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;
