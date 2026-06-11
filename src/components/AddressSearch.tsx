import { memo, useEffect, useRef, useState } from 'react'
import type { CityDef } from '../cities'
import type { Lang } from '../i18n'
import { t } from '../i18n'
import { searchCityAddress, type GeocodeResult } from '../lib/geocode'
import type { UserLocation } from '../types'

interface Props {
  city: CityDef
  lang: Lang
  onSelect: (loc: UserLocation) => void
  onClear: () => void
}

// Nominatim policy caps us at 1 req/s and discourages per-keystroke
// autocomplete, hence the long debounce and 3-char minimum.
const DEBOUNCE_MS = 800
const MIN_CHARS = 3

function AddressSearch({ city, lang, onSelect, onClear }: Props) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'empty'>('idle')
  const [selected, setSelected] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (selected || trimmed.length < MIN_CHARS) {
      setSuggestions([])
      setStatus('idle')
      return
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setStatus('loading')
      try {
        const results = await searchCityAddress(city, trimmed, controller.signal)
        setSuggestions(results)
        setStatus(results.length === 0 ? 'empty' : 'idle')
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setStatus('error')
      }
    }, DEBOUNCE_MS)
    // Cancel both the pending debounce and any in-flight request when the query
    // changes or the component unmounts.
    return () => {
      clearTimeout(timer)
      abortRef.current?.abort()
    }
  }, [query, selected, city])

  function choose(result: GeocodeResult) {
    setSelected(true)
    setQuery(result.label)
    setSuggestions([])
    setStatus('idle')
    onSelect({ lng: result.lng, lat: result.lat, label: result.label })
  }

  function clear() {
    abortRef.current?.abort()
    setSelected(false)
    setQuery('')
    setSuggestions([])
    setStatus('idle')
    onClear()
  }

  return (
    <div className="address-search">
      <div className="address-input-row">
        <input
          type="text"
          value={query}
          placeholder={t(lang, 'searchPlaceholder', { city: city.label })}
          aria-label={t(lang, 'searchAria', { city: city.label })}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(false)
          }}
        />
        {query && (
          <button className="clear-btn" onClick={clear} aria-label={t(lang, 'clearAddress')}>
            ✕
          </button>
        )}
      </div>
      {status === 'loading' && <p className="search-status">{t(lang, 'searching')}</p>}
      {status === 'empty' && (
        <p className="search-status error">{t(lang, 'noResults', { city: city.label })}</p>
      )}
      {status === 'error' && (
        <p className="search-status error">{t(lang, 'searchFailed')}</p>
      )}
      {suggestions.length > 0 && (
        <ul className="suggestions" role="listbox">
          {suggestions.map((s) => (
            <li key={`${s.lng},${s.lat}`}>
              <button onClick={() => choose(s)}>{s.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default memo(AddressSearch)
