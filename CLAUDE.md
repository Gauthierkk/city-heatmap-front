# Grocery Heatmap

React + MapLibre web app showing grocery stores in Paris and New York City
with an always-on distance-to-nearest-store overlay and per-address closest
stores. Spec: [docs/PRD.md](docs/PRD.md); resolved open questions:
[docs/DECISIONS.md](docs/DECISIONS.md).

## Commands

- `npm run dev` — Vite dev server (http://localhost:5173)
- `npm run build` — type-check (`tsc --noEmit`) + production build
- `npm run fetch-stores [-- <city>]` — refresh
  `public/data/stores-<city>.geojson` from Overpass (default `paris`; e.g.
  `npm run fetch-stores -- nyc`). Intended to run weekly; commit the result.
- `npm run fetch-boundary [-- <city>]` — refresh
  `public/data/boundary-<city>.geojson` (city admin boundary; Paris relation
  71525, NYC relation 175905 with per-borough fallback; rarely changes)

## Architecture

- Single map renderer: MapLibre GL JS with raster OSM tiles — no Leaflet
  (decision #1).
- Multi-city (decision #6): all per-city facts live in `CITIES` in
  `src/cities.ts` — id, label, bbox, OSM relation / wikidata ids, Nominatim
  `countrycodes`, and data file paths. The city is switched via the panel
  title itself: the city-name portion of "<City> Grocery Heatmap" is a
  `<select>` (built from the config) styled as heading text with a small
  chevron; default is Paris. Switching clears the entered address/results,
  refits the camera, and recomputes the overlay. Store + boundary data are
  fetched lazily per city and cached in `App.tsx` state for the session.
- Map navigation is clipped per city: on select, `MapView` contain-fits the
  city bbox, sets `minZoom` to the fitted zoom (minus a small epsilon), and
  sets `maxBounds` to the fitted viewport (`map.getBounds()`) — at max
  zoom-out the view is exactly the whole city and panning is clamped on both
  axes; zoomed in, panning stays within that min-zoom view. The framing
  depends on viewport aspect, so it is re-applied on map `resize` (debounced
  150 ms). Constraints are lifted momentarily before each re-fit so the new
  framing doesn't fight the old clip.
- Store data is pre-baked GeoJSON in `public/data/stores-<city>.geojson`,
  fetched at runtime from the app's own origin (decision #2).
  `scripts/fetch-stores.mjs` queries Overpass by the city's wikidata area id
  (Paris Q90, NYC Q60).
- OSM tag quirks handled in the fetch script: fishmongers are `shop=seafood`,
  organic stores are any shop with `organic=only`; both are normalised to the
  PRD's category names (`fishmonger`, `organic`) so the app only sees the 12
  canonical types in `src/storeTypes.ts`.
- Always-on distance-to-nearest-store overlay (decision #3, updated
  2026-06-11): a grid over the city bbox is coloured by proximity — red
  at/below a min distance → orange → yellow → green → cyan → blue at/beyond a
  max distance. Both bounds are user-configurable from the "Heatmap settings"
  panel (defaults 50 m / 500 m, `HEAT_MIN_M` / `HEAT_CUTOFF_M` in
  `src/types.ts`). Cell size is adaptive (decision #6): the smallest multiple
  of 25 m that keeps the grid under ~200k cells — Paris 50 m, NYC 125 m.
  Rendered synchronously in `src/lib/distanceField.ts` using a coarse 500 m
  spatial bucket grid with ring-by-ring nearest-neighbour search; result is a
  PNG data-URL fed into a MapLibre `image` / `raster` layer. Recomputes when
  the city, active type filters, or ramp bounds change (debounced 250 ms for
  slider drags).
- The overlay is clipped to the city's administrative boundary
  (`public/data/boundary-<city>.geojson`, from `scripts/fetch-boundary.mjs`)
  via a `destination-in` composite fill on the same canvas; a thin
  `boundary-line` layer outlines the clip edge. If the boundary file is
  missing the overlay renders unclipped (fail soft).
- Type filters work by calling `setData` with a filtered FeatureCollection;
  the distance-field overlay recomputes on the same change.
- Individual store dots (no clustering) are shown via a `circle` layer whose
  radius interpolates with zoom (11 → 2 px, 14 → 5 px, 16 → 7 px).
- State lives in `App.tsx`; `MapView` is the only component that touches the
  MapLibre instance (via refs + effects).

## Gotchas

- MapLibre mutates the style object passed to `new Map()`. Always build it
  fresh per instance (`makeMapStyle()` in `MapView.tsx`) or the second
  StrictMode mount gets a corrupted style.
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
