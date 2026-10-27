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
export declare const RIM_SHADOW = "0 4px 8px rgba(0, 0, 0, 0.25), 0 -10px 25px inset rgba(0, 0, 0, 0.15)";
/**
 * Whether `element` is currently being rendered where a surface may paint:
 * connected, not inside an `aria-hidden` / `hidden` / `display: none` branch,
 * not turned invisible, and still overlapping the viewport (a docked pane
 * slides off through a transform, which leaves its box unchanged).
 */
export declare function isDisplayable(element: Element): boolean;
/**
 * What a surface wants to be painted as this frame.
 *
 * The two phases are split so the engine can run ONE read pass over every
 * surface and then ONE write pass: reading a host's box forces layout, writing
 * a sheet's box invalidates it, and interleaving the two — which is what a
 * per-surface stamp did — forces a fresh layout per surface (twelve of them,
 * twice per second, plus every frame of a reveal burst).
 */
export type SurfacePlan = {
    readonly kind: 'hide';
} | {
    readonly kind: 'inside';
} | {
    readonly kind: 'place';
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
};
export declare class LayerSurface {
    readonly element: HTMLDivElement;
    /** How this surface is mounted ('behind' the app or inside its host). */
    private readonly placement;
    private host;
    private resizeObserver;
    private attributeObserver;
    private scheduled;
    private mounted;
    /** Set while another layer's sheet fully covers this one: the surface stays
     *  bound (its box keeps tracking) but paints nothing, so the two glasses
     *  never stack (doubled refraction, milky doubled tints). */
    private suppressed;
    /** Host styles this surface had to touch to mount inside it (restored on
     *  detach): an absolutely positioned child needs a containing block, and a
     *  negative z-index child needs a stacking context to stay behind the
     *  host's content. */
    private hostStyleTouched;
    /** Engine callback for a resize on a RELEASED host: the host is renderable
     *  again (or about to be), and only a host scan can rebind the surface —
     *  the release disconnected everything else that watched it. */
    private readonly onHostSignal;
    /** Engine callback that asks for a shared flush (see {@link SurfacePlan}). */
    private readonly onInvalidate;
    /** What the last commit painted — the diff base. An unchanged plan writes
     *  nothing at all, so a sweep over twelve still surfaces costs twelve
     *  comparisons instead of forty-eight style writes. */
    private applied;
    /** Last values handed to {@link update}, so a re-apply on an unrelated
     *  scheme flip stops rewriting four properties per surface. */
    private appliedPaint;
    constructor(layer: string, rim: boolean, stack: number, placement: 'behind' | 'inside', onHostSignal?: () => void, onInvalidate?: () => void);
    /** Track `host`; a 'behind' surface joins `parent`, an 'inside' one mounts
     *  as the host's first child. */
    attach(host: Element, parent: HTMLElement): void;
    /**
     * Let go of the host. A 'behind' surface's observer STAYS on the element: a
     * host the shell hides by an unobserved mechanism (an inline style, say) and
     * reshows later reports its resize here, and the release callback asks the
     * engine to rebind — without it the surface would stay dark until the next
     * periodic sweep. An 'inside' surface leaves the DOM with its host.
     */
    detach(): void;
    /** Re-check box and renderability now (used by the skin's periodic sweep,
     *  which is the safety net for host changes no observer reports). */
    sync(): void;
    /**
     * The host's live box — what this sheet is sized to whenever it can paint.
     *
     * A suppressed sheet (another layer's page covers the column) is
     * `display: none`, so its OWN box is 0×0 and the layer's displacement field
     * would have nothing to be measured against. The host's box is the right
     * answer: the sheet tracks it, so the field generated for it is exactly the
     * one the sheet needs the moment it paints again.
     */
    hostBox(): {
        width: number;
        height: number;
    } | null;
    /** Paint nothing while another sheet fully covers this one; the box keeps
     *  tracking, so lifting the cover restores the sheet unchanged. */
    setSuppressed(suppressed: boolean): void;
    update(tint: string, backdrop: string, radius: string, shadow: string): void;
    destroy(): void;
    /** Coalesce resize bursts and attribute flurries to one shared flush per frame. */
    private queueSync;
    /**
     * Give the host what an absolutely positioned, negative-z child needs, and
     * mark it so the stylesheet hands the layer's glass to this surface
     * (`[data-lg-glass-host]` in skin.css). Only styles the host did not already
     * have are stamped, and detach restores them.
     */
    private prepareHost;
    private releaseHost;
    /** READ phase — everything that forces layout lives here, and the engine
     *  runs it for every surface before any of them writes (see SurfacePlan). */
    measure(): SurfacePlan;
    /** WRITE phase — only what changed since the last commit is stamped. */
    commit(plan: SurfacePlan): void;
}
//# sourceMappingURL=surface.d.ts.map