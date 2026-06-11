import type { MultiPolygon, Polygon } from 'geojson'
import { useEffect, useMemo, useState } from 'react'
import { CITIES, DEFAULT_CITY, cityById } from './cities'
import AddressSearch from './components/AddressSearch'
import FilterBar from './components/FilterBar'
import MapView from './components/MapView'
import ResultsPanel from './components/ResultsPanel'
import { haversineMetres } from './lib/distance'
import { ALL_TAGS } from './storeTypes'
import type { RankedStore, StoreCollection, UserLocation } from './types'
import { HEAT_CUTOFF_M, HEAT_MIN_M } from './types'

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

  const city = cityById(cityId)
  const stores = storesByCity[city.id] ?? null
  // undefined = still loading, null = unavailable (overlay renders unclipped)
  const boundary = city.id in boundaryByCity ? boundaryByCity[city.id] : undefined

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
        if (!cancelled) setLoadError(`Could not load store data: ${err.message}`)
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
        ranked={ranked}
        heatOpacity={heatOpacity}
        minDistance={minDistance}
        maxDistance={maxDistance}
        boundary={boundary}
        focusedStoreId={focusedStoreId}
        onFocusHandled={() => setFocusedStoreId(null)}
      />
      <div className="panel">
        <h1 className="panel-title">
          {/* selects size to their longest option; the hidden sizer span
              shrinks the grid cell to the chosen label exactly */}
          <span className="city-select-wrap">
            <select
              className="city-select"
              value={city.id}
              aria-label="City"
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
          </span>{' '}
          Grocery Heatmap
          <button
            className="panel-toggle-btn"
            onClick={() => setPanelExpanded((v) => !v)}
            aria-label={panelExpanded ? 'Minimize panel' : 'Expand panel'}
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
              onSelect={setUser}
              onClear={() => setUser(null)}
            />
            {loadError && <p className="error">{loadError}</p>}
            <FilterBar activeTags={activeTags} onChange={setActiveTags} />
            <div className="heatmap-settings">
              <h2>Heatmap settings</h2>
              <label className="opacity-control">
                Red within: {minDistance} m
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
                Blue beyond: {maxDistance} m
                <input
                  type="range"
                  min={100}
                  max={500}
                  step={50}
                  value={maxDistance}
                  onChange={(e) => setMaxDistance(Number(e.target.value))}
                />
              </label>
              <label className="opacity-control">
                Opacity: {Math.round(heatOpacity * 100)}%
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(heatOpacity * 100)}
                  onChange={(e) => setHeatOpacity(Number(e.target.value) / 100)}
                />
              </label>
            </div>
            {user && <ResultsPanel ranked={ranked} onSelect={setFocusedStoreId} />}
            {!user && stores && (
              <p className="hint">
                Enter your address to see your closest stores
                ({stores.features.length.toLocaleString()} stores loaded).
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
