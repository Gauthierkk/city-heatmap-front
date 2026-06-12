# Grocery Heatmap

React + MapLibre web app showing three switchable business categories —
**Grocery**, **Specialty food**, and **Fitness** — across Paris, New York City,
and Austin TX, with an always-on distance-to-nearest-store overlay and
per-address closest places. One category is active at a time; the heatmap,
dots, filters, and closest-place results all operate on it. Fully localised in
English and French (see i18n below). Spec: [docs/PRD.md](docs/PRD.md);
resolved open questions: [docs/DECISIONS.md](docs/DECISIONS.md).

## Commands

- `npm run dev` — Vite dev server (http://localhost:5173)
- `npm run build` — type-check (`tsc --noEmit`) + production build
- `npm run fetch-stores [-- <city> [<dataset>]]` — refresh store data from
  Overpass (defaults `paris food`; e.g. `npm run fetch-stores -- nyc fitness`).
  Datasets: `food` writes `public/data/stores-<city>.geojson` (guard: 100
  features); `fitness` writes `public/data/fitness-<city>.geojson` (guard: 50
  features). Intended to run weekly; commit the result.
- `npm run fetch-boundary [-- <city>]` — refresh
  `public/data/boundary-<city>.geojson` (city admin boundary; Paris relation
  71525, NYC relation 175905 with per-borough fallback, Austin relation
  113314; rarely changes)

Valid `<city>` ids: `paris`, `nyc`, `austin`. Both fetch scripts write compact
GeoJSON with no `generated` timestamp (so weekly re-runs don't churn the
committed files); `fetch-stores.mjs` refuses to overwrite if Overpass returns
fewer features than the per-dataset guard (100 for food, 50 for fitness).

## Architecture

- Single map renderer: MapLibre GL JS with OpenFreeMap vector basemaps — no
  Leaflet (decision #1). Two themes: Fiord (dark navy, `dark`) and Liberty
  (light, `light`), URLs in `BASEMAP_URLS` in `MapView.tsx`. Theme state lives
  in `App.tsx` like `lang`: seeded once from `prefers-color-scheme` (not
  live-tracked), never persisted, toggled via a sun/moon button in the panel
  title, passed to MapView as a prop. Switching calls `map.setStyle()`, which
  wipes custom sources/layers — `addCustomLayers()` re-adds them on each
  `style.load`, re-resolving the first symbol layer per style (Fiord
  `water_name`, Liberty `road_one_way_arrow`) so the overlay stays below
  labels; a `styleEpoch` counter re-runs the data effects to re-push stores /
  overlay PNG / boundary / opacity. Camera constraints, popups, and the
  layer-delegated click handlers survive setStyle. The boundary line is
  theme-keyed (`BOUNDARY_LINE`): `#8888bb`/0.7 on dark, `#1a1a2e`/0.5 on light.
- Multi-city (decision #6): all per-city facts live in `CITIES` in
  `src/cities.ts` — id, label, bbox, OSM relation / wikidata ids, Nominatim
  `countrycodes`, and a `storesFiles: Record<DataSourceId, string>` map keying
  `'food'` and `'fitness'` paths. The city is switched via the panel title: the
  city-name portion of the title is a `<select>` (built from the config) styled
  as heading text with a small chevron; default is Paris. City-switching clears
  the entered address/results, refits the camera, and recomputes the overlay.
  Store + boundary data are fetched lazily per source file and cached in
  `App.tsx` state for the session.
- Category registry (`src/storeTypes.ts`): `CategoryId = 'grocery' | 'specialty'
  | 'fitness'`; `CATEGORIES: CategoryDef[]` (`{ id, label, source: DataSourceId
  }`). `typesForCategory(id)` and `tagsForCategory(id)` return **precomputed,
  referentially stable** arrays — FilterBar receives them as props and stays
  memo'd. Grocery = 5 food types (supermarket, convenience, greengrocer,
  organic, frozen_food); Specialty = the other 13 food types (incl. bakery);
  Fitness = 6 new types (gym, yoga, pilates, martial_arts, dance, climbing).
  `categoryById(id)` mirrors `cityById` with a fallback to the default.
- Map navigation is clipped per city: on select, `MapView` contain-fits the
  city bbox, sets `minZoom` to the fitted zoom (minus a small epsilon), and
  sets `maxBounds` to the fitted viewport (`map.getBounds()`) — at max
  zoom-out the view is exactly the whole city and panning is clamped on both
  axes; zoomed in, panning stays within that min-zoom view. The framing
  depends on viewport aspect, so it is re-applied on map `resize` (debounced
  150 ms). Constraints are lifted momentarily before each re-fit so the new
  framing doesn't fight the old clip.
- Store data is pre-baked GeoJSON fetched at runtime from the app's own origin
  (decision #2). Two source files per city: `public/data/stores-<city>.geojson`
  (food — serves both Grocery and Specialty, split client-side by tag set) and
  `public/data/fitness-<city>.geojson` (fitness — lazy-loaded on first selection
  per city). The `App.tsx` cache (`storesBySource`) is keyed by source file
  path so Grocery↔Specialty share the warm food file without re-fetching. The
  fetch + session cache lives in two self-contained effects in `App.tsx`; this
  data-loading boundary is slated to move into a dedicated worker later, so
  keep it isolated. `scripts/fetch-stores.mjs` queries Overpass by the city's
  wikidata area id (Paris Q90, NYC Q60, Austin Q16559).
- OSM tag quirks handled in the fetch script: fishmongers are `shop=seafood`,
  organic stores are any shop with `organic=only`; both are normalised to the
  PRD's category names (`fishmonger`, `organic`) so the app only sees the 18
  canonical food types in `src/storeTypes.ts`. The list was expanded from 12
  (it had been NYC-shaped) to 18 from Overpass counts across all three cities,
  adding `pastry`, `wine`, `chocolate`, `confectionery`, `tea`, `coffee` —
  each with ≥30 stores in at least one city (Paris drove pâtisserie /
  chocolatier / cave à vins). `SHOP_TYPES` in `fetch-stores.mjs` must stay in
  sync with the food tags in `src/storeTypes.ts`; the fitness sport list and
  `normaliseFitness` in `fetch-stores.mjs` must stay in sync with the fitness
  tags in `src/storeTypes.ts`.
- Always-on distance-to-nearest-store overlay (decision #3, updated
  2026-06-12): a grid over the city bbox is coloured by proximity — red
  at/below a min distance → orange → yellow → green → cyan → blue at/beyond a
  max distance. Both bounds are user-configurable from the "Heatmap settings"
  panel (defaults 50 m / 500 m, `HEAT_MIN_M` / `HEAT_CUTOFF_M` in
  `src/types.ts`). Cell size is adaptive (decision #6): the smallest multiple
  of 25 m that keeps the grid under ~200k cells — Paris 50 m, NYC 125 m,
  Austin 100 m. Rendered synchronously in `src/lib/distanceField.ts` using a
  coarse 500 m spatial bucket grid with ring-by-ring nearest-neighbour search;
  result is a PNG data-URL fed into a MapLibre `image` / `raster` layer.
  Recomputes when the city or active type filters change; ramp-slider drags
  are debounced 250 ms. Two hot-path optimisations: (1) the ring search is
  seeded with `HEAT_RAMP_MAX_M`² (the slider ceiling), so cells whose nearest
  store is beyond the ramp — blue regardless — bail after ~2 rings instead of
  scanning the whole grid (big win for the water/exurb-heavy NYC and Austin
  bboxes); (2) the per-cell nearest-store distances depend only on the store
  set + bbox, so they're cached (`gridCache`, keyed by the filtered
  FeatureCollection's reference) — moving a ramp slider only re-runs a cheap
  colorize (via a precomputed colour LUT) + clip + encode, never the search.
  Ramp endpoint colours tuned for Fiord dark basemap: blue end is `[60, 100, 255]`
  (brightened from `[20, 60, 220]` to distinguish from navy background); cyan
  lightened to `[40, 220, 210]`. Default raster opacity is 0.65 (was 0.7).
- The overlay is clipped to the city's administrative boundary
  (`public/data/boundary-<city>.geojson`, from `scripts/fetch-boundary.mjs`)
  via a `destination-in` composite fill on the same canvas; a thin
  `boundary-line` layer outlines the clip edge. If the boundary file is
  missing the overlay renders unclipped (fail soft).
- Type filters work by calling `setData` with a filtered FeatureCollection;
  the distance-field overlay recomputes on the same change.
- Individual store dots (no clustering) are shown via a `circle` layer whose
  radius interpolates with zoom (11 → 2 px, 14 → 5 px, 16 → 7 px), with a
  white stroke of width 2 (increased from 1.5 for contrast on the dark basemap).
  The user-location marker is orange `#e06020` (was dark navy `#1a1a2e` which
  was invisible on Fiord).
- State lives in `App.tsx`; `MapView` is the only component that touches the
  MapLibre instance (via refs + effects).
- i18n: hand-rolled, no dependency (`src/i18n.ts`). Two locales (`en`/`fr`);
  `t(lang, key, params?)` does `{slot}` interpolation. `titleSegments(lang)`
  returns a `TitleSegment[]` (text / city-slot / category-slot) that `App.tsx`
  renders as a mix of text and two inline `<select>` elements — EN pattern
  `'{city} {category} Heatmap'`, FR pattern `'{category} à {city}'`. `lang` is
  App state, defaults from `navigator.language` (`detectLang`), is **never
  persisted** (consistent with the no-storage stance), and is passed down as a
  prop; an effect mirrors it to `document.documentElement.lang`. Store-type
  labels are per-language in `STORE_TYPES` (`typeLabel(tag, lang)`);
  `formatDistance(m, lang)` uses the locale's decimal separator. The theme
  toggle's aria-label/title uses the `darkMode` / `lightMode` strings (names
  the target mode, like `switchLang`). MapView popups
  read `lang` via a ref so the once-bound click handler stays current. The panel
  children (`AddressSearch`, `FilterBar`, `ResultsPanel`) are `React.memo`'d
  with stable callbacks so ramp-slider drags don't re-render them.
- Category switching (`switchCategory` in `App.tsx`): keeps the entered
  address and marker (closest-place results re-rank automatically against the
  new category), resets `activeTags` to the new category's full tag set, and
  clears `focusedStoreId` / `loadError`. A `categoryTotal` memo counts features
  whose `shop` tag belongs to the active category's tag set, so the hint line
  shows the correct count (not the full food-file count) under Grocery or
  Specialty.

## Gotchas

- MapLibre mutates the style object passed to `new Map()`. The app now passes
  the OpenFreeMap Fiord URL string instead of an inline object, which avoids
  this gotcha. If you ever switch back to an inline style object, build it
  fresh per instance or the second StrictMode mount gets a corrupted style.
- MapLibre cannot finish loading while the page is hidden/occluded (Chrome
  suspends rAF). A blank map in automated browser tests usually means
  `document.visibilityState === 'hidden'`, not an app bug.
- Nominatim policy: ≥1s between requests, no per-keystroke autocomplete.
  `AddressSearch` debounces 800 ms with a 3-char minimum — keep it that way,
  and revisit before any public deployment.
- In dev, the map instance is exposed as `window.__map` for debugging.
- No address persistence anywhere (PRD §5) — do not add localStorage/server
  storage of the user's address.
- The NYC OSM admin polygon extends into harbour/bay water (~1,223 km² vs
  ~784 km² of land) — area sanity checks in `fetch-boundary.mjs` are
  per-city for this reason.
- Fitness features deliberately reuse the `shop` property key (e.g.
  `shop: 'yoga'`, `shop: 'gym'`). This is intentional: `StoreProperties`,
  MapView's `['get', 'shop']` expressions, and `distanceField.ts` stay
  completely untouched. Do not rename the property to `leisure` or `sport` — it
  would require edits across multiple files for no functional gain.
