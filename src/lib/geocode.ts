import type { CityDef } from '../cities'

export interface GeocodeResult {
  lng: number
  lat: number
  label: string
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

// Nominatim usage policy: max 1 req/s, no heavy autocomplete. Callers must
// debounce (see AddressSearch) - this module only builds the request.
export async function searchCityAddress(
  city: CityDef,
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const { minLat, maxLat, minLng, maxLng } = city.bounds
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '5',
    countrycodes: city.countryCodes,
    // viewbox is lng1,lat1,lng2,lat2; bounded=1 restricts results to it
    viewbox: `${minLng},${maxLat},${maxLng},${minLat}`,
    bounded: '1',
  })
  const res = await fetch(`${NOMINATIM}?${params}`, { signal })
  if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status})`)
  const data: Array<{ lon: string; lat: string; display_name: string }> = await res.json()
  return data
    .map((r) => ({ lng: Number(r.lon), lat: Number(r.lat), label: r.display_name }))
    .filter((r) => isInCity(city, r.lng, r.lat))
}

export function isInCity(city: CityDef, lng: number, lat: number): boolean {
  const { minLat, maxLat, minLng, maxLng } = city.bounds
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng
}
