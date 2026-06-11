import type { MultiPolygon, Polygon } from 'geojson'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CITIES, DEFAULT_CITY, cityById } from './cities'
import AddressSearch from './components/AddressSearch'
import FilterBar from './components/FilterBar'
import MapView from './components/MapView'
import ResultsPanel from './components/ResultsPanel'
import { type Lang, detectLang, locale, t, titleParts } from './i18n'
import { haversineMetres } from './lib/distance'
import { ALL_TAGS } from './storeTypes'
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
  const [lang, setLang] = useState<Lang>(detectLang)
  const [panelExpanded, setPanelExpanded] = useState(true)
  // Per-city caches: fetched once, kept across switches
  const [storesByCity, setStoresByCity] = useState<Record<string, StoreCollection>>({})
  const [boundaryByCity, setBoundaryByCity] = useState<
    Record<string, Polygon | MultiPolygon | null>
  >({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [user, setUser] = useState<UserLocation | null>(null)
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set(ALL_TAGS))
  const [heatOpacity, setHeatOpacity] = useState(0.7)
  const [minDistance, setMinDistance] = useState(HEAT_MIN_M)
  const [maxDistance, setMaxDistance] = useState(HEAT_CUTOFF_M)
  const [focusedStoreId, setFocusedStoreId] = useState<string | null>(null)

  // Reflect the UI language on <html lang> for a11y / correct hyphenation.
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const city = cityById(cityId)
  const stores = storesByCity[city.id] ?? null
  // undefined = still loading, null = unavailable (overlay renders unclipped)
  const boundary = city.id in boundaryByCity ? boundaryByCity[city.id] : undefined

  // Static per-city fetch + session cache. This data-loading boundary is
  // slated to move into a dedicated worker later; keep it self-contained so
  // the swap stays local to these two effects.
  useEffect(() => {
    if (storesByCity[city.id]) return
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}${city.storesFile}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: StoreCollection) => {
        if (!cancelled) setStoresByCity((prev) => ({ ...prev, [city.id]: data }))
      })
      .catch((err) => {
        // Store the raw message; the localized prefix is applied at render time.
        if (!cancelled) setLoadError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [city, storesByCity])

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
          {/* The title template places the city <select> at its {city} slot:
              English leads with the city, French trails it. The hidden sizer
              span shrinks the select to the chosen label exactly. */}
          {titleParts(lang)[0]}
          <span className="city-select-wrap">
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
          {titleParts(lang)[1]}
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
            <FilterBar activeTags={activeTags} lang={lang} onChange={handleTagsChange} />
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
                {t(lang, 'hint', { n: stores.features.length.toLocaleString(locale(lang)) })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
