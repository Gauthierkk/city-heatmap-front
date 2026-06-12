# Grocery Heatmap

Interactive map of switchable business categories — grocery stores, specialty
food shops, and fitness venues — across Paris, NYC, and Austin, with a
proximity heatmap: enter your address and see which places are closest,
filtered by type.

Built with React, Vite, TypeScript and MapLibre GL JS. Store data ©
[OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL),
fetched via the Overpass API; geocoding by Nominatim.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

## Refreshing store data

```bash
npm run fetch-stores                    # food data for Paris (default)
npm run fetch-stores -- nyc             # food data for NYC
npm run fetch-stores -- paris fitness   # fitness data for Paris (OSM + Overture)
npm run fetch-stores -- nyc fitness --no-overture  # OSM-only fallback
```

Food datasets are OSM-only. Fitness datasets merge **OSM (Overpass)** and
**Overture Maps Places** — requires `duckdb` (see Data sources).

Regenerates `public/data/stores-<city>.geojson` (food) or
`public/data/fitness-<city>.geojson` (fitness). Intended to be run weekly;
commit the result.

## Docs

- [Product spec](docs/PRD.md)
- [Decisions log](docs/DECISIONS.md)

## Data sources & attribution

| Source | Data | License |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors | Store + boundary data (all datasets) | [ODbL 1.0](https://www.openstreetmap.org/copyright) |
| [Overture Maps Foundation](https://overturemaps.org/) | Additional fitness venues (merged with OSM) | [CDLA-Permissive 2.0](https://cdla.dev/permissive-2-0/) |
| [OpenFreeMap](https://openfreemap.org/) | Map tiles | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/) |

## License

Code is released under the [MIT License](LICENSE). The bundled store and
boundary data derive from OpenStreetMap and remain © OpenStreetMap
contributors under the [ODbL](https://www.openstreetmap.org/copyright).
Fitness datasets additionally incorporate Overture Maps Places data under the
CDLA-Permissive 2.0 license.
