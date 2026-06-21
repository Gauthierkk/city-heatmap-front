import { type Lang } from '../i18n'
import { typeLabel } from '../storeTypes'
import type { TransitLine } from '../types'

// Shared logic for rendering a transit line as its official bullet, in both
// forms the app needs: the MapView popup (HTML string) and the ResultsPanel
// (React, via the LineBullets component). Keeping the src + label here means the
// two render paths can't drift.

/** URL of a line's official pictogram (under `public/lines/`), or '' when the
 *  source ships no pictogram for that line (caller falls back to a text bullet). */
export function lineBulletSrc(picto: string): string {
  return picto ? `${import.meta.env.BASE_URL}lines/${picto}` : ''
}

/** Accessible label for a line, e.g. "Métro 1", "RER A", "Tramway T3a". The mode
 *  name is localized via the same `typeLabel` the filters/badges use. */
export function lineLabel(l: TransitLine, lang: Lang): string {
  return `${typeLabel(l.mode, lang)} ${l.line}`.trim()
}
