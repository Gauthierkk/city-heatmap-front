import { memo } from 'react'
import type { Lang } from '../i18n'
import { t as translate } from '../i18n'
import type { StoreTypeDef } from '../storeTypes'

interface Props {
  types: StoreTypeDef[]
  activeTags: Set<string>
  lang: Lang
  onChange: (tags: Set<string>) => void
}

function FilterBar({ types, activeTags, lang, onChange }: Props) {
  function toggle(tag: string) {
    const next = new Set(activeTags)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    onChange(next)
  }

  return (
    <div className="filter-bar">
      <div className="filter-actions">
        <button onClick={() => onChange(new Set(types.map((t) => t.tag)))}>{translate(lang, 'selectAll')}</button>
        <button onClick={() => onChange(new Set())}>{translate(lang, 'clearAll')}</button>
      </div>
      <div className="filter-pills" role="group" aria-label={translate(lang, 'filtersAria')}>
        {types.map((type) => {
          const active = activeTags.has(type.tag)
          return (
            <button
              key={type.tag}
              className={`pill${active ? ' active' : ''}`}
              aria-pressed={active}
              style={active ? { borderColor: type.color, backgroundColor: `${type.color}22` } : undefined}
              onClick={() => toggle(type.tag)}
            >
              <span className="pill-dot" style={{ backgroundColor: type.color }} />
              {type.label[lang]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default memo(FilterBar)
