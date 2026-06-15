import type { Lang } from './i18n'

export type CategoryId = 'grocery' | 'specialty' | 'fitness' | 'trees'
export type DataSourceId = 'food' | 'fitness' | 'trees'

/** 'places' = labelled point data (dots + distance overlay + filters +
 *  closest-place results). 'density' = an unlabelled point cloud rendered only
 *  as a heatmap (Trees): no dots, no filters, no results. */
export type CategoryKind = 'places' | 'density'

export interface CategoryDef {
  id: CategoryId
  label: Record<Lang, string>
  kind: CategoryKind
  /** Which GeoJSON file backs this category (per city in cities.ts) */
  source: DataSourceId
}

export interface StoreTypeDef {
  /** OSM `shop=` tag value (after the city-heatmap-data worker's normalisation).
   *  Fitness features deliberately reuse this key (`shop: 'yoga'` etc.) so
   *  StoreProperties, MapView expressions, and distanceField.ts need no edits. */
  tag: string
  /** Per-language display label */
  label: Record<Lang, string>
  color: string
  category: CategoryId
}

// Top-level categories. Grocery and Specialty both read the food GeoJSON;
// Fitness reads its own per-city file — all three are 'places' (dots +
// distance overlay). Trees is a 'density' category: an unlabelled point cloud
// rendered only as a heatmap, and only offered for cities that ship a trees
// file (currently Paris).
export const CATEGORIES: CategoryDef[] = [
  { id: 'grocery',   label: { en: 'Grocery',        fr: 'Commerces alimentaires' }, kind: 'places',  source: 'food'    },
  { id: 'specialty', label: { en: 'Specialty Food', fr: 'Épiceries fines' },        kind: 'places',  source: 'food'    },
  { id: 'fitness',   label: { en: 'Fitness',        fr: 'Fitness' },                kind: 'places',  source: 'fitness' },
  { id: 'trees',     label: { en: 'Trees',          fr: 'Arbres' },                 kind: 'density', source: 'trees'   },
]

export const DEFAULT_CATEGORY = CATEGORIES[0]

const categoriesById = new Map(CATEGORIES.map((c) => [c.id, c]))

export function categoryById(id: string): CategoryDef {
  return categoriesById.get(id as CategoryId) ?? DEFAULT_CATEGORY
}

// 18 food types + 6 fitness types. Food display order groups related trades
// (bakery↔pastry, wine↔alcohol). The original 12 were NYC-shaped; pastry,
// wine, chocolate, confectionery, tea, coffee were added from Overpass counts
// across Paris / NYC / Austin — all have ≥30 stores in at least one city.
// Grocery = the 5 everyday staples; Specialty = the other 13 (incl. bakery).
export const STORE_TYPES: StoreTypeDef[] = [
  { tag: 'supermarket',   label: { en: 'Supermarket',          fr: 'Supermarché' },          color: '#e74c3c', category: 'grocery'   },
  { tag: 'convenience',   label: { en: 'Convenience',          fr: 'Supérette' },            color: '#e67e22', category: 'grocery'   },
  { tag: 'greengrocer',   label: { en: 'Greengrocer',          fr: 'Primeur' },              color: '#27ae60', category: 'grocery'   },
  { tag: 'organic',       label: { en: 'Organic',              fr: 'Bio' },                  color: '#16a085', category: 'grocery'   },
  { tag: 'frozen_food',   label: { en: 'Frozen food',          fr: 'Surgelés' },             color: '#5dade2', category: 'grocery'   },
  { tag: 'butcher',       label: { en: 'Butcher',              fr: 'Boucherie' },            color: '#c0392b', category: 'specialty' },
  { tag: 'fishmonger',    label: { en: 'Fishmonger',           fr: 'Poissonnerie' },         color: '#2980b9', category: 'specialty' },
  { tag: 'bakery',        label: { en: 'Bakery',               fr: 'Boulangerie' },          color: '#d4a017', category: 'specialty' },
  { tag: 'pastry',        label: { en: 'Pastry shop',          fr: 'Pâtisserie' },           color: '#e8a87c', category: 'specialty' },
  { tag: 'deli',          label: { en: 'Deli',                 fr: 'Traiteur' },             color: '#8e44ad', category: 'specialty' },
  { tag: 'cheese',        label: { en: 'Cheese shop',          fr: 'Fromagerie' },           color: '#f1c40f', category: 'specialty' },
  { tag: 'wine',          label: { en: 'Wine shop',            fr: 'Cave à vins' },          color: '#922b21', category: 'specialty' },
  { tag: 'alcohol',       label: { en: 'Spirits & alcohol',    fr: 'Alcools' },              color: '#7d3c98', category: 'specialty' },
  { tag: 'beverages',     label: { en: 'Beverages',            fr: 'Boissons' },             color: '#34495e', category: 'specialty' },
  { tag: 'chocolate',     label: { en: 'Chocolatier',          fr: 'Chocolatier' },          color: '#6b3a2a', category: 'specialty' },
  { tag: 'confectionery', label: { en: 'Confectionery',        fr: 'Confiserie' },           color: '#f8c8d4', category: 'specialty' },
  { tag: 'tea',           label: { en: 'Tea shop',             fr: 'Thé' },                  color: '#a8d8a8', category: 'specialty' },
  { tag: 'coffee',        label: { en: 'Coffee roaster',       fr: 'Torréfacteur' },         color: '#4a235a', category: 'specialty' },
  // Fitness types — reuse the `shop` property key so MapView/distanceField
  // need no changes. Overpass counts (Paris/NYC/Austin) all meet the ≥30 bar.
  { tag: 'gym',           label: { en: 'Gym & fitness',        fr: 'Salle de sport' },       color: '#c0392b', category: 'fitness'   },
  { tag: 'yoga',          label: { en: 'Yoga',                 fr: 'Yoga' },                 color: '#27ae60', category: 'fitness'   },
  { tag: 'pilates',       label: { en: 'Pilates',              fr: 'Pilates' },              color: '#9b59b6', category: 'fitness'   },
  { tag: 'martial_arts',  label: { en: 'Martial arts & boxing', fr: 'Arts martiaux & boxe' }, color: '#2c3e50', category: 'fitness'   },
  { tag: 'dance',         label: { en: 'Dance',                fr: 'Danse' },                color: '#e84393', category: 'fitness'   },
  { tag: 'climbing',      label: { en: 'Climbing',             fr: 'Escalade' },             color: '#16a085', category: 'fitness'   },
]

// Precomputed per-category arrays — referentially stable so FilterBar's
// React.memo works correctly when these are passed as the `types` prop.
const _typesByCategory = new Map<CategoryId, StoreTypeDef[]>()
const _tagsByCategory = new Map<CategoryId, string[]>()
for (const cat of CATEGORIES) {
  const types = STORE_TYPES.filter((t) => t.category === cat.id)
  _typesByCategory.set(cat.id, types)
  _tagsByCategory.set(cat.id, types.map((t) => t.tag))
}

export function typesForCategory(id: CategoryId): StoreTypeDef[] {
  return _typesByCategory.get(id) ?? _typesByCategory.get('grocery')!
}

export function tagsForCategory(id: CategoryId): string[] {
  return _tagsByCategory.get(id) ?? _tagsByCategory.get('grocery')!
}

const byTag = new Map(STORE_TYPES.map((t) => [t.tag, t]))

export function typeLabel(tag: string, lang: Lang): string {
  return byTag.get(tag)?.label[lang] ?? tag
}

export function typeColor(tag: string): string {
  return byTag.get(tag)?.color ?? '#7f8c8d'
}
