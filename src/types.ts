/** Postal address carried per store (decision: addresses baked into the data
 *  by the city-heatmap-data worker). All parts are optional - coverage is
 *  partial and varies by city. */
export interface StoreAddress {
  housenumber?: string
  street?: string
  postcode?: string
  city?: string
}

/** Transit only: one actual line a station serves, with the official IDFM
 *  pictogram filename (in `public/lines/`) the UI renders as the line bullet.
 *  `picto` is '' for the few source lines with no pictogram (text fallback). */
export interface TransitLine {
  mode: string
  line: string
  picto: string
}

export interface StoreProperties {
  id: string
  name: string | null
  shop: string
  address?: StoreAddress
  /** Transit only: all modes the station serves (metro/rer/tram/train/…).
   *  `shop` is the primary one; this keeps the full set for the popup. */
  categories?: string[]
  /** Transit only: the actual lines the station serves (ordered), shown as
   *  official line bullets in the popup and the closest-stations list. At major
   *  stations this is metro + RER only (mainline trains dropped upstream). */
  lines?: TransitLine[]
  /** Transit only: a major hub (Paris gare) - rendered as a double-size dot,
   *  not a filterable mode. Derived on load from the `major_station` tag. */
  major?: boolean
}

export interface StoreFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: StoreProperties
}

export interface StoreCollection {
  type: 'FeatureCollection'
  features: StoreFeature[]
}

export interface UserLocation {
  lng: number
  lat: number
  label: string
}

export interface RankedStore {
  feature: StoreFeature
  distance: number
}

/** Basemap theme. Seeded once from `prefers-color-scheme` at startup (not
 *  live-tracked), never persisted - consistent with the no-storage stance. */
export type Theme = 'light' | 'dark'

/** OS-derived default basemap theme; read once at startup, not live-tracked. */
export function detectTheme(): Theme {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/** Distance ramp defaults (decision #3): cells ≤ min show full red, cells
 *  ≥ max show full blue. Both are user-adjustable in the heatmap settings.
 *  City bounding boxes live in src/cities.ts. */
export const HEAT_MIN_M = 50
export const HEAT_CUTOFF_M = 500
/** Ceiling of the "blue beyond" slider. The distance field caps its
 *  nearest-store search here: any cell whose nearest store is farther is blue
 *  for every allowed maxDistance, so its exact distance never needs computing.
 *  Must stay ≥ the slider's max in App.tsx. */
export const HEAT_RAMP_MAX_M = 500
