export declare class LayerRefraction {
    readonly id: string;
    private readonly svg;
    private readonly filter;
    private readonly feImage;
    private readonly feDisplacementMap;
    /** The grain overlay's alpha scale — the one tunable stage past the map. */
    private grainMatrix;
    /** Whether the grain stage is currently in the filter graph (see buildTail). */
    private grainOn;
    private host;
    private observer;
    /** Where to measure when the filtered element has no box of its own — a
     *  suppressed sheet is `display: none` and tracks its host's box instead
     *  (see LayerSurface.hostBox). */
    private fallbackBox;
    /** Last applied knobs; null until the first update (the slider range
     *  includes negative refractions, so -1 cannot serve as an "unset" marker). */
    private refraction;
    private edgeSoftness;
    private grain;
    /** The lens every pull is measured in: the capsule sample's live box. */
    private lensWidth;
    private lensHeight;
    private scheduled;
    /** Pending settle timer for a box that is still moving (see BOX_SETTLE_MS). */
    private settleTimer;
    private settleSince;
    /** Signature of the generated field: the knobs, the lens size and the pull's
     *  clamp box are its inputs; the grid only resamples it. */
    private lastSignature;
    constructor(id: string);
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
    private buildTail;
    /** Attach the filter's SVG and begin tracking `host`'s size. */
    mount(parent: HTMLElement): void;
    /**
     * Bind a host. The field is generated right here, not on a later frame: a
     * control that mounts mid-frame has to be fully formed by the time it is
     * painted, or it visibly settles a moment after appearing.
     */
    attach(host: Element, fallbackBox?: () => {
        width: number;
        height: number;
    } | null): void;
    /**
     * Let go of the host. The filter resets to a no-op over the whole viewport so
     * that a control which mounts before the next scan shows neutral glass rather
     * than the previous host's lens, stretched over the wrong box.
     */
    detach(): void;
    /** Re-run for knob moves (skips when nothing changed). */
    update(refraction: number, edgeSoftness: number, grain?: number): void;
    /** Follow the capsule sample's live size: the pull of every layer is
     *  expressed in the capsule's own pixels, so a resized sample re-scales the
     *  whole skin's refraction with it. */
    setLensSize(width: number, height: number): void;
    destroy(): void;
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
    private queueRegenerate;
    private clearSettle;
    /** Measure the host's box — the field is generated per host aspect and its
     *  pull is capped against this box. The filter's own region needs no stamping:
     *  it is the element's bounding box (see the constructor). */
    private syncRegion;
    private regenerate;
    /**
     * Render the displacement field: the capsule's fragment and the capsule's
     * encoder, verbatim. The pixel pull comes out in the capsule's own px, so the
     * scale attribute below is the lens's norm and nothing else — no host size
     * enters the encoded displacement.
     */
    private renderField;
    private applyField;
}
//# sourceMappingURL=refraction.d.ts.map