# Case Studio

A browser app for designing 3D-printable enclosures for dev boards. Search for a board (ESP32, LoRa, RP2040 and so on), check its dimensions and where the USB port, buttons and antenna sit, and download a printable case.

- **Left panel:** board specs, source links, editable PCB dimensions, a list of ports, buttons and parts (each one can get a cut-out), mounting holes, and case settings.
- **Right panel:** a live 3D view you can rotate, pan and zoom. It shows the board, base and lid, with exploded, X-ray and dimension overlays.
- **Downloads:** a print-ready STL plate (base plus a flipped lid), each part on its own, and the full spec as JSON so you can reload or share a design.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # geometry tests (checks every library board produces watertight meshes)
npm run build      # static site in dist/
```

`dist/` is a plain static site, so it can go on GitHub Pages, Netlify, an S3 bucket or anywhere else that serves files. Online lookup won't work there (see below).

## Looking up boards online

If a board isn't in the library, type its name and choose **Look up "…" online**, or just press Enter. The local server asks Claude to find the manufacturer's datasheet or mechanical drawing on the web. It then turns what it finds into a board spec that loads straight into the editor, with source links.

Setup:

```bash
cp .env.example .env     # then put your key in it
# ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

Things to know:

- **Where it runs:** only on the local server (`npm run dev` or `npm run preview`). The key stays in `.env` on your machine and never reaches the browser. On a static deploy the option doesn't appear.
- **Time and cost:** a lookup takes about 1–3 minutes and costs real API money, since it runs web searches plus two model calls.
- **Caching:** results go in `lookups/boards.json` (git-ignored). Repeat searches are instant and free, and looked-up boards show up in search next time. Delete an entry from that file to re-research it.
- **CAD files first:** the research looks for the manufacturer's STEP model or Eagle/KiCad board, including in GitHub repos, Git LFS and zip archives. When it finds one, the server downloads it and measures it with the same code as the browser import, so **positions come from the file, not from Claude**. Claude only names the parts ("RESET button (K4)") and says whether the file shows the board from the back. A copy of the file is kept in `lookups/cad/` so you can open the real 3D model with **Load 3D model**.
- **Without a CAD file:** positions come from datasheets and drawings. Those boards carry an "AI-researched" warning; check them against the linked sources, the fit-check plate or a photo before printing.

The code is in `server/lookup.ts` (prompts, schemas, API calls), `server/cadFetch.ts` (downloading CAD files) and `server/plugin.ts` (the `/api/*` endpoints and cache).

## Importing the manufacturer's CAD files (most accurate)

Most manufacturers publish a 3D model (STEP) or the PCB design (Eagle `.brd`, KiCad `.kicad_pcb`), often in the board's GitHub repo. These hold the exact position of every part, so importing one is the most reliable way to get buttons and ports in the right place.

- **New board from a file:** open the search box and choose **Import the maker's CAD file**.
- **Fix an existing board:** use **Fix positions → Positions from CAD file**. It takes the positions from the file but keeps the board's name, specs, your part labels and any parts the file doesn't contain (such as a display). The import is flipped or rotated automatically to match the existing layout, because PCB files are drawn from the component side.

What each format gives you:

| | STEP model | Eagle / KiCad |
| --- | --- | --- |
| Outline, mounting holes | ✓ (round holes found in the PCB) | ✓ |
| Part positions | ✓ exact | ✓ exact, plus designators (K3, SW1...) |
| Part sizes and heights | ✓ from the 3D model | footprint size; heights are typical values |
| Slide-switch lever size | ✓ measured | typical values |
| Real 3D model in the viewer | ✓ | — |

STEP files are read in the browser by [occt-import-js](https://github.com/kovacsv/occt-import-js), which is OpenCascade compiled to WebAssembly and licensed LGPL-2.1. Large models take up to a minute. Parts are recognised from their names (USB-C, SW-…, KEY-…, TF-…, LED…). Unrecognised parts only count toward clearance heights. Rename anything in the parts list, and check which side is the front.

## Fixing part positions

Looked-up boards (and estimated library entries) can have parts in the wrong place. Mirrored layouts are the most common problem, especially on display modules, where nearly everything sits on the back. The **Fix positions** section in the left panel has three tools:

- **Mirror / rotate / turn over:** fixes a whole layout that is flipped or rotated, in one click.
- **Board photo:** load a photo cropped to the board's outline. It's laid onto the PCB in the 3D view, either the front (seen from above) or the back (seen from below, with the photo's top edge toward the board's front edge).
- **Place:** click **Place** next to a part or mounting hole, then click where it is on the board. The camera switches to the right face automatically. Edge parts only move along their edge.

**Top / Bottom / 3D** in the viewer's top-right corner switch camera views at any time.

### Saving your corrections

Change anything (a part position, a size, a case setting) and **Save changes** appears under the board name. Saved boards replace the original in search, so the next time you pick that board you get your version along with its case settings.

- **Where saves go:** with the local server running they go to `lookups/saved.json`, which is git-ignored and shared by every browser on your machine. A copy is also kept in the browser, so a static deploy still remembers them.
- **Going back:** **Restore original** brings back the library or lookup version.
- **Custom boards:** saving one gives it its own entry, and you can rename it.

## Printed buttons and switches

Every button and slide switch with a cut-out gets a small printed part by default. You can turn this off per part in the left panel.

- **Button plunger:** a pin that runs through the lid (or wall) and presses the board's button. A chamfered collar on the inside stops it falling out, and leaves about 0.5 mm of travel. The case automatically gets taller (top buttons) or wider (side buttons) to fit the collar.
- **Slide-switch cap:** pushes onto the switch lever and sticks out through a slot as long as the switch's travel. The lever size and travel are typical values (1.5 mm lever, 2 mm travel), so measure yours and adjust them.

The parts are included in **Download STL**, or you can download them alone with **Buttons**. They're oriented to print without supports, outer end down.

Tips: print the plungers in PETG or PLA at 0.12–0.16 mm layers. The hole leaves 0.3 mm of clearance all round; if a plunger still binds, sand it lightly. If the switch cap is loose on the lever, lower **Lever width/height** by 0.1 mm.

## Fit-check plate

Before printing a whole case, click **Fit check** in the toolbar to download a 1.2 mm plate the size of the PCB. It has the mounting holes, a hole over every button, switch, port and LED, and notches where the edge connectors are. It prints in a few minutes. Lay it on your board: if every part shows through its hole, the case will fit. To check parts on the back, flip the plate over.

The chamfered corner is the board's front-left corner, seen from the top. Turn on the **Fit check** toggle to see the plate above the board in the 3D view.

## Wall mounts and stands

Under **Wall mount & stand** in the left panel:

- **Keyhole slots:** two slots in the back (one on narrow cases) for pan-head screws, up to a 4 mm shank and 8 mm head. Bosses inside the back capture the screw head, so the board is lifted 4.2 mm to clear them.
- **Screw tabs:** flanges on the top and bottom edges with countersunk holes for 4 mm screws.
- **Tilt feet:** two wedges that peg into holes in the back and tilt a case lying on a desk.
- **Desk cradle:** the case stands on its bottom edge, leaning back. This covers any ports on that edge.
- **Kickstand:** a leg that pushes into a socket in the back.

**Top edge when hung / standing** sets which edge points up. The tilt or lean angle is adjustable from 5° to 45°. Stand parts show in teal, are included in **Download STL**, and can be downloaded on their own with **Stand**.

## How it works

| Piece | File |
| --- | --- |
| Board library (dimensions, parts, sources) | `src/data/devices.ts` |
| Search ranking | `src/lib/search.ts` |
| Case generator (CSG with [manifold-3d](https://github.com/elalish/manifold)) | `src/lib/caseGeometry.ts` |
| Simplified board model for the viewer | `src/lib/boardModel.ts` |
| STL export | `src/lib/exportStl.ts` |
| 3D viewer (three.js) | `src/components/Viewer.tsx` |
| Left-hand panel | `src/components/SpecPanel.tsx` |
| Online lookup (Claude + web search) | `server/lookup.ts`, `server/plugin.ts` |

The case is built with manifold-3d, the same CSG kernel OpenSCAD uses. Its output is always a closed, manifold mesh, so slicers don't need to repair it. A test checks that.

### Coordinates

All units are millimetres. For a board viewed from above with the component side up:

- The origin is the PCB's bottom-left corner.
- X runs along the length, so the left edge is x = 0.
- Y runs along the width, so the front edge is y = 0.
- z = 0 is the PCB's top surface. Negative z is the underside.

Each part is described by its centre (`x`, `y`, `z`), its body `size` and the `side` of the case it's reached through. The cut-out is that body's profile seen from the side, plus the cut-out margin.

## Accuracy: measure before you print

Every library entry has a confidence level, and the app shows it:

- **datasheet:** the outline and holes come from a manufacturer drawing.
- **partial:** the outline comes from manufacturer docs. Connector and button positions are estimates.
- **estimated:** everything is an estimate.

Board revisions move connectors around, and clone boards rarely match the original. Before printing, check the PCB size and the USB position with calipers, and correct anything in the left panel. A quick test print of just the base at 0.3 mm layers costs little and catches mistakes.

## Adding a board

Add an entry to `DEVICES` in `src/data/devices.ts`. You can also design it in the app with **Search → Start a custom board**, then use **Save spec** and paste the `device` object into the file. Include source links for every number you take from a datasheet.

## Print tips

- PLA or PETG, 0.2 mm layers, 3 walls. No supports needed for side cut-outs up to roughly 10 mm tall.
- The lid prints upside down; the exported plate is already oriented that way.
- If the lid is too tight, raise **Fit tolerance** by 0.1 mm. If it's loose, lower it.
- Standoff pilot holes default to 2.5 mm, which suits M3 self-tapping screws. Use 1.8 mm for M2.
