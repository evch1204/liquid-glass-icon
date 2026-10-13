"use client"

import * as React from "react"
import { GlassObject, GlassPane, GlassSheet, LIQUIDS, LiquidCanvas, useGlass, useSpringVar } from "@/components/ui/glass-object"
import { WIDGET, type WidgetSize } from "../glass"
import { APPS } from "@/lib/apps"
import { useWindowManager } from "../window-manager"

/**
 * Clock — at rest, the macOS Sonoma Clock widget: a frosted white card with
 * clean analog faces and their captions. Handled, it is an object.
 *
 * Back to front: a pearl liquid light, one frosted `GlassPane` covering the
 * whole widget that carries the captions (city, offset, digital time), and
 * the faces, which sit on that pane but are their own layer.
 *
 * - **Rest**: the card. Second hands sweep.
 * - **Hover**: the pane leans back on its bottom hinge and the object lifts;
 *   each face rises 3px off the pane and its shadow spreads, the face nearest
 *   the pointer most. The first touch nudges the second hand's balance.
 * - **Open** (click): the pane hinges down and away like the folder's front,
 *   captions and all. The faces stay: on small the face comes forward and
 *   three city beads run out from the hub to the rim along their own hour
 *   hands, 60ms apart; on medium and large the faces lift in sequence. The
 *   digital times and offsets rise beneath as sheet chips.
 * - **Activate** (double-click, Enter): the Clock app.
 *
 * Every motion is a spring written as a CSS variable on the object's root
 * (`--face*`, `--bead-*`, `--fh-*`, `--sway`); hands are turned on rAF
 * straight on the DOM. Nothing re-renders per frame.
 */

type City = { name: string; code: string; zone: string }
const HOME: City = { name: "Cupertino", code: "CUP", zone: "America/Los_Angeles" }
const WORLD: City[] = [
  { name: "New York", code: "NYC", zone: "America/New_York" },
  { name: "London", code: "LON", zone: "Europe/London" },
  { name: "Tokyo", code: "TYO", zone: "Asia/Tokyo" },
]
const ALL: City[] = [HOME, ...WORLD]

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

/** Where that city's own hour hand points, in degrees from twelve. */
function hourAngle(zone: string, at: number): number {
  const t = (at + zoneOffset(zone, at) * 60000) % 86400000
  return ((t / 3600000) % 12) * 30
}

/** "Tomorrow, +16HRS" (or "+16HRS" short), relative to home, as the macOS widget writes it. */
function offsetLabel(zone: string, at: number, short = false): string {
  const d = (zoneOffset(zone, at) - zoneOffset(HOME.zone, at)) / 60
  const hrs = (d >= 0 ? "+" : "") + (Number.isInteger(d) ? d : d.toFixed(1)) + "HRS"
  if (short) return hrs
  const ymd = (z: string) => new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at))
  const a = ymd(zone)
  const b = ymd(HOME.zone)
  return (a === b ? "Today" : a > b ? "Tomorrow" : "Yesterday") + ", " + hrs
}

function timeIn(zone: string, at: number): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(at))
}

// ---------------------------------------------------------------------------
// Parts written by ref

/**
 * A face whose hands are turned by requestAnimationFrame straight on the DOM.
 * White by day, near-black by night, in that city's own time.
 */
function Face({ zone, size }: { zone: string; size: number }) {
  const h = React.useRef<SVGGElement>(null)
  const m = React.useRef<SVGGElement>(null)
  const s = React.useRef<SVGGElement>(null)
  const root = React.useRef<SVGSVGElement>(null)
  React.useEffect(() => {
    let raf = 0
    let off = zoneOffset(zone, Date.now())
    let lastOff = Date.now()
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    const frame = () => {
      const now = Date.now()
      if (now - lastOff > 60000) {
        off = zoneOffset(zone, now)
        lastOff = now
      }
      const ms = (now + off * 60000) % 86400000
      const sec = reduce ? Math.floor(ms / 1000) : ms / 1000
      const min = sec / 60
      const hr = min / 60
      h.current?.setAttribute("transform", `rotate(${(hr % 12) * 30})`)
      m.current?.setAttribute("transform", `rotate(${(min % 60) * 6})`)
      s.current?.setAttribute("transform", `rotate(${(sec % 60) * 6})`)
      const hour = Math.floor(hr) % 24
      root.current?.setAttribute("data-night", hour < 6 || hour >= 18 ? "true" : "false")
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [zone])
  const r = 50
  return (
    <svg ref={root} viewBox="-51 -51 102 102" width={size} height={size} className="ck-face" aria-hidden="true">
      <defs>
        {/* user-space region: a hand is a vertical line, so its bounding box has no width */}
        <filter id="ck-hand-shadow" filterUnits="userSpaceOnUse" x="-60" y="-60" width="120" height="120">
          <feDropShadow dx="0" dy="1" stdDeviation=".9" floodOpacity="0.25" />
        </filter>
      </defs>
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
      <g ref={h} filter="url(#ck-hand-shadow)">
        <line x1="0" y1="5" x2="0" y2="-25" className="ck-hand ck-hour" />
      </g>
      <g ref={m} filter="url(#ck-hand-shadow)">
        <line x1="0" y1="5" x2="0" y2="-40" className="ck-hand ck-minute" />
      </g>
      {/* the balance: a touch sets the second hand wobbling a degree or so */}
      <g className="ck-balance">
        <g ref={s}>
          <line x1="0" y1="10" x2="0" y2="-43" className="ck-second" />
          <circle r="2.4" className="ck-cap" />
          <circle r=".9" className="ck-cap-dot" />
        </g>
      </g>
    </svg>
  )
}

function Digital({ zone, className }: { zone: string; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    const write = () => {
      if (ref.current) ref.current.textContent = timeIn(zone, Date.now())
    }
    write()
    const t = window.setInterval(write, 1000)
    return () => window.clearInterval(t)
  }, [zone])
  return <span ref={ref} className={className} />
}

function Offset({ zone, short, className }: { zone: string; short?: boolean; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    const write = () => {
      if (ref.current) ref.current.textContent = offsetLabel(zone, Date.now(), short)
    }
    write()
    const t = window.setInterval(write, 30000)
    return () => window.clearInterval(t)
  }, [zone, short])
  return <span ref={ref} className={className} />
}

/** The three world-time beads: each runs out from the hub to the rim along that city's own hour hand. */
function Beads({ R, live, hot, onHot, onActivate }: { R: number; live: boolean; hot: number | null; onHot: (i: number | null) => void; onActivate: () => void }) {
  const arms = React.useRef<(HTMLDivElement | null)[]>([])
  React.useEffect(() => {
    const write = () => {
      const now = Date.now()
      const angles = WORLD.map((c) => hourAngle(c.zone, now))
      // two cities whose hands nearly coincide: the second bead stops short so they do not overlap
      const reach = angles.map((a, i) => (angles.slice(0, i).some((b) => Math.abs(((a - b + 540) % 360) - 180) < 30) ? 0.62 : 1))
      angles.forEach((a, i) => {
        arms.current[i]?.style.setProperty("--a", a.toFixed(2) + "deg")
        arms.current[i]?.style.setProperty("--r", String(reach[i]))
      })
    }
    write()
    const t = window.setInterval(write, 30000)
    return () => window.clearInterval(t)
  }, [])
  return (
    <div className="ck-beads" style={{ "--R": R + "px" } as React.CSSProperties}>
      {WORLD.map((c, i) => (
        <div key={c.code} ref={(el) => void (arms.current[i] = el)} className="ck-arm" style={{ "--b": `var(--bead-${i})`, "--a": "0deg", "--r": 1 } as React.CSSProperties}>
          <i className="ck-ghost" />
          <span
            className={"ck-bead go-mono" + (live ? " go-live" : "")}
            data-hot={hot === i || undefined}
            onPointerEnter={() => onHot(i)}
            onPointerLeave={() => onHot(null)}
            onClick={(e) => e.stopPropagation()}
            // beads go live while still gathered at the hub, so a double-click on the open face often lands on one
            onDoubleClick={(e) => {
              e.stopPropagation()
              onActivate()
            }}
          >
            {c.code}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout

type Slot = { x: number; y: number; size: number }

/** Face positions (top-left and size) per widget size; captions and chips hang off these. */
const SLOTS: Record<WidgetSize, Slot[]> = {
  small: [{ x: 33, y: 31, size: 104 }],
  medium: ALL.map((_, i) => ({ x: Math.round(45.5 + 91 * i - 39), y: 18, size: 78 })),
  large: ALL.map((_, i) => ({ x: (i % 2 ? 273 : 91) - 60, y: (i < 2 ? 0 : 182) + 10, size: 120 })),
}

/** One face on its own layer above the pane: lifts on hover (`--fh`), comes forward when open (`--f`). */
function FaceSlot({ slot, i, zone, children }: { slot: Slot; i: number; zone: string; children?: React.ReactNode }) {
  return (
    <div
      className="ck-fw"
      style={{ left: slot.x, top: slot.y, width: slot.size, height: slot.size, "--fh": `var(--fh-${i})`, "--f": `var(${i ? `--face-${i}` : "--face"})` } as React.CSSProperties}
    >
      <i className="ck-fshadow" />
      <Face zone={zone} size={slot.size} />
      {children}
    </div>
  )
}

/** A sheet chip that rises beneath a face when the widget is open. */
function Chip({ city, drive, hot, short, style }: { city: City; drive: string; hot?: boolean; short?: boolean; style: React.CSSProperties }) {
  return (
    <GlassSheet className="ck-chip" style={{ ...style, "--b": `var(${drive})` } as React.CSSProperties}>
      <span className="ck-chip-in" data-hot={hot || undefined}>
        <span className="ck-chip-time go-mono">
          {short ? <span className="ck-chip-code">{city.code} </span> : null}
          <Digital zone={city.zone} />
        </span>
        <Offset zone={city.zone} short={short} className="ck-chip-off go-soft" />
      </span>
    </GlassSheet>
  )
}

// ---------------------------------------------------------------------------
// The mechanism

function ClockBody({ size }: { size: WidgetSize }) {
  const { hover, focused, open, tone, rootRef, onFrame, setOpen, activate } = useGlass()
  const [hot, setHot] = React.useState<number | null>(null)

  // the springs live on the object's root so every child's calc() reaches them
  const face0 = useSpringVar(rootRef, "--face", 0, 200, 16)
  const face1 = useSpringVar(rootRef, "--face-1", 0, 200, 16)
  const face2 = useSpringVar(rootRef, "--face-2", 0, 200, 16)
  const face3 = useSpringVar(rootRef, "--face-3", 0, 200, 16)
  const bead0 = useSpringVar(rootRef, "--bead-0", 0, 240, 15)
  const bead1 = useSpringVar(rootRef, "--bead-1", 0, 240, 15)
  const bead2 = useSpringVar(rootRef, "--bead-2", 0, 240, 15)
  const fh0 = useSpringVar(rootRef, "--fh-0", 0, 170, 17)
  const fh1 = useSpringVar(rootRef, "--fh-1", 0, 170, 17)
  const fh2 = useSpringVar(rootRef, "--fh-2", 0, 170, 17)
  const fh3 = useSpringVar(rootRef, "--fh-3", 0, 170, 17)
  const sway = useSpringVar(rootRef, "--sway", 0, 30, 1.8)

  const slots = SLOTS[size]
  const { w: W, h: H } = WIDGET[size]
  const near = React.useRef(0)
  const up = hover || focused

  // hover: every face rises off the pane, the one nearest the pointer most
  const lifts = React.useCallback(
    (on: boolean) => {
      const fh = [fh0, fh1, fh2, fh3]
      slots.forEach((_, i) => fh[i](on ? (slots.length === 1 || i === near.current ? 1 : 0.4) : 0))
    },
    [fh0, fh1, fh2, fh3, slots],
  )

  React.useEffect(() => {
    lifts(up)
    if (up) sway(undefined, { impulse: 0.6 })
  }, [up, lifts, sway])

  React.useEffect(() => {
    if (slots.length === 1) return
    return onFrame((f) => {
      if (!f.hover) return
      const x = ((f.px + 1) / 2) * W
      const y = ((f.py + 1) / 2) * H
      let best = 0
      let bd = Infinity
      slots.forEach((s, i) => {
        const d = Math.hypot(s.x + s.size / 2 - x, s.y + s.size / 2 - y)
        if (d < bd) {
          bd = d
          best = i
        }
      })
      if (best !== near.current) {
        near.current = best
        lifts(true)
      }
    })
  }, [slots, W, H, onFrame, lifts])

  // open: the pane hinges away (engine --go-open); 140ms later the faces come forward, then the beads run out
  React.useEffect(() => {
    const face = [face0, face1, face2, face3]
    const beads = [bead0, bead1, bead2]
    slots.forEach((_, i) => face[i](open ? 1 : 0, { k: 200, c: 16, delay: open ? 140 + i * 60 : 0 }))
    if (slots.length === 1) beads.forEach((b, j) => b(open ? 1 : 0, open ? { k: 240, c: 15, delay: 260 + j * 60 } : { k: 200, c: 16 }))
  }, [open, slots, face0, face1, face2, face3, bead0, bead1, bead2])

  const hotNow = open ? hot : null

  return (
    <>
      <LiquidCanvas recipe={tone === "dark" ? LIQUIDS.smoke : LIQUIDS.pearl} seed={size === "small" ? 2 : size === "medium" ? 5 : 7} cells={size === "small" ? 72 : 120} />
      <div className="ck-back" aria-hidden="true" />

      {/* the card: one frosted pane with the captions on it; it hinges away when opened */}
      <GlassPane hinge="bottom" lean={-9} openLean={-70} openShift={14} openFade={0.8} frost={0.9} radius={22} className="ck-pane">
        {size === "small" ? (
          <>
            <span className="ck-city ck-s-city">{HOME.name}</span>
            <span className="ck-s-foot">
              <Offset zone={HOME.zone} className="ck-off go-soft" />
              <Digital zone={HOME.zone} className="ck-time go-mono" />
            </span>
          </>
        ) : (
          ALL.map((c, i) => {
            const s = slots[i]
            return (
              <span key={c.code} className="ck-cap-col" style={{ left: s.x + s.size / 2, top: s.y + s.size + (size === "large" ? 4 : 6) }}>
                <span className="ck-city">{c.name}</span>
                <Offset zone={c.zone} className="ck-off go-soft" />
                <Digital zone={c.zone} className="ck-time go-mono" />
              </span>
            )
          })
        )}
      </GlassPane>

      {/* the faces, sitting on the pane */}
      {size === "small" ? (
        <FaceSlot slot={slots[0]} i={0} zone={HOME.zone}>
          <Beads
            R={37}
            live={open}
            hot={hot}
            onHot={setHot}
            onActivate={() => {
              setOpen(false)
              activate()
            }}
          />
        </FaceSlot>
      ) : (
        ALL.map((c, i) => <FaceSlot key={c.code} slot={slots[i]} i={i} zone={c.zone} />)
      )}

      {/* what the open widget reads: chips that rise beneath */}
      <div className="ck-chips" aria-hidden={!open}>
        {size === "small"
          ? WORLD.map((c, j) => <Chip key={c.code} city={c} drive={`--bead-${j}`} short hot={hotNow === j} style={{ left: 8 + j * 52, top: 131, width: 50, height: 34 }} />)
          : ALL.map((c, i) => {
              const s = slots[i]
              const w = size === "large" ? 128 : 84
              return (
                <Chip
                  key={c.code}
                  city={c}
                  drive={i ? `--face-${i}` : "--face"}
                  style={{ left: s.x + s.size / 2 - w / 2, top: s.y + s.size + (size === "large" ? 4 : 2), width: w, height: size === "large" ? 38 : 36 }}
                />
              )
            })}
      </div>
    </>
  )
}

export function ClockWidget({ size = "small", className, appearDelay = 0 }: { size?: WidgetSize; className?: string; appearDelay?: number }) {
  const { open, tone } = useWindowManager()
  const { w, h } = WIDGET[size]
  return (
    <GlassObject
      width={w}
      height={h}
      tone={tone}
      label="Clock"
      radius={22}
      appearDelay={appearDelay}
      className={"ck-root ck-" + size + (className ? " " + className : "")}
      onActivate={() => open("clock", { singleton: "app", title: APPS.clock.name, w: APPS.clock.defaultSize.w, h: APPS.clock.defaultSize.h })}
    >
      <style href="clock-object" precedence="glass-widget">
        {CK_CSS}
      </style>
      <ClockBody key={size} size={size} />
    </GlassObject>
  )
}

const CK_CSS = `
.ck-root {
  --face: 0; --face-1: 0; --face-2: 0; --face-3: 0;
  --bead-0: 0; --bead-1: 0; --bead-2: 0;
  --fh-0: 0; --fh-1: 0; --fh-2: 0; --fh-3: 0;
  --sway: 0;
}
.ck-root .go-tilt { border-radius: 22px; }
.ck-root .go-liquid { border-radius: 22px; }
.ck-back { position: absolute; inset: 0; border-radius: 22px; pointer-events: none; box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 .5px rgba(0,0,0,.08); }
.ck-root[data-tone="dark"] .ck-back { box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 0 0 .5px rgba(255,255,255,.1); }

/* the card: frosted almost to white, like the Sonoma widget */
/*
 * No backdrop filter: the card frosts our own liquid, which is already soft,
 * and Chrome samples a 3D-rotated backdrop mirrored (it picked up the widget
 * below as the pane leaned). The tint carries the frost instead.
 */
.ck-root .ck-pane { -webkit-backdrop-filter: none; backdrop-filter: none; }
.ck-root:not([data-tone="dark"]) .ck-pane .go-pane-tint {
  background: linear-gradient(180deg, rgba(255,255,255,.86), rgba(255,255,255,.93));
}
.ck-root[data-tone="dark"] .ck-pane .go-pane-tint {
  background: linear-gradient(180deg, rgba(34,34,38,.86), rgba(26,26,30,.92));
}

/* captions, macOS type: 13 / 11 / 10, tight tracking, tabular figures */
.ck-city { font-size: 13px; font-weight: 600; letter-spacing: -.01em; line-height: 16px; white-space: nowrap; }
.ck-off { font-size: 11px; letter-spacing: -.005em; line-height: 13px; white-space: nowrap; }
.ck-time { font-size: 11px; line-height: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; letter-spacing: 0; }
.ck-s-city { position: absolute; left: 14px; top: 10px; }
.ck-s-foot { position: absolute; left: 14px; right: 14px; bottom: 11px; display: flex; justify-content: space-between; align-items: baseline; }
.ck-cap-col { position: absolute; display: flex; flex-direction: column; align-items: center; transform: translateX(-50%); }
.ck-medium .ck-city { font-size: 12px; line-height: 15px; }
.ck-medium .ck-off, .ck-medium .ck-time { font-size: 10px; line-height: 12px; }
.ck-large .ck-off { font-size: 10.5px; }

/* a face: its own layer on the pane; rises 3px and its shadow spreads on hover; comes forward when open */
.ck-fw {
  position: absolute;
  transform-origin: 50% 50%;
  transform: translateY(calc(var(--fh) * -3px - var(--f) * var(--fy, 6px))) scale(calc(1 + var(--f) * var(--fs, .06)));
}
.ck-small .ck-fw { --fy: 12px; --fs: .12; }
.ck-fshadow {
  position: absolute; inset: 0; display: block; border-radius: 50%;
  box-shadow: 0 calc(2px + var(--fh) * 6px) calc(5px + var(--fh) * 10px) rgba(16,18,24,calc(.14 + var(--fh) * .1));
  transform: translateY(calc(var(--fh) * 2px));
}
.ck-root[data-tone="dark"] .ck-fshadow { box-shadow: 0 calc(2px + var(--fh) * 6px) calc(5px + var(--fh) * 10px) rgba(0,0,0,calc(.4 + var(--fh) * .15)); }
.ck-face { position: relative; display: block; overflow: visible; }
.ck-dial { fill: #ffffff; stroke: rgba(0,0,0,.06); stroke-width: .5; }
.ck-face[data-night="true"] .ck-dial { fill: #1c1c1e; stroke: rgba(255,255,255,.1); }
.ck-tick { stroke: rgba(20,20,22,.28); stroke-width: .7; stroke-linecap: round; }
.ck-tick-h { stroke: rgba(20,20,22,.55); stroke-width: 1.1; }
.ck-face[data-night="true"] .ck-tick { stroke: rgba(255,255,255,.28); }
.ck-face[data-night="true"] .ck-tick-h { stroke: rgba(255,255,255,.6); }
.ck-num { font: 500 10.5px ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif; letter-spacing: -.02em; fill: #1d1d1f; }
.ck-face[data-night="true"] .ck-num { fill: #f5f5f7; }
.ck-hand { stroke: #1d1d1f; stroke-linecap: round; }
.ck-hour { stroke-width: 3.6; }
.ck-minute { stroke-width: 2.6; }
.ck-face[data-night="true"] .ck-hand { stroke: #f5f5f7; }
.ck-second { stroke: #ff9500; stroke-width: 1.1; stroke-linecap: round; }
.ck-cap { fill: #ff9500; }
.ck-cap-dot { fill: #fff; }
.ck-face[data-night="true"] .ck-cap-dot { fill: #1c1c1e; }
.ck-balance { transform: rotate(calc(var(--sway) * 14deg)); }

/* beads: city capsules that run out from the hub to the rim along their own hour hands */
.ck-beads { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.ck-arm { position: absolute; left: 0; top: 0; width: 0; height: 0; transform: rotate(var(--a)); }
.ck-ghost { position: absolute; display: block; left: -1px; bottom: 0; width: 2px; height: calc(var(--b) * var(--R) * var(--r)); border-radius: 1px; background: #1d1d1f; opacity: calc(min(1, var(--b) * 4) * .35); }
.ck-bead {
  position: absolute; left: 0; top: 0; width: 22px; height: 14px; margin: -7px 0 0 -11px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 7px; font-size: 8.5px; font-weight: 600; letter-spacing: .02em; color: #1d1d1f;
  background: rgba(255,255,255,.92);
  box-shadow: 0 0 0 .5px rgba(0,0,0,.14), 0 2px 5px -1px rgba(16,18,24,.3);
  opacity: clamp(0, calc(var(--b) * 3), 1);
  transform: translateY(calc(var(--b) * var(--R) * var(--r) * -1)) rotate(calc(var(--a) * -1)) scale(calc(.5 + var(--b) * .5));
  cursor: default;
}
.ck-bead[data-hot] { background: #ff9500; color: #fff; box-shadow: 0 0 0 .5px rgba(0,0,0,.1), 0 3px 8px -2px rgba(255,149,0,.6); }
.ck-face[data-night="true"] ~ .ck-beads .ck-ghost { background: #f5f5f7; }

/* chips: the open widget's readouts, rising beneath the faces */
.ck-chips { position: absolute; inset: 0; pointer-events: none; }
.ck-chip {
  border-radius: 10px;
  opacity: clamp(0, calc(var(--b) * 1.4 - .2), 1);
  transform: translateY(calc((1 - var(--b)) * 14px)) scale(calc(.94 + var(--b) * .06));
}
.ck-chip-in { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; border-radius: inherit; }
.ck-chip-in[data-hot] { box-shadow: inset 0 0 0 1.5px #ff9500; }
.ck-chip-time { font-size: 11px; font-weight: 600; line-height: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; letter-spacing: -.01em; }
.ck-chip-code { font-weight: 500; color: var(--go-ink-soft); }
.ck-chip-off { font-size: 9.5px; line-height: 11px; white-space: nowrap; }
.ck-small .ck-chip-time { font-size: 10px; }
.ck-small .ck-chip-code { display: block; text-align: center; font-size: 8.5px; line-height: 10px; letter-spacing: .04em; }
.ck-large .ck-chip-time { font-size: 13px; line-height: 16px; }
.ck-large .ck-chip-off { font-size: 10px; line-height: 12px; }
`
