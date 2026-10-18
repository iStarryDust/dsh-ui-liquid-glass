/**
 * The highlight lens: the glass stops are marked elements and the lens FLIES
 * between a zone's stops.
 *
 * Two halves, deliberately unequal in authority:
 *
 * - The STOPS (static, authoritative). Each zone marks its active row with
 *   `data-lg-flow-target` and the skin stylesheet paints THAT ROW with the
 *   高亮条 layer's glass — the same element-level paint the skin always
 *   used, above every app fill, text crisp, zero dependence on anything
 *   animated. Zones are independent: the sidebar's chat highlight STAYS LIT
 *   while the settings dialog's nav carries its own — opening settings never
 *   extinguishes the list behind it. Exactly one stop per zone is marked at
 *   any moment.
 *
 * - The FLIGHT (transient, decorative). When a zone's stop changes, a glass
 *   lens spawns on the OLD box — pixel-identical to the row glass that just
 *   handed off — and springs to the new one: one damped spring for centre
 *   and size, stretch conservation along the motion axis, the trailing
 *   droplet chasing at a softer spring. The lens is `position: fixed` ABOVE
 *   the app content (and above the settings overlay — it must be visible
 *   over the dialog it flies in) for the few hundred milliseconds it flies,
 *   and is display:none at rest. Landing pins the lens on the box (identity
 *   transform, pixel-identical to the row glass) and swaps the mark a beat
 *   later, so the handoff never reads as a reset. Every failure of the
 *   flight leaves the static marks untouched.
 *
 * The material is NOT restated: both halves read the 高亮条 layer's
 * `--lg-highlight-*` variables through the skin stylesheet, and the layer's
 * refraction filter hosts on a marked row (the zone that changed last —
 * while settings is open that is the nav cell; the sidebar's glass behind
 * the overlay is dimmed anyway). Only the four motion knobs
 * (flowStiffness/flowDamping/flowStretch/flowDroplet) drive the arithmetic.
 */
import { COLUMN, FLOW_STOPS } from "./layers.js";
/** The settings dialog's structural mark: one flow ZONE. The sidebar is the
 *  other. Zones keep their marks independently; the lens flies within one. */
const SETTINGS_ZONE = "[data-shortcut-modal='settings']";
/** The mark: the skin stylesheet paints exactly this element. */
const MARK = 'data-lg-flow-target';
/** Flight speed that maps to full stretch (px/s). */
const SPEED_NORM = 900;
/** How long a zone keeps its mark after its stop vanished (list re-renders
 *  swap the row nodes for a frame or two; a disconnected mark paints
 *  nothing, so holding it costs nothing and re-lands silently). */
const GRACE_MS = 900;
/** Sub-1 integration step ceiling: a stalled frame must not jump the spring. */
const MAX_DT = 1 / 30;
/** Distance (px) below which a "new" stop is the old one re-rendered in
 *  place — no flight, the mark swaps silently. */
const SAME_SPOT_PX = 2;
/** Landing thresholds: inside these the lens is VISUALLY on the box — the
 *  spring's remaining sub-pixel wiggle (ζ<1 decays exponentially, so the last
 *  half-pixel takes longer than the whole visible flight) is not worth
 *  delaying the handoff for. */
const LAND_PX = 2;
const LAND_SPEED = 25;
/**
 * The frame source: rAF when the environment issues it. Some embedded
 * preview surfaces never deliver a rAF, so 50ms without one permanently
 * switches to a setTimeout 60fps — the map generation and the animation
 * share the entry, so the glass still forms.
 */
let useTimeoutFrames = false;
function scheduleFrame(callback) {
    if (useTimeoutFrames) {
        setTimeout(() => { callback(performance.now()); }, 1000 / 60);
        return;
    }
    let ran = false;
    requestAnimationFrame((time) => {
        ran = true;
        callback(time);
    });
    setTimeout(() => {
        if (!ran) {
            useTimeoutFrames = true;
            callback(performance.now());
        }
    }, 50);
}
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
export class FlowHighlight {
    /** The lens element — the refraction filter attaches to a MARKED ROW, and
     *  the flight borrows its map. */
    lens;
    drop;
    /** Per-zone stop state, keyed by the FLOW_STOPS zone names. */
    zones = new Map();
    /** The zone a landing mark belongs to, while a flight is in the air. */
    pending = null;
    /** The zone the lens currently flies in (radius + filter priority). */
    flightZone = null;
    /** The lens centre spring and the size spring, one stiffness for all four. */
    centre = { x: 0, y: 0, vx: 0, vy: 0 };
    size = { w: 10, h: 10, vw: 0, vh: 0 };
    /** The droplet: a softer spring chasing the centre. */
    droplet = { x: 0, y: 0, vx: 0, vy: 0 };
    motion = { stiffness: 150, damping: 0.74, stretch: 0.26, droplet: 0 };
    running = false;
    lastTime = 0;
    /** Whether the lens is on screen mid-flight. */
    shown = false;
    /** Engine callback: a marked row becomes the refraction filter's host, so
     *  the rest-state knobs (折射强度/边缘柔边/颗粒感) shape that row's glass —
     *  the same wiring the per-row paint always had. */
    onMark;
    onScroll = () => {
        if (!this.shown)
            return;
        // Scrolling moves the destination under a flying lens: shift every spring
        // and the box by the row's own delta so the flight stays glued to reality.
        this.followTarget();
        if (!this.running)
            this.paint();
    };
    onResize = () => {
        if (!this.shown)
            return;
        this.followTarget();
        this.wake();
    };
    constructor(host, onMark) {
        this.onMark = onMark;
        this.drop = document.createElement('div');
        this.drop.dataset.lgFlowDrop = 'drop';
        this.drop.style.display = 'none';
        this.lens = document.createElement('div');
        this.lens.dataset.lgFlowLens = 'lens';
        this.lens.style.display = 'none';
        host.append(this.drop, this.lens);
        window.addEventListener('scroll', this.onScroll, true);
        window.addEventListener('resize', this.onResize);
    }
    /** New motion values (a slider moved); the loop reads them next frame. */
    setMotion(motion) {
        this.motion = motion;
    }
    /**
     * Re-pick every zone's stop and keep the glass on them. The engine's host
     * scan calls this — boot, every coalesced DOM mutation, the periodic sweep,
     * the reveal burst, and the row click — so a click retargets this frame.
     * Zones are independent: a change in one flies the lens there; the other
     * zone's mark is untouched.
     */
    sync() {
        let wanted = null;
        for (const group of FLOW_STOPS) {
            const state = this.zoneState(group.zone);
            const next = this.pickZone(group);
            if (next === null) {
                // A transient gap (list swap): hold the MARK through the grace — a
                // disconnected mark paints nothing, so re-landing it later is free.
                if (state.stop !== null && this.pending?.zone !== group.zone) {
                    if (state.missingSince === 0)
                        state.missingSince = performance.now();
                    // The LENS is not the mark: retract it, and only keep the mark's
                    // grace. In every zone the resting glass is now the marked element's
                    // OWN paint (see skin.css), so a lens still on screen is either
                    // mid-flight or waiting to land — never a resident. It is retracted
                    // once the ZONE is really gone (the dialog closed); a row that merely
                    // re-rendered while its zone is still mounted keeps its flight.
                    const zoneGone = zoneRoot(group.zone) === null;
                    if (this.pending === null && this.flightZone === group.zone && this.shown && zoneGone) {
                        this.hide();
                        this.flightZone = null;
                        this.hostFilter();
                    }
                    else if (performance.now() - state.missingSince > GRACE_MS) {
                        this.unmarkZone(group.zone);
                        state.stop = null;
                        state.missingSince = 0;
                        if (this.flightZone === group.zone && this.shown)
                            this.hide();
                        this.hostFilter();
                    }
                }
                continue;
            }
            state.missingSince = 0;
            if (state.stop === next)
                continue;
            const from = state.box;
            state.stop = next;
            const to = boxOf(next);
            const travelled = Math.abs(to.x - from.x) + Math.abs(to.y - from.y) + Math.abs(to.w - from.w) + Math.abs(to.h - from.h);
            state.box = to;
            if (!state.placed || travelled < SAME_SPOT_PX) {
                // First placement or a re-render in place: no travel, the mark is the
                // whole story. (The flight plays regardless of prefers-reduced-motion:
                // the travel IS the feature, and skipping it made the whole effect
                // vanish on systems with OS animations off.) If a lens is still on
                // screen for this zone, it lands NOW — a mark with no flight must not
                // leave a capsule floating toward a stale box.
                this.mark(group.zone, next);
                if (this.pending?.zone === group.zone) {
                    this.pending = null;
                    this.hide();
                }
                state.placed = true;
                // The mark alone is the whole story: the marked element carries the
                // glass itself, so opening a dialog shows its active cell already
                // glassed, with nothing to park.
                continue;
            }
            // Two zones wanting the lens in one pass is theoretically possible and
            // practically never happens (a zone only changes on user input); the
            // later want wins and the earlier lands via the watchdog.
            wanted = { zone: group.zone, el: next, box: to, from };
        }
        if (wanted !== null)
            this.startFlight(wanted.zone, wanted.el, wanted.box, wanted.from);
    }
    destroy() {
        window.removeEventListener('scroll', this.onScroll, true);
        window.removeEventListener('resize', this.onResize);
        this.running = false;
        this.drop.remove();
        this.lens.remove();
        this.zones.clear();
        this.pending = null;
        this.shown = false;
        for (const marked of document.querySelectorAll(`[${MARK}]`))
            marked.removeAttribute(MARK);
    }
    /**
     * One zone's candidate hooks — layers.ts's FLOW_STOPS group, resolved live.
     * First LIVE match wins, so exactly one stop per zone exists at any moment.
     * Liveness is deliberately lighter than a surface's: a row that is
     * connected with a real box is a stop, whoever renders it — the shell, an
     * official list, or any plugin's own list (工作区, 聊天记录, a settings
     * section, or a future one).
     */
    pickZone(group) {
        for (const selector of group.selectors) {
            for (const found of document.querySelectorAll(selector)) {
                if (!found.isConnected)
                    continue;
                const rect = found.getBoundingClientRect();
                if (rect.width >= 1 && rect.height >= 1)
                    return found;
            }
        }
        return null;
    }
    zoneState(zone) {
        let state = this.zones.get(zone);
        if (state === undefined) {
            state = { stop: null, box: { x: 0, y: 0, w: 10, h: 10 }, placed: false, missingSince: 0 };
            this.zones.set(zone, state);
        }
        return state;
    }
    /** Move ONE zone's mark: exactly one stop per zone carries the glass, and
     *  the refraction filter re-hosts onto the zone that changed last. */
    mark(zone, next) {
        this.unmarkZone(zone, next);
        next.setAttribute(MARK, '');
        this.onMark?.(next);
    }
    /** Clear a zone's mark (the optional keep is the stop being re-marked). */
    unmarkZone(zone, keep) {
        for (const marked of document.querySelectorAll(`[${MARK}]`)) {
            if (marked !== keep && zoneOf(marked) === zone)
                marked.removeAttribute(MARK);
        }
    }
    /** The refraction filter follows the freshest live mark: while settings is
     *  open that is the nav cell (the sidebar is dimmed behind the overlay);
     *  after it closes, back to the sidebar's stop. */
    hostFilter() {
        const order = this.flightZone !== null ? [this.flightZone] : [];
        for (const zone of this.zones.keys()) {
            if (!order.includes(zone))
                order.push(zone);
        }
        for (const zone of order) {
            const stop = this.zones.get(zone)?.stop ?? null;
            if (stop !== null && stop.isConnected) {
                this.onMark?.(stop);
                return;
            }
        }
    }
    /** Re-measure the flying destination, shifting the springs by the same
     *  delta so a scrolled row drags the mid-flight lens with it. */
    followTarget() {
        if (this.pending === null)
            return;
        const state = this.zones.get(this.pending.zone);
        if (state === undefined)
            return;
        const box = boxOf(this.pending.el);
        const dx = box.x - state.box.x;
        const dy = box.y - state.box.y;
        state.box = box;
        if (dx === 0 && dy === 0)
            return;
        this.centre.x += dx;
        this.centre.y += dy;
        this.droplet.x += dx;
        this.droplet.y += dy;
    }
    /** Start (or retarget) the flight: THE OLD ROW LETS GO first — its mark is
     *  removed and the lens takes its place (`from`), one continuous glass
     *  leaving one spot — then springs to the new stop (`to`). Skipping the
     *  departure unmark is what leaves a stalled glass on the old row while
     *  the capsule flies. */
    startFlight(zone, el, to, from) {
        this.unmarkZone(zone);
        if (!this.shown || this.flightZone !== zone) {
            // A lens already flying in the OTHER zone cannot hand off smoothly —
            // it simply redeploys onto this zone's old box.
            this.spawnAt(from);
        }
        this.flightZone = zone;
        this.pending = { zone, el };
        this.moveTo(to);
    }
    /** Appear exactly on `box` — the pixel handoff from the row glass. */
    spawnAt(box) {
        const centreX = box.x + box.w / 2;
        const centreY = box.y + box.h / 2;
        this.centre = { x: centreX, y: centreY, vx: 0, vy: 0 };
        this.size = { w: box.w, h: box.h, vw: 0, vh: 0 };
        this.droplet = { x: centreX, y: centreY, vx: 0, vy: 0 };
        this.lens.style.display = '';
        // A lens redeploying from another zone may carry a stale transform.
        this.lens.style.transform = 'translate3d(0, 0, 0) scale(1, 1)';
        this.shown = true;
        this.paintAt(box);
    }
    /** Retarget the flight; layout jumps are invisible by construction — the
     *  paint derives translate and scale from the CURRENT box. */
    moveTo(box) {
        const state = this.pending === null ? undefined : this.zones.get(this.pending.zone);
        if (state !== undefined)
            state.box = box;
        this.wake();
    }
    hide() {
        this.lens.style.display = 'none';
        this.drop.style.display = 'none';
        this.shown = false;
        this.running = false;
    }
    /** Landing: the mark and the lens swap places in the same frame — the
     *  destination's glass appears exactly where the lens is, then the lens is
     *  gone. The eye sees one continuous piece of glass pour across. */
    land() {
        const pending = this.pending;
        this.pending = null;
        if (pending !== null) {
            const state = this.zoneState(pending.zone);
            if (pending.el.isConnected)
                this.mark(pending.zone, pending.el);
            else {
                state.stop = null;
                this.unmarkZone(pending.zone);
                this.hostFilter();
            }
        }
        this.hide();
    }
    wake() {
        if (this.running || !this.shown)
            return;
        this.running = true;
        this.lastTime = performance.now();
        scheduleFrame((time) => { this.frame(time); });
    }
    /** One damped-spring step for the centre and the size, then the droplet's
     *  softer chase (k×0.45, damping capped at 0.85) behind the lens. */
    integrate(dt) {
        const k = this.motion.stiffness;
        const c = 2 * Math.sqrt(k) * this.motion.damping;
        const centreX = this.flightBox().x + this.flightBox().w / 2;
        const centreY = this.flightBox().y + this.flightBox().h / 2;
        this.centre.vx += (k * (centreX - this.centre.x) - c * this.centre.vx) * dt;
        this.centre.x += this.centre.vx * dt;
        this.centre.vy += (k * (centreY - this.centre.y) - c * this.centre.vy) * dt;
        this.centre.y += this.centre.vy * dt;
        this.size.vw += (k * (this.flightBox().w - this.size.w) - c * this.size.vw) * dt;
        this.size.w += this.size.vw * dt;
        this.size.vh += (k * (this.flightBox().h - this.size.h) - c * this.size.vh) * dt;
        this.size.h += this.size.vh * dt;
        const kd = k * 0.45;
        const cd = 2 * Math.sqrt(kd) * Math.min(this.motion.damping, 0.85);
        this.droplet.vx += (kd * (this.centre.x - this.droplet.x) - cd * this.droplet.vx) * dt;
        this.droplet.x += this.droplet.vx * dt;
        this.droplet.vy += (kd * (this.centre.y - this.droplet.y) - cd * this.droplet.vy) * dt;
        this.droplet.y += this.droplet.vy * dt;
        return this.isActive();
    }
    /** The flying destination's box (the pending stop's zone box). */
    flightBox() {
        if (this.pending !== null) {
            const state = this.zones.get(this.pending.zone);
            if (state !== undefined)
                return state.box;
        }
        return { x: 0, y: 0, w: 10, h: 10 };
    }
    /** Still away from rest (position, size, or the droplet catching up). */
    isActive() {
        const eps = 0.5;
        const vEps = 3;
        const box = this.flightBox();
        const centreX = box.x + box.w / 2;
        const centreY = box.y + box.h / 2;
        const centreGap = Math.abs(this.centre.x - centreX) + Math.abs(this.centre.y - centreY)
            + Math.abs(this.size.w - box.w) + Math.abs(this.size.h - box.h);
        const dropletGap = Math.abs(this.droplet.x - this.centre.x) + Math.abs(this.droplet.y - this.centre.y);
        return centreGap > eps || dropletGap > eps
            || Math.abs(this.centre.vx) + Math.abs(this.centre.vy) + Math.abs(this.size.vw) + Math.abs(this.size.vh) > vEps;
    }
    /**
     * Stamp the frame: the layout box is the destination's (the refraction
     * field tracks it through its ResizeObserver, so the map regenerates only
     * when a real size changes), the transform carries the whole flight, and
     * the droplet's diameter follows speed.
     */
    paint() {
        this.paintAt(this.flightBox());
        const speed = Math.hypot(this.centre.vx, this.centre.vy);
        const n = clamp(speed / SPEED_NORM, 0, 1);
        const s = this.motion.stretch * n;
        // Visual scale = size spring ratio, stretched along the motion axis and
        // thinned across it (near volume conservation).
        const box = this.flightBox();
        let sx = this.size.w / Math.max(1, box.w);
        let sy = this.size.h / Math.max(1, box.h);
        if (Math.abs(this.centre.vx) >= Math.abs(this.centre.vy)) {
            sx *= 1 + s;
            sy /= 1 + s;
        }
        else {
            sy *= 1 + s;
            sx /= 1 + s;
        }
        const tx = this.centre.x - (box.x + box.w / 2);
        const ty = this.centre.y - (box.y + box.h / 2);
        this.lens.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
        const dia = clamp(box.h * 0.66, 16, 60) * this.motion.droplet * n;
        if (dia < 3) {
            this.drop.style.display = 'none';
        }
        else {
            this.drop.style.display = '';
            this.drop.style.width = `${dia.toFixed(1)}px`;
            this.drop.style.height = `${dia.toFixed(1)}px`;
            this.drop.style.left = `${(this.droplet.x - dia / 2).toFixed(1)}px`;
            this.drop.style.top = `${(this.droplet.y - dia / 2).toFixed(1)}px`;
            this.drop.style.opacity = String(clamp(n * 1.6, 0, 1));
        }
    }
    /** Stamp the lens ON the box with identity transform — the landing beat's
     *  first half, pixel-identical to the row glass it hands off to. */
    paintAt(box) {
        const style = this.lens.style;
        style.left = `${box.x.toFixed(2)}px`;
        style.top = `${box.y.toFixed(2)}px`;
        style.width = `${box.w.toFixed(2)}px`;
        style.height = `${box.h.toFixed(2)}px`;
    }
    frame(time) {
        if (!this.running || !this.shown)
            return;
        const dt = Math.min((time - this.lastTime) / 1000, MAX_DT);
        this.lastTime = time;
        const active = this.integrate(dt);
        if (this.nearBox()) {
            // 到站即交接：标记与隐藏同一帧完成，透镜不多画一帧——没有钉住、
            // 没有停滞的玻璃块。残余的亚像素差（≤2px）远小于一段可感知的停顿。
            this.land();
            return;
        }
        this.paint();
        if (active)
            scheduleFrame((next) => { this.frame(next); });
        else
            this.land();
    }
    /** Whether the lens is visually on the box (position and size inside the
     *  landing threshold, slow enough that it is riding the final approach). */
    nearBox() {
        const box = this.flightBox();
        const centreX = box.x + box.w / 2;
        const centreY = box.y + box.h / 2;
        return Math.abs(this.centre.x - centreX) <= LAND_PX && Math.abs(this.centre.y - centreY) <= LAND_PX
            && Math.abs(this.size.w - box.w) <= LAND_PX && Math.abs(this.size.h - box.h) <= LAND_PX
            && Math.hypot(this.centre.vx, this.centre.vy) <= LAND_SPEED;
    }
}
/** Viewport box of an element. */
function boxOf(element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}
/** Which flow zone a stop lives in. */
function zoneOf(element) {
    return element.closest(SETTINGS_ZONE) !== null ? 'settings' : 'sidebar';
}
/** The element that owns a zone. While it is mounted a missing stop is a
 *  transient re-render, not the zone going away — the lens hangs on. */
function zoneRoot(zone) {
    return document.querySelector(zone === 'settings' ? SETTINGS_ZONE : COLUMN.sidebar);
}
//# sourceMappingURL=flow-lens.js.map