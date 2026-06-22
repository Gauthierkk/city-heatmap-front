# City Heatmap - front end

Interactive **proximity heatmap** for a city's amenities. Pick a category
(grocery, specialty food, fitness, …), type an address, and see what's closest -
the map is shaded by distance-to-nearest, with per-type filters and a ranked
closest-places list. React + Vite + TypeScript + MapLibre GL JS.

It ships configured for **Paris** (the reference deployment), but the core
categories work for **any city** - see [Use your own city](#use-your-own-city).

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173/city-heatmap-front/
```

## How it works (brief)

- UI state lives in `src/App.tsx`; `src/components/MapView.tsx` is the only code
  that touches MapLibre. Per-city config is `src/cities.ts`, categories + types
  `src/storeTypes.ts`, strings `src/i18n.ts` (en/fr).
- The proximity overlay is a distance-to-nearest raster computed client-side
  (`src/lib/distanceField.ts`), clipped to the city boundary.
- **Nothing is fetched live** except address geocoding (Nominatim). The
  store/boundary GeoJSON is pre-baked by the sibling worker repo
  [`city-heatmap-data`](../city-heatmap-data) and committed under `data/`.

Deeper architecture notes: [`docs/`](docs/) and `CLAUDE.md`.

## Self-hosting

It's a static site - build it and serve the `dist/` folder on any static host
(GitHub Pages, Netlify, S3, nginx, …).

```bash
npm run build      # type-check + production build → dist/
npm run preview    # serve the build locally to check it
```

- Set `base` in `vite.config.ts` to where you host it: `'/'` for a root domain,
  `'/<repo>/'` for a GitHub Pages project page (currently `'/city-heatmap-front/'`).
- The GeoJSON lives at the repo root in **`data/`** (outside `public/`): store
  layers under `data/places/<city>/`, clip boundaries at
  `data/boundaries/<city>.geojson`. A small Vite plugin (`serveData`) serves
  `./data/*` at `/data/*` in dev and copies the tree into `dist/` at build, so no
  host-specific config is needed. Transit line pictograms are static assets in
  `public/lines/`.

## Use your own city

The **grocery / specialty / fitness** categories and the **boundary** are
city-agnostic - they come from OpenStreetMap, so they work anywhere. To retarget
the app:

1. **Generate the data.** In the [`city-heatmap-data`](../city-heatmap-data)
   worker, add your city to `fetcher/cities.py` and run `fetch-stores` +
   `fetch-boundary` for it (see that repo's README). Copy the output into this
   repo at the paths `src/cities.ts` expects - `data/places/<city>/food.geojson`,
   `…/fitness.geojson`, and `data/boundaries/<city>.geojson`.
2. **Register the city** in `src/cities.ts`: add a `CityDef` (`id`, `label`,
   `bounds` bbox, `osmRelation`, `wikidata`, `countryCodes`, `storesFiles`,
   `boundaryFile`) and point `DEFAULT_CITY` at it. Keep these facts in sync with
   the worker's `fetcher/cities.py`.
3. **(Optional)** tweak categories / store types in `src/storeTypes.ts`.

A category only appears for a city that has a data file for it, so a new city
cleanly shows just the categories you generated.

### Paris-specific categories

These four are powered by **Paris / Île-de-France open-data sets** and do **not**
generalise - omit them for a non-Paris build (just leave their
`storesFiles` / `transitLinesFile` entries out of the `CityDef`):

| Category | Data source |
|---|---|
| **Transit** - stations + official line bullets | IDF Mobilités `emplacement-des-gares-idf` |
| **Transit lines** - coloured route geometry | IDF Mobilités `traces-du-reseau-ferre-idf` |
| **Trees** - street-tree density heatmap | opendata.paris.fr `les-arbres` |
| **Pharmacies** | Région Île-de-France pharmacy register |

To bring an equivalent layer to another city you'd need a comparable local
dataset and a matching fetch step in the worker.

## Docs

- [Product spec](docs/PRD.md)
- [Decisions log](docs/DECISIONS.md)

## Data sources & attribution

| Source | Data | License |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors | Stores + boundaries (all cities); Nominatim geocoding | [ODbL 1.0](https://www.openstreetmap.org/copyright) |
| [Overture Maps](https://overturemaps.org/) | Additional fitness venues (merged with OSM) | [CDLA-Permissive 2.0](https://cdla.dev/permissive-2-0/) |
| [OpenFreeMap](https://openfreemap.org/) | Map tiles | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/) |
| [Île-de-France Mobilités](https://data.iledefrance-mobilites.fr/) | Paris transit stations, line geometry, colours + pictograms | Open data (Licence Ouverte / ODbL) |
| [opendata.paris.fr](https://opendata.paris.fr/) | Paris street trees | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/) |
| [Région Île-de-France](https://data.iledefrance.fr/) | Paris pharmacies | Open data |

## License

Code is released under the [MIT License](LICENSE). Bundled store and boundary
data derive from OpenStreetMap and remain © OpenStreetMap contributors under the
[ODbL](https://www.openstreetmap.org/copyright); fitness datasets additionally
incorporate Overture Maps Places data (CDLA-Permissive 2.0). The Paris-specific
layers carry the licenses of their respective open-data sources above.
