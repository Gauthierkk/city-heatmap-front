import { memo, useState } from 'react'
import type { Lang } from '../i18n'
import { t } from '../i18n'
import { formatAddress } from '../lib/address'
import { formatDistance } from '../lib/distance'
import { typeColor, typeLabel } from '../storeTypes'
import type { RankedStore } from '../types'
import LineBullets from './LineBullets'

interface Props {
  ranked: RankedStore[]
  lang: Lang
  onSelect: (storeId: string) => void
}

function ResultsPanel({ ranked, lang, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false)
  const visible = ranked.slice(0, expanded ? 10 : 5)

  if (ranked.length === 0) {
    return <p className="hint">{t(lang, 'noMatches')}</p>
  }

  return (
    <div className="results">
      <h2>{t(lang, 'closestStores')}</h2>
      <ol>
        {visible.map(({ feature, distance }) => {
          const label = typeLabel(feature.properties.shop, lang)
          const address = formatAddress(feature.properties.address)
          const lines = feature.properties.lines
          return (
            <li key={feature.properties.id}>
              <button className="result-row" onClick={() => onSelect(feature.properties.id)}>
                <span className="result-main">
                  <span className="result-name">
                    {feature.properties.name ?? t(lang, 'unnamed', { type: label.toLowerCase() })}
                  </span>
                  {address && <span className="result-address">{address}</span>}
                </span>
                {lines && lines.length ? (
                  <LineBullets lines={lines} lang={lang} />
                ) : (
                  <span
                    className="type-badge"
                    style={{ backgroundColor: typeColor(feature.properties.shop) }}
                  >
                    {label}
                  </span>
                )}
                <span className="result-distance">{formatDistance(distance, lang)}</span>
              </button>
            </li>
          )
        })}
      </ol>
      {ranked.length > 5 && (
        <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? t(lang, 'showTop5') : t(lang, 'showTop10')}
        </button>
      )}
    </div>
  )
}

export default memo(ResultsPanel)
