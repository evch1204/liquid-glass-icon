"use client"

import * as React from "react"
import type { ArtPreset } from "@/components/ui/glass-folder-cards"
import { cn } from "@/lib/utils"

/**
 * The desktop's window manager.
 *
 * Holds every open window (position, size, z-order, minimised), the desk's
 * tone (milk or smoked glass) and the wallpaper recipe. Apps register in
 * `lib/apps.ts`; the desktop maps each open window to its app component,
 * and each app renders itself inside a <GlassWindow>.
 */

export type AppId = "finder" | "photo-booth" | "stocks" | "clock" | "weather" | "calendar" | "notes" | "music" | "settings"

export type WindowState = {
  id: string
  app: AppId
  title: string
  x: number
  y: number
  w: number
  h: number
  z: number
  minimized: boolean
  /** "opening" plays the entrance, "closing" the exit, then the window is removed. */
  phase: "opening" | "open" | "closing"
  payload?: unknown
}

export type OpenOptions = {
  title?: string
  payload?: unknown
  w?: number
  h?: number
  x?: number
  y?: number
  /**
   * Reuse a window instead of opening another. `app` reuses any window of the
   * same app; a string reuses the window whose `singletonKey` matches.
   */
  singleton?: "app" | string
}

type Ctx = {
  windows: WindowState[]
  focusedId: string | null
  open: (app: AppId, opts?: OpenOptions) => string
  close: (id: string) => void
  focus: (id: string) => void
  minimize: (id: string) => void
  restore: (id: string) => void
  toggleApp: (app: AppId, opts?: OpenOptions) => void
  update: (id: string, patch: Partial<WindowState>) => void
  tone: "light" | "dark"
  setTone: (t: "light" | "dark") => void
  wallpaper: ArtPreset
  setWallpaper: (w: ArtPreset) => void
  /** The desktop's pixel size, for centring new windows. */
  viewport: { w: number; h: number }
}

const WindowCtx = React.createContext<Ctx | null>(null)

export function useWindowManager(): Ctx {
  const ctx = React.useContext(WindowCtx)
  if (!ctx) throw new Error("useWindowManager must be used inside <WindowManager>")
  return ctx
}

const singletonKeys = new Map<string, string>() // singleton key -> window id
let counter = 0

export function WindowManager({
  children,
  defaultTone = "light",
  defaultWallpaper = "aurora",
}: {
  children: React.ReactNode
  defaultTone?: "light" | "dark"
  defaultWallpaper?: ArtPreset
}) {
  const [windows, setWindows] = React.useState<WindowState[]>([])
  const [focusedId, setFocusedId] = React.useState<string | null>(null)
  const [tone, setToneState] = React.useState<"light" | "dark">(defaultTone)
  const [wallpaper, setWallpaper] = React.useState<ArtPreset>(defaultWallpaper)
  const [viewport, setViewport] = React.useState({ w: 1280, h: 800 })
  const zRef = React.useRef(10)

  React.useEffect(() => {
    const read = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    read()
    window.addEventListener("resize", read)
    return () => window.removeEventListener("resize", read)
  }, [])

  // the tone drives shadcn's `.dark` variant for the whole page
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", tone === "dark")
    document.documentElement.style.colorScheme = tone
  }, [tone])

  const setTone = React.useCallback((t: "light" | "dark") => setToneState(t), [])

  const focus = React.useCallback((id: string) => {
    setFocusedId(id)
    setWindows((ws) => {
      const top = ws.reduce((m, w) => Math.max(m, w.z), 0)
      const target = ws.find((w) => w.id === id)
      if (!target || (target.z === top && !target.minimized)) return ws
      zRef.current = top + 1
      return ws.map((w) => (w.id === id ? { ...w, z: zRef.current, minimized: false } : w))
    })
  }, [])

  const update = React.useCallback((id: string, patch: Partial<WindowState>) => {
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)))
  }, [])

  const close = React.useCallback((id: string) => {
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, phase: "closing" } : w)))
    for (const [k, v] of singletonKeys) if (v === id) singletonKeys.delete(k)
    window.setTimeout(() => {
      setWindows((ws) => {
        const next = ws.filter((w) => w.id !== id)
        setFocusedId((f) => {
          if (f !== id) return f
          const top = next.filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0]
          return top?.id ?? null
        })
        return next
      })
    }, 220)
  }, [])

  const minimize = React.useCallback((id: string) => {
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, minimized: true } : w)))
    setFocusedId((f) => (f === id ? null : f))
  }, [])

  const restore = React.useCallback((id: string) => focus(id), [focus])

  const open = React.useCallback(
    (app: AppId, opts: OpenOptions = {}) => {
      const key = opts.singleton === "app" ? "app:" + app : opts.singleton ? "key:" + opts.singleton : null
      if (key) {
        const existing = singletonKeys.get(key)
        if (existing) {
          // it may have been closed from a different path; only reuse live windows
          let alive = false
          setWindows((ws) => {
            alive = ws.some((w) => w.id === existing && w.phase !== "closing")
            return ws
          })
          if (alive) {
            focus(existing)
            if (opts.payload !== undefined) update(existing, { payload: opts.payload, title: opts.title })
            return existing
          }
          singletonKeys.delete(key)
        }
      }
      const id = app + "-" + ++counter
      const w = opts.w ?? 760
      const h = opts.h ?? 520
      // cascade from the centre so a stack of windows stays readable
      const n = counter % 6
      const x = opts.x ?? Math.max(16, Math.round((viewport.w - w) / 2) + n * 28 - 60)
      const y = opts.y ?? Math.max(44, Math.round((viewport.h - h) / 2) + n * 24 - 50)
      zRef.current += 1
      const win: WindowState = {
        id,
        app,
        title: opts.title ?? app,
        x,
        y,
        w: Math.min(w, viewport.w - 32),
        h: Math.min(h, viewport.h - 120),
        z: zRef.current,
        minimized: false,
        phase: "opening",
        payload: opts.payload,
      }
      if (key) singletonKeys.set(key, id)
      setWindows((ws) => [...ws, win])
      setFocusedId(id)
      window.setTimeout(() => update(id, { phase: "open" }), 420)
      return id
    },
    [focus, update, viewport.h, viewport.w],
  )

  const toggleApp = React.useCallback(
    (app: AppId, opts?: OpenOptions) => {
      const mine = windows.filter((w) => w.app === app && w.phase !== "closing")
      if (!mine.length) {
        open(app, { singleton: "app", ...opts })
        return
      }
      const top = mine.sort((a, b) => b.z - a.z)[0]
      if (top.minimized || focusedId !== top.id) focus(top.id)
      else minimize(top.id)
    },
    [windows, open, focus, minimize, focusedId],
  )

  const value = React.useMemo<Ctx>(
    () => ({ windows, focusedId, open, close, focus, minimize, restore, toggleApp, update, tone, setTone, wallpaper, setWallpaper, viewport }),
    [windows, focusedId, open, close, focus, minimize, restore, toggleApp, update, tone, setTone, wallpaper, viewport],
  )

  return <WindowCtx.Provider value={value}>{children}</WindowCtx.Provider>
}

// ---------------------------------------------------------------------------
// Window chrome

export function TrafficLights({ id, className }: { id: string; className?: string }) {
  const { close, minimize, update, viewport, windows } = useWindowManager()
  const win = windows.find((w) => w.id === id)
  const zoom = () => {
    if (!win) return
    const full = win.w >= viewport.w - 40
    update(
      id,
      full
        ? { x: Math.round(viewport.w * 0.15), y: 80, w: Math.round(viewport.w * 0.7), h: Math.round(viewport.h * 0.7) }
        : { x: 12, y: 40, w: viewport.w - 24, h: viewport.h - 120 },
    )
  }
  const dot = "group/tl relative size-3 rounded-full shadow-[inset_0_0_0_0.5px_rgba(0,0,0,.2)] transition-transform active:scale-90 grid place-items-center text-[9px] leading-none text-black/60 opacity-100"
  return (
    <div className={cn("flex items-center gap-2", className)} data-no-drag>
      <button type="button" aria-label="Close window" onClick={() => close(id)} className={cn(dot, "bg-[#ff5f57]")}>
        <span className="opacity-0 transition-opacity group-hover/tl:opacity-100">×</span>
      </button>
      <button type="button" aria-label="Minimise window" onClick={() => minimize(id)} className={cn(dot, "bg-[#febc2e]")}>
        <span className="opacity-0 transition-opacity group-hover/tl:opacity-100">–</span>
      </button>
      <button type="button" aria-label="Zoom window" onClick={zoom} className={cn(dot, "bg-[#28c840]")}>
        <span className="opacity-0 transition-opacity group-hover/tl:opacity-100">+</span>
      </button>
    </div>
  )
}

export type GlassWindowProps = {
  win: WindowState
  children: React.ReactNode
  /** Draw the default title bar. Turn off to draw your own; mark it with `data-drag-handle`. */
  titleBar?: boolean
  /** Optional icon at the left of the default title bar. */
  icon?: React.ReactNode
  minW?: number
  minH?: number
  resizable?: boolean
  className?: string
  /** Extra classes on the content box (below the title bar). */
  contentClassName?: string
}

/**
 * The frame every app lives in. Drag by the title bar (or any element with
 * `data-drag-handle`), resize from the corner, click anywhere to focus. The
 * frame is frosted glass; app content sits on top.
 */
export function GlassWindow({
  win,
  children,
  titleBar = true,
  icon,
  minW = 360,
  minH = 240,
  resizable = true,
  className,
  contentClassName,
}: GlassWindowProps) {
  const { focus, update, focusedId, viewport } = useWindowManager()
  const ref = React.useRef<HTMLDivElement>(null)
  const focused = focusedId === win.id

  // ---- drag: writes transform directly during the gesture, commits on release
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    let dragging = false
    let sx = 0
    let sy = 0
    let ox = 0
    let oy = 0
    let dx = 0
    let dy = 0
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (e.button !== 0) return
      if (t.closest("[data-no-drag], button, input, textarea, select, a, [role=menuitem]")) return
      const handle = t.closest("[data-drag-handle]")
      if (!handle || !el.contains(handle)) return
      dragging = true
      sx = e.clientX
      sy = e.clientY
      ox = win.x
      oy = win.y
      el.setPointerCapture(e.pointerId)
      el.style.transition = "none"
      el.style.willChange = "transform"
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      dx = e.clientX - sx
      dy = e.clientY - sy
      el.style.transform = `translate(${dx}px, ${dy}px)`
    }
    const up = (e: PointerEvent) => {
      if (!dragging) return
      dragging = false
      el.releasePointerCapture(e.pointerId)
      el.style.transform = ""
      el.style.transition = ""
      el.style.willChange = ""
      const nx = Math.min(Math.max(-win.w + 120, ox + dx), viewport.w - 120)
      const ny = Math.min(Math.max(28, oy + dy), viewport.h - 60)
      if (dx || dy) update(win.id, { x: nx, y: ny })
      dx = dy = 0
    }
    el.addEventListener("pointerdown", down)
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
    el.addEventListener("pointercancel", up)
    return () => {
      el.removeEventListener("pointerdown", down)
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      el.removeEventListener("pointercancel", up)
    }
  }, [win.id, win.x, win.y, win.w, update, viewport.h, viewport.w])

  // ---- resize from the bottom-right corner
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const sx = e.clientX
    const sy = e.clientY
    const ow = win.w
    const oh = win.h
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      update(win.id, {
        w: Math.max(minW, ow + ev.clientX - sx),
        h: Math.max(minH, oh + ev.clientY - sy),
      })
    }
    const up = () => {
      target.removeEventListener("pointermove", move)
      target.removeEventListener("pointerup", up)
    }
    target.addEventListener("pointermove", move)
    target.addEventListener("pointerup", up)
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={win.title}
      data-window={win.app}
      data-focused={focused || undefined}
      onPointerDownCapture={() => {
        if (!focused) focus(win.id)
      }}
      className={cn(
        "glass glass-sheen absolute flex flex-col overflow-hidden rounded-2xl",
        "transition-[opacity,transform,box-shadow] duration-300 [transition-timing-function:var(--glass-ease)]",
        win.phase === "opening" && "[animation:glass-window-in_.42s_var(--glass-spring)_both]",
        win.phase === "closing" && "pointer-events-none [animation:glass-window-out_.22s_var(--glass-ease)_both]",
        win.minimized && "pointer-events-none scale-75 opacity-0 translate-y-[40vh]",
        !focused && "[--glass-shadow:0_18px_40px_-20px_rgba(10,12,20,.3)]",
        className,
      )}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
    >
      {titleBar ? (
        <div
          data-drag-handle
          className="relative flex h-11 shrink-0 items-center gap-3 border-b border-[var(--glass-ink-faint)] px-4 select-none"
        >
          <TrafficLights id={win.id} />
          <div className="pointer-events-none absolute inset-x-0 flex items-center justify-center gap-2 text-[13px] font-medium ink">
            {icon ? <span className="ink-soft [&_svg]:size-4">{icon}</span> : null}
            <span className={cn(!focused && "ink-soft")}>{win.title}</span>
          </div>
        </div>
      ) : null}
      <div className={cn("relative min-h-0 flex-1", contentClassName)}>{children}</div>
      {resizable ? (
        <div
          data-no-drag
          onPointerDown={onResizeDown}
          aria-hidden="true"
          className="absolute right-0 bottom-0 z-10 size-5 cursor-nwse-resize"
        />
      ) : null}
    </div>
  )
}
