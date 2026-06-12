// Fetches stores for a configured city and dataset from the Overpass API and
// writes them as GeoJSON to public/data/<prefix>-<city>.geojson.
//
// Intended to be run weekly by a scheduled runner:
//   npm run fetch-stores                      (paris, food)
//   npm run fetch-stores -- nyc
//   npm run fetch-stores -- nyc fitness
//   npm run fetch-stores -- paris fitness

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

const datasetId = process.argv[3] ?? 'food'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

// ---------------------------------------------------------------------------
// Food dataset
// ---------------------------------------------------------------------------

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

function buildFoodQuery({ wikidata, timeout }) {
  return `
[out:json][timeout:${timeout}];
area["wikidata"="${wikidata}"]["boundary"="administrative"]->.city;
(
  nwr["shop"~"^(${SHOP_TYPES.join('|')})$"](area.city);
  nwr["shop"]["organic"="only"](area.city);
);
out center tags;
`
}

// Returns null when !tags.shop so toGeoJSON skips non-shop elements.
// Normalises OSM tag quirks: seafood → fishmonger, organic=only → organic.
function normaliseFood(tags) {
  if (!tags.shop) return null
  if (tags.organic === 'only') return 'organic'
  if (tags.shop === 'seafood') return 'fishmonger'
  return tags.shop
}

// ---------------------------------------------------------------------------
// Fitness dataset
// ---------------------------------------------------------------------------

// Fitness features reuse the `shop` property key (shop: 'yoga') — deliberate
// quirk so StoreProperties, MapView's ['get','shop'] expressions, and
// distanceField.ts stay untouched.

function buildFitnessQuery({ wikidata, timeout }) {
  return `
[out:json][timeout:${timeout}];
area["wikidata"="${wikidata}"]["boundary"="administrative"]->.city;
(
  nwr["leisure"="fitness_centre"](area.city);
  nwr["leisure"="dance"](area.city);
  nwr["leisure"]["sport"~"fitness|yoga|pilates|martial_arts|karate|judo|taekwondo|boxing|mma|climbing|dance"](area.city);
);
out center tags;
`
}

const MARTIAL = new Set(['martial_arts', 'karate', 'judo', 'taekwondo', 'boxing', 'mma'])
const EXCLUDED_LEISURE = new Set(['fitness_station', 'pitch', 'track']) // outdoor facilities, not businesses

function normaliseFitness(tags) {
  const leisure = tags.leisure
  if (!leisure || EXCLUDED_LEISURE.has(leisure)) return null
  if (tags.shop) return null // strictly no retail
  const sports = (tags.sport ?? '').split(';').map((s) => s.trim().toLowerCase())
  const has = (s) => sports.includes(s)
  if (has('yoga')) return 'yoga'
  if (has('pilates')) return 'pilates'
  if (sports.some((s) => MARTIAL.has(s))) return 'martial_arts'
  if (has('climbing')) return 'climbing'
  if (leisure === 'dance' || has('dance')) return 'dance'
  if (leisure === 'fitness_centre') return 'gym'
  if (leisure === 'sports_centre' && has('fitness')) return 'gym'
  return null // generic sports_centre (pools/municipal halls), unrelated leisure
}

// ---------------------------------------------------------------------------
// Dataset registry
// ---------------------------------------------------------------------------

const DATASETS = {
  food: {
    outPrefix: 'stores',
    minFeatures: 100,
    buildQuery: buildFoodQuery,
    normalise: normaliseFood,
  },
  fitness: {
    outPrefix: 'fitness',
    minFeatures: 50,
    buildQuery: buildFitnessQuery,
    normalise: normaliseFitness,
  },
}

const dataset = DATASETS[datasetId]
if (!dataset) {
  console.error(`Unknown dataset "${datasetId}". Available: ${Object.keys(DATASETS).join(', ')}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Fetch + convert
// ---------------------------------------------------------------------------

const query = dataset.buildQuery(city)

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

function toGeoJSON(overpass, normalise) {
  const features = []
  const seen = new Set()
  for (const el of overpass.elements ?? []) {
    const lat = el.lat ?? el.center?.lat
    const lon = el.lon ?? el.center?.lon
    if (lat == null || lon == null) continue
    const canonical = normalise(el.tags ?? {})
    if (canonical == null) continue
    const id = `${el.type}/${el.id}`
    if (seen.has(id)) continue
    seen.add(id)
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] },
      properties: {
        id,
        name: el.tags?.name ?? null,
        shop: canonical,
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
const geojson = toGeoJSON(data, dataset.normalise)

// Guard against a partial/empty Overpass response clobbering good committed
// data: even the sparsest city (Austin fitness ≈150) has enough entries that
// a result below minFeatures means the query failed, not that the city emptied out.
const { minFeatures, outPrefix } = dataset
if (geojson.features.length < minFeatures) {
  console.error(
    `Refusing to write: only ${geojson.features.length} features for ${cityId}/${datasetId} ` +
      `(< ${minFeatures}); the Overpass result looks partial or empty.`,
  )
  process.exit(1)
}

const counts = {}
for (const f of geojson.features) counts[f.properties.shop] = (counts[f.properties.shop] ?? 0) + 1
console.log(`Fetched ${geojson.features.length} features for ${cityId}/${datasetId}:`)
for (const [shop, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${shop.padEnd(14)} ${n}`)
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
await mkdir(outDir, { recursive: true })
const outFile = path.join(outDir, `${outPrefix}-${cityId}.geojson`)
await writeFile(outFile, JSON.stringify(geojson))
console.log(`Wrote ${outFile}`)
