import type { Lang } from '../i18n'
import { lineBulletSrc, lineLabel } from '../lib/transitLines'
import type { TransitLine } from '../types'

interface Props {
  lines: TransitLine[]
  lang: Lang
}

/** A row of official transit-line bullets (the React form, used by ResultsPanel).
 *  Lines without a source pictogram fall back to a small text bullet. The popup
 *  uses the HTML-string twin in MapView; both share src/label from transitLines. */
export default function LineBullets({ lines, lang }: Props) {
  return (
    <span className="line-bullets">
      {lines.map((l, i) => {
        const label = lineLabel(l, lang)
        const src = lineBulletSrc(l.picto)
        return src ? (
          <img key={i} className="line-bullet" src={src} alt={label} title={label} />
        ) : (
          <span key={i} className="line-bullet-text" title={label}>
            {l.line}
          </span>
        )
      })}
    </span>
  )
}
