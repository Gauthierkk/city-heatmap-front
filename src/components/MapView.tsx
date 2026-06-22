import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson'
import maplibregl, { Map as MlMap, Marker, Popup } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState } from 'react'
import type { CityBounds, CityDef } from '../cities'
import { DEFAULT_CITY } from '../cities'
import { formatAddress } from '../lib/address'
import { computeDistanceField } from '../lib/distanceField'
import { formatDistance, haversineMetres } from '../lib/distance'
import { parseCategories, parseLines } from '../lib/geojson'
import { lineBulletSrc, lineLabel } from '../lib/transitLines'
import type { Lang } from '../i18n'
import { t } from '../i18n'
import { STORE_TYPES, typeColor, typeLabel } from '../storeTypes'
import type { StoreCollection, Theme, TransitLine, UserLocation } from '../types'

interface Props {
  city: CityDef
  stores: StoreCollection | null
  user: UserLocation | null
  lang: Lang
  theme: Theme
  heatOpacity: number
  /** Distance overlay on/off - hides the distance-field raster when false. */
  showHeatmap: boolean
  /** Ramp: cells at/below this distance (m) are full red */
  minDistance: number
  /** Ramp: cells at/beyond this distance (m) are full blue */
  maxDistance: number
  /** City admin boundary clipping the overlay: undefined = still loading,
   *  null = unavailable (render unclipped) */
  boundary: Polygon | MultiPolygon | null | undefined
  /** Transit only: rail-line route geometry (LineStrings coloured per line),
   *  drawn under the dots. null = not transit, or still loading. */
  transitLines: FeatureCollection | null
  /** Active density category's point cloud (Trees): a FeatureCollection of Point
   *  features (each with its species), rendered as a heatmap, no dots/labels.
   *  null = not a density category, or still loading. */
  treePoints: FeatureCollection<Point> | null
  /** Tree heatmap spread in ground metres (per-tree influence radius) */
  treeRadiusM: number
  /** Selected tree species (by English name) for the density heatmap; null =
   *  no filter (show every species). Applied as a MapLibre layer filter. */
  activeSpecies: string[] | null
  /** True for density categories (Trees): hides the places-only distance-field
   *  overlay so the surrounding basemap shows, matching the places pages. */
  isDensity: boolean
  /** Trees view: when true, draw a translucent green highlight over the
   *  park/garden polygons. Default off; only takes effect in density mode. */
  parkOverlay: boolean
  focusedStoreId: string | null
  onFocusHandled: () => void
}

const lngLatBounds = (b: CityBounds): [[number, number], [number, number]] => [
  [b.minLng, b.minLat],
  [b.maxLng, b.maxLat],
]

// Padding (px) used for every bbox fit - initial framing, re-fit on resize, and
// the reset-to-city fly when the address is cleared.
const FIT_OPTS = { padding: 20 }

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

// Park / garden name labels (Trees density view only). Green-tinted text per
// theme so it reads as "park" against each basemap, with a contrasting halo.
const TREE_PARK_LABEL: Record<Theme, { color: string; halo: string }> = {
  dark: { color: '#9ccc9c', halo: '#16241c' },
  light: { color: '#1b5e20', halo: 'rgba(255,255,255,0.9)' },
}

const typeColorExpression = [
  'match',
  ['get', 'shop'],
  ...STORE_TYPES.flatMap((t) => [t.tag, t.color]),
  '#7f8c8d',
] as unknown as maplibregl.ExpressionSpecification

// Transit station dots render white (transit features are the only ones with a
// `lines` property); every other category keeps its per-type colour. White dots
// get a dark stroke so they read on the light basemap too.
const circleColorExpression = [
  'case', ['has', 'lines'], '#ffffff', typeColorExpression,
] as unknown as maplibregl.ExpressionSpecification
const circleStrokeExpression = [
  'case', ['has', 'lines'], '#1a1a2e', '#ffffff',
] as unknown as maplibregl.ExpressionSpecification

// MapLibre's heatmap-radius is in screen pixels. To pin it to a fixed ground
// distance, anchor a base-2 exponential zoom interpolation: metres-per-pixel
// halves each zoom level, so a base-2 ramp keeps the radius a constant number
// of ground metres at every zoom (sub-pixel when zoomed out, growing as you
// zoom in). Scale is taken at the city-centre latitude (Web Mercator).
function metresRadiusExpression(
  metres: number,
  lat: number,
): maplibregl.ExpressionSpecification {
  const metresPerPixel = (zoom: number) =>
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
  return [
    'interpolate', ['exponential', 2], ['zoom'],
    0, metres / metresPerPixel(0),
    24, metres / metresPerPixel(24),
  ] as unknown as maplibregl.ExpressionSpecification
}

// HTML-escape user/data text before splicing it into a popup string.
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// One coloured type badge (escapes its own label).
const badge = (color: string, label: string) =>
  `<span class="type-badge" style="background:${color}">${escapeHtml(label)}</span>`

// Common popup shell: a bold title over a badge row, plus any extra rows.
const popupShell = (title: string, badges: string, extra = '') => `
    <div class="store-popup">
      <strong>${escapeHtml(title)}</strong>
      <div class="popup-badges">${badges}</div>
      ${extra}
    </div>`

// Transit line bullets (the HTML-string twin of the LineBullets component).
// Lines with no source pictogram fall back to a small text bullet.
function lineBulletsHtml(lines: TransitLine[], lang: Lang): string {
  return lines
    .map((l) => {
      const label = escapeHtml(lineLabel(l, lang))
      const src = lineBulletSrc(l.picto)
      return src
        ? `<img class="line-bullet" src="${src}" alt="${label}" title="${label}" />`
        : `<span class="line-bullet-text" title="${label}">${escapeHtml(l.line)}</span>`
    })
    .join('')
}

function popupHtml(
  name: string | null,
  shop: string,
  categories: unknown,
  lines: unknown,
  address: unknown,
  distance: number | null,
  lang: Lang,
): string {
  // Transit stations show their actual lines as official bullets; everything
  // else shows a badge per tag (transit hubs can carry several), falling back to
  // the single primary `shop`. Title uses the primary label.
  const lineList = parseLines(lines)
  const cats = parseCategories(categories)
  const tags = cats && cats.length ? cats : [shop]
  const badges =
    lineList && lineList.length
      ? lineBulletsHtml(lineList, lang)
      : tags.map((tag) => badge(typeColor(tag), typeLabel(tag, lang))).join(' ')
  const title = name ?? t(lang, 'unnamed', { type: typeLabel(shop, lang).toLowerCase() })
  const addr = formatAddress(address)
  const extra =
    (addr ? `<div class="popup-address">${escapeHtml(addr)}</div>` : '') +
    (distance != null
      ? `<div class="popup-distance">${escapeHtml(t(lang, 'fromYourAddress', { d: formatDistance(distance, lang) }))}</div>`
      : '')
  return popupShell(title, badges, extra)
}

// Tree species popup (density category): just the species name plus a small
// green "Tree" badge - trees carry no address or distance-to-you. Empty species
// (some trees have no recorded species) fall back to a localized label.
function treePopupHtml(species: string | null | undefined, lang: Lang): string {
  const name = species && species.trim() ? species : t(lang, 'unknownSpecies')
  return popupShell(name, badge('#2e8b57', t(lang, 'tree')))
}

// Placeholder 1×1 transparent PNG so the image source always has something
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// (Re-)add the app's sources + layers. Called on the initial `load` AND after
// every theme switch: setStyle() wipes all custom sources/layers, so the
// style.load handler re-runs this against the fresh style. Guarded against
// double-adds (style.load can coincide with the initial load).
// The distance-field raster and boundary line are inserted below the
// basemap's first symbol layer - resolved per style, since Liberty's first
// symbol layer differs from Fiord's - so street/place labels stay readable
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

  // Tree density heatmap (density categories). A FeatureCollection of Point
  // features, each contributing to the density; green ramp, no labels/dots.
  // Inserted below labels and starts hidden - the data effect toggles it.
  map.addSource('trees', { type: 'geojson', data: EMPTY_FC })
  map.addLayer(
    {
      id: 'trees-heat',
      type: 'heatmap',
      source: 'trees',
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': 1,
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 1.4],
        // Placeholder; the treeRadiusM effect replaces this with a metres ramp.
        'heatmap-radius': 4,
        'heatmap-opacity': 0.85,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0, 0, 0, 0)',
          0.2, 'rgba(199, 233, 180, 0.6)',
          0.4, 'rgba(120, 198, 121, 0.75)',
          0.6, 'rgba(65, 171, 93, 0.85)',
          0.8, 'rgba(35, 132, 67, 0.9)',
          1, 'rgba(0, 90, 50, 0.95)',
        ],
      },
    },
    firstSymbolId,
  )

  // Transparent hit-test layer for the heatmap: a heatmap can't be queried for
  // its source features, so this invisible circle layer (same `trees` source)
  // backs the species popup via the same layer-delegated click pattern as the
  // store dots. Generous radius so clicks land on a nearby tree. Toggled with
  // the heatmap and filtered alongside it.
  map.addLayer(
    {
      id: 'trees-hit',
      type: 'circle',
      source: 'trees',
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 6, 16, 12],
        'circle-color': '#000000',
        'circle-opacity': 0,
      },
    },
    firstSymbolId,
  )

  // Thin outline so the overlay's clip edge reads as
  // intentional - kept topmost of the below-label layers to cover the seam.
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

  // Transit-line route geometry (Transit view only). Coloured per line from the
  // baked `color` property; inserted below labels but above the distance-field /
  // heatmap so the lines read over the overlay, and below the dots. Starts empty;
  // the data effect pushes the geometry only on the Transit view.
  map.addSource('transit-lines', { type: 'geojson', data: EMPTY_FC })
  map.addLayer(
    {
      id: 'transit-lines-layer',
      type: 'line',
      source: 'transit-lines',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 13, 3, 16, 5],
        // Full opacity: the source splits each line into ~25–36 segments (454
        // shared joins), so a sub-1 opacity composites every joint + crossing
        // into a darker blotch. At opacity 1 overlapping same-colour strokes are
        // idempotent and crossings cover cleanly.
        'line-opacity': 1,
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
      'circle-color': circleColorExpression,
      // Major transit hubs (`major` flag) render at double radius; everything
      // else at the base size. The flag is a boolean baked on load.
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        11, ['case', ['==', ['get', 'major'], true], 4, 2],
        14, ['case', ['==', ['get', 'major'], true], 10, 5],
        16, ['case', ['==', ['get', 'major'], true], 14, 7],
      ],
      'circle-stroke-width': 2,
      'circle-stroke-color': circleStrokeExpression,
    },
  })

  // Optional park / garden green highlight (Trees view, off by default). Two
  // fill layers over the basemap's green polygons - the dedicated `park` layer
  // plus `landcover` grass/wood (Paris gardens like the Luxembourg are stored as
  // `grass`, the Bois as `wood`, not `park`). Translucent so streets/labels show
  // through. Inserted below `trees-heat` so tree density still reads on top.
  // Start hidden; the density-visibility effect shows them only when the
  // `parkOverlay` toggle is on.
  map.addLayer(
    {
      id: 'tree-park-overlay-land',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['match', ['get', 'class'], ['grass', 'wood'], true, false],
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#2e8b57', 'fill-opacity': 0.4 },
    },
    'trees-heat',
  )
  map.addLayer(
    {
      id: 'tree-park-overlay-park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#2e8b57', 'fill-opacity': 0.4 },
    },
    'trees-heat',
  )

  // Park / garden name labels (Trees density view only). The basemap park/garden
  // polygons carry no names - those names live in the `poi` source-layer as
  // points - and the dark Fiord style ships no POI labels at all. So this
  // text-only layer surfaces them: filtered to the park/garden POI classes,
  // collision-thinned (lowest `rank` wins, so the big parks label first and more
  // appear as you zoom). Added last so it yields to the basemap's own labels.
  // Starts hidden; the density-visibility effect shows it only on the Trees view.
  const parkLabel = TREE_PARK_LABEL[theme]
  map.addLayer({
    id: 'tree-park-labels',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'poi',
    filter: [
      'all',
      ['match', ['get', 'class'], ['park', 'garden'], true, false],
      ['has', 'name'],
    ],
    layout: {
      visibility: 'none',
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 13],
      'text-max-width': 7,
      // Lower OSM rank = more prominent; place those first so they win collision.
      'symbol-sort-key': ['to-number', ['get', 'rank'], 99],
    },
    paint: {
      'text-color': parkLabel.color,
      'text-halo-color': parkLabel.halo,
      'text-halo-width': 1.2,
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
  showHeatmap,
  minDistance,
  maxDistance,
  boundary,
  transitLines,
  treePoints,
  treeRadiusM,
  activeSpecies,
  isDensity,
  parkOverlay,
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

  // Open a single popup at a time - replacing any previous one - so clicks and
  // results-panel selections don't accumulate stacked popups.
  const showPopup = (map: MlMap, lng: number, lat: number, html: string) => {
    popupRef.current?.remove()
    popupRef.current = new Popup({ offset: 10 }).setLngLat([lng, lat]).setHTML(html).addTo(map)
  }

  // Render a store popup at the feature's coordinate, computing distance from the
  // current user location. Shared by the map-click handler and the results-panel
  // focus effect (both read the live user/lang via refs).
  const openStorePopup = (
    map: MlMap,
    lng: number,
    lat: number,
    props: { name?: string | null; shop: string; categories?: unknown; lines?: unknown; address?: unknown },
  ) => {
    const u = userRef.current
    const distance = u ? haversineMetres(u.lng, u.lat, lng, lat) : null
    showPopup(
      map,
      lng,
      lat,
      popupHtml(props.name ?? null, props.shop, props.categories, props.lines, props.address, distance, langRef.current),
    )
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
      fitBoundsOptions: FIT_OPTS,
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
        openStorePopup(map, lng, lat, feature.properties as Parameters<typeof openStorePopup>[3])
      })

      map.on('mouseenter', 'store-points', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'store-points', () => (map.getCanvas().style.cursor = ''))

      // Tree heatmap: pick the tree nearest the click among the features under
      // the cursor and show its species in the active language.
      map.on('click', 'trees-hit', (e) => {
        const features = e.features
        if (!features?.length) return
        const { lng, lat } = e.lngLat
        let nearest = features[0]
        let best = Infinity
        for (const f of features) {
          const [flng, flat] = (f.geometry as Point).coordinates
          const d = haversineMetres(lng, lat, flng, flat)
          if (d < best) {
            best = d
            nearest = f
          }
        }
        const [plng, plat] = (nearest.geometry as Point).coordinates
        const props = nearest.properties ?? {}
        const species = langRef.current === 'fr' ? props.species_fr : props.species_en
        showPopup(map, plng, plat, treePopupHtml(species, langRef.current))
      })

      map.on('mouseenter', 'trees-hit', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'trees-hit', () => (map.getCanvas().style.cursor = ''))

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
  // fitted viewport itself as maxBounds - at min zoom the viewport equals
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
      const camera = map.cameraForBounds(lngLatBounds(city.bounds), FIT_OPTS)
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

  // Transit-line geometry: push it on the Transit view; null (any other view)
  // clears the source so the coloured lines disappear.
  useEffect(() => {
    const map = mapRef.current
    if (!map || styleEpoch === 0) return
    const source = map.getSource('transit-lines') as maplibregl.GeoJSONSource | undefined
    source?.setData((transitLines ?? EMPTY_FC) as FeatureCollection)
  }, [transitLines, styleEpoch])

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
    // Skip the (expensive) field compute while the heatmap is toggled off; it
    // recomputes when the toggle flips back on (showHeatmap is a dep).
    if (!map || styleEpoch === 0 || boundary === undefined || !showHeatmap) return

    const prev = overlayDepsRef.current
    // A styleEpoch bump (theme switch) must render immediately - the re-added
    // source holds BLANK_PNG - so it is never treated as a ramp-only change.
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
  }, [stores, city, minDistance, maxDistance, boundary, showHeatmap, styleEpoch])

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

  // Tree density heatmap: push the point cloud and show the layer only when a
  // density category is active (treePoints set). null clears + hides it, which
  // is also how 'places' categories leave the map free of the heatmap.
  useEffect(() => {
    const map = mapRef.current
    if (!map || styleEpoch === 0) return
    const source = map.getSource('trees') as maplibregl.GeoJSONSource | undefined
    if (!source) return
    // treePoints is already a FeatureCollection of Points - a heatmap source
    // reads it directly (each feature contributes one point to the density).
    source.setData(treePoints ?? EMPTY_FC)
    const visibility = treePoints ? 'visible' : 'none'
    if (map.getLayer('trees-heat')) map.setLayoutProperty('trees-heat', 'visibility', visibility)
    // The hit-test layer follows the heatmap so clicks only land on shown trees.
    if (map.getLayer('trees-hit')) map.setLayoutProperty('trees-hit', 'visibility', visibility)
  }, [treePoints, styleEpoch])

  // Species filter: drive the heatmap (and its hit layer) with a MapLibre layer
  // filter rather than re-uploading the point cloud. null = no filter; an empty
  // array selects nothing (heatmap clears). Keyed on the species array's
  // identity, which App only recreates when the selection actually changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || styleEpoch === 0) return
    const filter = (
      activeSpecies
        ? ['in', ['get', 'species_en'], ['literal', activeSpecies]]
        : null
    ) as maplibregl.FilterSpecification | null
    if (map.getLayer('trees-heat')) map.setFilter('trees-heat', filter)
    if (map.getLayer('trees-hit')) map.setFilter('trees-hit', filter)
  }, [activeSpecies, styleEpoch])

  // Density-mode layer visibility. The distance field is a places-only proximity
  // overlay (on a density page there are no stores, so it would render a solid
  // blue raster) - hide it in density mode so the basemap shows through. The
  // park/garden name labels are the inverse: shown only on the Trees view. Keyed
  // on styleEpoch so both re-apply after a theme switch re-adds the layers at
  // their default visibility.
  useEffect(() => {
    const map = mapRef.current
    if (!map || styleEpoch === 0) return
    // Distance field shows only on a places view AND when the heatmap toggle is on.
    if (map.getLayer('distance-field-layer'))
      map.setLayoutProperty('distance-field-layer', 'visibility', !isDensity && showHeatmap ? 'visible' : 'none')
    if (map.getLayer('tree-park-labels'))
      map.setLayoutProperty('tree-park-labels', 'visibility', isDensity ? 'visible' : 'none')
    // Park/garden green highlight: only on the Trees view AND when toggled on.
    const overlayVis = isDensity && parkOverlay ? 'visible' : 'none'
    for (const id of ['tree-park-overlay-land', 'tree-park-overlay-park'])
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', overlayVis)
  }, [isDensity, parkOverlay, showHeatmap, styleEpoch])

  // Tree heatmap spread: convert the metres slider to a ground-metres radius
  // ramp at the city-centre latitude (sub-pixel at city zoom, sharpens as you
  // zoom in). Cheap GPU paint update - no debounce.
  useEffect(() => {
    const map = mapRef.current
    if (!map || styleEpoch === 0 || !map.getLayer('trees-heat')) return
    const lat = (city.bounds.minLat + city.bounds.maxLat) / 2
    map.setPaintProperty('trees-heat', 'heatmap-radius', metresRadiusExpression(treeRadiusM, lat))
  }, [treeRadiusM, city, styleEpoch])

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
      // Warm orange (was #1a1a2e dark navy, invisible on Fiord) - reads on
      // both the dark Fiord and light Liberty basemaps, so not theme-keyed.
      userMarkerRef.current = new Marker({ color: '#e06020', scale: 1.1 })
        .setLngLat([user.lng, user.lat])
        .addTo(map)
      map.flyTo({ center: [user.lng, user.lat], zoom: 14 })
    } else if (prevUserRef.current) {
      map.fitBounds(lngLatBounds(city.bounds), FIT_OPTS)
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
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16) })
      openStorePopup(map, lng, lat, feature.properties)
    }
    onFocusHandled()
  }, [focusedStoreId, stores, mapReady, onFocusHandled])

  return <div ref={containerRef} className="map-container" />
}
