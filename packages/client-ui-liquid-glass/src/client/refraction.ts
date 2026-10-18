/**
 * Layer refraction: the capsule's own displacement map, rendered per layer.
 *
 * The field is the capsule's fragment VERBATIM as a pure function of uv — the
 * same inner rect (0.3 / 0.2), corner radius (0.6) and falloff span (0.8), the
 * same 边缘柔边 reading (px ÷ the capsule's height), and the pull expressed in
 * the CAPSULE's own pixels. It is encoded exactly like
 * {@link LiquidGlass.updateShader} encodes the capsule's map: one shared norm,
 * the demo's ×0.5 overdrive, clamped channels, the norm as the filter scale.
 * The map then stretches over each filtered ELEMENT's own box (the filter region
 * is the element's bounding box, `preserveAspectRatio="none"`), so at the same
 * relative position every element displaces by exactly what the capsule
 * displaces — same knobs, same glass, whatever the box — and a shared field
 * covers every consumer whole, not just the corner that matches the host.
 *
 * The lens is the capsule sample itself: its live size arrives through
 * setLensSize and is part of the field's signature. The field depends on the
 * knobs and the lens size only — never on the host's absolute size — so a
 * resize re-samples the same field on a new grid instead of changing the pull.
 */
import {
  appendDitherStage,
  grainMatrixValues,
  LIQUID_GLASS_DEFAULTS,
  roundedRectSDF,
  smoothStep,
} from './liquid-glass.ts'

/** The capsule fragment's inner rect, in half-box fractions (the demo's own). */
const INNER_HALF_WIDTH = 0.3
const INNER_HALF_HEIGHT = 0.2
/** The capsule fragment's corner radius, in the same fractions (the demo's 0.6). */
const CORNER_RADIUS = 0.6
/** Span the rim falloff runs over, in box fractions (the demo's 0.8). */
const JUMP = 0.8

/** Map grid budget, in pixels. The field is smooth — its only feature is the
 *  rim band, and that band is a constant FRACTION of the box — so a couple of
 *  hundred samples an axis resolve it; one sample per box pixel buys nothing.
 *  The budget follows the box's own area, capped at the capsule sample's own
 *  grid (its live width × height, 300×200 by default): a control the size of
 *  the capsule is therefore sampled exactly like the capsule — the parity
 *  measurement's premise — and a full-column sheet, which is many times the
 *  capsule, spends no more than the capsule does. */
const MAP_AREA_MIN = 6_000
const MAP_SIDE_MIN = 48
const MAP_SIDE_MAX = 320

/** Samples the grid must carry across the rim band (see gridFor). */
const EDGE_SAMPLES = 12

/** Aspect is quantized so sub-pixel resizes reuse the field; the lens is smooth,
 *  so a couple of percent of stretch is invisible. */
const ASPECT_STEP = 0.02

/** The pull's clamp and the sample budget are quantized too, so a box that
 *  creeps a pixel reuses its field instead of re-encoding it. Neither is
 *  visible: the clamp only trims the tail that falls off the element, and the
 *  field it holds is smooth. */
const CLAMP_STEP = 4
const GRID_STEP = 32

/** How long a box must hold still before its field is re-encoded, and how long
 *  a box that never holds still may go without one. A pane drag or a sliding
 *  track changes a box every frame and each re-encode is a full-grid pass plus
 *  a PNG (measured: 166 encodes = 740ms across a 30-frame resize). The field is
 *  a function of box FRACTIONS and the filter region follows the element, so
 *  the glass keeps its shape throughout the drag — only the sampling density
 *  waits for the box to settle. Knob moves are never debounced: a slider has
 *  to feel live. */
const BOX_SETTLE_MS = 120
const BOX_SETTLE_MAX_MS = 500

/** The encoded field, shared by every layer that resolves to the same one: the
 *  map is a function of the grid, the knobs and the pull's clamp box, and the
 *  layers' hosts routinely share all three (a preset switch re-encodes eleven
 *  layers, most of them onto the same field). */
interface EncodedField {
  href: string
  scale: string
}

const fieldCache = new Map<string, EncodedField>()
const FIELD_CACHE_MAX = 24

/** One canvas for every encode: the field is produced from scratch each time,
 *  so a per-layer canvas only held eleven idle buffers. */
let encoderCanvas: HTMLCanvasElement | null = null
function encoderOf(): CanvasRenderingContext2D {
  if (encoderCanvas === null) encoderCanvas = document.createElement('canvas')
  return encoderCanvas.getContext('2d')!
}

export class LayerRefraction {
  readonly id: string
  private readonly svg: SVGSVGElement
  private readonly filter: SVGFilterElement
  private readonly feImage: SVGFEImageElement
  private readonly feDisplacementMap: SVGFEDisplacementMapElement
  /** The grain overlay's alpha scale — the one tunable stage past the map. */
  private grainMatrix: SVGFEColorMatrixElement | null = null
  /** Whether the grain stage is currently in the filter graph (see buildTail). */
  private grainOn = false
  private host: Element | null = null
  private observer: ResizeObserver | undefined
  /** Where to measure when the filtered element has no box of its own — a
   *  suppressed sheet is `display: none` and tracks its host's box instead
   *  (see LayerSurface.hostBox). */
  private fallbackBox: (() => { width: number, height: number } | null) | undefined
  /** Last applied knobs; null until the first update (the slider range
   *  includes negative refractions, so -1 cannot serve as an "unset" marker). */
  private refraction: number | null = null
  private edgeSoftness: number | null = null
  private grain = 0
  /** The lens every pull is measured in: the capsule sample's live box. */
  private lensWidth = LIQUID_GLASS_DEFAULTS.width
  private lensHeight = LIQUID_GLASS_DEFAULTS.height
  private scheduled = false
  /** Pending settle timer for a box that is still moving (see BOX_SETTLE_MS). */
  private settleTimer: ReturnType<typeof setTimeout> | undefined
  private settleSince = 0
  /** Signature of the generated field: the knobs, the lens size and the pull's
   *  clamp box are its inputs; the grid only resamples it. */
  private lastSignature: string | null = null

  constructor(id: string) {
    this.id = id
    const ns = 'http://www.w3.org/2000/svg'
    this.svg = document.createElementNS(ns, 'svg')
    this.svg.setAttribute('width', '0')
    this.svg.setAttribute('height', '0')
    this.svg.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;'
    const defs = document.createElementNS(ns, 'defs')
    this.filter = document.createElementNS(ns, 'filter')
    this.filter.setAttribute('id', `lg-refract-${id}`)
    // The region is the ELEMENT'S OWN box, in bounding-box fractions — never a
    // size measured off some other element. The map is a field in box fractions,
    // so as long as the region follows the element being filtered, the field
    // stretches onto that element exactly, whatever its size: a 240px control
    // and a 24px one both get the whole field, each at its own scale. Stamping a
    // pixel region off the first host (what this used to do) left every other
    // consumer showing the field's top-left corner only — measured on the model
    // selector, where just the left fifth of the button changed.
    this.filter.setAttribute('filterUnits', 'objectBoundingBox')
    this.filter.setAttribute('colorInterpolationFilters', 'sRGB')
    this.filter.setAttribute('x', '0')
    this.filter.setAttribute('y', '0')
    this.filter.setAttribute('width', '1')
    this.filter.setAttribute('height', '1')

    this.feImage = document.createElementNS(ns, 'feImage')
    this.feImage.setAttribute('result', 'lg-map')
    this.feImage.setAttribute('width', '1')
    this.feImage.setAttribute('height', '1')
    // SVG's default is preserveAspectRatio="xMidYMid meet", which scales the map
    // UNIFORMLY to fit and centres it. The map is a field in the box's own
    // fractions, so it must be stretched onto the region exactly: with the
    // default, any box whose proportions differ from the map's pixel grid would
    // only be filtered over a centred sub-rectangle, leaving an untouched margin
    // down the long edges (about a third of a wide bar's width). The capsule
    // never showed it because its map is generated at its own exact size.
    this.feImage.setAttribute('preserveAspectRatio', 'none')

    this.feDisplacementMap = document.createElementNS(ns, 'feDisplacementMap')
    this.feDisplacementMap.setAttribute('in', 'SourceGraphic')
    this.feDisplacementMap.setAttribute('in2', 'lg-map')
    this.feDisplacementMap.setAttribute('result', 'displaced')
    this.feDisplacementMap.setAttribute('xChannelSelector', 'R')
    this.feDisplacementMap.setAttribute('yChannelSelector', 'G')

    this.filter.appendChild(this.feImage)
    this.filter.appendChild(this.feDisplacementMap)
    // The tail — grain (only while it can matter) and the dither stage — is
    // rebuilt whenever 颗粒感 crosses zero (see update): at grain 0 the grain
    // stage is an exact identity, and keeping a fractal-noise node in the graph
    // would make every glassed element on screen compute procedural noise it
    // then multiplies by zero.
    this.buildTail()

    defs.appendChild(this.filter)
    this.svg.appendChild(defs)
    this.feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', identityMap())
    this.feDisplacementMap.setAttribute('scale', '0')
  }

  /**
   * Rebuild everything after the displacement stage: the grain overlay (only
   * while 颗粒感 is on) and the dither that ends every glass chain.
   *
   * The grain overlay is static fractal noise, colourised to mid grey with a
   * knob-scaled alpha, then arithmetically added over the displaced backdrop
   * (k2 keeps the glass, k3 mixes the speckle in). It must sit BEFORE the
   * dither's alpha mask, or the noise's opaque alpha would re-pin a sample that
   * came back empty — the black-plate failure the mask exists to prevent.
   */
  private buildTail(): void {
    const ns = 'http://www.w3.org/2000/svg'
    while (this.filter.childElementCount > 2) this.filter.lastElementChild!.remove()
    if (this.grainOn) {
      const noise = document.createElementNS(ns, 'feTurbulence')
      noise.setAttribute('result', 'grain-noise')
      noise.setAttribute('type', 'fractalNoise')
      noise.setAttribute('baseFrequency', '0.9')
      noise.setAttribute('numOctaves', '2')
      noise.setAttribute('seed', '7')
      noise.setAttribute('stitchTiles', 'stitch')

      const matrix = document.createElementNS(ns, 'feColorMatrix')
      matrix.setAttribute('in', 'grain-noise')
      matrix.setAttribute('result', 'grain')
      matrix.setAttribute('type', 'matrix')
      matrix.setAttribute('values', grainMatrixValues(this.grain))

      const mix = document.createElementNS(ns, 'feComposite')
      mix.setAttribute('in', 'displaced')
      mix.setAttribute('in2', 'grain')
      mix.setAttribute('result', 'grain-mixed')
      mix.setAttribute('operator', 'arithmetic')
      mix.setAttribute('k1', '0')
      mix.setAttribute('k2', '1')
      mix.setAttribute('k3', '0.5')
      mix.setAttribute('k4', '0')

      this.grainMatrix = matrix
      this.filter.append(noise, matrix, mix)
    }
    appendDitherStage(ns, this.filter, this.grainOn ? 'grain-mixed' : 'displaced')
  }

  /** Attach the filter's SVG and begin tracking `host`'s size. */
  mount(parent: HTMLElement): void {
    parent.appendChild(this.svg)
  }

  /**
   * Bind a host. The field is generated right here, not on a later frame: a
   * control that mounts mid-frame has to be fully formed by the time it is
   * painted, or it visibly settles a moment after appearing.
   */
  attach(host: Element, fallbackBox?: () => { width: number, height: number } | null): void {
    this.host = host
    this.fallbackBox = fallbackBox
    this.observer?.disconnect()
    this.observer = new ResizeObserver(() => this.queueRegenerate('box'))
    this.observer.observe(host)
    this.regenerate()
  }

  /**
   * Let go of the host. The filter resets to a no-op over the whole viewport so
   * that a control which mounts before the next scan shows neutral glass rather
   * than the previous host's lens, stretched over the wrong box.
   */
  detach(): void {
    this.observer?.disconnect()
    this.observer = undefined
    this.host = null
    this.fallbackBox = undefined
    this.lastSignature = null
    this.clearSettle()
    this.feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', identityMap())
    this.feDisplacementMap.setAttribute('scale', '0')
  }

  /** Re-run for knob moves (skips when nothing changed). */
  update(refraction: number, edgeSoftness: number, grain = 0): void {
    const on = grain > 0
    if (on !== this.grainOn) {
      // Entering or leaving the grain: the graph itself changes (see buildTail).
      this.grainOn = on
      this.grain = grain
      this.buildTail()
    }
    else if (grain !== this.grain) {
      this.grain = grain
      this.grainMatrix?.setAttribute('values', grainMatrixValues(grain))
    }
    if (refraction === this.refraction && edgeSoftness === this.edgeSoftness) return
    this.refraction = refraction
    this.edgeSoftness = edgeSoftness
    this.queueRegenerate('knob')
  }

  /** Follow the capsule sample's live size: the pull of every layer is
   *  expressed in the capsule's own pixels, so a resized sample re-scales the
   *  whole skin's refraction with it. */
  setLensSize(width: number, height: number): void {
    if (width === this.lensWidth && height === this.lensHeight) return
    this.lensWidth = width
    this.lensHeight = height
    this.queueRegenerate('knob')
  }

  destroy(): void {
    this.observer?.disconnect()
    this.observer = undefined
    this.clearSettle()
    this.svg.remove()
  }

  /**
   * Schedule a regeneration for what changed.
   *
   * - `knob` (or the first field for a host): one pass on the next frame, so a
   *   slider move lands with the frame it was made in.
   * - `box`: a box that is still moving holds its field until it settles. A
   *   collapsing column resizes every frame, and each pass costs a full grid of
   *   field math plus a PNG encode; the field is a function of box FRACTIONS and
   *   the filter's region always follows the element, so nothing about the glass
   *   needs the new grid while the drag is in progress. A box that never settles
   *   (a looping animation) still gets a fresh grid every BOX_SETTLE_MAX_MS.
   */
  private queueRegenerate(source: 'knob' | 'box'): void {
    if (source === 'knob' || this.lastSignature === null) {
      this.clearSettle()
      if (this.scheduled) return
      this.scheduled = true
      requestAnimationFrame(() => {
        this.scheduled = false
        this.regenerate()
      })
      return
    }
    const now = performance.now()
    if (this.settleTimer === undefined) this.settleSince = now
    else clearTimeout(this.settleTimer)
    const wait = clamp(BOX_SETTLE_MS, 0, this.settleSince + BOX_SETTLE_MAX_MS - now)
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined
      this.regenerate()
    }, wait)
  }

  private clearSettle(): void {
    if (this.settleTimer === undefined) return
    clearTimeout(this.settleTimer)
    this.settleTimer = undefined
  }

  /** Measure the host's box — the field is generated per host aspect and its
   *  pull is capped against this box. The filter's own region needs no stamping:
   *  it is the element's bounding box (see the constructor). */
  private syncRegion(): { width: number, height: number } | null {
    const host = this.host
    if (host === null) return null
    const rect = host.getBoundingClientRect()
    const width = Math.max(2, Math.round(rect.width))
    const height = Math.max(2, Math.round(rect.height))
    if (width < 8 || height < 8) {
      // No box of its own (a hidden or suppressed element): measure the box the
      // element is sized to instead, so the knobs keep their meaning while it
      // is off screen and the field is already right when it returns.
      const fallback = this.fallbackBox?.()
      if (fallback !== null && fallback !== undefined) return fallback
    }
    return { width, height }
  }

  private regenerate(): void {
    const host = this.host
    const { refraction, edgeSoftness } = this
    if (host === null || refraction === null || edgeSoftness === null) return
    const box = this.syncRegion()
    if (box === null) return
    // A box that has not been laid out yet cannot carry a field: its pull would
    // be clamped to a couple of pixels and the glass would read flat. Leave the
    // signature unset, so the first real box still renders on the leading edge
    // instead of waiting out a settle timer.
    if (box.width < 8 || box.height < 8) return

    const aspect = quantize(box.width / box.height, ASPECT_STEP)
    // The pull's clamp and the grid are quantized too, so a box that creeps by
    // a pixel reuses its field instead of re-encoding it (see ASPECT_STEP).
    const clampHalf = {
      w: Math.max(4, quantize(box.width, CLAMP_STEP)) / 2,
      h: Math.max(4, quantize(box.height, CLAMP_STEP)) / 2,
    }
    // 边缘柔边 against the capsule's height — the capsule's own reading.
    const band = Math.max(0.002, edgeSoftness / this.lensHeight)
    const grid = gridFor(quantize(box.width, GRID_STEP), quantize(box.height, GRID_STEP), aspect, band, this.lensWidth * this.lensHeight)
    const signature = `${grid.width}x${grid.height}:${aspect.toFixed(3)}:${band.toFixed(3)}`
      + `:${refraction}:${this.lensWidth}x${this.lensHeight}:${clampHalf.w}x${clampHalf.h}`
    if (signature === this.lastSignature) return
    this.lastSignature = signature
    this.renderField(signature, grid, band, refraction, clampHalf.w, clampHalf.h)
  }

  /**
   * Render the displacement field: the capsule's fragment and the capsule's
   * encoder, verbatim. The pixel pull comes out in the capsule's own px, so the
   * scale attribute below is the lens's norm and nothing else — no host size
   * enters the encoded displacement.
   */
  private renderField(
    signature: string,
    grid: { width: number, height: number },
    band: number,
    refraction: number,
    halfWidth: number,
    halfHeight: number,
  ): void {
    // Eleven layers resolve to the same field whenever their hosts agree on the
    // grid, the knobs and the clamp — a preset switch, a layout change, a
    // re-bind: one encode serves them all.
    const cached = fieldCache.get(signature)
    if (cached !== undefined) {
      this.applyField(cached)
      return
    }
    const { width: mapWidth, height: mapHeight } = grid
    // The pull is capped at the box the field was generated for. Beyond that
    // box Chromium's backdrop texture is uninitialised — sampling it comes back
    // OPAQUE BLACK, not transparent, so no filter stage can rescue the result
    // (measured: a 27px control pulling a capsule-scale 93px turned solid black).
    // Inside the box the pull is unchanged, so a capsule-sized host keeps the
    // capsule's exact field; what changes is only the tail that used to fall off
    // the edge. Consumers of a shared map slice this field over their own box,
    // which is why a layer whose controls are small has to be measured on a
    // control-sized box in the first place (see BUTTON_AREAS).
    const data = new Uint8ClampedArray(mapWidth * mapHeight * 4)
    const rawX = new Float32Array(mapWidth * mapHeight)
    const rawY = new Float32Array(mapWidth * mapHeight)
    let maxRaw = 0
    let index = 0
    for (let row = 0; row < mapHeight; row++) {
      const iy = (row + 0.5) / mapHeight - 0.5
      for (let col = 0; col < mapWidth; col++, index++) {
        const ix = (col + 0.5) / mapWidth - 0.5
        // The capsule's fragment, verbatim: the normalized rounded-rect
        // distance, the falloff, and the pull toward the centre (0.5, 0.5).
        const distanceToEdge = roundedRectSDF(ix, iy, INNER_HALF_WIDTH, INNER_HALF_HEIGHT, CORNER_RADIUS)
        const displacement = smoothStep(JUMP, 0, distanceToEdge - band)
        const scaled = smoothStep(0, 1, displacement) * refraction
        // The capsule's own pull, in the capsule's own pixels, kept inside the
        // field's box (see above).
        const dx = clamp(ix * (scaled - 1) * this.lensWidth, -halfWidth, halfWidth)
        const dy = clamp(iy * (scaled - 1) * this.lensHeight, -halfHeight, halfHeight)
        if (Math.abs(dx) > maxRaw) maxRaw = Math.abs(dx)
        if (Math.abs(dy) > maxRaw) maxRaw = Math.abs(dy)
        rawX[index] = dx
        rawY[index] = dy
      }
    }

    // The capsule's encoder, verbatim: ONE shared norm for both axes, halved —
    // the demo's overdrive that flattens the strongest rim — with the norm as
    // the filter scale and Uint8Clamped supplying the channel clipping.
    let encoded: EncodedField
    if (!Number.isFinite(maxRaw) || maxRaw === 0) {
      encoded = { href: identityMap(), scale: '0' }
    } else {
      const maxScale = maxRaw * 0.5
      const inverse = 1 / maxScale
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        data[i] = (rawX[p]! * inverse + 0.5) * 255
        data[i + 1] = (rawY[p]! * inverse + 0.5) * 255
        data[i + 2] = 0
        data[i + 3] = 255
      }
      const context = encoderOf()
      // Resizing a canvas reallocates and clears it, so only when the grid
      // actually changed.
      if (context.canvas.width !== mapWidth) context.canvas.width = mapWidth
      if (context.canvas.height !== mapHeight) context.canvas.height = mapHeight
      context.putImageData(new ImageData(data, mapWidth, mapHeight), 0, 0)
      encoded = { href: context.canvas.toDataURL(), scale: String(maxScale) }
    }
    if (fieldCache.size >= FIELD_CACHE_MAX) fieldCache.delete(fieldCache.keys().next().value!)
    fieldCache.set(signature, encoded)
    this.applyField(encoded)
  }

  private applyField(field: EncodedField): void {
    this.feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', field.href)
    this.feDisplacementMap.setAttribute('scale', field.scale)
  }
}

/**
 * The map grid for a box, under one sample budget. The field is smooth and its
 * only feature — the rim band — is a constant fraction of the box, so a couple
 * of hundred samples an axis resolve it; sampling once per box pixel buys
 * nothing. The budget follows the box's own area (clamped), so a 24px chip pays
 * for a chip and a full-column sheet stays under the capsule sample's own scale.
 *
 * The band is the exception: a NARROW rim (边缘柔边 low) needs samples of its
 * own or the falloff comes out stepped, so `EDGE_SAMPLES / band` is a floor on
 * both axes. At the ordinary band (~0.15) that floor is ~80 and the area budget
 * is what decides; only a sliver-thin rim pulls the grid back up.
 */
function gridFor(
  boxWidth: number,
  boxHeight: number,
  aspect: number,
  band: number,
  lensArea: number,
): { width: number, height: number } {
  const box = Math.max(16, boxWidth) * Math.max(16, boxHeight)
  const area = clamp(Math.round(box), MAP_AREA_MIN, Math.max(MAP_AREA_MIN, Math.round(lensArea)))
  let width = clamp(Math.round(Math.sqrt(area * aspect)), MAP_SIDE_MIN, MAP_SIDE_MAX)
  let height = clamp(Math.round(area / width), MAP_SIDE_MIN, MAP_SIDE_MAX)
  const floor = clamp(Math.ceil(EDGE_SAMPLES / band), MAP_SIDE_MIN, MAP_SIDE_MAX)
  if (width < floor) width = floor
  if (height < floor) height = floor
  return { width, height }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step
}

/**
 * The no-op identity map every layer starts on, encoded once for the whole
 * skin: a filter with no image is an invalid reference, and an invalid `url()`
 * at the head of a backdrop-filter chain voids the whole chain (no blur, no
 * tint) until a real field arrives. Sharing the encode takes the cold canvas
 * work out of every layer's boot.
 */
let identityMapHref: string | null = null

function identityMap(): string {
  if (identityMapHref !== null) return identityMapHref
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  canvas.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray([
      128, 128, 0, 255, 128, 128, 0, 255,
      128, 128, 0, 255, 128, 128, 0, 255,
    ]), 2, 2),
    0,
    0,
  )
  identityMapHref = canvas.toDataURL()
  return identityMapHref
}

