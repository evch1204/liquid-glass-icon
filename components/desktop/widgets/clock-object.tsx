"use client"

import * as React from "react"
import { GlassObject, GlassPane, LIQUIDS, LiquidCanvas, useGlass } from "@/components/ui/glass-object"
import { WIDGET, type WidgetSize } from "../glass"
import { APPS } from "@/lib/apps"
import { useWindowManager } from "../window-manager"

/**
 * Clock — a clock you can pick up, drawn as an object.
 *
 * Three layers: a pearl liquid light at the back, a real clock face with real
 * hands in the middle (SVG, turned every frame, never re-rendered), and a
 * frosted pane along the bottom carrying the city and the digital time.
 *
 * - **Rest**: the face sits in the liquid; the second hand sweeps.
 * - **Hover**: the object tilts toward you, the pane leans back, the face
 *   lifts a little out of the light.
 * - **Open** (click): the pane folds down and away; the face shrinks toward
 *   the top and three small world clocks rise out from behind it and fan
 *   across, each with its city and offset.
 * - **Activate** (double-click, Enter): the Clock app.
 */

type City = { name: string; code: string; zone: string }
const HOME: City = { name: "Cupertino", code: "CUP", zone: "America/Los_Angeles" }
const WORLD: City[] = [
  { name: "New York", code: "NYC", zone: "America/New_York" },
  { name: "London", code: "LON", zone: "Europe/London" },
  { name: "Tokyo", code: "TYO", zone: "Asia/Tokyo" },
]

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

function offsetLabel(zone: string, now: number): string {
  const d = (zoneOffset(zone, now) - -new Date(now).getTimezoneOffset()) / 60
  if (d === 0) return "Today, +0HRS"
  const local = new Date(now)
  const there = new Date(now + d * 3600000)
  const day = there.getDate() === local.getDate() ? "Today" : there > local ? "Tomorrow" : "Yesterday"
  return day + ", " + (d > 0 ? "+" : "") + (Number.isInteger(d) ? d : d.toFixed(1)) + "HRS"
}

/**
 * A face whose hands are turned by requestAnimationFrame straight on the DOM.
 * Light face by day, dark by night, in that city's own time.
 */
function Face({ zone, size, numerals = true, className, style }: { zone: string; size: number; numerals?: boolean; className?: string; style?: React.CSSProperties }) {
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
      const t = now + off * 60000
      const ms = t % 86400000
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
    <svg ref={root} viewBox="-52 -52 104 104" width={size} height={size} className={"ck-face" + (className ? " " + className : "")} style={style} aria-hidden="true">
      <defs>
        <filter id="ck-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1" floodOpacity="0.28" />
        </filter>
      </defs>
      <circle r={r} className="ck-dial" />
      {Array.from({ length: 60 }, (_, i) => (
        <line key={i} x1="0" y1={-r + 2.5} x2="0" y2={i % 5 ? -r + 5 : -r + 8.5} transform={`rotate(${i * 6})`} className={i % 5 ? "ck-tick" : "ck-tick ck-tick-h"} />
      ))}
      {numerals
        ? Array.from({ length: 12 }, (_, i) => {
            const a = ((i + 1) * 30 * Math.PI) / 180
            // rounded, so server and browser agree to the last digit
            const x = Math.round(Math.sin(a) * 3500) / 100
            const y = Math.round((-Math.cos(a) * 35 + 4) * 100) / 100
            return (
              <text key={i} x={x} y={y} className="ck-num" textAnchor="middle">
                {i + 1}
              </text>
            )
          })
        : null}
      <g ref={h} filter="url(#ck-shadow)">
        <line x1="0" y1="6" x2="0" y2="-24" className="ck-hand ck-hour" />
      </g>
      <g ref={m} filter="url(#ck-shadow)">
        <line x1="0" y1="7" x2="0" y2="-40" className="ck-hand ck-minute" />
      </g>
      <g ref={s}>
        <line x1="0" y1="11" x2="0" y2="-44" className="ck-second" />
        <circle r="2.6" className="ck-cap" />
        <circle r="1" className="ck-cap-dot" />
      </g>
    </svg>
  )
}

function Digital({ zone, className }: { zone: string; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    const fmt = new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit" })
    const write = () => {
      if (ref.current) ref.current.textContent = fmt.format(new Date())
    }
    write()
    const t = window.setInterval(write, 1000)
    return () => window.clearInterval(t)
  }, [zone])
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

/** The small object: one face, a pane, three world clocks that fan out. */
function Small() {
  const { open } = useGlass()
  return (
    <>
      <LiquidCanvas recipe={LIQUIDS.pearl} seed={2} />
      <div className="ck-stage">
        <Face zone={HOME.zone} size={118} className="ck-main" />
        {WORLD.map((c, i) => (
          <div key={c.code} className="ck-mini" style={{ "--i": i - 1 } as React.CSSProperties}>
            <Face zone={c.zone} size={46} numerals={false} />
            <span className="ck-mini-code go-mono">{c.code}</span>
          </div>
        ))}
      </div>
      <GlassPane hinge="bottom" lean={-10} openLean={-78} openShift={18} openFade={0.85} radius={18} className="ck-pane">
        <div className="ck-label">
          <span className="ck-city">{HOME.name}</span>
          <Digital zone={HOME.zone} className="ck-time go-mono" />
        </div>
      </GlassPane>
      <div className="ck-open-label" aria-hidden={!open}>
        <Offset zone={HOME.zone} className="go-mono go-soft" />
      </div>
    </>
  )
}

/** The wide object: four faces in a row under one pane; open lifts the pane to show digital times and offsets. */
function Medium() {
  const cities = [HOME, ...WORLD]
  return (
    <>
      <LiquidCanvas recipe={LIQUIDS.pearl} seed={5} cells={120} />
      <div className="ck-row">
        {cities.map((c) => (
          <div key={c.code} className="ck-col">
            <Face zone={c.zone} size={76} numerals={false} />
            <span className="ck-col-code go-mono">{c.code}</span>
          </div>
        ))}
      </div>
      <GlassPane hinge="top" lean={-6} openLean={-70} openShift={-6} openFade={0.4} radius={18} className="ck-pane ck-pane-wide">
        <div className="ck-label ck-label-wide">
          <span className="ck-city">World Clock</span>
          <Digital zone={HOME.zone} className="ck-time go-mono" />
        </div>
      </GlassPane>
      <div className="ck-row ck-row-times">
        {cities.map((c) => (
          <div key={c.code} className="ck-col">
            <Digital zone={c.zone} className="ck-col-time go-mono" />
            <Offset zone={c.zone} className="ck-col-off go-mono go-soft" />
          </div>
        ))}
      </div>
    </>
  )
}

/** The big object: a 2×2 of faces; open reveals city, digital time and offset under each. */
function Large() {
  const cities = [HOME, ...WORLD]
  return (
    <>
      <LiquidCanvas recipe={LIQUIDS.pearl} seed={7} cells={120} />
      <div className="ck-grid">
        {cities.map((c) => (
          <div key={c.code} className="ck-cell">
            <Face zone={c.zone} size={120} />
            <div className="ck-cell-text">
              <span className="ck-city">{c.name}</span>
              <Digital zone={c.zone} className="ck-col-time go-mono" />
              <Offset zone={c.zone} className="ck-col-off go-mono go-soft" />
            </div>
          </div>
        ))}
      </div>
      <GlassPane hinge="bottom" lean={-8} openLean={-60} openShift={12} openFade={0.35} radius={18} className="ck-pane ck-pane-large">
        <div className="ck-label">
          <span className="ck-city">World Clock</span>
          <Digital zone={HOME.zone} className="ck-time go-mono" />
        </div>
      </GlassPane>
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
      radius={24}
      appearDelay={appearDelay}
      className={"ck-root ck-" + size + (className ? " " + className : "")}
      onActivate={() => open("clock", { singleton: "app", title: APPS.clock.name, w: APPS.clock.defaultSize.w, h: APPS.clock.defaultSize.h })}
    >
      <style href="clock-object" precedence="glass-widget">{CK_CSS}</style>
      <div className="ck-back" aria-hidden="true" />
      {size === "small" ? <Small /> : size === "medium" ? <Medium /> : <Large />}
    </GlassObject>
  )
}

const CK_CSS = `
.ck-root .go-tilt { border-radius: 24px; }
.ck-back { position: absolute; inset: 0; border-radius: 24px; overflow: hidden; box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 .5px rgba(0,0,0,.1); }
.ck-root .go-liquid { border-radius: 24px; }
.ck-root[data-tone="dark"] .ck-back { box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 0 0 .5px rgba(255,255,255,.1); }

/* faces */
.ck-face { display: block; overflow: visible; }
.ck-dial { fill: #ffffff; stroke: rgba(0,0,0,.08); stroke-width: .6; filter: drop-shadow(0 6px 10px rgba(16,18,24,.18)); }
.ck-face[data-night="true"] .ck-dial { fill: #1c1c21; stroke: rgba(255,255,255,.14); }
.ck-tick { stroke: rgba(20,20,22,.22); stroke-width: 1; stroke-linecap: round; }
.ck-tick-h { stroke: rgba(20,20,22,.6); stroke-width: 1.8; }
.ck-face[data-night="true"] .ck-tick { stroke: rgba(255,255,255,.22); }
.ck-face[data-night="true"] .ck-tick-h { stroke: rgba(255,255,255,.7); }
.ck-num { font: 600 8.5px ui-sans-serif, system-ui, sans-serif; fill: #18181b; }
.ck-face[data-night="true"] .ck-num { fill: #f4f4f5; }
.ck-hand { stroke: #18181b; stroke-linecap: round; }
.ck-hour { stroke-width: 4.2; }
.ck-minute { stroke-width: 3.2; }
.ck-face[data-night="true"] .ck-hand { stroke: #f4f4f5; }
.ck-second { stroke: #ff9f0a; stroke-width: 1.2; stroke-linecap: round; }
.ck-cap { fill: #ff9f0a; }
.ck-cap-dot { fill: #fff; }

/* small */
.ck-stage { position: absolute; inset: 0; }
.ck-main {
  position: absolute; left: 50%; top: 14px;
  transform-origin: 50% 0%;
  transform: translateX(-50%) translateY(calc(var(--go-hover) * -3px + var(--go-open) * -4px)) scale(calc(1 - var(--go-open) * .32));
}
.ck-mini {
  position: absolute; left: 50%; bottom: 30px;
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  transform:
    translateX(calc(-50% + var(--i) * 52px * var(--go-open)))
    translateY(calc((1 - var(--go-open)) * 70px + var(--go-hover) * -2px))
    rotate(calc(var(--i) * 7deg * var(--go-open)))
    scale(calc(.8 + var(--go-open) * .2));
  opacity: calc(var(--go-open) * 1);
}
.ck-mini-code { font-size: 9.5px; color: var(--go-ink-soft); }
.ck-pane { top: auto; bottom: 0; height: 48px; }
.ck-label { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 1px; }
.ck-city { font-size: 12.5px; font-weight: 600; letter-spacing: -.005em; }
.ck-time { font-size: 11px; color: var(--go-ink-soft); font-variant-numeric: tabular-nums; }
.ck-open-label {
  position: absolute; left: 0; right: 0; bottom: 10px;
  text-align: center; font-size: 10px;
  opacity: var(--go-open);
  transform: translateY(calc((1 - var(--go-open)) * 6px));
}

/* medium */
.ck-row { position: absolute; left: 12px; right: 12px; top: 18px; display: flex; justify-content: space-around; align-items: flex-start; }
.ck-col { display: flex; flex-direction: column; align-items: center; gap: 4px; transform: translateY(calc(var(--go-hover) * -2px + var(--go-open) * -6px)); }
.ck-col-code { font-size: 9.5px; color: var(--go-ink-soft); }
.ck-pane-wide { top: 0; bottom: auto; height: 44px; }
.ck-label-wide { flex-direction: row; justify-content: space-between; padding: 0 16px; }
.ck-row-times { top: auto; bottom: 10px; opacity: var(--go-open); transform: translateY(calc((1 - var(--go-open)) * 14px)); }
.ck-col-time { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.ck-col-off { font-size: 9px; }

/* large */
.ck-grid { position: absolute; inset: 14px 14px 56px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; }
.ck-cell { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ck-cell .ck-face { transform-origin: 50% 0%; transform: translateY(calc(var(--go-open) * -10px)) scale(calc(1 - var(--go-open) * .22)); }
.ck-cell-text {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  opacity: var(--go-open);
  transform: translateY(calc((1 - var(--go-open)) * 12px));
}
.ck-pane-large { top: auto; bottom: 0; height: 56px; }
`
