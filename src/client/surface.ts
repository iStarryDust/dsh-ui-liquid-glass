/**
 * A plugin-owned glass surface: one element that carries a layer's tint,
 * radius, backdrop chain, and rim shading, painted either BEHIND the app or
 * INSIDE its host (see {@link LayerPlacement} in layers.ts).
 *
 * `'behind'` — a `position: fixed` element tracking an app element's box, for
 * the columns and pages. The skin paints those this way instead of styling the
 * app's own element, because a `backdrop-filter` must not sit inside the
 * subtree of another one — nested, the inner layer stops honouring its own
 * filter functions entirely (see skin.css). Keeping every glassed layer on a
 * sibling surface removes the nesting by construction.
 *
 * `'inside'` — a child of the host itself (`position: absolute; inset: 0;
 * z-index: -1`), for hosts that CONTAIN other glassed controls (a dialog, the
 * composer card, the conversation header). It paints above the host's own
 * background and below its content, and — the point — it is a SIBLING of that
 * content, so the controls inside the host are no longer nested in a filtered
 * subtree and can carry their own filter. The host gets no filter of its own
 * (skin.css keys its element rule off `[data-lg-glass-host]`), which is why the
 * surface, not the element, has to hold the layer's glass.
 *
 * The fixed element escapes the hosts' clipping, so it re-checks how the host
 * is being rendered — hidden attribute, computed visibility, off-viewport box —
 * instead of trusting the box alone, and refreshes on host box changes and on
 * attribute changes anywhere up the host's ancestor chain. The inside element
 * needs none of that: it is a real child, so the host's own layout and
 * visibility govern it.
 */

/**
 * The capsule's rim shading — its drop shadow plus the top inset shade that
 * give the glass its edge. One constant for the whole skin: rimmed surfaces
 * stamp it inline, and the engine publishes it as `--lg-rim-shadow` for the
 * element-style layers (composer card, highlight rows, dialogs) in skin.css.
 */
export const RIM_SHADOW = '0 4px 8px rgba(0, 0, 0, 0.25), 0 -10px 25px inset rgba(0, 0, 0, 0.15)'

/** Attributes that can change how a host (or one of its ancestors) is rendered. */
const WATCHED_ATTRIBUTES = [
  'class', 'style', 'hidden', 'aria-hidden', 'data-sidebar-right-open', 'data-animating',
]

/**
 * Whether `element` is currently being rendered where a surface may paint:
 * connected, not inside an `aria-hidden` / `hidden` / `display: none` branch,
 * not turned invisible, and still overlapping the viewport (a docked pane
 * slides off through a transform, which leaves its box unchanged).
 */
export function isDisplayable(element: Element): boolean {
  if (!element.isConnected) return false
  // One computed read for the element itself: `visibility` inherits, `display`
  // does not — and an ancestor's `display: none` collapses this element's own
  // box to 0×0, so the rect check at the end already rejects that case. The
  // remaining ancestor-only signal is the attribute pair the shell flips, and
  // `closest()` answers it in one native walk instead of a
  // `getComputedStyle()` per level (that walk ran on every stamp of every
  // surface — see the sweep in skin.ts).
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
  if (element.closest('[hidden], [aria-hidden="true"]') !== null) return false
  const rect = element.getBoundingClientRect()
  return rect.width >= 1 && rect.height >= 1
    && rect.right > 0 && rect.bottom > 0
    && rect.left < window.innerWidth && rect.top < window.innerHeight
}

/**
 * What a surface wants to be painted as this frame.
 *
 * The two phases are split so the engine can run ONE read pass over every
 * surface and then ONE write pass: reading a host's box forces layout, writing
 * a sheet's box invalidates it, and interleaving the two — which is what a
 * per-surface stamp did — forces a fresh layout per surface (twelve of them,
 * twice per second, plus every frame of a reveal burst).
 */
export type SurfacePlan =
  | { readonly kind: 'hide' }
  | { readonly kind: 'inside' }
  | { readonly kind: 'place', readonly left: number, readonly top: number, readonly width: number, readonly height: number }

const PLAN_HIDE: SurfacePlan = { kind: 'hide' }
const PLAN_INSIDE: SurfacePlan = { kind: 'inside' }

export class LayerSurface {
  readonly element: HTMLDivElement
  /** How this surface is mounted ('behind' the app or inside its host). */
  private readonly placement: 'behind' | 'inside'
  private host: Element | null = null
  private resizeObserver: ResizeObserver | undefined
  private attributeObserver: MutationObserver | undefined
  private scheduled = false
  private mounted = false
  /** Set while another layer's sheet fully covers this one: the surface stays
   *  bound (its box keeps tracking) but paints nothing, so the two glasses
   *  never stack (doubled refraction, milky doubled tints). */
  private suppressed = false
  /** Host styles this surface had to touch to mount inside it (restored on
   *  detach): an absolutely positioned child needs a containing block, and a
   *  negative z-index child needs a stacking context to stay behind the
   *  host's content. */
  private hostStyleTouched: { position: string, isolation: string } | null = null
  /** Engine callback for a resize on a RELEASED host: the host is renderable
   *  again (or about to be), and only a host scan can rebind the surface —
   *  the release disconnected everything else that watched it. */
  private readonly onHostSignal: (() => void) | undefined
  /** Engine callback that asks for a shared flush (see {@link SurfacePlan}). */
  private readonly onInvalidate: (() => void) | undefined
  /** What the last commit painted — the diff base. An unchanged plan writes
   *  nothing at all, so a sweep over twelve still surfaces costs twelve
   *  comparisons instead of forty-eight style writes. */
  private applied: SurfacePlan = PLAN_HIDE
  /** Last values handed to {@link update}, so a re-apply on an unrelated
   *  scheme flip stops rewriting four properties per surface. */
  private appliedPaint: string | null = null

  constructor(
    layer: string,
    rim: boolean,
    stack: number,
    placement: 'behind' | 'inside',
    onHostSignal?: () => void,
    onInvalidate?: () => void,
  ) {
    this.placement = placement
    this.onHostSignal = onHostSignal
    this.onInvalidate = onInvalidate
    this.element = document.createElement('div')
    this.element.dataset.lgSurface = layer
    this.element.dataset.lgSurfaceMode = placement
    this.element.style.display = 'none'
    this.element.style.zIndex = placement === 'inside' ? '-1' : String(stack)
    // No box-shadow, border or descendant can escape: style/layout containment
    // narrows the invalidation this sheet causes without touching its paint.
    this.element.style.contain = 'layout style'
    if (rim) this.element.style.boxShadow = RIM_SHADOW
  }

  /** Track `host`; a 'behind' surface joins `parent`, an 'inside' one mounts
   *  as the host's first child. */
  attach(host: Element, parent: HTMLElement): void {
    if (this.host !== host) {
      this.resizeObserver?.disconnect()
      this.attributeObserver?.disconnect()
      this.releaseHost()
      this.host = host
      if (this.placement === 'behind') {
        // While the surface is bound, a resize re-stamps the box; while it is
        // released (detach kept the observer), a resize means the host is back
        // and only the engine's scan can rebind — so it signals instead.
        this.resizeObserver = new ResizeObserver(() => {
          if (this.host === null) this.onHostSignal?.()
          else this.queueSync()
        })
        this.resizeObserver.observe(host)
        // The shell hides a panel by flipping an attribute on the panel itself
        // while leaving every box untouched, so the whole ancestor chain is
        // watched — not just the host.
        this.attributeObserver = new MutationObserver(() => this.queueSync())
        for (let node: Element | null = host; node !== null; node = node.parentElement) {
          this.attributeObserver.observe(node, { attributes: true, attributeFilter: WATCHED_ATTRIBUTES })
          if (node === document.body) break
        }
      } else {
        this.prepareHost(host)
      }
      this.mounted = false
      // A new host is a new box: drop the diff base so the next commit stamps
      // geometry even when the numbers happen to match the old host's.
      this.applied = PLAN_HIDE
    }
    if (this.placement === 'behind') {
      if (!this.mounted) {
        parent.appendChild(this.element)
        this.mounted = true
      }
    } else if (this.element.parentElement !== host || host.firstElementChild !== this.element) {
      // First child: the host's own content (whatever order the shell mounts
      // it in) stays above this sheet, which is pinned behind it.
      host.prepend(this.element)
      this.mounted = true
    }
    this.queueSync()
  }

  /**
   * Let go of the host. A 'behind' surface's observer STAYS on the element: a
   * host the shell hides by an unobserved mechanism (an inline style, say) and
   * reshows later reports its resize here, and the release callback asks the
   * engine to rebind — without it the surface would stay dark until the next
   * periodic sweep. An 'inside' surface leaves the DOM with its host.
   */
  detach(): void {
    this.attributeObserver?.disconnect()
    this.attributeObserver = undefined
    this.applied = PLAN_HIDE
    if (this.placement === 'inside') {
      this.element.remove()
      this.releaseHost()
      this.mounted = false
      this.host = null
      return
    }
    this.host = null
    this.element.style.display = 'none'
  }

  /** Re-check box and renderability now (used by the skin's periodic sweep,
   *  which is the safety net for host changes no observer reports). */
  sync(): void {
    this.queueSync()
  }

  /**
   * The host's live box — what this sheet is sized to whenever it can paint.
   *
   * A suppressed sheet (another layer's page covers the column) is
   * `display: none`, so its OWN box is 0×0 and the layer's displacement field
   * would have nothing to be measured against. The host's box is the right
   * answer: the sheet tracks it, so the field generated for it is exactly the
   * one the sheet needs the moment it paints again.
   */
  hostBox(): { width: number, height: number } | null {
    const host = this.host
    if (host === null) return null
    const rect = host.getBoundingClientRect()
    return { width: Math.max(2, Math.round(rect.width)), height: Math.max(2, Math.round(rect.height)) }
  }

  /** Paint nothing while another sheet fully covers this one; the box keeps
   *  tracking, so lifting the cover restores the sheet unchanged. */
  setSuppressed(suppressed: boolean): void {
    if (this.suppressed === suppressed) return
    this.suppressed = suppressed
    this.queueSync()
  }

  update(tint: string, backdrop: string, radius: string, shadow: string): void {
    const paint = `${tint}\u0000${backdrop}\u0000${radius}\u0000${shadow}`
    if (paint === this.appliedPaint) return
    this.appliedPaint = paint
    this.element.style.background = tint
    this.element.style.backdropFilter = backdrop
    this.element.style.borderRadius = radius
    this.element.style.boxShadow = shadow
  }

  destroy(): void {
    this.detach()
    this.element.remove()
  }

  /** Coalesce resize bursts and attribute flurries to one shared flush per frame. */
  private queueSync(): void {
    if (this.scheduled) return
    this.scheduled = true
    requestAnimationFrame(() => {
      this.scheduled = false
      if (this.onInvalidate !== undefined) {
        this.onInvalidate()
        return
      }
      // No engine attached (a bare surface in a test): paint immediately.
      this.commit(this.measure())
    })
  }

  /**
   * Give the host what an absolutely positioned, negative-z child needs, and
   * mark it so the stylesheet hands the layer's glass to this surface
   * (`[data-lg-glass-host]` in skin.css). Only styles the host did not already
   * have are stamped, and detach restores them.
   */
  private prepareHost(host: Element): void {
    const element = host as HTMLElement
    const computed = getComputedStyle(element)
    const touched = { position: '', isolation: '' }
    if (computed.position === 'static') {
      touched.position = element.style.position
      element.style.position = 'relative'
    }
    // A negative z-index child joins the nearest STACKING CONTEXT: without one
    // on the host it would paint behind the host's own background instead of
    // just behind its content.
    if (computed.zIndex === 'auto' && computed.isolation !== 'isolate') {
      touched.isolation = element.style.isolation
      element.style.isolation = 'isolate'
    }
    this.hostStyleTouched = touched
    element.dataset.lgGlassHost = ''
  }

  private releaseHost(): void {
    if (this.hostStyleTouched !== null) {
      const element = this.host as HTMLElement | null
      if (element !== null) {
        if (this.hostStyleTouched.position !== '') element.style.position = this.hostStyleTouched.position
        if (this.hostStyleTouched.isolation !== '') element.style.isolation = this.hostStyleTouched.isolation
      }
      this.hostStyleTouched = null
    }
    if (this.host !== null) delete (this.host as HTMLElement).dataset.lgGlassHost
  }

  /** READ phase — everything that forces layout lives here, and the engine
   *  runs it for every surface before any of them writes (see SurfacePlan). */
  measure(): SurfacePlan {
    const host = this.host
    if (this.placement === 'inside') {
      if (host === null || !host.isConnected || this.suppressed) return PLAN_HIDE
      return PLAN_INSIDE
    }
    if (host === null || this.suppressed || !isDisplayable(host)) return PLAN_HIDE
    const rect = host.getBoundingClientRect()
    return {
      kind: 'place',
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }

  /** WRITE phase — only what changed since the last commit is stamped. */
  commit(plan: SurfacePlan): void {
    const style = this.element.style
    if (plan.kind === 'hide') {
      if (this.applied.kind !== 'hide') style.display = 'none'
      this.applied = plan
      return
    }
    if (plan.kind === 'inside') {
      if (this.applied.kind !== 'inside') style.display = ''
      this.applied = plan
      const host = this.host
      // The host's own content can be re-rendered wholesale (React may drop or
      // re-order children it did not create): re-assert the sheet's place, or
      // the glass silently disappears while the host stays on screen.
      if (host !== null && host.firstElementChild !== this.element) host.prepend(this.element)
      return
    }
    if (this.applied.kind !== 'place') style.display = ''
    const prev = this.applied
    if (prev.kind !== 'place' || prev.left !== plan.left) style.left = `${plan.left}px`
    if (prev.kind !== 'place' || prev.top !== plan.top) style.top = `${plan.top}px`
    if (prev.kind !== 'place' || prev.width !== plan.width) style.width = `${plan.width}px`
    if (prev.kind !== 'place' || prev.height !== plan.height) style.height = `${plan.height}px`
    this.applied = plan
  }
}
