import type { MultiPolygon, Polygon } from 'geojson'
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
import type { RankedStore, StoreCollection, UserLocation } from './types'
import { HEAT_CUTOFF_M, HEAT_MIN_M, HEAT_RAMP_MAX_M } from './types'

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

export default function App() {
  const [cityId, setCityId] = useState(DEFAULT_CITY.id)
  const [categoryId, setCategoryId] = useState<CategoryId>(DEFAULT_CATEGORY.id)
  const [lang, setLang] = useState<Lang>(detectLang)
  const [panelExpanded, setPanelExpanded] = useState(true)
  // Per-source-file caches: keyed by the GeoJSON path, fetched once per session.
  // Grocery and Specialty share the food file; Fitness has its own per-city file.
  // This data-loading boundary is slated to move into a dedicated worker later;
  // keep it self-contained so the swap stays local to these two effects.
  const [storesBySource, setStoresBySource] = useState<Record<string, StoreCollection>>({})
  const [boundaryByCity, setBoundaryByCity] = useState<
    Record<string, Polygon | MultiPolygon | null>
  >({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [user, setUser] = useState<UserLocation | null>(null)
  const [activeTags, setActiveTags] = useState<Set<string>>(
    new Set(tagsForCategory(DEFAULT_CATEGORY.id)),
  )
  const [heatOpacity, setHeatOpacity] = useState(0.7)
  const [minDistance, setMinDistance] = useState(HEAT_MIN_M)
  const [maxDistance, setMaxDistance] = useState(HEAT_CUTOFF_M)
  const [focusedStoreId, setFocusedStoreId] = useState<string | null>(null)

  // Reflect the UI language on <html lang> for a11y / correct hyphenation.
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const city = cityById(cityId)
  const category = categoryById(categoryId)
  const categoryTypes = typesForCategory(categoryId)
  const sourceFile = city.storesFiles[category.source]
  const stores = storesBySource[sourceFile] ?? null
  // undefined = still loading, null = unavailable (overlay renders unclipped)
  const boundary = city.id in boundaryByCity ? boundaryByCity[city.id] : undefined

  useEffect(() => {
    if (storesBySource[sourceFile]) return
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
        heatOpacity={heatOpacity}
        minDistance={minDistance}
        maxDistance={maxDistance}
        boundary={boundary}
        focusedStoreId={focusedStoreId}
        onFocusHandled={handleFocusHandled}
      />
      <div className="panel">
        <h1 className="panel-title">
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
                  {CATEGORIES.map((c) => (
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
          <button
            className="lang-toggle-btn"
            onClick={() => setLang((l) => (l === 'en' ? 'fr' : 'en'))}
            aria-label={t(lang, 'switchLang')}
          >
            {lang === 'en' ? 'FR' : 'EN'}
          </button>
          <button
            className="panel-toggle-btn"
            onClick={() => setPanelExpanded((v) => !v)}
            aria-label={panelExpanded ? t(lang, 'minimizePanel') : t(lang, 'expandPanel')}
            aria-expanded={panelExpanded}
          >
            {panelExpanded ? '−' : '+'}
          </button>
        </h1>
        {panelExpanded && (
          <>
            <AddressSearch
              key={city.id}
              city={city}
              lang={lang}
              onSelect={setUser}
              onClear={clearUser}
            />
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
