import type { MultiPolygon, Polygon } from 'geojson'
import type { CityBounds } from '../cities'
import type { StoreCollection } from '../types'
import { HEAT_CUTOFF_M, HEAT_MIN_M } from '../types'

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

// Colour ramp: equally-spaced RGB stops from full red (≤ minDist) to full
// blue (≥ maxDist); intermediate stops scale proportionally between the two.
const RAMP_COLORS: Array<[number, number, number]> = [
  [220,  20,  20], // red
  [230, 110,  20], // orange
  [230, 220,  20], // yellow
  [ 80, 200,  50], // green
  [ 20, 210, 200], // cyan
  [ 20,  60, 220], // blue
]
const ALPHA = Math.round(0.45 * 255)

function distanceToColor(d: number, minDist: number, maxDist: number): [number, number, number] {
  const t = Math.min(Math.max((d - minDist) / (maxDist - minDist), 0), 1)
  const pos = t * (RAMP_COLORS.length - 1)
  const i = Math.min(Math.floor(pos), RAMP_COLORS.length - 2)
  const f = pos - i
  const lo = RAMP_COLORS[i], hi = RAMP_COLORS[i + 1]
  return [
    Math.round(lo[0] + f * (hi[0] - lo[0])),
    Math.round(lo[1] + f * (hi[1] - lo[1])),
    Math.round(lo[2] + f * (hi[2] - lo[2])),
  ]
}

export interface DistanceFieldResult {
  dataUrl: string
  widthCells: number
  heightCells: number
  cellSizeM: number
}

/** Bucket size for the spatial index.  Must be ≥ the cell size; 500 m gives
 *  ~1 ring of buckets to search when the nearest store is within 500 m. */
const BUCKET_M = 500

/**
 * Compute a distance-to-nearest-store raster for a city bbox.
 *
 * Algorithm: stores are bucketed into a coarse grid (BUCKET_M × BUCKET_M).
 * For every output cell we search outward ring-by-ring from the cell's home
 * bucket, stopping as soon as the ring's minimum possible distance to any
 * store in that ring exceeds the best distance found so far.  This reduces
 * the inner loop from O(all stores) to O(~10–50) for typical urban density.
 * Distances use an equirectangular approximation scaled at the bbox's
 * mid-latitude.
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
  const { minLat, maxLat, minLng, maxLng } = bounds
  const latRef = (minLat + maxLat) / 2
  const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((latRef * Math.PI) / 180)

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

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const imageData = ctx.createImageData(W, H)
  const px = imageData.data

  const maxRing = Math.max(bCols, bRows) + 1

  for (let cy = 0; cy < H; cy++) {
    const latM = (cy + 0.5) * CELL_M
    const byCentre = Math.min(Math.floor(latM / BUCKET_M), bRows - 1)

    for (let cx = 0; cx < W; cx++) {
      const lngM = (cx + 0.5) * CELL_M
      const bxCentre = Math.min(Math.floor(lngM / BUCKET_M), bCols - 1)

      let bestDist2 = Infinity

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
            // Skip interior cells of this ring — only border
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

      const dist = Math.sqrt(bestDist2)
      const [r, g, b] = distanceToColor(dist, minDist, maxDist)
      // Canvas y=0 is the top (= maxLat), so flip row index
      const pixIdx = ((H - 1 - cy) * W + cx) * 4
      px[pixIdx]     = r
      px[pixIdx + 1] = g
      px[pixIdx + 2] = b
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

  return {
    dataUrl: canvas.toDataURL('image/png'),
    widthCells: W,
    heightCells: H,
    cellSizeM: CELL_M,
  }
}
