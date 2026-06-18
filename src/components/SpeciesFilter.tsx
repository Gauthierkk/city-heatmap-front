import { memo, useMemo, useState } from 'react'
import type { Lang } from '../i18n'
import { locale, t as translate } from '../i18n'

export interface SpeciesEntry {
  /** Stable key — the English species name (empty string = unknown species). */
  key: string
  /** Display label in the active language. */
  label: string
  /** Number of trees of this species. */
  count: number
}

interface Props {
  species: SpeciesEntry[]
  /** Selected species keys; null = not yet initialised, treated as all-selected. */
  active: Set<string> | null
  lang: Lang
  onChange: (next: Set<string>) => void
}

// Collapsible multi-select for the Trees density category. Sorted by frequency
// (most common first), text-searchable, with select-all / clear-all. Filtering
// is applied to the heatmap via a MapLibre layer filter (see MapView), so this
// only owns the selection set — it never touches the point cloud.
function SpeciesFilter({ species, active, lang, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const allKeys = useMemo(() => species.map((s) => s.key), [species])
  // null means "uninitialised" — render as everything checked.
  const isChecked = (key: string) => (active ? active.has(key) : true)
  const selectedCount = active ? active.size : species.length

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return species
    return species.filter((s) => s.label.toLowerCase().includes(q))
  }, [species, query])

  function toggle(key: string) {
    const next = new Set(active ?? allKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }

  if (species.length === 0) return null

  const summary =
    selectedCount >= species.length
      ? translate(lang, 'allSpecies')
      : translate(lang, 'speciesSelected', { n: selectedCount, total: species.length })

  return (
    <div className="species-filter">
      <button
        type="button"
        className="species-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          {translate(lang, 'speciesFilter')}: {summary}
        </span>
        <span className="species-chevron" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="species-dropdown">
          <input
            className="species-search"
            type="search"
            value={query}
            placeholder={translate(lang, 'searchSpecies')}
            aria-label={translate(lang, 'searchSpecies')}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="filter-actions">
            <button type="button" onClick={() => onChange(new Set(allKeys))}>
              {translate(lang, 'selectAll')}
            </button>
            <button type="button" onClick={() => onChange(new Set())}>
              {translate(lang, 'clearAll')}
            </button>
          </div>
          <ul className="species-list" role="group" aria-label={translate(lang, 'speciesFilter')}>
            {filtered.length === 0 && (
              <li className="species-empty">{translate(lang, 'noSpeciesMatch')}</li>
            )}
            {filtered.map((s) => (
              <li key={s.key}>
                <label className="species-option">
                  <input
                    type="checkbox"
                    checked={isChecked(s.key)}
                    onChange={() => toggle(s.key)}
                  />
                  <span className="species-name">{s.label}</span>
                  <span className="species-count">{s.count.toLocaleString(locale(lang))}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default memo(SpeciesFilter)
