/**
 * The property panel: a bottom-right sun button opening a two-category sheet.
 *
 * 主题 tunes the environment: the wallpaper (switch, add, delete) and the text
 * colors (published over the shell's label tokens). 亮暗 is deliberately NOT
 * offered here — the shell's own settings own that preference, and nothing this
 * plugin paints depends on it any more.
 * 控件 holds one tab per glass surface — the capsule and every layer — each a
 * registry-built slider group. Every row is registry-driven; adding a knob or
 * a layer needs no change here.
 *
 * Plain DOM on purpose — the surfaces it tunes live outside the app's React
 * tree. Every listener is registered through `listen`/`sheetListen` so
 * `destroy` leaves nothing behind.
 */
import { degrees, KNOBS, px } from "./knobs.js";
import { LAYERS, defaultValues } from "./layers.js";
import { LIQUID_GLASS_DEFAULTS } from "./liquid-glass.js";
import { addWallpaper, DEFAULT_DIR_PREFIX, deleteWallpaper, wallpaperUrl } from "./wallpaper-store.js";
import { defaultTheme, effectiveValues, saveSkinState, schemeDrives, THEME_COLORS } from "./skin.js";
import css from './sun-panel.module.css';
/** Registry knob with the ranges a surface layer uses as-is. */
const knob = (key) => ({ ...KNOBS[key] });
/** The 悬停 tab's one knob (the 按钮 layer owns the value; see layerTab's `view`). */
const HOVER_KNOBS = ['hoverAlpha'];
/**
 * The capsule tab drives the LiquidGlass instance directly: its two shape
 * knobs first, then the same nine every layer exposes, in the same order.
 */
const CAPSULE_SLIDERS = [
    { key: 'width', label: '宽度', min: 120, max: 640, step: 2, format: px },
    { key: 'height', label: '高度', min: 80, max: 420, step: 2, format: px },
    knob('density'),
    knob('radius'),
    knob('refraction'),
    knob('edgeSoftness'),
    knob('glassBlur'),
    knob('contrast'),
    knob('brightness'),
    knob('saturation'),
    knob('tintHue'),
    knob('tintSaturation'),
    knob('rimStrength'),
    knob('borderWidth'),
    knob('borderOpacity'),
    knob('grain'),
];
/**
 * The 主题 rows, grouped by the sheet's sections. The text pair starts unset
 * (`跟随壳层`): moving either knob starts the pair, 重置 returns it to the
 * shell's own palette.
 */
const THEME_SLIDERS = [
    { key: 'textHue', label: '文字色相', min: 0, max: 360, step: 5, format: degrees, fallback: 220, placeholder: '跟随' },
    { key: 'textLight', label: '文字亮度', min: 5, max: 95, step: 1, format: (value) => `${Math.round(value)}%`, fallback: 60, placeholder: '跟随' },
];
/** The capsule tab drives the LiquidGlass instance directly. Resizing the
 *  sample re-scales every layer's refraction with it — the layers' lens IS
 *  this capsule (skin.setLensReference). */
function capsuleTab(glass, skin) {
    const keyOf = (key) => key;
    const syncLens = () => { skin.setLensReference(glass.params.width, glass.params.height); };
    return {
        id: 'capsule',
        label: '样本胶囊',
        sliders: CAPSULE_SLIDERS,
        read: (key) => glass.params[keyOf(key)],
        write: (key, value) => {
            glass.updateParams({ [keyOf(key)]: value });
            syncLens();
        },
        reset: () => {
            glass.updateParams(LIQUID_GLASS_DEFAULTS);
            syncLens();
        },
    };
}
/** One glass layer's tab: reads and writes its group of the shared state. */
/**
 * A layer's tab. `view` builds a SECOND tab over the same state slot with a knob
 * subset and its own name — how 悬停浓度 got out of the 按钮 list and into a tab of
 * its own: same values object, same write path, and its 重置 restores only the
 * knobs it shows (resetting the whole layer from a one-knob tab would be a
 * surprise).
 */
function layerTab(layer, values, state, skin, view) {
    const commit = () => {
        skin.apply(state);
        saveSkinState(state);
    };
    // 主题色接管这个层的颜色时，它的两根颜色拉条没有作用对象 —— 收起并说明，
    // 不留拉不动的拉条（选「官方蓝」即可把颜色交回它们）。
    const preset = THEME_COLORS.find(entry => entry.id === state.theme.themeColor);
    const themeOwnsTint = layer.themeOwned === true && preset?.wash != null;
    // 浓度/亮度 may be the scheme's (see skin.ts effectiveValues): the rows show the
    // numbers the engine actually paints, and a drag on either one hands that layer
    // back to manual — which is what "默认值" has to mean here.
    const schemeGlass = layer.schemeGlass === true;
    const schemeAuto = schemeDrives(layer, state);
    const listed = (view?.knobs ?? layer.knobs).filter(key => !(themeOwnsTint && (key === 'tintHue' || key === 'tintSaturation')));
    return {
        id: view?.id ?? layer.id,
        label: view?.label ?? layer.label,
        sliders: listed.map(key => knob(key)),
        ...(themeOwnsTint
            ? { note: '这一层的颜色由「主题色」接管（选「官方蓝」可交回 色调 / 色调饱和度）' }
            : schemeGlass
                ? {
                    note: () => (schemeDrives(layer, state)
                        ? '浓度 / 亮度 随亮暗自动（浅色 0.5 / 1.2，深色 0 / 0.5）；拖动其中任一即交回手动'
                        : '浓度 / 亮度 已交回手动（按本页「重置本页」可回到随亮暗自动）'),
                }
                : {}),
        read: (key) => {
            const painted = schemeAuto ? effectiveValues(layer, state) : values;
            return painted[key] ?? 0;
        },
        write: (key, value) => {
            // Touching either scheme-driven knob makes this layer's pair manual.
            if (schemeAuto && (key === 'density' || key === 'brightness'))
                state.schemeAuto[layer.id] = false;
            values[key] = value;
            commit();
        },
        reset: () => {
            // A reset returns the layer to the SHIPPED state, which for a scheme layer
            // means 浓度/亮度 follow the scheme again (drop the manual opt-out).
            if (layer.schemeGlass === true)
                delete state.schemeAuto[layer.id];
            if (view === undefined) {
                Object.assign(values, defaultValues(layer));
                commit();
                return;
            }
            const defaults = defaultValues(layer);
            for (const key of view.knobs)
                values[key] = defaults[key] ?? 0;
            commit();
        },
    };
}
/** The 主题 tab: reads and writes the shared theme group. */
function themeTab(state, skin) {
    const theme = state.theme;
    const commit = () => {
        skin.apply(state);
        saveSkinState(state);
    };
    return {
        id: 'theme',
        label: '主题',
        sliders: THEME_SLIDERS,
        read: (key) => theme[key],
        write: (key, value) => {
            ;
            theme[key] = value;
            // Turning one text knob on starts the pair: the other joins at its rest value.
            if (key === 'textHue' && theme.textLight === null)
                theme.textLight = 60;
            if (key === 'textLight' && theme.textHue === null)
                theme.textHue = 220;
            commit();
        },
        reset: () => {
            Object.assign(theme, defaultTheme());
            commit();
        },
    };
}
/**
 * The wallpaper picker. The 默认壁纸 chip re-arms the time rotation — while it is
 * active the shipped set is the strip shown. EVERY tile pins (`static`) the image
 * it shows: the user's own uploads (which carry a corner × to delete) and the
 * shipped ones alike, because a shipped image is a bundled wallpaper and has to
 * be selectable, not merely a preview of the rotation. The shipped strip also
 * stays visible while one of ITS images is pinned, so the picked tile keeps its
 * ring instead of the whole strip vanishing under the pick. All add/delete writes
 * go through the node half into the directory under the Harness home.
 */
function wallpaperPicker(skin, state, commit) {
    return (container) => {
        const render = () => {
            container.replaceChildren();
            const status = document.createElement('div');
            status.className = css.thumbHint;
            const say = (text) => {
                status.textContent = text;
                window.setTimeout(() => { if (status.textContent === text)
                    status.textContent = ''; }, 4000);
            };
            // The 默认壁纸 chip: the time × scheme rotation, the shipped default.
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = css.tab;
            chip.textContent = '默认壁纸';
            chip.title = '随时间段自动轮换（默认）';
            chip.classList.toggle(css.tabActive, state.wallpaper.mode === 'time');
            chip.addEventListener('click', () => {
                state.wallpaper.mode = 'time';
                state.wallpaper.imageId = null;
                commit();
                render();
            });
            container.appendChild(chip);
            const strip = document.createElement('div');
            strip.className = css.thumbs;
            container.appendChild(strip);
            const upload = document.createElement('button');
            upload.type = 'button';
            upload.className = `${css.thumb} ${css.thumbAdd}`;
            upload.textContent = '+';
            upload.title = '添加壁纸（存入插件壁纸目录）';
            const file = document.createElement('input');
            file.type = 'file';
            file.accept = 'image/*';
            file.style.display = 'none';
            upload.addEventListener('click', () => { file.click(); });
            file.addEventListener('change', () => {
                const picked = file.files?.[0];
                file.value = '';
                if (picked === undefined)
                    return;
                say(`正在上传 ${picked.name}（${(picked.size / 1024 / 1024).toFixed(1)}MB）…`);
                void addWallpaper(picked)
                    .then(async () => {
                    await skin.reloadWallpapers();
                    state.wallpaper.mode = 'static';
                    state.wallpaper.imageId = picked.name;
                    commit();
                    render();
                })
                    .catch((error) => {
                    render();
                    const detail = error instanceof Error ? error.message : String(error);
                    // The two likeliest causes get targeted wording; everything else
                    // shows the raw reason so a report can name the failing step.
                    if (detail.includes('405'))
                        say('上传失败：服务器还没更新（请重启 dsh 服务器后再试）');
                    else if (detail.includes('413'))
                        say('上传失败：图片超过 32MB');
                    else if (detail.includes('Failed to fetch'))
                        say('上传失败：连不上壁纸服务（此端没有 Web 服务？）');
                    else
                        say(`上传失败：${detail}`);
                });
            });
            strip.appendChild(upload);
            strip.appendChild(file);
            if (skin.wallpaperUserFiles.length === 0 && skin.wallpaperDefaultFiles.length === 0) {
                const hint = document.createElement('div');
                hint.className = css.thumbHint;
                hint.textContent = '壁纸目录不可用（此端没有 Web 服务）或目录为空';
                container.appendChild(hint);
                return;
            }
            // The shipped set shows while the rotation is active — and also while one of
            // ITS OWN images is pinned, so that tile keeps its ring and stays re-pickable
            // (pinning an upload does not hide it, and the shipped ones now behave the
            // same way). 默认壁纸 re-arms the rotation.
            const pinnedShipped = state.wallpaper.mode === 'static'
                && (state.wallpaper.imageId ?? '').startsWith(DEFAULT_DIR_PREFIX);
            if (state.wallpaper.mode === 'time' || pinnedShipped) {
                for (const name of skin.wallpaperDefaultFiles) {
                    const thumb = document.createElement('button');
                    thumb.type = 'button';
                    thumb.className = css.thumb;
                    thumb.dataset.wallId = name;
                    thumb.title = '默认壁纸 · ' + name;
                    thumb.style.backgroundImage = `url("${wallpaperUrl(name)}")`;
                    thumb.addEventListener('click', () => {
                        state.wallpaper.mode = 'static';
                        state.wallpaper.imageId = name;
                        commit();
                        render();
                    });
                    strip.appendChild(thumb);
                }
            }
            // The user's uploads, always visible and deletable.
            for (const name of skin.wallpaperUserFiles) {
                const thumb = document.createElement('button');
                thumb.type = 'button';
                thumb.className = css.thumb;
                thumb.dataset.wallId = name;
                thumb.title = name;
                thumb.style.backgroundImage = `url("${wallpaperUrl(name)}")`;
                thumb.addEventListener('click', () => {
                    state.wallpaper.mode = 'static';
                    state.wallpaper.imageId = name;
                    commit();
                    render();
                });
                const close = document.createElement('span');
                close.className = css.thumbClose;
                close.textContent = '×';
                close.title = '删除壁纸（目录内文件一并删除）';
                close.addEventListener('click', (event) => {
                    event.stopPropagation();
                    void deleteWallpaper(name)
                        .then(async () => {
                        await skin.reloadWallpapers();
                        if (state.wallpaper.imageId === name) {
                            state.wallpaper.imageId = null;
                            state.wallpaper.mode = 'time';
                        }
                        commit();
                        render();
                    })
                        .catch((error) => say('删除失败：' + (error instanceof Error ? error.message : String(error))));
                });
                thumb.appendChild(close);
                strip.appendChild(thumb);
            }
            const activeId = state.wallpaper.mode === 'static'
                ? state.wallpaper.imageId
                : skin.currentTimeWallpaper();
            for (const thumb of strip.children) {
                const el = thumb;
                if (el.dataset.wallId === undefined)
                    continue;
                el.classList.toggle(css.thumbActive, el.dataset.wallId === activeId);
            }
        };
        render();
    };
}
/** Inline SVG sun mark for the round button. */
function sunIcon(className) {
    return `<svg class="${className}" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7"/></svg>`;
}
export class SunPanel {
    glass;
    skin;
    state;
    themeSpec;
    /** Rebuilt when the 主题色 changes (see buildTabs), so not readonly. */
    tabs;
    activeTab;
    category = 'theme';
    button;
    panel;
    rows;
    foot;
    tabBar;
    /** Listeners of the currently rendered sheet; swapped on tab change. */
    sheetTeardown = [];
    /** Structural listeners living for the whole panel lifetime. */
    teardown = [];
    constructor(glass, state, skin) {
        this.glass = glass;
        this.skin = skin;
        this.state = state;
        this.themeSpec = themeTab(state, skin);
        this.tabs = this.buildTabs();
        this.activeTab = this.tabs[0];
        this.button = this.buildButton();
        const panel = document.createElement('div');
        panel.className = `${css.panel} ${css.panelHidden}`;
        panel.dataset.lgPanel = '';
        this.panel = panel;
        panel.appendChild(this.buildHead(panel));
        panel.appendChild(this.buildCategoryBar());
        const tabBar = this.buildTabBar();
        panel.appendChild(tabBar);
        this.tabBar = tabBar;
        this.rows = document.createElement('div');
        panel.appendChild(this.rows);
        this.foot = document.createElement('div');
        this.foot.className = css.foot;
        panel.appendChild(this.foot);
        // Rows and foot exist only now, so the first sheet is rendered here rather
        // than while the tab bar is being built.
        this.syncCategoryChrome();
        this.activate(this.activeTab);
        this.startSchemeWatch();
    }
    /** Append the button and the sheet to `parent` (document.body). */
    /**
     * Re-render the sheet when the shell flips its scheme: the rows of a `schemeGlass`
     * layer show the scheme's 浓度/亮度 (skin.ts effectiveValues), so the numbers on
     * screen would otherwise be one theme stale. Read-only — the panel never writes
     * the preference.
     */
    startSchemeWatch() {
        const observer = new MutationObserver(() => {
            if (this.category === 'controls')
                this.renderSheet();
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
        this.teardown.push(() => observer.disconnect());
    }
    mount(parent) {
        parent.appendChild(this.panel);
        parent.appendChild(this.button);
    }
    /** Re-render the active sheet (used after async wallpaper loads). */
    rerender() {
        this.renderSheet();
    }
    listen(target, type, handler) {
        target.addEventListener(type, handler);
        this.teardown.push(() => { target.removeEventListener(type, handler); });
    }
    sheetListen(target, type, handler) {
        target.addEventListener(type, handler);
        this.sheetTeardown.push(() => { target.removeEventListener(type, handler); });
    }
    /** The tab list. Rebuilt when a 主题色 changes: which knobs a layer lists
     *  depends on the theme (the colour ones disappear while a preset owns the tint),
     *  and the specs are a snapshot — a stale list would keep showing them. */
    buildTabs() {
        return [
            capsuleTab(this.glass, this.skin),
            ...LAYERS.flatMap(layer => {
                const values = this.state.layers[layer.id];
                const main = layerTab(layer, values, this.state, this.skin);
                // 悬停 sits right after its layer: the hover wash is that layer's, tuned
                // on its own instead of buried under fourteen glass sliders.
                if (layer.hover !== true)
                    return [main];
                return [main, layerTab(layer, values, this.state, this.skin, { id: 'hover', label: '悬停', knobs: HOVER_KNOBS })];
            }),
        ];
    }
    buildButton() {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = css.button;
        button.setAttribute('aria-label', '液态玻璃设置');
        button.title = '液态玻璃设置';
        button.innerHTML = sunIcon(css.buttonSvg);
        this.listen(button, 'click', () => {
            const hidden = this.panel.classList.toggle(css.panelHidden);
            button.classList.toggle(css.buttonActive, !hidden);
            if (!hidden)
                this.activate(this.activeTab);
        });
        return button;
    }
    buildHead(panel) {
        const head = document.createElement('div');
        head.className = css.head;
        const title = document.createElement('span');
        title.className = css.title;
        title.textContent = '液态玻璃设置';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = css.close;
        close.textContent = '\u2715';
        close.setAttribute('aria-label', '关闭面板');
        this.listen(close, 'click', () => {
            panel.classList.add(css.panelHidden);
            this.button.classList.remove(css.buttonActive);
        });
        head.append(title, close);
        return head;
    }
    /** The two top-level chips: 主题 / 控件. */
    buildCategoryBar() {
        const bar = document.createElement('div');
        bar.className = css.category;
        const entries = [
            { id: 'theme', label: '主题' },
            { id: 'controls', label: '控件' },
        ];
        for (const entry of entries) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = css.tab;
            chip.textContent = entry.label;
            chip.dataset.category = entry.id;
            this.listen(chip, 'click', () => { this.switchCategory(entry.id); });
            bar.appendChild(chip);
        }
        return bar;
    }
    switchCategory(category) {
        this.category = category;
        this.syncCategoryChrome();
        this.renderSheet();
    }
    /** Which chips read active, and whether the layer tab strip shows at all. */
    syncCategoryChrome() {
        for (const node of this.panel.querySelectorAll('[data-category]')) {
            node.classList.toggle(css.tabActive, node.dataset.category === this.category);
        }
        this.tabBar.style.display = this.category === 'controls' ? '' : 'none';
    }
    buildTabBar() {
        const bar = document.createElement('div');
        bar.className = css.tabs;
        for (const tab of this.tabs) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = css.tab;
            chip.textContent = tab.label;
            chip.dataset.tab = tab.id;
            this.listen(chip, 'click', () => { this.activate(tab); });
            bar.appendChild(chip);
        }
        return bar;
    }
    activate(tab) {
        // A chip holds the spec it was BUILT from. After a 主题色 change rebuilds the
        // list (see buildTabs) that spec is stale — a layer whose knob list depends on
        // the theme would still show the old one — so resolve by id first.
        this.activeTab = this.tabs.find(entry => entry.id === tab.id) ?? tab;
        for (const node of this.tabBar.children) {
            node.classList.toggle(css.tabActive, node.dataset.tab === tab.id);
        }
        this.renderSheet();
    }
    /** Rebuild the sheet for the active category (listeners swapped with it). */
    renderSheet() {
        for (const dispose of this.sheetTeardown)
            dispose();
        this.sheetTeardown = [];
        this.rows.replaceChildren();
        if (this.category === 'theme')
            this.renderThemeSheet();
        else
            this.renderControlsSheet();
    }
    /** The 主题 sheet: 壁纸 / 文字颜色. */
    renderThemeSheet() {
        // 主题色 first: it is the one control that recolours things the panel does not
        // own (the shell's default colour). The swatches carry NO text — the colour is
        // the label; only an aria-label names them for assistive tech.
        const themeColor = document.createElement('div');
        const swatches = document.createElement('div');
        swatches.className = css.swatches;
        this.fillThemeSwatches(swatches);
        themeColor.appendChild(swatches);
        this.rows.appendChild(this.buildSection('主题色', themeColor));
        const wallpaper = document.createElement('div');
        const caption = document.createElement('div');
        caption.className = css.thumbHint;
        caption.textContent = '默认壁纸：随时间自动轮换 · 点缩略图固定一张 · ×删除 · ＋添加';
        wallpaper.appendChild(caption);
        const picker = document.createElement('div');
        wallpaperPicker(this.skin, this.state, () => { this.commit(); })(picker);
        wallpaper.appendChild(picker);
        this.rows.appendChild(this.buildSection('壁纸', wallpaper));
        const text = document.createElement('div');
        // Moving one text knob starts the pair at its rest value; sync both rows
        // after every write so the partner's slider and value label follow at
        // once instead of waiting for the next sheet rebuild.
        const rows = new Map();
        const syncRows = () => {
            for (const key of ['textHue', 'textLight']) {
                const parts = rows.get(key);
                if (parts === undefined)
                    continue;
                const spec = slider(key);
                const current = this.themeSpec.read(key);
                parts.input.value = String(current ?? spec.fallback ?? spec.min);
                parts.value.textContent = current === null
                    ? spec.placeholder ?? spec.format(spec.fallback ?? spec.min)
                    : spec.format(current);
            }
        };
        for (const key of ['textHue', 'textLight']) {
            const row = this.buildRow(slider(key), this.themeSpec, syncRows);
            const input = row.querySelector('input');
            const value = row.querySelector(`.${css.value}`);
            if (input !== null && value !== null) {
                rows.set(key, { input: input, value: value });
            }
            text.appendChild(row);
        }
        this.rows.appendChild(this.buildSection('文字颜色', text));
        this.foot.replaceChildren(...this.buildThemeFoot());
    }
    /** The 主题色 swatches: label-free by request, so the colour IS the control.
     *  Clicking writes the id, commits, and re-marks in place (the container is
     *  discarded with the sheet, so the plain listener needs no teardown). */
    fillThemeSwatches(container) {
        container.replaceChildren();
        for (const preset of THEME_COLORS) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = css.swatch;
            chip.dataset.lgThemeChoice = preset.id;
            chip.style.background = preset.swatch;
            // No visible text and no tooltip: the swatch is the label. This is for
            // screen readers only.
            chip.setAttribute('aria-label', `主题色 ${preset.id}`);
            chip.classList.toggle(css.swatchActive, this.state.theme.themeColor === preset.id);
            chip.addEventListener('click', () => {
                this.state.theme.themeColor = preset.id;
                this.commit();
                // The layer tabs' knob lists depend on the theme colour (see buildTabs).
                this.tabs = this.buildTabs();
                this.activeTab = this.tabs.find(tab => tab.id === this.activeTab.id) ?? this.tabs[0];
                this.fillThemeSwatches(container);
                this.renderSheet();
            });
            container.appendChild(chip);
        }
    }
    /** Apply the shared state and persist it: every row's write goes through
     *  here, so the engine and the stored copy can never disagree. */
    commit() {
        this.skin.apply(this.state);
        saveSkinState(this.state);
    }
    renderControlsSheet() {
        const spec = this.activeTab;
        const readNote = () => typeof spec.note === 'function' ? spec.note() : spec.note;
        let note;
        const text = readNote();
        if (text !== undefined) {
            note = document.createElement('div');
            note.className = css.thumbHint;
            note.textContent = text;
            note.dataset.lgTabNote = '';
            this.rows.appendChild(note);
        }
        // The note can change WITH a drag (a 浓度/亮度 drag hands the layer back to
        // manual), so refresh it after every write instead of leaving a stale line.
        const refresh = () => {
            if (note === undefined)
                return;
            note.textContent = readNote() ?? '';
        };
        for (const row of spec.sliders)
            this.rows.appendChild(this.buildRow(row, spec, refresh));
        this.foot.replaceChildren(...this.buildControlsFoot());
    }
    buildSection(title, ...children) {
        const section = document.createElement('div');
        section.className = css.section;
        const head = document.createElement('div');
        head.className = css.sectionTitle;
        head.textContent = title;
        section.appendChild(head);
        section.append(...children);
        return section;
    }
    buildRow(spec, tab, afterWrite) {
        const row = document.createElement('div');
        row.className = css.row;
        const label = document.createElement('span');
        label.className = css.label;
        label.textContent = spec.label;
        const input = document.createElement('input');
        input.type = 'range';
        input.className = css.range;
        input.min = String(spec.min);
        input.max = String(spec.max);
        input.step = String(spec.step);
        const initial = tab.read(spec.key);
        const unset = initial === null;
        input.value = String(unset ? spec.fallback ?? spec.min : initial);
        input.setAttribute('aria-label', spec.label);
        const value = document.createElement('span');
        value.className = css.value;
        value.textContent = unset ? spec.placeholder ?? spec.format(spec.fallback ?? spec.min) : spec.format(initial);
        this.sheetListen(input, 'input', () => {
            const next = Number(input.value);
            tab.write(spec.key, next);
            value.textContent = spec.format(next);
            afterWrite?.();
        });
        row.append(label, input, value);
        return row;
    }
    buildThemeFoot() {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = css.ghost;
        reset.textContent = '重置主题';
        this.sheetListen(reset, 'click', () => {
            this.themeSpec.reset();
            this.renderSheet();
        });
        return [reset];
    }
    buildControlsFoot() {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = css.ghost;
        reset.textContent = '重置本页';
        this.sheetListen(reset, 'click', () => {
            this.activeTab.reset();
            this.renderSheet();
        });
        const buttons = [reset];
        // Export every tuned value (capsule and theme included) as JSON, so a
        // configuration can be handed over and baked into the registry defaults.
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = css.ghost;
        copy.textContent = '复制配置';
        this.sheetListen(copy, 'click', () => {
            const payload = JSON.stringify({ capsule: this.glass.params, theme: this.state.theme, layers: this.state.layers }, null, 2);
            const done = () => {
                copy.textContent = '已复制';
                window.setTimeout(() => { copy.textContent = '复制配置'; }, 1200);
            };
            if (navigator.clipboard?.writeText !== undefined) {
                void navigator.clipboard.writeText(payload).then(done, () => { copy.textContent = '复制失败'; });
            }
            else {
                const holder = document.createElement('textarea');
                holder.value = payload;
                document.body.appendChild(holder);
                holder.select();
                document.execCommand('copy');
                holder.remove();
                done();
            }
        });
        buttons.push(copy);
        if (this.activeTab.id === 'capsule') {
            const visibility = document.createElement('button');
            visibility.type = 'button';
            visibility.className = css.ghost;
            visibility.textContent = this.glass.isVisible() ? '隐藏玻璃' : '显示玻璃';
            this.sheetListen(visibility, 'click', () => {
                const show = visibility.textContent === '显示玻璃';
                this.glass.setVisible(show);
                visibility.textContent = show ? '隐藏玻璃' : '显示玻璃';
            });
            buttons.push(visibility);
        }
        return buttons;
    }
    /** Remove every element and listener this panel owns. */
    destroy() {
        for (const dispose of [...this.sheetTeardown, ...this.teardown])
            dispose();
        this.sheetTeardown = [];
        this.teardown = [];
        this.panel.remove();
        this.button.remove();
    }
}
/** Look up a 主题 row spec by its state key. */
function slider(key) {
    const spec = THEME_SLIDERS.find(entry => entry.key === key);
    if (spec === undefined)
        throw new Error(`unknown theme slider "${key}"`);
    return spec;
}
//# sourceMappingURL=sun-panel.js.map