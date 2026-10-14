"use client"

import * as React from "react"
import { GlassObject, GlassPane, LIQUIDS, LiquidCanvas, useGlass, useSpringVar } from "@/components/ui/glass-object"
import { WIDGET, type WidgetSize } from "../glass"
import { APPS } from "@/lib/apps"
import { useWindowManager } from "../window-manager"

/**
 * Clock — at rest, the macOS Sonoma Clock widget: a frosted white card with
 * clean analog faces and their captions. Its motion happens inside the card,
 * in the clock itself; the card never changes size or shape and nothing
 * leaves it.
 *
 * - **Rest**: second hands sweep.
 * - **Hover**: the hour and minute hands lift off the dial — up a pixel, a
 *   drop shadow growing under them — and a soft sheen crosses the dial glass
 *   with the pointer. Nothing else moves.
 * - **Click, small**: a world-time watch. Each click advances the ring
 *   Cupertino → New York → London → Tokyo → Cupertino; the hands sweep to the
 *   new city's time on springs (the minute hand the long way round), the dial
 *   crossfades between day and night, and the caption slides over within its
 *   own line. Four dots under it show where in the ring you are. Escape (or a
 *   press elsewhere) returns home.
 * - **Click, medium / large**: the face you click lifts 2px and the caption
 *   under it turns into a seconds-precise time and that city's date for 4s.
 * - **Activate** (double-click, Enter): the Clock app.
 *
 * Every motion is a spring integrated on rAF and written by ref or as a CSS
 * variable; nothing re-renders per frame.
 */

type City = { name: string; code: string; zone: string }
const HOME: City = { name: "Cupertino", code: "CUP", zone: "America/Los_Angeles" }
const ALL: City[] = [
  HOME,
  { name: "New York", code: "NYC", zone: "America/New_York" },
  { name: "London", code: "LON", zone: "Europe/London" },
  { name: "Tokyo", code: "TYO", zone: "Asia/Tokyo" },
]

const reduceMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

// ---------------------------------------------------------------------------
// Time

/** Minutes east of UTC for a zone, right now. */
function zoneOffset(zone: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at))
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"))
  return Math.round((asUtc - at) / 60000)
}

/** "Tomorrow, +16HRS", relative to home, as the macOS widget writes it. */
function offsetLabel(zone: string, at: number): string {
  const d = (zoneOffset(zone, at) - zoneOffset(HOME.zone, at)) / 60
  const hrs = (d >= 0 ? "+" : "") + (Number.isInteger(d) ? d : d.toFixed(1)) + "HRS"
  const ymd = (z: string) => new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at))
  const a = ymd(zone)
  const b = ymd(HOME.zone)
  return (a === b ? "Today" : a > b ? "Tomorrow" : "Yesterday") + ", " + hrs
}

/** Is it night (before 6 or after 18) in that zone? */
function isNight(zone: string, at: number): boolean {
  const h = Math.floor((((at + zoneOffset(zone, at) * 60000) % 86400000) + 86400000) % 86400000 / 3600000)
  return h < 6 || h >= 18
}

/** A spring step for hand-rolled springs: mass 1, returns the new [x, v]. */
function step(x: number, v: number, target: number, k: number, c: number, dt: number): [number, number] {
  const a = -k * (x - target) - c * v
  const nv = v + a * dt
  return [x + nv * dt, nv]
}

// ---------------------------------------------------------------------------
// The face

/**
 * An analog face. The hands are turned by requestAnimationFrame straight on
 * the DOM. When `zone` changes the hands do not jump: each carries a sprung
 * displacement from the true time that decays to zero, so they sweep there —
 * hour k=40 c=11, minute k=60 c=12 with a full extra turn. `dir` 1 travels
 * forward (round the world eastward), 0 the short way back. Day and night are
 * a `--n` spring the dial's colours are mixed from.
 */
function Face({ zone, size, dir = 1 }: { zone: string; size: number; dir?: 0 | 1 }) {
  const h = React.useRef<SVGGElement>(null)
  const m = React.useRef<SVGGElement>(null)
  const s = React.useRef<SVGGElement>(null)
  const root = React.useRef<SVGSVGElement>(null)
  const st = React.useRef({ zone: "", off: 0, dH: 0, vH: 0, dM: 0, vM: 0, n: 0, vn: 0, nT: 0, ready: false })

  // a new city: carry the hands' current positions over as a displacement to spring away
  React.useEffect(() => {
    const p = st.current
    const now = Date.now()
    const off = zoneOffset(zone, now)
    if (p.ready && p.zone !== zone) {
      const dh = (off - p.off) / 60
      if (dh !== 0) {
        let travelH: number
        let travelM: number
        if (dir === 1) {
          travelH = (((dh * 30) % 360) + 360) % 360
          travelM = ((((dh * 360) % 360) + 360) % 360) + 360
        } else {
          travelH = ((((dh * 30) % 360) + 540) % 360) - 180
          travelM = ((((dh * 360) % 360) + 540) % 360) - 180 + (travelH >= 0 ? 360 : -360)
        }
        p.dH -= travelH
        p.dM -= travelM
      }
    }
    p.zone = zone
    p.off = off
    p.nT = isNight(zone, now) ? 1 : 0
    if (!p.ready) {
      p.n = p.nT
      p.ready = true
    }
  }, [zone, dir])

  React.useEffect(() => {
    let raf = 0
    let last = 0
    let lastOff = Date.now()
    const reduce = reduceMotion()
    const p = st.current
    const frame = (t: number) => {
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016
      last = t
      const now = Date.now()
      if (now - lastOff > 60000) {
        p.off = zoneOffset(p.zone, now)
        p.nT = isNight(p.zone, now) ? 1 : 0
        lastOff = now
      }
      if (reduce) {
        p.dH = p.dM = 0
        p.n = p.nT
      } else {
        ;[p.dH, p.vH] = step(p.dH, p.vH, 0, 40, 11, dt)
        ;[p.dM, p.vM] = step(p.dM, p.vM, 0, 60, 12, dt)
        ;[p.n, p.vn] = step(p.n, p.vn, p.nT, 60, 14, dt)
      }
      const ms = (((now + p.off * 60000) % 86400000) + 86400000) % 86400000
      const sec = reduce ? Math.floor(ms / 1000) : ms / 1000
      const min = sec / 60
      const hr = min / 60
      h.current?.setAttribute("transform", `rotate(${((hr % 12) * 30 + p.dH).toFixed(3)})`)
      m.current?.setAttribute("transform", `rotate(${((min % 60) * 6 + p.dM).toFixed(3)})`)
      s.current?.setAttribute("transform", `rotate(${((sec % 60) * 6).toFixed(3)})`)
      root.current?.style.setProperty("--n", Math.max(0, Math.min(1, p.n)).toFixed(4))
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const r = 50
  return (
    <svg ref={root} viewBox="-51 -51 102 102" width={size} height={size} className="ck-face" style={{ "--n": 0 } as React.CSSProperties} aria-hidden="true">
      <circle r={r} className="ck-dial" />
      {Array.from({ length: 60 }, (_, i) => (
        <line key={i} x1="0" y1={-r + 2.5} x2="0" y2={i % 5 ? -r + 4.6 : -r + 6.5} transform={`rotate(${i * 6})`} className={i % 5 ? "ck-tick" : "ck-tick ck-tick-h"} />
      ))}
      {Array.from({ length: 12 }, (_, i) => {
        const a = ((i + 1) * 30 * Math.PI) / 180
        // rounded, so server and browser agree to the last digit
        const x = Math.round(Math.sin(a) * 3700) / 100
        const y = Math.round((-Math.cos(a) * 37 + 5) * 100) / 100
        return (
          <text key={i} x={x} y={y} className="ck-num" textAnchor="middle">
            {i + 1}
          </text>
        )
      })}
      {/* hour and minute hands lift off the dial together on hover */}
      <g className="ck-hands">
        {/* gives the group a real bounding box, so the shadow has room even when both hands are vertical */}
        <circle r="46" fill="none" />
        <g ref={h}>
          <line x1="0" y1="5" x2="0" y2="-25" className="ck-hand ck-hour" />
        </g>
        <g ref={m}>
          <line x1="0" y1="5" x2="0" y2="-40" className="ck-hand ck-minute" />
        </g>
      </g>
      <g ref={s}>
        <line x1="0" y1="10" x2="0" y2="-43" className="ck-second" />
        <circle r="2.4" className="ck-cap" />
        <circle r=".9" className="ck-cap-dot" />
      </g>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Text written by ref

function Digital({ zone, seconds, className }: { zone: string; seconds?: boolean; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    const fmt = new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit", second: seconds ? "2-digit" : undefined })
    const write = () => {
      if (ref.current) ref.current.textContent = fmt.format(new Date())
    }
    write()
    const t = window.setInterval(write, seconds ? 200 : 1000)
    return () => window.clearInterval(t)
  }, [zone, seconds])
  return <span ref={ref} className={className} />
}

function Offset({ zone, className }: { zone: string; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    const write = () => {
      if (ref.current) ref.current.textContent = offsetLabel(zone, Date.now())
    }
    write()
    const t = window.setInterval(write, 30000)
    return () => window.clearInterval(t)
  }, [zone])
  return <span ref={ref} className={className} />
}

function DateLine({ zone, className }: { zone: string; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    const fmt = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: "short", month: "short", day: "numeric" })
    const write = () => {
      if (ref.current) ref.current.textContent = fmt.format(new Date())
    }
    write()
    const t = window.setInterval(write, 30000)
    return () => window.clearInterval(t)
  }, [zone])
  return <span ref={ref} className={className} />
}

/**
 * A line of text that changes in place: the old content slides 6px up and out
 * while the new slides up into the line, on a spring (k=170 c=22). Both
 * layers share one grid cell, so the line never changes size.
 */
function Swap({ value, render, className }: { value: string; render: (v: string) => React.ReactNode; className?: string }) {
  const [pair, setPair] = React.useState({ prev: value, cur: value })
  if (pair.cur !== value) setPair({ prev: pair.cur, cur: value })
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el || pair.prev === pair.cur) return
    if (reduceMotion()) {
      el.style.setProperty("--sw", "1")
      return
    }
    let x = 0
    let v = 0
    let last = 0
    let raf = 0
    el.style.setProperty("--sw", "0")
    const frame = (t: number) => {
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016
      last = t
      ;[x, v] = step(x, v, 1, 170, 22, dt)
      const done = Math.abs(1 - x) < 0.001 && Math.abs(v) < 0.001
      el.style.setProperty("--sw", (done ? 1 : x).toFixed(4))
      raf = done ? 0 : requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      el.style.setProperty("--sw", "1")
    }
  }, [pair])
  return (
    <span ref={ref} className={"ck-swap" + (className ? " " + className : "")} style={{ "--sw": 1 } as React.CSSProperties}>
      <span key={"o" + pair.prev} className="ck-swap-old" aria-hidden="true">
        {render(pair.prev)}
      </span>
      <span key={"n" + pair.cur} className="ck-swap-new">
        {render(pair.cur)}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Layout

type Slot = { x: number; y: number; size: number }

/** Face positions (top-left and size) per widget size; captions hang off these. */
const SLOTS: Record<WidgetSize, Slot[]> = {
  small: [{ x: 33, y: 29, size: 104 }],
  medium: ALL.map((_, i) => ({ x: Math.round(45.5 + 91 * i - 39), y: 18, size: 78 })),
  large: ALL.map((_, i) => ({ x: (i % 2 ? 273 : 91) - 60, y: (i < 2 ? 0 : 182) + 10, size: 120 })),
}

/** One face on the card, with the dial glass's sheen over it. `--lift` raises it (medium/large click). */
function FaceSlot({ slot, i, zone, dir }: { slot: Slot; i: number; zone: string; dir?: 0 | 1 }) {
  return (
    <div className="ck-fw" style={{ left: slot.x, top: slot.y, width: slot.size, height: slot.size, "--lift": `var(--lift-${i})` } as React.CSSProperties}>
      <i className="ck-fshadow" />
      <Face zone={zone} size={slot.size} dir={dir} />
      <i className="ck-sheen" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The mechanism

export type ClockHandlers = { click: () => void; reset: () => void }

function ClockBody({ size, handlersRef }: { size: WidgetSize; handlersRef: React.RefObject<ClockHandlers> }) {
  const { tone, rootRef } = useGlass()
  const slots = SLOTS[size]
  const small = size === "small"

  // small: where in the ring of cities the watch is, and which way the hands should travel
  const [ring, setRing] = React.useState<{ i: number; dir: 0 | 1 }>({ i: 0, dir: 1 })
  // medium / large: the face that was clicked, showing seconds and date
  const [active, setActive] = React.useState<number | null>(null)

  const ringSpring = useSpringVar(rootRef, "--ring", 0, 200, 22)
  const lift0 = useSpringVar(rootRef, "--lift-0", 0, 300, 20)
  const lift1 = useSpringVar(rootRef, "--lift-1", 0, 300, 20)
  const lift2 = useSpringVar(rootRef, "--lift-2", 0, 300, 20)
  const lift3 = useSpringVar(rootRef, "--lift-3", 0, 300, 20)

  React.useEffect(() => ringSpring(ring.i), [ring.i, ringSpring])
  React.useEffect(() => {
    const lifts = [lift0, lift1, lift2, lift3]
    // up briskly with a hair of overshoot; back down softly
    lifts.forEach((l, i) => l(active === i ? 1 : 0, active === i ? { k: 300, c: 20 } : { k: 160, c: 20 }))
    if (active === null) return
    const t = window.setTimeout(() => setActive(null), 4000)
    return () => window.clearTimeout(t)
  }, [active, lift0, lift1, lift2, lift3])

  // where the last press landed, to know which face a click meant
  const pointer = React.useRef<{ x: number; y: number } | null>(null)
  React.useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const down = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      pointer.current = { x: ((e.clientX - r.left) / r.width) * WIDGET[size].w, y: ((e.clientY - r.top) / r.height) * WIDGET[size].h }
    }
    el.addEventListener("pointerdown", down)
    return () => el.removeEventListener("pointerdown", down)
  }, [rootRef, size])

  React.useEffect(() => {
    handlersRef.current = {
      click: () => {
        if (small) {
          setRing((r) => ({ i: (r.i + 1) % ALL.length, dir: 1 }))
          return
        }
        const p = pointer.current
        let best = 0
        if (p) {
          let bd = Infinity
          slots.forEach((s, i) => {
            const d = Math.hypot(s.x + s.size / 2 - p.x, s.y + s.size / 2 - p.y)
            if (d < bd) {
              bd = d
              best = i
            }
          })
        }
        pointer.current = null
        setActive((a) => (a === best ? null : best))
      },
      reset: () => {
        setRing((r) => (r.i === 0 ? r : { i: 0, dir: 0 }))
        setActive(null)
      },
    }
    return () => {
      handlersRef.current = { click: () => {}, reset: () => {} }
    }
  }, [handlersRef, small, slots])

  // Escape, or a press elsewhere, takes the watch home
  const away = small ? ring.i !== 0 : active !== null
  React.useEffect(() => {
    if (!away) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handlersRef.current.reset()
    }
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) handlersRef.current.reset()
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onDown)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onDown)
    }
  }, [away, handlersRef, rootRef])

  const city = ALL[ring.i]

  return (
    <>
      <LiquidCanvas recipe={tone === "dark" ? LIQUIDS.smoke : LIQUIDS.pearl} seed={small ? 2 : size === "medium" ? 5 : 7} cells={small ? 72 : 120} />
      <div className="ck-back" aria-hidden="true" />

      {/* the card: one flat frosted pane with the captions on it */}
      <GlassPane hinge="none" frost={0.9} radius={22} className="ck-pane">
        {small ? (
          <>
            <Swap className="ck-s-city" value={String(ring.i)} render={(v) => <span className="ck-city">{ALL[+v].name}</span>} />
            <Swap
              className="ck-s-foot"
              value={String(ring.i)}
              render={(v) => (
                <span className="ck-s-row">
                  <Offset zone={ALL[+v].zone} className="ck-off go-soft" />
                  <Digital zone={ALL[+v].zone} className="ck-time go-mono" />
                </span>
              )}
            />
            <span className="ck-ring" aria-hidden="true">
              {ALL.map((c, i) => (
                <i key={c.code} className="ck-dot" style={{ "--i": i } as React.CSSProperties} />
              ))}
            </span>
          </>
        ) : (
          ALL.map((c, i) => {
            const s = slots[i]
            return (
              <span key={c.code} className="ck-cap-col" style={{ left: s.x + s.size / 2, top: s.y + s.size + (size === "large" ? 4 : 6) }}>
                <span className="ck-city">{c.name}</span>
                <Swap
                  className="ck-cap-swap"
                  value={active === i ? "detail" : "plain"}
                  render={(v) =>
                    v === "detail" ? (
                      <span className="ck-cap-lines">
                        <DateLine zone={c.zone} className="ck-off go-soft" />
                        <Digital zone={c.zone} seconds className="ck-time go-mono" />
                      </span>
                    ) : (
                      <span className="ck-cap-lines">
                        <Offset zone={c.zone} className="ck-off go-soft" />
                        <Digital zone={c.zone} className="ck-time go-mono" />
                      </span>
                    )
                  }
                />
              </span>
            )
          })
        )}
      </GlassPane>

      {/* the faces, on the card */}
      {small ? <FaceSlot slot={slots[0]} i={0} zone={city.zone} dir={ring.dir} /> : ALL.map((c, i) => <FaceSlot key={c.code} slot={slots[i]} i={i} zone={c.zone} />)}
      {small ? (
        <span className="ck-live" aria-live="polite">
          {ring.i ? city.name : ""}
        </span>
      ) : null}
    </>
  )
}

export function ClockWidget({ size = "small", className, appearDelay = 0 }: { size?: WidgetSize; className?: string; appearDelay?: number }) {
  const { open, tone } = useWindowManager()
  const { w, h } = WIDGET[size]
  const handlersRef = React.useRef<ClockHandlers>({ click: () => {}, reset: () => {} })
  return (
    <GlassObject
      width={w}
      height={h}
      tone={tone}
      label="Clock"
      radius={22}
      tilt={2}
      hoverLift={0}
      // the card never opens outward; a click (which asks to open) operates the clock instead
      open={false}
      onOpenChange={(next) => {
        if (next) handlersRef.current.click()
      }}
      appearDelay={appearDelay}
      className={"ck-root ck-" + size + (className ? " " + className : "")}
      onActivate={() => {
        handlersRef.current.reset()
        open("clock", { singleton: "app", title: APPS.clock.name, w: APPS.clock.defaultSize.w, h: APPS.clock.defaultSize.h })
      }}
    >
      <style href="clock-object" precedence="glass-widget">
        {CK_CSS}
      </style>
      <ClockBody key={size} size={size} handlersRef={handlersRef} />
    </GlassObject>
  )
}

const CK_CSS = `
.ck-root { --ring: 0; --lift-0: 0; --lift-1: 0; --lift-2: 0; --lift-3: 0; }
.ck-root .go-tilt { border-radius: 22px; }
.ck-root .go-liquid { border-radius: 22px; }
.ck-back { position: absolute; inset: 0; border-radius: 22px; pointer-events: none; box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 .5px rgba(0,0,0,.08); }
.ck-root[data-tone="dark"] .ck-back { box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 0 0 .5px rgba(255,255,255,.1); }

/* the card: frosted almost to white, like the Sonoma widget. It frosts our own
   (already soft) liquid, so the tint carries the frost and no backdrop filter is needed. */
.ck-root .ck-pane { -webkit-backdrop-filter: none; backdrop-filter: none; }
.ck-root:not([data-tone="dark"]) .ck-pane .go-pane-tint { background: linear-gradient(180deg, rgba(255,255,255,.86), rgba(255,255,255,.93)); }
.ck-root[data-tone="dark"] .ck-pane .go-pane-tint { background: linear-gradient(180deg, rgba(34,34,38,.86), rgba(26,26,30,.92)); }

/* captions, macOS type: 13 / 11 / 10, tight tracking, tabular figures */
.ck-city { font-size: 13px; font-weight: 600; letter-spacing: -.01em; line-height: 16px; white-space: nowrap; }
.ck-off { font-size: 11px; letter-spacing: -.005em; line-height: 13px; white-space: nowrap; }
.ck-time { font-size: 11px; line-height: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; letter-spacing: 0; }
.ck-s-city { position: absolute; left: 14px; top: 10px; }
.ck-s-foot { position: absolute; left: 14px; right: 14px; bottom: 16px; }
.ck-s-row { display: flex; justify-content: space-between; align-items: baseline; }
.ck-cap-col { position: absolute; display: flex; flex-direction: column; align-items: center; transform: translateX(-50%); }
.ck-cap-lines { display: flex; flex-direction: column; align-items: center; }
.ck-medium .ck-city { font-size: 12px; line-height: 15px; }
.ck-medium .ck-off, .ck-medium .ck-time { font-size: 10px; line-height: 12px; }
.ck-large .ck-off { font-size: 10.5px; }

/* a line that changes in place: old slides up and out, new slides up in */
.ck-swap { display: grid; }
.ck-swap > * { grid-area: 1 / 1; }
.ck-swap-old { opacity: calc(1 - var(--sw)); transform: translateY(calc(var(--sw) * -6px)); }
.ck-swap-new { opacity: var(--sw); transform: translateY(calc((1 - var(--sw)) * 6px)); }
.ck-swap-old:only-child { opacity: 1; transform: none; }
.ck-cap-swap { justify-items: center; }

/* the ring of four cities */
.ck-ring { position: absolute; left: 0; right: 0; bottom: 7px; display: flex; justify-content: center; gap: 4px; }
.ck-dot {
  --on: max(0, 1 - max(var(--ring) - var(--i), var(--i) - var(--ring)));
  display: block; width: 4px; height: 4px; border-radius: 50%;
  background: var(--go-ink);
  opacity: calc(.18 + var(--on) * .67);
  transform: scale(calc(.85 + var(--on) * .25));
}
.ck-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }

/* a face: sits on the card; a medium/large click lifts it 2px */
.ck-fw { position: absolute; transform: translateY(calc(var(--lift) * -2px)); }
.ck-fshadow {
  position: absolute; inset: 0; display: block; border-radius: 50%;
  box-shadow: 0 calc(2px + var(--lift) * 3px) calc(5px + var(--lift) * 5px) rgba(16,18,24,calc(.14 + var(--lift) * .06));
}
.ck-root[data-tone="dark"] .ck-fshadow { box-shadow: 0 calc(2px + var(--lift) * 3px) calc(5px + var(--lift) * 5px) rgba(0,0,0,calc(.4 + var(--lift) * .1)); }
.ck-face { position: relative; display: block; overflow: visible; }

/* day ↔ night: every colour is mixed from --n, which a spring drives */
.ck-dial { fill: color-mix(in srgb, #1c1c1e calc(var(--n) * 100%), #ffffff); stroke: color-mix(in srgb, rgba(255,255,255,.1) calc(var(--n) * 100%), rgba(0,0,0,.06)); stroke-width: .5; }
.ck-tick { stroke: color-mix(in srgb, rgba(255,255,255,.28) calc(var(--n) * 100%), rgba(20,20,22,.28)); stroke-width: .7; stroke-linecap: round; }
.ck-tick-h { stroke: color-mix(in srgb, rgba(255,255,255,.6) calc(var(--n) * 100%), rgba(20,20,22,.55)); stroke-width: 1.1; }
.ck-num { font: 500 10.5px ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif; letter-spacing: -.02em; fill: color-mix(in srgb, #f5f5f7 calc(var(--n) * 100%), #1d1d1f); }
.ck-hand { stroke: color-mix(in srgb, #f5f5f7 calc(var(--n) * 100%), #1d1d1f); stroke-linecap: round; }
.ck-hour { stroke-width: 3.6; }
.ck-minute { stroke-width: 2.6; }
.ck-second { stroke: #ff9500; stroke-width: 1.1; stroke-linecap: round; }
.ck-cap { fill: #ff9500; }
.ck-cap-dot { fill: color-mix(in srgb, #1c1c1e calc(var(--n) * 100%), #ffffff); }

/* hover: the hands lift off the dial — up a pixel, their shadow growing */
.ck-hands {
  transform: translateY(calc(var(--go-hover) * -1px));
  filter: drop-shadow(0 calc(.6px + var(--go-hover) * 2.4px) calc(.6px + var(--go-hover) * 1.8px) rgba(0,0,0,calc(.22 + var(--go-hover) * .16)));
}

/* hover: a soft sheen crosses the dial glass with the pointer */
.ck-sheen { position: absolute; inset: 0; display: block; border-radius: 50%; overflow: hidden; pointer-events: none; opacity: var(--go-hover); }
.ck-sheen::before {
  content: ""; position: absolute; top: -10%; bottom: -10%; left: -60%; width: 220%;
  background: linear-gradient(105deg, rgba(255,255,255,0) 36%, rgba(255,255,255,.22) 46%, rgba(255,255,255,.32) 50%, rgba(255,255,255,.22) 54%, rgba(255,255,255,0) 64%);
  transform: translateX(calc(var(--go-px) * 30%));
}
`
