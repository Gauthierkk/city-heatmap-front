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
  nwr[!"leisure"]["sport"~"fitness|yoga|pilates|martial_arts|karate|judo|taekwondo|boxing|mma|climbing|dance"](area.city);
  nwr["amenity"~"^(dojo|dancing_school|gym)$"](area.city);
  nwr["club"="sport"](area.city);
  nwr["leisure"="sports_hall"](area.city);
);
out center tags;
`
}

const MARTIAL = new Set(['martial_arts', 'karate', 'judo', 'taekwondo', 'boxing', 'mma'])
// Outdoor / non-business leisure values that should never yield a result
const EXCLUDED_LEISURE = new Set(['fitness_station', 'pitch', 'track', 'swimming_pool', 'water_park'])

// Classify purely from the sport tag using the canonical priority chain.
// Returns one of the six canonical types, or null if no match.
function classifyBySport(tags) {
  const sports = (tags.sport ?? '').split(';').map((s) => s.trim().toLowerCase())
  const has = (s) => sports.includes(s)
  if (has('yoga')) return 'yoga'
  if (has('pilates')) return 'pilates'
  if (sports.some((s) => MARTIAL.has(s))) return 'martial_arts'
  if (has('climbing')) return 'climbing'
  if (has('dance')) return 'dance'
  if (has('fitness')) return 'gym'
  return null // rowing, pétanque, tennis, swimming, etc. — filter these out
}

function normaliseFitness(tags) {
  if (tags.shop) return null // strictly no retail

  const leisure = tags.leisure
  const amenity = tags.amenity

  // Explicit EXCLUDED_LEISURE values are always outdoor/non-business facilities
  if (leisure && EXCLUDED_LEISURE.has(leisure)) return null

  // amenity-keyed variants: dojo, dancing_school, gym
  if (amenity === 'dojo') return 'martial_arts'
  if (amenity === 'dancing_school') return 'dance'
  if (amenity === 'gym') return 'gym'

  // Sport tag takes priority over leisure for all cases where both are present:
  // a fitness_centre tagged sport=yoga is a yoga studio, not a generic gym.
  // classifyBySport returns null when no recognised sport tag is found.
  const bySport = classifyBySport(tags)
  if (bySport !== null) return bySport

  // No recognised sport tag — fall back to leisure semantics.
  // leisure=fitness_centre → gym; leisure=dance → dance studio.
  if (leisure === 'fitness_centre') return 'gym'
  if (leisure === 'dance') return 'dance'

  // sports_centre, sports_hall, club=sport, bare sport=* with no matching sport
  // tag: nothing we can classify (e.g. rowing, pétanque, tennis, municipal halls).
  return null
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

// ---------------------------------------------------------------------------
// Conflation helpers
// ---------------------------------------------------------------------------

// Haversine distance in metres between two (lat, lon) pairs.
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Normalise a display name for exact-match conflation:
// lowercase → strip diacritics (NFD + strip combining marks) → strip punctuation → collapse whitespace.
function normName(name) {
  if (!name) return ''
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Remove node+way duplicate pairs: same normalised name, same canonical type,
// within 50 m. Prefer keeping a node over a way/relation; otherwise keep first seen.
const CONFLATION_RADIUS_M = 50

function conflate(features) {
  // Group by (normalisedName + '|' + shopType). Features with empty normalised
  // names are never conflated (kept unconditionally).
  const groups = new Map() // key → Feature[]
  const unnamed = []
  for (const f of features) {
    const nn = normName(f.properties.name)
    if (!nn) { unnamed.push(f); continue }
    const key = `${nn}|${f.properties.shop}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(f)
  }

  const kept = [...unnamed]
  let removed = 0

  for (const group of groups.values()) {
    if (group.length === 1) { kept.push(group[0]); continue }

    // Within each name+type group, do a pairwise distance check and mark
    // duplicates.  O(k²) but k is tiny (almost always 2–3 per group).
    const suppress = new Set()
    for (let i = 0; i < group.length; i++) {
      if (suppress.has(i)) continue
      for (let j = i + 1; j < group.length; j++) {
        if (suppress.has(j)) continue
        const [lonI, latI] = group[i].geometry.coordinates
        const [lonJ, latJ] = group[j].geometry.coordinates
        if (haversineM(latI, lonI, latJ, lonJ) <= CONFLATION_RADIUS_M) {
          // Determine which to suppress: prefer keeping nodes over ways/relations
          const typeI = group[i].properties.id.split('/')[0]
          const typeJ = group[j].properties.id.split('/')[0]
          if (typeI === 'node' && typeJ !== 'node') {
            suppress.add(j)
          } else if (typeJ === 'node' && typeI !== 'node') {
            suppress.add(i)
          } else {
            suppress.add(j) // both same type — keep first seen (lower index)
          }
        }
      }
    }
    for (let i = 0; i < group.length; i++) {
      if (suppress.has(i)) { removed++ } else { kept.push(group[i]) }
    }
  }

  console.log(`Conflated ${removed} duplicate(s)`)
  return kept
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

  const dedupedFeatures = conflate(features)

  // No `generated` timestamp: it would change on every weekly run and churn the
  // committed file / git diff even when no stores actually changed.
  return {
    type: 'FeatureCollection',
    features: dedupedFeatures,
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
