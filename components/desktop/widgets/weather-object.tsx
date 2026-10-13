"use client"

import * as React from "react"
import { GlassObject, GlassPane, GlassSheet, LIQUIDS, LiquidCanvas, type LiquidRecipe } from "@/components/ui/glass-object"
import { rng } from "@/components/ui/glass-folder-cards"
import { WIDGET, type WidgetSize } from "../glass"
import { useWindowManager } from "../window-manager"

/**
 * Weather — the sky as an object.
 *
 * Three layers: a sky liquid at the back (pale sky by day, smoke by night),
 * real weather in the middle (a sun with a halo, two SVG clouds; at night a
 * moon and a few stars) with the big temperature standing in it, and a frosted
 * pane carrying the city, the condition and the day's range.
 *
 * - **Rest**: the sun sits low behind the pane, the clouds drift very slowly
 *   (a rAF drift written by ref, still under reduced motion).
 * - **Hover**: the sun rises a few px, the clouds part to either side, the
 *   pane leans.
 * - **Open** (click): the pane folds down and away and the forecast rises out
 *   of the pocket: hourly chips (small), a 5-day strip (medium), a 6-day list
 *   of sheets with range bars (large).
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

function Arrow() {
  return (
    <svg viewBox="0 0 10 10" width="8" height="8" className="wo-arrow" aria-hidden="true">
      <path d="M9.2.8 1 4.4l3.6 1 1 3.6z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// The sky: sun or moon, stars, two clouds. Motion is CSS variables only; the
// slow drift is one rAF loop writing three numbers to the sky element.

const STARS = (() => {
  const r = rng(4127)
  return Array.from({ length: 14 }, (_, i) => ({
    x: Math.round(r() * 940 + 30) / 10,
    y: Math.round(r() * 520 + 30) / 10,
    s: Math.round((r() * 1.1 + 0.9) * 10) / 10,
    g: i % 2,
  }))
})()

type Spot = { x: number; y: number; d: number }
type CloudSpec = { x: number; y: number; w: number; side: -1 | 1; back?: boolean }

function Cloud({ spec, phase }: { spec: CloudSpec; phase: "a" | "b" }) {
  const id = "wo" + React.useId().replace(/[^a-zA-Z0-9_-]/g, "")
  return (
    <svg
      viewBox="3.5 8 25.5 18.5"
      width={spec.w}
      height={Math.round(spec.w * 0.725)}
      className={"wo-cloud" + (spec.back ? " wo-cloud-back" : "")}
      style={{ left: spec.x, top: spec.y, "--side": spec.side, "--drift": `var(--wo-drift-${phase})` } as React.CSSProperties}
      aria-hidden="true"
    >
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

function Sky({
  night,
  sun,
  clouds,
  openRise,
  openScale,
}: {
  night: boolean
  sun: Spot
  clouds: [CloudSpec, CloudSpec]
  openRise: number
  openScale: number
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    const write = (t: number) => {
      el.style.setProperty("--wo-drift-a", Math.sin(t * 0.11).toFixed(3))
      el.style.setProperty("--wo-drift-b", Math.sin(t * 0.083 + 2.1).toFixed(3))
      el.style.setProperty("--wo-tw", (0.5 + 0.5 * Math.sin(t * 1.4)).toFixed(3))
    }
    write(0)
    if (reduce) return
    let raf = 0
    let last = 0
    let visible = true
    const frame = (now: number) => {
      raf = 0
      if (!visible || document.hidden) return
      if (now - last >= 1000 / 30) {
        last = now
        write(now / 1000)
      }
      raf = requestAnimationFrame(frame)
    }
    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((es) => {
            visible = es.some((e) => e.isIntersecting)
            if (visible && !raf) raf = requestAnimationFrame(frame)
          })
        : null
    io?.observe(el)
    const onVis = () => {
      if (!document.hidden && !raf) raf = requestAnimationFrame(frame)
    }
    document.addEventListener("visibilitychange", onVis)
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      io?.disconnect()
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [])

  const body = night ? Math.round(sun.d * 0.72) : sun.d
  const bodyStyle = {
    left: sun.x + Math.round((sun.d - body) / 2),
    top: sun.y + Math.round((sun.d - body) / 2),
    width: body,
    height: body,
    "--open-rise": openRise + "px",
    "--open-scale": openScale,
  } as React.CSSProperties
  return (
    <div ref={ref} className="wo-sky" aria-hidden="true">
      {night ? (
        <>
          {STARS.map((s, i) => (
            <span key={i} className={"wo-star wo-star-" + s.g} style={{ left: s.x + "%", top: s.y + "%", width: s.s, height: s.s }} />
          ))}
          <div className="wo-moon" style={{ ...bodyStyle, boxShadow: `inset ${Math.round(body * 0.24)}px ${-Math.round(body * 0.1)}px 0 0 #f3ecd2` }} />
        </>
      ) : (
        <div className="wo-sun" style={bodyStyle} />
      )}
      <Cloud spec={clouds[0]} phase="a" />
      <Cloud spec={clouds[1]} phase="b" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pieces

type Now = { temp: number; night: boolean; condition: Condition; clock: Clock }

function Temp({ now, className }: { now: Now; className?: string }) {
  return (
    <div className={"wo-temp" + (className ? " " + className : "")}>
      {now.temp}
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

function HourRow({ hours, size }: { hours: Hour[]; size: number }) {
  return (
    <ul className="wo-hours">
      {hours.map((h) => (
        <li key={h.key} className="wo-hour">
          <span className="wo-hour-t go-mono">{h.label}</span>
          <Glyph condition={h.condition} size={size} />
          <span className="wo-hour-v">{h.temp}°</span>
        </li>
      ))}
    </ul>
  )
}

/** Small: the sky, the big temperature, a pane with the city; open fans six hourly chips. */
function Small({ now }: { now: Now }) {
  const hours = hourly(now.clock, 6)
  return (
    <>
      <Sky
        night={now.night}
        sun={{ x: 98, y: 80, d: 58 }}
        clouds={[
          { x: 70, y: 52, w: 58, side: -1 },
          { x: 116, y: 26, w: 44, side: 1, back: true },
        ]}
        openRise={-58}
        openScale={0.3}
      />
      <div className="wo-stage">
        <Temp now={now} className="wo-temp-small" />
        <div className="wo-open-meta wo-open-meta-small go-mono">
          H:{HI}° L:{LO}°
        </div>
        {hours.map((h, i) => {
          const k = i - 2.5
          return (
            <div key={h.key} className="wo-chip wo-chip-hour" style={{ "--i": k, "--a": k * k } as React.CSSProperties}>
              <span className="wo-chip-t go-mono">{h.label}</span>
              <Glyph condition={h.condition} size={16} />
              <span className="wo-chip-v">{h.temp}°</span>
            </div>
          )
        })}
      </div>
      <GlassPane hinge="bottom" lean={-10} openLean={-80} openShift={18} openFade={0.9} radius={18} className="wo-pane wo-pane-small">
        <div className="wo-label">
          <span className="wo-city">
            {CITY} <Arrow />
          </span>
          <span className="wo-cond">
            {LABEL[now.condition]}
            <span className="go-mono">
              H:{HI}° L:{LO}°
            </span>
          </span>
        </div>
      </GlassPane>
    </>
  )
}

/** Medium: current conditions in the sky on the left; the hourly row on a pane at the right; open shows five days. */
function Medium({ now }: { now: Now }) {
  const hours = hourly(now.clock, 6)
  const days = forecast(now.clock, 6).slice(1)
  return (
    <>
      <Sky
        night={now.night}
        sun={{ x: 120, y: 84, d: 64 }}
        clouds={[
          { x: 78, y: 70, w: 62, side: -1 },
          { x: 112, y: 18, w: 50, side: 1, back: true },
        ]}
        openRise={-30}
        openScale={0.15}
      />
      <div className="wo-stage">
        <span className="wo-city wo-city-top">
          {CITY} <Arrow />
        </span>
        <Temp now={now} className="wo-temp-medium" />
        <div className="wo-side-meta">
          <Glyph condition={now.condition} size={18} />
          <span className="wo-cond-strong">{LABEL[now.condition]}</span>
          <span className="wo-cond go-mono">
            H:{HI}° L:{LO}°
          </span>
        </div>
        {days.map((d, i) => (
          <div key={d.key} className="wo-chip wo-chip-day" style={{ "--i": i - 2, "--a": (i - 2) * (i - 2) } as React.CSSProperties}>
            <span className="wo-chip-t">{d.label}</span>
            <Glyph condition={d.condition} size={20} />
            <span className="wo-chip-v">{d.hi}°</span>
            <span className="wo-chip-lo go-mono">{d.lo}°</span>
          </div>
        ))}
      </div>
      <GlassPane hinge="bottom" lean={-7} openLean={-82} openShift={16} openFade={0.92} radius={16} className="wo-pane wo-pane-medium">
        <div className="wo-pane-head">
          <span>Hourly</span>
          <span className="go-mono">{LABEL[now.condition]}</span>
        </div>
        <HourRow hours={hours} size={20} />
      </GlassPane>
    </>
  )
}

/** Large: conditions at the top, the hourly row on the pane; open lifts a six-day list of sheets. */
function Large({ now }: { now: Now }) {
  const hours = hourly(now.clock, 6)
  const days = forecast(now.clock, 6)
  const min = Math.min(...days.map((d) => d.lo))
  const max = Math.max(...days.map((d) => d.hi))
  return (
    <>
      <Sky
        night={now.night}
        sun={{ x: 232, y: 108, d: 84 }}
        clouds={[
          { x: 194, y: 84, w: 84, side: -1 },
          { x: 270, y: 30, w: 66, side: 1, back: true },
        ]}
        openRise={-80}
        openScale={0.35}
      />
      <div className="wo-stage">
        <span className="wo-city wo-city-top wo-city-large">
          {CITY} <Arrow />
        </span>
        <Temp now={now} className="wo-temp-large" />
        <div className="wo-side-meta wo-side-meta-large">
          <Glyph condition={now.condition} size={18} />
          <span className="wo-cond-strong">{LABEL[now.condition]}</span>
          <span className="wo-cond go-mono">
            H:{HI}° L:{LO}°
          </span>
        </div>
        {days.map((d, i) => (
          <GlassSheet key={d.key} className="wo-row" style={{ "--i": i, "--r": 5 - i } as React.CSSProperties}>
            <span className="wo-row-day">{d.label}</span>
            <Glyph condition={i === 0 ? forNight(d.condition, now.night) : d.condition} size={18} />
            <span className="wo-row-lo go-mono">{d.lo}°</span>
            <RangeBar lo={d.lo} hi={d.hi} min={min} max={max} dot={i === 0 ? now.temp : undefined} />
            <span className="wo-row-hi go-mono">{d.hi}°</span>
          </GlassSheet>
        ))}
      </div>
      <GlassPane hinge="bottom" lean={-7} openLean={-80} openShift={20} openFade={0.95} radius={18} className="wo-pane wo-pane-large">
        <div className="wo-pane-head">
          <span>Hourly Forecast</span>
          <span className="go-mono">Feels like {now.temp >= 68 ? now.temp + 1 : now.temp - 1}°</span>
        </div>
        <HourRow hours={hours} size={24} />
        <div className="wo-pane-foot">6-Day Forecast</div>
      </GlassPane>
    </>
  )
}

export function WeatherWidget({ size = "small", className, appearDelay = 0 }: { size?: WidgetSize; className?: string; appearDelay?: number }) {
  const { open, tone } = useWindowManager()
  const { w, h } = WIDGET[size]
  const clock = clockOf(useNow())
  const night = clock.ready && isNight(clock.minutes)
  const now: Now = { temp: tempAt(clock.minutes / 60), night, condition: forNight(conditionAt(clock.minutes / 60), night), clock }
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
      <LiquidCanvas recipe={recipe} seed={size === "small" ? 3 : size === "medium" ? 6 : 9} cells={size === "small" ? 72 : 120} />
      {size === "small" ? <Small now={now} /> : size === "medium" ? <Medium now={now} /> : <Large now={now} />}
    </GlassObject>
  )
}

const WO_CSS = `
.wo-root .go-tilt { border-radius: 24px; }
.wo-back { position: absolute; inset: 0; border-radius: 24px; overflow: hidden; box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 .5px rgba(0,0,0,.1); }
.wo-root[data-tone="dark"] .wo-back { box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 0 0 .5px rgba(255,255,255,.1); }
.wo-root .go-liquid { border-radius: 24px; }
.wo-wait .wo-sky, .wo-wait .wo-stage, .wo-wait .go-pane-body { visibility: hidden; }

/* the sky: clipped to the object, parallax against the pointer */
.wo-sky { position: absolute; inset: 0; border-radius: 24px; overflow: hidden; --wo-drift-a: 0; --wo-drift-b: 0; --wo-tw: .5; }
.wo-sun, .wo-moon {
  position: absolute; border-radius: 50%;
  transform:
    translate(calc(var(--go-px) * -3px), calc(var(--go-py) * -2px + var(--go-hover) * -6px + var(--go-open) * var(--open-rise)))
    scale(calc(1 - var(--go-open) * var(--open-scale)));
}
.wo-sun {
  background: radial-gradient(circle at 42% 38%, #fff9d2 0%, #ffe066 38%, #ffbf2e 78%, #ffa31a 100%);
  box-shadow: 0 0 0 .5px rgba(255,170,30,.25), 0 6px 22px -4px rgba(255,160,20,.55);
}
.wo-sun::before {
  content: ""; position: absolute; inset: -70%; border-radius: 50%;
  background: radial-gradient(circle, rgba(255,214,90,.6) 0%, rgba(255,214,90,.22) 38%, rgba(255,214,90,0) 68%);
  opacity: calc(.75 + var(--go-hover) * .25);
  transform: scale(calc(1 + var(--go-hover) * .08));
}
.wo-root[data-tone="dark"] .wo-sun::before { background: radial-gradient(circle, rgba(255,200,80,.42) 0%, rgba(255,190,60,.14) 40%, rgba(255,190,60,0) 68%); }
.wo-moon { background: transparent; filter: drop-shadow(0 0 10px rgba(243,236,210,.35)); }
.wo-star { position: absolute; border-radius: 50%; background: #fffbe6; transform: translate(calc(var(--go-px) * -1.5px), calc(var(--go-py) * -1px)); }
.wo-star-0 { opacity: calc(.3 + var(--wo-tw) * .65); }
.wo-star-1 { opacity: calc(.95 - var(--wo-tw) * .6); }
.wo-cloud {
  position: absolute; display: block; overflow: visible;
  filter: drop-shadow(0 4px 6px rgba(30,50,80,.16));
  transform:
    translateX(calc(var(--drift) * 7px + var(--side) * (var(--go-hover) * 13px + var(--go-open) * 30px) + var(--go-px) * 5px))
    translateY(calc(var(--go-py) * 2px - var(--go-hover) * 2px));
  opacity: calc(1 - var(--go-open) * .25);
}
.wo-cloud-back {
  opacity: calc(.82 - var(--go-open) * .3);
  transform:
    translateX(calc(var(--drift) * 5px + var(--side) * (var(--go-hover) * 10px + var(--go-open) * 24px) + var(--go-px) * 2.5px))
    translateY(calc(var(--go-py) * 1px)) scale(.96);
}
.wo-c0 { stop-color: #ffffff; }
.wo-c1 { stop-color: #dbe3ee; }
.wo-cloud-edge { stroke: rgba(40,52,70,.12); stroke-width: .35; }
.wo-root[data-tone="dark"] .wo-c0 { stop-color: #dfe6ef; }
.wo-root[data-tone="dark"] .wo-c1 { stop-color: #8e9bb0; }
.wo-root[data-tone="dark"] .wo-cloud { filter: drop-shadow(0 4px 8px rgba(0,0,0,.35)); }
.wo-night .wo-c0 { stop-color: #6b7488; }
.wo-night .wo-c1 { stop-color: #3a4152; }
.wo-night .wo-cloud-edge { stroke: rgba(255,255,255,.1); }

/* the middle layer */
.wo-stage { position: absolute; inset: 0; }
.wo-temp {
  position: absolute; left: 14px; top: 8px;
  font-size: 46px; font-weight: 250; line-height: 1; letter-spacing: -.03em;
  font-variant-numeric: tabular-nums;
  transform-origin: 0% 0%;
  text-shadow: 0 1px 10px rgba(var(--go-glass), .5);
}
.wo-deg { font-weight: 300; margin-left: 1px; }
.wo-city { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 600; letter-spacing: -.005em; white-space: nowrap; }
.wo-arrow { fill: currentColor; opacity: .85; }
.wo-cond { font-size: 10.5px; color: var(--go-ink-soft); white-space: nowrap; font-variant-numeric: tabular-nums; }
.wo-cond-strong { font-size: 11.5px; font-weight: 600; white-space: nowrap; }
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

/* glass chips that rise out of the pocket */
.wo-chip {
  position: absolute; left: 50%;
  box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  border-radius: 11px;
  background: linear-gradient(180deg, rgba(var(--go-glass), .72), rgba(var(--go-glass), .5));
  -webkit-backdrop-filter: blur(10px) saturate(1.4);
  backdrop-filter: blur(10px) saturate(1.4);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.75), 0 0 0 .5px rgba(0,0,0,.08), 0 8px 16px -8px var(--go-shadow);
  opacity: calc(var(--go-open) * 1.5 - .3);
  font-variant-numeric: tabular-nums;
}
.wo-root[data-tone="dark"] .wo-chip { box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 0 0 .5px rgba(255,255,255,.1), 0 8px 18px -8px var(--go-shadow); }
.wo-chip-t { font-size: 9px; color: var(--go-ink-soft); white-space: nowrap; letter-spacing: 0; }
.wo-chip-v { font-size: 11.5px; font-weight: 600; }
.wo-chip-lo { font-size: 9.5px; color: var(--go-ink-soft); }

/* small */
.wo-small .wo-temp-small {
  transform: translateY(calc(var(--go-hover) * -2px)) scale(calc(1 - var(--go-open) * .4));
}
.wo-open-meta { position: absolute; font-size: 10px; color: var(--go-ink-soft); white-space: nowrap; opacity: calc(var(--go-open) * 1.3 - .3); }
.wo-open-meta-small { left: 15px; top: 40px; transform: translateY(calc((1 - var(--go-open)) * 8px)); }
.wo-chip-hour {
  bottom: 14px; width: 30px; height: 58px; padding: 6px 0 6px;
  transform:
    translateX(calc(-50% + var(--i) * 25.5px * var(--go-open)))
    translateY(calc((1 - var(--go-open)) * 66px + var(--a) * 1.4px * var(--go-open) - var(--go-hover) * 1px))
    rotate(calc(var(--i) * 3.5deg * var(--go-open)))
    scale(calc(.82 + var(--go-open) * .18));
}
.wo-root .wo-pane-small { top: auto; bottom: 0; height: 50px; }
.wo-label { position: absolute; inset: 0; padding: 0 14px; display: flex; flex-direction: column; justify-content: center; gap: 2px; }
.wo-label .wo-cond .go-mono { margin-left: 6px; font-size: 10px; }

/* medium */
.wo-city-top { position: absolute; left: 16px; top: 14px; transform: translateY(calc(var(--go-open) * -2px)); }
.wo-medium .wo-temp-medium {
  left: 15px; top: 32px; font-size: 52px;
  transform: translateY(calc(var(--go-hover) * -2px - var(--go-open) * 3px)) scale(calc(1 - var(--go-open) * .08));
}
.wo-side-meta { position: absolute; left: 16px; bottom: 14px; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.wo-side-meta .wo-glyph { margin-bottom: 2px; }
.wo-root .wo-pane-medium { inset: 8px 8px 8px auto; width: 184px; }
.wo-pane-head {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 11px 13px 0; font-size: 10.5px; font-weight: 600; color: var(--go-ink-soft);
}
.wo-pane-head .go-mono { font-weight: 400; font-size: 10px; }
.wo-hours { list-style: none; margin: 0; padding: 0 6px; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); }
.wo-hour { display: flex; flex-direction: column; align-items: center; gap: 7px; font-variant-numeric: tabular-nums; }
.wo-hour-t { font-size: 9.5px; color: var(--go-ink-soft); letter-spacing: 0; white-space: nowrap; }
.wo-hour-v { font-size: 12.5px; font-weight: 600; }
.wo-pane-medium .wo-hours { position: absolute; left: 0; right: 0; top: 40px; bottom: 16px; align-content: center; }
.wo-chip-day {
  top: 24px; left: 270px; width: 32px; height: 120px; padding: 9px 0 9px;
  transform:
    translateX(calc(-50% + var(--i) * 35px * var(--go-open)))
    translateY(calc((1 - var(--go-open)) * 72px + var(--a) * 1.2px * var(--go-open) - var(--go-hover) * 1px))
    rotate(calc(var(--i) * 2deg * var(--go-open)))
    scale(calc(.85 + var(--go-open) * .15));
}
.wo-chip-day .wo-chip-t { font-size: 10px; font-weight: 600; color: var(--go-ink); }
.wo-chip-day .wo-chip-v { margin-top: auto; }
.wo-chip-day .wo-glyph { margin-top: 10px; }

/* large */
.wo-city-large { left: 20px; top: 20px; }
.wo-large .wo-temp-large {
  left: 18px; top: 38px; font-size: 66px;
  transform: translateY(calc(var(--go-hover) * -2px - var(--go-open) * 6px)) scale(calc(1 - var(--go-open) * .2));
}
.wo-side-meta-large { left: 20px; top: 108px; bottom: auto; flex-direction: row; align-items: center; gap: 6px; transform: translateY(calc(var(--go-open) * -18px)); }
.wo-side-meta-large .wo-glyph { margin: 0; }
.wo-root .wo-pane-large { inset: 166px 8px 8px 8px; }
.wo-pane-large .wo-pane-head { padding: 13px 16px 0; }
.wo-pane-large .wo-hours { position: absolute; left: 4px; right: 4px; top: 40px; height: 82px; align-content: center; }
.wo-pane-large .wo-hour { gap: 9px; }
.wo-pane-large .wo-hour-t { font-size: 10px; }
.wo-pane-large .wo-hour-v { font-size: 13px; }
.wo-pane-foot {
  position: absolute; left: 16px; right: 16px; bottom: 13px; padding-top: 10px;
  border-top: .5px solid var(--go-ink-faint);
  font-size: 10.5px; font-weight: 600; color: var(--go-ink-soft);
}
.wo-root .wo-row {
  left: 12px; right: 12px; top: 138px; height: 31px;
  display: flex; align-items: center; gap: 8px; padding: 0 12px;
  font-variant-numeric: tabular-nums; border-radius: 10px;
  transform:
    translateY(calc(var(--i) * 35px + (1 - var(--go-open)) * (var(--r) * 35px + 6px)))
    scale(calc(.9 + var(--go-open) * .1));
  opacity: calc(.55 + var(--go-open) * .45);
}
.wo-row-day { width: 40px; font-size: 11.5px; font-weight: 600; }
.wo-row-lo, .wo-row-hi { width: 24px; font-size: 11px; text-align: right; }
.wo-row-lo { color: var(--go-ink-soft); }
.wo-row-hi { text-align: left; font-weight: 600; }
.wo-bar { position: relative; flex: 1; height: 4px; border-radius: 4px; background: var(--go-ink-faint); }
.wo-bar-fill { position: absolute; top: 0; bottom: 0; border-radius: 4px; }
.wo-bar-dot { position: absolute; top: 50%; width: 7px; height: 7px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 1.5px rgba(0,0,0,.35); transform: translate(-50%, -50%); }
`
