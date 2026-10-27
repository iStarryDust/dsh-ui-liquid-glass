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

import { COLUMN, LAYERS, defaultValues, NEUTRAL, SCHEME_GLASS, setThemeWash, type LayerId, type LayerSpec, type LayerValues } from './layers.ts'
import { FlowHighlight } from './flow-lens.ts'
import { rimShadowCss, ringShadowCss } from './liquid-glass.ts'
import { LayerRefraction } from './refraction.ts'
import { isDisplayable, LayerSurface, RIM_SHADOW, type SurfacePlan } from './surface.ts'
import { listWallpapers, wallpaperUrl } from './wallpaper-store.ts'
import skinCss from './skin.css?inline'

/** How the theme picks its wallpaper. */
export type WallpaperMode =
  /** The time set: one of the directory's images per time bucket, switching
   *  automatically through the day (the bucket table is scheme-independent). The
   *  default. */
  | 'time'
  /** One specific directory file, pinned regardless of time or scheme. */
  | 'static'

/** Wallpaper layer state. */
export interface WallpaperState {
  /** Which wallpaper strategy is active (see {@link WallpaperMode}). */
  mode: WallpaperMode
  /** `static` mode's directory file name; null in the automatic modes. */
  imageId: string | null
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
export type ThemeColorId = 'blue' | 'gold' | 'white' | 'black'

export interface ThemeColorPreset {
  id: ThemeColorId
  /** The swatch the control paints — the only thing it shows. */
  swatch: string
  /** The shell ramp steps, or null for "leave the shell's own". */
  ramp: Record<'400' | '450' | '500' | '600', string> | null
  /** The 新会话 wash as an `"r, g, b"` triple, or null for "the layer's own". */
  wash: string | null
}

/** The ramp steps a preset overrides, in one place. */
const THEME_RAMP_STEPS = ['400', '450', '500', '600'] as const

export const THEME_COLORS: readonly ThemeColorPreset[] = [
  { id: 'blue', swatch: 'rgb(65, 118, 230)', ramp: null, wash: null },
  {
    id: 'gold',
    swatch: '#C69C57',
    ramp: {
      400: 'rgb(232, 206, 155)', 450: 'rgb(217, 184, 122)',
      500: 'rgb(198, 156, 87)', 600: 'rgb(156, 122, 60)',
    },
    wash: '214, 178, 110',
  },
  {
    id: 'white',
    swatch: '#F2F2F2',
    ramp: {
      400: 'rgb(255, 255, 255)', 450: 'rgb(245, 245, 245)',
      500: 'rgb(232, 232, 232)', 600: 'rgb(207, 207, 207)',
    },
    wash: '255, 255, 255',
  },
  {
    id: 'black',
    swatch: '#1A1A1E',
    ramp: {
      400: 'rgb(74, 74, 80)', 450: 'rgb(51, 51, 58)',
      500: 'rgb(36, 36, 41)', 600: 'rgb(21, 21, 25)',
    },
    wash: '26, 26, 30',
  },
]

/**
 * Theme-panel state: the text colours the 主题 category tunes — `null` means
 * the shell's own palette stands untouched. (The former wallpaper look values
 * — 壁纸明暗/光斑色相/网格浓度 — died with the grid test wallpaper: they only
 * ever shaped its blobs and base tone, and the directory wallpapers are photos.)
 */
export interface ThemeState {
  textHue: number | null
  textLight: number | null
  /** The 主题色 preset (see THEME_COLORS). */
  themeColor: ThemeColorId
}

/** The whole persisted skin state. */
export interface SkinState {
  theme: ThemeState
  wallpaper: WallpaperState
  /** Per-layer opt-outs for the scheme-driven 浓度/亮度: `false` = manual. Absent =
   *  auto for a `schemeGlass` layer (the shipped state); meaningless elsewhere. */
  schemeAuto: Record<string, boolean>
  layers: Record<LayerId, LayerValues>
}

/** Stamp of the running skin, published on <body> and on the stylesheet tag so
 *  a stale page (browser cache, ungated reload) is one devtools lookup away. */
export const SKIN_VERSION = '2026-10-13.32'

/** The web-server route the node half serves the bundled fonts under. The two
 *  halves cannot import each other, so this mirrors src/index.ts's FONT_ROUTE. */
const FONT_ROUTE = '/ui-liquid-glass/fonts'

/** The bundled HarmonyOS Sans SC faces — file name under assets/fonts and the
 *  weight it answers for (400/500/700 cover the shell's 400–700 usages; 600
 *  resolves to the Bold face per the CSS font-matching rules). */
const FONT_FACES: readonly [file: string, weight: number][] = [
  ['HarmonyOSSansSC-Regular.ttf', 400],
  ['HarmonyOSSansSC-Medium.ttf', 500],
  ['HarmonyOSSansSC-Bold.ttf', 700],
]

/** The @font-face rules for the bundled faces, served by the node half's font
 *  route. The version query busts the browser cache once per skin build (the
 *  route itself answers with a week-long max-age). On hosts without the web
 *  server the fetch simply fails and the fallback stack in skin.css renders. */
const FONT_FACE_CSS = FONT_FACES.map(([file, weight]) =>
  `@font-face{font-family:'HarmonyOS Sans SC';`
  + `src:url("${FONT_ROUTE}/${file}?v=${SKIN_VERSION}") format('truetype');`
  + `font-weight:${weight};font-display:swap}`).join('')

/** Minimum spacing between host scans. The scan runs on the LEADING edge of a
 *  DOM change — a control the shell mounts in response to a click is bound in
 *  the same task, so its glass is already formed at its first paint — and
 *  coalesces to this spacing only under sustained churn (boot, streaming). */
const HOST_SCAN_INTERVAL_MS = 80

/** Attributes whose flip starts a shell reveal or hide: a panel marks itself
 *  (`data-sidebar-right-open`, `aria-hidden`, `hidden`), and the frame raises
 *  `data-animating` across the toggle's track transition. */
const REVEAL_ATTRIBUTES = ['aria-hidden', 'hidden', 'data-sidebar-right-open', 'data-animating']

/**
 * How long after a reveal flip the engine re-checks every frame. The reveal
 * itself is a CSS transition — the right panel's docked content slides in, the
 * frame's grid track eases to its width — that fires NO mutation, resize, or
 * transition event until it ends, and the host only becomes displayable part
 * way through it (its box enters the viewport, the track grows past zero). The
 * scan that the flip itself triggers still sees the closed state, so without
 * this burst the next look would be the periodic sweep, and the glass would
 * land hundreds of milliseconds after the panel. Each frame re-runs the host
 * scan and re-stamps every surface, so the glass forms the moment the box is
 * renderable and rides the slide instead of popping in at its end.
 */
const REVEAL_BURST_MS = 700

/**
 * The 时光壁纸 set: one directory image per time bucket, switching
 * automatically through the day. Buckets are hours [start, end), with the
 * night bucket (18–04) wrapping midnight. The set is deliberately
 * scheme-INDEPENDENT: one image serves both 亮暗, so the wallpaper no longer
 * moves when the shell's theme flips.
 */
const TIME_WALLPAPERS: readonly {
  /** Bucket start hour (inclusive); the last bucket's end wraps to this one. */
  start: number
  end: number
  file: string
}[] = [
  { start: 4, end: 12, file: 'Default/6-blue-light.png' },
  { start: 12, end: 18, file: 'Default/7-black-gray-light.png' },
  { start: 18, end: 4, file: 'Default/8-gray-brown-pink-light.png' },
]

/** How often the time mode re-checks its bucket (a wall-clock minute suffices). */
const TIME_WALLPAPER_CHECK_MS = 30_000

/** One blur is enough: the two blur stages this skin used to carry
 *  (`blur(a) blur(b)`) compose into a single `blur(sqrt(a² + b²))`, so the
 *  frosted blur was merged into the glass blur rather than kept as a second
 *  knob with the same effect. v2 and v1 stores are folded forward on load. */
const STORAGE_KEY = 'ui-liquid-glass/skin/v4'
const PREVIOUS_STORAGE_KEYS = [
  'ui-liquid-glass/skin/v3', 'ui-liquid-glass/skin/v2', 'ui-liquid-glass/skin/v1',
]

/** Keys the pre-registry (v1) storage used, mapped to their current names. */
const LEGACY_KNOBS: Record<string, string> = {
  conc: 'density',
  edgeBand: 'edgeSoftness',
  bright: 'brightness',
  sat: 'saturation',
}

/** Legacy layer ids that were renamed. */
const LEGACY_LAYERS: Record<string, LayerId> = { rightcol: 'rightbar' }

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
export function backdropChain(layer: LayerSpec, values: LayerValues): string {
  const glassBlur = values.glassBlur ?? 0
  const contrast = values.contrast ?? 1
  const brightness = values.brightness ?? 1
  const saturation = values.saturation ?? 1
  const refraction = values.refraction ?? 0
  const grain = values.grain ?? 0
  // Grain rides the filter chain's own stage (the last feComposite), so a
  // taken grain keeps the chain alive even when every other knob is neutral —
  // the capsule never collapses its chain either.
  const identity = refraction === 0 && glassBlur === 0 && grain === 0
    && contrast === 1 && brightness === 1 && saturation === 1
  if (identity) return 'none'
  // Same stages, same ORDER as the capsule's own chain: contrast and saturate do
  // not commute (contrast is an affine offset, saturate a channel matrix), so a
  // reordered chain is a different piece of glass.
  return `url(#lg-refract-${layer.id}) blur(${glassBlur}px)`
    + ` contrast(${contrast}) brightness(${brightness}) saturate(${saturation})`
}

export class SkinEngine {
  private style: HTMLStyleElement | undefined
  private wallpaper: HTMLDivElement | undefined
  private surfacesHost: HTMLDivElement | undefined
  /** Body-level container of the flow lens — above the surface stack, below
   *  every app surface (see flow-lens.ts for why the lens lives there). */
  private flowHost: HTMLDivElement | undefined
  /** The 高亮条 layer's shared flying lens. */
  private flow: FlowHighlight | undefined
  private readonly surfaces = new Map<LayerId, LayerSurface>()
  private readonly refractions = new Map<LayerId, LayerRefraction>()
  private readonly attachedHosts = new Map<LayerId, Element>()
  /** The hook each bound host matched — the scan's fast path (attachHosts). */
  private readonly boundHook = new Map<LayerId, string>()
  private readonly nestedWarned = new Set<LayerId>()
  /** The host each element layer's nesting was last checked on (see
   *  warnIfNested — the walk is not worth repeating for the same element). */
  private readonly nestedChecked = new Map<LayerId, Element>()
  private sweepTimer: ReturnType<typeof setInterval> | undefined
  private hostObserver: MutationObserver | undefined
  private hostScanTimer: ReturnType<typeof setTimeout> | undefined
  /** Last host scan, so scans run on the leading edge of a DOM change. */
  private lastScanAt = 0
  /** Per-frame re-check window after a reveal flip (see REVEAL_BURST_MS). */
  private revealBurstDeadline = 0
  private revealBurstRunning = false
  private markerObserver: MutationObserver | undefined
  /** The user's uploads (root files), cached for the picker. */
  wallpaperUserFiles: string[] = []
  /** The shipped Default set, cached for the time mapping and picker. */
  wallpaperDefaultFiles: string[] = []
  /** The time mode's half-minute bucket check. */
  private schemeObserver: MutationObserver | undefined
  private wallpaperClock: ReturnType<typeof setInterval> | undefined
  /** One shared flush per frame for every surface (read pass, then write
   *  pass): see {@link flushSurfaces}. */
  private flushScheduled = false
  /** One flow sync per frame, asked for by a selection flip. */
  private flowSyncScheduled = false
  /** Last backdrop chain built per layer. `backdropChain()` is a pure function
   *  of the layer id and its five glass knobs — memoising it takes twelve
   *  string builds off every apply that changes none of them. */
  private readonly backdropCache = new Map<string, { key: string, chain: string }>()
  /**
   * The ONE shared layer state: the property panel's rows write this object and
   * every apply() consumes it. Handing out two loaded copies would fork the
   * data — rows would move while the engine kept re-applying the stale
   * snapshot, and every backdrop knob would look dead.
   */
  readonly state: SkinState = loadSkinState()

  async reloadWallpapers(): Promise<void> {
    const listing = await listWallpapers()
    this.wallpaperUserFiles = listing.user.map(entry => entry.id)
    this.wallpaperDefaultFiles = listing.defaults.map(entry => entry.id)
  }

  /** Inject the stylesheet, mount the wallpaper and every layer, enable the skin. */
  mount(): void {
    this.style = document.createElement('style')
    this.style.dataset.plugin = 'ui-liquid-glass-skin'
    this.style.dataset.version = SKIN_VERSION
    this.style.textContent = skinCss + FONT_FACE_CSS
    document.head.appendChild(this.style)

    this.wallpaper = document.createElement('div')
    this.wallpaper.dataset.lgWallpaper = ''
    document.body.appendChild(this.wallpaper)

    this.surfacesHost = document.createElement('div')
    this.surfacesHost.dataset.lgSurfaces = ''
    document.body.appendChild(this.surfacesHost)

    for (const layer of LAYERS) {
      const refraction = new LayerRefraction(layer.id)
      refraction.mount(document.body)
      this.refractions.set(layer.id, refraction)
      if (layer.placement !== 'element') {
        // A released surface whose host becomes renderable again asks for a
        // host scan — that is the one path a rebind can follow when the shell
        // hid the host by a mechanism no observer watches (see surface.ts).
        this.surfaces.set(layer.id, new LayerSurface(
          layer.id,
          layer.rim === true,
          layer.stack ?? 0,
          layer.placement,
          () => this.scheduleHostScan(),
          () => this.requestFlush(),
        ))
      }
    }

    // The flow lens's host paints ABOVE the app content (z 5) — but only
    // while a flight is in the air; at rest the glass is the marked row's
    // own (flow-lens.ts). The refraction filter HOSTS ON THE MARKED ROW via
    // the mark callback: its region and map then follow a real, visible box,
    // so the rest-state knobs (折射强度/边缘柔边/颗粒感) shape the row's
    // glass exactly like the per-row paint always did — a filter left on the
    // hidden lens would collapse to a 2×2 region and every one of those
    // knobs would read as dead.
    this.flowHost = document.createElement('div')
    this.flowHost.dataset.lgFlowhost = ''
    document.body.appendChild(this.flowHost)
    this.flow = new FlowHighlight(this.flowHost, (row) => {
      this.refractions.get('highlight')?.attach(row)
    })

    document.body.dataset.lgSkin = ''
    document.body.dataset.lgSkinVersion = SKIN_VERSION
    document.addEventListener('click', this.onRowClick, true)
    // Observed on BODY, not on the sidebar node captured here: the shell can
    // replace the whole column on a navigation, and an observer on the old
    // node goes deaf — the click marker would silently die on the first
    // session switch. restoreMarker exits immediately while the marker is
    // alive, so the wider scope costs one querySelector per DOM batch.
    this.markerObserver = new MutationObserver(() => this.restoreMarker())
    this.markerObserver.observe(document.body, { childList: true, subtree: true })

    // Hosts mount later than boot (panels, pages, and the composer all arrive
    // on demand) and the shell rebuilds them on session and panel switches, so
    // binding is driven by the DOM itself: a cheap subtree observer reports
    // mounts and the hidden marks the shell flips, coalesced to one sweep per
    // HOST_SCAN_INTERVAL_MS — every millisecond here is a millisecond the
    // freshly opened control spends without its glass. The interval behind it
    // is the safety net for host changes the observer cannot see.
    this.hostObserver = new MutationObserver(records => this.onHostMutation(records))
    this.hostObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'aria-hidden', 'hidden', 'data-sidebar-right-open', 'data-animating',
        // Selection flips: the flow lens retargets on the leading edge of the
        // shell's own marks, not on the page mounts that trail them.
        'aria-current', 'aria-selected',
      ],
    })

    this.runHostScan()
    this.sweepTimer = setInterval(() => {
      // A hidden tab shows nothing that could be stale, and rAF is throttled
      // there anyway: skip the pass rather than queue work nobody sees.
      if (document.hidden) return
      this.attachHosts()
      // The safety net: every surface, full visibility check.
      this.flushSurfaces(true)
    }, 1500)
    this.startWallpaperClock()
    this.startSchemeWatch()
  }

  /**
   * Notice a host mutation. The scan itself is DEFERRED to the next frame: this
   * callback fires inside the shell's own commit, and a scan reads layout —
   * running it here forced a style/layout flush in the middle of the shell's
   * render, which is what made a workspace switch feel like it had to wind up
   * before the new view appeared. A selection flip additionally retargets the
   * flow on the next frame, so the lens starts moving with the shell's paint
   * instead of waiting out the scan throttle.
   */
  private onHostMutation(records: MutationRecord[]): void {
    let selection = false
    for (const record of records) {
      if (record.type !== 'attributes') continue
      const name = record.attributeName ?? ''
      if (REVEAL_ATTRIBUTES.includes(name)) {
        this.startRevealBurst()
        continue
      }
      if (name === 'aria-selected' || name === 'aria-current') selection = true
    }
    if (selection) this.requestFlowSync()
    this.scheduleHostScan()
  }

  /** One flow sync per frame, asked for by a selection flip (see onHostMutation). */
  private requestFlowSync(): void {
    if (this.flowSyncScheduled) return
    this.flowSyncScheduled = true
    requestAnimationFrame(() => {
      this.flowSyncScheduled = false
      this.flow?.sync()
    })
  }

  private startRevealBurst(): void {
    this.revealBurstDeadline = Math.max(this.revealBurstDeadline, performance.now() + REVEAL_BURST_MS)
    if (this.revealBurstRunning) return
    this.revealBurstRunning = true
    const tick = (): void => {
      if (performance.now() >= this.revealBurstDeadline) {
        this.revealBurstRunning = false
        return
      }
      // The burst exists to BIND a host that only becomes renderable part way
      // through the reveal, and to keep every sheet on its box while the track
      // eases. Binding is the expensive half — a full scan re-queries the
      // document for eleven layers (~20 querySelectorAll, each costing a layout
      // read through isDisplayable) and measured 3.5ms/frame, a fifth of the
      // frame budget, for as long as the burst runs. Once every layer already
      // has its host there is nothing left to bind, so only the sheets are
      // re-stamped; a host that gets replaced later is the sweep's and the
      // mutation observer's business.
      if (this.hasUnboundLayer()) this.attachHosts()
      // Every surface must follow the easing track, but only its BOX is read:
      // the visibility probe (one getComputedStyle per surface, the call that
      // re-resolves the document's style just after we dirtied it) is what the
      // quick flag drops. The sweep below still does the full check.
      this.flushSurfaces(true, true)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  /** Whether any layer the scan could bind is still unbound. */
  private hasUnboundLayer(): boolean {
    for (const layer of LAYERS) {
      if (layer.flow === true) continue
      if (!this.attachedHosts.has(layer.id)) return true
    }
    return false
  }

  private scheduleHostScan(): void {
    if (this.hostScanTimer !== undefined) return
    const wait = Math.max(0, HOST_SCAN_INTERVAL_MS - (performance.now() - this.lastScanAt))
    this.hostScanTimer = setTimeout(() => {
      this.hostScanTimer = undefined
      // Never inside the caller's turn: `runHostScan` reads layout, and the
      // caller may well be the shell's own commit (see onHostMutation).
      requestAnimationFrame(() => this.runHostScan())
    }, wait)
  }

  /**
   * Ask for one shared surface flush on the next frame. Every surface that
   * needs re-stamping routes here instead of scheduling its own rAF, so the
   * frame runs a single READ pass (all boxes measured) followed by a single
   * WRITE pass (only changed properties stamped) — no per-surface
   * read-write-read-write, which forced a fresh layout for each of them.
   */
  private requestFlush(): void {
    if (this.flushScheduled) return
    this.flushScheduled = true
    requestAnimationFrame(() => {
      this.flushScheduled = false
      this.flushSurfaces()
    })
  }

  /** Read every surface's box first, then commit them all.
   *  @param all - Re-measure even surfaces that did not ask (the sweep's net).
   *  @param quick - Skip the per-surface visibility probe (see measure). */
  private flushSurfaces(all = false, quick = false): void {
    const plans: Array<{ surface: LayerSurface, plan: SurfacePlan }> = []
    for (const surface of this.surfaces.values()) {
      if (!all && !surface.needsStamp()) continue
      plans.push({ surface, plan: surface.measure(quick) })
    }
    for (const entry of plans) entry.surface.commit(entry.plan)
  }

  private runHostScan(): void {
    this.lastScanAt = performance.now()
    this.attachHosts()
    // A DOM change can move a host WITHOUT resizing it (a banner appears, a
    // sibling grows): re-read every box so the sheets stay glued, but in quick
    // mode — the visibility probe belongs to the sweep, not to every mutation.
    this.flushSurfaces(true, true)
  }

  /** Resolve every layer's host and (re)bind its surface and refraction map. */
  private attachHosts(): void {
    for (const layer of LAYERS) {
      // A flow layer owns one lens for all its hosts: nothing binds here, the
      // scan only re-picks the lens's stop (below).
      if (layer.flow === true) continue
      const current = this.attachedHosts.get(layer.id)
      if (current !== undefined) {
        // An element layer's host is a row the shell re-renders, and it stays
        // sticky while the same node is alive and not hidden — the scan could
        // not rebind it to anything else anyway, so skip the query entirely.
        // Those two layers carry eight of a scan's selectors between them
        // (按钮's seven areas, 新会话's labelled rows): they are most of what a
        // scan costs, and a scan runs on every coalesced DOM mutation.
        if (layer.placement === 'element'
          && current.isConnected && current.getAttribute('aria-hidden') !== 'true') continue
        // Fast path for a host bound by the layer's PREFERRED hook: it is still
        // that hook's match, so the scan's query list could only return it
        // again. One `isDisplayable` instead of `querySelectorAll` per hook —
        // this is the path every scan takes while a session switches.
        const hook = this.boundHook.get(layer.id)
        if (hook !== undefined && hook === layer.hosts[0]
          && current.isConnected && current.matches(hook) && isDisplayable(current)) continue
        // A surface always follows its PREFERRED hook: the shell demotes a
        // closed pane to an inert keep-alive in place and mounts the control
        // that replaces it elsewhere, so holding on to the old element would
        // leave the glass on the wrong box. Re-attaching is cheap — the
        // displacement field is cached by aspect and band, so it costs no
        // canvas work.
        const host = this.findHost(layer)
        const keep = layer.placement !== 'element' && current === host
        if (keep) continue
        this.attachedHosts.delete(layer.id)
        this.boundHook.delete(layer.id)
        this.surfaces.get(layer.id)?.detach()
        this.refractions.get(layer.id)?.detach()
        this.bind(layer, host)
        continue
      }
      this.bind(layer, this.findHost(layer))
    }
    this.flow?.sync()
    this.syncColumnCover()
  }

  /** Bind one layer to `host` (null: leave it unbound). */
  private bind(layer: LayerSpec, host: Element | null): void {
    if (host === null) return
    this.attachedHosts.set(layer.id, host)
    // The hook this host actually matched: the scan's fast path uses it to skip
    // the query list on every later pass (see attachHosts).
    const hook = layer.hosts.find(selector => host.matches(selector)) ?? layer.hosts[0]
    if (hook !== undefined) this.boundHook.set(layer.id, hook)
    const surface = this.surfaces.get(layer.id)
    if (surface !== undefined) {
      surface.attach(host, this.surfacesHost!)
      // The sheet may be suppressed (another layer's page covers the column)
      // and therefore have no box of its own; the host's box is what the field
      // is measured against then (see LayerSurface.hostBox).
      this.refractions.get(layer.id)?.attach(surface.element, () => surface.hostBox())
    } else {
      this.refractions.get(layer.id)?.attach(host)
      this.warnIfNested(layer.id, host)
    }
  }

  /**
   * A full-column sheet (页面) sits directly on its column's own glass —
   * stacking two glasses doubles the refraction and milks the doubled tints,
   * and turning the covered column's knobs would visibly change the sheet on
   * top. While a covering layer is bound, the centre surface keeps tracking
   * its box but paints nothing; lifting the cover restores it unchanged.
   */
  private syncColumnCover(): void {
    this.surfaces.get('center')?.setSuppressed(this.attachedHosts.has('page'))
  }

  /** First host hook that resolves, in the layer's declared order. */
  private findHost(layer: LayerSpec): Element | null {
    for (const selector of layer.hosts) {
      for (const found of document.querySelectorAll(selector)) {
        // A surface is painted across the host's whole box, so only a host the
        // shell is actually rendering may claim one — a collapsed panel keeps
        // its box and would otherwise leave a blank sheet over the column.
        const usable = layer.placement !== 'element'
          ? isDisplayable(found)
          : found.getAttribute('aria-hidden') !== 'true'
        if (usable) return found
      }
    }
    return null
  }

  /**
   * A backdrop-filter nested inside another one stops honouring its own filter
   * functions (measured in Chromium: blur/saturate/brightness/url() all render
   * identically once an ancestor filters the backdrop), so a nested layer can
   * only be tuned through its tint. Report it instead of leaving the panel
   * looking broken — with the register's own layers this never fires.
   */
  private warnIfNested(layer: LayerId, host: Element): void {
    if (this.nestedWarned.has(layer)) return
    // Walking the ancestor chain costs a getComputedStyle per level, and this
    // runs on every re-bind of an element layer. The same host gives the same
    // answer, so only a NEW host is worth the walk.
    if (this.nestedChecked.get(layer) === host) return
    this.nestedChecked.set(layer, host)
    for (let el = host.parentElement; el !== null && el !== document.body; el = el.parentElement) {
      if (getComputedStyle(el).backdropFilter !== 'none') {
        this.nestedWarned.add(layer)
        console.warn(
          `[ui-liquid-glass] layer "${layer}" sits inside a filtered element (${el.className || el.tagName});`
          + ' its backdrop knobs (折射强度/边缘柔边/玻璃模糊/对比度/亮度/饱和度) will not paint there.'
          + ' Only 玻璃浓度 and 圆角 apply.',
        )
        return
      }
    }
  }

  /** Follow the capsule sample's live size: every layer's refraction pull is
   *  expressed in the capsule's own pixels (refraction.ts), so a resized
   *  sample re-scales the whole skin's refraction with it. */
  setLensReference(width: number, height: number): void {
    for (const refraction of this.refractions.values()) refraction.setLensSize(width, height)
  }

  /** The time mode's directory file for right now — what the picker highlights. */
  currentTimeWallpaper(): string | null {
    return this.timeWallpaperFile()
  }

  /** Recompute every `--lg-*` variable, surface, and refraction map. */
  apply(state: SkinState): void {
    const variables: Record<string, string> = {
      // Layer 0 — wallpaper: the dark base tone the photo wallpapers sit on
      // (the grid test look died with the grid mode).
      '--lg-wall-base': 'rgb(16, 18, 23)',
      // The capsule's rim shading at full strength — the element-style layers'
      // fallback; each layer's own --lg-<id>-rim (below) outranks it.
      '--lg-rim-shadow': RIM_SHADOW,
    }

    // The theme colour first: the layer tints are built inside the loop below
    // and 新会话's reads the wash this publishes.
    this.applyThemeColor(state.theme)

    for (const layer of LAYERS) {
      // 浓度/亮度 may come from the scheme (effectiveValues): the tint, the chain and
      // every published variable read these numbers, so this one call keeps a layer
      // consistent with what the panel shows.
      const values = effectiveValues(layer, state)
      const tint = layer.tint(values)
      // `backdropChain()` reads exactly these six knobs and the layer id, and
      // nothing else — memoising it takes twelve string builds off every apply
      // that leaves the glass alone (a scheme flip, the wallpaper clock).
      const backdropKey = `${values.refraction ?? 0}|${values.glassBlur ?? 0}|${values.contrast ?? 1}`
        + `|${values.brightness ?? 1}|${values.saturation ?? 1}|${values.grain ?? 0}`
      const memo = this.backdropCache.get(layer.id)
      let backdrop: string
      if (memo !== undefined && memo.key === backdropKey) {
        backdrop = memo.chain
      } else {
        backdrop = backdropChain(layer, values)
        this.backdropCache.set(layer.id, { key: backdropKey, chain: backdrop })
      }
      const radius = `${values.radius ?? NEUTRAL.radius}px`
      // The rim shading plus the decorative ring, one box-shadow string: the
      // surfaces stamp it inline and the element layers read it as their
      // --lg-<id>-rim variable.
      const rim = rimShadowCss(values.rimStrength ?? NEUTRAL.rimStrength)
        + ringShadowCss(values.borderWidth ?? NEUTRAL.borderWidth, values.borderOpacity ?? NEUTRAL.borderOpacity)
      variables[`--lg-${layer.id}-tint`] = tint
      variables[`--lg-${layer.id}-backdrop`] = backdrop
      variables[`--lg-${layer.id}-radius`] = radius
      variables[`--lg-${layer.id}-rim`] = rim
      this.surfaces.get(layer.id)?.update(tint, backdrop, radius, rim)
      this.refractions.get(layer.id)?.update(
        values.refraction ?? 0,
        values.edgeSoftness ?? NEUTRAL.edgeSoftness,
        values.grain ?? NEUTRAL.grain,
      )
      // The flow layer's lens element reads the four variables above through
      // the stylesheet; its motion comes straight from the same group.
      // A layer that declares `hover` also owns the shell's hover fills: the
      // colour comes from its 色调/色调饱和度 knobs and the strength from its
      // 悬停浓度 — so its capsules can stay pure glass (density 0) while hover
      // feedback stays visible.
      if (layer.hover === true) {
        const saturation = values.tintSaturation ?? NEUTRAL.tintSaturation
        const lightness = 100 - saturation * 50
        const alpha = clamp(values.hoverAlpha ?? NEUTRAL.hoverAlpha, 0, 1)
        variables['--lg-hover-tint'] = `hsla(${values.tintHue ?? NEUTRAL.tintHue}, ${(saturation * 100).toFixed(1)}%, ${lightness.toFixed(1)}%, ${alpha.toFixed(3)})`
      }
      if (layer.flow === true) {
        this.flow?.setMotion({
          stiffness: values.flowStiffness ?? NEUTRAL.flowStiffness,
          damping: values.flowDamping ?? NEUTRAL.flowDamping,
          stretch: values.flowStretch ?? NEUTRAL.flowStretch,
          droplet: values.flowDroplet ?? NEUTRAL.flowDroplet,
        })
      }
    }

    for (const [name, value] of Object.entries(variables)) {
      document.body.style.setProperty(name, value)
    }

    this.applyTextColors(state.theme)
    this.paintWallpaper(state)
  }

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
  private applyThemeColor(theme: ThemeState): void {
    const body = document.body
    const preset = THEME_COLORS.find(entry => entry.id === theme.themeColor) ?? THEME_COLORS[0]!
    // Read back by the 新会话 tint builder; null = "use the layer's own hue/sat".
    setThemeWash(preset.wash)
    if (preset.ramp === null) {
      delete body.dataset.lgTheme
      for (const step of THEME_RAMP_STEPS) body.style.removeProperty(`--lg-theme-${step}`)
      return
    }
    body.dataset.lgTheme = ''
    for (const step of THEME_RAMP_STEPS) body.style.setProperty(`--lg-theme-${step}`, preset.ramp[step])
  }

  private applyTextColors(theme: ThemeState): void {
    const body = document.body
    if (theme.textHue === null || theme.textLight === null) {
      delete body.dataset.lgText
      for (const name of ['--lg-text-primary', '--lg-text-secondary', '--lg-text-tertiary', '--lg-text-caption']) {
        body.style.removeProperty(name)
      }
      return
    }
    body.dataset.lgText = ''
    const light = (offset: number): string =>
      hsl(theme.textHue!, clamp(theme.textLight! - offset, 0, 100))
    body.style.setProperty('--lg-text-primary', light(0))
    body.style.setProperty('--lg-text-secondary', light(14))
    body.style.setProperty('--lg-text-tertiary', light(28))
    body.style.setProperty('--lg-text-caption', light(40))
  }

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
  private paintWallpaper(state: SkinState): void {
    if (this.wallpaper === undefined) return
    const { mode, imageId } = state.wallpaper
    let file: string | null
    if (mode === 'static' && imageId !== null) {
      const known = this.wallpaperUserFiles.length > 0 || this.wallpaperDefaultFiles.length > 0
      file = !known
        || this.wallpaperUserFiles.includes(imageId)
        || this.wallpaperDefaultFiles.includes(imageId)
        ? imageId
        : this.timeWallpaperFile()
    } else {
      file = this.timeWallpaperFile()
    }
    this.wallpaper.style.backgroundImage = file === null
      ? ''
      : `url("${wallpaperUrl(file)}")`
  }

  /** The time mode's file for right now, from the bucket table; a bucket whose
   *  file is missing from the directory falls back to the set's first entry, so
   *  a pruned directory degrades instead of going dark. */
  private timeWallpaperFile(): string | null {
    const hour = new Date().getHours()
    const index = TIME_WALLPAPERS.findIndex(bucket =>
      bucket.start <= bucket.end
        ? hour >= bucket.start && hour < bucket.end
        : hour >= bucket.start || hour < bucket.end)
    if (index < 0) return null
    const wanted = TIME_WALLPAPERS[index]!.file
    if (this.wallpaperDefaultFiles.includes(wanted)) return wanted
    return this.wallpaperDefaultFiles[0] ?? null
  }

  /**
   * Keep the time mode alive: a wall-clock check per half minute catches the
   * bucket change and re-runs the apply pass, which repaints the wallpaper host.
   * Nothing else moves the wallpaper any more — the set does not follow the
   * shell's 亮暗, so there is no attribute to watch.
   */
  private startWallpaperClock(): void {
    if (this.wallpaperClock !== undefined) return
    let lastKey = this.wallpaperClockKey()
    this.wallpaperClock = setInterval(() => {
      const key = this.wallpaperClockKey()
      if (key === lastKey) return
      lastKey = key
      this.apply(this.state)
    }, TIME_WALLPAPER_CHECK_MS)
  }

  /** What the time mode currently shows, as a change key. */
  /**
   * Re-apply when the shell flips its scheme: the `schemeGlass` layers' 浓度/亮度 are
   * scheme-driven (effectiveValues), so the paint has to follow. This is the ONLY
   * scheme dependence left in the skin — nothing here reads or writes the
   * preference itself, and there is no 亮暗 control (removed on request).
   */
  private startSchemeWatch(): void {
    if (this.schemeObserver !== undefined) return
    this.schemeObserver = new MutationObserver(() => { this.apply(this.state) })
    this.schemeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  }

  private wallpaperClockKey(): string {
    return String(new Date().getHours())
  }

  /**
   * Track the open chat: clicking a sidebar row moves the `data-lg-current`
   * marker to it, which is the lens's freshest-choice candidate (and the only
   * mark lists without ARIA selection ever get). Rows are generic — list rows
   * of any plugin alike. The scan is scheduled right here because the marker
   * is not in the host observer's attribute filter: a click must retarget the
   * lens this frame, not after the next sweep.
   */
  private currentKey: string | null = null
  /** The sidebar root, cached for the document-level click listener. */
  private sidebarRoot: Element | null = null
  /** The row currently carrying `data-lg-current` (see markCurrent). */
  private markedRow: Element | null = null

  private readonly onRowClick = (event: MouseEvent): void => {
    const target = event.target as Element | null
    if (target === null) return
    // The sidebar's root is cached: this listener is on the document (capture),
    // so it runs for EVERY click in the app, and a document query per click is
    // stolen straight from the click's own latency budget.
    let sidebar = this.sidebarRoot
    if (sidebar === null || !sidebar.isConnected) {
      sidebar = document.querySelector(COLUMN.sidebar)
      this.sidebarRoot = sidebar
    }
    if (sidebar === null || !sidebar.contains(target)) return
    const row = target.closest('[role="treeitem"]') ?? target.closest('li')
    if (row === null || !sidebar.contains(row)) return
    // A PARENT row (workspace group, pinned header) wraps the real rows:
    // marking it on every expand/collapse is what parked the glass on the
    // header. Only a leaf row is a stop.
    if (row.querySelector('[role="treeitem"], li') === null) this.markCurrent(row)
    this.scheduleHostScan()
  }

  private markCurrent(row: Element): void {
    // The marked row is remembered, so moving the marker is one attribute write
    // instead of a document-wide `[data-lg-current]` sweep per click.
    if (this.markedRow !== null && this.markedRow !== row) this.markedRow.removeAttribute('data-lg-current')
    this.markedRow = row
    row.setAttribute('data-lg-current', '')
    this.currentKey = rowIdentity(row)
    // A click IS a stop change: retarget the flow on the next frame (never in
    // the click handler itself — a sync measures the row, and a forced layout
    // inside the click is exactly the pause the switch used to show).
    this.requestFlowSync()
  }

  /**
   * The shell re-renders the session list on every switch, which can discard
   * the marked node — re-find the row by its stable row key (or its title) and
   * re-mark it.
   */
  private restoreMarker(): void {
    if (this.currentKey === null) return
    // The remembered node answers this without a document query on every DOM
    // batch (this observer sees the whole chat list stream).
    if (this.markedRow !== null && this.markedRow.isConnected) return
    const sidebar = document.querySelector(COLUMN.sidebar)
    if (sidebar === null) return
    for (const candidate of sidebar.querySelectorAll('[role="treeitem"], li')) {
      if (rowIdentity(candidate) !== this.currentKey) continue
      if (candidate.querySelector('[role="treeitem"], li') !== null) continue
      candidate.setAttribute('data-lg-current', '')
      this.markedRow = candidate
      return
    }
  }

  /** Remove the stylesheet, hosts, layers, body tag, and every `--lg-*` variable. */
  destroy(): void {
    if (this.sweepTimer !== undefined) clearInterval(this.sweepTimer)
    this.sweepTimer = undefined
    if (this.hostScanTimer !== undefined) clearTimeout(this.hostScanTimer)
    this.hostScanTimer = undefined
    this.revealBurstDeadline = 0
    if (this.wallpaperClock !== undefined) clearInterval(this.wallpaperClock)
    this.wallpaperClock = undefined
    this.schemeObserver?.disconnect()
    this.schemeObserver = undefined
    this.hostObserver?.disconnect()
    this.hostObserver = undefined
    this.markerObserver?.disconnect()
    this.markerObserver = undefined
    this.attachedHosts.clear()
    this.nestedWarned.clear()
    this.nestedChecked.clear()
    document.removeEventListener('click', this.onRowClick, true)
    this.flow?.destroy()
    this.flow = undefined
    this.flowHost?.remove()
    this.flowHost = undefined
    this.style?.remove()
    this.style = undefined
    this.wallpaper?.remove()
    this.wallpaper = undefined
    this.surfacesHost?.remove()
    this.surfacesHost = undefined
    for (const surface of this.surfaces.values()) surface.destroy()
    this.surfaces.clear()
    for (const refraction of this.refractions.values()) refraction.destroy()
    this.refractions.clear()
    delete document.body.dataset.lgSkin
    delete document.body.dataset.lgSkinVersion
    delete document.body.dataset.lgText
    delete document.body.dataset.lgTheme
    setThemeWash(null)
    for (const name of [...document.body.style]) {
      if (name.startsWith('--lg-')) document.body.style.removeProperty(name)
    }
  }
}

/** Stable identity of a list row: the shell's own row key, else its label. */
function rowIdentity(row: Element): string {
  return row.getAttribute('data-row-key') ?? (row.textContent ?? '').trim()
}

/** Clamp `value` into `min..max`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * The values a layer actually paints with. For a `schemeGlass` layer on auto that
 * means the scheme's 浓度/亮度 (layers.ts SCHEME_GLASS) instead of its own; every other
 * knob — and every other layer — is untouched. Exported because the panel must read
 * the same numbers the engine paints, and the two may not drift apart.
 */
export function effectiveValues(layer: LayerSpec, state: SkinState): LayerValues {
  const values = state.layers[layer.id] ?? defaultValues(layer)
  if (layer.schemeGlass !== true || state.schemeAuto[layer.id] === false) return values
  const scheme = document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
  return { ...values, ...SCHEME_GLASS[scheme] }
}

/** Whether a layer's 浓度/亮度 are the scheme's right now (the panel's tab note). */
export function schemeDrives(layer: LayerSpec, state: SkinState): boolean {
  return layer.schemeGlass === true && state.schemeAuto[layer.id] !== false
}

/** CSS hsl() color from a hue and a lightness percentage (fixed modest saturation). */
function hsl(hue: number, lightness: number): string {
  return `hsl(${Math.round(hue)} 22% ${Math.round(lightness)}%)`
}

/** A fresh state: every layer at its registry defaults. The wallpaper starts
 *  on the time × scheme set (the shipped default directory images). */
function defaultState(): SkinState {
  const layers = {} as Record<LayerId, LayerValues>
  for (const layer of LAYERS) layers[layer.id] = defaultValues(layer)
  return { theme: defaultTheme(), wallpaper: { mode: 'time', imageId: null }, schemeAuto: {}, layers }
}

/** The 主题 category's starting values: the shell's own text palette (no
 *  override — the `data-lg-text` gate stays down). */
export function defaultTheme(): ThemeState {
  // 官方蓝: the shipped default (the author ran 金 for a while in .15 and asked for the
  // shell's own blue back). It is also the preset that publishes NOTHING, so an
  // untouched install paints exactly what the shell paints.
  return { textHue: null, textLight: null, themeColor: 'blue' }
}

/**
 * Load the persisted state, falling back per knob to the registry defaults.
 * Reads both the current layout and the pre-registry (v1) one, where each layer
 * was a top-level key and four knobs had different names.
 */
export function loadSkinState(): SkinState {
  const state = defaultState()
  try {
    const current = localStorage.getItem(STORAGE_KEY)
    if (current !== null) {
      applySaved(state, JSON.parse(current) as Record<string, unknown>)
      return state
    }
    for (const key of PREVIOUS_STORAGE_KEYS) {
      const raw = localStorage.getItem(key)
      if (raw === null) continue
      applySaved(state, migrateStored(JSON.parse(raw) as Record<string, unknown>, key.endsWith('/v1')))
      return state
    }
  } catch {
    // Corrupt or unreadable storage: the defaults above already apply.
  }
  return state
}

export function saveSkinState(state: SkinState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage may be unavailable (quota, private mode): tuning stays session-local.
  }
}

/** Fold a saved document (current or migrated) into `state`, knob by knob. */
function applySaved(state: SkinState, saved: Record<string, unknown>): void {
  const rawWallpaper = saved.wallpaper as Partial<WallpaperState & { gridSize?: number }> | undefined
  if (rawWallpaper !== undefined) {
    // The grid test mode is gone: a stored 'grid' folds to the time set.
    if (rawWallpaper.mode === 'time' || rawWallpaper.mode === 'static') {
      state.wallpaper.mode = rawWallpaper.mode
    }
    if (typeof rawWallpaper.imageId === 'string' || rawWallpaper.imageId === null) {
      state.wallpaper.imageId = rawWallpaper.imageId
    }
  }
  // The scheme opt-outs arrived with .17; a doc from before has none, which means
  // "all auto" — the shipped state.
  const rawAuto = saved.schemeAuto as Record<string, unknown> | undefined
  if (rawAuto !== undefined && typeof rawAuto === 'object') {
    for (const [id, value] of Object.entries(rawAuto)) {
      if (typeof value === 'boolean') state.schemeAuto[id] = value
    }
  }
  const rawTheme = saved.theme as Partial<ThemeState> | undefined
  if (rawTheme !== undefined) {
    for (const key of ['textHue', 'textLight'] as const) {
      if (typeof rawTheme[key] === 'number' || rawTheme[key] === null) state.theme[key] = rawTheme[key]!
    }
    // The theme colour arrived later still; an unknown id falls back to 官方蓝
    // rather than pinning a colour this build does not know.
    if (THEME_COLORS.some(entry => entry.id === rawTheme.themeColor)) {
      state.theme.themeColor = rawTheme.themeColor as ThemeColorId
    }
  }
  const rawLayers = (saved.layers ?? saved) as Record<string, unknown>
  for (const layer of LAYERS) {
    const group = rawLayers[layer.id]
    if (group === null || typeof group !== 'object') continue
    // The highlight's tint colour was the `hue` knob before the surface-craft
    // set unified tints: fold the saved hue into tintHue (an explicit tintHue
    // in the same document then wins, since the copy below runs after).
    if (layer.id === 'highlight' && typeof (group as Record<string, unknown>).hue === 'number') {
      state.layers.highlight.tintHue = (group as Record<string, number>).hue!
    }
    for (const [key, value] of Object.entries(group as Record<string, unknown>)) {
      if (typeof value !== 'number' || !(key in state.layers[layer.id])) continue
      state.layers[layer.id][key] = value
    }
    // 1.2 WAS the shipped contrast default (the demo's value); its level
    // stretching is what banded the wallpaper gradients through the glass, so
    // a stored 1.2 folds to the new neutral default rather than pinning the
    // old look. A deliberately different value survives.
    if ((group as Record<string, unknown>).contrast === 1.2) {
      state.layers[layer.id].contrast = 1
    }
    // 1.5 WAS the input layer's shipped 立体边缘 (inherited from DEFAULT_GLASS);
    // .29 ships 0.8, so an untouched store folds forward exactly like the
    // contrast one above. A deliberately different value survives.
    if (layer.id === 'input' && (group as Record<string, unknown>).rimStrength === 1.5) {
      state.layers.input.rimStrength = 0.8
    }
    // 0 WAS the 按钮 layer's shipped 悬停浓度; .30 ships 0.2, same fold. A drag
    // to any other value — including a deliberate one — survives untouched.
    if (layer.id === 'buttons' && (group as Record<string, unknown>).hoverAlpha === 0) {
      state.layers.buttons.hoverAlpha = 0.2
    }
  }
}

/**
 * Fold an older document into the current shape: rename the knobs v1 called
 * differently, split the pre-split `panel` group, merge the frosted blur every
 * version before v3 carried into the glass blur it composed with, and convert
 * the soft edge from the old 0–1 ratio to the px width that ratio described.
 */
function migrateStored(saved: Record<string, unknown>, legacy: boolean): Record<string, unknown> {
  const document = legacy ? migrateLegacyNames(saved) : saved
  const groups = Object.values((document.layers ?? document) as Record<string, Record<string, unknown>>)
  for (const group of groups) {
    if (group === null || typeof group !== 'object') continue
    const frosted = group.frostBlur
    if (typeof frosted === 'number') {
      const glass = group.glassBlur
      group.glassBlur = Math.sqrt((typeof glass === 'number' ? glass : 0) ** 2 + frosted ** 2)
      delete group.frostBlur
    }
    const softness = group.edgeSoftness
    // Ratios were 0–1; the current knob is a px width on the band reference.
    if (typeof softness === 'number' && softness <= 1.5) group.edgeSoftness = softness * BAND_REFERENCE_PX
  }
  return document
}

/** Soft-edge axis the v1 ratio-to-px conversion resolves against: what the
 *  pre-registry field read 边缘柔边 against. Historical only — current fields
 *  read the knob against the capsule's height (refraction.ts). */
const BAND_REFERENCE_PX = 300

/** Rewrite the v1 key names in place. */
function migrateLegacyNames(legacy: Record<string, unknown>): Record<string, unknown> {
  // v1 stored the layered groups flat and, before the panel split, kept a
  // single `panel` group that every panel surface inherited.
  const panel = legacy.panel as Record<string, number> | undefined
  if (panel !== undefined) {
    for (const id of ['sidebar', 'center', 'rightbar'] as const) legacy[id] ??= { ...panel }
  }
  const layers: Record<string, Record<string, number>> = {}
  for (const [key, value] of Object.entries(legacy)) {
    const id = LEGACY_LAYERS[key] ?? key
    if (id === 'wallpaper' || typeof value !== 'object' || value === null) continue
    const group: Record<string, number> = {}
    for (const [knob, raw] of Object.entries(value as Record<string, number>)) {
      // v1 called the glass blur `blur` and let the wallpaper carry look fields
      // that are constants now.
      const name = knob === 'blur' ? 'glassBlur' : (LEGACY_KNOBS[knob] ?? knob)
      group[name] = raw
    }
    layers[id] = group
  }
  return { wallpaper: legacy.wallpaper, layers }
}
