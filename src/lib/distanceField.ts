import type { MultiPolygon, Polygon } from 'geojson'
import type { CityBounds } from '../cities'
import type { StoreCollection } from '../types'
import { HEAT_CUTOFF_M, HEAT_MIN_M, HEAT_RAMP_MAX_M } from '../types'

// Adaptive cell size: smallest multiple of 25 m keeping the grid under
// ~200k cells. Paris lands on 50 m; the much larger NYC bbox on 125 m.
const CELL_STEP_M = 25
const MAX_CELLS = 200_000

function chooseCellSize(spanLngM: number, spanLatM: number): number {
  let cell = CELL_STEP_M
  while (Math.ceil(spanLngM / cell) * Math.ceil(spanLatM / cell) > MAX_CELLS) cell += CELL_STEP_M
  return cell
}

const M_PER_DEG_LAT = 111_320

/** Metres per degree of longitude at the bbox's mid-latitude (equirectangular
 *  approximation). Shared by the grid build and the clip-path transform so the
 *  two can't drift. */
function metresPerDegLng(bounds: CityBounds): number {
  const latRef = (bounds.minLat + bounds.maxLat) / 2
  return M_PER_DEG_LAT * Math.cos((latRef * Math.PI) / 180)
}

// Colour ramp: equally-spaced RGB stops from full red (≤ minDist) to full
// blue (≥ maxDist); intermediate stops scale proportionally between the two.
// The blue endpoint was brightened from [20, 60, 220] → [60, 100, 255] so it
// doesn't merge into Fiord's dark navy (#1a2236) basemap. The cyan step was
// also lightened slightly ([20, 210, 200] → [40, 220, 210]) for consistency.
const RAMP_COLORS: Array<[number, number, number]> = [
  [220,  20,  20], // red
  [230, 110,  20], // orange
  [230, 220,  20], // yellow
  [ 80, 200,  50], // green
  [ 40, 220, 210], // cyan (slightly brightened for dark basemap)
  [ 60, 100, 255], // blue (brightened from [20,60,220] to distinguish from Fiord navy)
]
const ALPHA = Math.round(0.45 * 255)

// Colour lookup table: the ramp sampled into LUT_SIZE+1 RGB triples indexed by
// the normalised distance t∈[0,1]. Built once per render instead of
// interpolating + allocating a 3-tuple for every one of the ~70k–170k cells.
const LUT_SIZE = 1024

function buildColorLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray((LUT_SIZE + 1) * 3)
  const segs = RAMP_COLORS.length - 1
  for (let i = 0; i <= LUT_SIZE; i++) {
    const pos = (i / LUT_SIZE) * segs
    const si = Math.min(Math.floor(pos), segs - 1)
    const f = pos - si
    const lo = RAMP_COLORS[si], hi = RAMP_COLORS[si + 1]
    const o = i * 3
    lut[o]     = lo[0] + f * (hi[0] - lo[0])
    lut[o + 1] = lo[1] + f * (hi[1] - lo[1])
    lut[o + 2] = lo[2] + f * (hi[2] - lo[2])
  }
  return lut
}

const COLOR_LUT = buildColorLut()

export interface DistanceFieldResult {
  dataUrl: string
}

/** Bucket size for the spatial index.  Must be ≥ the cell size; 500 m gives
 *  ~1 ring of buckets to search when the nearest store is within 500 m. */
const BUCKET_M = 500

interface DistanceGrid {
  W: number
  H: number
  cellSizeM: number
  /** Per-cell distance in metres to the nearest store, capped at
   *  HEAT_RAMP_MAX_M. Indexed [cy * W + cx] with cy=0 at minLat (bottom). */
  dist: Float32Array
}

// The nearest-store distances depend only on the store set and the bbox, not
// on the ramp sliders. Cache the most recent grid so dragging "Red within" /
// "Blue beyond" only re-runs the cheap colorize+clip+encode, never the
// nearest-neighbour search. Keyed by reference: App rebuilds the filtered
// FeatureCollection (new identity) whenever stores or active filters change.
let gridCache: { stores: StoreCollection; bounds: CityBounds; grid: DistanceGrid } | null = null

// One reusable scratch canvas for the colorize+clip+encode pass - recreating it
// on every ramp-slider drag is wasteful. `getContext` keeps the same context;
// putImageData overwrites the full rect each render, so no clear is needed.
let scratchCanvas: HTMLCanvasElement | null = null

function scratchContext(w: number, h: number): CanvasRenderingContext2D {
  const canvas = (scratchCanvas ??= document.createElement('canvas'))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  return canvas.getContext('2d')!
}

function computeGrid(stores: StoreCollection, bounds: CityBounds): DistanceGrid {
  const { minLat, maxLat, minLng, maxLng } = bounds
  const M_PER_DEG_LNG = metresPerDegLng(bounds)

  const spanLng = (maxLng - minLng) * M_PER_DEG_LNG
  const spanLat = (maxLat - minLat) * M_PER_DEG_LAT
  const CELL_M = chooseCellSize(spanLng, spanLat)
  const W = Math.ceil(spanLng / CELL_M)
  const H = Math.ceil(spanLat / CELL_M)

  // Build spatial bucket index
  const bCols = Math.ceil(spanLng / BUCKET_M)
  const bRows = Math.ceil(spanLat / BUCKET_M)
  // Each bucket holds [lngM, latM] pairs as interleaved float64
  const buckets: number[][] = Array.from({ length: bRows * bCols }, () => [])

  for (const feature of stores.features) {
    const [lng, lat] = feature.geometry.coordinates
    const lngM = (lng - minLng) * M_PER_DEG_LNG
    const latM = (lat - minLat) * M_PER_DEG_LAT
    const bx = Math.min(Math.floor(lngM / BUCKET_M), bCols - 1)
    const by = Math.min(Math.floor(latM / BUCKET_M), bRows - 1)
    buckets[by * bCols + bx].push(lngM, latM)
  }

  const dist = new Float32Array(W * H)
  const maxRing = Math.max(bCols, bRows) + 1
  // Cap: cells whose nearest store is beyond the ramp ceiling render blue for
  // every allowed maxDistance, so seeding bestDist2 here lets the ring search
  // bail after ~2 rings for far cells instead of scanning the whole grid.
  const CAP2 = HEAT_RAMP_MAX_M * HEAT_RAMP_MAX_M

  for (let cy = 0; cy < H; cy++) {
    const latM = (cy + 0.5) * CELL_M
    const byCentre = Math.min(Math.floor(latM / BUCKET_M), bRows - 1)

    for (let cx = 0; cx < W; cx++) {
      const lngM = (cx + 0.5) * CELL_M
      const bxCentre = Math.min(Math.floor(lngM / BUCKET_M), bCols - 1)

      let bestDist2 = CAP2

      for (let ring = 0; ring <= maxRing; ring++) {
        // Minimum squared distance for any store in this ring
        const ringMinDist = ring === 0 ? 0 : (ring - 1) * BUCKET_M
        if (ringMinDist * ringMinDist > bestDist2) break

        const byMin = Math.max(byCentre - ring, 0)
        const byMax = Math.min(byCentre + ring, bRows - 1)
        const bxMin = Math.max(bxCentre - ring, 0)
        const bxMax = Math.min(bxCentre + ring, bCols - 1)

        for (let by = byMin; by <= byMax; by++) {
          for (let bx = bxMin; bx <= bxMax; bx++) {
            // Skip interior cells of this ring - only border
            if (ring > 0 && by > byMin && by < byMax && bx > bxMin && bx < bxMax) continue
            const bucket = buckets[by * bCols + bx]
            for (let k = 0; k < bucket.length; k += 2) {
              const dx = lngM - bucket[k]
              const dy = latM - bucket[k + 1]
              const d2 = dx * dx + dy * dy
              if (d2 < bestDist2) bestDist2 = d2
            }
          }
        }
      }

      dist[cy * W + cx] = Math.sqrt(bestDist2)
    }
  }

  return { W, H, cellSizeM: CELL_M, dist }
}

/**
 * Compute a distance-to-nearest-store raster for a city bbox.
 *
 * Algorithm: stores are bucketed into a coarse grid (BUCKET_M × BUCKET_M).
 * For every output cell we search outward ring-by-ring from the cell's home
 * bucket, stopping as soon as the ring's minimum possible distance to any
 * store in that ring exceeds the best distance found so far.  This reduces
 * the inner loop from O(all stores) to O(~10–50) for typical urban density.
 * Distances use an equirectangular approximation scaled at the bbox's
 * mid-latitude. The per-cell distances are cached (see gridCache); only the
 * colorize step below re-runs when the ramp sliders move.
 *
 * If `boundary` is given, the result is clipped to it: alpha is zeroed
 * outside the polygon via a `destination-in` composite fill.
 */
export function computeDistanceField(
  stores: StoreCollection,
  bounds: CityBounds,
  minDist: number = HEAT_MIN_M,
  maxDist: number = HEAT_CUTOFF_M,
  boundary?: Polygon | MultiPolygon | null,
): DistanceFieldResult {
  const { minLat, minLng } = bounds
  const M_PER_DEG_LNG = metresPerDegLng(bounds)

  let cached = gridCache
  if (!cached || cached.stores !== stores || cached.bounds !== bounds) {
    cached = { stores, bounds, grid: computeGrid(stores, bounds) }
    gridCache = cached
  }
  const { W, H, cellSizeM: CELL_M, dist } = cached.grid

  const ctx = scratchContext(W, H)
  const imageData = ctx.createImageData(W, H)
  const px = imageData.data

  const invRange = 1 / (maxDist - minDist)
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const d = dist[cy * W + cx]
      let t = (d - minDist) * invRange
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const lo = ((t * LUT_SIZE) | 0) * 3
      // Canvas y=0 is the top (= maxLat), so flip row index
      const pixIdx = ((H - 1 - cy) * W + cx) * 4
      px[pixIdx]     = COLOR_LUT[lo]
      px[pixIdx + 1] = COLOR_LUT[lo + 1]
      px[pixIdx + 2] = COLOR_LUT[lo + 2]
      px[pixIdx + 3] = ALPHA
    }
  }

  ctx.putImageData(imageData, 0, 0)

  if (boundary) {
    // Clip to the boundary: keep pixels only where the polygon fill lands.
    // Same bbox→pixel transform as the grid; even-odd rule cuts holes.
    const path = new Path2D()
    const polys = boundary.type === 'Polygon' ? [boundary.coordinates] : boundary.coordinates
    for (const rings of polys) {
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const x = ((ring[i][0] - minLng) * M_PER_DEG_LNG) / CELL_M
          const y = H - ((ring[i][1] - minLat) * M_PER_DEG_LAT) / CELL_M
          if (i === 0) path.moveTo(x, y)
          else path.lineTo(x, y)
        }
        path.closePath()
      }
    }
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fill(path, 'evenodd')
    ctx.globalCompositeOperation = 'source-over'
  }

  return { dataUrl: ctx.canvas.toDataURL('image/png') }
}
