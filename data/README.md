# data — Python data-fetch package

Replaces the retired `scripts/fetch-stores.mjs` and `scripts/fetch-boundary.mjs`
Node scripts. Queries the Overpass API / OSM boundary services, normalises tags,
deduplicates, and writes compact GeoJSON to `public/data/`.

## Requirements

- **Python 3.11+** (tested on 3.14). Stdlib only for food datasets.
- **`duckdb`** — required **only** for fitness datasets (Overture merge). Install once:
  ```bash
  pip3 install duckdb --user --break-system-packages   # Python 3.11+
  # or for Python 3.10:
  pip3.10 install duckdb --user
  ```
  If duckdb is unavailable, pass `--no-overture` to fall back to OSM-only
  fitness data (the merge step is skipped entirely).

## Commands

All commands are also exposed via `npm run` (see `package.json`).

```bash
# Fetch store data — defaults to paris food
python3 -m data fetch-stores
python3 -m data fetch-stores nyc
python3 -m data fetch-stores nyc fitness
python3 -m data fetch-stores paris fitness

# Fetch all cities × datasets (paris food, paris fitness, nyc food, ...)
# Sleeps ~10 s between Overpass calls to be polite
python3 -m data fetch-stores --all

# Fetch city admin boundary — defaults to paris
python3 -m data fetch-boundary
python3 -m data fetch-boundary nyc
python3 -m data fetch-boundary austin

# Write to a temp dir instead of public/data/ (useful for parity testing)
python3 -m data fetch-stores nyc fitness --out-dir /tmp/out
python3 -m data fetch-boundary paris --out-dir /tmp/out
```

### Output files

| Command | Output file |
|---|---|
| `fetch-stores <city> food` | `public/data/stores-<city>.geojson` |
| `fetch-stores <city> fitness` | `public/data/fitness-<city>.geojson` |
| `fetch-boundary <city>` | `public/data/boundary-<city>.geojson` |

### Guards

`fetch-stores` refuses to overwrite if Overpass returns fewer features than the
per-dataset minimum (food: 100, fitness: 50) and exits non-zero. `fetch-boundary`
aborts if the simplified polygon's area falls outside the per-city plausible range.

## Intended schedule

Run weekly, commit the result:

```bash
python3 -m data fetch-stores --all
python3 -m data fetch-boundary paris
python3 -m data fetch-boundary nyc
python3 -m data fetch-boundary austin
```

## Sync notes

- **`data/cities.py` must stay in sync with `src/cities.ts`** whenever city ids,
  wikidata ids, or OSM relation ids change.
- **`data/overpass.py` `SHOP_TYPES`** must stay in sync with the food tags in
  `src/storeTypes.ts`.
- **`data/overpass.py` fitness sport list and `normalise_fitness`** must stay in
  sync with the fitness tags in `src/storeTypes.ts`.
- **`data/boundary.py` area ranges and tolerance values** match the per-city
  comments in `data/cities.py`. NYC's OSM admin polygon legitimately extends
  into harbour/bay water (~1,223 km²), so its range is wider than the land area.
