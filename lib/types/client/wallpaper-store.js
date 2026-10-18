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
/** The base URL the node half serves the wallpaper directory under. Absolute,
 *  not relative to the document: the app may be mounted under a sub-path, and a
 *  relative route would then resolve below it and 404. Mirrors the node half's
 *  own WALLPAPER_ROUTE (src/index.ts) — the two halves cannot import each
 *  other, so this is the one place the string is restated. */
const WALLPAPER_ROUTE = '/ui-liquid-glass/wallpapers';
/** Prefix on every id of the shipped set (`Default/<file>`), as the node half
 *  reports them — the piece of an id that says "this one came with the plugin". */
export const DEFAULT_DIR_PREFIX = 'Default/';
/** URL an <img>/background can load one directory wallpaper by. */
export function wallpaperUrl(id) {
    return `${WALLPAPER_ROUTE}/${id.split('/').map(encodeURIComponent).join('/')}`;
}
function toEntries(names) {
    if (!Array.isArray(names))
        return [];
    return names
        .filter((name) => typeof name === 'string')
        .map(name => ({ id: name, name }));
}
/** The current listing, or an empty one when the service is unreachable. */
export async function listWallpapers() {
    try {
        const response = await fetch(WALLPAPER_ROUTE, { cache: 'no-store' });
        if (!response.ok)
            return { user: [], defaults: [] };
        const body = await response.json();
        if (body === null || typeof body !== 'object')
            return { user: [], defaults: [] };
        const { user, default: defaults } = body;
        return { user: toEntries(user), defaults: toEntries(defaults) };
    }
    catch {
        return { user: [], defaults: [] };
    }
}
/** Upload an image file into the wallpaper directory. Throws on failure. */
export async function addWallpaper(file) {
    const response = await fetch(`${WALLPAPER_ROUTE}/${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: await file.arrayBuffer(),
    });
    if (!response.ok)
        throw new Error(`wallpaper upload failed (${String(response.status)})`);
}
/** Remove one user wallpaper from the directory. Throws on failure. */
export async function deleteWallpaper(id) {
    const response = await fetch(`${WALLPAPER_ROUTE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok)
        throw new Error(`wallpaper delete failed (${String(response.status)})`);
}
//# sourceMappingURL=wallpaper-store.js.map