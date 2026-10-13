"use client"

import * as React from "react"
import { Apple, Moon, Search, Sun, Wifi } from "lucide-react"
import { APPS } from "@/lib/apps"
import { LIQUIDS, LiquidCanvas, useSpringVar } from "@/components/ui/glass-object"
import { useWindowManager } from "./window-manager"

/**
 * The menu bar: a strip of glass along the top with a liquid light under it.
 * Every item is a chip that lifts on a spring under the cursor.
 *
 * - **Rest**: a flat strip; the active app's name sits bold at the left.
 * - **Hover**: the chip under the cursor rises a little and frosts.
 * - **Click the clock**: a glass pane hinges down from the bar with today's
 *   date and the month at a glance. Click again, or Escape, to close.
 * - **Moon / sun**: flips the desk between milk glass and smoked glass.
 * - **Apple**: opens System Settings.
 */

// a ticking clock as an external store: null on the server, so markup matches
const tickListeners = new Set<() => void>()
let tickTimer = 0
const subscribeTick = (fn: () => void) => {
  tickListeners.add(fn)
  if (!tickTimer) tickTimer = window.setInterval(() => tickListeners.forEach((l) => l()), 1000)
  return () => {
    tickListeners.delete(fn)
    if (!tickListeners.size && tickTimer) {
      window.clearInterval(tickTimer)
      tickTimer = 0
    }
  }
}
const minuteNow = () => Math.floor(Date.now() / 60000)
function useNow(): Date | null {
  const minute = React.useSyncExternalStore(subscribeTick, minuteNow, () => null)
  return minute === null ? null : new Date(minute * 60000)
}

function Chip({
  children,
  onClick,
  label,
  active,
  className,
}: {
  children: React.ReactNode
  onClick?: () => void
  label?: string
  active?: boolean
  className?: string
}) {
  const ref = React.useRef<HTMLButtonElement>(null)
  const set = useSpringVar(ref, "--chip", 0, 220, 18)
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={"mb-chip" + (className ? " " + className : "")}
      onPointerEnter={() => set(1)}
      onPointerLeave={() => set(0)}
      onFocus={() => set(1)}
      onBlur={() => set(0)}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function MonthPane({ now }: { now: Date }) {
  const y = now.getFullYear()
  const m = now.getMonth()
  const first = new Date(y, m, 1).getDay()
  const days = new Date(y, m + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, i) => i - first + 1)
  return (
    <div className="mb-pane-body">
      <div className="mb-pane-head">
        <span className="mb-pane-day">{now.toLocaleDateString(undefined, { weekday: "long" })}</span>
        <span className="mb-pane-date">{now.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</span>
      </div>
      <div className="mb-grid">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i} className="mb-grid-h">
            {d}
          </span>
        ))}
        {cells.map((d, i) => (
          <span key={i} className="mb-grid-d" data-today={d === now.getDate() || undefined} data-out={d < 1 || d > days || undefined}>
            {d >= 1 && d <= days ? d : ""}
          </span>
        ))}
      </div>
    </div>
  )
}

const MENUS = ["File", "Edit", "View", "Go", "Window", "Help"]

/** The battery as macOS draws it: an outline, a nub, and the charge as a fill. */
function Battery({ level = 0.82 }: { level?: number }) {
  return (
    <svg viewBox="0 0 28 13" width="26" height="12" aria-hidden="true" className="mb-glyph">
      <rect x="0.75" y="0.75" width="23.5" height="11.5" rx="3" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" />
      <path d="M26 4.5v4a2.2 2.2 0 0 0 0-4Z" fill="currentColor" fillOpacity="0.45" />
      <rect x="2.5" y="2.5" width={20 * level} height="8" rx="1.6" fill="currentColor" />
    </svg>
  )
}

/** Control Center: two toggles. */
function ControlCenter() {
  return (
    <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true" className="mb-glyph">
      <rect x="1" y="2.5" width="16" height="5.5" rx="2.75" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="5" cy="5.25" r="1.6" fill="currentColor" />
      <rect x="1" y="10" width="16" height="5.5" rx="2.75" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="13" cy="12.75" r="1.6" fill="currentColor" />
    </svg>
  )
}

export function MenuBar() {
  const { windows, focusedId, tone, setTone, toggleApp } = useWindowManager()
  const now = useNow()
  const [paneOpen, setPaneOpen] = React.useState(false)
  const paneRef = React.useRef<HTMLDivElement>(null)
  const setPane = useSpringVar(paneRef, "--pane", 0, 90, 11)
  React.useEffect(() => setPane(paneOpen ? 1 : 0), [paneOpen, setPane])
  React.useEffect(() => {
    if (!paneOpen) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPaneOpen(false)
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".mb-pane, .mb-clock")) setPaneOpen(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onDown)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onDown)
    }
  }, [paneOpen])

  const active = windows.find((w) => w.id === focusedId)
  const appName = active ? APPS[active.app].name : "Finder"
  const clock = now
    ? now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(",", "") +
      " " +
      now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "Mon Jan 1 12:00 PM"

  return (
    <header className="mb-root" data-tone={tone}>
      <style href="glass-menu-bar" precedence="glass-chrome">{MB_CSS}</style>
      <LiquidCanvas recipe={tone === "dark" ? LIQUIDS.smoke : LIQUIDS.pearl} seed={4} cells={160} fps={20} className="mb-liquid" />
      <span className="mb-glass" aria-hidden="true" />
      <Chip label="Open System Settings" onClick={() => toggleApp("settings")}>
        <Apple className="size-[15px] fill-current" strokeWidth={0} />
      </Chip>
      <Chip className="mb-app">{appName}</Chip>
      <nav className="mb-menus">
        {MENUS.map((m) => (
          <Chip key={m}>{m}</Chip>
        ))}
      </nav>
      <div className="mb-right">
        <Chip label={tone === "dark" ? "Switch to light desk" : "Switch to dark desk"} onClick={() => setTone(tone === "dark" ? "light" : "dark")}>
          {tone === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </Chip>
        <Chip label="Battery, 82%">
          <Battery level={0.82} />
        </Chip>
        <Chip label="Wi-Fi, connected">
          <Wifi className="size-[15px]" strokeWidth={2.2} />
        </Chip>
        <Chip label="Spotlight">
          <Search className="size-[14px]" strokeWidth={2.4} />
        </Chip>
        <Chip label="Control Center">
          <ControlCenter />
        </Chip>
        <Chip className="mb-clock" label="Date and time" active={paneOpen} onClick={() => setPaneOpen((o) => !o)}>
          <span style={{ opacity: now ? 1 : 0 }}>{clock}</span>
        </Chip>
      </div>
      <div ref={paneRef} className="mb-pane" data-open={paneOpen || undefined} aria-hidden={!paneOpen}>
        <LiquidCanvas recipe={tone === "dark" ? LIQUIDS.smoke : LIQUIDS.milk} seed={11} cells={64} fps={20} className="mb-liquid" />
        <span className="mb-glass" aria-hidden="true" />
        {now ? <MonthPane now={now} /> : null}
      </div>
    </header>
  )
}

const MB_CSS = `
.mb-root {
  --mb-ink: #141416;
  --mb-glass: 255, 255, 255;
  position: absolute; inset: 0 0 auto 0; z-index: 1000;
  display: flex; align-items: center; gap: 0;
  height: 25px; padding: 0 10px 0 8px;
  color: var(--mb-ink);
  font-size: 13px;
  letter-spacing: -.01em;
  font-family: ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  user-select: none;
  isolation: isolate;
  box-shadow: 0 .5px 0 rgba(0,0,0,.1), 0 10px 30px -20px rgba(16,18,24,.3);
}
.mb-root[data-tone="dark"] { --mb-ink: #f5f5f7; --mb-glass: 22, 22, 26; box-shadow: 0 .5px 0 rgba(255,255,255,.1); }
.mb-liquid { position: absolute; inset: 0; z-index: -2; width: 100%; height: 100%; }
.mb-glass { position: absolute; inset: 0; z-index: -1; background: rgba(var(--mb-glass), .55); -webkit-backdrop-filter: blur(16px) saturate(1.5); backdrop-filter: blur(16px) saturate(1.5); }
.mb-chip {
  all: unset;
  --chip: 0;
  position: relative;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 19px; min-width: 20px; padding: 0 8px;
  border-radius: 5px;
  cursor: default;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  background: rgba(var(--mb-glass), calc(var(--chip) * .75));
  box-shadow: inset 0 1px 0 rgba(255,255,255,calc(var(--chip) * .9)), 0 0 0 .5px rgba(0,0,0,calc(var(--chip) * .1)), 0 6px 14px -8px rgba(0,0,0,calc(var(--chip) * .35));
  transform: translateY(calc(var(--chip) * -1px));
}
.mb-chip[aria-pressed="true"] { background: rgba(var(--mb-glass), .8); box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 .5px rgba(0,0,0,.1); }
.mb-chip:focus-visible { outline: 2px solid #4c8dff; outline-offset: 1px; }
.mb-app { font-weight: 700; padding-left: 6px; }
.mb-glyph { display: block; }
.mb-menus { display: none; align-items: center; gap: 2px; }
@media (min-width: 768px) { .mb-menus { display: inline-flex; } }
.mb-right { margin-left: auto; display: inline-flex; align-items: center; gap: 1px; }
.mb-right .mb-chip { padding: 0 6px; }
.mb-clock { font-weight: 500; padding: 0 6px 0 8px !important; }

.mb-pane {
  --pane: 0;
  position: absolute; right: 8px; top: 36px;
  width: 268px;
  border-radius: 18px;
  overflow: hidden;
  isolation: isolate;
  color: var(--mb-ink);
  transform-origin: 90% 0%;
  transform: perspective(900px) rotateX(calc((1 - var(--pane)) * -28deg)) translateY(calc((1 - var(--pane)) * -8px)) scale(calc(.94 + var(--pane) * .06));
  opacity: var(--pane);
  visibility: hidden;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 .5px rgba(0,0,0,.12), 0 30px 60px -20px rgba(16,18,24,.45);
}
.mb-root[data-tone="dark"] .mb-pane { box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 0 0 .5px rgba(255,255,255,.12), 0 30px 60px -20px rgba(0,0,0,.8); }
.mb-pane[data-open] { visibility: visible; }
.mb-pane-body { position: relative; padding: 14px 16px 16px; }
.mb-pane-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
.mb-pane-day { font-size: 12px; font-weight: 600; color: #ff3b30; letter-spacing: .02em; text-transform: uppercase; }
.mb-pane-date { font-size: 17px; font-weight: 600; letter-spacing: -.01em; }
.mb-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px 0; font-size: 11.5px; text-align: center; }
.mb-grid-h { font-weight: 600; opacity: .45; padding-bottom: 4px; }
.mb-grid-d { height: 26px; line-height: 26px; border-radius: 50%; font-variant-numeric: tabular-nums; }
.mb-grid-d[data-out] { opacity: .3; }
.mb-grid-d[data-today] { background: #ff3b30; color: #fff; font-weight: 600; }
`
