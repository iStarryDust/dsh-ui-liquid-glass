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
export const RIM_SHADOW = '0 4px 8px rgba(0, 0, 0, 0.25), 0 -10px 25px inset rgba(0, 0, 0, 0.15)';
/** Attributes that can change how a host (or one of its ancestors) is rendered. */
const WATCHED_ATTRIBUTES = [
    'class', 'style', 'hidden', 'aria-hidden', 'data-sidebar-right-open', 'data-animating',
];
/**
 * Whether `element` is currently being rendered where a surface may paint:
 * connected, not inside an `aria-hidden` / `hidden` / `display: none` branch,
 * not turned invisible, and still overlapping the viewport (a docked pane
 * slides off through a transform, which leaves its box unchanged).
 */
export function isDisplayable(element) {
    if (!element.isConnected)
        return false;
    // The element's own computed visibility already resolves inheritance and any
    // descendant override, so the box-tree checks below only need to look at the
    // attributes the shell flips — on the host itself as well as on its ancestors
    // (a collapsed panel marks the panel, not its children).
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')
        return false;
    for (let node = element; node !== null; node = node.parentElement) {
        if (node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('hidden'))
            return false;
        if (node !== element && getComputedStyle(node).display === 'none')
            return false;
        if (node === document.body)
            break;
    }
    const rect = element.getBoundingClientRect();
    return rect.width >= 1 && rect.height >= 1
        && rect.right > 0 && rect.bottom > 0
        && rect.left < window.innerWidth && rect.top < window.innerHeight;
}
export class LayerSurface {
    element;
    /** How this surface is mounted ('behind' the app or inside its host). */
    placement;
    host = null;
    resizeObserver;
    attributeObserver;
    scheduled = false;
    mounted = false;
    /** Set while another layer's sheet fully covers this one: the surface stays
     *  bound (its box keeps tracking) but paints nothing, so the two glasses
     *  never stack (doubled refraction, milky doubled tints). */
    suppressed = false;
    /** Host styles this surface had to touch to mount inside it (restored on
     *  detach): an absolutely positioned child needs a containing block, and a
     *  negative z-index child needs a stacking context to stay behind the
     *  host's content. */
    hostStyleTouched = null;
    /** Engine callback for a resize on a RELEASED host: the host is renderable
     *  again (or about to be), and only a host scan can rebind the surface —
     *  the release disconnected everything else that watched it. */
    onHostSignal;
    constructor(layer, rim, stack, placement, onHostSignal) {
        this.placement = placement;
        this.onHostSignal = onHostSignal;
        this.element = document.createElement('div');
        this.element.dataset.lgSurface = layer;
        this.element.dataset.lgSurfaceMode = placement;
        this.element.style.display = 'none';
        this.element.style.zIndex = placement === 'inside' ? '-1' : String(stack);
        if (rim)
            this.element.style.boxShadow = RIM_SHADOW;
    }
    /** Track `host`; a 'behind' surface joins `parent`, an 'inside' one mounts
     *  as the host's first child. */
    attach(host, parent) {
        if (this.host !== host) {
            this.resizeObserver?.disconnect();
            this.attributeObserver?.disconnect();
            this.releaseHost();
            this.host = host;
            if (this.placement === 'behind') {
                // While the surface is bound, a resize re-stamps the box; while it is
                // released (detach kept the observer), a resize means the host is back
                // and only the engine's scan can rebind — so it signals instead.
                this.resizeObserver = new ResizeObserver(() => {
                    if (this.host === null)
                        this.onHostSignal?.();
                    else
                        this.queueSync();
                });
                this.resizeObserver.observe(host);
                // The shell hides a panel by flipping an attribute on the panel itself
                // while leaving every box untouched, so the whole ancestor chain is
                // watched — not just the host.
                this.attributeObserver = new MutationObserver(() => this.queueSync());
                for (let node = host; node !== null; node = node.parentElement) {
                    this.attributeObserver.observe(node, { attributes: true, attributeFilter: WATCHED_ATTRIBUTES });
                    if (node === document.body)
                        break;
                }
            }
            else {
                this.prepareHost(host);
            }
            this.mounted = false;
        }
        if (this.placement === 'behind') {
            if (!this.mounted) {
                parent.appendChild(this.element);
                this.mounted = true;
            }
        }
        else if (this.element.parentElement !== host || host.firstElementChild !== this.element) {
            // First child: the host's own content (whatever order the shell mounts
            // it in) stays above this sheet, which is pinned behind it.
            host.prepend(this.element);
            this.mounted = true;
        }
        this.queueSync();
    }
    /**
     * Let go of the host. A 'behind' surface's observer STAYS on the element: a
     * host the shell hides by an unobserved mechanism (an inline style, say) and
     * reshows later reports its resize here, and the release callback asks the
     * engine to rebind — without it the surface would stay dark until the next
     * periodic sweep. An 'inside' surface leaves the DOM with its host.
     */
    detach() {
        this.attributeObserver?.disconnect();
        this.attributeObserver = undefined;
        if (this.placement === 'inside') {
            this.element.remove();
            this.releaseHost();
            this.mounted = false;
            this.host = null;
            return;
        }
        this.host = null;
        this.element.style.display = 'none';
    }
    /** Re-check box and renderability now (used by the skin's periodic sweep,
     *  which is the safety net for host changes no observer reports). */
    sync() {
        this.queueSync();
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
    hostBox() {
        const host = this.host;
        if (host === null)
            return null;
        const rect = host.getBoundingClientRect();
        return { width: Math.max(2, Math.round(rect.width)), height: Math.max(2, Math.round(rect.height)) };
    }
    /** Paint nothing while another sheet fully covers this one; the box keeps
     *  tracking, so lifting the cover restores the sheet unchanged. */
    setSuppressed(suppressed) {
        if (this.suppressed === suppressed)
            return;
        this.suppressed = suppressed;
        this.queueSync();
    }
    update(tint, backdrop, radius, shadow) {
        this.element.style.background = tint;
        this.element.style.backdropFilter = backdrop;
        this.element.style.borderRadius = radius;
        this.element.style.boxShadow = shadow;
    }
    destroy() {
        this.detach();
        this.element.remove();
    }
    /** Coalesce resize bursts and attribute flurries to one check per frame. */
    queueSync() {
        if (this.scheduled)
            return;
        this.scheduled = true;
        requestAnimationFrame(() => {
            this.scheduled = false;
            this.stamp();
        });
    }
    /**
     * Give the host what an absolutely positioned, negative-z child needs, and
     * mark it so the stylesheet hands the layer's glass to this surface
     * (`[data-lg-glass-host]` in skin.css). Only styles the host did not already
     * have are stamped, and detach restores them.
     */
    prepareHost(host) {
        const element = host;
        const computed = getComputedStyle(element);
        const touched = { position: '', isolation: '' };
        if (computed.position === 'static') {
            touched.position = element.style.position;
            element.style.position = 'relative';
        }
        // A negative z-index child joins the nearest STACKING CONTEXT: without one
        // on the host it would paint behind the host's own background instead of
        // just behind its content.
        if (computed.zIndex === 'auto' && computed.isolation !== 'isolate') {
            touched.isolation = element.style.isolation;
            element.style.isolation = 'isolate';
        }
        this.hostStyleTouched = touched;
        element.dataset.lgGlassHost = '';
    }
    releaseHost() {
        if (this.hostStyleTouched !== null) {
            const element = this.host;
            if (element !== null) {
                if (this.hostStyleTouched.position !== '')
                    element.style.position = this.hostStyleTouched.position;
                if (this.hostStyleTouched.isolation !== '')
                    element.style.isolation = this.hostStyleTouched.isolation;
            }
            this.hostStyleTouched = null;
        }
        if (this.host !== null)
            delete this.host.dataset.lgGlassHost;
    }
    stamp() {
        const host = this.host;
        if (this.placement === 'inside') {
            if (host === null)
                return;
            if (!host.isConnected || this.suppressed) {
                this.element.style.display = 'none';
                return;
            }
            this.element.style.display = '';
            // The host's own content can be re-rendered wholesale (React may drop or
            // re-order children it did not create): re-assert the sheet's place, or
            // the glass silently disappears while the host stays on screen.
            if (host.firstElementChild !== this.element)
                host.prepend(this.element);
            return;
        }
        if (host === null || this.suppressed || !isDisplayable(host)) {
            this.element.style.display = 'none';
            return;
        }
        const rect = host.getBoundingClientRect();
        const style = this.element.style;
        style.display = '';
        style.left = `${Math.round(rect.left)}px`;
        style.top = `${Math.round(rect.top)}px`;
        style.width = `${Math.round(rect.width)}px`;
        style.height = `${Math.round(rect.height)}px`;
    }
}
//# sourceMappingURL=surface.js.map