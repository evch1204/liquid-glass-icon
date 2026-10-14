"use client"

import * as React from "react"
import { GlassObject, GlassPane, LIQUIDS, LiquidCanvas, useGlass, useSpringVar, type LiquidRecipe } from "@/components/ui/glass-object"
import { rng } from "@/components/ui/glass-folder-cards"
import { WIDGET, type WidgetSize } from "../glass"
import { useWindowManager } from "../window-manager"

/**
 * Weather — the macOS Weather widget, made as a glass object.
 *
 * At rest it reads exactly like the native widget: city with a location
 * arrow, the big light temperature, the condition glyph, the condition and
 * the day's range; medium adds the hourly row on the right, large the hourly
 * row and a six-day list with range bars.
 *
 * Layers, back to front: the sky as a liquid light (pale sky by day, smoke by
 * night) with a time-of-day cast over it and a sun (or moon) on an arc; one
 * flat frosted pane; the contents, clipped to the card. The card never
 * changes size or shape and nothing crosses its edge.
 *
 * - **Hover** scrubs the day: the pointer's x is a time of day (`--scrub`,
 *   k=60 c=11, chasing px). The sun travels its arc behind the frost, the cast
 *   turns from dawn-warm through noon-blue to dusk-orange, the big temperature
 *   shows that hour's forecast with the hour beneath it, and on medium the
 *   matching hourly column lights. On leave it all eases back to now.
 * - **Open** (click): the forecast slides in, in frame. The current block
 *   slides up into a one-line header (`--open`, k=80 c=12); the six-day list
 *   rises from the bottom edge, row by row 50 ms apart, each bar drawing
 *   itself (small); the hourly row scrolls on to later hours and a five-day
 *   column slides in (medium); the day rows open up with hourly strips
 *   (large). Escape or a click outside puts the native layout back.
 * - **Activate** (double-click, Enter): the Weather app.
 *
 * The numbers are the Weather app's: Cupertino, 54° to 72°, the same hourly
 * curve and the same date-seeded outlook.
 */

// ---------------------------------------------------------------------------
// Time, read only after mount (hydration safe)

let nowValue: number | null = null
const nowListeners = new Set<() => void>()
let nowTimer: ReturnType<typeof setInterval> | undefined
const minuteOf = (t: number) => Math.floor(t / 60_000)

function subscribeNow(cb: () => void) {
  nowListeners.add(cb)
  const t = Date.now()
  if (nowValue === null || minuteOf(t) !== minuteOf(nowValue)) nowValue = t
  if (!nowTimer) {
    nowTimer = setInterval(() => {
      const n = Date.now()
      if (nowValue === null || minuteOf(n) !== minuteOf(nowValue)) {
        nowValue = n
        nowListeners.forEach((l) => l())
      }
    }, 10_000)
  }
  return () => {
    nowListeners.delete(cb)
    if (!nowListeners.size && nowTimer) {
      clearInterval(nowTimer)
      nowTimer = undefined
    }
  }
}

/** Epoch ms at minute resolution; `null` on the server and during hydration. */
function useNow(): number | null {
  return React.useSyncExternalStore(
    subscribeNow,
    () => nowValue,
    () => null,
  )
}

// ---------------------------------------------------------------------------
// The data (the same model the Weather app uses)

type Condition = "sunny" | "partly-cloudy" | "cloudy" | "rain" | "night" | "night-cloudy"

const CITY = "Cupertino"
const SUNRISE = 7 * 60 + 12
const SUNSET = 18 * 60 + 31
const LO = 54
const HI = 72
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const LABEL: Record<Condition, string> = {
  sunny: "Sunny",
  "partly-cloudy": "Partly Cloudy",
  cloudy: "Cloudy",
  rain: "Rain",
  night: "Clear",
  "night-cloudy": "Mostly Clear",
}

const isNight = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440
  return m < SUNRISE || m >= SUNSET
}

function tempAt(hour: number) {
  const t = (((hour - 6) % 24) + 24) % 24
  const k = t <= 9 ? (1 - Math.cos((Math.PI * t) / 9)) / 2 : 1 - (1 - Math.cos((Math.PI * (t - 9)) / 15)) / 2
  return Math.round(LO + (HI - LO) * k)
}

function conditionAt(hour: number): Condition {
  const h = ((Math.floor(hour) % 24) + 24) % 24
  if (isNight(h * 60 + 30)) return h >= 1 && h <= 5 ? "night-cloudy" : "night"
  if (h <= 10 || h >= 17) return "partly-cloudy"
  return "sunny"
}

const forNight = (c: Condition, night: boolean): Condition =>
  !night ? c : c === "sunny" ? "night" : c === "partly-cloudy" ? "night-cloudy" : c

type Clock = { minutes: number; weekday: number; dayNumber: number; ready: boolean }

function clockOf(now: number | null): Clock {
  if (now === null) return { minutes: 720, weekday: 0, dayNumber: 0, ready: false }
  const d = new Date(now)
  return {
    minutes: d.getHours() * 60 + d.getMinutes(),
    weekday: d.getDay(),
    dayNumber: Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000),
    ready: true,
  }
}

function fmtHour(h: number) {
  const x = ((h % 24) + 24) % 24
  return `${x % 12 === 0 ? 12 : x % 12}${x < 12 ? "AM" : "PM"}`
}

type Hour = { key: string; label: string; temp: number; condition: Condition }

function hourly(clock: Clock, count: number): Hour[] {
  const start = Math.floor(clock.minutes / 60)
  return Array.from({ length: count }, (_, i) => {
    const h = start + i
    return {
      key: "h" + h,
      label: i === 0 ? "Now" : fmtHour(h),
      temp: i === 0 ? tempAt(clock.minutes / 60) : tempAt(h),
      condition: i === 0 ? forNight(conditionAt(h), isNight(clock.minutes)) : conditionAt(h),
    }
  })
}

type Day = { key: string; label: string; condition: Condition; lo: number; hi: number }

/** The app's outlook, seeded by the date so both agree. */
function forecast(clock: Clock, days: number): Day[] {
  const r = rng(clock.dayNumber * 7919 + 17)
  const out: Day[] = [{ key: "d0", label: "Today", condition: "sunny", lo: LO, hi: HI }]
  let hi = HI
  for (let i = 1; i < days; i++) {
    hi = Math.round(Math.min(81, Math.max(62, hi + (r() * 8 - 4.2))))
    const roll = r()
    const condition: Condition = roll < 0.45 ? "sunny" : roll < 0.72 ? "partly-cloudy" : roll < 0.86 ? "cloudy" : "rain"
    const dayHi = hi + (condition === "rain" ? -6 : condition === "cloudy" ? -3 : 0)
    const lo = Math.round(dayHi - 13 - r() * 6)
    // the app draws one more number here for its rain chance; keep the sequence in step
    if (condition === "rain" || condition === "cloudy") r()
    out.push({ key: "d" + i, label: WEEKDAYS[(clock.weekday + i) % 7], condition, hi: dayHi, lo })
  }
  return out
}

const TEMP_STOPS: [number, string][] = [
  [42, "#5ac8fa"],
  [54, "#63d7c4"],
  [62, "#a6df5c"],
  [70, "#ffd60a"],
  [78, "#ff9f0a"],
  [90, "#ff453a"],
]

function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("")
}

function tempColor(t: number) {
  if (t <= TEMP_STOPS[0][0]) return TEMP_STOPS[0][1]
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const [b, cb] = TEMP_STOPS[i]
    const [a, ca] = TEMP_STOPS[i - 1]
    if (t <= b) return mix(ca, cb, (t - a) / (b - a))
  }
  return TEMP_STOPS[TEMP_STOPS.length - 1][1]
}

// ---------------------------------------------------------------------------
// Liquids

/** The day sky on smoked glass: a deep evening blue so light ink still reads. */
const DEEP_SKY: LiquidRecipe = { colors: ["#111a2b", "#1a2944", "#28406a", "#16223a"], gloss: 0.4 }

// ---------------------------------------------------------------------------
// Glyphs: static, small, drawn on a 32-unit square (no keyframes)

const CLOUD = "M10 25.5h13.2a5 5 0 0 0 .5-9.97 7 7 0 0 0-13.4-1.6A5.8 5.8 0 0 0 10 25.5z"
const MOON = "M19.5 5.5a10 10 0 1 0 7 16.4A8.4 8.4 0 0 1 19.5 5.5z"
const RAYS = Array.from({ length: 8 }, (_, i) => `rotate(${i * 45} 16 16)`)

function Glyph({ condition, size = 18 }: { condition: Condition; size?: number }) {
  const c = condition
  const sun = c === "sunny" || c === "partly-cloudy"
  const moon = c === "night" || c === "night-cloudy"
  const cloud = c !== "sunny" && c !== "night"
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className="wo-glyph" aria-hidden="true">
      {sun ? (
        <g transform={cloud ? "translate(-1 -1.5) scale(.78)" : undefined}>
          {RAYS.map((t) => (
            <line key={t} x1="16" y1="3.2" x2="16" y2="6.2" transform={t} className="wo-g-ray" />
          ))}
          <circle cx="16" cy="16" r="6.6" className="wo-g-sun" />
        </g>
      ) : null}
      {moon ? <path d={MOON} transform={cloud ? "translate(-3 -3.5) scale(.8)" : undefined} className="wo-g-moon" /> : null}
      {cloud ? (
        <path
          d={CLOUD}
          transform={c === "rain" ? "translate(0 -4.5)" : "translate(1.5 .5)"}
          className={c === "rain" || c === "cloudy" ? "wo-g-cloud wo-g-grey" : "wo-g-cloud"}
        />
      ) : null}
      {c === "rain" ? [10.5, 16, 21.5].map((x) => <line key={x} x1={x} y1="24" x2={x - 1.2} y2="27.4" className="wo-g-rain" />) : null}
    </svg>
  )
}


const CLOUD_VIEW = "3.5 8 25.5 18.5"

function Arrow() {
  return (
    <svg viewBox="0 0 10 10" width="9" height="9" className="wo-arrow" aria-hidden="true">
      <path d="M9.2.8 1 4.4l3.6 1 1 3.6z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// The sky glyph: a real sun (or moon) and real clouds, ~28px. On hover the sun
// rises 4px and the clouds part; on open the whole glyph rides to the top.

function SkyCloud({ className, w }: { className: string; w: number }) {
  const id = "wo" + React.useId().replace(/[^a-zA-Z0-9_-]/g, "")
  return (
    <svg viewBox={CLOUD_VIEW} width={w} height={Math.round(w * 0.725)} className={"wo-sg-cloud " + className} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="wo-c0" />
          <stop offset="1" className="wo-c1" />
        </linearGradient>
      </defs>
      <path d={CLOUD} fill={`url(#${id})`} className="wo-cloud-edge" />
    </svg>
  )
}

function SkyGlyph({ condition, className }: { condition: Condition; className: string }) {
  const sun = condition === "sunny" || condition === "partly-cloudy"
  const moon = condition === "night" || condition === "night-cloudy"
  const cloudy = condition !== "sunny" && condition !== "night"
  return (
    <div className={"wo-sg " + className + (cloudy ? " wo-sg-cloudy" : "")} aria-hidden="true">
      {sun ? <div className="wo-sg-sun" /> : null}
      {moon ? <div className="wo-sg-moon" /> : null}
      {cloudy ? (
        <>
          <SkyCloud className="wo-sg-back" w={15} />
          <SkyCloud className="wo-sg-front" w={21} />
        </>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The scrub: the pointer's x is a time of day. By day the arc runs 6 AM → 8 PM,
// by night 6 PM → 6 AM. At rest the spring sits on the current hour.

const ARC = { day: { from: 6, span: 14 }, night: { from: 18, span: 12 } }

function scrubOf(minutes: number, night: boolean) {
  const a = night ? ARC.night : ARC.day
  const since = (((minutes / 60 - a.from) % 24) + 24) % 24
  return Math.max(-1, Math.min(1, (since / a.span) * 2 - 1))
}

function hourOf(s: number, night: boolean) {
  const a = night ? ARC.night : ARC.day
  return (Math.round(a.from + ((s + 1) / 2) * a.span) + 24) % 24
}

const fmtHourSpaced = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`

/**
 * `--scrub` (k=60 c=11) chases the pointer's x while hovering and eases back
 * to the current hour on leave. The big temperature, the hour label and the
 * hourly row's highlight are written straight to the DOM when the hour
 * changes, so nothing re-renders per frame.
 */
function useScrub(worldRef: React.RefObject<HTMLDivElement | null>, now: Now) {
  const { onFrame, frame, hover, open } = useGlass()
  const rest = scrubOf(now.clock.minutes, now.night)
  const live = React.useRef({ hover, open, rest, night: now.night })
  const kickRef = React.useRef<() => void>(() => {})
  React.useEffect(() => {
    live.current = { hover, open, rest, night: now.night }
    kickRef.current()
  }, [hover, open, rest, now.night])
  React.useEffect(() => {
    const world = worldRef.current
    if (!world) return
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
    const temp = world.querySelector<HTMLElement>(".wo-temp")
    const tempScrub = world.querySelector<HTMLElement>(".wo-t-scrub")
    const label = world.querySelector<HTMLElement>(".wo-hour-label")
    const cols = Array.from(world.querySelectorAll<HTMLElement>("[data-h]"))
    let s = live.current.rest
    let v = 0
    // how much we are scrubbing: the pointer is over it (focus alone does not count)
    let on = 0
    let onV = 0
    let raf = 0
    let last = 0
    let shown = ""
    const write = () => {
      world.style.setProperty("--scrub", s.toFixed(4))
      world.style.setProperty("--scrub-on", on.toFixed(4))
      const L = live.current
      const scrubbing = (L.hover && !L.open) || Math.abs(s - L.rest) > 0.04
      const h = hourOf(s, L.night)
      const key = scrubbing ? String(h) : ""
      if (key === shown) return
      shown = key
      temp?.setAttribute("data-scrub", scrubbing ? "1" : "0")
      if (scrubbing) {
        if (tempScrub) tempScrub.textContent = String(tempAt(h))
        if (label) label.textContent = fmtHourSpaced(h)
      }
      cols.forEach((c) => c.toggleAttribute("data-on", scrubbing && Number(c.dataset.h) === h))
    }
    const step = (t: number) => {
      raf = 0
      const dt = last ? Math.min(1 / 30, (t - last) / 1000) : 1 / 60
      last = t
      const L = live.current
      const active = L.hover && !L.open
      const target = active ? frame.current.px : L.rest
      const onT = active ? 1 : 0
      if (reduce) {
        s = target
        v = 0
        on = onT
        onV = 0
      } else {
        v += (-60 * (s - target) - 11 * v) * dt
        s += v * dt
        onV += (-95 * (on - onT) - 13 * onV) * dt
        on += onV * dt
      }
      const moving = Math.abs(s - target) > 0.0008 || Math.abs(v) > 0.0008 || Math.abs(on - onT) > 0.001 || Math.abs(onV) > 0.001
      if (!moving) {
        s = target
        v = 0
        on = onT
        onV = 0
      }
      write()
      if (moving) raf = requestAnimationFrame(step)
      else last = 0
    }
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(step)
    }
    kickRef.current = kick
    write()
    const off = onFrame(kick)
    return () => {
      off()
      cancelAnimationFrame(raf)
      kickRef.current = () => {}
    }
  }, [worldRef, onFrame, frame])
}

/**
 * Rows that come in one after another: each gets its own spring (k=80 c=12),
 * started 50 ms after the one before, written to the row as `--r`.
 */
function useRows(els: React.RefObject<(HTMLElement | null)[]>, count: number, open: boolean) {
  const first = React.useRef(true)
  const st = React.useRef<{ r: number[]; v: number[]; at: number[]; raf: number; last: number } | null>(null)
  React.useEffect(() => {
    if (!st.current) st.current = { r: Array(count).fill(0), v: Array(count).fill(0), at: Array(count).fill(0), raf: 0, last: 0 }
    const S = st.current
    if (first.current) {
      first.current = false
      if (!open) return
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
    const target = open ? 1 : 0
    const now = performance.now()
    for (let i = 0; i < count; i++) S.at[i] = now + (open ? i * 50 : (count - 1 - i) * 25)
    const write = () => {
      for (let i = 0; i < count; i++) els.current[i]?.style.setProperty("--r", S.r[i].toFixed(4))
    }
    if (reduce) {
      S.r.fill(target)
      write()
      return
    }
    const step = (t: number) => {
      const dt = S.last ? Math.min(1 / 30, (t - S.last) / 1000) : 1 / 60
      S.last = t
      let active = false
      for (let i = 0; i < count; i++) {
        if (t < S.at[i]) {
          active = true
          continue
        }
        S.v[i] += (-80 * (S.r[i] - target) - 12 * S.v[i]) * dt
        S.r[i] += S.v[i] * dt
        if (Math.abs(S.r[i] - target) > 0.0008 || Math.abs(S.v[i]) > 0.0008) active = true
        else {
          S.r[i] = target
          S.v[i] = 0
        }
      }
      write()
      S.raf = active ? requestAnimationFrame(step) : 0
      if (!S.raf) S.last = 0
    }
    if (!S.raf) S.raf = requestAnimationFrame(step)
  }, [els, count, open])
  React.useEffect(
    () => () => {
      if (st.current) cancelAnimationFrame(st.current.raf)
    },
    [],
  )
}

// ---------------------------------------------------------------------------
// Pieces

type Now = { temp: number; night: boolean; condition: Condition; clock: Clock }

function Temp({ now }: { now: Now }) {
  return (
    <div className="wo-temp">
      <span className="wo-t-now">{now.temp}</span>
      <span className="wo-t-scrub" />
      <span className="wo-deg">°</span>
    </div>
  )
}

function RangeBar({ lo, hi, min, max, dot }: { lo: number; hi: number; min: number; max: number; dot?: number }) {
  const span = Math.max(1, max - min)
  const pct = (v: number) => Math.round(((v - min) / span) * 1000) / 10 + "%"
  return (
    <div className="wo-bar" aria-hidden="true">
      <div
        className="wo-bar-fill"
        style={{ left: pct(lo), width: Math.round(((hi - lo) / span) * 1000) / 10 + "%", background: `linear-gradient(90deg, ${tempColor(lo)}, ${tempColor(hi)})` }}
      />
      {dot !== undefined ? <div className="wo-bar-dot" style={{ left: pct(Math.min(hi, Math.max(lo, dot))) }} /> : null}
    </div>
  )
}

function HourRow({ hours, className }: { hours: Hour[]; className?: string }) {
  return (
    <ul className={"wo-hours" + (className ? " " + className : "")}>
      {hours.map((h) => (
        <li key={h.key} className="wo-hour" data-h={((Number(h.key.slice(1)) % 24) + 24) % 24}>
          <span className="wo-hour-t">{h.label}</span>
          <Glyph condition={h.condition} size={18} />
          <span className="wo-hour-v">{h.temp}°</span>
        </li>
      ))}
    </ul>
  )
}

function DayRow({ d, min, max, night, dot }: { d: Day; min: number; max: number; night: boolean; dot?: number }) {
  return (
    <>
      <span className="wo-row-day">{d.label}</span>
      <Glyph condition={dot !== undefined ? forNight(d.condition, night) : d.condition} size={18} />
      <span className="wo-row-lo">{d.lo}°</span>
      <RangeBar lo={d.lo} hi={d.hi} min={min} max={max} dot={dot} />
      <span className="wo-row-hi">{d.hi}°</span>
    </>
  )
}

/** The native current block. Open slides it up and away inside the card. */
function Current({ now }: { now: Now }) {
  return (
    <div className="wo-current">
      <div className="wo-city">
        {CITY}
        <Arrow />
      </div>
      <Temp now={now} />
      <div className="wo-hour-label" aria-hidden="true" />
      <SkyGlyph condition={now.condition} className="wo-now-glyph" />
      <div className="wo-summary">
        <span className="wo-cond">{LABEL[now.condition]}</span>
        <span className="wo-hl go-mono">
          H:{HI}° L:{LO}°
        </span>
      </div>
    </div>
  )
}

/** What the current block compresses to when open: one line. */
function Header({ now }: { now: Now }) {
  return (
    <div className="wo-header" aria-hidden="true">
      <span className="wo-header-city">{CITY}</span>
      <span className="wo-header-dot">·</span>
      <span className="wo-header-temp">{now.temp}°</span>
      <span className="wo-header-dot">·</span>
      <span className="wo-header-cond">{LABEL[now.condition]}</span>
    </div>
  )
}

function useDays(now: Now, count: number) {
  const days = forecast(now.clock, count)
  return { days, min: Math.min(...days.map((d) => d.lo)), max: Math.max(...days.map((d) => d.hi)) }
}

function Small({ now, open }: { now: Now; open: boolean }) {
  const { days, min, max } = useDays(now, 6)
  const rows = React.useRef<(HTMLElement | null)[]>([])
  useRows(rows, days.length, open)
  return (
    <>
      <Current now={now} />
      <Header now={now} />
      <ul className="wo-list wo-list-small" aria-hidden="true">
        {days.map((d, i) => (
          <li
            key={d.key}
            ref={(el) => {
              rows.current[i] = el
            }}
            className="wo-row wo-row-in"
            style={{ top: 38 + i * 21 } as React.CSSProperties}
          >
            <DayRow d={d} min={min} max={max} night={now.night} dot={i === 0 ? now.temp : undefined} />
          </li>
        ))}
      </ul>
    </>
  )
}

function Medium({ now, open }: { now: Now; open: boolean }) {
  const hours = hourly(now.clock, 12)
  const { days, min, max } = useDays(now, 6)
  const rows = React.useRef<(HTMLElement | null)[]>([])
  useRows(rows, 5, open)
  return (
    <>
      <Current now={now} />
      <Header now={now} />
      {/* the hourly row scrolls along to the later hours */}
      <div className="wo-hourly-medium">
        <HourRow hours={hours} className="wo-track" />
      </div>
      <ul className="wo-list wo-list-medium" aria-hidden="true">
        {days.slice(1).map((d, i) => (
          <li
            key={d.key}
            ref={(el) => {
              rows.current[i] = el
            }}
            className="wo-row wo-row-in"
            style={{ top: 42 + i * 23 } as React.CSSProperties}
          >
            <DayRow d={d} min={min} max={max} night={now.night} />
          </li>
        ))}
      </ul>
    </>
  )
}

/** A tiny hourly strip for one day: the curve shifted to that day's high. */
function MiniStrip({ d }: { d: Day }) {
  const shift = d.hi - HI
  return (
    <div className="wo-mini go-mono">
      {[6, 9, 12, 15, 18, 21].map((h) => (
        <span key={h}>
          <i>{h === 12 ? "12P" : h < 12 ? h + "A" : h - 12 + "P"}</i>
          {tempAt(h) + shift}°
        </span>
      ))}
    </div>
  )
}

function Large({ now, open }: { now: Now; open: boolean }) {
  const hours = hourly(now.clock, 6)
  const { days, min, max } = useDays(now, 6)
  const rows = React.useRef<(HTMLElement | null)[]>([])
  useRows(rows, days.length, open)
  return (
    <>
      <Current now={now} />
      <Header now={now} />
      <div className="wo-hourly-large">
        <HourRow hours={hours} />
      </div>
      <ul className="wo-list wo-list-large">
        {days.map((d, i) => (
          <li
            key={d.key}
            ref={(el) => {
              rows.current[i] = el
            }}
            className="wo-row wo-row-grow"
            // rest: a 28px list under the hourly row; open: 52px rows from the header down
            style={{ top: 172 + i * 28, "--dy": -128 + i * 24 + "px" } as React.CSSProperties}
          >
            <DayRow d={d} min={min} max={max} night={now.night} dot={i === 0 ? now.temp : undefined} />
            <MiniStrip d={d} />
          </li>
        ))}
      </ul>
    </>
  )
}

/** The arc the sun (or moon) travels while you scrub; behind the frost. */
function ArcBody({ night }: { night: boolean }) {
  return <div className={night ? "wo-arc wo-arc-moon" : "wo-arc wo-arc-sun"} aria-hidden="true" />
}

// `now` comes down through context so the hooks below share one source
const NowCtx = React.createContext<Now | null>(null)

function World({ size, recipe }: { size: WidgetSize; recipe: LiquidRecipe }) {
  const now = React.useContext(NowCtx) as Now
  const { open } = useGlass()
  const ref = React.useRef<HTMLDivElement>(null)
  const openSpring = useSpringVar(ref, "--open", 0, 80, 12)
  React.useEffect(() => {
    openSpring(open ? 1 : 0)
  }, [open, openSpring])
  useScrub(ref, now)
  return (
    <div ref={ref} className="wo-world" style={{ "--scrub": scrubOf(now.clock.minutes, now.night).toFixed(4) } as React.CSSProperties}>
      <div className="wo-sky" aria-hidden="true">
        <LiquidCanvas recipe={recipe} seed={size === "small" ? 3 : size === "medium" ? 6 : 9} cells={size === "small" ? 64 : 110} />
        <div className="wo-cast wo-cast-a" />
        <div className="wo-cast wo-cast-b" />
        <div className="wo-cast wo-cast-c" />
        <ArcBody night={now.night} />
      </div>
      <GlassPane hinge="none" lean={0} openLean={0} radius={22} frost={0.9} className="wo-pane" />
      <div className="wo-clip">
        {size === "small" ? <Small now={now} open={open} /> : size === "medium" ? <Medium now={now} open={open} /> : <Large now={now} open={open} />}
      </div>
    </div>
  )
}

export function WeatherWidget({ size = "small", className, appearDelay = 0 }: { size?: WidgetSize; className?: string; appearDelay?: number }) {
  const { open, tone } = useWindowManager()
  const { w, h } = WIDGET[size]
  const clock = clockOf(useNow())
  const night = clock.ready && isNight(clock.minutes)
  const condition = forNight(conditionAt(clock.minutes / 60), night)
  const now: Now = { temp: tempAt(clock.minutes / 60), night, condition, clock }
  // night is smoked glass whatever the desk's tone; by day the glass follows the desk
  const glassTone = night ? "dark" : tone
  const recipe = night ? LIQUIDS.smoke : tone === "dark" ? DEEP_SKY : LIQUIDS.sky
  return (
    <GlassObject
      width={w}
      height={h}
      tone={glassTone}
      label="Weather"
      radius={24}
      tilt={2}
      appearDelay={appearDelay}
      className={"wo-root wo-" + size + (night ? " wo-night" : "") + (clock.ready ? "" : " wo-wait") + (className ? " " + className : "")}
      onActivate={() => open("weather", { singleton: "app", title: "Weather", w: 720, h: 520 })}
    >
      <style href="weather-object" precedence="glass-widget">{WO_CSS}</style>
      <div className="wo-back" aria-hidden="true" />
      <NowCtx.Provider value={now}>
        <World size={size} recipe={recipe} />
      </NowCtx.Provider>
    </GlassObject>
  )
}

const WO_CSS = `
.wo-root .go-tilt { border-radius: 24px; }
.wo-back { position: absolute; inset: 0; border-radius: 24px; box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 .5px rgba(0,0,0,.1); }
.wo-root[data-tone="dark"] .wo-back { box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 0 0 .5px rgba(255,255,255,.1); }
.wo-wait .wo-clip { visibility: hidden; }

.wo-world { position: absolute; inset: 0; --open: 0; --open-v: 0; --scrub-on: 0; }
/* everything moves inside the card: nothing crosses its edge */
.wo-clip { position: absolute; inset: 0; border-radius: 24px; overflow: hidden; }

/* the sky light, and the time of day cast over it as you scrub */
.wo-sky { position: absolute; inset: 0; border-radius: 24px; overflow: hidden; }
.wo-sky .go-liquid { border-radius: 0; }
.wo-cast { position: absolute; inset: 0; }
/* dawn-warm at the left end of the arc, noon-blue in the middle, dusk-orange at the right */
.wo-cast-a {
  background: radial-gradient(120% 90% at 0% 100%, rgba(255,186,140,.85), rgba(255,214,170,.35) 55%, rgba(255,220,180,0) 80%);
  opacity: calc(clamp(0, calc(var(--scrub) * -1), 1) * (.35 + var(--scrub-on) * .65));
}
.wo-cast-b {
  background: radial-gradient(120% 90% at 50% 0%, rgba(120,175,255,.6), rgba(150,195,255,.2) 60%, rgba(150,195,255,0) 85%);
  opacity: calc((1 - max(var(--scrub), calc(var(--scrub) * -1))) * (.3 + var(--scrub-on) * .7));
}
.wo-cast-c {
  background: radial-gradient(120% 90% at 100% 100%, rgba(255,140,70,.85), rgba(255,170,110,.35) 55%, rgba(255,170,110,0) 80%);
  opacity: calc(clamp(0, var(--scrub), 1) * (.35 + var(--scrub-on) * .65));
}
.wo-night .wo-cast-a, .wo-night .wo-cast-c { background: radial-gradient(120% 90% at 0% 100%, rgba(140,100,190,.6), rgba(140,100,190,0) 75%); }
.wo-night .wo-cast-c { background: radial-gradient(120% 90% at 100% 100%, rgba(120,110,200,.6), rgba(120,110,200,0) 75%); }
.wo-night .wo-cast-b { background: radial-gradient(120% 90% at 50% 0%, rgba(60,90,170,.55), rgba(60,90,170,0) 80%); }

/* the sun on its arc: x follows the scrub, y the square of it */
.wo-arc {
  position: absolute; left: 50%; top: var(--arc-top); width: 30px; height: 30px; margin-left: -15px; border-radius: 50%;
  transform: translate(calc(var(--scrub) * var(--arc-x)), calc(var(--scrub) * var(--scrub) * var(--arc-y)));
  opacity: clamp(0, var(--scrub-on), 1);
}
.wo-arc-sun { background: radial-gradient(circle at 42% 38%, #fffbe0, #ffd84a 45%, #ffae1a); box-shadow: 0 0 22px 8px rgba(255,190,50,.55); }
.wo-arc-moon { background: radial-gradient(circle at 40% 36%, #fffdf2, #efe6c4 60%, #c9bd92); box-shadow: 0 0 20px 6px rgba(240,230,200,.35); }
.wo-small { --arc-top: 8px; --arc-x: 62px; --arc-y: 56px; }
.wo-medium { --arc-top: 6px; --arc-x: 150px; --arc-y: 50px; }
.wo-large { --arc-top: 8px; --arc-x: 150px; --arc-y: 90px; }

/* the pane: flat, frosted, thin enough that the sky's cast comes through */
.wo-root .wo-pane .go-pane-tint {
  background: linear-gradient(180deg, rgba(var(--go-glass), .2) 0%, rgba(var(--go-glass), .38) 55%, rgba(var(--go-glass), .56) 100%);
}
.wo-root[data-tone="dark"] .wo-pane .go-pane-tint {
  background: linear-gradient(180deg, rgba(var(--go-glass), .3) 0%, rgba(var(--go-glass), .46) 55%, rgba(var(--go-glass), .6) 100%);
}

/* the native current block; open slides it up and away */
.wo-current {
  position: absolute; inset: 0;
  opacity: clamp(0, calc(1 - var(--open) * 1.7), 1);
  transform: translateY(calc(var(--open) * -26px));
}
.wo-city {
  position: absolute; left: 16px; top: 14px;
  display: flex; align-items: center; gap: 4px;
  font-size: 13px; font-weight: 600; letter-spacing: -.01em; white-space: nowrap;
}
.wo-arrow { fill: currentColor; }
.wo-temp {
  position: absolute; left: 14px; top: 30px;
  font-size: 40px; font-weight: 250; line-height: 1; letter-spacing: -.035em;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.wo-t-scrub { display: none; }
.wo-temp[data-scrub="1"] .wo-t-now { display: none; }
.wo-temp[data-scrub="1"] .wo-t-scrub { display: inline; }
.wo-hour-label {
  position: absolute; left: 17px; top: 71px;
  font-size: 10px; font-weight: 600; color: var(--go-ink-soft); white-space: nowrap; letter-spacing: .01em;
  opacity: clamp(0, var(--scrub-on), 1);
  transform: translateY(calc((1 - var(--scrub-on)) * -3px));
}
.wo-summary { position: absolute; left: 16px; bottom: 14px; display: flex; flex-direction: column; gap: 1px; }
.wo-cond { font-size: 11px; font-weight: 600; white-space: nowrap; }
.wo-hl { font-size: 11px; color: var(--go-ink-soft); white-space: nowrap; letter-spacing: 0; }

/* the one-line header it compresses to */
.wo-header {
  position: absolute; left: 16px; right: 16px; top: 14px;
  display: flex; align-items: baseline; gap: 5px; white-space: nowrap; overflow: hidden;
  font-size: 13px; font-variant-numeric: tabular-nums;
  opacity: clamp(0, calc((var(--open) - .35) * 1.6), 1);
  transform: translateY(calc((1 - var(--open)) * 12px));
}
.wo-header-city { font-weight: 600; }
.wo-header-temp { font-weight: 400; }
.wo-header-dot { color: var(--go-ink-soft); }
.wo-header-cond { color: var(--go-ink-soft); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }

/* the sky glyph: a real sun, moon and clouds */
.wo-sg { position: absolute; width: 28px; height: 28px; }
.wo-sg-sun, .wo-sg-moon {
  position: absolute; left: 4px; top: 4px; width: 20px; height: 20px; border-radius: 50%;
}
.wo-sg-sun {
  background: radial-gradient(circle at 40% 36%, #fff6c4 0%, #ffd84a 42%, #ffb81c 100%);
  box-shadow: 0 0 0 .5px rgba(230,150,0,.3), 0 0 10px 1px rgba(255,190,40,.45);
}
.wo-sg-moon { background: transparent; box-shadow: inset 6px -3px 0 0 #f1e7c2; filter: drop-shadow(0 0 4px rgba(241,231,194,.4)); }
.wo-root:not([data-tone="dark"]) .wo-sg-moon { box-shadow: inset 6px -3px 0 0 #c9b97a; }
.wo-sg-cloudy .wo-sg-sun, .wo-sg-cloudy .wo-sg-moon { left: 2px; top: 1px; width: 16px; height: 16px; }
.wo-sg-cloud { position: absolute; display: block; overflow: visible; filter: drop-shadow(0 1.5px 2px rgba(30,50,80,.2)); }
.wo-sg-front { left: 7px; top: 12px; }
.wo-sg-back { left: -1px; top: 14px; opacity: .85; }
.wo-c0 { stop-color: #ffffff; }
.wo-c1 { stop-color: #dbe3ee; }
.wo-cloud-edge { stroke: rgba(40,52,70,.16); stroke-width: .5; }
.wo-root[data-tone="dark"] .wo-c0 { stop-color: #e4eaf2; }
.wo-root[data-tone="dark"] .wo-c1 { stop-color: #9aa6b8; }
.wo-night .wo-c0 { stop-color: #8a93a6; }
.wo-night .wo-c1 { stop-color: #4f586b; }

/* glyphs in rows */
.wo-glyph { display: block; flex: none; overflow: visible; }
.wo-g-ray { stroke: #ffb800; stroke-width: 2; stroke-linecap: round; }
.wo-g-sun { fill: #ffcf24; }
.wo-g-moon { fill: #f1e7c2; }
.wo-root:not([data-tone="dark"]) .wo-g-moon { fill: #c9b97a; }
.wo-g-cloud { fill: #ffffff; stroke: rgba(40,52,70,.22); stroke-width: .6; }
.wo-g-grey { fill: #b9c3cf; }
.wo-root[data-tone="dark"] .wo-g-cloud { fill: #d5dce6; stroke: none; }
.wo-root[data-tone="dark"] .wo-g-grey { fill: #8d99aa; }
.wo-g-rain { stroke: #4fb3ff; stroke-width: 1.7; stroke-linecap: round; }

/* hourly */
.wo-hours { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); }
.wo-hour { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 6px 0; font-variant-numeric: tabular-nums; }
.wo-hour::before {
  content: ""; position: absolute; inset: 0 2px; border-radius: 9px; z-index: -1;
  background: rgba(var(--go-glass), .7);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.8), 0 0 0 .5px rgba(0,0,0,.06);
  opacity: 0;
}
.wo-root[data-tone="dark"] .wo-hour::before { background: rgba(255,255,255,.1); box-shadow: inset 0 1px 0 rgba(255,255,255,.12); }
.wo-hour[data-on]::before { opacity: 1; }
.wo-hour-t { font-size: 10px; font-weight: 500; color: var(--go-ink-soft); white-space: nowrap; }
.wo-hour[data-on] .wo-hour-t { color: var(--go-ink); }
.wo-hour-v { font-size: 11px; font-weight: 600; white-space: nowrap; }

/* day rows */
.wo-list { list-style: none; margin: 0; padding: 0; position: absolute; }
.wo-row { position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; }
.wo-row-day { width: 44px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.wo-row-lo, .wo-row-hi { width: 26px; font-size: 12px; font-weight: 500; }
.wo-row-lo { text-align: right; color: var(--go-ink-soft); }
.wo-row-hi { font-weight: 600; }
.wo-bar { position: relative; flex: 1; height: 4px; border-radius: 4px; background: var(--go-ink-faint); }
.wo-bar-fill { position: absolute; top: 0; bottom: 0; border-radius: 4px; transform-origin: 0 50%; }
.wo-bar-dot { position: absolute; top: 50%; width: 6px; height: 6px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 1.5px rgba(0,0,0,.35); transform: translate(-50%, -50%); }

/* rows that come in on open: they rise (or slide) in, and the bar draws itself */
.wo-row-in { --r: 0; height: 20px; opacity: clamp(0, calc(var(--r) * 1.6 - .2), 1); }
.wo-row-in .wo-bar-fill { transform: scaleX(clamp(0, calc(var(--r) * 1.15 - .15), 1.04)); }
.wo-row-in .wo-bar-dot { opacity: clamp(0, calc(var(--r) * 3 - 2), 1); }

/* small */
.wo-small .wo-now-glyph { left: 14px; top: 84px; }
.wo-list-small { left: 12px; right: 12px; top: 0; bottom: 0; }
.wo-list-small .wo-row { gap: 5px; transform: translateY(calc((1 - var(--r)) * 140px)); }
.wo-list-small .wo-row-day { width: 32px; font-size: 10.5px; }
.wo-list-small .wo-glyph { width: 14px; height: 14px; }
.wo-list-small .wo-row-lo, .wo-list-small .wo-row-hi { width: 19px; font-size: 10.5px; }

/* medium */
.wo-medium .wo-now-glyph { left: 14px; top: 84px; }
.wo-hourly-medium { position: absolute; left: 160px; right: 10px; top: 12px; bottom: 12px; overflow: hidden; display: grid; align-content: center; }
.wo-track { width: 200%; grid-template-columns: repeat(12, minmax(0, 1fr)); transform: translateX(calc(var(--open) * -50%)); }
.wo-list-medium { left: 14px; width: 140px; top: 0; bottom: 0; }
.wo-list-medium .wo-row { gap: 5px; transform: translateX(calc((1 - var(--r)) * -160px)); }
.wo-list-medium .wo-row-day { width: 28px; font-size: 10.5px; }
.wo-list-medium .wo-glyph { width: 15px; height: 15px; }
.wo-list-medium .wo-row-lo, .wo-list-medium .wo-row-hi { width: 19px; font-size: 10.5px; }

/* large */
.wo-large .wo-now-glyph { left: auto; right: 16px; top: 14px; }
.wo-large .wo-summary { left: auto; right: 16px; top: 48px; bottom: auto; align-items: flex-end; }
.wo-large .wo-hour-label { top: 74px; left: 18px; }
.wo-hourly-large {
  position: absolute; left: 10px; right: 10px; top: 92px; height: 64px;
  display: grid; align-content: center;
  border-top: .5px solid var(--go-ink-faint);
  opacity: clamp(0, calc(1 - var(--open) * 2), 1);
  transform: translateY(calc(var(--open) * -30px));
}
.wo-list-large { left: 16px; right: 16px; top: 0; bottom: 0; }
.wo-list-large::before { content: ""; position: absolute; left: 0; right: 0; top: 172px; border-top: .5px solid var(--go-ink-faint); opacity: calc(1 - var(--open)); }
.wo-row-grow { --r: 0; height: 28px; transform: translateY(calc(var(--r) * var(--dy))); }
.wo-mini {
  position: absolute; left: 52px; right: 0; top: 25px; height: 18px;
  display: flex; justify-content: space-between;
  font-size: 9.5px; color: var(--go-ink-soft); white-space: nowrap;
  opacity: clamp(0, calc(var(--r) * 1.6 - .5), 1);
  transform: translateY(calc((1 - var(--r)) * -8px));
}
.wo-mini i { font-style: normal; margin-right: 3px; opacity: .65; }
`
