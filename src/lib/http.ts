/** Fetch JSON from a path relative to the app's BASE_URL, throwing on non-2xx.
 *  Centralises the BASE_URL prefix + `res.ok` check + parse shared by every
 *  data-loading effect in App.tsx (stores, trees, boundary). */
export async function fetchJson<T = unknown>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`, signal ? { signal } : undefined)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}
