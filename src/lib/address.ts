import type { StoreAddress } from '../types'

/** MapLibre stringifies nested feature properties, so an address read off a
 *  rendered map feature arrives as a JSON string; the copy held in React state
 *  is still a live object. Normalise both into a StoreAddress (or null). */
export function parseAddress(value: unknown): StoreAddress | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as StoreAddress
    } catch {
      return null
    }
  }
  return value as StoreAddress
}

/** One-line address, e.g. "12 Rue de Rivoli, 75001 Paris". Missing parts are
 *  omitted; returns null when nothing usable is present. */
export function formatAddress(value: unknown): string | null {
  const a = parseAddress(value)
  if (!a) return null
  const street = [a.housenumber, a.street].filter(Boolean).join(' ')
  const locality = [a.postcode, a.city].filter(Boolean).join(' ')
  const line = [street, locality].filter(Boolean).join(', ')
  return line || null
}
