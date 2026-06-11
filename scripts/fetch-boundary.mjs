// Fetches a city's administrative boundary from OSM, simplifies it, and
// writes it as a GeoJSON Feature to public/data/boundary-<city>.geojson.
// Used to clip the distance-field overlay.
//
// Run:
//   npm run fetch-boundary            (Paris, the default)
//   npm run fetch-boundary -- nyc

import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CITIES = {
  paris: {
    relation: 71525, // wikidata Q90
    name: 'Paris',
    // ~105 km² (intra-muros incl. both bois)
    areaRange: [90, 120],
    // ~15 m tolerance: invisible at the overlay's 50 m cell resolution
    toleranceDeg: 0.00015,
  },
  nyc: {
    relation: 175905, // wikidata Q60 — City of New York (all 5 boroughs)
    name: 'New York City',
    // ~784 km² of land; the OSM admin polygon extends into harbour/bay water,
    // so accept up to ~1,300 km²
    areaRange: [700, 1300],
    // coarser tolerance: NYC overlay cells are ≥100 m
    toleranceDeg: 0.0004,
    // If the big city relation is unavailable, assemble the five boroughs
    fallbackRelations: [2552485, 369518, 369519, 2552450, 962876],
  },
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
const USER_AGENT = 'grocery-heatmap/0.1 (boundary fetch script)'

async function fromPolygonsService(relationId) {
  const url = `https://polygons.openstreetmap.fr/get_geojson.py?id=${relationId}&params=0`
  console.log(`Trying ${url} ...`)
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  let geom = await res.json()
  // The service sometimes wraps the result in a GeometryCollection
  if (geom?.type === 'GeometryCollection') geom = geom.geometries?.[0]
  if (geom?.type !== 'Polygon' && geom?.type !== 'MultiPolygon') {
    throw new Error(`unexpected geometry type: ${geom?.type}`)
  }
  return geom
}

// --- Overpass fallback: download member ways and stitch them into rings ---

const key = ([lng, lat]) => `${lng.toFixed(7)},${lat.toFixed(7)}`

function stitchRings(ways) {
  const unused = ways.map((w) => w.geometry.map((p) => [p.lon, p.lat]))
  const rings = []
  while (unused.length > 0) {
    const ring = unused.shift()
    while (key(ring[0]) !== key(ring[ring.length - 1])) {
      const end = key(ring[ring.length - 1])
      const idx = unused.findIndex((w) => key(w[0]) === end || key(w[w.length - 1]) === end)
      if (idx === -1) throw new Error('open ring: member ways do not close')
      const [next] = unused.splice(idx, 1)
      if (key(next[0]) !== end) next.reverse()
      ring.push(...next.slice(1))
    }
    rings.push(ring)
  }
  return rings
}

function pointInRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function assemblePolygons(members) {
  const ways = (role) => members.filter((m) => m.type === 'way' && m.role === role && m.geometry)
  const outers = stitchRings(ways('outer'))
  const inners = stitchRings(ways('inner'))
  const polygons = outers.map((outer) => [outer])
  for (const inner of inners) {
    const host = polygons.find(([outer]) => pointInRing(inner[0], outer))
    if (host) host.push(inner)
  }
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons }
}

async function fromOverpass(relationId) {
  const query = `[out:json][timeout:300];rel(${relationId});out geom;`
  let lastError
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`Querying ${endpoint} for relation ${relationId} ...`)
      const res = await fetch(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        headers: { 'User-Agent': USER_AGENT },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const json = await res.json()
      const rel = json.elements?.find((el) => el.type === 'relation')
      if (!rel) throw new Error('relation not found in response')
      return assemblePolygons(rel.members ?? [])
    } catch (err) {
      console.warn(`  failed: ${err.message}`)
      lastError = err
    }
  }
  throw new Error(`All Overpass endpoints failed. Last error: ${lastError?.message}`)
}

// --- Douglas-Peucker simplification (tolerance in degrees) ---

function perpDist([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(x - x1, y - y1)
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2))
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
}

function douglasPeucker(points, tol) {
  if (points.length <= 2) return points
  let maxD = 0
  let maxI = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], points[0], points[points.length - 1])
    if (d > maxD) {
      maxD = d
      maxI = i
    }
  }
  if (maxD <= tol) return [points[0], points[points.length - 1]]
  return [
    ...douglasPeucker(points.slice(0, maxI + 1), tol).slice(0, -1),
    ...douglasPeucker(points.slice(maxI), tol),
  ]
}

function simplifyRing(ring, tol) {
  const simplified = douglasPeucker(ring, tol)
  return simplified.length >= 4 ? simplified : ring
}

function mapRings(geom, fn) {
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.coordinates.map(fn) }
  }
  return { type: 'MultiPolygon', coordinates: geom.coordinates.map((poly) => poly.map(fn)) }
}

function countPoints(geom) {
  let n = 0
  mapRings(geom, (ring) => {
    n += ring.length
    return ring
  })
  return n
}

// --- Area check: equirectangular shoelace, signed sum over rings ---

function ringAreaKm2(ring) {
  const latRef = (ring[0][1] * Math.PI) / 180
  const mLat = 111_320
  const mLng = 111_320 * Math.cos(latRef)
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * mLng * (ring[i][1] * mLat) - ring[i][0] * mLng * (ring[j][1] * mLat)
  }
  return Math.abs(sum / 2) / 1e6
}

function areaKm2(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  let total = 0
  for (const [outer, ...holes] of polys) {
    total += ringAreaKm2(outer)
    for (const hole of holes) total -= ringAreaKm2(hole)
  }
  return total
}

// Flatten a geometry into a list of polygon coordinate arrays
function polygonsOf(geom) {
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
}

async function fetchRelation(relationId) {
  try {
    return await fromPolygonsService(relationId)
  } catch (err) {
    console.warn(`polygons.openstreetmap.fr failed (${err.message}); falling back to Overpass`)
    return fromOverpass(relationId)
  }
}

// --- Main ---

let raw
try {
  raw = await fetchRelation(city.relation)
} catch (err) {
  if (!city.fallbackRelations) throw err
  console.warn(`City relation ${city.relation} failed (${err.message}); assembling from parts`)
  const parts = []
  for (const rel of city.fallbackRelations) {
    parts.push(...polygonsOf(await fetchRelation(rel)))
  }
  raw = { type: 'MultiPolygon', coordinates: parts }
}

const simplified = mapRings(raw, (ring) =>
  simplifyRing(ring, city.toleranceDeg).map(([lng, lat]) => [
    Number(lng.toFixed(6)),
    Number(lat.toFixed(6)),
  ]),
)

const area = areaKm2(simplified)
console.log(
  `Boundary: ${simplified.type}, ${countPoints(raw)} → ${countPoints(simplified)} points, ${area.toFixed(1)} km²`,
)
const [minArea, maxArea] = city.areaRange
if (area < minArea || area > maxArea) {
  throw new Error(
    `area ${area.toFixed(1)} km² is outside the plausible range ${minArea}-${maxArea} km² for ${city.name}; aborting`,
  )
}

const feature = {
  type: 'Feature',
  properties: { name: city.name, osmRelation: city.relation, generated: new Date().toISOString() },
  geometry: simplified,
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
await mkdir(outDir, { recursive: true })
const outFile = path.join(outDir, `boundary-${cityId}.geojson`)
await writeFile(outFile, JSON.stringify(feature))
console.log(`Wrote ${outFile}`)
