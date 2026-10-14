import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import type { Device } from '../src/types';

/*
 * Board lookup: two Claude calls.
 *
 * 1. Research: Claude uses web search/fetch to find the manufacturer's
 *    datasheet / mechanical drawing and writes up notes with sources.
 * 2. Extraction: the notes are turned into a Device via structured outputs,
 *    so the result always matches the app's schema.
 *
 * Splitting them keeps the schema step cheap to retry and avoids mixing web
 * citations with JSON output.
 */

const MODEL = 'claude-opus-5-5';
// Refusal fallbacks: if a safety classifier declines, the API re-runs the
// request on Anthropic's recommended fallback model instead of failing.
const BETAS: Anthropic.Beta.AnthropicBeta[] = ['server-side-fallback-2026-07-01'];

export type LookupEvent =
  | { type: 'status'; message: string }
  | { type: 'search'; query: string }
  | { type: 'fetch'; url: string }
  | { type: 'done'; device: Device }
  | { type: 'error'; message: string };

const KINDS = [
  'usb-c', 'micro-usb', 'usb-a', 'button', 'switch', 'led', 'antenna', 'sma', 'ufl',
  'jst', 'display', 'sd', 'header', 'battery', 'barrel', 'module', 'other',
] as const;

export const BoardSchema = z.object({
  found: z.boolean().describe('false if no real board matching the query could be identified'),
  notFoundReason: z.string().describe('Why not found, or empty string'),
  name: z.string(),
  manufacturer: z.string(),
  category: z.enum(['ESP32', 'ESP8266', 'LoRa', 'RP2040', 'Arduino', 'nRF52', 'Other']),
  aliases: z.array(z.string()),
  tags: z.array(z.string()),
  specs: z.array(z.object({ label: z.string(), value: z.string() })),
  board: z.object({
    length: z.number(),
    width: z.number(),
    thickness: z.number(),
    heightAbove: z.number(),
    heightBelow: z.number(),
  }),
  mountingHoles: z.array(z.object({ x: z.number(), y: z.number(), diameter: z.number() })),
  features: z.array(
    z.object({
      label: z.string(),
      kind: z.enum(KINDS),
      side: z.enum(['left', 'right', 'front', 'back', 'top', 'bottom']),
      x: z.number(),
      y: z.number(),
      z: z.number(),
      sizeX: z.number(),
      sizeY: z.number(),
      sizeZ: z.number(),
      cutout: z.boolean(),
      shape: z.enum(['rect', 'circle']),
      dimensioned: z.boolean().describe('true only if the position comes straight from a manufacturer dimension'),
      note: z.string(),
      slideAxis: z.enum(['x', 'y', 'none']).describe('Face-mounted slide switches: axis the lever slides along; otherwise none'),
      leverWidth: z.number().describe('Slide switch lever width along the slide direction, 0 if unknown/not a switch'),
      leverHeight: z.number().describe('Slide switch lever size across the slide direction, 0 if unknown'),
      leverProtrusion: z.number().describe('How far the lever sticks out of the switch body, 0 if unknown'),
      switchTravel: z.number().describe('Lever travel end to end, 0 if unknown'),
      openingWidth: z.number().describe('Displays: visible window width (X for top/bottom) if smaller than the body, else 0'),
      openingHeight: z.number().describe('Displays: visible window height (Y for top/bottom), else 0'),
    }),
  ),
  sources: z.array(z.object({ label: z.string(), url: z.string() })),
  confidence: z.enum(['datasheet', 'partial', 'estimated']),
  notes: z.string(),
});

const RESEARCH_SYSTEM = `You research the mechanical specifications of electronics dev boards (ESP32, LoRa, RP2040, Arduino and similar) so someone can 3D-print an enclosure.

Find the manufacturer's own sources first: official product pages, datasheets, mechanical/dimension drawings (PDF, DXF), official GitHub hardware repos (they often hold STEP models and Eagle/KiCad board files whose part placements are exact), STEP model listings. Use reputable distributors or community measurements only to fill gaps, and say so.

Report, in millimetres (convert inches and say you did):
- PCB length × width, thickness; tallest part above and below the PCB (or overall height)
- Mounting holes: diameter and centre positions, and which corner/edge they are measured from
- Each connector, button, switch, LED, antenna/antenna connector, display and battery connector: type, which FACE of the PCB it is soldered to (front/top or back/underside), which edge it is nearest, its offset along that edge, and which way it is operated (from the edge, or straight out of the face). Slide switches: does the lever point out of the edge or out of the face?
- For every position, state the viewpoint it was read from: which face the drawing or photo shows, and which edge was at the top of the image. Back-side photos and drawings are mirrored relative to the front: never mix positions read from both without saying so.
- Display modules: the display is on the front; nearly everything else (buttons, switches, connectors) is usually on the back. Report the glass outline and the active area separately.
- Anything that overhangs the PCB outline (module antennas, connectors) and by how much
- Whether pin headers ship soldered

Be strict about provenance. For every number say whether it is dimensioned in a source, read off a drawing image, or estimated. Never invent a number or URL. If something isn't published, say "not found". If the query is ambiguous between board revisions, pick the most common current revision and name it.

Finish with a compact plain-text report and the list of source URLs you actually used.`;

const EXTRACT_SYSTEM = `You convert research notes about a dev board into a JSON board spec for an enclosure generator.

Coordinate system (all mm). Lay the board flat with its FRONT face up: the display side for boards with a display, otherwise the side with the main chips/module. Look down on it with the longer edge horizontal and keep the manufacturer's usual front-view orientation (the way the main product photo or drawing shows the front). Do NOT rotate the board to put the USB port somewhere specific.
- Origin = the PCB's bottom-left corner as seen from the front. +X along the length (left edge x=0, right edge x=length). +Y along the width (front edge y=0, back edge y=width). z=0 is the PCB TOP surface; negative z is the underside.
- Mounting holes: centre x, y in that frame. Re-express positions given from other corners.
- Converting positions read from the BACK: a back view is a mirror image of the front. If the back image was made by flipping the board left-to-right (vertical axis), use x = length − x_back, y = y_back. If it was flipped top-to-bottom (horizontal axis), use x = x_back, y = width − y_back. Say in the note which conversion you used. Parts on the back have negative z (centre = −thickness − sizeZ/2 for a part sitting on the back face).
- features: one per connector, button, switch, LED, antenna connector, display, battery connector, and any module that overhangs the PCB. x, y, z is the CENTRE of the part's body; sizeX/sizeY/sizeZ its body size. A part sitting on the top surface has z = sizeZ/2. Parts overhanging the edge extend past 0 or length/width.
- side = the case face you reach the part through: left/right (short edges), front/back (long edges), top (through the lid: the front face, e.g. displays and front buttons), bottom (through the floor: buttons and switches on the back that are pressed or slid from behind).
- Slide switches operated from a face (lever sticking out of the face): side "top" or "bottom". Put the lever size and travel in the note.
- cutout = true for ports, displays, user buttons and edge-mounted antenna connectors with a known position. Set cutout = false for internal parts (U.FL, modules, LEDs) and for any part whose position isn't documented.
- shape = "circle" for round buttons and SMA connectors, otherwise "rect".
- Displays: body = the glass outline; openingWidth/openingHeight = a window ~3 mm smaller than the glass on each side (or the active area plus 1 mm if larger), so the lid holds the panel in. 0 for other parts.
- Slide switches: fill slideAxis, lever size, protrusion and travel when known; 0 otherwise.
- When the body size isn't published, use typical values (USB-C 7.4×9.0×3.3 with ~1 mm overhang, Micro-USB 5.8×7.6×2.8, tactile button ~4×3×2) and say so in the note.
- dimensioned = true only when the position comes from a manufacturer dimension. Otherwise put "Estimated: ..." in the note.
- heightBelow: if male pin headers ship soldered pointing down, use 8.5.
- specs: short label/value pairs (MCU, radio, USB, buttons, antenna, battery, display...).
- sources: only URLs that appear in the notes.
- confidence: "datasheet" if outline and holes come from a manufacturer drawing, "partial" if the outline is from the manufacturer but parts are estimated, "estimated" otherwise.
- If the notes say no matching board was found, set found=false, explain why in notFoundReason, and fill the other fields with empty strings, zeros and empty arrays.`;

/** Turn SDK errors into messages a user can act on. */
export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Your API key was rejected. Check ANTHROPIC_API_KEY in .env and restart the server.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key does not have access to the model or web search. Check your Console settings.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a minute and try again.';
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check your internet connection.';
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ''}: ${e.message}`.trim();
  return e instanceof Error ? e.message : String(e);
}

export function lookupEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function lookupBoard(query: string, emit: (e: LookupEvent) => void, signal?: AbortSignal): Promise<Device> {
  const client = new Anthropic();

  // ---- 1. Research
  emit({ type: 'status', message: 'Searching manufacturer sources…' });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: `Research the mechanical specifications of this board: ${query}` },
  ];
  let notes = '';
  for (let round = 0; round < 8; round++) {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        betas: BETAS,
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        system: RESEARCH_SYSTEM,
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: 12 },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 12 },
        ],
        messages,
      },
      { signal },
    );
    stream.on('contentBlock', (block) => {
      if (block.type !== 'server_tool_use') return;
      const input = block.input as { query?: string; url?: string };
      if (block.name === 'web_search' && input.query) emit({ type: 'search', query: input.query });
      if (block.name === 'web_fetch' && input.url) emit({ type: 'fetch', url: input.url });
    });
    const response = await stream.finalMessage();

    if (response.stop_reason === 'refusal') {
      throw new Error('The research request was declined. Try a more specific board name.');
    }
    if (response.stop_reason === 'pause_turn') {
      // Server-side tool loop hit its iteration limit: send the turn back to resume.
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    notes = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    break;
  }
  if (!notes.trim()) throw new Error('Research did not produce any results. Try again or refine the board name.');

  // ---- 2. Extraction
  emit({ type: 'status', message: 'Building board model from the research…' });
  const parsed = await client.beta.messages.parse(
    {
      model: MODEL,
      max_tokens: 16000,
      betas: BETAS,
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(BoardSchema) },
      system: EXTRACT_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Board searched for: ${query}\n\n<research_notes>\n${notes}\n</research_notes>`,
        },
      ],
    },
    { signal },
  );
  if (parsed.stop_reason === 'refusal') throw new Error('The extraction request was declined.');
  if (parsed.stop_reason === 'max_tokens') throw new Error('The board description was too long to finish. Try again.');
  const out = parsed.parsed_output;
  if (!out) throw new Error('Could not turn the research into a board spec. Try again.');
  if (!out.found) throw new Error(out.notFoundReason || `No board matching "${query}" was found.`);

  return toDevice(query, out);
}

export function toDevice(query: string, b: z.infer<typeof BoardSchema>): Device {
  const pos = (n: number, fallback: number) => (Number.isFinite(n) && n > 0 ? n : fallback);
  const slug = `${b.manufacturer}-${b.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    id: `lookup-${slug}`,
    name: b.name,
    manufacturer: b.manufacturer,
    category: b.category,
    aliases: [...new Set([query, ...b.aliases])],
    tags: b.tags,
    specs: Object.fromEntries(b.specs.map((s) => [s.label, s.value])),
    board: {
      length: pos(b.board.length, 50),
      width: pos(b.board.width, 25),
      thickness: pos(b.board.thickness, 1.6),
      heightAbove: Math.max(0, b.board.heightAbove),
      heightBelow: Math.max(0, b.board.heightBelow),
    },
    mountingHoles: b.mountingHoles.filter((h) => h.diameter > 0),
    features: b.features.map((f, i) => ({
      id: `f${i}`,
      label: f.label,
      kind: f.kind,
      side: f.side,
      x: f.x,
      y: f.y,
      z: f.z,
      size: [pos(f.sizeX, 1), pos(f.sizeY, 1), pos(f.sizeZ, 1)],
      cutout: f.cutout,
      shape: f.shape,
      note: f.note || undefined,
      ...(f.kind === 'switch' && f.slideAxis !== 'none' && (f.side === 'top' || f.side === 'bottom')
        ? { slideAxis: f.slideAxis }
        : {}),
      ...(f.kind === 'switch' && f.leverWidth > 0 && f.leverHeight > 0 && f.leverProtrusion > 0
        ? { leverSize: [f.leverWidth, f.leverHeight, f.leverProtrusion] as [number, number, number] }
        : {}),
      ...(f.kind === 'switch' && f.switchTravel > 0 ? { switchTravel: f.switchTravel } : {}),
      ...(f.openingWidth > 0 && f.openingHeight > 0 ? { opening: [f.openingWidth, f.openingHeight] as [number, number] } : {}),
    })),
    sources: b.sources.filter((s) => /^https?:\/\//.test(s.url)),
    confidence: b.confidence,
    notes: b.notes,
    origin: 'lookup',
  };
}
