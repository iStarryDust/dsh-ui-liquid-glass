/**
 * Liquid-glass skin, node half. Owns the plugin's data directory under the
 * Harness home — `<home>/ui-liquid-glass/wallpapers` — and serves it to the
 * browser half over the host web server:
 *
 * - `GET /ui-liquid-glass/wallpapers` → JSON list of the image files present;
 * - `GET /ui-liquid-glass/wallpapers/<file name>` → the image bytes;
 * - `POST /ui-liquid-glass/wallpapers/<file name>` (body = image bytes) → add;
 * - `DELETE /ui-liquid-glass/wallpapers/<file name>` → remove.
 *
 * First activation seeds the directory with the shipped wallpapers (never
 * overwriting), so user wallpapers survive plugin reinstalls and upgrades.
 * Hosts without a web server (the desktop shell) never settle the route; the
 * client detects the missing endpoint and hides the picker's add/delete.
 */
/** The web-server route prefix for this plugin's wallpaper files. */
export declare const WALLPAPER_ROUTE = "/ui-liquid-glass/wallpapers";
/** The web-server route prefix for the bundled UI fonts. Unlike wallpapers
 *  these are NOT seeded into the data directory — they ship with the package
 *  (`assets/fonts`, carried by `files` and the build's sync) and are served
 *  straight from it, read-only. Uninstalling the plugin removes them. */
export declare const FONT_ROUTE = "/ui-liquid-glass/fonts";
/** The context slice this plugin reads (services through the reflect store). */
interface HostContext {
    reflect?: {
        get(name: string, strict?: boolean): unknown;
    };
}
/** `<home>/ui-liquid-glass/wallpapers`, honoring DSH_HOME like the CLI does. */
export declare function wallpaperDirectory(): string;
/** Host plugin body: data directory + wallpaper route (dark on desktop). */
export declare function apply(ctx: HostContext): () => void;
export {};
//# sourceMappingURL=index.d.ts.map