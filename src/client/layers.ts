/**
 * Layer registry: the single declaration of every glass layer the skin
 * paints. A layer owns its tab label, its placement, its starting values, the
 * knobs it exposes, and — the part that keeps the skin generic — the hooks it
 * binds to.
 *
 * WHERE the glass lands is the layer's `placement` (see
 * {@link LayerPlacement}): on the app element itself through the
 * `--lg-<layer>-*` variables, on a plugin-owned sheet fixed behind the app
 * (the columns and pages), or on a sheet mounted inside the host (any host
 * that CONTAINS other glassed controls — a dialog, the composer card, the
 * conversation header — because a nested `backdrop-filter` renders as an
 * opaque black plate instead of glass).
 *
 * Host selectors never name a plugin: they are the shell's structural locals,
 * its ARIA roles, and the app's own theme tokens. Every layer's hook list is
 * tried in order, first match wins.
 */

import { FLOW_KNOBS, GLASS_KNOBS, type KnobKey } from './knobs.ts'

/**
 * Where a layer's glass is painted.
 *
 * - `'element'` — on the app element itself, through its `--lg-<id>-*`
 *   consumers. For single elements that follow content (the composer card's
 *   own controls, the selection row, a menu surface).
 * - `'behind'` — on a plugin-owned surface fixed BEHIND the app, tracking the
 *   host's box. Used for the columns and pages: a `backdrop-filter` element
 *   must not sit inside another one's subtree, and a sheet between the
 *   wallpaper and the UI is exactly the seam those layers want.
 * - `'inside'` — on a plugin-owned surface mounted INSIDE the host (absolute,
 *   `inset: 0`, `z-index: -1`, first child), so it paints above the host's own
 *   background and below its content. Used for hosts that CONTAIN other glassed
 *   controls (a dialog, the composer card, the conversation header): while the
 *   host carries the filter, every control inside it samples an empty backdrop
 *   — Chromium isolates the nested one — and the filter's dither stage turns
 *   that emptiness into an OPAQUE BLACK plate. The surface keeps the host's own
 *   glass (its knobs stay live) while the descendants get their own.
 */
export type LayerPlacement = 'element' | 'behind' | 'inside'

/** Identifier of a glass layer; also the `--lg-<id>-*` variable namespace. */
export type LayerId = 'sidebar' | 'center' | 'rightbar' | 'page' | 'home' | 'input' | 'question' | 'convheader' | 'highlight' | 'newchat' | 'buttons' | 'menu'

/** One layer's knob values. */
export type LayerValues = Record<string, number>

/**
 * 浓度/亮度 by the SHELL's scheme, for the layers that cover a large surface.
 * Glass has to hold up against two very different backdrops: a light wallpaper
 * wants a frosted white plate (a wash plus a lift), while over a dark photo any
 * white wash turns it grey — dark wants plain darkening instead. These are the
 * shipped pairs (2026-10-13.17, the values the author tuned); a layer opts in
 * with `schemeGlass: true`, and its own 浓度/亮度 knobs stay the MANUAL fallback
 * the moment either one is dragged (skin.ts `effectiveValues`, sun-panel.ts's
 * note). Nothing else about a layer follows the scheme.
 */
export const SCHEME_GLASS = {
  light: { density: 0.5, brightness: 1.2 },
  dark: { density: 0, brightness: 0.5 },
} as const

/** The two knobs the scheme drives (and the panel hands back on a drag). */
export const SCHEME_KNOBS: readonly KnobKey[] = ['density', 'brightness']

/** Layer tint strategy: turns the layer's knob values into its fill colour. */
type TintBuilder = (values: LayerValues) => string

/** Structural layout locals of the three-column shell. */
export const COLUMN = {
  sidebar: "[class*='sidebarCol']",
  center: "[class*='centerCol']",
  rightbar: "[class*='rightbarCol']",
}

/**
 * Composer card: any card that owns a text surface, whoever renders it — but NOT
 * the question card. ui-user-questions' QuestionComposer also holds a `<textarea>`
 * (the custom answer) inside a `[class*='card']`, so it matched this hook and got
 * the 输入区 layer's glass sheet plus a capsule on every option row. It is not the
 * composer, though: its official frame carries `data-question-key` and the card is
 * that frame's DIRECT child, so `:not([data-question-key] > *)` rules it out here,
 * once, for every consumer below (the layer's host, the button areas, the skin.css
 * rule that spells the same selector out).
 */
const COMPOSER_CARD =
  `${COLUMN.center} [class*='card']:has(textarea, [contenteditable='true'], [contenteditable=''])`
  + `:not([data-question-key] > *)`

/**
 * The question card itself: the composer-slot chain entry that takes over while
 * an agent question is pending. The official frame carries `data-question-key`
 * and the card is its DIRECT child, so this is exact — and it is deliberately the
 * mirror image of the exclusion above (one says "not the question card", this one
 * says "only the question card").
 */
const QUESTION_CARD = `[data-question-key] > [class*='card']`

/**
 * The conversation header: the resident strip above the chat — session
 * breadcrumbs, header actions, and the view tabs all sit on one `<header>` the
 * shell keeps mounted across sessions. Bound by its own leading child, which
 * only that header renders, so the hook survives class re-hashing and holds
 * for any future conversation header the shell mounts.
 */
const CONVERSATION_HEADER =
  `${COLUMN.center} header:has(> [data-conversation-header-leading])`

/**
 * Page surface: the full-view panel a sidebar entry opens in the centre
 * column. Two shapes exist and both are structural locals, so any present or
 * future entry page inherits the skin without naming a plugin:
 *
 * - `page` — the shell's own page sheet (plugin manager, skill panel) with its
 *   inner blocks excluded: heading, intro, and body carry the same local and
 *   would otherwise each get a glass sheet.
 * - `heroGate` — the agent-suite entry pages (助理档案/助理记忆 and any future
 *   gate page) render inside the conversation slot under one outermost gate
 *   container. The SAME gate component is the app's HOME hero, so this hook is
 *   guarded by the shell's own panel-open mark — the sidebar's active panel row
 *   (`aria-current='page'`), which exists only while an entry page is up; the
 *   unguarded gate is the home hero's own layer (首页).
 */
const PAGE_IN_CENTER = [
  `${COLUMN.center} [class*='page']`,
  `:not([class*='pageTitle'])`,
  `:not([class*='pageHead'])`,
  `:not([class*='pageIntro'])`,
  `:not([class*='pageBody'])`,
  // SUBSTRING TRAP, and it cost a real bug: the question composer's own pager
  // (`ui-user-questions`' "1 / 1" footer) is classed `pager` — which CONTAINS
  // "page". With an agent question pending it therefore claimed this layer, and
  // a bound 页面 sheet suppresses the centre column's surface (syncColumnCover),
  // so 对话区's glass vanished for as long as the question was up. Same family
  // as the `seat`/`switcher` traps: a class-name substring is not an identity.
  `:not([class*='pager'])`,
].join('')

const PANEL_OPEN = `[class*='sidebarCol'] [aria-current='page']`

const SUITE_PAGE_GATE =
  `body:has(${PANEL_OPEN}) ${COLUMN.center} [class*='heroGate']:not([class*='heroGate'] [class*='heroGate'])`

/**
 * The home hero: the gate container the app shows on its default page — the
 * same component an entry page renders, but with no sidebar panel active. Its
 * own layer so the home look tunes separately from the popped-up pages.
 */
const HOME_HERO =
  `body:not(:has(${PANEL_OPEN})) ${COLUMN.center} [class*='heroGate']:not([class*='heroGate'] [class*='heroGate'])`

/**
 * The right column's own box: the docked panel the shell anchors to the frame's
 * right edge. The panel's content wrapper shares the `panel` local, so it is
 * excluded — it is not the column's box and, unlike the panel, it is never
 * marked hidden.
 */
const RIGHTBAR_PANEL = `${COLUMN.rightbar} [class*='panel']:not([class*='panelBody'])`

/** One flow ZONE: a group of candidate hooks that share one mark. Zones are
 *  independent — the sidebar's highlight and the settings nav's highlight
 *  stay lit at the same time, each zone exactly one stop. */
export interface FlowStop {
  zone: 'settings' | 'sidebar'
  /** Candidate hooks, tried in order, first live match wins. */
  selectors: readonly string[]
}

const NEW_CHAT_LABELS = ['新建会话', 'new session', '创建 agent', '开启新对话', 'new chat'] as const

/**
 * The same rows as an EXCLUSION for the selection bar below. A row whose label
 * names "start a conversation" is an ACTION, not a selection: 常驻高亮 owns its
 * paint in EVERY state — including while the shell marks it active
 * (`aria-current` / `aria-selected`), where the two layers used to collide and
 * the bar's mark won on specificity, so a 创建 Agent row flashed the bar's look
 * instead of wearing the highlight it already had. Built from NEW_CHAT_LABELS so
 * the two lists cannot drift apart.
 */
const NOT_NEW_CHAT_ROW = `:not([class*='newSession'])`
  + NEW_CHAT_LABELS.map(label => `:not([aria-label='${label}' i])`).join('')

/** The flow highlight's candidate groups — the registry's one declaration of
 *  where the 高亮条 glass may stop, whoever renders the rows. The settings
 *  dialog's active nav cell is its own zone (the nav is the slot registry's,
 *  so plugin-added sections flow exactly like the built-in ones); the
 *  sidebar zone tries the open navigation row (`aria-current='page'`), the
 *  click tracker's row (the freshest human choice, and the only mark lists
 *  whose rows carry no ARIA selection ever get), then the shell's selected
 *  list row (`aria-selected`).
 *
 * There is deliberately no colour scan for the selection token: the shell
 * paints hover and selection with the SAME token (`--dsw-alias-interactive-bg-hover`
 * on session rows), so a computed-colour scan cannot tell a hovered row from a
 * selected one. ARIA is the shell's actual selection contract; hover keeps its
 * own tint-only rule. */
export const FLOW_STOPS: readonly FlowStop[] = [
  {
    zone: 'settings',
    selectors: [`[data-shortcut-modal='settings'] [aria-current='true']`],
  },
  {
    zone: 'sidebar',
    selectors: [
      `${COLUMN.sidebar} [aria-current='page']${NOT_NEW_CHAT_ROW}`,
      `${COLUMN.sidebar} [data-lg-current]${NOT_NEW_CHAT_ROW}`,
      `${COLUMN.sidebar} [aria-selected='true']${NOT_NEW_CHAT_ROW}`,
    ],
  },
]

/** The persistent new-conversation highlight: the shell's own 新会话 pill in
 * every state (wide, collapsed, rail) plus every sidebar row whose accessible
 * label names the same action — the agent-suite's 创建 Agent / 开启新对话
 * panel rows among them. The shell exposes both through its own contracts: the
 * pill carries the `newSession` layout local (its label/content/shortcut
 * children share the stem and are excluded), and a panel row carries its slot
 * label as `aria-label`, so the row hooks are the app's own ARIA text and an
 * absent plugin simply matches nothing. The aria hooks are case-insensitive
 * (`i`) so a language switch cannot drop the highlight; the brand logo button
 * — which also starts a session — is excluded: a glowing logo reads as a
 * defect, not a highlight. Mirrored by the paint rule in skin.css. */
const NEW_CHAT_HOSTS = [
  `${COLUMN.sidebar} [class*='newSession']:not([class*='newSessionLabel']):not([class*='newSessionContent']):not([class*='newSessionShortcut'])`,
  ...NEW_CHAT_LABELS.map(label => `${COLUMN.sidebar} button[aria-label='${label}' i]:not([class*='brand'])`),
]

/**
 * The 按钮 layer's areas: the structural containers its capsules land in. The
 * stylesheet dresses these same containers (skin.css), and the FIRST one that
 * is present also hosts the layer's refraction filter — a CSS-dressed layer has
 * no single element of its own, and the displacement field has to be measured
 * on a real box or 折射强度/边缘柔边 have nothing to shape. One box, one field,
 * every other consumer slices it (the same contract the 菜单 layer's
 * multi-element rule already rides). Ordered stable-first, and never a
 * container that sits inside another layer's glass (a nested backdrop-filter
 * cannot paint its own functions).
 */
export const BUTTON_AREAS = [
  // The composer card's own controls, and ONLY those (see skin.css for why the
  // other areas were dropped): the field's box is what the displacement is
  // capped against (refraction.ts), so it has to be measured on a CONTROL, not
  // a container — and one control's box serves every capsule of the layer.
  `${COMPOSER_CARD} button`,
  `${COMPOSER_CARD} [role='button']`,
  `${COMPOSER_CARD} [aria-haspopup]`,
]

/** Every glass layer, in property-panel tab order. */
export interface LayerSpec {
  id: LayerId
  label: string
  /** Where this layer's glass is painted (see {@link LayerPlacement}). */
  placement: LayerPlacement
  /** App element hooks, tried in order; empty when the layer owns its element.
   *  A CSS-dressed layer (placement 'element', no element of its own) still
   *  lists them: the first live match is where the refraction filter is
   *  measured. */
  hosts: readonly string[]
  /** Knobs the layer's tab exposes, in order. */
  knobs: readonly KnobKey[]
  /** Starting values; a knob missing here starts at the shared neutral. */
  defaults: LayerValues
  /** Fill colour builder. */
  tint: TintBuilder
  /** True for the big surface layers: 浓度/亮度 come from `SCHEME_GLASS` while they are
   *  on auto (the shipped state), and from this layer's own values once the user
   *  drags either knob. */
  schemeGlass?: boolean
  /** True when a 主题色 preset owns this layer's colour (see layers.ts themeTint):
   *  its 色调/色调饱和度 knobs are hidden while a preset with a wash is active. */
  themeOwned?: boolean
  /** Whether the surface carries the capsule's rim shading (see surface.ts). */
  rim?: boolean
  /** Paint order inside the plugin's surface stack; later layers sit on top. */
  stack?: number
  /** Fly ONE shared glass lens between this layer's hosts (flow-lens.ts)
   *  instead of painting each host — the hosts are candidate stops, never
   *  painted themselves. */
  flow?: boolean
  /** This layer also owns the shell's hover fills: the engine publishes
   *  `--lg-hover-tint` from its 色调/色调饱和度 + 悬停浓度 (skin.ts), so controls
   *  can stay pure glass (density 0) and still show hover feedback. */
  hover?: boolean
}

/** Neutral value of every knob: what a layer starts from before its defaults. */
export const NEUTRAL: Record<KnobKey, number> = {
  density: 0, radius: 0, refraction: 0, edgeSoftness: 15, glassBlur: 0,
  contrast: 1, brightness: 1, saturation: 1,
  tintHue: 220, tintSaturation: 0, rimStrength: 1, borderWidth: 0, borderOpacity: 0.85, grain: 0,
  // The flow lens's motion, tuned on the standalone sample (E:\dsh\liquid-flow-demo):
  // stiffness 150 / damping 0.74 gives the Q-bounce without wobble, the stretch
  // carries the water-drop body, and the trailing droplet ships off (0) — it is
  // a look the 水滴尾巴 slider can raise, not the default.
  flowStiffness: 150, flowDamping: 0.74, flowStretch: 0.26, flowDroplet: 0,
  hoverAlpha: 0.16,
}

/** The values every layer shares — **the shipped look** (2026-10-13.7: the
 * author's own tuned values, promoted from a live session, so a fresh install
 * and 重置 open on the look that was actually tuned rather than on a neutral
 * baseline). Each entry below restates only what differs.
 *
 * It used to be derived from the capsule's defaults ("a fresh layer IS the
 * capsule"); it is not any more, deliberately: the capsule's own params are not
 * persisted, so the two sets are independent now (LIQUID_GLASS_DEFAULTS stays
 * the capsule's, and the 胶囊 tab still starts there). 圆角 stays a shape knob —
 * layers keep the shell's panel radius, not the capsule's pill. 边缘柔边 needs no
 * conversion: the fields read it against the capsule's live height (refraction.ts).
 */
export const DEFAULT_GLASS: LayerValues = {
  density: 0,
  radius: 20,
  refraction: 1,
  edgeSoftness: 75,
  glassBlur: 20,
  contrast: 1,
  brightness: 1,
  saturation: 1.2,
  tintHue: 220,
  tintSaturation: 0,
  rimStrength: 1.5,
  borderWidth: 0,
  borderOpacity: 0,
  grain: 0,
}
/**
 * Build a layer's tint colour: `hsla(tintHue, tintSaturation%,
 * lightness(density × scale))`. The lightness derives from the saturation —
 * 100% at saturation 0 (byte-identical to the old plain white) and dropping to
 * ~62% as the tint takes colour, because at full lightness every hue is the
 * same white and the 色调 knob would have nothing to turn.
 */
export const buildTint = (scale: number): TintBuilder => (values) => {
  const saturation = values.tintSaturation ?? NEUTRAL.tintSaturation
  const lightness = 100 - saturation * 50
  return `hsla(${values.tintHue ?? NEUTRAL.tintHue}, ${(saturation * 100).toFixed(1)}%, ${lightness.toFixed(1)}%, ${(Number(values.density ?? 0) * scale).toFixed(3)})`
}

/** Plain translucent white, the panels' tint (saturation 0 at lightness 100). */
const whiteTint = buildTint

/**
 * The theme colour's wash — `"r, g, b"` — set by the engine right before it
 * rebuilds the layers, or null when no theme colour is chosen. Module state on
 * purpose: a theme colour is ONE look for the whole skin, so it enters through
 * the door every layer's tint already reads (this registry) instead of through a
 * layer-id special case in the engine.
 */
let themeWash: string | null = null

/** Point the theme-aware tints at an `"r, g, b"` triple, or at null for none. */
export function setThemeWash(rgb: string | null): void {
  themeWash = rgb
}

/**
 * The tint of the layer the theme colour owns (新会话 — the new-session pill and
 * the settings' value buttons). Alpha still follows the tint contract
 * (`浓度 × scale`); only the COLOUR half yields, because a theme colour is a
 * colour, not a hue: 纯白 and 高雅黑 cannot be written as `hsl(h, s%, 100−s·50)`
 * (that formula bottoms out at mid grey). With no theme colour chosen this is
 * the ordinary builder, byte for byte.
 */
export const themeTint = (scale: number): TintBuilder => (values) => {
  if (themeWash === null) return buildTint(scale)(values)
  return `rgba(${themeWash}, ${(Number(values.density ?? 0) * scale).toFixed(3)})`
}

/**
 * The ONE tint scale every layer uses — the capsule's own (its tint alpha is
 * `density × 0.5`). Declared once so a tab's 玻璃浓度 means the same glass on
 * every layer and on the capsule: one value, one look. A layer that wants a
 * different scale has to say so here, next to the reason.
 */
const TINT_SCALE = 0.5

export const LAYERS: readonly LayerSpec[] = [
  {
    id: 'sidebar',
    label: '侧边栏',
    placement: 'behind',
    // Follows 亮暗 like the other five surfaces (2026-10-13.21 restores what
    // .20 briefly took away). What made the light theme read as a WHITE BLOCK
    // over the browsing region was never the scheme itself — it was the column
    // being washed TWICE: the shell painted `--dsw-specific-sidebar-fill` on the
    // sidebar's own root while this layer's surface painted the same tint over
    // the same box, and the two fills did not even share one extent. That token
    // is `transparent` now (skin.css), so the surface is the single carrier and
    // the wash reads as one sheet again.
    schemeGlass: true,
    hosts: [COLUMN.sidebar],
    knobs: GLASS_KNOBS,
    defaults: {
      ...DEFAULT_GLASS,
      radius: 10,
      // 10px, not the shared 20 (2026-10-13.28): the column is read all day, and
      // 20 read as a smear rather than a pane.
      glassBlur: 10,
    },
    tint: whiteTint(TINT_SCALE),
    rim: true,
  },
  {
    id: 'center',
    label: '对话区',
    placement: 'behind',
    schemeGlass: true,
    hosts: [COLUMN.center],
    knobs: GLASS_KNOBS,
    defaults: {
      ...DEFAULT_GLASS,
      radius: 0,
      glassBlur: 0,
      brightness: 0.8,
      rimStrength: 0,
      // 100px, the top of its range (2026-10-13.28): the centre column is the
      // widest sheet in the app, so its refraction wants the softest edge there is.
      edgeSoftness: 100,
    },
    tint: whiteTint(TINT_SCALE),
    rim: true,
  },
  {
    id: 'rightbar',
    label: '右侧栏',
    placement: 'behind',
    schemeGlass: true,
    hosts: [RIGHTBAR_PANEL, COLUMN.rightbar],
    knobs: GLASS_KNOBS,
    defaults: {
      ...DEFAULT_GLASS,
      radius: 10,
      // 10px like the sidebar (2026-10-13.28): a docked pane reads as glass, not smear.
      glassBlur: 10,
    },
    tint: whiteTint(TINT_SCALE),
    rim: true,
  },
  {
    id: 'page',
    label: '页面基底',
    placement: 'behind',
    schemeGlass: true,
    hosts: [PAGE_IN_CENTER, SUITE_PAGE_GATE],
    knobs: GLASS_KNOBS,
    defaults: {
      ...DEFAULT_GLASS,
      radius: 0,
      brightness: 0.8,
      rimStrength: 0,
      // 10px like the columns (2026-10-13.28).
      glassBlur: 10,
    },
    tint: whiteTint(TINT_SCALE),
    rim: true,
    // A page opens inside a column, so its sheet paints over that column's.
    stack: 1,
  },
  {
    id: 'home',
    label: '首页',
    placement: 'behind',
    schemeGlass: true,
    hosts: [HOME_HERO],
    knobs: GLASS_KNOBS,
    defaults: {
      ...DEFAULT_GLASS,
      radius: 12,
      brightness: 1.1,
      rimStrength: 2,
    },
    tint: whiteTint(TINT_SCALE),
    rim: true,
    // The home hero covers a column, so its sheet paints over that column's.
    stack: 1,
  },
  {
    // 'inside': the card HOLDS other glassed controls (＋ 附件 / 模型 / 工作区 /
    // 发送 are the 按钮 layer's capsules). While the card carried the filter
    // itself, each of those was nested in it and rendered as an opaque black
    // plate instead of glass — the surface carries the card's own glass and
    // leaves the controls free to refract.
    id: 'input',
    label: '输入区',
    placement: 'inside',
    hosts: [COMPOSER_CARD],
    knobs: GLASS_KNOBS,
    defaults: {
      ...DEFAULT_GLASS,
      edgeSoftness: 70,
      glassBlur: 4,
      brightness: 1.1,
      rimStrength: 0.8,
    },
    tint: whiteTint(TINT_SCALE),
  },
  {
    // The agent question card (ui-user-questions' QuestionComposer). It is a
    // CHAIN entry of the composer slot, so while a question is pending it
    // REPLACES the input bar rather than nesting inside it — which is what makes
    // it a layer of its own: the composer-card exclusion (`:not([data-question-key]
    // > *)`, .13) keeps it out of 输入区, and here it gets its own tab.
    id: 'question',
    label: '提问卡',
    placement: 'element',
    // Follows 亮暗 like the six big surfaces (2026-10-13.24, "和其他的一样"):
    // a light theme gives the card the same frosted white plate the columns get,
    // a dark one plain darkening. Its own 浓度/亮度 stay the manual fallback.
    schemeGlass: true,
    hosts: [QUESTION_CARD],
    knobs: GLASS_KNOBS,
    defaults: {
      ...DEFAULT_GLASS,
      edgeSoftness: 70,
      glassBlur: 4,
      brightness: 1.1,
    },
    tint: whiteTint(TINT_SCALE),
    rim: true,
  },
  {
    // 圆角 0: the header strip sits flush against the column's top and side
    // edges — the shell paints it square, so rounding would tear its corners
    // away from the window edge it is anchored to.
    // 'inside' for the same reason as the composer card: header buttons are
    // 按钮 capsules and must not be nested in the strip's own filter.
    id: 'convheader',
    label: '对话头',
    placement: 'inside',
    hosts: [CONVERSATION_HEADER],
    knobs: GLASS_KNOBS,
    defaults: {
      ...DEFAULT_GLASS,
      radius: 0,
      edgeSoftness: 70,
      glassBlur: 2,
      brightness: 1.1,
      rimStrength: 0.5,
    },
    tint: whiteTint(TINT_SCALE),
  },
  {
    // The sidebar's ONE flowing highlight: a shared lens springs between the
    // open navigation row and the selected list row, so the 插件 position and
    // the 聊天记录 position can never glow at the same time — whichever was
    // chosen last carries the glass, and switching pours it across. The lens
    // is the only painted surface; every candidate row is cleared to
    // transparent by the skin stylesheet (skin.css).
    id: 'highlight',
    label: '选中高亮',
    placement: 'element',
    flow: true,
    hosts: FLOW_STOPS.flatMap(group => group.selectors),
    knobs: [...GLASS_KNOBS, ...FLOW_KNOBS],
    // The highlight keeps its coloured shaping: blue at 75% saturation (the
    // derived lightness lands on its ~62%). The pre-registry stored that colour
    // as `hue`; applySaved folds it into tintHue. The motion values are the
    // sample's tuned defaults (see NEUTRAL), restated here so 重置 returns
    // exactly to them.
    defaults: {
      ...DEFAULT_GLASS,
      edgeSoftness: 80,
      glassBlur: 40,
      brightness: 1.6,
      tintSaturation: 1,
      rimStrength: 2,
      flowStiffness: 120,
      flowDamping: 0.65,
      flowStretch: 0.3,
      flowDroplet: 0,
    },
    tint: whiteTint(TINT_SCALE),
  },
  {
    // 常驻高亮: unlike the selection bar above, this one must be visible at
    // the factory values — a highlight the user has to find a slider for is
    // not a highlight — so the tint starts taken (the same blue, at half
    // density the tint reads as a soft wash over the official fill).
    id: 'newchat',
    label: '新会话',
    placement: 'element',
    hosts: NEW_CHAT_HOSTS,
    knobs: GLASS_KNOBS,
    defaults: {
      ...DEFAULT_GLASS,
      density: 1,
      edgeSoftness: 80,
      glassBlur: 40,
      brightness: 1.2,
      saturation: 3,
      tintSaturation: 1,
      rimStrength: 2,
    },
    tint: themeTint(TINT_SCALE),
    // The theme colour owns this layer's COLOUR (see themeTint): while a theme
    // colour is chosen its 色调/色调饱和度 knobs have nothing to act on, so the
    // panel hides them and says why (sun-panel.ts) instead of showing two sliders
    // that do not move anything.
    themeOwned: true,
  },
  {
    // 按钮: ONE pure-glass capsule recipe for every small control — the
    // composer card's own controls (＋ attach, model trigger, workspace
    // selector, send), the hover actions on a message, the icon buttons
    // inside sidebar rows, the right dock's header controls, and the
    // run-stats pills. WHERE each capsule lands is decided by skin.css's
    // structural containers, and the same containers are this layer's `hosts`,
    // so the refraction field has a real box to be measured on: one box, one
    // field, every other consumer slices it (the README's multi-element rule).
    id: 'buttons',
    label: '输入控件',
    placement: 'element',
    hosts: BUTTON_AREAS,
    // 悬停浓度 rides the tab: the shell's hover fills read their strength
    // from it (`hover: true` makes skin.ts publish --lg-hover-tint), so the
    // slider sits beside the tint knobs that colour those fills.
    hover: true,
    // 悬停浓度 has its OWN tab (see sun-panel.ts): the engine still publishes
    // --lg-hover-tint from this layer (`hover: true`), the slider just no longer
    // sits at the bottom of this list.
    knobs: [...GLASS_KNOBS],
    defaults: {
      ...DEFAULT_GLASS,
      edgeSoftness: 100,
      glassBlur: 0,
      contrast: 1.02,
      brightness: 1.6,
      saturation: 1.4,
      hoverAlpha: 0.2,
    },
    tint: whiteTint(TINT_SCALE),
  },
  {
    // 'inside': a dialog is the biggest CONTAINER of other glassed controls —
    // the settings page alone holds the nav cell (高亮条), the config selectors,
    // switchers, steppers, action buttons, theme cubes and preset cards (新会话).
    // With the filter on the dialog itself, every one of them sampled an empty
    // backdrop and rendered as an opaque dark plate (measured: a #24324 to
    // #243247 near-black slab instead of the wallpaper showing through). The
    // surface sits inside the dialog, above its own background and below its
    // content, so the dialog keeps its glass and its controls refract.
    id: 'menu',
    label: '弹窗菜单',
    placement: 'inside',
    schemeGlass: true,
    hosts: ["[role='dialog']"],
    knobs: GLASS_KNOBS,
    defaults: {
      ...DEFAULT_GLASS,
      edgeSoftness: 60,
      glassBlur: 10,
      brightness: 1.1,
      saturation: 1.1,
      rimStrength: 2,
      borderOpacity: 1,
    },
    tint: whiteTint(TINT_SCALE),
  },
]

/** Apply a layer's defaults on top of the shared neutral values. */
export function defaultValues(layer: LayerSpec): LayerValues {
  return { ...NEUTRAL, ...layer.defaults }
}
