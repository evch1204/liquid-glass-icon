"use client"

import * as React from "react"
import { APPS, DOCK_ORDER } from "@/lib/apps"
import { LIQUIDS, LiquidCanvas, useSpringVar } from "@/components/ui/glass-object"
import { DOCK_ICONS } from "./dock-icons"
import { useWindowManager, type AppId } from "./window-manager"

/**
 * The dock: a tray of glass with a liquid light under it, and a tile for each
 * app. Each tile is its own small object: a tinted liquid behind a frosted
 * face with the app's glyph on it.
 *
 * - **Rest**: the tray sits flat; tiles are even.
 * - **Hover**: tiles swell toward the cursor on springs, nearest the most,
 *   and a glass chip with the app's name rises above the one under it.
 * - **Press**: the tile dips.
 * - **Click**: the tile bounces as its app opens, and a dot appears under it
 *   while the app has a window. Click again to minimise or bring it back.
 *
 * Every motion is a spring on requestAnimationFrame; nothing transitions.
 */

function Tile({
  id,
  index,
  running,
  active,
  onPress,
}: {
  id: AppId
  index: number
  running: boolean
  active: boolean
  onPress: () => void
}) {
  const app = APPS[id]
  const Icon = DOCK_ICONS[id]
  const ref = React.useRef<HTMLButtonElement>(null)
  const setLift = useSpringVar(ref, "--tile-lift", 0, 160, 14) // hover 0..1
  const setDip = useSpringVar(ref, "--tile-dip", 0, 500, 26)
  const setBounce = useSpringVar(ref, "--tile-bounce", 0, 90, 7)

  return (
    <button
      ref={ref}
      type="button"
      data-dock-tile
      aria-label={app.name}
      className="dock-tile"
      style={{ "--tile-i": index } as React.CSSProperties}
      onPointerEnter={() => setLift(1)}
      onPointerLeave={() => {
        setLift(0)
        setDip(0)
      }}
      onPointerDown={() => setDip(1)}
      onPointerUp={() => setDip(0)}
      onFocus={() => setLift(1)}
      onBlur={() => setLift(0)}
      onClick={() => {
        if (!running) {
          setBounce(1)
          window.setTimeout(() => setBounce(0), 140)
        }
        onPress()
      }}
    >
      <span className="dock-face" aria-hidden="true">
        <Icon />
      </span>
      <span className="dock-chip" aria-hidden="true">
        {app.name}
      </span>
      <span className="dock-dot" data-on={running || undefined} data-active={active || undefined} aria-hidden="true" />
    </button>
  )
}

export function Dock() {
  const { windows, toggleApp, focusedId, tone } = useWindowManager()
  const trayRef = React.useRef<HTMLElement>(null)
  const setTrayLift = useSpringVar(trayRef, "--tray-hover", 0, 120, 14)

  // magnification: each tile's --tile-mag follows the pointer, on its own spring
  React.useEffect(() => {
    const el = trayRef.current
    if (!el) return
    type S = { el: HTMLElement; x: number; v: number; t: number }
    const tiles = () => Array.from(el.querySelectorAll<HTMLElement>("[data-dock-tile]"))
    let springs: S[] = []
    let raf = 0
    let last = 0
    let px: number | null = null
    const sync = () => {
      const ts = tiles()
      if (springs.length !== ts.length) springs = ts.map((t) => ({ el: t, x: 0, v: 0, t: 0 }))
    }
    const retarget = () => {
      sync()
      for (const s of springs) {
        if (px === null) {
          s.t = 0
          continue
        }
        const r = s.el.getBoundingClientRect()
        const d = Math.abs(px - (r.left + r.width / 2))
        s.t = Math.max(0, 1 - d / 150)
      }
    }
    const loop = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016
      last = now
      let moving = false
      for (const s of springs) {
        const a = -170 * (s.x - s.t) - 17 * s.v
        s.v += a * dt
        s.x += s.v * dt
        if (Math.abs(s.v) > 0.0005 || Math.abs(s.x - s.t) > 0.0005) moving = true
        else {
          s.x = s.t
          s.v = 0
        }
        s.el.style.setProperty("--tile-mag", s.x.toFixed(4))
      }
      raf = moving ? requestAnimationFrame(loop) : 0
      if (!moving) last = 0
    }
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(loop)
    }
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return
      px = e.clientX
      retarget()
      kick()
    }
    const leave = () => {
      px = null
      retarget()
      kick()
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerleave", leave)
    return () => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerleave", leave)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[900] flex justify-center">
      <style href="glass-dock" precedence="glass-chrome">{DOCK_CSS}</style>
      <nav
        ref={trayRef}
        aria-label="Dock"
        className="dock-tray pointer-events-auto"
        data-tone={tone}
        onPointerEnter={() => setTrayLift(1)}
        onPointerLeave={() => setTrayLift(0)}
      >
        <LiquidCanvas recipe={tone === "dark" ? LIQUIDS.smoke : LIQUIDS.milk} seed={9} cells={120} fps={24} className="dock-liquid" />
        <span className="dock-tray-glass" aria-hidden="true" />
        <span className="dock-tray-rim" aria-hidden="true" />
        {DOCK_ORDER.map((id, i) => (
          <React.Fragment key={id}>
            {id === "settings" ? <span aria-hidden="true" className="dock-sep" /> : null}
            <Tile
              id={id}
              index={i}
              running={windows.some((w) => w.app === id && w.phase !== "closing")}
              active={windows.some((w) => w.app === id && w.id === focusedId)}
              onPress={() => toggleApp(id, { title: APPS[id].name, w: APPS[id].defaultSize.w, h: APPS[id].defaultSize.h })}
            />
          </React.Fragment>
        ))}
      </nav>
    </div>
  )
}

const DOCK_CSS = `
.dock-tray {
  --tray-hover: 0;
  --dock-ink: #141416;
  --dock-glass: 255, 255, 255;
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 7px;
  padding: 8px 9px 6px;
  border-radius: 26px;
  isolation: isolate;
  color: var(--dock-ink);
  transform: translateY(calc(var(--tray-hover) * -2px));
  box-shadow: 0 0 0 .5px rgba(0, 0, 0, .12), 0 30px 60px -24px rgba(16, 18, 24, .45);
  font-family: ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.dock-tray[data-tone="dark"] { --dock-ink: #f5f5f7; --dock-glass: 22, 22, 26; box-shadow: 0 0 0 .5px rgba(255, 255, 255, .12), 0 30px 60px -24px rgba(0, 0, 0, .8); }
.dock-liquid { position: absolute; inset: 0; z-index: -2; width: 100%; height: 100%; border-radius: inherit; }
.dock-tray-glass {
  position: absolute; inset: 0; z-index: -1; border-radius: inherit;
  background: linear-gradient(180deg, rgba(var(--dock-glass), .35), rgba(var(--dock-glass), .7));
  -webkit-backdrop-filter: blur(16px) saturate(1.5); backdrop-filter: blur(16px) saturate(1.5);
}
.dock-tray-rim {
  position: absolute; inset: 0; z-index: 0; border-radius: inherit; padding: 1px; pointer-events: none;
  background: linear-gradient(180deg, rgba(255,255,255,.95), rgba(255,255,255,.3) 40%, rgba(255,255,255,.1));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
}
.dock-tray[data-tone="dark"] .dock-tray-rim { opacity: .45; }
.dock-sep { width: 1px; height: 36px; margin: 0 4px 8px; background: rgba(20, 20, 22, .14); align-self: flex-end; }
.dock-tray[data-tone="dark"] .dock-sep { background: rgba(255, 255, 255, .14); }

.dock-tile {
  all: unset;
  --tile-mag: 0; --tile-lift: 0; --tile-dip: 0; --tile-bounce: 0;
  position: relative;
  display: flex; flex-direction: column; align-items: center;
  cursor: pointer;
  transform-origin: 50% 100%;
  transform:
    translateY(calc(var(--tile-mag) * -12px - var(--tile-bounce) * 18px + var(--tile-dip) * 3px))
    scale(calc(1 + var(--tile-mag) * .5 - var(--tile-dip) * .08));
}
.dock-tile:focus-visible .dock-face { outline: 2px solid #4c8dff; outline-offset: 3px; }
.dock-face {
  position: relative;
  display: block;
  width: 52px; height: 52px;
  border-radius: 12px;
  filter: drop-shadow(0 6px 10px rgba(0,0,0,.28)) drop-shadow(0 1px 2px rgba(0,0,0,.2));
}
.dock-icon { display: block; width: 52px; height: 52px; }
.dock-chip {
  position: absolute;
  bottom: calc(100% + 10px);
  padding: 5px 9px;
  border-radius: 9px;
  font-size: 11.5px; font-weight: 500; white-space: nowrap;
  color: var(--dock-ink);
  background: rgba(var(--dock-glass), .8);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.8), 0 0 0 .5px rgba(0,0,0,.12), 0 10px 20px -10px rgba(0,0,0,.4);
  opacity: var(--tile-lift);
  transform: translateY(calc((1 - var(--tile-lift)) * 8px)) scale(calc(.9 + var(--tile-lift) * .1));
  transform-origin: 50% 100%;
  pointer-events: none;
}
.dock-dot {
  width: 4px; height: 4px; margin-top: 4px; border-radius: 50%;
  background: var(--dock-ink);
  opacity: 0;
}
.dock-dot[data-on] { opacity: .45; }
.dock-dot[data-active] { opacity: .95; }
`
