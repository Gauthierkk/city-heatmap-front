import type { FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_CITY, cityById } from './cities'
import AddressSearch from './components/AddressSearch'
import FilterBar from './components/FilterBar'
import MapView from './components/MapView'
import RangeControl from './components/RangeControl'
import ResultsPanel from './components/ResultsPanel'
import SpeciesFilter from './components/SpeciesFilter'
import { type Lang, detectLang, locale, t, titleSegments } from './i18n'
import { haversineMetres } from './lib/distance'
import { extractBoundary, extractTreePoints, sameTagSet, storeTags, withShopTags } from './lib/geojson'
import { fetchJson } from './lib/http'
import {
  CATEGORIES,
  DEFAULT_CATEGORY,
  categoryById,
  tagsForCategory,
  typesForCategory,
  type CategoryId,
} from './storeTypes'
import type { RankedStore, StoreCollection, Theme, UserLocation } from './types'
import { HEAT_CUTOFF_M, HEAT_MIN_M, HEAT_RAMP_MAX_M, detectTheme } from './types'

export default function App() {
  // City is fixed to Paris (NYC/Austin are deprecated; the selector is disabled),
  // so the id is seeded once and never changes - no setter.
  const [cityId] = useState(DEFAULT_CITY.id)
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
  // Tree point cloud per city for density categories; null = unavailable. Each
  // feature is a Point carrying its species (species_fr / species_en).
  const [treesByCity, setTreesByCity] = useState<Record<string, FeatureCollection<Point> | null>>({})
  // Rail-line route geometry per city for the Transit view; null = unavailable.
  const [transitLinesByCity, setTransitLinesByCity] = useState<Record<string, FeatureCollection | null>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [user, setUser] = useState<UserLocation | null>(null)
  const [activeTags, setActiveTags] = useState<Set<string>>(
    new Set(tagsForCategory(DEFAULT_CATEGORY.id)),
  )
  // Slightly reduced from 0.7 → 0.65 for Fiord dark basemap: overlay colours
  // are vivid enough at 0.65 and bleed less into the navy background.
  const [heatOpacity, setHeatOpacity] = useState(0.65)
  // Distance overlay on/off (the "heatmap"); default on, toggled from the panel.
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [minDistance, setMinDistance] = useState(HEAT_MIN_M)
  const [maxDistance, setMaxDistance] = useState(HEAT_CUTOFF_M)
  // Tree heatmap spread, in ground metres (density categories). Each tree's
  // influence radius; rendered as true metres so it stays thin at city zoom
  // and sharpens as you zoom in.
  const [treeRadius, setTreeRadius] = useState(25)
  // Optional green highlight over park/garden polygons on the Trees view.
  // Off by default; only has an effect in density mode.
  const [parkOverlay, setParkOverlay] = useState(false)
  // Selected tree species for the density heatmap (keyed by English name).
  // null = nothing toggled yet, treated as all-selected everywhere (no filter:
  // activeSpecies stays null and SpeciesFilter renders all checked); reset to
  // null on city/category switch so each density view starts with all selected.
  const [speciesSel, setSpeciesSel] = useState<Set<string> | null>(null)
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
  // Rail-line geometry for the Transit view (null = none/loading); only fetched
  // and drawn when the Transit category is active.
  const isTransit = category.source === 'transit'
  const transitLines = isTransit ? transitLinesByCity[city.id] ?? null : null

  // Distinct species in the active point cloud, keyed by English name (the
  // stable id used for filtering); each carries both names + a count. Language-
  // independent, so it only recomputes when the point cloud changes.
  const speciesCounts = useMemo(() => {
    if (!treePoints) return null
    const map = new Map<string, { fr: string; en: string; count: number }>()
    for (const f of treePoints.features) {
      const p = f.properties ?? {}
      const en = typeof p.species_en === 'string' ? p.species_en : ''
      const fr = typeof p.species_fr === 'string' ? p.species_fr : ''
      const entry = map.get(en)
      if (entry) entry.count++
      else map.set(en, { fr, en, count: 1 })
    }
    return map
  }, [treePoints])

  // Display list for the filter: localized label, sorted most-common first.
  const speciesList = useMemo(() => {
    if (!speciesCounts) return []
    return [...speciesCounts.values()]
      .map((s) => ({
        key: s.en,
        label: (lang === 'fr' ? s.fr : s.en) || t(lang, 'unknownSpecies'),
        count: s.count,
      }))
      .sort((a, b) => b.count - a.count)
  }, [speciesCounts, lang])

  // The filter passed to the map: null when every species is selected (no
  // filter), the selected keys otherwise. An empty selection clears the heatmap.
  const activeSpecies = useMemo(() => {
    if (!speciesSel || !speciesCounts) return null
    if (speciesSel.size >= speciesCounts.size) return null
    return [...speciesSel]
  }, [speciesSel, speciesCounts])

  useEffect(() => {
    if (!sourceFile || storesBySource[sourceFile]) return
    let cancelled = false
    fetchJson<StoreCollection>(sourceFile)
      .then((data) => {
        if (!cancelled) setStoresBySource((prev) => ({ ...prev, [sourceFile]: withShopTags(data) }))
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
    fetchJson(file)
      .then((data) => {
        if (!cancelled) setTreesByCity((prev) => ({ ...prev, [city.id]: extractTreePoints(data) }))
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
    fetchJson(city.boundaryFile)
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

  // Lazy-load the rail-line geometry the first time the Transit view is shown for
  // a city that ships it. Mirrors the boundary fetch: cached per city, fail-soft
  // to null (the lines simply don't render).
  useEffect(() => {
    if (!isTransit || city.id in transitLinesByCity) return
    const file = city.transitLinesFile
    if (!file) return
    let cancelled = false
    fetchJson<FeatureCollection>(file)
      .then((data) => {
        if (!cancelled) setTransitLinesByCity((prev) => ({ ...prev, [city.id]: data }))
      })
      .catch(() => {
        if (!cancelled) setTransitLinesByCity((prev) => ({ ...prev, [city.id]: null }))
      })
    return () => {
      cancelled = true
    }
  }, [isTransit, city, transitLinesByCity])

  function switchCategory(id: string) {
    if (id === categoryId) return
    setCategoryId(id as CategoryId)
    setActiveTags(new Set(tagsForCategory(id as CategoryId)))
    setFocusedStoreId(null)
    setLoadError(null)
    setSpeciesSel(null)
    // user / address intentionally kept - results re-rank to the new category
  }

  // Stable identities so memoised panel children don't re-render on slider drags.
  const handleTagsChange = useCallback((next: Set<string>) => {
    setActiveTags((prev) => (sameTagSet(prev, next) ? prev : next))
  }, [])
  const clearUser = useCallback(() => setUser(null), [])
  const handleSpeciesChange = useCallback((next: Set<string>) => setSpeciesSel(next), [])
  const handleFocusHandled = useCallback(() => setFocusedStoreId(null), [])
  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  const filteredStores = useMemo(() => {
    if (!stores) return null
    return {
      ...stores,
      features: stores.features.filter((f) =>
        storeTags(f.properties).some((tag) => activeTags.has(tag)),
      ),
    }
  }, [stores, activeTags])

  // Count of features in the loaded file that belong to the active category -
  // used for the hint so Grocery doesn't show the full food-file count.
  const categoryTagSet = useMemo(() => new Set(tagsForCategory(categoryId)), [categoryId])
  const categoryTotal = useMemo(() => {
    if (!stores) return 0
    return stores.features.filter((f) =>
      storeTags(f.properties).some((tag) => categoryTagSet.has(tag)),
    ).length
  }, [stores, categoryTagSet])

  // Categories offered for this city - only those with a data file. Memoised so
  // the title <select> doesn't allocate a fresh array on every render.
  const availableCategories = useMemo(
    () => CATEGORIES.filter((c) => city.storesFiles[c.source]),
    [city],
  )

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
        showHeatmap={showHeatmap}
        minDistance={minDistance}
        maxDistance={maxDistance}
        boundary={boundary}
        transitLines={transitLines}
        treePoints={treePoints}
        isDensity={isDensity}
        parkOverlay={parkOverlay}
        treeRadiusM={treeRadius}
        activeSpecies={activeSpecies}
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
                // City selection is disabled - the app is Paris-only (NYC/Austin
                // are deprecated), so the city renders as static heading text.
                return (
                  <span key="city" className="city-static">
                    {city.label}
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
                    {availableCategories.map((c) => (
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
              <RangeControl
                label={t(lang, 'treeRadius', { n: treeRadius })}
                min={10}
                max={50}
                step={5}
                value={treeRadius}
                onChange={setTreeRadius}
              />
              <label className="checkbox-control">
                <input
                  type="checkbox"
                  checked={parkOverlay}
                  onChange={(e) => setParkOverlay(e.target.checked)}
                />
                {t(lang, 'highlightParks')}
              </label>
            </div>
            <SpeciesFilter
              species={speciesList}
              active={speciesSel}
              lang={lang}
              onChange={handleSpeciesChange}
            />
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
              <label className="checkbox-control">
                <input
                  type="checkbox"
                  checked={showHeatmap}
                  onChange={(e) => setShowHeatmap(e.target.checked)}
                />
                {t(lang, 'showHeatmap')}
              </label>
              {showHeatmap && (
                <>
                  <RangeControl
                    label={t(lang, 'redWithin', { n: minDistance })}
                    min={10}
                    max={50}
                    step={10}
                    value={minDistance}
                    onChange={setMinDistance}
                  />
                  <RangeControl
                    label={t(lang, 'blueBeyond', { n: maxDistance })}
                    min={100}
                    max={HEAT_RAMP_MAX_M}
                    step={50}
                    value={maxDistance}
                    onChange={setMaxDistance}
                  />
                  <RangeControl
                    label={t(lang, 'opacity', { n: Math.round(heatOpacity * 100) })}
                    min={0}
                    max={100}
                    value={Math.round(heatOpacity * 100)}
                    onChange={(v) => setHeatOpacity(v / 100)}
                  />
                </>
              )}
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
