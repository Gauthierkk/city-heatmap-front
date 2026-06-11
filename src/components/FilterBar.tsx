import { ALL_TAGS, STORE_TYPES } from '../storeTypes'

interface Props {
  activeTags: Set<string>
  onChange: (tags: Set<string>) => void
}

export default function FilterBar({ activeTags, onChange }: Props) {
  function toggle(tag: string) {
    const next = new Set(activeTags)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    onChange(next)
  }

  return (
    <div className="filter-bar">
      <div className="filter-actions">
        <button onClick={() => onChange(new Set(ALL_TAGS))}>Select all</button>
        <button onClick={() => onChange(new Set())}>Clear all</button>
      </div>
      <div className="filter-pills" role="group" aria-label="Store type filters">
        {STORE_TYPES.map((t) => {
          const active = activeTags.has(t.tag)
          return (
            <button
              key={t.tag}
              className={`pill${active ? ' active' : ''}`}
              aria-pressed={active}
              style={active ? { borderColor: t.color, backgroundColor: `${t.color}22` } : undefined}
              onClick={() => toggle(t.tag)}
            >
              <span className="pill-dot" style={{ backgroundColor: t.color }} />
              {t.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
