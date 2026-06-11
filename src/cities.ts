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
  /** OSM admin boundary relation (see scripts/fetch-boundary.mjs) */
  osmRelation: number
  wikidata: string
  /** Nominatim countrycodes restriction for address search */
  countryCodes: string
  storesFile: string
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
    storesFile: 'data/stores-paris.geojson',
    boundaryFile: 'data/boundary-paris.geojson',
  },
  {
    id: 'nyc',
    label: 'New York',
    // All five boroughs
    bounds: { minLat: 40.477, maxLat: 40.918, minLng: -74.26, maxLng: -73.7 },
    osmRelation: 175905,
    wikidata: 'Q60',
    countryCodes: 'us',
    storesFile: 'data/stores-nyc.geojson',
    boundaryFile: 'data/boundary-nyc.geojson',
  },
]

export const DEFAULT_CITY = CITIES[0]

const byId = new Map(CITIES.map((c) => [c.id, c]))

export function cityById(id: string): CityDef {
  return byId.get(id) ?? DEFAULT_CITY
}
