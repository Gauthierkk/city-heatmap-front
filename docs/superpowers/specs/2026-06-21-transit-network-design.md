# Transit network — white dots, heatmap toggle, coloured line geometry

**Date:** 2026-06-21
**Repos:** `city-heatmap-data` + `city-heatmap-front`
**Status:** approved design (stacks on `feat/transit-lines`)

## Goals

1. **White transit dots** — transit station dots render white (other categories unchanged).
2. **Heatmap toggle** — a "Show distance heatmap" checkbox (all places categories, default ON) that hides/shows the distance-field overlay.
3. **Line geometry** — draw the real rail-line geometry through the dots, each
   coloured by its official line colour. Metro + RER + Tram only (no mainline trains).

## Data side (`city-heatmap-data`)

New Paris-only step `fetch-transit-lines` → `data/places/paris/transit-lines.geojson`.

- Source: IDFM `traces-du-reseau-ferre-idf` (`exports/geojson`) — one LineString
  per line segment, carrying `mode`, `indice_lig`, and `colourweb_hexa` (the
  official line colour).
- Keep modes `METRO`/`RER`/`TRAMWAY` (drop `TRAIN`/`VAL`).
- Keep a feature only if it has a vertex inside the Paris bbox (lines extending
  past Paris are clipped by the map's `maxBounds` at view time — no geometric
  polygon clip, which doesn't apply to LineStrings).
- Output feature: the LineString/MultiLineString geometry (coords rounded) +
  `properties = { mode, line: indice_lig, color: "#"+colourweb_hexa }`.
- Light guard (≥ ~30 segments). New `provider transit_lines.py`, CLI command,
  Makefile target + `load paris` block, README. No boundary clip (point-only).

## Frontend (`city-heatmap-front`)

- `cities.ts`: `CityDef.transitLinesFile?: string` (Paris only).
- `App.tsx`: lazy-load `transit-lines.geojson` into `transitLinesByCity` when the
  Transit category is active (fail-soft to null, like the boundary). Pass
  `transitLines` (FeatureCollection | null) to MapView. Add `showHeatmap` state
  (default true) + a checkbox in the heatmap-settings panel; hide the ramp
  sliders when off. Pass `showHeatmap` to MapView.
- `i18n.ts`: `showHeatmap` key (en/fr).
- `MapView.tsx`:
  - **White dots:** `store-points` `circle-color` = `['case', ['has','lines'], '#ffffff', <shop match>]`;
    `circle-stroke-color` = `['case', ['has','lines'], '#1a1a2e', '#ffffff']`. Data-driven
    (transit features are the only ones with a `lines` prop), set once, survives setStyle.
  - **Line layer:** a `transit-lines` geojson source + a `line` layer with
    `line-color: ['get','color']`, zoom-interpolated width, inserted below the
    first symbol layer (under labels) and above the distance-field/heatmap so the
    coloured lines read over the overlay; below the white dots. A data effect
    pushes `transitLines ?? EMPTY_FC` (keyed on styleEpoch). Empty when not transit.
  - **Heatmap toggle:** the existing density-visibility effect already controls
    `distance-field-layer` visibility — extend its condition to `!isDensity && showHeatmap`.

## Out of scope / unchanged

- Filtering, dots-by-mode dataset, popups/line bullets — unchanged.
- Lines are display-only; not clickable, not filtered.

## Verification

- Worker: regenerate, assert only metro/rer/tram modes, every feature has a
  `#hex` colour and ≥1 Paris-bbox vertex; spot-check metro 6 colour `#6eca97`.
- Front: `tsc && vite build`; transit-lines.geojson serves; toggling heatmap hides
  the raster; transit dots white; coloured lines render. Dev-server visual.

## Implementation order

1. Worker: `transit_lines.py` + CLI + Make + README; regenerate; copy to front.
2. Front: cities field + App lazy-load + heatmap state/checkbox + i18n.
3. Front: MapView white dots + line layer + heatmap-visibility.
4. Verify (build + dev server), commit, push (stacked on `feat/transit-lines`).
