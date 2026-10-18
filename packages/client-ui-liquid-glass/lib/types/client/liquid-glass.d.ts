/**
 * Liquid Glass — the draggable refraction capsule, a 1:1 port of Shu Ding's
 * liquid-glass.js (https://github.com/shuding/liquid-glass, 2025). The
 * original is a paste-into-console IIFE; this module keeps its shader math,
 * DOM structure, inline styles, drag physics, and displacement-map pipeline
 * byte-for-byte in behavior, and adds only what plugin lifecycle requires:
 * parameterized surface/backdrop values, listener teardown on destroy, and a
 * visibility switch for the property panel.
 *
 * How it works: a canvas renders an RGBA displacement map from the fragment
 * function (the rounded-rect signed distance field smoothstepped into a lens
 * bulge); an SVG `feImage` carries that map into an `feDisplacementMap`, and
 * the capsule's `backdrop-filter: url(#filter)` refracts whatever the page
 * paints behind it. Refraction needs refraction-worthy content behind the
 * glass — over flat solid colors the effect is invisible by construction.
 */
/** The tunable surface and shader values; the defaults ARE the original demo. */
export interface LiquidGlassParams {
    /** Capsule width in px. */
    width: number;
    /** Capsule height in px. */
    height: number;
    /** Capsule corner radius in px (the demo capsule: height/2 = 150). */
    radius: number;
    /** Frosted white tint alpha over the capsule (0 = the original's clear glass). */
    density: number;
    /** Backdrop-filter blur in px behind the refraction (the glass blur). */
    glassBlur: number;
    /** Backdrop-filter contrast. */
    contrast: number;
    /** Backdrop-filter brightness. */
    brightness: number;
    /** Backdrop-filter saturation. */
    saturation: number;
    /**
     * Edge softening in px along the capsule's height, on the same px knob every
     * glass layer uses. The fragment works in normalized uv, so the width is
     * divided by the capsule's height to reach it — which also keeps the lens
     * proportional when the capsule is resized.
     */
    edgeSoftness: number;
    /** Refraction strength multiplier over the smoothstepped displacement. */
    refraction: number;
    /** Tint hue (degrees); only visible once tintSaturation leaves 0. */
    tintHue: number;
    /** Tint saturation (0 = the original's pure-white tint). */
    tintSaturation: number;
    /** Rim shadow strength: 1 = the original's shadow, 0 = none. */
    rimStrength: number;
    /** Decorative border ring width in px (0 = none). */
    borderWidth: number;
    /** Decorative border ring opacity. */
    borderOpacity: number;
    /** Static grain overlay strength (0 = none). */
    grain: number;
}
/** The original demo's look: clear tint, no blur, and the demo's 0.15 edge
 *  offset expressed as the px width that offset covers on the demo's capsule. */
export declare const LIQUID_GLASS_DEFAULTS: LiquidGlassParams;
/** The capsule's rim shading at one strength: the demo's shadow with its two
 *  alphas scaled (1 = the original, 0 = none). Shared with the skin engine,
 *  which publishes the same string per layer. */
export declare function rimShadowCss(strength: number): string;
/** The capsule tint colour: the original's frosted white at saturation 0; the
 *  lightness derives from the saturation (same curve as the layers' builder —
 *  at full lightness every hue is white and the hue knob would do nothing). */
export declare function tintCss(density: number, hue: number, saturation: number): string;
/** The decorative ring at one width/opacity, as an INSET box-shadow segment
 *  ('' when the width is 0) — it composes onto the rim string, paints inside
 *  the sheet (never clipped by the viewport or a neighbouring column), and
 *  never affects layout. */
export declare function ringShadowCss(width: number, opacity: number): string;
/** The grain colour matrix for one intensity (0..1): mid-grey noise whose alpha
 *  the intensity scales — 0 is an exact identity stage. */
export declare function grainMatrixValues(intensity: number): string;
/**
 * Append the de-banding dither stage after `lastResultName`: per-pixel noise
 * added to the filter output. An 8-bit backdrop pushed through contrast and
 * brightness levels without dithering shows the wallpaper gradient's
 * quantization as hard bands (curved ones once displaced); a dither amplitude
 * of ±3/255 breaks the band edges while staying invisible as noise — smaller
 * amplitudes are swallowed whole by the 8-bit raster (measured: ±1 and ±2
 * change not a single pixel). Every glass filter — the capsule's and every
 * layer's — ends with this stage, closed by an alpha mask that keeps the
 * backdrop's own transparency.
 */
export declare function appendDitherStage(ns: 'http://www.w3.org/2000/svg', filter: SVGFilterElement, lastResultName: string): void;
/** Utility functions — verbatim from the original; shared with the layer refraction filters. */
export declare function smoothStep(a: number, b: number, t: number): number;
export declare function roundedRectSDF(x: number, y: number, width: number, height: number, radius: number): number;
/**
 * The draggable glass capsule. The class body mirrors the original `Shader`:
 * same element tree, same inline cssText, same event wiring and constrain
 * math; parameters replace the literals the demo baked in.
 */
export declare class LiquidGlass {
    readonly id: string;
    /** Viewport boundary offset while dragging. */
    readonly offset = 10;
    /** Displacement-map supersampling; the original ships 1. */
    readonly canvasDPI = 1;
    params: LiquidGlassParams;
    container: HTMLDivElement;
    svg: SVGSVGElement;
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    feImage: SVGFEImageElement;
    feDisplacementMap: SVGFEDisplacementMapElement;
    grainMatrix: SVGFEColorMatrixElement;
    private readonly fragment;
    private teardown;
    constructor(params?: Partial<LiquidGlassParams>);
    private createElement;
    private constrainPosition;
    private setupEventListeners;
    /** Recompute the displacement map from the current fragment parameters. */
    updateShader(): void;
    /** Mount the filter SVG and the capsule under `parent` (the original's appendTo). */
    appendTo(parent: HTMLElement): void;
    /** Apply changed surface/shader values; only the touched pipeline stages re-run. */
    updateParams(next: Partial<LiquidGlassParams>): void;
    /** Show or hide the capsule (the filter SVG stays mounted either way).
     *
     *  Hiding is a real saving, not just an opacity trick: `display: none` takes
     *  the element out of the render tree, so its `backdrop-filter` (the two noise
     *  stages and the displacement) stops being evaluated at all — the capsule is
     *  the one glass element this skin paints for no UI purpose. Nothing else
     *  depends on it being on screen: every layer's field is measured against the
     *  capsule's NUMBERS (`setLensReference`), never its box, so the layers cannot
     *  tell the difference. */
    setVisible(visible: boolean): void;
    /** Whether the capsule is currently on screen (the panel's toggle reads it so
     *  its label starts truthful). */
    isVisible(): boolean;
    /** Remove every element and listener this instance owns. */
    destroy(): void;
}
//# sourceMappingURL=liquid-glass.d.ts.map