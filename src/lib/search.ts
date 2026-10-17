import type { Device } from '../types';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Small ranked search: every query word has to appear somewhere in the
 * device's searchable text. Matches in the name rank above matches in tags.
 */
export function searchDevices(devices: Device[], query: string): Device[] {
  const q = norm(query);
  if (!q) return devices;
  const words = q.split(' ');

  const scored = devices
    .map((d) => {
      const name = norm(`${d.manufacturer} ${d.name}`);
      const aliases = norm(d.aliases.join(' '));
      const rest = norm(`${d.category} ${d.tags.join(' ')} ${Object.values(d.specs).join(' ')}`);
      const all = `${name} ${aliases} ${rest}`;
      const allCompact = compact(all);
      let score = 0;
      for (const w of words) {
        if (name.includes(w)) score += 10;
        else if (aliases.includes(w)) score += 7;
        else if (rest.includes(w)) score += 3;
        else if (allCompact.includes(w)) score += 2;
        else return { d, score: -1 };
      }
      if (compact(d.name) === compact(query)) score += 50;
      return { d, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((r) => r.d);
}
