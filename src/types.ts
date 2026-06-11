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

/** Distance ramp defaults (decision #3): cells ≤ min show full red, cells
 *  ≥ max show full blue. Both are user-adjustable in the heatmap settings.
 *  City bounding boxes live in src/cities.ts. */
export const HEAT_MIN_M = 50
export const HEAT_CUTOFF_M = 500
