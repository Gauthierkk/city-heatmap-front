import type { Lang } from './i18n'

export interface StoreTypeDef {
  /** OSM `shop=` tag value (after fetch-stores.mjs normalisation) */
  tag: string
  /** Per-language display label */
  label: Record<Lang, string>
  color: string
}

// 18 canonical types. The original 12 were NYC-shaped; the 6 additions
// (pastry, wine, chocolate, confectionery, tea, coffee) were picked from
// Overpass counts across Paris / NYC / Austin — all have ≥30 stores in at
// least one city and are genuine food retail. Display order groups related
// trades (bakery↔pastry, wine↔alcohol).
export const STORE_TYPES: StoreTypeDef[] = [
  { tag: 'supermarket',   label: { en: 'Supermarket',       fr: 'Supermarché' },  color: '#e74c3c' },
  { tag: 'convenience',   label: { en: 'Convenience',       fr: 'Supérette' },    color: '#e67e22' },
  { tag: 'greengrocer',   label: { en: 'Greengrocer',       fr: 'Primeur' },      color: '#27ae60' },
  { tag: 'butcher',       label: { en: 'Butcher',           fr: 'Boucherie' },    color: '#c0392b' },
  { tag: 'fishmonger',    label: { en: 'Fishmonger',        fr: 'Poissonnerie' }, color: '#2980b9' },
  { tag: 'bakery',        label: { en: 'Bakery',            fr: 'Boulangerie' },  color: '#d4a017' },
  { tag: 'pastry',        label: { en: 'Pastry shop',       fr: 'Pâtisserie' },   color: '#e8a87c' },
  { tag: 'deli',          label: { en: 'Deli',              fr: 'Traiteur' },     color: '#8e44ad' },
  { tag: 'cheese',        label: { en: 'Cheese shop',       fr: 'Fromagerie' },   color: '#f1c40f' },
  { tag: 'organic',       label: { en: 'Organic',           fr: 'Bio' },          color: '#16a085' },
  { tag: 'frozen_food',   label: { en: 'Frozen food',       fr: 'Surgelés' },     color: '#5dade2' },
  { tag: 'wine',          label: { en: 'Wine shop',         fr: 'Cave à vins' },  color: '#922b21' },
  { tag: 'alcohol',       label: { en: 'Spirits & alcohol', fr: 'Alcools' },      color: '#7d3c98' },
  { tag: 'beverages',     label: { en: 'Beverages',         fr: 'Boissons' },     color: '#34495e' },
  { tag: 'chocolate',     label: { en: 'Chocolatier',       fr: 'Chocolatier' },  color: '#6b3a2a' },
  { tag: 'confectionery', label: { en: 'Confectionery',     fr: 'Confiserie' },   color: '#f8c8d4' },
  { tag: 'tea',           label: { en: 'Tea shop',          fr: 'Thé' },          color: '#a8d8a8' },
  { tag: 'coffee',        label: { en: 'Coffee roaster',    fr: 'Torréfacteur' }, color: '#4a235a' },
]

export const ALL_TAGS = STORE_TYPES.map((t) => t.tag)

const byTag = new Map(STORE_TYPES.map((t) => [t.tag, t]))

export function typeLabel(tag: string, lang: Lang): string {
  return byTag.get(tag)?.label[lang] ?? tag
}

export function typeColor(tag: string): string {
  return byTag.get(tag)?.color ?? '#7f8c8d'
}
