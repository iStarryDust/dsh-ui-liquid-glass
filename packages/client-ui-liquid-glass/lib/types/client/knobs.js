/**
 * Knob registry: the single declaration of every tunable a glass layer exposes.
 * Labels, ranges, steps, and value formatting live here only — the property
 * panel builds its rows from this table and the engine reads the same keys, so
 * a new knob is one entry plus the layer that lists it.
 */
/** The shared value formatters: one declaration for the whole registry, so a
 *  new knob reads like every other and the panel's own rows (the capsule tab,
 *  the 主题 rows) format identically. */
export const px = (value) => `${Math.round(value)}px`;
export const ratio = (value) => value.toFixed(2);
export const degrees = (value) => `${Math.round(value)}°`;
/**
 * The shared 十四根 in the capsule's order (its two shape knobs excluded).
 * Every glass layer exposes exactly this set, in this order, with these ranges,
 * so one tab reads and is managed like every other.
 */
export const KNOBS = {
    density: { key: 'density', label: '浓度', min: 0, max: 1, step: 0.05, format: ratio },
    // The capsule's own 圆角 spec — the capsule tab lists this same entry — so
    // every layer can reach the pill look, not just the capsule.
    radius: { key: 'radius', label: '圆角', min: 0, max: 280, step: 2, format: px },
    refraction: { key: 'refraction', label: '折射强度', min: -3, max: 6, step: 0.05, format: ratio },
    // The soft edge is a width, so it reads in px like every other length knob.
    // Every field reads it against the capsule's own height — the capsule's own
    // reading — so one value is one falloff on the capsule and on every layer
    // alike (see refraction.ts).
    edgeSoftness: { key: 'edgeSoftness', label: '边缘柔边', min: 0, max: 100, step: 1, format: px },
    glassBlur: { key: 'glassBlur', label: '模糊', min: 0, max: 40, step: 1, format: px },
    // 1% steps: the ratio display's own last digit, so a drag moves one visible
    // notch and the neutral 1.00 sits exactly on a tick.
    contrast: { key: 'contrast', label: '对比度', min: 0.5, max: 2, step: 0.01, format: ratio },
    brightness: { key: 'brightness', label: '亮度', min: 0.5, max: 1.6, step: 0.05, format: ratio },
    saturation: { key: 'saturation', label: '饱和度', min: 0, max: 3, step: 0.05, format: ratio },
    // --- The surface-craft set, shared by every glass control (layer or capsule):
    tintHue: { key: 'tintHue', label: '色调', min: 0, max: 360, step: 5, format: degrees },
    tintSaturation: { key: 'tintSaturation', label: '色调饱和度', min: 0, max: 1, step: 0.05, format: ratio },
    rimStrength: { key: 'rimStrength', label: '边缘立体', min: 0, max: 2, step: 0.05, format: ratio },
    borderWidth: { key: 'borderWidth', label: '描边宽度', min: 0, max: 4, step: 0.5, format: px },
    borderOpacity: { key: 'borderOpacity', label: '描边透明度', min: 0, max: 1, step: 0.05, format: ratio },
    grain: { key: 'grain', label: '颗粒感', min: 0, max: 1, step: 0.05, format: ratio },
    // --- The highlight flow's motion, the 高亮条 layer's alone. These shape how
    // the shared lens FLIES between selections, not how the glass looks: the
    // spring that chases the selected row, how much it overshoots, how far the
    // lens stretches along its motion, and the trailing droplet's size.
    flowStiffness: { key: 'flowStiffness', label: '弹簧刚度', min: 40, max: 500, step: 10, format: (value) => `${Math.round(value)}` },
    flowDamping: { key: 'flowDamping', label: '阻尼比', min: 0.55, max: 1.1, step: 0.01, format: ratio },
    flowStretch: { key: 'flowStretch', label: '拉伸幅度', min: 0, max: 0.6, step: 0.01, format: ratio },
    flowDroplet: { key: 'flowDroplet', label: '水滴尾巴', min: 0, max: 1, step: 0.05, format: ratio },
    // 悬停浓度: the 按钮 layer's hover fills (sidebar rows, settings nav cells,
    // buttons app-wide) read their colour from the layer's tintHue/tintSaturation
    // and their strength from THIS knob — so pure-glass buttons (density 0) can
    // still show hover feedback.
    hoverAlpha: { key: 'hoverAlpha', label: '悬停浓度', min: 0, max: 1, step: 0.05, format: ratio },
};
/** The shared fourteen, in capsule order. */
export const GLASS_KNOBS = [
    'density', 'radius', 'refraction', 'edgeSoftness', 'glassBlur',
    'contrast', 'brightness', 'saturation',
    'tintHue', 'tintSaturation', 'rimStrength', 'borderWidth', 'borderOpacity', 'grain',
];
/** The flow motion's four, appended to the glass set on the 高亮条 tab. */
export const FLOW_KNOBS = ['flowStiffness', 'flowDamping', 'flowStretch', 'flowDroplet'];
//# sourceMappingURL=knobs.js.map