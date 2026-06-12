export interface StoreProperties {
  id: string
  name: string | null
  shop: string
}

export interface StoreFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: StoreProperties
}

export interface StoreCollection {
  type: 'FeatureCollection'
  generated?: string
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
 *  live-tracked), never persisted — consistent with the no-storage stance. */
export type Theme = 'light' | 'dark'

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
