/**
 * Liquid-glass skin, browser half: mounts the draggable liquid-glass capsule
 * (a 1:1 port of Shu Ding's liquid-glass.js) over the app, the layered skin
 * engine (wallpaper, one glass surface per layer, driven by the app's own theme
 * tokens), and the bottom-right sun button whose two-category sheet retunes the
 * theme (壁纸 / 配色 / 文字) and every glass layer live. No services and
 * no slots — the whole surface is plugin-owned DOM under document.body, torn
 * down with the plugin.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { LiquidGlass } from './liquid-glass.ts'
import { SkinEngine } from './skin.ts'
import { SunPanel } from './sun-panel.ts'

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const skin = new SkinEngine()
    const glass = new LiquidGlass()
    let panel: SunPanel | undefined
    try {
      skin.mount()
      // One shared state: the engine owns it, the panel's rows mutate it in
      // place, every apply() reads the same object.
      skin.apply(skin.state)

      glass.appendTo(document.body)
      // The capsule is the refraction SAMPLE, not a piece of UI: every layer's
      // field reads its numbers (setLensReference), so it can stay off screen
      // and cost nothing (display:none drops its filter entirely). The 胶囊 tab's
      // 显示玻璃 button brings it back for a session whenever it is wanted.
      glass.setVisible(false)
      panel = new SunPanel(glass, skin.state, skin)
      panel.mount(document.body)

      // The wallpaper directory arrives async (the node half lists it over the
      // host web server); repaint and re-render the sheet once it is known, so
      // the picker shows the directory's thumbnails instead of an empty strip.
      // On a FIRST activation the route can register after this page booted
      // (the node half polls for the web server), and that first listing then
      // reads empty — a fresh install would sit on the dark base until a manual
      // pick. Retry for a while; the repaint only runs once the directory is
      // actually known (or the window is closed on it, e.g. no web server).
      void (async () => {
        for (let attempt = 0; attempt < 10; attempt++) {
          await skin.reloadWallpapers()
          if (skin.wallpaperUserFiles.length > 0 || skin.wallpaperDefaultFiles.length > 0) break
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
        skin.apply(skin.state)
        panel?.rerender()
      })()

      return () => {
        panel?.destroy()
        glass.destroy()
        skin.destroy()
      }
    } catch (error) {
      // The glass must never survive a failed activation: dispose what this
      // run mounted so a retry cannot double it.
      panel?.destroy()
      glass.destroy()
      skin.destroy()
      throw error
    }
  }, 'ui-liquid-glass: liquid glass skin')
}
