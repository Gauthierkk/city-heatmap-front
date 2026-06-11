export interface StoreTypeDef {
  /** OSM `shop=` tag value */
  tag: string
  label: string
  color: string
}

export const STORE_TYPES: StoreTypeDef[] = [
  { tag: 'supermarket', label: 'Supermarket', color: '#e74c3c' },
  { tag: 'convenience', label: 'Convenience', color: '#e67e22' },
  { tag: 'greengrocer', label: 'Greengrocer', color: '#27ae60' },
  { tag: 'butcher', label: 'Butcher', color: '#c0392b' },
  { tag: 'fishmonger', label: 'Fishmonger', color: '#2980b9' },
  { tag: 'bakery', label: 'Bakery', color: '#d4a017' },
  { tag: 'deli', label: 'Deli', color: '#8e44ad' },
  { tag: 'cheese', label: 'Fromagerie', color: '#f1c40f' },
  { tag: 'organic', label: 'Organic / Bio', color: '#16a085' },
  { tag: 'frozen_food', label: 'Frozen food', color: '#5dade2' },
  { tag: 'alcohol', label: 'Wine / Caviste', color: '#7d3c98' },
  { tag: 'beverages', label: 'Beverages', color: '#34495e' },
]

export const ALL_TAGS = STORE_TYPES.map((t) => t.tag)

const byTag = new Map(STORE_TYPES.map((t) => [t.tag, t]))

export function typeLabel(tag: string): string {
  return byTag.get(tag)?.label ?? tag
}

export function typeColor(tag: string): string {
  return byTag.get(tag)?.color ?? '#7f8c8d'
}
