import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson'
import maplibregl, { Map as MlMap, Marker, Popup } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState } from 'react'
import type { CityBounds, CityDef } from '../cities'
import { DEFAULT_CITY } from '../cities'
import { computeDistanceField } from '../lib/distanceField'
import { formatDistance, haversineMetres } from '../lib/distance'
import type { Lang } from '../i18n'
import { t } from '../i18n'
import { STORE_TYPES, typeColor, typeLabel } from '../storeTypes'
import type { StoreCollection, UserLocation } from '../types'

interface Props {
  city: CityDef
  stores: StoreCollection | null
  user: UserLocation | null
  lang: Lang
  heatOpacity: number
  /** Ramp: cells at/below this distance (m) are full red */
  minDistance: number
  /** Ramp: cells at/beyond this distance (m) are full blue */
  maxDistance: number
  /** City admin boundary clipping the overlay: undefined = still loading,
   *  null = unavailable (render unclipped) */
  boundary: Polygon | MultiPolygon | null | undefined
  focusedStoreId: string | null
  onFocusHandled: () => void
}

const lngLatBounds = (b: CityBounds): [[number, number], [number, number]] => [
  [b.minLng, b.minLat],
  [b.maxLng, b.maxLat],
]

// Four bbox corners for the raster image source (NW, NE, SE, SW)
const imageCoords = (
  b: CityBounds,
): [[number, number], [number, number], [number, number], [number, number]] => [
  [b.minLng, b.maxLat],
  [b.maxLng, b.maxLat],
  [b.maxLng, b.minLat],
  [b.minLng, b.minLat],
]

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

// Built fresh per Map instance: MapLibre mutates the style object it is
// given, so sharing one constant breaks the second mount under StrictMode.
const makeMapStyle = (): maplibregl.StyleSpecification => ({
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      // OSM tiles only go to z19; cap so MapLibre overzooms instead of
      // requesting 404 tiles at higher zoom.
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
})

const typeColorExpression = [
  'match',
  ['get', 'shop'],
  ...STORE_TYPES.flatMap((t) => [t.tag, t.color]),
  '#7f8c8d',
] as unknown as maplibregl.ExpressionSpecification

function popupHtml(name: string | null, shop: string, distance: number | null, lang: Lang): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const label = typeLabel(shop, lang)
  const title = name ?? t(lang, 'unnamed', { type: label.toLowerCase() })
  return `
    <div class="store-popup">
      <strong>${esc(title)}</strong>
      <div><span class="type-badge" style="background:${typeColor(shop)}">${esc(label)}</span></div>
      ${distance != null ? `<div class="popup-distance">${esc(t(lang, 'fromYourAddress', { d: formatDistance(distance, lang) }))}</div>` : ''}
    </div>`
}

// Placeholder 1×1 transparent PNG so the image source always has something
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export default function MapView({
  city,
  stores,
  user,
  lang,
  heatOpacity,
  minDistance,
  maxDistance,
  boundary,
  focusedStoreId,
  onFocusHandled,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const userMarkerRef = useRef<Marker | null>(null)
  const userRef = useRef<UserLocation | null>(null)
  const langRef = useRef<Lang>(lang)
  const popupRef = useRef<Popup | null>(null)
  const [mapReady, setMapReady] = useState(false)
  userRef.current = user
  // Read by the click handler bound once at map load, so popups follow the
  // current language without rebinding the listener.
  langRef.current = lang

  // Open a single popup at a time — replacing any previous one — so clicks and
  // results-panel selections don't accumulate stacked popups.
  const showPopup = (map: MlMap, lng: number, lat: number, html: string) => {
    popupRef.current?.remove()
    popupRef.current = new Popup({ offset: 10 }).setLngLat([lng, lat]).setHTML(html).addTo(map)
  }

  // Initialise the map once
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: makeMapStyle(),
      // The city-framing effect below applies the real per-city camera and
      // navigation clip once the map is ready
      bounds: lngLatBounds(DEFAULT_CITY.bounds),
      fitBoundsOptions: { padding: 20 },
      // OSM raster tiles don't carry useful Expires headers; skip the periodic
      // re-fetch/re-decode of already-loaded tiles.
      refreshExpiredTiles: false,
    })
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right')
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__map = map

    map.on('load', () => {
      // Distance-field raster (always visible, updated on filter/ramp change)
      map.addSource('distance-field', {
        type: 'image',
        url: BLANK_PNG,
        coordinates: imageCoords(DEFAULT_CITY.bounds),
      })
      map.addLayer({
        id: 'distance-field-layer',
        type: 'raster',
        source: 'distance-field',
        paint: { 'raster-opacity': 0.7 },
      })

      // Thin outline so the overlay's clip edge reads as intentional
      map.addSource('boundary', { type: 'geojson', data: EMPTY_FC })
      map.addLayer({
        id: 'boundary-line',
        type: 'line',
        source: 'boundary',
        paint: { 'line-color': '#1a1a2e', 'line-width': 1.5, 'line-opacity': 0.5 },
      })

      map.addSource('stores', {
        type: 'geojson',
        data: EMPTY_FC,
        promoteId: 'id',
      })
      map.addLayer({
        id: 'store-points',
        type: 'circle',
        source: 'stores',
        paint: {
          'circle-color': typeColorExpression,
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            11, 2,
            14, 5,
            16, 7,
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
      })

      map.on('click', 'store-points', (e) => {
        const feature = e.features?.[0]
        if (!feature) return
        const [lng, lat] = (feature.geometry as Point).coordinates
        const u = userRef.current
        const distance = u ? haversineMetres(u.lng, u.lat, lng, lat) : null
        showPopup(map, lng, lat, popupHtml(feature.properties.name ?? null, feature.properties.shop, distance, langRef.current))
      })

      map.on('mouseenter', 'store-points', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'store-points', () => (map.getCanvas().style.cursor = ''))

      setMapReady(true)
    })

    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // City framing + navigation clip: contain-fit the whole city, lock max
  // zoom-out to exactly that view (minZoom = fitted zoom), and use the
  // fitted viewport itself as maxBounds — at min zoom the viewport equals
  // maxBounds, so panning is clamped on both axes; zoomed in, the user can
  // pan anywhere within that min-zoom view but never beyond it. The framing
  // depends on viewport aspect, so it is re-applied on map resize too.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const applyFraming = () => {
      // Lift the previous clip so the new fit isn't fought by it
      map.setMaxBounds(null)
      map.setMinZoom(null)
      const camera = map.cameraForBounds(lngLatBounds(city.bounds), { padding: 20 })
      if (!camera) return
      map.jumpTo(camera)
      // small epsilon keeps the fitted zoom itself reachable
      map.setMinZoom((camera.zoom ?? 0) - 0.1)
      map.setMaxBounds(map.getBounds())
    }

    applyFraming()

    let timer: number | undefined
    const onResize = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(applyFraming, 150)
    }
    map.on('resize', onResize)
    return () => {
      window.clearTimeout(timer)
      map.off('resize', onResize)
    }
  }, [city, mapReady])

  // Keep store markers in sync with the (filtered) store list
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource('stores') as maplibregl.GeoJSONSource | undefined
    source?.setData((stores ?? EMPTY_FC) as FeatureCollection)
  }, [stores, mapReady])

  // Recompute the distance-field overlay when filters or ramp bounds change.
  // Only ramp-slider drags are debounced (they fire continuously and now only
  // trigger a cheap recolor of the cached grid); city/filter/boundary changes
  // apply immediately. Waits for the boundary fetch to settle (undefined) so
  // the first render is already clipped; null = fetch failed, render unclipped.
  const overlayDepsRef = useRef<{ stores: unknown; city: unknown; boundary: unknown }>({
    stores: undefined,
    city: undefined,
    boundary: undefined,
  })
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || boundary === undefined) return

    const prev = overlayDepsRef.current
    const onlyRamp = prev.stores === stores && prev.city === city && prev.boundary === boundary
    overlayDepsRef.current = { stores, city, boundary }

    const render = () => {
      const source = map.getSource('distance-field') as maplibregl.ImageSource | undefined
      if (!source) return
      const coordinates = imageCoords(city.bounds)
      if (!stores || stores.features.length === 0) {
        source.updateImage({ url: BLANK_PNG, coordinates })
        return
      }
      const { dataUrl } = computeDistanceField(stores, city.bounds, minDistance, maxDistance, boundary)
      source.updateImage({ url: dataUrl, coordinates })
    }

    if (onlyRamp) {
      const timer = window.setTimeout(render, 250)
      return () => window.clearTimeout(timer)
    }
    render()
  }, [stores, city, minDistance, maxDistance, boundary, mapReady])

  // Boundary outline
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource('boundary') as maplibregl.GeoJSONSource | undefined
    if (!source) return
    const data: Feature | FeatureCollection = boundary
      ? { type: 'Feature', properties: {}, geometry: boundary }
      : EMPTY_FC
    source.setData(data)
  }, [boundary, mapReady])

  // User pin + camera. On a genuine address clear (prev user → null) reset to
  // the city view; on a city switch the framing effect already reframes, so
  // skip the redundant fitBounds when there was no user to begin with.
  const prevUserRef = useRef<UserLocation | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    userMarkerRef.current?.remove()
    userMarkerRef.current = null
    if (user) {
      userMarkerRef.current = new Marker({ color: '#1a1a2e', scale: 1.1 })
        .setLngLat([user.lng, user.lat])
        .addTo(map)
      map.flyTo({ center: [user.lng, user.lat], zoom: 14 })
    } else if (prevUserRef.current) {
      map.fitBounds(lngLatBounds(city.bounds), { padding: 20 })
    }
    prevUserRef.current = user
  }, [user, city, mapReady])

  // Distance-field opacity slider
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !map.getLayer('distance-field-layer')) return
    map.setPaintProperty('distance-field-layer', 'raster-opacity', heatOpacity)
  }, [heatOpacity, mapReady])

  // Pan to a store selected from the results list and open its popup
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !focusedStoreId || !stores) return
    const feature = stores.features.find((f) => f.properties.id === focusedStoreId)
    if (feature) {
      const [lng, lat] = feature.geometry.coordinates
      const u = userRef.current
      const distance = u ? haversineMetres(u.lng, u.lat, lng, lat) : null
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16) })
      showPopup(map, lng, lat, popupHtml(feature.properties.name, feature.properties.shop, distance, langRef.current))
    }
    onFocusHandled()
  }, [focusedStoreId, stores, mapReady, onFocusHandled])

  return <div ref={containerRef} className="map-container" />
}
