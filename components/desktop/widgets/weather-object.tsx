"use client"

import * as React from "react"
import {
  GlassObject,
  GlassPane,
  GlassSheet,
  LIQUIDS,
  LiquidCanvas,
  useGlass,
  useSpringVar,
  type LiquidRecipe,
} from "@/components/ui/glass-object"
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
 * night) that casts through a frosted pane hinged on its bottom edge; the
 * current conditions standing in front of the pane, with a real sun, moon and
 * clouds; and a pocket at the bottom holding the forecast.
 *
 * - **Hover**: the object lifts, the pane leans back, the sun rises 4px and
 *   the clouds part. The sky's light lags the tilt on a slow pendulum
 *   (`--slosh`, k=18 c=2.6, chasing px·hover).
 * - **Open** (click): the pane hinges down and away, the temperature shrinks
 *   toward the top, and the forecast comes up out of the pocket: six hourly
 *   chips, 140ms apart, each caught on an arc by a spring (k=200 c=13) and
 *   squashing a pixel as it lands (small); the right half turns over on its
 *   axle to the five-day outlook (medium, `--plaque`); six day rows rise as
 *   sheets over the list (large). Close reverses it.
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
// The pocket: forecast pieces that rise out of the bottom edge and are caught
// by a spring in their slots. One rAF loop, written straight to the DOM.

type Slot = { x: number; y: number; r: number }

/** Slots on the lower arc of a circle, each tilted to `lean` of the tangent. */
function arcSlots(cx: number, cy: number, r: number, from: number, to: number, n: number, lean: number): Slot[] {
  const r2 = (v: number) => Math.round(v * 100) / 100
  return Array.from({ length: n }, (_, i) => {
    const a = ((from + ((to - from) * i) / (n - 1)) * Math.PI) / 180
    const tangent = (Math.atan2(-Math.cos(a), -Math.sin(a)) * 180) / Math.PI
    return { x: r2(cx + r * Math.cos(a)), y: r2(cy - r * Math.sin(a)), r: r2(tangent * lean) }
  })
}

type Pocket = { w: number; h: number; slots: Slot[]; /** stagger between pieces, ms */ gap: number; /** where they wait, below the edge */ from: number }

const POCKETS: Record<"small" | "large", Pocket> = {
  // six 26×40 chips on an arc of r=74 about (85, 50), between 220° and 320°
  small: { w: 26, h: 40, slots: arcSlots(85, 50, 74, 220, 320, 6, 0.4), gap: 140, from: 200 },
  // six day rows, Today on top
  large: { w: 340, h: 26, slots: Array.from({ length: 6 }, (_, i) => ({ x: 182, y: 186 + i * 28, r: 0 })), gap: 70, from: 400 },
}

const pieceTransform = (x: number, y: number, w: number, h: number, r: number, sq: number) =>
  `translate(${(x - w / 2).toFixed(2)}px, ${(y - h / 2).toFixed(2)}px) rotate(${r.toFixed(2)}deg) scale(1, ${(1 - sq / h).toFixed(4)})`

type Piece = { x: number; y: number; vx: number; vy: number; rot: number; rv: number; o: number; ov: number; sq: number; sqv: number; up: boolean; at: number; landed: boolean }

function usePocket(P: Pocket | null, els: React.RefObject<(HTMLDivElement | null)[]>, open: boolean) {
  const first = React.useRef(true)
  const state = React.useRef<{ ps: Piece[]; raf: number; last: number } | null>(null)
  React.useEffect(() => {
    if (!P) return
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
    if (!state.current) {
      state.current = {
        ps: P.slots.map((s) => ({ x: s.x, y: P.from, vx: 0, vy: 0, rot: 0, rv: 0, o: 0, ov: 0, sq: 0, sqv: 0, up: false, at: 0, landed: false })),
        raf: 0,
        last: 0,
      }
    }
    const st = state.current
    if (first.current) {
      first.current = false
      if (!open) return
    }
    const n = P.slots.length
    const now = performance.now()
    st.ps.forEach((p, i) => {
      p.up = open
      p.landed = false
      // up: one by one; down: all together, the last one first
      p.at = now + (open ? 120 + i * P.gap : (n - 1 - i) * 30)
    })
    const write = () => {
      st.ps.forEach((p, i) => {
        const el = els.current[i]
        if (!el) return
        el.style.transform = pieceTransform(p.x, p.y, P.w, P.h, p.rot, Math.max(-1.5, Math.min(1.5, p.sq)))
        el.style.opacity = Math.max(0, Math.min(1, p.o)).toFixed(3)
      })
    }
    if (reduce) {
      st.ps.forEach((p, i) => {
        const s = P.slots[i]
        p.x = s.x
        p.y = open ? s.y : P.from
        p.rot = open ? s.r : 0
        p.o = open ? 1 : 0
      })
      write()
      return
    }
    const step = (t: number) => {
      const dt = st.last ? Math.min(1 / 30, (t - st.last) / 1000) : 1 / 60
      st.last = t
      let active = false
      st.ps.forEach((p, i) => {
        const s = P.slots[i]
        if (t < p.at) {
          active = true
          return
        }
        // caught by a stiff, bouncy spring on the way up; let go more softly on the way down
        const k = p.up ? 200 : 170
        const c = p.up ? 13 : 22
        const ty = p.up ? s.y : P.from
        const tr = p.up ? s.r : 0
        const prevY = p.y
        p.vx += (-k * (p.x - s.x) - c * p.vx) * dt
        p.vy += (-k * (p.y - ty) - c * p.vy) * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.rv += (-k * (p.rot - tr) - c * p.rv) * dt
        p.rot += p.rv * dt
        p.ov += (-260 * (p.o - (p.up ? 1 : 0)) - 32 * p.ov) * dt
        p.o += p.ov * dt
        if (p.up && !p.landed && prevY > s.y && p.y <= s.y) {
          // it overshoots its slot and drops back into it: a pixel of squash
          p.landed = true
          p.sqv += Math.min(34, Math.max(14, -p.vy * 0.08))
        }
        p.sqv += (-600 * p.sq - 30 * p.sqv) * dt
        p.sq += p.sqv * dt
        const moving =
          Math.abs(p.y - ty) + Math.abs(p.vy) + Math.abs(p.rot - tr) + Math.abs(p.rv) > 0.02 ||
          Math.abs(p.sq) + Math.abs(p.sqv) > 0.01 ||
          Math.abs(p.o - (p.up ? 1 : 0)) + Math.abs(p.ov) > 0.004
        if (moving) active = true
        else {
          p.y = ty
          p.rot = tr
          p.vy = p.rv = p.sq = p.sqv = p.ov = 0
          p.o = p.up ? 1 : 0
        }
      })
      write()
      st.raf = active ? requestAnimationFrame(step) : 0
      if (!st.raf) st.last = 0
    }
    if (!st.raf) st.raf = requestAnimationFrame(step)
  }, [P, els, open])
  React.useEffect(
    () => () => {
      if (state.current) cancelAnimationFrame(state.current.raf)
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
      {now.temp}
      <span className="wo-deg">°</span>
    </div>
  )
}

function City() {
  return (
    <div className="wo-city">
      {CITY}
      <Arrow />
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

function HourRow({ hours }: { hours: Hour[] }) {
  return (
    <ul className="wo-hours">
      {hours.map((h) => (
        <li key={h.key} className="wo-hour">
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

/** The current conditions: in front of the pane, so they stay when it hinges away. */
function Current({ now }: { now: Now }) {
  return (
    <>
      <City />
      <Temp now={now} />
      <SkyGlyph condition={now.condition} className="wo-now-glyph" />
    </>
  )
}

/** Printed on the pane: hinges away with it. */
function Summary({ now }: { now: Now }) {
  return (
    <div className="wo-summary">
      <span className="wo-cond">{LABEL[now.condition]}</span>
      <span className="wo-hl go-mono">
        H:{HI}° L:{LO}°
      </span>
    </div>
  )
}

function Small({ now, open }: { now: Now; open: boolean }) {
  const hours = hourly(now.clock, 6)
  const els = React.useRef<(HTMLDivElement | null)[]>([])
  const P = POCKETS.small
  usePocket(P, els, open)
  return (
    <>
      <GlassPane hinge="bottom" lean={-9} openLean={-70} openShift={14} openFade={0.8} radius={22} frost={0.9} className="wo-pane">
        <Summary now={now} />
      </GlassPane>
      <div className="wo-front">
        <Current now={now} />
      </div>
      <div className="wo-pocket" aria-hidden="true">
        {hours.map((h, i) => (
          <div
            key={h.key}
            ref={(el) => {
              els.current[i] = el
            }}
            className="wo-chip"
            // the tops lean together: the outer chips lie over the inner ones
            style={{ width: P.w, height: P.h, opacity: 0, zIndex: i < 3 ? 6 - i : i, transform: pieceTransform(P.slots[i].x, P.from, P.w, P.h, 0, 0) }}
          >
            <span className="wo-chip-t">{h.label}</span>
            <Glyph condition={h.condition} size={14} />
            <span className="wo-chip-v">{h.temp}°</span>
          </div>
        ))}
      </div>
    </>
  )
}

function Medium({ now }: { now: Now }) {
  const hours = hourly(now.clock, 6)
  const days = forecast(now.clock, 6).slice(1)
  return (
    <>
      <GlassPane hinge="bottom" lean={-9} openLean={-70} openShift={14} openFade={0.8} radius={22} frost={0.9} className="wo-pane">
        <Summary now={now} />
      </GlassPane>
      <div className="wo-front">
        <Current now={now} />
        {/* the right half turns over on a horizontal axle */}
        <div className="wo-flip" aria-hidden="true">
          <div className="wo-spin">
            <div className="wo-face wo-face-front">
              <HourRow hours={hours} />
            </div>
            <div className="wo-face wo-face-back">
              <ul className="wo-hours wo-days">
                {days.map((d) => (
                  <li key={d.key} className="wo-hour">
                    <span className="wo-hour-t wo-day-t">{d.label}</span>
                    <Glyph condition={d.condition} size={18} />
                    <span className="wo-hour-v">
                      {d.hi}°<span className="wo-day-lo">{d.lo}°</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function Large({ now, open }: { now: Now; open: boolean }) {
  const hours = hourly(now.clock, 6)
  const days = forecast(now.clock, 6)
  const min = Math.min(...days.map((d) => d.lo))
  const max = Math.max(...days.map((d) => d.hi))
  const els = React.useRef<(HTMLDivElement | null)[]>([])
  const P = POCKETS.large
  usePocket(P, els, open)
  return (
    <>
      <GlassPane hinge="bottom" lean={-9} openLean={-70} openShift={14} openFade={0.8} radius={22} frost={0.9} className="wo-pane">
        <Summary now={now} />
        <ul className="wo-list">
          {days.map((d, i) => (
            <li key={d.key} className="wo-row">
              <DayRow d={d} min={min} max={max} night={now.night} dot={i === 0 ? now.temp : undefined} />
            </li>
          ))}
        </ul>
      </GlassPane>
      <div className="wo-front">
        <Current now={now} />
        <div className="wo-hourly-large">
          <HourRow hours={hours} />
        </div>
      </div>
      <div className="wo-pocket" aria-hidden="true">
        {days.map((d, i) => (
          <div
            key={d.key}
            ref={(el) => {
              els.current[i] = el
            }}
            className="wo-sheet-slot"
            style={{ width: P.w, height: P.h, opacity: 0, transform: pieceTransform(P.slots[i].x, P.from, P.w, P.h, 0, 0) }}
          >
            <GlassSheet className="wo-sheet">
              <DayRow d={d} min={min} max={max} night={now.night} dot={i === 0 ? now.temp : undefined} />
            </GlassSheet>
          </div>
        ))}
      </div>
    </>
  )
}

/** The sky light behind the pane; its light lags the tilt on a slow pendulum. */
function Sky({ size, recipe }: { size: WidgetSize; recipe: LiquidRecipe }) {
  const { onFrame, open } = useGlass()
  const ref = React.useRef<HTMLDivElement>(null)
  const slosh = useSpringVar(ref, "--slosh", 0, 18, 2.6)
  const plaque = useSpringVar(ref, "--plaque", 0, 110, 12)
  React.useEffect(() => onFrame((f) => slosh(f.px * f.hover)), [onFrame, slosh])
  React.useEffect(() => {
    plaque(open ? 1 : 0, { delay: open ? 120 : 0 })
  }, [open, plaque])
  return (
    <div ref={ref} className="wo-world">
      <div className="wo-sky" aria-hidden="true">
        <LiquidCanvas recipe={recipe} seed={size === "small" ? 3 : size === "medium" ? 6 : 9} cells={size === "small" ? 44 : 72} />
      </div>
      <Body size={size} />
    </div>
  )
}

// the body reads open from the engine; `now` comes down through context
const NowCtx = React.createContext<Now | null>(null)

function Body({ size }: { size: WidgetSize }) {
  const now = React.useContext(NowCtx)
  const { open } = useGlass()
  if (!now) return null
  return size === "small" ? <Small now={now} open={open} /> : size === "medium" ? <Medium now={now} /> : <Large now={now} open={open} />
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
      appearDelay={appearDelay}
      className={"wo-root wo-" + size + (night ? " wo-night" : "") + (clock.ready ? "" : " wo-wait") + (className ? " " + className : "")}
      onActivate={() => open("weather", { singleton: "app", title: "Weather", w: 720, h: 520 })}
    >
      <style href="weather-object" precedence="glass-widget">{WO_CSS}</style>
      <div className="wo-back" aria-hidden="true" />
      <NowCtx.Provider value={now}>
        <Sky size={size} recipe={recipe} />
      </NowCtx.Provider>
    </GlassObject>
  )
}

const WO_CSS = `
.wo-root .go-tilt { border-radius: 24px; }
.wo-back { position: absolute; inset: 0; border-radius: 24px; box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 .5px rgba(0,0,0,.1); }
.wo-root[data-tone="dark"] .wo-back { box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 0 0 .5px rgba(255,255,255,.1); }
.wo-wait .wo-front, .wo-wait .go-pane-body, .wo-wait .wo-pocket { visibility: hidden; }

.wo-world { position: absolute; inset: 0; --slosh: 0; --slosh-v: 0; --plaque: 0; --plaque-v: 0; }

/* the sky light: it lags the tilt, so the cast through the frost moves like liquid */
.wo-sky { position: absolute; inset: 0; border-radius: 24px; overflow: hidden; }
.wo-sky .go-liquid {
  border-radius: 0;
  transform: translate(calc(var(--slosh) * -9px), calc(var(--go-py) * -3px * var(--go-hover))) scale(1.12);
}

/* the pane: frosted, but thin enough that the sky's cast comes through */
.wo-root .wo-pane .go-pane-tint {
  background: linear-gradient(180deg, rgba(var(--go-glass), .2) 0%, rgba(var(--go-glass), .38) 55%, rgba(var(--go-glass), .56) 100%);
}
.wo-root[data-tone="dark"] .wo-pane .go-pane-tint {
  background: linear-gradient(180deg, rgba(var(--go-glass), .3) 0%, rgba(var(--go-glass), .46) 55%, rgba(var(--go-glass), .6) 100%);
}

/* the current conditions */
.wo-front { position: absolute; inset: 0; }
.wo-city {
  position: absolute; left: 16px; top: 14px;
  display: flex; align-items: center; gap: 4px;
  font-size: 13px; font-weight: 600; letter-spacing: -.01em; white-space: nowrap;
  transform: translateY(calc(var(--go-hover) * -1px));
}
.wo-arrow { fill: currentColor; }
.wo-temp {
  position: absolute; left: 14px; top: 30px;
  font-size: 40px; font-weight: 250; line-height: 1; letter-spacing: -.035em;
  font-variant-numeric: tabular-nums; white-space: nowrap;
  transform-origin: 0 0;
  transform: translateY(calc(var(--go-hover) * -1px)) scale(calc(1 - var(--go-open) * var(--temp-shrink, .45)));
}
.wo-deg { font-weight: 250; }
.wo-summary { position: absolute; left: 16px; bottom: 14px; display: flex; flex-direction: column; gap: 1px; }
.wo-cond { font-size: 11px; font-weight: 600; white-space: nowrap; }
.wo-hl { font-size: 11px; color: var(--go-ink-soft); white-space: nowrap; letter-spacing: 0; }

/* the sky glyph: a real sun, moon and clouds */
.wo-sg { position: absolute; width: 28px; height: 28px; transform-origin: 0 0; }
.wo-sg-sun, .wo-sg-moon {
  position: absolute; left: 4px; top: 4px; width: 20px; height: 20px; border-radius: 50%;
  transform: translateY(calc(var(--go-hover) * -4px));
}
.wo-sg-sun {
  background: radial-gradient(circle at 40% 36%, #fff6c4 0%, #ffd84a 42%, #ffb81c 100%);
  box-shadow: 0 0 0 .5px rgba(230,150,0,.3), 0 0 10px 1px rgba(255,190,40,calc(.45 + var(--go-hover) * .25));
}
.wo-sg-moon { background: transparent; box-shadow: inset 6px -3px 0 0 #f1e7c2; filter: drop-shadow(0 0 4px rgba(241,231,194,.4)); }
.wo-root:not([data-tone="dark"]) .wo-sg-moon { box-shadow: inset 6px -3px 0 0 #c9b97a; }
.wo-sg-cloudy .wo-sg-sun, .wo-sg-cloudy .wo-sg-moon { left: 2px; top: 1px; width: 16px; height: 16px; }
.wo-sg-cloud { position: absolute; display: block; overflow: visible; filter: drop-shadow(0 1.5px 2px rgba(30,50,80,.2)); }
.wo-sg-front { left: 7px; top: 12px; transform: translateX(calc(var(--go-hover) * 4px)); }
.wo-sg-back { left: -1px; top: 14px; opacity: .85; transform: translateX(calc(var(--go-hover) * -4px)); }
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
.wo-hour { display: flex; flex-direction: column; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; }
.wo-hour-t { font-size: 10px; font-weight: 500; color: var(--go-ink-soft); white-space: nowrap; }
.wo-hour-v { font-size: 11px; font-weight: 600; white-space: nowrap; }

/* the pocket the forecast rises out of */
.wo-pocket { position: absolute; inset: 0; border-radius: 24px; overflow: hidden; }
.wo-chip, .wo-sheet-slot { position: absolute; left: 0; top: 0; }
.wo-chip {
  box-sizing: border-box; border-radius: 9px;
  display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 5px 0;
  background: linear-gradient(180deg, rgba(var(--go-glass), .92), rgba(var(--go-glass), .78));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.85), 0 0 0 .5px rgba(0,0,0,.1), 0 6px 12px -6px var(--go-shadow);
  font-variant-numeric: tabular-nums;
}
.wo-root[data-tone="dark"] .wo-chip { background: linear-gradient(180deg, rgba(58,58,64,.94), rgba(40,40,46,.9)); box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 0 0 .5px rgba(255,255,255,.12), 0 6px 14px -6px var(--go-shadow); }
.wo-chip-t { font-size: 9px; font-weight: 500; letter-spacing: -.06em; color: var(--go-ink-soft); white-space: nowrap; }
.wo-chip-v { font-size: 10.5px; font-weight: 600; }

/* small */
.wo-small .wo-now-glyph {
  left: 14px; top: 84px;
  transform: translate(calc(var(--go-open) * 113px), calc(var(--go-open) * -71px)) scale(calc(1 - var(--go-open) * .15));
}
.wo-small .wo-temp { --temp-shrink: .45; }

/* medium */
.wo-medium .wo-now-glyph { left: 14px; top: 84px; }
.wo-medium .wo-temp { --temp-shrink: .1; }
.wo-flip { position: absolute; left: 160px; right: 10px; top: 12px; bottom: 12px; perspective: 700px; }
.wo-spin { position: absolute; inset: 0; transform-style: preserve-3d; transform: rotateX(calc(var(--plaque) * -180deg)); }
.wo-face {
  position: absolute; inset: 0; border-radius: 14px;
  -webkit-backface-visibility: hidden; backface-visibility: hidden;
  display: grid; align-content: center;
}
/* a glass plate shows only while it turns, and stays behind the outlook */
.wo-face-front { background: rgba(var(--go-glass), calc(sin(var(--plaque) * 180deg) * .6)); }
.wo-face-back {
  transform: rotateX(180deg);
  background: linear-gradient(180deg, rgba(var(--go-glass), .72), rgba(var(--go-glass), .56));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.8), 0 0 0 .5px rgba(0,0,0,.08), 0 8px 16px -10px var(--go-shadow);
}
.wo-root[data-tone="dark"] .wo-face-back { box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 0 0 .5px rgba(255,255,255,.1), 0 8px 16px -10px var(--go-shadow); }
.wo-face .wo-hours { padding: 0 4px; }
.wo-days { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.wo-day-t { color: var(--go-ink); font-weight: 600; }
.wo-days .wo-hour { gap: 5px; }
.wo-days .wo-hour-v { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.wo-day-lo { font-size: 10px; font-weight: 500; color: var(--go-ink-soft); }

/* large */
.wo-large .wo-now-glyph { left: auto; right: 16px; top: 14px; transform: translateY(calc(var(--go-open) * -2px)); }
.wo-large .wo-temp { --temp-shrink: .2; }
.wo-large .wo-summary { left: auto; right: 16px; top: 48px; bottom: auto; align-items: flex-end; }
.wo-hourly-large {
  position: absolute; left: 10px; right: 10px; top: 92px; height: 64px;
  display: grid; align-content: center;
  border-top: .5px solid var(--go-ink-faint);
  transform: translateY(calc(var(--go-open) * -8px));
}
.wo-list { list-style: none; margin: 0; padding: 0; position: absolute; left: 16px; right: 16px; top: 172px; border-top: .5px solid var(--go-ink-faint); }
.wo-row { height: 28px; display: flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; }
.wo-row-day { width: 44px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.wo-row-lo, .wo-row-hi { width: 26px; font-size: 12px; font-weight: 500; }
.wo-row-lo { text-align: right; color: var(--go-ink-soft); }
.wo-row-hi { font-weight: 600; }
.wo-bar { position: relative; flex: 1; height: 4px; border-radius: 4px; background: var(--go-ink-faint); }
.wo-bar-fill { position: absolute; top: 0; bottom: 0; border-radius: 4px; }
.wo-bar-dot { position: absolute; top: 50%; width: 6px; height: 6px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 1.5px rgba(0,0,0,.35); transform: translate(-50%, -50%); }
.wo-root .wo-sheet { position: absolute; inset: 0; border-radius: 9px; display: flex; align-items: center; gap: 8px; padding: 0 12px; font-variant-numeric: tabular-nums; }
`
