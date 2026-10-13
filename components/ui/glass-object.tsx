"use client"

import * as React from "react"

/**
 * Glass Object — the engine behind every glass thing on the desk that is not
 * a folder: widgets, dock tiles, menu chips.
 *
 * An object is drawn the way the folder is drawn: as a thing with layers.
 * Back to front: a liquid light painted in a canvas, the contents (real
 * elements, not a picture), and a frosted-glass pane that blurs whatever sits
 * behind it. The pane carries a rim light and a specular highlight that
 * follows the cursor.
 *
 * Nothing here animates with CSS transitions. Every motion value is a spring
 * integrated on requestAnimationFrame and written to the root as a CSS
 * variable, so the geometry moves with real inertia and overshoot:
 *
 * - `--go-px`, `--go-py`   where the pointer is, -1 … 1, easing back to 0
 * - `--go-vx`, `--go-vy`   how fast the pointer is moving, for lag and slosh
 * - `--go-hover`           0 → 1 while the pointer is over the object
 * - `--go-open`            0 → 1 while the object is open
 * - `--go-press`           0 → 1 while held: fast down, bouncy release
 * - `--go-lift`            how far off the desk it is; shadows follow it
 *
 * The protocol every object follows:
 *
 * - **Rest**: flat and closed.
 * - **Hover / focus**: the object lifts and tilts toward the cursor, and the
 *   pane leans; contents may rise to peek out.
 * - **Open** (click, Space): a second face. The object is operated — a dome
 *   lifted, a tape pulled, a page flipped — and shows what it could not at rest.
 * - **Activate** (double-click, Enter): the object hands off to its app.
 * - Escape or a press outside closes it.
 *
 * Contents are inert by default so the whole object is one big button; mark
 * anything that should take its own clicks with the `go-live` class.
 */

// ---------------------------------------------------------------------------
// Springs

type Spring = { x: number; v: number; t: number; k: number; c: number }

const mk = (x: number, k: number, c: number): Spring => ({ x, v: 0, t: x, k, c })

/** One integration step. Returns true while the spring is still moving. */
function tick(s: Spring, dt: number): boolean {
  const a = -s.k * (s.x - s.t) - s.c * s.v
  s.v += a * dt
  s.x += s.v * dt
  if (Math.abs(s.v) < 0.0008 && Math.abs(s.x - s.t) < 0.0008) {
    s.x = s.t
    s.v = 0
    return false
  }
  return true
}

const reduceMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

export type SpringOptions = {
  /** Stiffness for this move. */
  k?: number
  /** Damping for this move. */
  c?: number
  /** Milliseconds before the move starts: for staging without CSS delays. */
  delay?: number
  /** A kick of velocity instead of (or as well as) a new target. */
  impulse?: number
}

export type SpringSetter = (target?: number, opts?: SpringOptions) => void

/**
 * A spring you can drive from any component: give it a target, it writes a
 * CSS variable on `ref` every frame until it settles, plus `<name>-v` with its
 * velocity. `set(1, { k, c })` changes the character of that one move;
 * `set(undefined, { impulse: 0.6 })` just kicks it. Under reduced motion the
 * value jumps to its target and impulses are ignored.
 */
export function useSpringVar(ref: React.RefObject<HTMLElement | null>, name: string, initial = 0, k = 140, c = 16): SpringSetter {
  const s = React.useRef(mk(initial, k, c))
  const base = React.useRef({ k, c })
  const set = React.useRef<SpringSetter>(() => {})
  React.useEffect(() => {
    let raf = 0
    let last = 0
    const timers = new Set<number>()
    const reduce = reduceMotion()
    const write = () => {
      const el = ref.current
      if (!el) return
      el.style.setProperty(name, s.current.x.toFixed(4))
      el.style.setProperty(name + "-v", s.current.v.toFixed(3))
    }
    const loop = () => {
      const now = performance.now()
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016
      last = now
      const moving = tick(s.current, dt)
      write()
      raf = moving ? requestAnimationFrame(loop) : 0
      if (!moving) last = 0
    }
    const apply = (target: number | undefined, opts: SpringOptions) => {
      const sp = s.current
      sp.k = opts.k ?? base.current.k
      sp.c = opts.c ?? base.current.c
      if (target !== undefined) sp.t = target
      if (reduce) {
        sp.x = sp.t
        sp.v = 0
        write()
        return
      }
      if (opts.impulse) sp.v += opts.impulse
      if (!raf) raf = requestAnimationFrame(loop)
    }
    set.current = (target, opts = {}) => {
      if (opts.delay) {
        const t = window.setTimeout(() => {
          timers.delete(t)
          apply(target, opts)
        }, opts.delay)
        timers.add(t)
      } else apply(target, opts)
    }
    return () => {
      cancelAnimationFrame(raf)
      timers.forEach((t) => window.clearTimeout(t))
      set.current = () => {}
    }
  }, [ref, name])
  return React.useCallback<SpringSetter>((target, opts) => set.current(target, opts), [])
}

// ---------------------------------------------------------------------------
// Context

export type GlassFrame = { px: number; py: number; vx: number; vy: number; hover: number; open: number; press: number; lift: number; in: number }

export type GlassState = {
  hover: boolean
  open: boolean
  pressed: boolean
  focused: boolean
  tone: "light" | "dark"
  setOpen: (open: boolean) => void
  activate: () => void
  /** The object's root, for anything that wants to listen to its pointer. */
  rootRef: React.RefObject<HTMLDivElement | null>
  /** Called every engine frame while anything is moving, with the live spring values. */
  onFrame: (cb: (f: GlassFrame) => void) => () => void
  /** The current spring values, readable any time without parsing CSS. */
  frame: React.RefObject<GlassFrame>
}

const Ctx = React.createContext<GlassState | null>(null)

export function useGlass(): GlassState {
  const v = React.useContext(Ctx)
  if (!v) throw new Error("useGlass must be used inside <GlassObject>")
  return v
}

// ---------------------------------------------------------------------------
// The object

export type GlassObjectProps = {
  width: number
  height: number
  /** Milk glass or smoked glass. */
  tone?: "light" | "dark"
  /** Accessible name of the whole object, e.g. "Clock, 1:23 PM". */
  label: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Double-click or Enter. Usually: open the app. */
  onActivate?: () => void
  /** Degrees of tilt toward the cursor. */
  tilt?: number
  /** `center` turns in mid-air; `base` tips about its bottom edge, like something standing on the desk. */
  pivot?: "center" | "base"
  /** How far it rises on hover, 0–1 of the shadow's range. */
  hoverLift?: number
  /** Corner radius of the object's shadow and clip. */
  radius?: number
  /** Let the contents hang outside the box (for things that rise out). */
  overflow?: "visible" | "hidden"
  /** Assemble itself the first time it scrolls into view, after this delay in ms. */
  appearDelay?: number
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}

export function GlassObject({
  width,
  height,
  tone = "light",
  label,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onActivate,
  tilt = 5,
  pivot = "center",
  hoverLift = 0.3,
  radius = 24,
  overflow = "visible",
  appearDelay = 0,
  className,
  style,
  children,
}: GlassObjectProps) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const hitRef = React.useRef<HTMLButtonElement>(null)
  const [hover, setHover] = React.useState(false)
  const [pressed, setPressed] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const [entered, setEntered] = React.useState(false)
  const [openState, setOpenState] = React.useState(defaultOpen)
  const open = openProp ?? openState
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (openProp === undefined) setOpenState(next)
      onOpenChange?.(next)
    },
    [openProp, onOpenChange],
  )
  const activate = React.useCallback(() => onActivate?.(), [onActivate])

  // ---- springs, integrated on rAF and written as CSS variables -------------
  const springs = React.useRef({
    px: mk(0, 110, 15),
    py: mk(0, 110, 15),
    vx: mk(0, 160, 20),
    vy: mk(0, 160, 20),
    hover: mk(0, 95, 13),
    open: mk(0, 70, 10.5),
    press: mk(0, 600, 40),
    lift: mk(0, 90, 12),
    in: mk(0, 60, 11),
  })
  const frame = React.useRef<GlassFrame>({ px: 0, py: 0, vx: 0, vy: 0, hover: 0, open: 0, press: 0, lift: 0, in: 0 })
  const listeners = React.useRef(new Set<(f: GlassFrame) => void>())
  const onFrame = React.useCallback((cb: (f: GlassFrame) => void) => {
    listeners.current.add(cb)
    return () => {
      listeners.current.delete(cb)
    }
  }, [])

  // the integrator lives inside an effect so it can refer to itself freely;
  // everything else wakes it through `kick`
  const kickRef = React.useRef<() => void>(() => {})
  React.useEffect(() => {
    let raf = 0
    let last = 0
    const reduce = reduceMotion()
    const loop = () => {
      const el = rootRef.current
      if (!el) {
        raf = 0
        return
      }
      const now = performance.now()
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016
      last = now
      const s = springs.current
      let moving = false
      for (const key of Object.keys(s) as (keyof typeof s)[]) {
        if (reduce) {
          s[key].x = s[key].t
          s[key].v = 0
        } else if (tick(s[key], dt)) moving = true
        el.style.setProperty("--go-" + key, s[key].x.toFixed(4))
        frame.current[key] = s[key].x
      }
      listeners.current.forEach((cb) => cb(frame.current))
      raf = moving ? requestAnimationFrame(loop) : 0
      if (!moving) last = 0
    }
    kickRef.current = () => {
      if (!raf) raf = requestAnimationFrame(loop)
    }
    kickRef.current()
    return () => {
      cancelAnimationFrame(raf)
      kickRef.current = () => {}
    }
  }, [])
  const kick = React.useCallback(() => kickRef.current(), [])

  React.useEffect(() => {
    const s = springs.current
    const up = hover || focused
    s.hover.t = up ? 1 : 0
    s.open.t = open ? 1 : 0
    // press goes down hard and comes back with a bounce
    s.press.t = pressed ? 1 : 0
    s.press.k = pressed ? 600 : 260
    s.press.c = pressed ? 40 : 13
    s.lift.t = (up ? hoverLift : 0) + (open ? 0.4 : 0) - (pressed ? 0.12 : 0)
    s.in.t = entered ? 1 : 0
    kick()
  }, [hover, focused, open, pressed, entered, hoverLift, kick])

  // ---- entrance -------------------------------------------------------------
  React.useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === "undefined") {
      setEntered(true)
      return
    }
    let t = 0
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        t = window.setTimeout(() => setEntered(true), appearDelay)
      },
      { threshold: 0.2 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      window.clearTimeout(t)
    }
  }, [appearDelay])

  // ---- pointer --------------------------------------------------------------
  React.useEffect(() => {
    const el = rootRef.current
    if (!el) return
    let lastX = 0
    let lastY = 0
    let lastT = 0
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return
      const r = el.getBoundingClientRect()
      const px = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1))
      const py = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1))
      const s = springs.current
      s.px.t = px
      s.py.t = py
      const now = performance.now()
      if (lastT) {
        const dt = Math.max(8, now - lastT) / 1000
        // velocity in object-widths per second, clamped so a flick reads as a flick
        s.vx.t = Math.max(-6, Math.min(6, (px - lastX) / dt / 2))
        s.vy.t = Math.max(-6, Math.min(6, (py - lastY) / dt / 2))
      }
      lastX = px
      lastY = py
      lastT = now
      kick()
    }
    const enter = (e: PointerEvent) => {
      if (e.pointerType !== "touch") setHover(true)
    }
    const leave = () => {
      setHover(false)
      setPressed(false)
      const s = springs.current
      s.px.t = 0
      s.py.t = 0
      s.vx.t = 0
      s.vy.t = 0
      lastT = 0
      kick()
    }
    const down = (e: PointerEvent) => {
      if (e.button === 0) setPressed(true)
    }
    const up = () => setPressed(false)
    // velocity decays to zero while the pointer rests
    const idle = window.setInterval(() => {
      const s = springs.current
      if ((s.vx.t || s.vy.t) && performance.now() - lastT > 80) {
        s.vx.t = 0
        s.vy.t = 0
        kick()
      }
    }, 80)
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerenter", enter)
    el.addEventListener("pointerleave", leave)
    el.addEventListener("pointerdown", down)
    el.addEventListener("pointerup", up)
    el.addEventListener("pointercancel", up)
    return () => {
      window.clearInterval(idle)
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerenter", enter)
      el.removeEventListener("pointerleave", leave)
      el.removeEventListener("pointerdown", down)
      el.removeEventListener("pointerup", up)
      el.removeEventListener("pointercancel", up)
    }
  }, [kick])

  // ---- Escape and a press outside close it ------------------------------------
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false)
        hitRef.current?.focus()
      }
    }
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onDown)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onDown)
    }
  }, [open, setOpen])

  const value = React.useMemo<GlassState>(
    () => ({ hover, open, pressed, focused, tone, setOpen, activate, rootRef, onFrame, frame }),
    [hover, open, pressed, focused, tone, setOpen, activate, onFrame],
  )

  return (
    <Ctx.Provider value={value}>
      <div
        ref={rootRef}
        className={"go-root" + (className ? " " + className : "")}
        data-tone={tone}
        data-hover={hover || undefined}
        data-open={open || undefined}
        data-entered={entered || undefined}
        data-pivot={pivot}
        style={
          {
            width,
            height,
            "--go-tilt": tilt + "deg",
            "--go-radius": radius + "px",
            "--go-px": 0,
            "--go-py": 0,
            "--go-vx": 0,
            "--go-vy": 0,
            "--go-hover": 0,
            "--go-open": 0,
            "--go-press": 0,
            "--go-lift": 0,
            "--go-in": 0,
            ...style,
          } as React.CSSProperties
        }
      >
        <GlassObjectStyles />
        <button
          ref={hitRef}
          type="button"
          className="go-hit"
          aria-label={label}
          aria-expanded={open}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onClick={() => setOpen(!open)}
          onDoubleClick={() => {
            setOpen(false)
            activate()
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              setOpen(false)
              activate()
            }
          }}
        />
        <div className="go-tilt" style={{ overflow }}>
          <div className="go-shadow go-shadow-contact" aria-hidden="true" />
          <div className="go-shadow go-shadow-ambient" aria-hidden="true" />
          {children}
        </div>
      </div>
    </Ctx.Provider>
  )
}

// ---------------------------------------------------------------------------
// The liquid light: a warped field painted every frame into a small canvas and
// stretched under the glass. It is cheap (a few thousand cells), it pauses
// off-screen, and a touch sends a ripple through it.

export type LiquidRecipe = {
  /** Pale colours, dark to light, that the field moves through. */
  colors: string[]
  /** How fast it flows. 1 is calm. */
  speed?: number
  /** Size of the forms. Lower is larger. */
  scale?: number
  /** Specular gloss, 0–1. */
  gloss?: number
}

export const LIQUIDS: Record<"milk" | "smoke" | "pearl" | "mint" | "rose" | "sky" | "butter" | "brass" | "brassDark", LiquidRecipe> = {
  milk: { colors: ["#e4e5ea", "#f3f3f6", "#ffffff", "#eceef2"], gloss: 0.5 },
  smoke: { colors: ["#17171a", "#26262b", "#3a3a41", "#1d1d21"], gloss: 0.35 },
  pearl: { colors: ["#dfe3ea", "#f6f3f0", "#ffffff", "#e6e1ea"], gloss: 0.6 },
  mint: { colors: ["#d7ebe3", "#eefaf4", "#ffffff", "#dfeee9"], gloss: 0.5 },
  rose: { colors: ["#f0dcdf", "#fbeff0", "#ffffff", "#f3e2e6"], gloss: 0.5 },
  sky: { colors: ["#d9e4f2", "#edf3fb", "#ffffff", "#dde7f3"], gloss: 0.55 },
  butter: { colors: ["#f1e7cf", "#fbf5e6", "#ffffff", "#f3ecd8"], gloss: 0.5 },
  brass: { colors: ["#e9e1d2", "#f6f1e6", "#ffffff", "#efe6d4"], gloss: 0.65, speed: 0.7, scale: 1.2 },
  brassDark: { colors: ["#16140f", "#24201a", "#3a3428", "#1c1915"], gloss: 0.45, speed: 0.7, scale: 1.2 },
}

function hex(c: string): [number, number, number] {
  let h = c.replace("#", "")
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Imperative handle: disturb the liquid from a tick, a shake, a needle drop. */
export type LiquidHandle = {
  /** x, y in 0–1 across the canvas. */
  ripple: (x: number, y: number, strength?: number) => void
  /** Scales the flow speed and ripple decay; 1 is calm, 3 is agitated. Eases back on its own. */
  energy: (e: number) => void
}

export function LiquidCanvas({
  recipe = LIQUIDS.milk,
  seed = 1,
  cells = 72,
  fps = 30,
  energy = 1,
  ref,
  className,
  style,
}: {
  recipe?: LiquidRecipe
  seed?: number
  /** Cells across; rows follow the aspect ratio. */
  cells?: number
  fps?: number
  /** Base energy. */
  energy?: number
  ref?: React.Ref<LiquidHandle>
  className?: string
  style?: React.CSSProperties
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const glass = React.useContext(Ctx)
  const key = JSON.stringify(recipe)
  const handle = React.useRef<LiquidHandle>({ ripple: () => {}, energy: () => {} })
  React.useImperativeHandle(ref, () => ({ ripple: (x, y, s) => handle.current.ripple(x, y, s), energy: (e) => handle.current.energy(e) }), [])

  React.useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const r = JSON.parse(key) as LiquidRecipe
    const speed = r.speed ?? 1
    const scale = r.scale ?? 1
    const gloss = r.gloss ?? 0.5
    const stops = r.colors.map(hex)
    const reduce = reduceMotion()
    const box = c.getBoundingClientRect()
    const aspect = box.width && box.height ? box.height / box.width : 0.75
    const W = cells
    const H = Math.max(8, Math.round(cells * aspect))
    c.width = W
    c.height = H
    const ctx = c.getContext("2d")
    if (!ctx) return
    const img = ctx.createImageData(W, H)
    const d = img.data
    const o1 = seed * 1.7
    const o2 = seed * 0.9
    // the ripple: where the liquid was last touched, and how strongly
    let rx = 0.5
    let ry = 0.5
    let ripple = 0
    let lx = 0
    let ly = 0
    let en = energy
    let enTarget = energy
    let flow = 0
    const root = glass?.rootRef.current
    const onMove = (e: PointerEvent) => {
      const b = c.getBoundingClientRect()
      rx = (e.clientX - b.left) / b.width
      ry = (e.clientY - b.top) / b.height
      ripple = Math.min(1, ripple + 0.08)
    }
    const onDown = () => {
      ripple = 1.4
    }
    handle.current = {
      ripple: (x, y, s = 1) => {
        rx = x
        ry = y
        ripple = Math.min(2, ripple + s)
        if (!raf && visible) raf = requestAnimationFrame(frame)
      },
      energy: (e) => {
        enTarget = e
        if (!raf && visible) raf = requestAnimationFrame(frame)
      },
    }
    const host = root ?? c.parentElement
    host?.addEventListener("pointermove", onMove)
    host?.addEventListener("pointerdown", onDown)

    let raf = 0
    let last = 0
    let visible = true
    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((es) => {
            visible = es.some((e) => e.isIntersecting)
            if (visible && !raf) raf = requestAnimationFrame(frame)
          })
        : null
    io?.observe(c)

    const paint = (t: number) => {
      if (glass) {
        lx = glass.frame.current.px
        ly = glass.frame.current.py
      }
      const n = stops.length - 1
      for (let y = 0; y < H; y++) {
        const v = (y / H) * 2 - 1
        for (let x = 0; x < W; x++) {
          const u = ((x / W) * 2 - 1) / aspect
          // a plasma, warped by itself twice: cheap, and it reads as liquid
          const a = Math.sin(u * 1.9 * scale + t * 0.6 + o1 + Math.sin(v * 1.6 * scale - t * 0.45 + o2) * 1.3)
          const b = Math.sin((u * 0.8 + v * 1.4) * scale - t * 0.5 + a * 1.1)
          const dx = x / W - rx
          const dy = y / H - ry
          const dist = Math.sqrt(dx * dx + dy * dy)
          const rip = ripple > 0.001 ? Math.sin(dist * 26 - t * 7) * Math.exp(-dist * 4) * ripple * 0.9 : 0
          // the light leans toward the cursor
          const light = (u - lx * 1.2) * 0.35 + (v - ly * 1.2) * 0.35
          let f = (a + b + rip) * 0.25 + 0.5 - light * 0.18
          f = f < 0 ? 0 : f > 1 ? 1 : f
          const p = f * n
          const i = Math.min(n - 1, Math.floor(p))
          const k = p - i
          const s0 = stops[i]
          const s1 = stops[i + 1]
          const spec = Math.pow(Math.max(0, Math.sin(f * Math.PI)), 14) * gloss * 70
          const j = (y * W + x) * 4
          d[j] = s0[0] + (s1[0] - s0[0]) * k + spec
          d[j + 1] = s0[1] + (s1[1] - s0[1]) * k + spec
          d[j + 2] = s0[2] + (s1[2] - s0[2]) * k + spec
          d[j + 3] = 255
        }
      }
      ctx.putImageData(img, 0, 0)
    }

    const frame = (now: number) => {
      raf = 0
      if (!visible || document.hidden) return
      if (now - last >= 1000 / fps) {
        const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / fps
        last = now
        ripple *= 0.94
        en += (enTarget - en) * 0.08
        if (enTarget > energy) enTarget += (energy - enTarget) * 0.02
        flow += dt * speed * en
        paint(flow + seed)
      }
      if (!reduce) raf = requestAnimationFrame(frame)
    }
    paint(seed)
    if (!reduce) raf = requestAnimationFrame(frame)
    const onVis = () => {
      if (!document.hidden && !raf) raf = requestAnimationFrame(frame)
    }
    document.addEventListener("visibilitychange", onVis)
    return () => {
      cancelAnimationFrame(raf)
      io?.disconnect()
      document.removeEventListener("visibilitychange", onVis)
      host?.removeEventListener("pointermove", onMove)
      host?.removeEventListener("pointerdown", onDown)
      handle.current = { ripple: () => {}, energy: () => {} }
    }
  }, [key, seed, cells, fps, energy, glass])

  return <canvas ref={canvasRef} aria-hidden="true" className={"go-liquid" + (className ? " " + className : "")} style={style} />
}

// ---------------------------------------------------------------------------
// The frosted pane

export type GlassPaneProps = {
  /** Which edge it is hinged on. `none` makes it a flat sheet. */
  hinge?: "bottom" | "top" | "left" | "right" | "none"
  /** Degrees it leans on hover. Negative brings the free edge toward you. */
  lean?: number
  /** Degrees it leans when open. */
  openLean?: number
  /** Pixels it rises (negative) or sinks when open. */
  openShift?: number
  /** Fade it out when open, 0–1 of its opacity to remove. */
  openFade?: number
  /** Pixels it rises on hover, straight up. */
  lift?: number
  /**
   * Which CSS variables drive the hover and open motion. Defaults to the
   * engine's `--go-hover` and `--go-open`; a widget with its own spring
   * (a dome, a cover) names it here, e.g. `{ open: "--dome" }`.
   */
  drive?: { hover?: string; open?: string }
  /** Corner radius, or any CSS border-radius value such as `68px 68px 12px 12px`. */
  radius?: number | string
  /** A clip-path for shapes that are not rounded rectangles. */
  shape?: string
  /** Thickness of the frost, 0–1, or a CSS variable such as `var(--frost)`. */
  frost?: number | string
  /** Clear glass: no white fade, just rim, refraction and a highlight. For domes and globes. */
  clear?: boolean
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
}

export function GlassPane({
  hinge = "bottom",
  lean = -9,
  openLean = -22,
  openShift = 0,
  openFade = 0,
  lift = 0,
  drive,
  radius = 20,
  shape,
  frost = 1,
  clear = false,
  className,
  style,
  children,
}: GlassPaneProps) {
  const hv = `var(${drive?.hover ?? "--go-hover"})`
  const op = `var(${drive?.open ?? "--go-open"})`
  const origin = { bottom: "50% 100%", top: "50% 0%", left: "0% 50%", right: "100% 50%", none: "50% 50%" }[hinge]
  const axis = hinge === "left" || hinge === "right" ? "rotateY" : "rotateX"
  const sign = hinge === "top" || hinge === "left" ? -1 : 1
  const shift = `translateY(calc(${op} * ${openShift}px - ${hv} * ${lift}px))`
  const transform =
    hinge === "none" ? shift : `perspective(900px) ${axis}(calc(${hv} * ${lean * sign}deg + ${op} * ${openLean * sign}deg)) ${shift}`
  return (
    <div
      className={"go-pane" + (clear ? " go-pane--clear" : "") + (className ? " " + className : "")}
      style={
        {
          "--pane-radius": typeof radius === "number" ? radius + "px" : radius,
          "--pane-frost": frost,
          clipPath: shape,
          transformOrigin: origin,
          transform,
          opacity: openFade ? `calc(1 - ${op} * ${openFade})` : undefined,
          ...style,
        } as React.CSSProperties
      }
    >
      <div className="go-pane-tint" aria-hidden="true" />
      <div className="go-pane-spec" aria-hidden="true" />
      <div className="go-pane-rim" aria-hidden="true" />
      <div className="go-pane-body">{children}</div>
    </div>
  )
}

/** A white sheet, like a file: for cards that rise out of a pocket. */
export function GlassSheet({ className, style, children }: { className?: string; style?: React.CSSProperties; children?: React.ReactNode }) {
  return (
    <div className={"go-sheet" + (className ? " " + className : "")} style={style}>
      {children}
    </div>
  )
}

const GO_CSS = `
.go-root {
  position: relative;
  display: inline-block;
  flex: none;
  vertical-align: top;
  --go-ink: #141416;
  --go-ink-soft: rgba(20, 20, 22, .55);
  --go-ink-faint: rgba(20, 20, 22, .1);
  --go-glass: 255, 255, 255;
  --go-shadow: rgba(16, 18, 24, .3);
  color: var(--go-ink);
  font-family: ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
  isolation: isolate;
  opacity: calc(var(--go-in) * 1);
  translate: 0 calc((1 - var(--go-in)) * 26px);
}
.go-root[data-tone="dark"] {
  --go-ink: #f5f5f7;
  --go-ink-soft: rgba(245, 245, 247, .58);
  --go-ink-faint: rgba(245, 245, 247, .12);
  --go-glass: 24, 24, 28;
  --go-shadow: rgba(0, 0, 0, .6);
}
.go-hit {
  all: unset;
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: var(--go-radius);
  cursor: pointer;
}
.go-hit:focus-visible { outline: 2px solid #4c8dff; outline-offset: 4px; }
.go-tilt {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  border-radius: var(--go-radius);
  transform-origin: 50% 50%;
  transform:
    perspective(1200px)
    translateY(calc(var(--go-lift) * -6px))
    rotateX(calc(var(--go-py) * var(--go-tilt) * -1 * var(--go-hover)))
    rotateY(calc(var(--go-px) * var(--go-tilt) * var(--go-hover)))
    scale(calc(1 + var(--go-hover) * .018 - var(--go-press) * .012), calc(1 + var(--go-hover) * .018 - var(--go-press) * .03));
}
.go-root[data-pivot="base"] .go-tilt {
  transform-origin: 50% 100%;
  transform:
    perspective(1200px)
    translateY(calc(var(--go-lift) * -6px))
    rotateX(calc(var(--go-py) * var(--go-tilt) * -.6 * var(--go-hover) - var(--go-hover) * 2deg))
    rotateY(calc(var(--go-px) * var(--go-tilt) * var(--go-hover)))
    scale(calc(1 + var(--go-hover) * .012 - var(--go-press) * .012), calc(1 + var(--go-hover) * .012 - var(--go-press) * .03));
}
.go-tilt .go-live { pointer-events: auto; }
.go-shadow {
  position: absolute;
  left: 8%;
  right: 8%;
  bottom: -4px;
  height: 40%;
  border-radius: 50%;
  background: var(--go-shadow);
}
/* a sharp contact shadow that fades as the object lifts */
.go-shadow-contact {
  left: 4%; right: 4%; bottom: -2px; height: 18%;
  filter: blur(6px);
  opacity: calc(.5 - var(--go-lift) * .6);
}
/* a soft ambient shadow that falls further and spreads as the object lifts */
.go-shadow-ambient {
  filter: blur(calc(22px + var(--go-lift) * 14px));
  opacity: calc(.45 + var(--go-lift) * .3);
  transform: translate(calc(var(--go-px) * -8px), calc(4px + var(--go-lift) * 10px)) scale(calc(1 + var(--go-lift) * .08));
}
.go-liquid {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  image-rendering: auto;
}

.go-pane {
  position: absolute;
  inset: 0;
  border-radius: var(--pane-radius);
  -webkit-backdrop-filter: blur(calc(14px * var(--pane-frost))) saturate(1.5);
  backdrop-filter: blur(calc(14px * var(--pane-frost))) saturate(1.5);
  box-shadow: 0 0 0 .5px rgba(0, 0, 0, .1), 0 14px 30px -14px var(--go-shadow);
}
.go-root[data-tone="dark"] .go-pane { box-shadow: 0 0 0 .5px rgba(255, 255, 255, .12), 0 14px 30px -14px var(--go-shadow); }
.go-pane-tint {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(var(--go-glass), calc(.26 * var(--pane-frost))) 0%, rgba(var(--go-glass), calc(.62 * var(--pane-frost))) 48%, rgba(var(--go-glass), calc(.9 * var(--pane-frost))) 100%);
}
.go-pane-spec {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(70% 60% at calc(50% + var(--go-px) * 40%) calc(28% + var(--go-py) * 36%), rgba(255, 255, 255, calc(.55 + var(--go-hover) * .2)), rgba(255, 255, 255, 0) 70%);
  mix-blend-mode: soft-light;
}
.go-root[data-tone="dark"] .go-pane-spec { mix-blend-mode: screen; opacity: .22; }
.go-pane-rim {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(180deg, rgba(255, 255, 255, .95), rgba(255, 255, 255, .35) 35%, rgba(255, 255, 255, .12));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: calc(.8 + var(--go-hover) * .2);
}
.go-root[data-tone="dark"] .go-pane-rim { opacity: calc(.4 + var(--go-hover) * .2); }
.go-pane-body { position: absolute; inset: 0; border-radius: inherit; }

/* clear glass: a dome, a globe, a dust cover */
.go-pane--clear { box-shadow: inset 0 0 0 1px rgba(255,255,255,.7), inset 0 -10px 18px rgba(255,255,255,.3), inset 0 10px 24px rgba(255,255,255,.12), 0 0 0 .5px rgba(0,0,0,.08), 0 14px 30px -14px var(--go-shadow); }
.go-pane--clear .go-pane-tint {
  background:
    radial-gradient(60% 40% at calc(35% + var(--go-px) * 10%) calc(28% + var(--go-py) * 8%), rgba(255,255,255,.55), rgba(255,255,255,0) 70%),
    linear-gradient(100deg, rgba(255,255,255,0) 18%, rgba(255,255,255,.28) 22%, rgba(255,255,255,0) 30%, rgba(255,255,255,0) 74%, rgba(255,255,255,.5) 78%, rgba(255,255,255,0) 80%),
    linear-gradient(180deg, rgba(var(--go-glass), calc(.08 * var(--pane-frost))), rgba(var(--go-glass), calc(.22 * var(--pane-frost))));
  background-position: 0 0, calc(var(--go-px) * -10px) 0, 0 0;
}
.go-pane--clear .go-pane-rim { opacity: calc(.95 + var(--go-hover) * .05); }
.go-root[data-tone="dark"] .go-pane--clear { box-shadow: inset 0 0 0 1px rgba(255,255,255,.28), inset 0 -10px 18px rgba(255,255,255,.08), 0 0 0 .5px rgba(255,255,255,.1), 0 14px 30px -14px var(--go-shadow); }

.go-sheet {
  position: absolute;
  box-sizing: border-box;
  border-radius: 14px;
  overflow: hidden;
  background: linear-gradient(180deg, #ffffff 0%, #f2f2f0 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .9), 0 0 0 .5px rgba(0, 0, 0, .1), 0 10px 26px -8px rgba(10, 12, 20, .28);
}
.go-root[data-tone="dark"] .go-sheet {
  background: linear-gradient(180deg, #2c2c30 0%, #1c1c1f 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .14), 0 0 0 .5px rgba(255, 255, 255, .08), 0 12px 28px -8px rgba(0, 0, 0, .7);
}
.go-mono { font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .03em; }
.go-soft { color: var(--go-ink-soft); }
`

/**
 * The engine's stylesheet, hoisted once. Render it before any chrome or
 * widget styles (the desk does this at the top of the scene) so that widget
 * rules of equal specificity always win over the engine's defaults.
 */
export function GlassObjectStyles() {
  return (
    <style href="glass-object" precedence="glass-engine">
      {GO_CSS}
    </style>
  )
}
