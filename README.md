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

`dist/` is a plain static site, so it can go on GitHub Pages, Netlify, an S3 bucket or anywhere else that serves files.

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
