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
  width: number
  /** Capsule height in px. */
  height: number
  /** Capsule corner radius in px (the demo capsule: height/2 = 150). */
  radius: number
  /** Frosted white tint alpha over the capsule (0 = the original's clear glass). */
  density: number
  /** Backdrop-filter blur in px behind the refraction (the glass blur). */
  glassBlur: number
  /** Backdrop-filter contrast. */
  contrast: number
  /** Backdrop-filter brightness. */
  brightness: number
  /** Backdrop-filter saturation. */
  saturation: number
  /**
   * Edge softening in px along the capsule's height, on the same px knob every
   * glass layer uses. The fragment works in normalized uv, so the width is
   * divided by the capsule's height to reach it — which also keeps the lens
   * proportional when the capsule is resized.
   */
  edgeSoftness: number
  /** Refraction strength multiplier over the smoothstepped displacement. */
  refraction: number
  /** Tint hue (degrees); only visible once tintSaturation leaves 0. */
  tintHue: number
  /** Tint saturation (0 = the original's pure-white tint). */
  tintSaturation: number
  /** Rim shadow strength: 1 = the original's shadow, 0 = none. */
  rimStrength: number
  /** Decorative border ring width in px (0 = none). */
  borderWidth: number
  /** Decorative border ring opacity. */
  borderOpacity: number
  /** Static grain overlay strength (0 = none). */
  grain: number
}

/** The original demo's look: clear tint, no blur, and the demo's 0.15 edge
 *  offset expressed as the px width that offset covers on the demo's capsule. */
export const LIQUID_GLASS_DEFAULTS: LiquidGlassParams = {
  width: 300,
  height: 200,
  radius: 150,
  density: 0,
  glassBlur: 0,
  // Neutral: the demo's 1.2 stretched every 8-bit level by 1.26× and clipped
  // the dark end, which turned smooth wallpaper gradients into visible bands.
  contrast: 1,
  brightness: 1.05,
  saturation: 1.1,
  edgeSoftness: 30,
  refraction: 1,
  tintHue: 220,
  tintSaturation: 0,
  rimStrength: 1,
  borderWidth: 0,
  borderOpacity: 0.85,
  grain: 0,
}

/** The capsule's rim shading at one strength: the demo's shadow with its two
 *  alphas scaled (1 = the original, 0 = none). Shared with the skin engine,
 *  which publishes the same string per layer. */
export function rimShadowCss(strength: number): string {
  const s = Math.max(0, strength)
  return `0 4px 8px rgba(0, 0, 0, ${(0.25 * s).toFixed(3)}), 0 -10px 25px inset rgba(0, 0, 0, ${(0.15 * s).toFixed(3)})`
}

/** The capsule tint colour: the original's frosted white at saturation 0; the
 *  lightness derives from the saturation (same curve as the layers' builder —
 *  at full lightness every hue is white and the hue knob would do nothing). */
export function tintCss(density: number, hue: number, saturation: number): string {
  const lightness = 100 - Math.max(0, Math.min(1, saturation)) * 50
  return `hsla(${hue}, ${(saturation * 100).toFixed(1)}%, ${lightness.toFixed(1)}%, ${(density * 0.5).toFixed(3)})`
}

/** The decorative ring at one width/opacity, as an INSET box-shadow segment
 *  ('' when the width is 0) — it composes onto the rim string, paints inside
 *  the sheet (never clipped by the viewport or a neighbouring column), and
 *  never affects layout. */
export function ringShadowCss(width: number, opacity: number): string {
  return width > 0 ? `, inset 0 0 0 ${width}px rgba(255, 255, 255, ${opacity.toFixed(3)})` : ''
}

/** The grain colour matrix for one intensity (0..1): mid-grey noise whose alpha
 *  the intensity scales — 0 is an exact identity stage. */
export function grainMatrixValues(intensity: number): string {
  const alpha = (Math.max(0, intensity) * 0.5).toFixed(3)
  return `0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 ${alpha} 0`
}

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
export function appendDitherStage(ns: 'http://www.w3.org/2000/svg', filter: SVGFilterElement, lastResultName: string): void {
  const turbulence = document.createElementNS(ns, 'feTurbulence')
  turbulence.setAttribute('result', 'dither-noise')
  turbulence.setAttribute('type', 'fractalNoise')
  turbulence.setAttribute('baseFrequency', '1')
  turbulence.setAttribute('numOctaves', '1')
  turbulence.setAttribute('seed', '31')
  turbulence.setAttribute('stitchTiles', 'stitch')

  const AMPLITUDE = (6 / 255).toFixed(5)
  const matrix = document.createElementNS(ns, 'feColorMatrix')
  matrix.setAttribute('in', 'dither-noise')
  matrix.setAttribute('result', 'dither')
  matrix.setAttribute('type', 'matrix')
  // Monochrome: one noise channel, centred on zero, scaled to ±1/255; the
  // alpha row pins the noise opaque so the additive mix below is exact.
  matrix.setAttribute('values',
    `${AMPLITUDE} 0 0 0 -${(1 / 255).toFixed(5)} `
    + `0 ${AMPLITUDE} 0 0 -${(1 / 255).toFixed(5)} `
    + `0 0 ${AMPLITUDE} 0 -${(1 / 255).toFixed(5)} `
    + `0 0 0 0 1`)

  const mix = document.createElementNS(ns, 'feComposite')
  mix.setAttribute('in', lastResultName)
  mix.setAttribute('in2', 'dither')
  mix.setAttribute('operator', 'arithmetic')
  mix.setAttribute('result', 'dithered')
  mix.setAttribute('k1', '0')
  mix.setAttribute('k2', '1')
  mix.setAttribute('k3', '1')
  mix.setAttribute('k4', '0')

  // …and keep the SOURCE's alpha. The noise row above pins its own alpha
  // opaque (that is what makes the additive mix exact), which turns a backdrop
  // that is empty where the sample came from — a displacement that pulled past
  // the element's own box, or a backdrop Chromium isolates because an ancestor
  // filters it — into an OPAQUE BLACK plate instead of glass. Masking by the
  // source's alpha costs nothing where the backdrop is opaque (the usual case:
  // alpha 1 × 1 = 1) and degrades a broken sample to transparent glass rather
  // than a black box.
  const keepAlpha = document.createElementNS(ns, 'feComposite')
  keepAlpha.setAttribute('in', 'dithered')
  keepAlpha.setAttribute('in2', 'SourceGraphic')
  keepAlpha.setAttribute('operator', 'in')

  filter.appendChild(turbulence)
  filter.appendChild(matrix)
  filter.appendChild(mix)
  filter.appendChild(keepAlpha)
}

/** Utility functions — verbatim from the original; shared with the layer refraction filters. */
export function smoothStep(a: number, b: number, t: number): number {
  t = Math.max(0, Math.min(1, (t - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y)
}

export function roundedRectSDF(x: number, y: number, width: number, height: number, radius: number): number {
  const qx = Math.abs(x) - width + radius
  const qy = Math.abs(y) - height + radius
  return Math.min(Math.max(qx, qy), 0) + length(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

function texture(x: number, y: number): { type: 't', x: number, y: number } {
  return { type: 't', x, y }
}

function generateId(): string {
  return 'liquid-glass-' + Math.random().toString(36).slice(2, 11)
}

/** One fragment sample's sampled-texture request (the original's shape). */
interface TextureSample {
  type: 't'
  x: number
  y: number
}

/** Fragment uv vector: normalized 0..1 sample coordinates. */
interface Uv {
  x: number
  y: number
}

/**
 * The draggable glass capsule. The class body mirrors the original `Shader`:
 * same element tree, same inline cssText, same event wiring and constrain
 * math; parameters replace the literals the demo baked in.
 */
export class LiquidGlass {
  readonly id = generateId()
  /** Viewport boundary offset while dragging. */
  readonly offset = 10
  /** Displacement-map supersampling; the original ships 1. */
  readonly canvasDPI = 1
  params: LiquidGlassParams

  container!: HTMLDivElement
  svg!: SVGSVGElement
  canvas!: HTMLCanvasElement
  context!: CanvasRenderingContext2D
  feImage!: SVGFEImageElement
  feDisplacementMap!: SVGFEDisplacementMapElement
  grainMatrix!: SVGFEColorMatrixElement

  private readonly fragment: (uv: Uv) => TextureSample
  private teardown: Array<() => void> = []

  constructor(params: Partial<LiquidGlassParams> = {}) {
    this.params = { ...LIQUID_GLASS_DEFAULTS, ...params }
    // The demo capsule's fragment, verbatim except the two literals the sliders
    // own: the demo's 0.15 uv edge offset, and the refraction strength of 1.
    this.fragment = (uv: Uv) => {
      const ix = uv.x - 0.5
      const iy = uv.y - 0.5
      const distanceToEdge = roundedRectSDF(ix, iy, 0.3, 0.2, 0.6)
      // One uv unit is the capsule's height, so a px width divides into it.
      const edgeBand = this.params.edgeSoftness / this.params.height
      const displacement = smoothStep(0.8, 0, distanceToEdge - edgeBand)
      const scaled = smoothStep(0, 1, displacement) * this.params.refraction
      return texture(ix * scaled + 0.5, iy * scaled + 0.5)
    }
    this.createElement()
    this.setupEventListeners()
    this.updateShader()
  }

  private createElement(): void {
    const { width, height, radius, density, glassBlur, contrast, brightness, saturation,
      tintHue, tintSaturation, rimStrength, borderWidth, borderOpacity } = this.params
    // Create container — the original's cssText with the tunables interpolated.
    this.container = document.createElement('div')
    this.container.dataset.liquidGlass = ''
    this.container.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        border-radius: ${radius}px;
        background: ${tintCss(density, tintHue, tintSaturation)};
        box-shadow: ${rimShadowCss(rimStrength)}${ringShadowCss(borderWidth, borderOpacity)};
        cursor: grab;
        backdrop-filter: url(#${this.id}_filter) blur(${glassBlur}px) contrast(${contrast}) brightness(${brightness}) saturate(${saturation});
        z-index: 9999;
        pointer-events: auto;
      `

    // Create SVG filter.
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    this.svg.setAttribute('width', '0')
    this.svg.setAttribute('height', '0')
    this.svg.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        pointer-events: none;
        z-index: 9998;
      `

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter')
    filter.setAttribute('id', `${this.id}_filter`)
    filter.setAttribute('filterUnits', 'userSpaceOnUse')
    filter.setAttribute('colorInterpolationFilters', 'sRGB')
    filter.setAttribute('x', '0')
    filter.setAttribute('y', '0')
    filter.setAttribute('width', this.params.width.toString())
    filter.setAttribute('height', this.params.height.toString())

    this.feImage = document.createElementNS('http://www.w3.org/2000/svg', 'feImage')
    this.feImage.setAttribute('id', `${this.id}_map`)
    this.feImage.setAttribute('width', this.params.width.toString())
    this.feImage.setAttribute('height', this.params.height.toString())

    this.feDisplacementMap = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap')
    this.feDisplacementMap.setAttribute('in', 'SourceGraphic')
    this.feDisplacementMap.setAttribute('in2', `${this.id}_map`)
    this.feDisplacementMap.setAttribute('result', 'displaced')
    this.feDisplacementMap.setAttribute('xChannelSelector', 'R')
    this.feDisplacementMap.setAttribute('yChannelSelector', 'G')

    // The grain overlay, identical to the layer filters' (refraction.ts): a
    // static fractal noise with a knob-scaled alpha, mixed in arithmetically.
    const turbulence = document.createElementNS('http://www.w3.org/2000/svg', 'feTurbulence')
    turbulence.setAttribute('result', 'grain-noise')
    turbulence.setAttribute('type', 'fractalNoise')
    turbulence.setAttribute('baseFrequency', '0.9')
    turbulence.setAttribute('numOctaves', '2')
    turbulence.setAttribute('seed', '7')
    turbulence.setAttribute('stitchTiles', 'stitch')

    this.grainMatrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix')
    this.grainMatrix.setAttribute('in', 'grain-noise')
    this.grainMatrix.setAttribute('result', 'grain')
    this.grainMatrix.setAttribute('type', 'matrix')
    this.grainMatrix.setAttribute('values', grainMatrixValues(this.params.grain))

    const grainMix = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite')
    grainMix.setAttribute('in', 'displaced')
    grainMix.setAttribute('in2', 'grain')
    grainMix.setAttribute('result', 'grain-mixed')
    grainMix.setAttribute('operator', 'arithmetic')
    grainMix.setAttribute('k1', '0')
    grainMix.setAttribute('k2', '1')
    grainMix.setAttribute('k3', '0.5')
    grainMix.setAttribute('k4', '0')

    filter.appendChild(this.feImage)
    filter.appendChild(this.feDisplacementMap)
    filter.appendChild(turbulence)
    filter.appendChild(this.grainMatrix)
    filter.appendChild(grainMix)
    appendDitherStage('http://www.w3.org/2000/svg', filter, 'grain-mixed')
    defs.appendChild(filter)
    this.svg.appendChild(defs)

    // Create canvas for displacement map (hidden).
    this.canvas = document.createElement('canvas')
    this.canvas.width = this.params.width * this.canvasDPI
    this.canvas.height = this.params.height * this.canvasDPI
    this.canvas.style.display = 'none'

    this.context = this.canvas.getContext('2d')!
  }

  private constrainPosition(x: number, y: number): { x: number, y: number } {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    // Calculate boundaries with offset
    const minX = this.offset
    const maxX = viewportWidth - this.params.width - this.offset
    const minY = this.offset
    const maxY = viewportHeight - this.params.height - this.offset

    // Constrain position
    const constrainedX = Math.max(minX, Math.min(maxX, x))
    const constrainedY = Math.max(minY, Math.min(maxY, y))

    return { x: constrainedX, y: constrainedY }
  }

  private setupEventListeners(): void {
    let isDragging = false
    let startX: number, startY: number, initialX: number, initialY: number

    const containerMouseDown = (e: MouseEvent): void => {
      isDragging = true
      this.container.style.cursor = 'grabbing'
      startX = e.clientX
      startY = e.clientY
      const rect = this.container.getBoundingClientRect()
      initialX = rect.left
      initialY = rect.top
      e.preventDefault()
    }
    this.container.addEventListener('mousedown', containerMouseDown)
    this.teardown.push(() => { this.container.removeEventListener('mousedown', containerMouseDown) })

    const documentMouseMove = (e: MouseEvent): void => {
      if (isDragging) {
        const deltaX = e.clientX - startX
        const deltaY = e.clientY - startY

        // Calculate new position
        const newX = initialX + deltaX
        const newY = initialY + deltaY

        // Constrain position within viewport bounds
        const constrained = this.constrainPosition(newX, newY)

        this.container.style.left = constrained.x + 'px'
        this.container.style.top = constrained.y + 'px'
        this.container.style.transform = 'none'
      }
    }
    document.addEventListener('mousemove', documentMouseMove)
    this.teardown.push(() => { document.removeEventListener('mousemove', documentMouseMove) })

    const documentMouseUp = (): void => {
      isDragging = false
      this.container.style.cursor = 'grab'
    }
    document.addEventListener('mouseup', documentMouseUp)
    this.teardown.push(() => { document.removeEventListener('mouseup', documentMouseUp) })

    // Handle window resize to maintain constraints
    const windowResize = (): void => {
      // A hidden capsule has no position to constrain (and measuring it would
      // flush layout for nothing).
      if (this.container.style.display === 'none') return
      const rect = this.container.getBoundingClientRect()
      const constrained = this.constrainPosition(rect.left, rect.top)

      if (rect.left !== constrained.x || rect.top !== constrained.y) {
        this.container.style.left = constrained.x + 'px'
        this.container.style.top = constrained.y + 'px'
        this.container.style.transform = 'none'
      }
    }
    window.addEventListener('resize', windowResize)
    this.teardown.push(() => { window.removeEventListener('resize', windowResize) })
  }

  /** Recompute the displacement map from the current fragment parameters. */
  updateShader(): void {
    const w = this.params.width * this.canvasDPI
    const h = this.params.height * this.canvasDPI
    const data = new Uint8ClampedArray(w * h * 4)

    let maxScale = 0
    const rawValues: number[] = []

    for (let i = 0; i < data.length; i += 4) {
      const x = (i / 4) % w
      const y = Math.floor(i / 4 / w)
      const pos = this.fragment({ x: x / w, y: y / h })
      const dx = pos.x * w - x
      const dy = pos.y * h - y
      maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy))
      rawValues.push(dx, dy)
    }

    maxScale *= 0.5

    let index = 0
    for (let i = 0; i < data.length; i += 4) {
      const dx = rawValues[index]!
      const dy = rawValues[index + 1]!
      index += 2
      const r = dx / maxScale + 0.5
      const g = dy / maxScale + 0.5
      data[i] = r * 255
      data[i + 1] = g * 255
      data[i + 2] = 0
      data[i + 3] = 255
    }

    this.context.putImageData(new ImageData(data, w, h), 0, 0)
    this.feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', this.canvas.toDataURL())
    this.feDisplacementMap.setAttribute('scale', (maxScale / this.canvasDPI).toString())
  }

  /** Mount the filter SVG and the capsule under `parent` (the original's appendTo). */
  appendTo(parent: HTMLElement): void {
    parent.appendChild(this.svg)
    parent.appendChild(this.container)
  }

  /** Apply changed surface/shader values; only the touched pipeline stages re-run. */
  updateParams(next: Partial<LiquidGlassParams>): void {
    const before = this.params
    const sizeChanged = (next.width !== undefined && next.width !== before.width)
      || (next.height !== undefined && next.height !== before.height)
    const radiusChanged = next.radius !== undefined && next.radius !== before.radius
    const densityChanged = next.density !== undefined && next.density !== before.density
    const filterChanged = (next.glassBlur !== undefined && next.glassBlur !== before.glassBlur)
      || (next.contrast !== undefined && next.contrast !== before.contrast)
      || (next.brightness !== undefined && next.brightness !== before.brightness)
      || (next.saturation !== undefined && next.saturation !== before.saturation)
    const fragmentChanged = (next.edgeSoftness !== undefined && next.edgeSoftness !== before.edgeSoftness)
      || (next.refraction !== undefined && next.refraction !== before.refraction)
    const tintChanged = (next.tintHue !== undefined && next.tintHue !== before.tintHue)
      || (next.tintSaturation !== undefined && next.tintSaturation !== before.tintSaturation)
    const rimChanged = next.rimStrength !== undefined && next.rimStrength !== before.rimStrength
    const borderChanged = (next.borderWidth !== undefined && next.borderWidth !== before.borderWidth)
      || (next.borderOpacity !== undefined && next.borderOpacity !== before.borderOpacity)
    const grainChanged = next.grain !== undefined && next.grain !== before.grain
    if (!sizeChanged && !radiusChanged && !densityChanged && !filterChanged && !fragmentChanged
      && !tintChanged && !rimChanged && !borderChanged && !grainChanged) return
    this.params = { ...before, ...next }
    if (sizeChanged) {
      this.container.style.width = `${this.params.width}px`
      this.container.style.height = `${this.params.height}px`
      this.canvas.width = this.params.width * this.canvasDPI
      this.canvas.height = this.params.height * this.canvasDPI
      this.svg.querySelector('filter')?.setAttribute('width', this.params.width.toString())
      this.svg.querySelector('filter')?.setAttribute('height', this.params.height.toString())
      this.feImage.setAttribute('width', this.params.width.toString())
      this.feImage.setAttribute('height', this.params.height.toString())
    }
    if (radiusChanged) this.container.style.borderRadius = `${this.params.radius}px`
    if (densityChanged || tintChanged) {
      this.container.style.background =
        tintCss(this.params.density, this.params.tintHue, this.params.tintSaturation)
    }
    if (rimChanged || borderChanged) {
      this.container.style.boxShadow =
        rimShadowCss(this.params.rimStrength) + ringShadowCss(this.params.borderWidth, this.params.borderOpacity)
    }
    if (grainChanged) {
      this.grainMatrix.setAttribute('values', grainMatrixValues(this.params.grain))
    }
    if (filterChanged) {
      const { glassBlur, contrast, brightness, saturation } = this.params
      this.container.style.backdropFilter = `url(#${this.id}_filter) blur(${glassBlur}px) contrast(${contrast}) brightness(${brightness}) saturate(${saturation})`
    }
    // A size or fragment change re-runs the whole map; both are one stage.
    if (sizeChanged || fragmentChanged) this.updateShader()
  }

  /** Show or hide the capsule (the filter SVG stays mounted either way).
   *
   *  Hiding is a real saving, not just an opacity trick: `display: none` takes
   *  the element out of the render tree, so its `backdrop-filter` (the two noise
   *  stages and the displacement) stops being evaluated at all — the capsule is
   *  the one glass element this skin paints for no UI purpose. Nothing else
   *  depends on it being on screen: every layer's field is measured against the
   *  capsule's NUMBERS (`setLensReference`), never its box, so the layers cannot
   *  tell the difference. */
  setVisible(visible: boolean): void {
    this.container.style.display = visible ? '' : 'none'
  }

  /** Whether the capsule is currently on screen (the panel's toggle reads it so
   *  its label starts truthful). */
  isVisible(): boolean {
    return this.container.style.display !== 'none'
  }

  /** Remove every element and listener this instance owns. */
  destroy(): void {
    for (const dispose of this.teardown) dispose()
    this.teardown = []
    this.svg.remove()
    this.container.remove()
    this.canvas.remove()
  }
}
