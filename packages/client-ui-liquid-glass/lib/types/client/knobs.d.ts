/**
 * Knob registry: the single declaration of every tunable a glass layer exposes.
 * Labels, ranges, steps, and value formatting live here only — the property
 * panel builds its rows from this table and the engine reads the same keys, so
 * a new knob is one entry plus the layer that lists it.
 */
/** Every knob key a layer's state group may carry. */
export type KnobKey = 'density' | 'radius' | 'refraction' | 'edgeSoftness' | 'glassBlur' | 'contrast' | 'brightness' | 'saturation' | 'tintHue' | 'tintSaturation' | 'rimStrength' | 'borderWidth' | 'borderOpacity' | 'grain' | 'flowStiffness' | 'flowDamping' | 'flowStretch' | 'flowDroplet' | 'hoverAlpha';
/** One knob's presentation and range contract. */
export interface KnobSpec {
    key: KnobKey;
    label: string;
    min: number;
    max: number;
    step: number;
    format: (value: number) => string;
}
/** The shared value formatters: one declaration for the whole registry, so a
 *  new knob reads like every other and the panel's own rows (the capsule tab,
 *  the 主题 rows) format identically. */
export declare const px: (value: number) => string;
export declare const ratio: (value: number) => string;
export declare const degrees: (value: number) => string;
/**
 * The shared 十四根 in the capsule's order (its two shape knobs excluded).
 * Every glass layer exposes exactly this set, in this order, with these ranges,
 * so one tab reads and is managed like every other.
 */
export declare const KNOBS: Record<KnobKey, KnobSpec>;
/** The shared fourteen, in capsule order. */
export declare const GLASS_KNOBS: readonly KnobKey[];
/** The flow motion's four, appended to the glass set on the 高亮条 tab. */
export declare const FLOW_KNOBS: readonly KnobKey[];
//# sourceMappingURL=knobs.d.ts.map