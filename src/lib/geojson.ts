import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon, Position } from 'geojson'
import { MAJOR_STATION_TAG, primaryTransitType } from '../storeTypes'
import type { StoreCollection, StoreProperties, TransitLine } from '../types'

// Pure data-shaping helpers for the GeoJSON the app loads. Kept out of the
// components (App/MapView) so they stay small and these stay trivially testable.

/** True when two tag sets are equal - lets callers no-op identical filter
 *  updates (e.g. "Select all" when everything is already active) so memoised
 *  derived state doesn't needlessly recompute. */
export function sameTagSet(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const tag of a) if (!b.has(tag)) return false
  return true
}

// A location can carry several tags (e.g. a transit hub serving metro + RER +
// train), so it should match any of them when filtering. `categories[]` holds
// the full set; shop data has just the single `shop`. `shop` stays the primary
// tag (dot colour/label); these are the tags used for filtering and counts.
export function storeTags(p: StoreProperties): string[] {
  return p.categories && p.categories.length ? p.categories : [p.shop]
}

// Like the address, MapLibre stringifies the categories array when read off a
// rendered feature (map click); the copy from React state stays a live array.
export function parseCategories(value: unknown): string[] | null {
  if (Array.isArray(value)) return value as string[]
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

// Transit `lines` array - same MapLibre-stringification dance as parseCategories,
// but each element is a {mode, line, picto} object.
export function parseLines(value: unknown): TransitLine[] | null {
  if (Array.isArray(value)) return value as TransitLine[]
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as TransitLine[]) : null
    } catch {
      return null
    }
  }
  return null
}

// Transit stations ship a `categories[]` array instead of a single `shop`
// tag. On load, derive a primary `shop` so they flow through the same
// single-type machinery as shops, and split out `major_station` - it's a size
// flag (`major`), not a mode, so it's dropped from the modes used as tags.
// No-op for files that already carry `shop` (food/fitness).
export function withShopTags(data: StoreCollection): StoreCollection {
  if (!data.features.some((f) => !f.properties.shop && Array.isArray(f.properties.categories)))
    return data
  return {
    ...data,
    features: data.features.map((f) => {
      const p = f.properties
      if (p.shop || !Array.isArray(p.categories)) return f
      const major = p.categories.includes(MAJOR_STATION_TAG)
      const modes = p.categories.filter((c) => c !== MAJOR_STATION_TAG)
      return { ...f, properties: { ...p, categories: modes, shop: primaryTransitType(modes), major } }
    }),
  }
}

// Accepts a bare geometry, Feature, or FeatureCollection boundary file
export function extractBoundary(data: unknown): Polygon | MultiPolygon | null {
  const obj = data as {
    type?: string
    geometry?: { type?: string }
    features?: Array<{ geometry?: { type?: string } }>
  } | null
  const geom =
    obj?.type === 'Feature' ? obj.geometry :
    obj?.type === 'FeatureCollection' ? obj.features?.[0]?.geometry :
    obj
  return geom?.type === 'Polygon' || geom?.type === 'MultiPolygon'
    ? (geom as Polygon | MultiPolygon)
    : null
}

// Tree files are normalised into a FeatureCollection of Point features, each
// carrying its species (species_fr / species_en) so every coordinate is bound to
// a name and the heatmap / species filter consume one shape. Three on-disk forms
// are accepted: the compact `trees-columnar-v1` payload (a species lookup table +
// parallel coordinate / index arrays - the worker's current output), a plain
// FeatureCollection, and a legacy bare MultiPoint. Returns null if the payload
// holds no usable points.
export function extractTreePoints(data: unknown): FeatureCollection<Point> | null {
  type GeomLike = { type?: string; coordinates?: Position[] }
  const obj = data as {
    type?: string
    format?: string
    geometry?: GeomLike
    features?: Array<{ geometry?: { type?: string } }>
  } | null

  // Columnar format: a frequency-sorted species table indexed per point. Expand
  // into Point features, resolving each species from the table - the assigned
  // strings are the table's own references, so no per-point string copies.
  if (obj?.format === 'trees-columnar-v1') {
    const { species, coordinates, speciesIndex } = obj as unknown as {
      species?: { fr?: string; en?: string }[]
      coordinates?: Position[]
      speciesIndex?: number[]
    }
    if (!Array.isArray(species) || !Array.isArray(coordinates) || !Array.isArray(speciesIndex)) {
      return null
    }
    const features = coordinates.map((coords, i): Feature<Point> => {
      const sp = species[speciesIndex[i]] ?? { fr: '', en: '' }
      return {
        type: 'Feature',
        properties: { species_fr: sp.fr ?? '', species_en: sp.en ?? '' },
        geometry: { type: 'Point', coordinates: coords },
      }
    })
    return features.length ? { type: 'FeatureCollection', features } : null
  }

  if (obj?.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    const points = (obj.features as Feature[]).filter((f) => f.geometry?.type === 'Point')
    return points.length ? { type: 'FeatureCollection', features: points as Feature<Point>[] } : null
  }

  // Legacy MultiPoint (bare or Feature-wrapped): explode into Point features.
  const geom: GeomLike | null | undefined = obj?.type === 'Feature' ? obj.geometry : (obj as GeomLike | null)
  if (geom?.type === 'MultiPoint' && Array.isArray(geom.coordinates)) {
    return {
      type: 'FeatureCollection',
      features: geom.coordinates.map((coordinates) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Point' as const, coordinates },
      })),
    }
  }
  return null
}
