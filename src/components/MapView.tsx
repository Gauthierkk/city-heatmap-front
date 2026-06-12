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
import type { StoreCollection, Theme, UserLocation } from '../types'

interface Props {
  city: CityDef
  stores: StoreCollection | null
  user: UserLocation | null
  lang: Lang
  theme: Theme
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

// OpenFreeMap vector basemaps (no API key): Fiord (dark navy) and Liberty
// (light). URL strings are not subject to MapLibre's style-object mutation
// gotcha (the old makeMapStyle() workaround is no longer needed).
// Attribution: both styles' sources carry OSM attribution; an explicit
// customAttribution on the map credits OpenFreeMap on top.
const BASEMAP_URLS: Record<Theme, string> = {
  dark: 'https://tiles.openfreemap.org/styles/fiord',
  light: 'https://tiles.openfreemap.org/styles/liberty',
}

// Boundary outline must read against each basemap: pale lavender on Fiord's
// dark navy; the original dark navy line on Liberty's light ground.
const BOUNDARY_LINE: Record<Theme, { color: string; opacity: number }> = {
  dark: { color: '#8888bb', opacity: 0.7 },
  light: { color: '#1a1a2e', opacity: 0.5 },
}

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

// (Re-)add the app's sources + layers. Called on the initial `load` AND after
// every theme switch: setStyle() wipes all custom sources/layers, so the
// style.load handler re-runs this against the fresh style. Guarded against
// double-adds (style.load can coincide with the initial load).
// The distance-field raster and boundary line are inserted below the
// basemap's first symbol layer — resolved per style, since Liberty's first
// symbol layer differs from Fiord's — so street/place labels stay readable
// above the heatmap. Store dots are added last (topmost, above labels).
// Sources start empty/blank; the data effects (keyed on styleEpoch) re-push
// the current overlay PNG, boundary and store data right after.
function addCustomLayers(map: MlMap, theme: Theme) {
  if (map.getSource('distance-field')) return
  const firstSymbolId = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
  const boundaryLine = BOUNDARY_LINE[theme]

  map.addSource('distance-field', {
    type: 'image',
    url: BLANK_PNG,
    coordinates: imageCoords(DEFAULT_CITY.bounds),
  })
  map.addLayer(
    {
      id: 'distance-field-layer',
      type: 'raster',
      source: 'distance-field',
      // Initial value only; the opacity effect re-applies the slider value.
      paint: { 'raster-opacity': 0.65 },
    },
    firstSymbolId,
  )

  // Thin outline so the overlay's clip edge reads as intentional
  map.addSource('boundary', { type: 'geojson', data: EMPTY_FC })
  map.addLayer(
    {
      id: 'boundary-line',
      type: 'line',
      source: 'boundary',
      paint: {
        'line-color': boundaryLine.color,
        'line-width': 1.5,
        'line-opacity': boundaryLine.opacity,
      },
    },
    firstSymbolId,
  )

  map.addSource('stores', {
    type: 'geojson',
    data: EMPTY_FC,
    promoteId: 'id',
  })
  // No beforeId: dots render above everything, labels included. They are
  // small and popup-labelled, so sitting above text is acceptable and keeps
  // them visible on both basemaps (white stroke works on dark and light).
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
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  })
}

export default function MapView({
  city,
  stores,
  user,
  lang,
  theme,
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
  const themeRef = useRef<Theme>(theme)
  const popupRef = useRef<Popup | null>(null)
  const [mapReady, setMapReady] = useState(false)
  // Bumped after every style (re)load once the custom layers are back; the
  // data effects below depend on it so they re-push the current store data,
  // boundary, overlay PNG and opacity into the freshly re-added sources.
  // 0 = not ready yet.
  const [styleEpoch, setStyleEpoch] = useState(0)
  userRef.current = user
  // Read by the click handler bound once at map load, so popups follow the
  // current language without rebinding the listener.
  langRef.current = lang
  themeRef.current = theme

  // Open a single popup at a time — replacing any previous one — so clicks and
  // results-panel selections don't accumulate stacked popups.
  const showPopup = (map: MlMap, lng: number, lat: number, html: string) => {
    popupRef.current?.remove()
    popupRef.current = new Popup({ offset: 10 }).setLngLat([lng, lat]).setHTML(html).addTo(map)
  }

  // Initialise the map once (initial theme via ref; theme switches are
  // handled by the setStyle effect below, never by re-creating the map)
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_URLS[themeRef.current],
      // The city-framing effect below applies the real per-city camera and
      // navigation clip once the map is ready
      bounds: lngLatBounds(DEFAULT_CITY.bounds),
      fitBoundsOptions: { padding: 20 },
      attributionControl: {
        // Both OpenFreeMap styles carry OSM attribution in their sources; we
        // add OpenFreeMap explicitly to satisfy both license requirements.
        customAttribution: '© <a href="https://openfreemap.org">OpenFreeMap</a>',
      },
    })
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right')
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__map = map

    map.on('load', () => {
      addCustomLayers(map, themeRef.current)

      // Layer-delegated handlers, bound once: MapLibre keys them by layer id
      // and re-matches at event time, so they keep working after setStyle()
      // re-adds the store-points layer on a theme switch.
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
      setStyleEpoch((e) => e + 1)
    })

    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
      setStyleEpoch(0)
    }
  }, [])

  // Theme switch: setStyle() replaces the whole style and WIPES our custom
  // sources/layers, so re-add them once the new style is in and bump
  // styleEpoch to re-push the data. Camera constraints (minZoom/maxBounds)
  // are map-level and survive; the user marker and popups are DOM overlays
  // and survive too.
  const appliedThemeRef = useRef<Theme>(theme)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (appliedThemeRef.current === theme) return
    appliedThemeRef.current = theme
    map.setStyle(BASEMAP_URLS[theme])
    map.once('style.load', () => {
      addCustomLayers(map, theme)
      setStyleEpoch((e) => e + 1)
    })
  }, [theme, mapReady])

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

  // Keep store markers in sync with the (filtered) store list.
  // styleEpoch (not mapReady) so the data is re-pushed after a theme switch.
  useEffect(() => {
    const map = mapRef.current
    if (!map || styleEpoch === 0) return
    const source = map.getSource('stores') as maplibregl.GeoJSONSource | undefined
    source?.setData((stores ?? EMPTY_FC) as FeatureCollection)
  }, [stores, styleEpoch])

  // Recompute the distance-field overlay when filters or ramp bounds change.
  // Only ramp-slider drags are debounced (they fire continuously and now only
  // trigger a cheap recolor of the cached grid); city/filter/boundary changes
  // apply immediately. Waits for the boundary fetch to settle (undefined) so
  // the first render is already clipped; null = fetch failed, render unclipped.
  const overlayDepsRef = useRef<{
    stores: unknown
    city: unknown
    boundary: unknown
    epoch: number
  }>({ stores: undefined, city: undefined, boundary: undefined, epoch: 0 })
  useEffect(() => {
    const map = mapRef.current
    if (!map || styleEpoch === 0 || boundary === undefined) return

    const prev = overlayDepsRef.current
    // A styleEpoch bump (theme switch) must render immediately — the re-added
    // source holds BLANK_PNG — so it is never treated as a ramp-only change.
    const onlyRamp =
      prev.stores === stores &&
      prev.city === city &&
      prev.boundary === boundary &&
      prev.epoch === styleEpoch
    overlayDepsRef.current = { stores, city, boundary, epoch: styleEpoch }

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
  }, [stores, city, minDistance, maxDistance, boundary, styleEpoch])

  // Boundary outline
  useEffect(() => {
    const map = mapRef.current
    if (!map || styleEpoch === 0) return
    const source = map.getSource('boundary') as maplibregl.GeoJSONSource | undefined
    if (!source) return
    const data: Feature | FeatureCollection = boundary
      ? { type: 'Feature', properties: {}, geometry: boundary }
      : EMPTY_FC
    source.setData(data)
  }, [boundary, styleEpoch])

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
      // Warm orange (was #1a1a2e dark navy, invisible on Fiord) — reads on
      // both the dark Fiord and light Liberty basemaps, so not theme-keyed.
      userMarkerRef.current = new Marker({ color: '#e06020', scale: 1.1 })
        .setLngLat([user.lng, user.lat])
        .addTo(map)
      map.flyTo({ center: [user.lng, user.lat], zoom: 14 })
    } else if (prevUserRef.current) {
      map.fitBounds(lngLatBounds(city.bounds), { padding: 20 })
    }
    prevUserRef.current = user
  }, [user, city, mapReady])

  // Distance-field opacity slider (re-applied after theme switches too,
  // since the re-added layer starts at the hardcoded initial opacity)
  useEffect(() => {
    const map = mapRef.current
    if (!map || styleEpoch === 0 || !map.getLayer('distance-field-layer')) return
    map.setPaintProperty('distance-field-layer', 'raster-opacity', heatOpacity)
  }, [heatOpacity, styleEpoch])

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
