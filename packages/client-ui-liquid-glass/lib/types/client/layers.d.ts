/**
 * Layer registry: the single declaration of every glass layer the skin
 * paints. A layer owns its tab label, its placement, its starting values, the
 * knobs it exposes, and — the part that keeps the skin generic — the hooks it
 * binds to.
 *
 * WHERE the glass lands is the layer's `placement` (see
 * {@link LayerPlacement}): on the app element itself through the
 * `--lg-<layer>-*` variables, on a plugin-owned sheet fixed behind the app
 * (the columns and pages), or on a sheet mounted inside the host (any host
 * that CONTAINS other glassed controls — a dialog, the composer card, the
 * conversation header — because a nested `backdrop-filter` renders as an
 * opaque black plate instead of glass).
 *
 * Host selectors never name a plugin: they are the shell's structural locals,
 * its ARIA roles, and the app's own theme tokens. Every layer's hook list is
 * tried in order, first match wins.
 */
import { type KnobKey } from './knobs.ts';
/**
 * Where a layer's glass is painted.
 *
 * - `'element'` — on the app element itself, through its `--lg-<id>-*`
 *   consumers. For single elements that follow content (the composer card's
 *   own controls, the selection row, a menu surface).
 * - `'behind'` — on a plugin-owned surface fixed BEHIND the app, tracking the
 *   host's box. Used for the columns and pages: a `backdrop-filter` element
 *   must not sit inside another one's subtree, and a sheet between the
 *   wallpaper and the UI is exactly the seam those layers want.
 * - `'inside'` — on a plugin-owned surface mounted INSIDE the host (absolute,
 *   `inset: 0`, `z-index: -1`, first child), so it paints above the host's own
 *   background and below its content. Used for hosts that CONTAIN other glassed
 *   controls (a dialog, the composer card, the conversation header): while the
 *   host carries the filter, every control inside it samples an empty backdrop
 *   — Chromium isolates the nested one — and the filter's dither stage turns
 *   that emptiness into an OPAQUE BLACK plate. The surface keeps the host's own
 *   glass (its knobs stay live) while the descendants get their own.
 */
export type LayerPlacement = 'element' | 'behind' | 'inside';
/** Identifier of a glass layer; also the `--lg-<id>-*` variable namespace. */
export type LayerId = 'sidebar' | 'center' | 'rightbar' | 'page' | 'home' | 'input' | 'question' | 'convheader' | 'highlight' | 'newchat' | 'buttons' | 'menu';
/** One layer's knob values. */
export type LayerValues = Record<string, number>;
/**
 * 浓度/亮度 by the SHELL's scheme, for the layers that cover a large surface.
 * Glass has to hold up against two very different backdrops: a light wallpaper
 * wants a frosted white plate (a wash plus a lift), while over a dark photo any
 * white wash turns it grey — dark wants plain darkening instead. These are the
 * shipped pairs (2026-10-13.17, the values the author tuned); a layer opts in
 * with `schemeGlass: true`, and its own 浓度/亮度 knobs stay the MANUAL fallback
 * the moment either one is dragged (skin.ts `effectiveValues`, sun-panel.ts's
 * note). Nothing else about a layer follows the scheme.
 */
export declare const SCHEME_GLASS: {
    readonly light: {
        readonly density: 0.5;
        readonly brightness: 1.2;
    };
    readonly dark: {
        readonly density: 0;
        readonly brightness: 0.5;
    };
};
/** The two knobs the scheme drives (and the panel hands back on a drag). */
export declare const SCHEME_KNOBS: readonly KnobKey[];
/** Layer tint strategy: turns the layer's knob values into its fill colour. */
type TintBuilder = (values: LayerValues) => string;
/** Structural layout locals of the three-column shell. */
export declare const COLUMN: {
    sidebar: string;
    center: string;
    rightbar: string;
};
/** One flow ZONE: a group of candidate hooks that share one mark. Zones are
 *  independent — the sidebar's highlight and the settings nav's highlight
 *  stay lit at the same time, each zone exactly one stop. */
export interface FlowStop {
    zone: 'settings' | 'sidebar';
    /** Candidate hooks, tried in order, first live match wins. */
    selectors: readonly string[];
}
/** The flow highlight's candidate groups — the registry's one declaration of
 *  where the 高亮条 glass may stop, whoever renders the rows. The settings
 *  dialog's active nav cell is its own zone (the nav is the slot registry's,
 *  so plugin-added sections flow exactly like the built-in ones); the
 *  sidebar zone tries the open navigation row (`aria-current='page'`), the
 *  click tracker's row (the freshest human choice, and the only mark lists
 *  whose rows carry no ARIA selection ever get), then the shell's selected
 *  list row (`aria-selected`).
 *
 * There is deliberately no colour scan for the selection token: the shell
 * paints hover and selection with the SAME token (`--dsw-alias-interactive-bg-hover`
 * on session rows), so a computed-colour scan cannot tell a hovered row from a
 * selected one. ARIA is the shell's actual selection contract; hover keeps its
 * own tint-only rule. */
export declare const FLOW_STOPS: readonly FlowStop[];
/**
 * The 按钮 layer's areas: the structural containers its capsules land in. The
 * stylesheet dresses these same containers (skin.css), and the FIRST one that
 * is present also hosts the layer's refraction filter — a CSS-dressed layer has
 * no single element of its own, and the displacement field has to be measured
 * on a real box or 折射强度/边缘柔边 have nothing to shape. One box, one field,
 * every other consumer slices it (the same contract the 菜单 layer's
 * multi-element rule already rides). Ordered stable-first, and never a
 * container that sits inside another layer's glass (a nested backdrop-filter
 * cannot paint its own functions).
 */
export declare const BUTTON_AREAS: string[];
/** Every glass layer, in property-panel tab order. */
export interface LayerSpec {
    id: LayerId;
    label: string;
    /** Where this layer's glass is painted (see {@link LayerPlacement}). */
    placement: LayerPlacement;
    /** App element hooks, tried in order; empty when the layer owns its element.
     *  A CSS-dressed layer (placement 'element', no element of its own) still
     *  lists them: the first live match is where the refraction filter is
     *  measured. */
    hosts: readonly string[];
    /** Knobs the layer's tab exposes, in order. */
    knobs: readonly KnobKey[];
    /** Starting values; a knob missing here starts at the shared neutral. */
    defaults: LayerValues;
    /** Fill colour builder. */
    tint: TintBuilder;
    /** True for the big surface layers: 浓度/亮度 come from `SCHEME_GLASS` while they are
     *  on auto (the shipped state), and from this layer's own values once the user
     *  drags either knob. */
    schemeGlass?: boolean;
    /** True when a 主题色 preset owns this layer's colour (see layers.ts themeTint):
     *  its 色调/色调饱和度 knobs are hidden while a preset with a wash is active. */
    themeOwned?: boolean;
    /** Whether the surface carries the capsule's rim shading (see surface.ts). */
    rim?: boolean;
    /** Paint order inside the plugin's surface stack; later layers sit on top. */
    stack?: number;
    /** Fly ONE shared glass lens between this layer's hosts (flow-lens.ts)
     *  instead of painting each host — the hosts are candidate stops, never
     *  painted themselves. */
    flow?: boolean;
    /** This layer also owns the shell's hover fills: the engine publishes
     *  `--lg-hover-tint` from its 色调/色调饱和度 + 悬停浓度 (skin.ts), so controls
     *  can stay pure glass (density 0) and still show hover feedback. */
    hover?: boolean;
}
/** Neutral value of every knob: what a layer starts from before its defaults. */
export declare const NEUTRAL: Record<KnobKey, number>;
/** The values every layer shares — **the shipped look** (2026-10-13.7: the
 * author's own tuned values, promoted from a live session, so a fresh install
 * and 重置 open on the look that was actually tuned rather than on a neutral
 * baseline). Each entry below restates only what differs.
 *
 * It used to be derived from the capsule's defaults ("a fresh layer IS the
 * capsule"); it is not any more, deliberately: the capsule's own params are not
 * persisted, so the two sets are independent now (LIQUID_GLASS_DEFAULTS stays
 * the capsule's, and the 胶囊 tab still starts there). 圆角 stays a shape knob —
 * layers keep the shell's panel radius, not the capsule's pill. 边缘柔边 needs no
 * conversion: the fields read it against the capsule's live height (refraction.ts).
 */
export declare const DEFAULT_GLASS: LayerValues;
/**
 * Build a layer's tint colour: `hsla(tintHue, tintSaturation%,
 * lightness(density × scale))`. The lightness derives from the saturation —
 * 100% at saturation 0 (byte-identical to the old plain white) and dropping to
 * ~62% as the tint takes colour, because at full lightness every hue is the
 * same white and the 色调 knob would have nothing to turn.
 */
export declare const buildTint: (scale: number) => TintBuilder;
/** Point the theme-aware tints at an `"r, g, b"` triple, or at null for none. */
export declare function setThemeWash(rgb: string | null): void;
/**
 * The tint of the layer the theme colour owns (新会话 — the new-session pill and
 * the settings' value buttons). Alpha still follows the tint contract
 * (`浓度 × scale`); only the COLOUR half yields, because a theme colour is a
 * colour, not a hue: 纯白 and 高雅黑 cannot be written as `hsl(h, s%, 100−s·50)`
 * (that formula bottoms out at mid grey). With no theme colour chosen this is
 * the ordinary builder, byte for byte.
 */
export declare const themeTint: (scale: number) => TintBuilder;
export declare const LAYERS: readonly LayerSpec[];
/** Apply a layer's defaults on top of the shared neutral values. */
export declare function defaultValues(layer: LayerSpec): LayerValues;
export {};
//# sourceMappingURL=layers.d.ts.map