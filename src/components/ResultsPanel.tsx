import { useState } from 'react'
import { formatDistance } from '../lib/distance'
import { typeColor, typeLabel } from '../storeTypes'
import type { RankedStore } from '../types'

interface Props {
  ranked: RankedStore[]
  onSelect: (storeId: string) => void
}

export default function ResultsPanel({ ranked, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false)
  const visible = ranked.slice(0, expanded ? 10 : 5)

  if (ranked.length === 0) {
    return <p className="hint">No stores match the active filters.</p>
  }

  return (
    <div className="results">
      <h2>Closest stores</h2>
      <ol>
        {visible.map(({ feature, distance }) => (
          <li key={feature.properties.id}>
            <button className="result-row" onClick={() => onSelect(feature.properties.id)}>
              <span className="result-name">
                {feature.properties.name ?? `(unnamed ${typeLabel(feature.properties.shop).toLowerCase()})`}
              </span>
              <span
                className="type-badge"
                style={{ backgroundColor: typeColor(feature.properties.shop) }}
              >
                {typeLabel(feature.properties.shop)}
              </span>
              <span className="result-distance">{formatDistance(distance)}</span>
            </button>
          </li>
        ))}
      </ol>
      {ranked.length > 5 && (
        <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show top 5' : 'Show top 10'}
        </button>
      )}
    </div>
  )
}
