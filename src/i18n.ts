// Hand-rolled i18n (no dependency — bundle size matters). Two locales; the
// language lives in App state (default from the browser), is never persisted,
// and is passed down as a `lang` prop. `t()` does {slot} interpolation.

export type Lang = 'en' | 'fr'

export const LANGS: Lang[] = ['en', 'fr']

/** Browser-derived default; falls back to English for anything non-French. */
export function detectLang(): Lang {
  return typeof navigator !== 'undefined' &&
    navigator.language?.toLowerCase().startsWith('fr')
    ? 'fr'
    : 'en'
}

type Params = Record<string, string | number>

const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    // {city} marks where the city <select> is spliced in (see titleParts)
    title: '{city} Grocery Heatmap',
    cityAria: 'City',
    switchLang: 'Passer en français', // names the target language, in that language
    minimizePanel: 'Minimize panel',
    expandPanel: 'Expand panel',
    loadError: 'Could not load store data: {msg}',
    heatmapSettings: 'Heatmap settings',
    redWithin: 'Red within: {n} m',
    blueBeyond: 'Blue beyond: {n} m',
    opacity: 'Opacity: {n}%',
    hint: 'Enter your address to see your closest stores ({n} stores loaded).',
    searchPlaceholder: 'Enter a {city} address…',
    searchAria: '{city} address',
    clearAddress: 'Clear address',
    searching: 'Searching…',
    noResults: 'No {city} address found — the search only covers {city}.',
    searchFailed: 'Address lookup failed, please try again.',
    selectAll: 'Select all',
    clearAll: 'Clear all',
    filtersAria: 'Store type filters',
    noMatches: 'No stores match the active filters.',
    closestStores: 'Closest stores',
    showTop5: 'Show top 5',
    showTop10: 'Show top 10',
    unnamed: '(unnamed {type})',
    fromYourAddress: '{d} from your address',
  },
  fr: {
    title: 'Commerces alimentaires à {city}',
    cityAria: 'Ville',
    switchLang: 'Switch to English',
    minimizePanel: 'Réduire le panneau',
    expandPanel: 'Déplier le panneau',
    loadError: 'Impossible de charger les commerces : {msg}',
    heatmapSettings: 'Réglages de la carte',
    redWithin: 'Rouge en deçà de : {n} m',
    blueBeyond: 'Bleu au-delà de : {n} m',
    opacity: 'Opacité : {n} %',
    hint: 'Saisissez votre adresse pour voir les commerces les plus proches ({n} commerces chargés).',
    searchPlaceholder: 'Saisissez une adresse à {city}…',
    searchAria: 'Adresse à {city}',
    clearAddress: "Effacer l'adresse",
    searching: 'Recherche…',
    noResults: 'Aucune adresse trouvée à {city} — la recherche couvre uniquement {city}.',
    searchFailed: "La recherche d'adresse a échoué, veuillez réessayer.",
    selectAll: 'Tout sélectionner',
    clearAll: 'Tout effacer',
    filtersAria: 'Filtres par type de commerce',
    noMatches: 'Aucun commerce ne correspond aux filtres actifs.',
    closestStores: 'Commerces les plus proches',
    showTop5: 'Voir le top 5',
    showTop10: 'Voir le top 10',
    unnamed: '({type} sans nom)',
    fromYourAddress: 'à {d} de votre adresse',
  },
}

export function t(lang: Lang, key: string, params?: Params): string {
  let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key
  if (params) {
    for (const k in params) s = s.replace(`{${k}}`, String(params[k]))
  }
  return s
}

/** The title with the {city} slot removed, split into the text before and
 *  after it, so App can render the city <select> at the slot position
 *  (English puts the city first, French last). */
export function titleParts(lang: Lang): [string, string] {
  const [before, after] = t(lang, 'title').split('{city}')
  return [before ?? '', after ?? '']
}

/** Locale tag for Intl/toLocaleString formatting. */
export function locale(lang: Lang): string {
  return lang === 'fr' ? 'fr-FR' : 'en-US'
}
