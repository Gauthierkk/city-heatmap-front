import type { MultiPoint, MultiPolygon, Polygon } from 'geojson'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CITIES, DEFAULT_CITY, cityById } from './cities'
import AddressSearch from './components/AddressSearch'
import FilterBar from './components/FilterBar'
import MapView from './components/MapView'
import ResultsPanel from './components/ResultsPanel'
import { type Lang, detectLang, locale, t, titleSegments } from './i18n'
import { haversineMetres } from './lib/distance'
import {
  CATEGORIES,
  DEFAULT_CATEGORY,
  categoryById,
  tagsForCategory,
  typesForCategory,
  type CategoryId,
} from './storeTypes'
import type { RankedStore, StoreCollection, Theme, UserLocation } from './types'
import { HEAT_CUTOFF_M, HEAT_MIN_M, HEAT_RAMP_MAX_M } from './types'

/** OS-derived default basemap theme; read once at startup, not live-tracked. */
function detectTheme(): Theme {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

// True when two tag sets are equal — lets us no-op identical filter updates
// (e.g. "Select all" when everything is already active) so the memoised
// filtered collection and the distance-field overlay don't needlessly recompute.
function sameTagSet(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const tag of a) if (!b.has(tag)) return false
  return true
}

// Accepts a bare geometry, Feature, or FeatureCollection boundary file
function extractBoundary(data: unknown): Polygon | MultiPolygon | null {
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

// Tree files are a bare MultiPoint geometry, but accept a Feature/FeatureCollection
// wrapper too so the worker is free to bake either shape.
function extractMultiPoint(data: unknown): MultiPoint | null {
  const obj = data as {
    type?: string
    geometry?: { type?: string }
    features?: Array<{ geometry?: { type?: string } }>
  } | null
  const geom =
    obj?.type === 'Feature' ? obj.geometry :
    obj?.type === 'FeatureCollection' ? obj.features?.[0]?.geometry :
    obj
  return geom?.type === 'MultiPoint' ? (geom as MultiPoint) : null
}

export default function App() {
  const [cityId, setCityId] = useState(DEFAULT_CITY.id)
  const [categoryId, setCategoryId] = useState<CategoryId>(DEFAULT_CATEGORY.id)
  const [lang, setLang] = useState<Lang>(detectLang)
  // Like lang: seeded from the browser, never persisted, passed as a prop.
  const [theme, setTheme] = useState<Theme>(detectTheme)
  const [panelExpanded, setPanelExpanded] = useState(true)
  // Per-source-file caches: keyed by the GeoJSON path, fetched once per session.
  // Grocery and Specialty share the food file; Fitness has its own per-city file.
  // This data-loading boundary is slated to move into a dedicated worker later;
  // keep it self-contained so the swap stays local to these two effects.
  const [storesBySource, setStoresBySource] = useState<Record<string, StoreCollection>>({})
  const [boundaryByCity, setBoundaryByCity] = useState<
    Record<string, Polygon | MultiPolygon | null>
  >({})
  // Tree point cloud per city for density categories; null = unavailable.
  const [treesByCity, setTreesByCity] = useState<Record<string, MultiPoint | null>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [user, setUser] = useState<UserLocation | null>(null)
  const [activeTags, setActiveTags] = useState<Set<string>>(
    new Set(tagsForCategory(DEFAULT_CATEGORY.id)),
  )
  // Slightly reduced from 0.7 → 0.65 for Fiord dark basemap: overlay colours
  // are vivid enough at 0.65 and bleed less into the navy background.
  const [heatOpacity, setHeatOpacity] = useState(0.65)
  const [minDistance, setMinDistance] = useState(HEAT_MIN_M)
  const [maxDistance, setMaxDistance] = useState(HEAT_CUTOFF_M)
  // Tree heatmap spread, in ground metres (density categories). Each tree's
  // influence radius; rendered as true metres so it stays thin at city zoom
  // and sharpens as you zoom in.
  const [treeRadius, setTreeRadius] = useState(25)
  const [focusedStoreId, setFocusedStoreId] = useState<string | null>(null)

  // Reflect the UI language on <html lang> for a11y / correct hyphenation.
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const city = cityById(cityId)
  const category = categoryById(categoryId)
  const isDensity = category.kind === 'density'
  const categoryTypes = typesForCategory(categoryId)
  // Density categories (Trees) bypass the store pipeline entirely; their data
  // is a raw point cloud loaded into treesByCity, not a StoreCollection.
  const sourceFile = isDensity ? undefined : city.storesFiles[category.source]
  const stores = sourceFile ? storesBySource[sourceFile] ?? null : null
  // undefined = still loading, null = unavailable (overlay renders unclipped)
  const boundary = city.id in boundaryByCity ? boundaryByCity[city.id] : undefined
  // Tree point cloud for the active density category (null = none/loading)
  const treePoints = isDensity ? treesByCity[city.id] ?? null : null

  useEffect(() => {
    if (!sourceFile || storesBySource[sourceFile]) return
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}${sourceFile}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: StoreCollection) => {
        if (!cancelled) setStoresBySource((prev) => ({ ...prev, [sourceFile]: data }))
      })
      .catch((err) => {
        // Store the raw message; the localized prefix is applied at render time.
        if (!cancelled) setLoadError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [sourceFile, storesBySource])

  // Lazy-load the tree point cloud the first time a density category is shown
  // for a city that ships one. Mirrors the boundary fetch: cached per city,
  // fail-soft to null (the heatmap simply doesn't render).
  useEffect(() => {
    if (!isDensity || city.id in treesByCity) return
    const file = city.storesFiles[category.source]
    if (!file) return
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}${file}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setTreesByCity((prev) => ({ ...prev, [city.id]: extractMultiPoint(data) }))
      })
      .catch((err) => {
        if (!cancelled) {
          setTreesByCity((prev) => ({ ...prev, [city.id]: null }))
          setLoadError(err.message)
        }
      })
    return () => {
      cancelled = true
    }
  }, [isDensity, city, category.source, treesByCity])

  // City admin boundary for clipping the overlay; fail soft to unclipped
  useEffect(() => {
    if (city.id in boundaryByCity) return
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}${city.boundaryFile}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setBoundaryByCity((prev) => ({ ...prev, [city.id]: extractBoundary(data) }))
      })
      .catch(() => {
        if (!cancelled) setBoundaryByCity((prev) => ({ ...prev, [city.id]: null }))
      })
    return () => {
      cancelled = true
    }
  }, [city, boundaryByCity])

  function switchCity(id: string) {
    if (id === cityId) return
    setCityId(id)
    setUser(null)
    setFocusedStoreId(null)
    setLoadError(null)
    // A density category may not exist for the new city (e.g. Trees is
    // Paris-only) — fall back to the default category if so.
    if (!cityById(id).storesFiles[category.source]) {
      setCategoryId(DEFAULT_CATEGORY.id)
      setActiveTags(new Set(tagsForCategory(DEFAULT_CATEGORY.id)))
    }
  }

  function switchCategory(id: string) {
    if (id === categoryId) return
    setCategoryId(id as CategoryId)
    setActiveTags(new Set(tagsForCategory(id as CategoryId)))
    setFocusedStoreId(null)
    setLoadError(null)
    // user / address intentionally kept — results re-rank to the new category
  }

  // Stable identities so memoised panel children don't re-render on slider drags.
  const handleTagsChange = useCallback((next: Set<string>) => {
    setActiveTags((prev) => (sameTagSet(prev, next) ? prev : next))
  }, [])
  const clearUser = useCallback(() => setUser(null), [])
  const handleFocusHandled = useCallback(() => setFocusedStoreId(null), [])
  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  const filteredStores = useMemo(() => {
    if (!stores) return null
    return {
      ...stores,
      features: stores.features.filter((f) => activeTags.has(f.properties.shop)),
    }
  }, [stores, activeTags])

  // Count of features in the loaded file that belong to the active category —
  // used for the hint so Grocery doesn't show the full food-file count.
  const categoryTagSet = useMemo(() => new Set(tagsForCategory(categoryId)), [categoryId])
  const categoryTotal = useMemo(() => {
    if (!stores) return 0
    return stores.features.filter((f) => categoryTagSet.has(f.properties.shop)).length
  }, [stores, categoryTagSet])

  const ranked: RankedStore[] = useMemo(() => {
    if (!filteredStores || !user) return []
    return filteredStores.features
      .map((feature) => ({
        feature,
        distance: haversineMetres(
          user.lng,
          user.lat,
          feature.geometry.coordinates[0],
          feature.geometry.coordinates[1],
        ),
      }))
      .sort((a, b) => a.distance - b.distance)
  }, [filteredStores, user])

  return (
    <div className="app">
      <MapView
        city={city}
        stores={filteredStores}
        user={user}
        lang={lang}
        theme={theme}
        heatOpacity={heatOpacity}
        minDistance={minDistance}
        maxDistance={maxDistance}
        boundary={boundary}
        treePoints={treePoints}
        treeRadiusM={treeRadius}
        focusedStoreId={focusedStoreId}
        onFocusHandled={handleFocusHandled}
      />
      <div className="panel">
        <h1 className="panel-title">
          <div className="panel-title-buttons">
            <button
              className="lang-toggle-btn"
              onClick={() => setLang((l) => (l === 'en' ? 'fr' : 'en'))}
              aria-label={t(lang, 'switchLang')}
            >
              {lang === 'en' ? 'FR' : 'EN'}
            </button>
            <button
              className="lang-toggle-btn"
              onClick={toggleTheme}
              aria-label={t(lang, theme === 'dark' ? 'lightMode' : 'darkMode')}
              title={t(lang, theme === 'dark' ? 'lightMode' : 'darkMode')}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <button
              className="panel-toggle-btn"
              onClick={() => setPanelExpanded((v) => !v)}
              aria-label={panelExpanded ? t(lang, 'minimizePanel') : t(lang, 'expandPanel')}
              aria-expanded={panelExpanded}
            >
              {panelExpanded ? '−' : '+'}
            </button>
          </div>
          <div className="panel-title-text">
            {/* The title template places two <select>s at {city} and {category}.
                English leads with city, French trails it. The hidden sizer span
                shrinks each select to its chosen label width exactly. */}
            {titleSegments(lang).map((seg, i) => {
              if (seg.kind === 'text') return <span key={i}>{seg.value}</span>
              if (seg.slot === 'city') {
                return (
                  <span key="city" className="city-select-wrap">
                    <select
                      className="city-select"
                      value={city.id}
                      aria-label={t(lang, 'cityAria')}
                      onChange={(e) => switchCity(e.target.value)}
                    >
                      {CITIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <span className="city-select-sizer" aria-hidden="true">
                      {city.label}
                    </span>
                  </span>
                )
              }
              // seg.slot === 'category'
              return (
                <span key="category" className="city-select-wrap">
                  <select
                    className="city-select"
                    value={category.id}
                    aria-label={t(lang, 'categoryAria')}
                    onChange={(e) => switchCategory(e.target.value)}
                  >
                    {CATEGORIES.filter((c) => city.storesFiles[c.source]).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label[lang]}
                      </option>
                    ))}
                  </select>
                  <span className="city-select-sizer" aria-hidden="true">
                    {category.label[lang]}
                  </span>
                </span>
              )
            })}
          </div>
        </h1>
        {panelExpanded && isDensity && (
          <>
            {city.staleData && (
              <p className="disclaimer">{t(lang, 'dataDisclaimer', { city: city.label })}</p>
            )}
            {loadError && <p className="error">{t(lang, 'loadError', { msg: loadError })}</p>}
            <p className="hint">{t(lang, 'treesHint', { city: city.label })}</p>
            <div className="heatmap-settings">
              <label className="opacity-control">
                {t(lang, 'treeRadius', { n: treeRadius })}
                <input
                  type="range"
                  min={10}
                  max={50}
                  step={5}
                  value={treeRadius}
                  onChange={(e) => setTreeRadius(Number(e.target.value))}
                />
              </label>
            </div>
          </>
        )}
        {panelExpanded && !isDensity && (
          <>
            <AddressSearch
              key={city.id}
              city={city}
              lang={lang}
              onSelect={setUser}
              onClear={clearUser}
            />
            {city.staleData && (
              <p className="disclaimer">{t(lang, 'dataDisclaimer', { city: city.label })}</p>
            )}
            {loadError && <p className="error">{t(lang, 'loadError', { msg: loadError })}</p>}
            <FilterBar types={categoryTypes} activeTags={activeTags} lang={lang} onChange={handleTagsChange} />
            <div className="heatmap-settings">
              <h2>{t(lang, 'heatmapSettings')}</h2>
              <label className="opacity-control">
                {t(lang, 'redWithin', { n: minDistance })}
                <input
                  type="range"
                  min={10}
                  max={50}
                  step={10}
                  value={minDistance}
                  onChange={(e) => setMinDistance(Number(e.target.value))}
                />
              </label>
              <label className="opacity-control">
                {t(lang, 'blueBeyond', { n: maxDistance })}
                <input
                  type="range"
                  min={100}
                  max={HEAT_RAMP_MAX_M}
                  step={50}
                  value={maxDistance}
                  onChange={(e) => setMaxDistance(Number(e.target.value))}
                />
              </label>
              <label className="opacity-control">
                {t(lang, 'opacity', { n: Math.round(heatOpacity * 100) })}
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(heatOpacity * 100)}
                  onChange={(e) => setHeatOpacity(Number(e.target.value) / 100)}
                />
              </label>
            </div>
            {user && <ResultsPanel ranked={ranked} lang={lang} onSelect={setFocusedStoreId} />}
            {!user && stores && (
              <p className="hint">
                {t(lang, 'hint', { n: categoryTotal.toLocaleString(locale(lang)) })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
