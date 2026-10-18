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
    id: string;
    /** The file name, as the picker's tooltip shows it. */
    name: string;
}
/** Prefix on every id of the shipped set (`Default/<file>`), as the node half
 *  reports them — the piece of an id that says "this one came with the plugin". */
export declare const DEFAULT_DIR_PREFIX = "Default/";
/** URL an <img>/background can load one directory wallpaper by. */
export declare function wallpaperUrl(id: string): string;
/** Both wallpaper layers as the node half reports them. */
export interface WallpaperListing {
    /** The user's own uploads (deletable, pinnable). */
    user: WallpaperEntry[];
    /** The shipped time-rotation set (plugin-managed). */
    defaults: WallpaperEntry[];
}
/** The current listing, or an empty one when the service is unreachable. */
export declare function listWallpapers(): Promise<WallpaperListing>;
/** Upload an image file into the wallpaper directory. Throws on failure. */
export declare function addWallpaper(file: File): Promise<void>;
/** Remove one user wallpaper from the directory. Throws on failure. */
export declare function deleteWallpaper(id: string): Promise<void>;
//# sourceMappingURL=wallpaper-store.d.ts.map