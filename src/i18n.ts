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
    // {city} and {category} mark where the two <select>s are spliced in (see titleSegments)
    title: '{city} {category} Heatmap',
    cityAria: 'City',
    categoryAria: 'Category',
    switchLang: 'Passer en français', // names the target language, in that language
    darkMode: 'Dark mode', // theme toggle names the target mode
    lightMode: 'Light mode',
    minimizePanel: 'Minimize panel',
    expandPanel: 'Expand panel',
    loadError: 'Could not load map data: {msg}',
    heatmapSettings: 'Heatmap settings',
    redWithin: 'Red within: {n} m',
    blueBeyond: 'Blue beyond: {n} m',
    opacity: 'Opacity: {n}%',
    hint: 'Enter your address to see your closest places ({n} loaded).',
    dataDisclaimer: 'Heads up: {city} data is a one-off snapshot and isn’t refreshed regularly.',
    searchPlaceholder: 'Enter a {city} address…',
    searchAria: '{city} address',
    clearAddress: 'Clear address',
    searching: 'Searching…',
    noResults: 'No {city} address found — the search only covers {city}.',
    searchFailed: 'Address lookup failed, please try again.',
    selectAll: 'Select all',
    clearAll: 'Clear all',
    filtersAria: 'Type filters',
    noMatches: 'Nothing matches the active filters.',
    closestStores: 'Closest places',
    showTop5: 'Show top 5',
    showTop10: 'Show top 10',
    unnamed: '(unnamed {type})',
    fromYourAddress: '{d} from your address',
  },
  fr: {
    title: '{category} à {city}',
    cityAria: 'Ville',
    categoryAria: 'Catégorie',
    switchLang: 'Switch to English',
    darkMode: 'Mode sombre',
    lightMode: 'Mode clair',
    minimizePanel: 'Réduire le panneau',
    expandPanel: 'Déplier le panneau',
    loadError: 'Impossible de charger les données : {msg}',
    heatmapSettings: 'Réglages de la carte',
    redWithin: 'Rouge en deçà de : {n} m',
    blueBeyond: 'Bleu au-delà de : {n} m',
    opacity: 'Opacité : {n} %',
    hint: 'Saisissez votre adresse pour voir les établissements les plus proches ({n} chargés).',
    dataDisclaimer: 'À noter : les données de {city} sont un instantané ponctuel et ne sont pas mises à jour régulièrement.',
    searchPlaceholder: 'Saisissez une adresse à {city}…',
    searchAria: 'Adresse à {city}',
    clearAddress: "Effacer l'adresse",
    searching: 'Recherche…',
    noResults: 'Aucune adresse trouvée à {city} — la recherche couvre uniquement {city}.',
    searchFailed: "La recherche d'adresse a échoué, veuillez réessayer.",
    selectAll: 'Tout sélectionner',
    clearAll: 'Tout effacer',
    filtersAria: 'Filtres par type',
    noMatches: 'Aucun établissement ne correspond aux filtres actifs.',
    closestStores: 'Établissements les plus proches',
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

export type TitleSegment =
  | { kind: 'text'; value: string }
  | { kind: 'slot'; slot: 'city' | 'category' }

/** The title split into text and slot segments so App can render each
 *  <select> at its {city} / {category} position. */
export function titleSegments(lang: Lang): TitleSegment[] {
  const parts = t(lang, 'title').split(/(\{city\}|\{category\})/)
  return parts
    .filter((p) => p !== '')
    .map((p): TitleSegment => {
      if (p === '{city}') return { kind: 'slot', slot: 'city' }
      if (p === '{category}') return { kind: 'slot', slot: 'category' }
      return { kind: 'text', value: p }
    })
}

/** Locale tag for Intl/toLocaleString formatting. */
export function locale(lang: Lang): string {
  return lang === 'fr' ? 'fr-FR' : 'en-US'
}
