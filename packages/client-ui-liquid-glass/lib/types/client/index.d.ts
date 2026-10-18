/**
 * Liquid-glass skin, browser half: mounts the draggable liquid-glass capsule
 * (a 1:1 port of Shu Ding's liquid-glass.js) over the app, the layered skin
 * engine (wallpaper, one glass surface per layer, driven by the app's own theme
 * tokens), and the bottom-right sun button whose two-category sheet retunes the
 * theme (壁纸 / 配色 / 文字) and every glass layer live. No services and
 * no slots — the whole surface is plugin-owned DOM under document.body, torn
 * down with the plugin.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map