"use client"

import * as React from "react"
import { ArrowUp, CloudSun, Droplets, Gauge, Navigation, Sun, Sunrise, Sunset, Thermometer, Wind } from "lucide-react"
import { rng } from "@/components/ui/glass-folder-cards"
import { cn } from "@/lib/utils"
import { Widget, type WidgetSize } from "../glass"
import { GlassWindow, type WindowState } from "../window-manager"

/**
 * Weather for Cupertino, CA. Nothing is fetched: the day is a plausible
 * October day (54° to 72°, sun most of the afternoon) shaped by the current
 * local time, and the 10-day outlook is seeded by the date so it holds still.
 */

// ---------------------------------------------------------------------------
// Time, read only after mount (hydration safe)

let nowValue: number | null = null
const nowListeners = new Set<() => void>()
let nowTimer: ReturnType<typeof setInterval> | undefined

function minuteOf(t: number) {
  return Math.floor(t / 60_000)
}

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

/** Epoch ms, minute-resolution; `null` on the server and during hydration. */
function useNow(): number | null {
  return React.useSyncExternalStore(
    subscribeNow,
    () => nowValue,
    () => null,
  )
}

// ---------------------------------------------------------------------------
// The data

export type Condition = "sunny" | "partly-cloudy" | "cloudy" | "rain" | "night" | "night-cloudy"

const CITY = "Cupertino"
const SUNRISE = 7 * 60 + 12 // minutes after midnight
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

/** Temperature through the day: coolest at 6 AM, warmest at 3 PM. */
function tempAt(hour: number, lo = LO, hi = HI) {
  const t = (((hour - 6) % 24) + 24) % 24
  const k = t <= 9 ? (1 - Math.cos((Math.PI * t) / 9)) / 2 : 1 - (1 - Math.cos((Math.PI * (t - 9)) / 15)) / 2
  return Math.round(lo + (hi - lo) * k)
}

/** Today's sky, by hour. */
function conditionAt(hour: number): Condition {
  const h = ((Math.floor(hour) % 24) + 24) % 24
  if (isNight(h * 60 + 30)) return h >= 1 && h <= 5 ? "night-cloudy" : "night"
  if (h <= 10 || h >= 17) return "partly-cloudy"
  return "sunny"
}

/** A day condition as it reads after dark. */
const forNight = (c: Condition, night: boolean): Condition =>
  !night ? c : c === "sunny" ? "night" : c === "partly-cloudy" ? "night-cloudy" : c

type Clock = { minutes: number; weekday: number; dayNumber: number; ready: boolean }

/** Pure numbers from the clock, with a neutral noon stand-in before mount. */
function clockOf(now: number | null): Clock {
  if (now === null) return { minutes: 720, weekday: 0, dayNumber: 0, ready: false }
  const d = new Date(now)
  const local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return {
    minutes: d.getHours() * 60 + d.getMinutes(),
    weekday: d.getDay(),
    dayNumber: Math.floor(local / 86_400_000),
    ready: true,
  }
}

function fmtHour(h: number) {
  const x = ((h % 24) + 24) % 24
  return `${x % 12 === 0 ? 12 : x % 12}${x < 12 ? "AM" : "PM"}`
}

function fmtTime(minutes: number) {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

type Hour = { key: string; label: string; temp: number | null; condition: Condition | "sunrise" | "sunset"; text?: string }

function hourly(clock: Clock, count: number, withSun = false): Hour[] {
  const start = Math.floor(clock.minutes / 60)
  const out: Hour[] = []
  for (let i = 0; i < count; i++) {
    const h = start + i
    out.push({ key: "h" + h, label: i === 0 ? "Now" : fmtHour(h), temp: i === 0 ? tempAt(clock.minutes / 60) : tempAt(h), condition: conditionAt(h) })
    if (!withSun) continue
    for (const [at, kind] of [
      [SUNRISE, "sunrise"],
      [SUNSET, "sunset"],
    ] as const) {
      // the sun event falls inside this hour (today or tomorrow)
      const lo = h * 60
      const t = lo - (lo % 1440) + at + (at < lo % 1440 ? 1440 : 0)
      if (t >= Math.max(lo, clock.minutes) && t < lo + 60)
        out.push({ key: kind + h, label: fmtTime(at % 1440).replace(" ", ""), temp: null, condition: kind, text: kind === "sunrise" ? "Sunrise" : "Sunset" })
    }
  }
  return out
}

type Day = { key: string; label: string; condition: Condition; lo: number; hi: number; rain: number }

function forecast(clock: Clock, days: number): Day[] {
  const r = rng(clock.dayNumber * 7919 + 17)
  const out: Day[] = [{ key: "d0", label: "Today", condition: "sunny", lo: LO, hi: HI, rain: 0 }]
  let hi = HI
  for (let i = 1; i < days; i++) {
    hi = Math.round(Math.min(81, Math.max(62, hi + (r() * 8 - 4.2))))
    const roll = r()
    const condition: Condition = roll < 0.45 ? "sunny" : roll < 0.72 ? "partly-cloudy" : roll < 0.86 ? "cloudy" : "rain"
    const dh = condition === "rain" ? -6 : condition === "cloudy" ? -3 : 0
    const dayHi = hi + dh
    out.push({
      key: "d" + i,
      label: WEEKDAYS[(clock.weekday + i) % 7],
      condition,
      hi: dayHi,
      lo: Math.round(dayHi - 13 - r() * 6),
      rain: condition === "rain" ? 40 + Math.round(r() * 4) * 10 : condition === "cloudy" && r() > 0.5 ? 10 : 0,
    })
  }
  return out
}

function current(clock: Clock) {
  const hour = clock.minutes / 60
  const temp = tempAt(hour)
  const night = isNight(clock.minutes)
  const daylight = (clock.minutes - SUNRISE) / (SUNSET - SUNRISE)
  const uv = night ? 0 : Math.max(0, Math.round(6.4 * Math.sin(Math.PI * Math.min(1, Math.max(0, daylight)))))
  return {
    temp,
    night,
    condition: conditionAt(hour),
    feels: temp >= 68 ? temp + 1 : temp - 1,
    humidity: Math.round(82 - (temp - LO) * 2),
    dew: 47,
    uv,
    windMph: 8,
    gustMph: 14,
    windDeg: 292,
    pressure: 30.02,
  }
}

// ---------------------------------------------------------------------------
// Colours

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
// Motion

const WX_CSS = `
@keyframes wx-spin { to { transform: rotate(360deg) } }
@keyframes wx-drift { 0%, 100% { transform: translateX(-0.9px) } 50% { transform: translateX(1.1px) } }
@keyframes wx-drift-b { 0%, 100% { transform: translateX(1px) } 50% { transform: translateX(-1.2px) } }
@keyframes wx-rain { 0% { transform: translateY(-2px); opacity: 0 } 25% { opacity: 1 } 100% { transform: translateY(5px); opacity: 0 } }
@keyframes wx-twinkle { 0%, 100% { opacity: .25 } 50% { opacity: 1 } }
.wx-spin { animation: wx-spin 36s linear infinite; transform-box: fill-box; transform-origin: center }
.wx-drift { animation: wx-drift 7s var(--glass-ease) infinite }
.wx-drift-b { animation: wx-drift-b 9s var(--glass-ease) infinite }
.wx-rain { animation: wx-rain 1.1s linear infinite }
.wx-twinkle { animation: wx-twinkle 3.2s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) {
  .wx-spin, .wx-drift, .wx-drift-b, .wx-rain, .wx-twinkle { animation: none !important }
  .wx-rain { opacity: .9 }
}
`

function WeatherStyles() {
  return (
    <style href="glass-weather" precedence="default">
      {WX_CSS}
    </style>
  )
}

// ---------------------------------------------------------------------------
// ConditionGlyph

const CLOUD = "M10 25.5h13.2a5 5 0 0 0 .5-9.97 7 7 0 0 0-13.4-1.6A5.8 5.8 0 0 0 10 25.5z"
const MOON = "M19.5 5.5a10 10 0 1 0 7 16.4A8.4 8.4 0 0 1 19.5 5.5z"

/** An animated condition glyph, drawn on a 32-unit square. */
export function ConditionGlyph({
  condition,
  size = 28,
  className,
  title,
}: {
  condition: Condition | string
  size?: number
  className?: string
  title?: string
}) {
  const id = React.useId().replace(/:/g, "")
  const c = condition as Condition
  const hasSun = c === "sunny" || c === "partly-cloudy"
  const hasMoon = c === "night" || c === "night-cloudy"
  const hasCloud = c === "partly-cloudy" || c === "cloudy" || c === "rain" || c === "night-cloudy"
  const small = c !== "sunny" && c !== "night" // the sun or moon peeks from behind a cloud
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0 overflow-visible", className)}
    >
      <defs>
        <radialGradient id={id + "sun"} cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#fff3a8" />
          <stop offset=".55" stopColor="#ffd60a" />
          <stop offset="1" stopColor="#ff9f0a" />
        </radialGradient>
        <linearGradient id={id + "cloud"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d3dae3" />
        </linearGradient>
        <linearGradient id={id + "cloud2"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c9d1db" />
          <stop offset="1" stopColor="#97a3b2" />
        </linearGradient>
        <linearGradient id={id + "moon"} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fffbe6" />
          <stop offset="1" stopColor="#e5dcb5" />
        </linearGradient>
      </defs>

      {hasSun ? (
        <g transform={small ? "translate(-1 -1.5) scale(.78)" : undefined}>
          <g className="wx-spin">
            {Array.from({ length: 8 }, (_, i) => (
              <line
                key={i}
                x1="16"
                y1="3.2"
                x2="16"
                y2="6.2"
                stroke="#ffb800"
                strokeWidth="2"
                strokeLinecap="round"
                transform={`rotate(${i * 45} 16 16)`}
              />
            ))}
          </g>
          <circle cx="16" cy="16" r="6.6" fill={`url(#${id}sun)`} />
        </g>
      ) : null}

      {hasMoon ? (
        <g transform={c === "night-cloudy" ? "translate(-3 -3.5) scale(.8)" : undefined}>
          <path d={MOON} fill={`url(#${id}moon)`} />
          {c === "night" ? (
            <>
              <circle className="wx-twinkle" cx="25" cy="7" r=".9" fill="#fffbe6" />
              <circle className="wx-twinkle" cx="28.5" cy="13" r=".6" fill="#fffbe6" style={{ animationDelay: "1.1s" }} />
              <circle className="wx-twinkle" cx="22.5" cy="2.8" r=".55" fill="#fffbe6" style={{ animationDelay: "2s" }} />
            </>
          ) : null}
        </g>
      ) : null}

      {c === "cloudy" ? (
        <g className="wx-drift-b" opacity=".95">
          <path d={CLOUD} transform="translate(-1.5 -5) scale(.82)" fill={`url(#${id}cloud2)`} />
        </g>
      ) : null}

      {hasCloud ? (
        <g className="wx-drift">
          <g transform={c === "rain" ? "translate(0 -4.5)" : c === "cloudy" ? "translate(1.5 1)" : "translate(1.5 0.5)"}>
            <path d={CLOUD} fill={`url(#${id}${c === "rain" ? "cloud2" : "cloud"})`} stroke="rgba(40,52,70,.16)" strokeWidth=".5" />
          </g>
        </g>
      ) : null}

      {c === "rain"
        ? [10.5, 16, 21.5].map((x, i) => (
            <line
              key={x}
              className="wx-rain"
              x1={x}
              y1="24"
              x2={x - 1.2}
              y2="27.4"
              stroke="#4fb3ff"
              strokeWidth="1.7"
              strokeLinecap="round"
              style={{ animationDelay: `${i * 0.37}s` }}
            />
          ))
        : null}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Bits

function RangeBar({
  lo,
  hi,
  min,
  max,
  dot,
  className,
  trackClassName,
}: {
  lo: number
  hi: number
  min: number
  max: number
  dot?: number
  className?: string
  trackClassName?: string
}) {
  const span = Math.max(1, max - min)
  const left = ((lo - min) / span) * 100
  const width = ((hi - lo) / span) * 100
  return (
    <div className={cn("relative h-1 rounded-full bg-[var(--glass-ink-faint)]", trackClassName, className)} aria-hidden="true">
      <div
        className="absolute inset-y-0 rounded-full"
        style={{ left: `${left}%`, width: `${width}%`, background: `linear-gradient(90deg, ${tempColor(lo)}, ${tempColor(hi)})` }}
      />
      {dot !== undefined ? (
        <div
          className="absolute top-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1.5px_rgba(0,0,0,.35)]"
          style={{ left: `${((Math.min(hi, Math.max(lo, dot)) - min) / span) * 100}%` }}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Widget

function WidgetSummary({ clock, compact }: { clock: Clock; compact?: boolean }) {
  const now = current(clock)
  const cond = forNight(now.condition, now.night)
  return (
    <div className="flex h-full min-w-0 flex-col">
      <p className="flex items-center gap-1 text-[13.5px] font-semibold ink">
        <span className="truncate">{CITY}</span>
        <Navigation className="size-2.5 shrink-0 fill-current" aria-hidden="true" />
      </p>
      <p className={cn("leading-none font-light tracking-tight tabular-nums ink", compact ? "mt-0.5 text-[40px]" : "mt-0.5 text-[44px]")}>
        {now.temp}°
      </p>
      <div className="mt-auto">
        <ConditionGlyph condition={cond} size={22} />
        <p className="mt-1 truncate text-[12px] font-semibold ink">{LABEL[cond]}</p>
        <p className="text-[12px] font-medium tabular-nums ink-soft">
          H:{HI}° L:{LO}°
        </p>
      </div>
    </div>
  )
}

function HourlyStrip({ clock, count }: { clock: Clock; count: number }) {
  return (
    <ul className="grid h-full" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      {hourly(clock, count).map((h, i) => (
        <li key={h.key} className="flex flex-col items-center justify-between py-0.5">
          <span className="text-[11px] font-medium tabular-nums ink-soft">{h.label}</span>
          <ConditionGlyph condition={i === 0 ? forNight(h.condition as Condition, isNight(clock.minutes)) : h.condition} size={20} />
          <span className="text-[13px] font-medium tabular-nums ink">{h.temp}°</span>
        </li>
      ))}
    </ul>
  )
}

export function WeatherWidget({ size = "small", className }: { size?: WidgetSize; className?: string }) {
  const now = useNow()
  const clock = clockOf(now)
  const today = current(clock)
  const days = size === "large" ? forecast(clock, 6) : []
  const min = Math.min(...days.map((d) => d.lo), LO)
  const max = Math.max(...days.map((d) => d.hi), HI)
  return (
    <Widget
      size={size}
      label={`Weather, ${CITY}: ${today.temp}°, ${LABEL[forNight(today.condition, today.night)]}`}
      className={className}
    >
      <WeatherStyles />
      <div
        className={cn(
          "relative flex h-full flex-col p-3.5 transition-opacity duration-500 [transition-timing-function:var(--glass-ease)]",
          clock.ready ? "opacity-100" : "opacity-0",
        )}
      >
        {size === "small" ? (
          <WidgetSummary clock={clock} />
        ) : (
          <>
            <div className={cn("flex gap-3", size === "medium" ? "h-full" : "h-[136px] shrink-0")}>
              <div className="w-[118px] shrink-0">
                <WidgetSummary clock={clock} compact />
              </div>
              <div className="min-w-0 flex-1 border-l border-[var(--glass-ink-faint)] pl-2">
                <HourlyStrip clock={clock} count={6} />
              </div>
            </div>
            {size === "large" ? (
              <>
                <div className="my-2.5 h-px shrink-0 bg-[var(--glass-ink-faint)]" />
                <ul className="flex min-h-0 flex-1 flex-col justify-between">
                  {days.map((d, i) => (
                    <li key={d.key} className="flex items-center gap-2 text-[12.5px] tabular-nums">
                      <span className="w-11 font-semibold ink">{d.label}</span>
                      <span className="flex w-7 justify-center">
                        <ConditionGlyph condition={d.condition} size={18} />
                      </span>
                      <span className="w-7 text-right font-medium ink-soft">{d.lo}°</span>
                      <RangeBar lo={d.lo} hi={d.hi} min={min} max={max} dot={i === 0 ? today.temp : undefined} className="mx-1 flex-1" />
                      <span className="w-7 font-semibold ink">{d.hi}°</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </div>
    </Widget>
  )
}

// ---------------------------------------------------------------------------
// Window

function Tile({ icon, title, children, className }: { icon: React.ReactNode; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-h-[150px] min-w-0 flex-col rounded-2xl bg-white/12 p-3 ring-1 ring-white/15 backdrop-blur-xl ring-inset",
        className,
      )}
    >
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-white/60 uppercase [&_svg]:size-3">
        {icon}
        {title}
      </h3>
      <div className="mt-1.5 flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

function Compass({ deg, mph, gust }: { deg: number; mph: number; gust: number }) {
  return (
    <svg viewBox="0 0 100 100" className="mx-auto aspect-square h-auto w-full max-w-[124px]" role="img" aria-label={`Wind ${mph} mph from ${deg}°`}>
      {Array.from({ length: 60 }, (_, i) => (
        <line
          key={i}
          x1="50"
          y1="5"
          x2="50"
          y2={i % 15 === 0 ? 12 : 9}
          stroke="white"
          strokeOpacity={i % 15 === 0 ? 0.85 : 0.3}
          strokeWidth={i % 15 === 0 ? 1.6 : 1}
          transform={`rotate(${i * 6} 50 50)`}
        />
      ))}
      {(["N", "E", "S", "W"] as const).map((l, i) => {
        const a = (i * Math.PI) / 2
        return (
          <text
            key={l}
            x={50 + Math.sin(a) * 31}
            y={50 - Math.cos(a) * 31 + 3.5}
            textAnchor="middle"
            fontSize="9.5"
            fontWeight="600"
            fill="white"
            fillOpacity={l === "N" ? 0.95 : 0.55}
          >
            {l}
          </text>
        )
      })}
      <g transform={`rotate(${deg} 50 50)`} className="transition-transform duration-700">
        <line x1="50" y1="90" x2="50" y2="14" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <path d="M50 8 l5 9 h-10z" fill="white" />
        <circle cx="50" cy="90" r="3" fill="none" stroke="white" strokeWidth="1.6" />
      </g>
      <circle cx="50" cy="50" r="15" fill="rgba(30,60,110,.55)" />
      <text x="50" y="50" textAnchor="middle" fontSize="13" fontWeight="600" fill="white">
        {mph}
      </text>
      <text x="50" y="59" textAnchor="middle" fontSize="7" fill="white" fillOpacity=".7">
        mph
      </text>
      <title>{`Gusts ${gust} mph`}</title>
    </svg>
  )
}

function SunArc({ minutes, night }: { minutes: number; night: boolean }) {
  const id = React.useId().replace(/:/g, "")
  const W = 160
  const H = 64
  const horizon = 42
  const noon = (SUNRISE + SUNSET) / 2
  const base = Math.cos((2 * Math.PI * (SUNRISE - noon)) / 1440)
  const elev = (m: number) => Math.cos((2 * Math.PI * (m - noon)) / 1440) - base
  const y = (m: number) => horizon - elev(m) * 30
  const x = (m: number) => (m / 1440) * W
  let d = ""
  for (let m = 0; m <= 1440; m += 20) d += (m ? "L" : "M") + x(m).toFixed(1) + " " + y(m).toFixed(1)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden="true">
      <defs>
        <clipPath id={id + "above"}>
          <rect x="0" y="0" width={W} height={horizon} />
        </clipPath>
        <clipPath id={id + "below"}>
          <rect x="0" y={horizon} width={W} height={H - horizon} />
        </clipPath>
      </defs>
      <path d={d} fill="none" stroke="white" strokeOpacity=".28" strokeWidth="1.6" clipPath={`url(#${id}below)`} />
      <path d={d} fill="none" stroke="white" strokeOpacity=".85" strokeWidth="1.8" clipPath={`url(#${id}above)`} />
      <line x1="0" x2={W} y1={horizon} y2={horizon} stroke="white" strokeOpacity=".4" strokeWidth=".8" />
      <circle cx={x(minutes)} cy={y(minutes)} r={night ? 3.2 : 4.4} fill={night ? "rgba(255,255,255,.55)" : "white"} style={night ? undefined : { filter: "drop-shadow(0 0 4px rgba(255,255,255,.9))" }} />
    </svg>
  )
}

function PressureGauge({ value }: { value: number }) {
  const lo = 29
  const hi = 31
  const toAngle = (v: number) => -135 + ((v - lo) / (hi - lo)) * 270
  const at = toAngle(value)
  return (
    <svg viewBox="0 0 100 100" className="mx-auto aspect-square h-auto w-full max-w-[124px]" role="img" aria-label={`Pressure ${value.toFixed(2)} inches, rising`}>
      {Array.from({ length: 46 }, (_, i) => {
        const a = -135 + i * 6
        return (
          <line
            key={i}
            x1="50"
            y1="6"
            x2="50"
            y2="14"
            stroke="white"
            strokeOpacity={a <= at ? 0.85 : 0.28}
            strokeWidth="1.3"
            transform={`rotate(${a} 50 50)`}
          />
        )
      })}
      <g transform={`rotate(${at} 50 50)`}>
        <rect x="47.8" y="3" width="4.4" height="14" rx="2.2" fill="white" />
      </g>
      <text x="50" y="52" textAnchor="middle" fontSize="15" fontWeight="600" fill="white">
        {value.toFixed(2)}
      </text>
      <text x="50" y="63" textAnchor="middle" fontSize="8" fill="white" fillOpacity=".7">
        inHg
      </text>
      <text x="30" y="90" textAnchor="middle" fontSize="7" fill="white" fillOpacity=".55">
        Low
      </text>
      <text x="70" y="90" textAnchor="middle" fontSize="7" fill="white" fillOpacity=".55">
        High
      </text>
    </svg>
  )
}

function uvLabel(uv: number) {
  return uv <= 2 ? "Low" : uv <= 5 ? "Moderate" : uv <= 7 ? "High" : uv <= 10 ? "Very High" : "Extreme"
}

const SCENE: Record<"day" | "night" | "grey", string> = {
  day: "linear-gradient(180deg, #2f7fd6 0%, #5aa2e6 45%, #9cc9f0 100%)",
  night: "linear-gradient(180deg, #060b1f 0%, #0f1c3f 50%, #1d2f5c 100%)",
  grey: "linear-gradient(180deg, #4d5d73 0%, #6c7d93 50%, #95a3b5 100%)",
}

export function WeatherWindow({ win }: { win: WindowState }) {
  const nowMs = useNow()
  const clock = clockOf(nowMs)
  const now = current(clock)
  const cond = forNight(now.condition, now.night)
  const scene = !clock.ready ? "grey" : now.night ? "night" : now.condition === "rain" || now.condition === "cloudy" ? "grey" : "day"
  const hours = hourly(clock, 24, true)
  const days = forecast(clock, 10)
  const min = Math.min(...days.map((d) => d.lo))
  const max = Math.max(...days.map((d) => d.hi))
  const nextSun = now.night ? { label: "Sunrise", at: SUNRISE, other: "Sunset", otherAt: SUNSET } : { label: "Sunset", at: SUNSET, other: "Sunrise", otherAt: SUNRISE }

  return (
    <GlassWindow win={win} icon={<CloudSun />} minW={420} minH={420}>
      <WeatherStyles />
      {/* the sky, tinted by the hour and the condition, behind the glass content */}
      <div aria-hidden="true" className="absolute inset-0 transition-[background] duration-700" style={{ background: SCENE[scene], opacity: 0.92 }} />
      {scene === "night" ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "radial-gradient(1px 1px at 12% 18%, white, transparent), radial-gradient(1px 1px at 68% 9%, white, transparent), radial-gradient(1.2px 1.2px at 84% 26%, white, transparent), radial-gradient(1px 1px at 36% 32%, white, transparent), radial-gradient(1px 1px at 52% 14%, white, transparent), radial-gradient(1px 1px at 22% 40%, white, transparent)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute -top-24 right-[-10%] size-80 rounded-full bg-white/25 blur-3xl" />
      )}

      <div
        className={cn(
          "@container relative h-full overflow-y-auto px-4 pb-5 text-white transition-opacity duration-500 [transition-timing-function:var(--glass-ease)]",
          clock.ready ? "opacity-100" : "opacity-0",
        )}
        data-no-drag
      >
        {/* hero */}
        <header className="flex flex-col items-center pt-6 pb-5 text-center [text-shadow:0_1px_8px_rgba(0,0,0,.18)]">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-white/70 uppercase">My Location</p>
          <h2 className="text-[26px] leading-tight font-medium">{CITY}</h2>
          <p className="mt-0.5 flex items-center gap-1 text-[78px] leading-none font-extralight tabular-nums">
            {now.temp}
            <span className="-ml-1 self-start text-[60px]">°</span>
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[16px] font-medium">
            <ConditionGlyph condition={cond} size={22} />
            {LABEL[cond]}
          </p>
          <p className="text-[15px] font-medium tabular-nums">
            H:{HI}° L:{LO}°
          </p>
        </header>

        {/* 24-hour strip */}
        <section aria-label="Hourly forecast" className="rounded-2xl bg-white/12 ring-1 ring-white/15 backdrop-blur-xl ring-inset">
          <p className="border-b border-white/15 px-3 py-2 text-[12.5px] text-white/85">
            {now.night ? "Clear conditions tonight, with a few clouds before dawn." : "Sunny conditions will continue for the rest of the day."} Wind gusts are up to{" "}
            {now.gustMph} mph.
          </p>
          <ul className="no-scrollbar flex gap-1 overflow-x-auto px-2 py-2.5" tabIndex={0} aria-label="Next 24 hours">
            {hours.map((h, i) => {
              const sun = h.condition === "sunrise" || h.condition === "sunset"
              return (
                <li key={h.key} className="flex w-[52px] shrink-0 flex-col items-center gap-2 text-center">
                  <span className={cn("text-[12px] font-semibold tabular-nums", i === 0 ? "text-white" : "text-white/85")}>{h.label}</span>
                  <span className="grid h-7 place-items-center">
                    {sun ? (
                      h.condition === "sunrise" ? (
                        <Sunrise className="size-6 text-[#ffd60a]" aria-hidden="true" />
                      ) : (
                        <Sunset className="size-6 text-[#ffb340]" aria-hidden="true" />
                      )
                    ) : (
                      <ConditionGlyph condition={i === 0 ? cond : h.condition} size={24} />
                    )}
                  </span>
                  <span className="text-[14px] font-medium tabular-nums">{sun ? h.text : `${h.temp}°`}</span>
                </li>
              )
            })}
          </ul>
        </section>

        <div className="mt-3 grid gap-3 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* 10-day */}
          <section aria-label="10-day forecast" className="self-start rounded-2xl bg-white/12 px-3 pt-2.5 pb-1 ring-1 ring-white/15 backdrop-blur-xl ring-inset">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-white/60 uppercase">
              <Sun className="size-3" />
              10-Day Forecast
            </h3>
            <ul className="mt-1">
              {days.map((d, i) => (
                <li key={d.key} className="flex h-11 items-center gap-2 border-t border-white/12 text-[14px] tabular-nums first:border-t-0">
                  <span className="w-12 font-semibold">{d.label}</span>
                  <span className="flex w-9 flex-col items-center leading-none">
                    <ConditionGlyph condition={d.condition} size={22} title={LABEL[d.condition]} />
                    {d.rain ? <span className="mt-0.5 text-[10px] font-semibold text-[#7fd0ff]">{d.rain}%</span> : null}
                  </span>
                  <span className="w-8 text-right font-medium text-white/60">{d.lo}°</span>
                  <RangeBar
                    lo={d.lo}
                    hi={d.hi}
                    min={min}
                    max={max}
                    dot={i === 0 ? now.temp : undefined}
                    trackClassName="bg-black/20 h-[5px]"
                    className="mx-1.5 flex-1"
                  />
                  <span className="w-8 font-semibold">{d.hi}°</span>
                </li>
              ))}
            </ul>
          </section>

          {/* detail tiles */}
          <div className="grid grid-cols-2 gap-3">
            <Tile icon={<Sun />} title="UV Index">
              <p className="text-[28px] leading-none font-medium tabular-nums">{now.uv}</p>
              <p className="mt-0.5 text-[15px] font-semibold">{uvLabel(now.uv)}</p>
              <div className="relative mt-3 h-1.5 rounded-full" style={{ background: "linear-gradient(90deg,#3ec65b,#f7d038 30%,#f59b2a 55%,#ef4444 78%,#a855f7)" }}>
                <span
                  className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1.5px_rgba(0,0,0,.4)]"
                  style={{ left: `${Math.min(100, (now.uv / 11) * 100)}%` }}
                />
              </div>
              <p className="mt-auto pt-2 text-[12px] text-white/80">{now.uv >= 3 ? "Use sun protection until 4 PM." : "Low for the rest of the day."}</p>
            </Tile>

            <Tile icon={<Wind />} title="Wind">
              <Compass deg={now.windDeg} mph={now.windMph} gust={now.gustMph} />
              <p className="mt-auto text-center text-[12px] text-white/80 tabular-nums">
                WNW · gusts {now.gustMph} mph
              </p>
            </Tile>

            <Tile icon={<Droplets />} title="Humidity">
              <p className="text-[28px] leading-none font-medium tabular-nums">{now.humidity}%</p>
              <div className="mt-3 flex h-10 items-end gap-[3px]" aria-hidden="true">
                {Array.from({ length: 12 }, (_, i) => {
                  const v = Math.round(82 - (tempAt(Math.floor(clock.minutes / 60) + i * 2) - LO) * 2)
                  return <span key={i} className={cn("flex-1 rounded-sm", i === 0 ? "bg-white" : "bg-white/35")} style={{ height: `${v}%` }} />
                })}
              </div>
              <p className="mt-auto pt-2 text-[12px] text-white/80 tabular-nums">The dew point is {now.dew}° right now.</p>
            </Tile>

            <Tile icon={<Thermometer />} title="Feels Like">
              <p className="text-[28px] leading-none font-medium tabular-nums">{now.feels}°</p>
              <div className="relative mt-3 h-1.5 rounded-full bg-black/20" aria-hidden="true">
                <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60" style={{ left: `${((now.temp - 40) / 50) * 100}%` }} />
                <span
                  className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1.5px_rgba(0,0,0,.35)]"
                  style={{ left: `${((now.feels - 40) / 50) * 100}%` }}
                />
              </div>
              <p className="mt-auto pt-2 text-[12px] text-white/80">
                {now.feels > now.temp ? "Humidity is making it feel warmer." : "Wind is making it feel cooler."}
              </p>
            </Tile>

            <Tile icon={now.night ? <Sunrise /> : <Sunset />} title={nextSun.label}>
              <p className="text-[24px] leading-none font-medium tabular-nums">{fmtTime(nextSun.at)}</p>
              <div className="mt-2">
                <SunArc minutes={clock.minutes} night={now.night} />
              </div>
              <p className="mt-auto text-[12px] text-white/80 tabular-nums">
                {nextSun.other}: {fmtTime(nextSun.otherAt)}
              </p>
            </Tile>

            <Tile icon={<Gauge />} title="Pressure">
              <PressureGauge value={now.pressure} />
              <p className="mt-auto flex items-center justify-center gap-1 text-[12px] text-white/80">
                <ArrowUp className="size-3" aria-hidden="true" /> Rising slowly
              </p>
            </Tile>
          </div>
        </div>
      </div>
    </GlassWindow>
  )
}
