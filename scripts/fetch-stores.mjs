// Fetches grocery stores for a configured city from the Overpass API and
// writes them as GeoJSON to public/data/stores-<city>.geojson.
//
// Intended to be run weekly by a scheduled runner:
//   npm run fetch-stores            (Paris, the default)
//   npm run fetch-stores -- nyc

import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// wikidata ids pin the administrative areas, avoiding name collisions
const CITIES = {
  paris: { wikidata: 'Q90', timeout: 180 },
  nyc: { wikidata: 'Q60', timeout: 300 },
  austin: { wikidata: 'Q16559', timeout: 240 },
}

const cityId = process.argv[2] ?? 'paris'
const city = CITIES[cityId]
if (!city) {
  console.error(`Unknown city "${cityId}". Available: ${Object.keys(CITIES).join(', ')}`)
  process.exit(1)
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

// PRD §4.3 lists `shop=fishmonger` and `shop=organic`, but in OSM fishmongers
// are tagged `shop=seafood` and organic stores are `<any shop>` + `organic=only`.
// We query the real tags and normalise back to the PRD's category names below.
const SHOP_TYPES = [
  'supermarket',
  'convenience',
  'greengrocer',
  'butcher',
  'seafood',
  'bakery',
  'pastry',
  'deli',
  'cheese',
  'frozen_food',
  'wine',
  'alcohol',
  'beverages',
  'chocolate',
  'confectionery',
  'tea',
  'coffee',
]

const query = `
[out:json][timeout:${city.timeout}];
area["wikidata"="${city.wikidata}"]["boundary"="administrative"]->.city;
(
  nwr["shop"~"^(${SHOP_TYPES.join('|')})$"](area.city);
  nwr["shop"]["organic"="only"](area.city);
);
out center tags;
`

async function fetchOverpass() {
  let lastError
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`Querying ${endpoint} ...`)
      const res = await fetch(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        headers: { 'User-Agent': 'grocery-heatmap/0.1 (data refresh script)' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      return await res.json()
    } catch (err) {
      console.warn(`  failed: ${err.message}`)
      lastError = err
    }
  }
  throw new Error(`All Overpass endpoints failed. Last error: ${lastError?.message}`)
}

function normaliseShop(tags) {
  if (tags.organic === 'only') return 'organic'
  if (tags.shop === 'seafood') return 'fishmonger'
  return tags.shop
}

function toGeoJSON(overpass) {
  const features = []
  const seen = new Set()
  for (const el of overpass.elements ?? []) {
    const lat = el.lat ?? el.center?.lat
    const lon = el.lon ?? el.center?.lon
    if (lat == null || lon == null || !el.tags?.shop) continue
    const id = `${el.type}/${el.id}`
    if (seen.has(id)) continue
    seen.add(id)
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] },
      properties: {
        id,
        name: el.tags.name ?? null,
        shop: normaliseShop(el.tags),
      },
    })
  }
  // No `generated` timestamp: it would change on every weekly run and churn the
  // committed file / git diff even when no stores actually changed.
  return {
    type: 'FeatureCollection',
    features,
  }
}

const data = await fetchOverpass()
const geojson = toGeoJSON(data)

// Guard against a partial/empty Overpass response clobbering good committed
// data: even the sparsest city (Austin) has hundreds of stores, so a result
// this small means the query failed, not that the city emptied out.
const MIN_STORES = 100
if (geojson.features.length < MIN_STORES) {
  console.error(
    `Refusing to write: only ${geojson.features.length} stores for ${cityId} ` +
      `(< ${MIN_STORES}); the Overpass result looks partial or empty.`,
  )
  process.exit(1)
}

const counts = {}
for (const f of geojson.features) counts[f.properties.shop] = (counts[f.properties.shop] ?? 0) + 1
console.log(`Fetched ${geojson.features.length} stores for ${cityId}:`)
for (const [shop, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${shop.padEnd(14)} ${n}`)
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
await mkdir(outDir, { recursive: true })
const outFile = path.join(outDir, `stores-${cityId}.geojson`)
await writeFile(outFile, JSON.stringify(geojson))
console.log(`Wrote ${outFile}`)
