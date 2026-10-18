/**
 * The property panel: a bottom-right sun button opening a two-category sheet.
 *
 * 主题 tunes the environment: the wallpaper (switch, add, delete) and the text
 * colors (published over the shell's label tokens). 亮暗 is deliberately NOT
 * offered here — the shell's own settings own that preference, and nothing this
 * plugin paints depends on it any more.
 * 控件 holds one tab per glass surface — the capsule and every layer — each a
 * registry-built slider group. Every row is registry-driven; adding a knob or
 * a layer needs no change here.
 *
 * Plain DOM on purpose — the surfaces it tunes live outside the app's React
 * tree. Every listener is registered through `listen`/`sheetListen` so
 * `destroy` leaves nothing behind.
 */
import { type LiquidGlass } from './liquid-glass.ts';
import { type SkinEngine, type SkinState } from './skin.ts';
export declare class SunPanel {
    private readonly glass;
    private readonly skin;
    private readonly state;
    private readonly themeSpec;
    /** Rebuilt when the 主题色 changes (see buildTabs), so not readonly. */
    private tabs;
    private activeTab;
    private category;
    private readonly button;
    private readonly panel;
    private readonly rows;
    private readonly foot;
    private readonly tabBar;
    /** Listeners of the currently rendered sheet; swapped on tab change. */
    private sheetTeardown;
    /** Structural listeners living for the whole panel lifetime. */
    private teardown;
    constructor(glass: LiquidGlass, state: SkinState, skin: SkinEngine);
    /** Append the button and the sheet to `parent` (document.body). */
    /**
     * Re-render the sheet when the shell flips its scheme: the rows of a `schemeGlass`
     * layer show the scheme's 浓度/亮度 (skin.ts effectiveValues), so the numbers on
     * screen would otherwise be one theme stale. Read-only — the panel never writes
     * the preference.
     */
    private startSchemeWatch;
    mount(parent: HTMLElement): void;
    /** Re-render the active sheet (used after async wallpaper loads). */
    rerender(): void;
    private listen;
    private sheetListen;
    /** The tab list. Rebuilt when a 主题色 changes: which knobs a layer lists
     *  depends on the theme (the colour ones disappear while a preset owns the tint),
     *  and the specs are a snapshot — a stale list would keep showing them. */
    private buildTabs;
    private buildButton;
    private buildHead;
    /** The two top-level chips: 主题 / 控件. */
    private buildCategoryBar;
    private switchCategory;
    /** Which chips read active, and whether the layer tab strip shows at all. */
    private syncCategoryChrome;
    private buildTabBar;
    private activate;
    /** Rebuild the sheet for the active category (listeners swapped with it). */
    private renderSheet;
    /** The 主题 sheet: 壁纸 / 文字颜色. */
    private renderThemeSheet;
    /** The 主题色 swatches: label-free by request, so the colour IS the control.
     *  Clicking writes the id, commits, and re-marks in place (the container is
     *  discarded with the sheet, so the plain listener needs no teardown). */
    private fillThemeSwatches;
    /** Apply the shared state and persist it: every row's write goes through
     *  here, so the engine and the stored copy can never disagree. */
    private commit;
    private renderControlsSheet;
    private buildSection;
    private buildRow;
    private buildThemeFoot;
    private buildControlsFoot;
    /** Remove every element and listener this panel owns. */
    destroy(): void;
}
//# sourceMappingURL=sun-panel.d.ts.map