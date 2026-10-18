/**
 * The layered skin engine. Mounting tags `<body data-lg-skin>`, mounts the
 * wallpaper host, one refraction filter and (where the layer calls for it) one
 * glass surface per layer, and injects the static skin stylesheet (see
 * skin.css). Every layer's look is driven by `--lg-*` custom properties that
 * {@link apply} recomputes from the layer state, so live tuning never rebuilds
 * CSS.
 *
 * Layer metadata — labels, defaults, knobs, hosts — lives in layers.ts; knob
 * ranges live in knobs.ts. Nothing here names a plugin: the hooks are the
 * shell's structural locals, its ARIA roles, and the app's own theme tokens, so
 * any present or future plugin that renders into these regions inherits the
 * skin automatically.
 */
import { type LayerId, type LayerSpec, type LayerValues } from './layers.ts';
/** How the theme picks its wallpaper. */
export type WallpaperMode = 
/** The time set: one of the directory's images per time bucket, switching
 *  automatically through the day (the bucket table is scheme-independent). The
 *  default. */
'time'
/** One specific directory file, pinned regardless of time or scheme. */
 | 'static';
/** Wallpaper layer state. */
export interface WallpaperState {
    /** Which wallpaper strategy is active (see {@link WallpaperMode}). */
    mode: WallpaperMode;
    /** `static` mode's directory file name; null in the automatic modes. */
    imageId: string | null;
}
/**
 * The 主题色 presets, in swatch order — the panel shows ONLY the swatch (no names),
 * so the colour itself is the label.
 *
 * `ramp` overrides the shell's accent steps: its whole default-colour chain
 * (`--dsw-alias-brand-primary-*`, `--dsw-alias-link`, `--dsw-alias-state-business-primary`)
 * resolves through the static deepseek ramp, so pointing those four steps at a
 * preset re-colours every place the shell paints its own default colour — the
 * 后台任务 panel's action buttons, the settings' update row, dockkit accents.
 * `wash` is the tint the 新会话 layer takes (layers.ts `themeTint`).
 * `blue` publishes NOTHING: it is the shell's own look. It is no longer the
 * DEFAULT preset (the shipped default is 金 — see defaultTheme); choosing it
 * simply hands the shell's own colours back.
 */
export type ThemeColorId = 'blue' | 'gold' | 'white' | 'black';
export interface ThemeColorPreset {
    id: ThemeColorId;
    /** The swatch the control paints — the only thing it shows. */
    swatch: string;
    /** The shell ramp steps, or null for "leave the shell's own". */
    ramp: Record<'400' | '450' | '500' | '600', string> | null;
    /** The 新会话 wash as an `"r, g, b"` triple, or null for "the layer's own". */
    wash: string | null;
}
export declare const THEME_COLORS: readonly ThemeColorPreset[];
/**
 * Theme-panel state: the text colours the 主题 category tunes — `null` means
 * the shell's own palette stands untouched. (The former wallpaper look values
 * — 壁纸明暗/光斑色相/网格浓度 — died with the grid test wallpaper: they only
 * ever shaped its blobs and base tone, and the directory wallpapers are photos.)
 */
export interface ThemeState {
    textHue: number | null;
    textLight: number | null;
    /** The 主题色 preset (see THEME_COLORS). */
    themeColor: ThemeColorId;
}
/** The whole persisted skin state. */
export interface SkinState {
    theme: ThemeState;
    wallpaper: WallpaperState;
    /** Per-layer opt-outs for the scheme-driven 浓度/亮度: `false` = manual. Absent =
     *  auto for a `schemeGlass` layer (the shipped state); meaningless elsewhere. */
    schemeAuto: Record<string, boolean>;
    layers: Record<LayerId, LayerValues>;
}
/** Stamp of the running skin, published on <body> and on the stylesheet tag so
 *  a stale page (browser cache, ungated reload) is one devtools lookup away. */
export declare const SKIN_VERSION = "2026-10-13.32";
/**
 * Build a layer's backdrop-filter chain. The leading `url()` is the layer's
 * refraction map; the rest is the frosted stack the capsule's own glass uses,
 * in the same order. Every layer — capsule included — carries the same chain
 * shape, so 折射强度/边缘柔边/颗粒感 mean the same thing on every tab.
 *
 * A sample the displacement pushes outside the element (a small control, or a
 * container whose box the field was not generated for) comes back TRANSPARENT
 * rather than as an opaque black plate: the dither stage that ends the chain
 * preserves the backdrop's own alpha (see appendDitherStage). That is what
 * keeps a container's own glass from blacking out the controls inside it.
 *
 * `none` is returned only when the whole chain would be an identity operation:
 * a backdrop-filter that filters nothing still creates a backdrop root, and a
 * backdrop root inside another layer's subtree stops that layer's own filter
 * functions from applying. Collapsing to `none` keeps clear layers free.
 */
export declare function backdropChain(layer: LayerSpec, values: LayerValues): string;
export declare class SkinEngine {
    private style;
    private wallpaper;
    private surfacesHost;
    /** Body-level container of the flow lens — above the surface stack, below
     *  every app surface (see flow-lens.ts for why the lens lives there). */
    private flowHost;
    /** The 高亮条 layer's shared flying lens. */
    private flow;
    private readonly surfaces;
    private readonly refractions;
    private readonly attachedHosts;
    private readonly nestedWarned;
    /** The host each element layer's nesting was last checked on (see
     *  warnIfNested — the walk is not worth repeating for the same element). */
    private readonly nestedChecked;
    private sweepTimer;
    private hostObserver;
    private hostScanTimer;
    /** Last host scan, so scans run on the leading edge of a DOM change. */
    private lastScanAt;
    /** Per-frame re-check window after a reveal flip (see REVEAL_BURST_MS). */
    private revealBurstDeadline;
    private revealBurstRunning;
    private markerObserver;
    /** The user's uploads (root files), cached for the picker. */
    wallpaperUserFiles: string[];
    /** The shipped Default set, cached for the time mapping and picker. */
    wallpaperDefaultFiles: string[];
    /** The time mode's half-minute bucket check. */
    private schemeObserver;
    private wallpaperClock;
    /**
     * The ONE shared layer state: the property panel's rows write this object and
     * every apply() consumes it. Handing out two loaded copies would fork the
     * data — rows would move while the engine kept re-applying the stale
     * snapshot, and every backdrop knob would look dead.
     */
    readonly state: SkinState;
    reloadWallpapers(): Promise<void>;
    /** Inject the stylesheet, mount the wallpaper and every layer, enable the skin. */
    mount(): void;
    /**
     * Run a host scan on the leading edge, and coalesce whatever arrives during
     * the spacing window into one trailing scan. A flip of a reveal attribute
     * additionally opens a short per-frame burst, because the reveal it starts
     * travels through a CSS transition that fires nothing (see REVEAL_BURST_MS).
     */
    private onHostMutation;
    private startRevealBurst;
    /** Whether any layer the scan could bind is still unbound. */
    private hasUnboundLayer;
    private scheduleHostScan;
    private runHostScan;
    /** Resolve every layer's host and (re)bind its surface and refraction map. */
    private attachHosts;
    /** Bind one layer to `host` (null: leave it unbound). */
    private bind;
    /**
     * A full-column sheet (页面, 首页) sits directly on its column's own glass —
     * stacking two glasses doubles the refraction and milks the doubled tints,
     * and turning the covered column's knobs would visibly change the sheet on
     * top. While a covering layer is bound, the centre surface keeps tracking
     * its box but paints nothing; lifting the cover restores it unchanged.
     */
    private syncColumnCover;
    /** First host hook that resolves, in the layer's declared order. */
    private findHost;
    /**
     * A backdrop-filter nested inside another one stops honouring its own filter
     * functions (measured in Chromium: blur/saturate/brightness/url() all render
     * identically once an ancestor filters the backdrop), so a nested layer can
     * only be tuned through its tint. Report it instead of leaving the panel
     * looking broken — with the register's own layers this never fires.
     */
    private warnIfNested;
    /** Follow the capsule sample's live size: every layer's refraction pull is
     *  expressed in the capsule's own pixels (refraction.ts), so a resized
     *  sample re-scales the whole skin's refraction with it. */
    setLensReference(width: number, height: number): void;
    /** The time mode's directory file for right now — what the picker highlights. */
    currentTimeWallpaper(): string | null;
    /** Recompute every `--lg-*` variable, surface, and refraction map. */
    apply(state: SkinState): void;
    /**
     * 文字颜色: when the theme panel has a hue/lightness pair, publish the four
     * label tokens as `--lg-text-*` and raise the `data-lg-text` gate that
     * skin.css's `!important` overrides hang on; otherwise retract everything so
     * the shell's own palette (including its live theme switches) stands. The
     * hierarchy is kept by lightness steps: primary > secondary > tertiary >
     * caption.
     */
    /**
     * 主题色: point the shell's accent ramp at the preset, and hand the 新会话 layer
     * its wash (layers.ts `themeTint` reads it back). The shell's default colour
     * chain — brand-primary, link, state-business-primary — all resolve through
     * `--dsw-static-deepseek-<step>`, so four steps re-colour every place the shell
     * paints its own default colour, its buttons included. 官方蓝 is the default
     * preset and publishes nothing (no ramp vars, wash null, gate down), so an
     * untouched install is byte-identical to the shell.
     */
    private applyThemeColor;
    private applyTextColors;
    /**
     * Paint the wallpaper host for the active mode:
     * - `time` — the bucket's image from the plugin's directory; when the
     *   directory is unreachable (desktop, server down) only the dark base shows.
     * - `static` — one pinned directory image.
     *
     * A static pin only paints while it still resolves: a pin of `null` (an old
     * store's shape) or one the loaded listing does not know any more (the file
     * was deleted out-of-band) falls back to the rotation instead of going dark —
     * "installed" has to mean the 默认壁纸 shows, not a black wall. Before the
     * listing arrives the pin paints by URL as before, so a pinned boot has no
     * flash of the rotation while the directory loads.
     */
    private paintWallpaper;
    /** The time mode's file for right now, from the bucket table; a bucket whose
     *  file is missing from the directory falls back to the set's first entry, so
     *  a pruned directory degrades instead of going dark. */
    private timeWallpaperFile;
    /**
     * Keep the time mode alive: a wall-clock check per half minute catches the
     * bucket change and re-runs the apply pass, which repaints the wallpaper host.
     * Nothing else moves the wallpaper any more — the set does not follow the
     * shell's 亮暗, so there is no attribute to watch.
     */
    private startWallpaperClock;
    /** What the time mode currently shows, as a change key. */
    /**
     * Re-apply when the shell flips its scheme: the `schemeGlass` layers' 浓度/亮度 are
     * scheme-driven (effectiveValues), so the paint has to follow. This is the ONLY
     * scheme dependence left in the skin — nothing here reads or writes the
     * preference itself, and there is no 亮暗 control (removed on request).
     */
    private startSchemeWatch;
    private wallpaperClockKey;
    /**
     * Track the open chat: clicking a sidebar row moves the `data-lg-current`
     * marker to it, which is the lens's freshest-choice candidate (and the only
     * mark lists without ARIA selection ever get). Rows are generic — list rows
     * of any plugin alike. The scan is scheduled right here because the marker
     * is not in the host observer's attribute filter: a click must retarget the
     * lens this frame, not after the next sweep.
     */
    private currentKey;
    private readonly onRowClick;
    private markCurrent;
    /**
     * The shell re-renders the session list on every switch, which can discard
     * the marked node — re-find the row by its stable row key (or its title) and
     * re-mark it.
     */
    private restoreMarker;
    /** Remove the stylesheet, hosts, layers, body tag, and every `--lg-*` variable. */
    destroy(): void;
}
/**
 * The values a layer actually paints with. For a `schemeGlass` layer on auto that
 * means the scheme's 浓度/亮度 (layers.ts SCHEME_GLASS) instead of its own; every other
 * knob — and every other layer — is untouched. Exported because the panel must read
 * the same numbers the engine paints, and the two may not drift apart.
 */
export declare function effectiveValues(layer: LayerSpec, state: SkinState): LayerValues;
/** Whether a layer's 浓度/亮度 are the scheme's right now (the panel's tab note). */
export declare function schemeDrives(layer: LayerSpec, state: SkinState): boolean;
/** The 主题 category's starting values: the shell's own text palette (no
 *  override — the `data-lg-text` gate stays down). */
export declare function defaultTheme(): ThemeState;
/**
 * Load the persisted state, falling back per knob to the registry defaults.
 * Reads both the current layout and the pre-registry (v1) one, where each layer
 * was a top-level key and four knobs had different names.
 */
export declare function loadSkinState(): SkinState;
export declare function saveSkinState(state: SkinState): void;
//# sourceMappingURL=skin.d.ts.map