/**
 * Custom wallpaper source: the plugin's directory under the Harness home
 * (`<home>/ui-liquid-glass/wallpapers`), served by the node half over the host
 * web server (`/ui-liquid-glass/wallpapers`). Two layers live there:
 *
 * - `Default/` — the shipped time-rotation set, managed by the plugin (read
 *   only over HTTP);
 * - the root — the user's own uploads (POST adds, DELETE removes).
 *
 * On hosts without the web server (desktop) every call resolves empty and the
 * theme hides the picker's add/delete.
 */

/** One wallpaper available to the theme: a file path relative to the directory. */
export interface WallpaperEntry {
  /** Path id (may carry the `Default/` prefix), unique within the directory. */
  id: string
  /** The file name, as the picker's tooltip shows it. */
  name: string
}

/** The base URL the node half serves the wallpaper directory under. Absolute,
 *  not relative to the document: the app may be mounted under a sub-path, and a
 *  relative route would then resolve below it and 404. Mirrors the node half's
 *  own WALLPAPER_ROUTE (src/index.ts) — the two halves cannot import each
 *  other, so this is the one place the string is restated. */
const WALLPAPER_ROUTE = '/ui-liquid-glass/wallpapers'

/** Prefix on every id of the shipped set (`Default/<file>`), as the node half
 *  reports them — the piece of an id that says "this one came with the plugin". */
export const DEFAULT_DIR_PREFIX = 'Default/'

/** URL an <img>/background can load one directory wallpaper by. */
export function wallpaperUrl(id: string): string {
  return `${WALLPAPER_ROUTE}/${id.split('/').map(encodeURIComponent).join('/')}`
}

/** Both wallpaper layers as the node half reports them. */
export interface WallpaperListing {
  /** The user's own uploads (deletable, pinnable). */
  user: WallpaperEntry[]
  /** The shipped time-rotation set (plugin-managed). */
  defaults: WallpaperEntry[]
}

function toEntries(names: unknown): WallpaperEntry[] {
  if (!Array.isArray(names)) return []
  return names
    .filter((name): name is string => typeof name === 'string')
    .map(name => ({ id: name, name }))
}

/** The current listing, or an empty one when the service is unreachable. */
export async function listWallpapers(): Promise<WallpaperListing> {
  try {
    const response = await fetch(WALLPAPER_ROUTE, { cache: 'no-store' })
    if (!response.ok) return { user: [], defaults: [] }
    const body = await response.json() as unknown
    if (body === null || typeof body !== 'object') return { user: [], defaults: [] }
    const { user, default: defaults } = body as { user?: unknown, default?: unknown }
    return { user: toEntries(user), defaults: toEntries(defaults) }
  } catch {
    return { user: [], defaults: [] }
  }
}

/** Upload an image file into the wallpaper directory. Throws on failure. */
export async function addWallpaper(file: File): Promise<void> {
  const response = await fetch(`${WALLPAPER_ROUTE}/${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: await file.arrayBuffer(),
  })
  if (!response.ok) throw new Error(`wallpaper upload failed (${String(response.status)})`)
}

/** Remove one user wallpaper from the directory. Throws on failure. */
export async function deleteWallpaper(id: string): Promise<void> {
  const response = await fetch(`${WALLPAPER_ROUTE}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(`wallpaper delete failed (${String(response.status)})`)
}
