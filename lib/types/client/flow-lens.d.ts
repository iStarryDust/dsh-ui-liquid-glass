/** The four motion knobs, as the flow reads them. */
export interface FlowMotion {
    stiffness: number;
    damping: number;
    stretch: number;
    droplet: number;
}
export declare class FlowHighlight {
    /** The lens element — the refraction filter attaches to a MARKED ROW, and
     *  the flight borrows its map. */
    readonly lens: HTMLDivElement;
    private readonly drop;
    /** Per-zone stop state, keyed by the FLOW_STOPS zone names. */
    private readonly zones;
    /** The zone a landing mark belongs to, while a flight is in the air. */
    private pending;
    /** The zone the lens currently flies in (radius + filter priority). */
    private flightZone;
    /** The lens centre spring and the size spring, one stiffness for all four. */
    private centre;
    private size;
    /** The droplet: a softer spring chasing the centre. */
    private droplet;
    private motion;
    private running;
    private lastTime;
    /** Whether the lens is on screen mid-flight. */
    private shown;
    /** Engine callback: a marked row becomes the refraction filter's host, so
     *  the rest-state knobs (折射强度/边缘柔边/颗粒感) shape that row's glass —
     *  the same wiring the per-row paint always had. */
    private readonly onMark;
    private readonly onScroll;
    private readonly onResize;
    constructor(host: HTMLElement, onMark?: (row: Element) => void);
    /** New motion values (a slider moved); the loop reads them next frame. */
    setMotion(motion: FlowMotion): void;
    /**
     * Re-pick every zone's stop and keep the glass on them. The engine's host
     * scan calls this — boot, every coalesced DOM mutation, the periodic sweep,
     * the reveal burst, and the row click — so a click retargets this frame.
     * Zones are independent: a change in one flies the lens there; the other
     * zone's mark is untouched.
     */
    sync(): void;
    destroy(): void;
    /**
     * One zone's candidate hooks — layers.ts's FLOW_STOPS group, resolved live.
     * First LIVE match wins, so exactly one stop per zone exists at any moment.
     * Liveness is deliberately lighter than a surface's: a row that is
     * connected with a real box is a stop, whoever renders it — the shell, an
     * official list, or any plugin's own list (工作区, 聊天记录, a settings
     * section, or a future one).
     */
    private pickZone;
    private zoneState;
    /** Move ONE zone's mark: exactly one stop per zone carries the glass, and
     *  the refraction filter re-hosts onto the zone that changed last. */
    private mark;
    /** Clear a zone's mark (the optional keep is the stop being re-marked). */
    private unmarkZone;
    /** The refraction filter follows the freshest live mark: while settings is
     *  open that is the nav cell (the sidebar is dimmed behind the overlay);
     *  after it closes, back to the sidebar's stop. */
    private hostFilter;
    /** Re-measure the flying destination, shifting the springs by the same
     *  delta so a scrolled row drags the mid-flight lens with it. */
    private followTarget;
    /** Start (or retarget) the flight: THE OLD ROW LETS GO first — its mark is
     *  removed and the lens takes its place (`from`), one continuous glass
     *  leaving one spot — then springs to the new stop (`to`). Skipping the
     *  departure unmark is what leaves a stalled glass on the old row while
     *  the capsule flies. */
    private startFlight;
    /** Appear exactly on `box` — the pixel handoff from the row glass. */
    private spawnAt;
    /** Retarget the flight; layout jumps are invisible by construction — the
     *  paint derives translate and scale from the CURRENT box. */
    private moveTo;
    private hide;
    /** Landing: the mark and the lens swap places in the same frame — the
     *  destination's glass appears exactly where the lens is, then the lens is
     *  gone. The eye sees one continuous piece of glass pour across. */
    private land;
    private wake;
    /** One damped-spring step for the centre and the size, then the droplet's
     *  softer chase (k×0.45, damping capped at 0.85) behind the lens. */
    private integrate;
    /** The flying destination's box (the pending stop's zone box). */
    private flightBox;
    /** Still away from rest (position, size, or the droplet catching up). */
    private isActive;
    /**
     * Stamp the frame: the layout box is the destination's (the refraction
     * field tracks it through its ResizeObserver, so the map regenerates only
     * when a real size changes), the transform carries the whole flight, and
     * the droplet's diameter follows speed.
     */
    private paint;
    /** Stamp the lens ON the box with identity transform — the landing beat's
     *  first half, pixel-identical to the row glass it hands off to. */
    private paintAt;
    private frame;
    /** Whether the lens is visually on the box (position and size inside the
     *  landing threshold, slow enough that it is riding the final approach). */
    private nearBox;
}
//# sourceMappingURL=flow-lens.d.ts.map