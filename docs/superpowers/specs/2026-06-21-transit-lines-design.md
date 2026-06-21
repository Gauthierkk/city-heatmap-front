# Transit lines — authentic per-line bullets

**Date:** 2026-06-21
**Repos:** `city-heatmap-data` (worker) + `city-heatmap-front` (app)
**Status:** approved design

## Goal

On the Transit category, show the **actual transit lines** each station serves,
using the **official IDFM/RATP line pictograms** (colour + symbol). At **major
stations**, show only the **RER and Metro** lines — drop the mainline Transilien
(`TRAIN`) lines.

## Data source

IDF Mobilités `emplacement-des-gares-idf` (already the transit provider's source).
Per station×line row it carries:

- `indice_lig` — line designation (`1`, `14`, `A`, `D`, `T3a`)
- `mode` — `METRO` | `RER` | `TRAIN` | `TRAMWAY`/`TRAM` | `VAL`
- `picto` — official SVG pictogram (`{ filename: "METRO_1.svg", url: <files API> }`)

Confirmed example — Gare de Lyon rows: `METRO 1`, `METRO 14`, `RER A`, `RER D`,
`TRAIN R`. Under the major-station rule it keeps M1/M14/RER A/RER D and drops the
Transilien R.

## Data side (`city-heatmap-data`)

`fetcher/providers/transit.py`:

1. Widen `_SELECT` to add `indice_lig`, `picto` (keep `mode`, `geo_point_2d`,
   `id_ref_zdc`, `nom_zdc`, `id_gares`).
2. While collapsing station×line rows into one station (unchanged grouping by
   name+proximity), accumulate a **deduped set of lines** keyed by `(mode, indice_lig)`,
   each carrying `{ mode, line: indice_lig, picto: <picto filename> }`.
3. **Major-station rule:** reuse the existing `_MAJOR_STATIONS` detection. When a
   station is major, filter its `lines` to `mode in {metro, rer}` (drops `TRAIN`).
   Non-major stations keep every line.
4. Order lines: `metro` → `rer` → `tram` → `train` → `val`, then by designation
   (numeric for metro, then `Nbis`; alpha otherwise).
5. Emit `properties.lines = [{ mode, line, picto }]` **in addition to** the
   existing `categories`/`major`/`id`/`name` (all unchanged — `lines` is additive,
   so dot colour, the mode filter and counts are untouched).

The mode→category mapping and `_categories(...)` stay as-is. Regenerate
`transit.geojson` (`fetch-transit paris`) and copy into the front repo by hand
(`data/places/paris/transit.geojson`), per the cross-repo rule.

`_COORD_DP`, clip, guards, drop-guard — unchanged.

## Assets (`city-heatmap-front`)

Download the **unique** picto SVGs referenced by the clipped Paris stations into
committed `public/lines/<filename>.svg` (Vite serves `public/` at the app root,
so they resolve at `${BASE_URL}lines/<filename>`). ~25–30 files (M1–14, 3bis,
7bis, RER A–E, the odd boundary tram). A small build step / one-off script
fetches them from the dataset's `picto.url`; only the committed SVGs ship.

## Frontend (`city-heatmap-front`)

- `types.ts`: `StoreProperties.lines?: { mode: string; line: string; picto: string }[]`.
- `lib/geojson.ts`: a `parseLines(value)` twin of `parseCategories` (MapLibre
  stringifies the array on map clicks). `withShopTags` already spreads
  properties, so `lines` passes through untouched.
- A reusable line-bullet renderer in two forms (same markup, same `${BASE_URL}lines/${picto}`
  src, ~18px square, `alt`/`title` = e.g. "Metro 1"):
  - `lineBulletsHtml(lines)` — HTML string for the MapView popup.
  - `<LineBullets lines={…} />` — React, for `ResultsPanel`.
- **Popup** (`MapView.tsx`): for a transit station (has `lines`), the bullet row
  **replaces** the mode badges. Title stays the station name. Non-transit popups
  unchanged.
- **Results list** (`ResultsPanel.tsx`): transit rows render the bullet row
  (replacing/with the single mode badge).

## Out of scope / unchanged

- Filtering stays by **mode** (metro/rer/tram/train/val) — not per line.
- Map **dots** stay coloured by primary mode.
- Only transit features carry `lines`; grocery/specialty/fitness/pharmacy/trees
  are untouched.

## Verification

- Worker: regenerate, assert every station has ≥1 line, assert no major station
  has a `train` line, spot-check Gare de Lyon = {M1, M14, RER A, RER D}.
- Front: `tsc --noEmit && vite build`; `public/lines/*.svg` present in `dist`;
  preview serves a sample picto (200) and `transit.geojson` carries `lines`.
- Visual: dev server — open a transit station popup and the closest-stations list.

## Implementation order

1. Worker: `transit.py` lines aggregation + major-station filter.
2. Regenerate `transit.geojson`; download unique pictos → `public/lines/`.
3. Copy `transit.geojson` into front; commit SVGs.
4. Front: types + `parseLines` + bullet renderer + popup + results list.
5. Verify (build + dev-server visual), commit, push (stacked on `feat/paris-pharmacies`).
