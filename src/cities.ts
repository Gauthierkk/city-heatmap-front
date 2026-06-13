import type { DataSourceId } from './storeTypes'

export interface CityBounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export interface CityDef {
  id: string
  label: string
  /** Bbox: distance-field grid extent, default map view, and the max pan
   *  clip (maxBounds gets a small margin added in MapView) */
  bounds: CityBounds
  /** OSM admin boundary relation (consumed by the city-heatmap-data worker) */
  osmRelation: number
  wikidata: string
  /** Nominatim countrycodes restriction for address search */
  countryCodes: string
  /** Per-source GeoJSON paths (food shared by grocery+specialty, fitness lazy-loaded) */
  storesFiles: Record<DataSourceId, string>
  boundaryFile: string
}

export const CITIES: CityDef[] = [
  {
    id: 'paris',
    label: 'Paris',
    // PRD §4.2 bbox, unchanged from the Paris-only version
    bounds: { minLat: 48.815, maxLat: 48.902, minLng: 2.225, maxLng: 2.47 },
    osmRelation: 71525,
    wikidata: 'Q90',
    countryCodes: 'fr',
    storesFiles: { food: 'data/paris/food.geojson', fitness: 'data/paris/fitness.geojson' },
    boundaryFile: 'data/paris/boundary.geojson',
  },
  {
    id: 'nyc',
    label: 'New York',
    // All five boroughs
    bounds: { minLat: 40.477, maxLat: 40.918, minLng: -74.26, maxLng: -73.7 },
    osmRelation: 175905,
    wikidata: 'Q60',
    countryCodes: 'us',
    storesFiles: { food: 'data/nyc/food.geojson', fitness: 'data/nyc/fitness.geojson' },
    boundaryFile: 'data/nyc/boundary.geojson',
  },
  {
    id: 'austin',
    label: 'Austin',
    // City of Austin admin boundary (OSM relation 113314); bbox = relation
    // bounds rounded to 3dp. The bbox is ~2.4× the city's land area (the rest
    // is unincorporated county), but the overlay is clipped to the boundary.
    bounds: { minLat: 30.099, maxLat: 30.517, minLng: -97.937, maxLng: -97.561 },
    osmRelation: 113314,
    wikidata: 'Q16559',
    countryCodes: 'us',
    storesFiles: { food: 'data/austin/food.geojson', fitness: 'data/austin/fitness.geojson' },
    boundaryFile: 'data/austin/boundary.geojson',
  },
]

export const DEFAULT_CITY = CITIES[0]

const byId = new Map(CITIES.map((c) => [c.id, c]))

export function cityById(id: string): CityDef {
  return byId.get(id) ?? DEFAULT_CITY
}
