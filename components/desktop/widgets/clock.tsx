"use client"

import * as React from "react"
import { AlarmClock, Bell, Clock, Globe, Hourglass, Minus, Plus, Timer, X } from "lucide-react"
import { APPS } from "@/lib/apps"
import { cn } from "@/lib/utils"
import { GlassButton, Hairline, Widget, type WidgetSize } from "../glass"
import { GlassWindow, useWindowManager, type WindowState } from "../window-manager"

/**
 * Clock: the World Clock widget (small / medium / large) and the Clock app
 * (World Clock · Alarms · Stopwatch · Timers).
 *
 * Hydration: nothing reads the wall clock during render. `now` starts as
 * null, the hands sit at 12:00 invisibly, and the first animation frame (or
 * timeout, with reduced motion) fills it in on the client.
 */

// ---------------------------------------------------------------------------
// Cities and time maths

type CityId = "cupertino" | "newyork" | "london" | "tokyo" | "sydney" | "paris"

const CITIES: Record<CityId, { name: string; abbr: string; tz: string }> = {
  cupertino: { name: "Cupertino", abbr: "CUP", tz: "America/Los_Angeles" },
  newyork: { name: "New York", abbr: "NYC", tz: "America/New_York" },
  london: { name: "London", abbr: "LON", tz: "Europe/London" },
  tokyo: { name: "Tokyo", abbr: "TYO", tz: "Asia/Tokyo" },
  sydney: { name: "Sydney", abbr: "SYD", tz: "Australia/Sydney" },
  paris: { name: "Paris", abbr: "PAR", tz: "Europe/Paris" },
}
const ALL_CITIES = Object.keys(CITIES) as CityId[]
const WIDGET_CITIES: CityId[] = ["cupertino", "newyork", "london", "tokyo"]

type CityTime = {
  h: number
  m: number
  /** Seconds, fractional when the second hand sweeps. */
  s: number
  /** 6:00–18:00 local to the city: white face. */
  day: boolean
  /** "9:41" */
  hm: string
  /** "AM" / "PM" */
  ampm: string
  /** "Today" / "Tomorrow" / "Yesterday" relative to the viewer. */
  dayLabel: string
  /** "+9HRS" / "-5HRS" / "+5:30HRS" relative to the viewer. */
  offsetLabel: string
  offsetMin: number
}

const pad = (n: number) => String(n).padStart(2, "0")

const fmtCache = new Map<string, Intl.DateTimeFormat>()
const offsetCache = new Map<string, { bucket: number; off: number }>()

/** The zone's UTC offset in minutes at `now`, cached per minute. */
function zoneOffset(tz: string, now: number): number {
  const bucket = Math.floor(now / 60000)
  const hit = offsetCache.get(tz)
  if (hit && hit.bucket === bucket) return hit.off
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
    fmtCache.set(tz, f)
  }
  const p: Record<string, number> = {}
  for (const part of f.formatToParts(new Date(now))) if (part.type !== "literal") p[part.type] = Number(part.value)
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second)
  const off = Math.round((asUTC - Math.floor(now / 1000) * 1000) / 60000)
  offsetCache.set(tz, { bucket, off })
  return off
}

function formatOffset(diff: number) {
  const sign = diff < 0 ? "-" : "+"
  const a = Math.abs(diff)
  const h = Math.floor(a / 60)
  const m = a % 60
  return `${sign}${h}${m ? ":" + pad(m) : ""}HRS`
}

function cityTime(now: number, tz: string, smooth: boolean): CityTime {
  const off = zoneOffset(tz, now)
  const local = -new Date(now).getTimezoneOffset()
  const d = new Date(now + off * 60000)
  const l = new Date(now + local * 60000)
  const h = d.getUTCHours()
  const m = d.getUTCMinutes()
  const sec = d.getUTCSeconds()
  const s = smooth ? sec + d.getUTCMilliseconds() / 1000 : sec
  const dayDiff = Math.round(
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate())) / 86400000,
  )
  const diff = off - local
  return {
    h,
    m,
    s,
    day: h >= 6 && h < 18,
    hm: `${h % 12 || 12}:${pad(m)}`,
    ampm: h < 12 ? "AM" : "PM",
    dayLabel: dayDiff === 0 ? "Today" : dayDiff === 1 ? "Tomorrow" : dayDiff === -1 ? "Yesterday" : dayDiff > 0 ? `+${dayDiff} days` : `${dayDiff} days`,
    offsetLabel: formatOffset(diff),
    offsetMin: diff,
  }
}

// ---------------------------------------------------------------------------
// Hooks

const RM_QUERY = "(prefers-reduced-motion: reduce)"
function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia(RM_QUERY)
  mq.addEventListener("change", cb)
  return () => mq.removeEventListener("change", cb)
}
function useReducedMotion() {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(RM_QUERY).matches,
    () => false,
  )
}

/**
 * Wall-clock time for analog faces. Every animation frame when the second
 * hand may sweep; once per second (on the second) with reduced motion.
 * Null until the client has mounted.
 */
function useNow(enabled = true) {
  const reduced = useReducedMotion()
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (!enabled) return
    let raf = 0
    let timer = 0
    if (reduced) {
      const tick = () => {
        setNow(Date.now())
        timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 8)
      }
      timer = window.setTimeout(tick, 0)
    } else {
      const loop = () => {
        setNow(Date.now())
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    }
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [enabled, reduced])
  return { now, smooth: !reduced }
}

function useCityTimes(ids: readonly CityId[], enabled = true) {
  const { now, smooth } = useNow(enabled)
  return ids.map((id) => ({ id, city: CITIES[id], t: now == null ? null : cityTime(now, CITIES[id].tz, smooth) }))
}

// ---------------------------------------------------------------------------
// Analog face

const r2 = (n: number) => Math.round(n * 100) / 100
const TICKS = Array.from({ length: 60 }, (_, i) => {
  const a = (i * 6 * Math.PI) / 180
  const major = i % 5 === 0
  const outer = 93
  const inner = major ? 81 : 88
  return {
    major,
    x1: r2(100 + Math.sin(a) * outer),
    y1: r2(100 - Math.cos(a) * outer),
    x2: r2(100 + Math.sin(a) * inner),
    y2: r2(100 - Math.cos(a) * inner),
  }
})
const NUMERALS = Array.from({ length: 12 }, (_, i) => {
  const n = i + 1
  const a = (n * 30 * Math.PI) / 180
  return { n, x: r2(100 + Math.sin(a) * 67), y: r2(100 - Math.cos(a) * 67) }
})

export function AnalogClock({
  size = 120,
  time,
  label,
  numerals = size >= 96,
  className,
  ariaLabel,
}: {
  size?: number
  time: CityTime | null
  /** A small label inside the face, e.g. "CUP". */
  label?: string
  numerals?: boolean
  className?: string
  ariaLabel?: string
}) {
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const ready = time != null
  const day = time ? time.day : true
  const ink = day ? "#1d1d1f" : "#f5f5f7"
  const faceCentre = day ? "#1d1d1f" : "#0b0b0d"
  const h = time?.h ?? 0
  const m = time?.m ?? 0
  const s = time?.s ?? 0
  const secA = r2(s * 6)
  const minA = r2((m + s / 60) * 6)
  const hourA = r2(((h % 12) + m / 60 + s / 3600) * 30)

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      role="img"
      aria-label={ariaLabel}
      className={cn("shrink-0 select-none", className)}
    >
      <defs>
        <radialGradient id={`${uid}-face`} cx="50%" cy="30%" r="80%">
          <stop offset="0%" stopColor={day ? "#ffffff" : "#2e2e33"} />
          <stop offset="100%" stopColor={day ? "#e9e9ee" : "#0c0c0e"} />
        </radialGradient>
        <filter id={`${uid}-shadow`} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="2.5" stdDeviation="2.2" floodColor="#000" floodOpacity={day ? 0.28 : 0.6} />
        </filter>
      </defs>

      <circle cx="100" cy="100" r="99" fill={`url(#${uid}-face)`} stroke={day ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.14)"} strokeWidth="1" />
      {day ? <circle cx="100" cy="100" r="97" fill="none" stroke="rgba(255,255,255,.75)" strokeWidth="1.5" /> : null}

      <g stroke={ink} strokeLinecap="round">
        {TICKS.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            strokeWidth={t.major ? 3.4 : 1.3}
            strokeOpacity={t.major ? 0.9 : 0.35}
          />
        ))}
      </g>

      {numerals ? (
        <g fill={ink} fontSize="21" fontWeight="500" textAnchor="middle" dominantBaseline="central" fontFamily="inherit">
          {NUMERALS.map((n) => (
            <text key={n.n} x={n.x} y={n.y}>
              {n.n}
            </text>
          ))}
        </g>
      ) : null}

      {label ? (
        <text
          x="100"
          y="140"
          fill={ink}
          fillOpacity="0.55"
          fontSize="19"
          fontWeight="600"
          letterSpacing="1"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="inherit"
        >
          {label}
        </text>
      ) : null}

      <g opacity={ready ? 1 : 0} style={{ transition: "opacity .5s var(--glass-ease)" }}>
        <g filter={`url(#${uid}-shadow)`} stroke={ink} strokeLinecap="round">
          <g transform={`rotate(${hourA} 100 100)`}>
            <line x1="100" y1="100" x2="100" y2="86" strokeWidth="3.2" />
            <line x1="100" y1="88" x2="100" y2="48" strokeWidth="8.5" />
          </g>
          <g transform={`rotate(${minA} 100 100)`}>
            <line x1="100" y1="100" x2="100" y2="86" strokeWidth="3.2" />
            <line x1="100" y1="88" x2="100" y2="17" strokeWidth="6.5" />
          </g>
          <circle cx="100" cy="100" r="6.5" fill={ink} stroke="none" />
        </g>
        <g transform={`rotate(${secA} 100 100)`}>
          <line x1="100" y1="124" x2="100" y2="12" stroke="#ff9f0a" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="100" cy="100" r="4.4" fill="#ff9f0a" />
          <circle cx="100" cy="100" r="1.7" fill={faceCentre} />
        </g>
      </g>
    </svg>
  )
}

function describe(name: string, t: CityTime | null) {
  return t ? `${name}: ${t.hm} ${t.ampm}, ${t.dayLabel}, ${t.offsetLabel}` : name
}

/** Text that holds its place, invisibly, until the time is known. */
function Late({ ready, children, className }: { ready: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("block transition-opacity duration-500 [transition-timing-function:var(--glass-ease)]", !ready && "opacity-0", className)}>
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Widget

export function ClockWidget({ size = "small", className }: { size?: WidgetSize; className?: string }) {
  const { open } = useWindowManager()
  const ids = size === "small" ? WIDGET_CITIES.slice(0, 1) : WIDGET_CITIES
  const cities = useCityTimes(ids)
  const openApp = () =>
    open("clock", { singleton: "app", title: APPS.clock.name, w: APPS.clock.defaultSize.w, h: APPS.clock.defaultSize.h })

  return (
    <Widget size={size} label="World Clock" className={className}>
      <button
        type="button"
        onClick={openApp}
        aria-label={`Open Clock. ${cities.map((c) => describe(c.city.name, c.t)).join(". ")}`}
        className="relative block h-full w-full rounded-[22px] text-left focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--glass-accent)]"
      >
        {size === "small" ? (
          <SmallFace c={cities[0]} />
        ) : size === "medium" ? (
          <span className="flex h-full items-center justify-between px-4">
            {cities.map(({ id, city, t }) => (
              <span key={id} className="flex w-[76px] flex-col items-center text-center">
                <AnalogClock size={72} time={t} label={city.abbr} />
                <span className="mt-2 block w-full truncate text-[11.5px] leading-tight font-semibold ink">{city.name}</span>
                <Late ready={!!t} className="text-[10.5px] leading-tight ink-soft">
                  {t?.dayLabel ?? "Today"}
                </Late>
                <Late ready={!!t} className="text-[10.5px] leading-tight tabular-nums ink-soft">
                  {t?.offsetLabel ?? "+0HRS"}
                </Late>
              </span>
            ))}
          </span>
        ) : (
          <span className="grid h-full grid-cols-2 grid-rows-2 gap-x-3 px-4 py-3">
            {cities.map(({ id, city, t }) => (
              <span key={id} className="flex min-h-0 flex-col items-center justify-center text-center">
                <AnalogClock size={100} time={t} />
                <span className="mt-1.5 block text-[12.5px] leading-tight font-semibold ink">{city.name}</span>
                <Late ready={!!t} className="text-[11px] leading-tight ink-soft">
                  {t ? `${t.dayLabel}, ${t.offsetLabel}` : "Today, +0HRS"}
                </Late>
                <Late ready={!!t} className="text-[14px] leading-tight font-light tabular-nums ink">
                  {t ? `${t.hm} ${t.ampm}` : "12:00 AM"}
                </Late>
              </span>
            ))}
          </span>
        )}
      </button>
    </Widget>
  )
}

function SmallFace({ c }: { c: { city: (typeof CITIES)[CityId]; t: CityTime | null } }) {
  const { city, t } = c
  return (
    <span className="flex h-full flex-col items-center px-3 pt-2.5 pb-2.5 text-center">
      <span className="block text-[12px] leading-tight font-semibold ink">{city.name}</span>
      <AnalogClock size={94} time={t} numerals className="mt-1" />
      <Late ready={!!t} className="mt-1 text-[11px] leading-tight ink-soft">
        {t ? `${t.dayLabel}, ${t.offsetLabel}` : "Today, +0HRS"}
      </Late>
      <Late ready={!!t} className="mt-px text-[10.5px] leading-tight font-medium tabular-nums ink-soft">
        {t ? `${t.hm} ${t.ampm}` : "12:00 AM"}
      </Late>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Window

type Tab = "world" | "alarms" | "stopwatch" | "timers"
const TABS: { id: Tab; name: string; icon: React.ReactNode }[] = [
  { id: "world", name: "World Clock", icon: <Globe /> },
  { id: "alarms", name: "Alarms", icon: <AlarmClock /> },
  { id: "stopwatch", name: "Stopwatch", icon: <Timer /> },
  { id: "timers", name: "Timers", icon: <Hourglass /> },
]

export function ClockWindow({ win }: { win: WindowState }) {
  const [tab, setTab] = React.useState<Tab>("world")
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([])
  const base = React.useId().replace(/[^a-zA-Z0-9_-]/g, "")

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab)
    let next = -1
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = TABS.length - 1
    if (next < 0) return
    e.preventDefault()
    setTab(TABS[next].id)
    tabRefs.current[next]?.focus()
  }

  return (
    <GlassWindow win={win} icon={<Clock />} minW={460} minH={360} contentClassName="flex flex-col">
      <div data-drag-handle className="@container flex shrink-0 justify-center border-b border-[var(--glass-ink-faint)] px-4 py-2">
        <div
          role="tablist"
          aria-label="Clock"
          onKeyDown={onTabKey}
          className="inline-flex rounded-lg bg-[var(--glass-ink-faint)] p-0.5 shadow-[inset_0_0_0_.5px_var(--glass-edge)]"
        >
          {TABS.map((t, i) => {
            const on = t.id === tab
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[i] = el
                }}
                type="button"
                role="tab"
                id={`${base}-tab-${t.id}`}
                aria-selected={on}
                aria-controls={`${base}-panel-${t.id}`}
                tabIndex={on ? 0 : -1}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex h-6 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-[background-color,color,box-shadow] duration-200 [transition-timing-function:var(--glass-ease)]",
                  "focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)] [&_svg]:size-3.5",
                  on
                    ? "bg-[var(--glass-bg-strong)] ink shadow-[0_1px_2px_rgba(0,0,0,.12),0_0_0_.5px_var(--glass-edge)]"
                    : "ink-soft hover:ink",
                )}
              >
                {t.icon}
                <span className="@max-[440px]:sr-only">{t.name}</span>
              </button>
            )
          })}
        </div>
      </div>

      {TABS.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={t.id !== tab}
          className="@container relative min-h-0 flex-1 flex-col data-[on=true]:flex"
          data-on={t.id === tab}
        >
          {t.id === "world" ? <WorldClockPane active={tab === "world"} /> : null}
          {t.id === "alarms" ? <AlarmsPane /> : null}
          {t.id === "stopwatch" ? <StopwatchPane /> : null}
          {t.id === "timers" ? <TimersPane /> : null}
        </div>
      ))}
    </GlassWindow>
  )
}

function PaneHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-5 pt-3.5 pb-2">
      <h2 className="text-[13px] font-semibold ink">{title}</h2>
      {sub ? <span className="text-[12px] ink-soft">{sub}</span> : null}
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  )
}

// ---- World Clock

function WorldClockPane({ active }: { active: boolean }) {
  const [ids, setIds] = React.useState<CityId[]>(WIDGET_CITIES)
  const [adding, setAdding] = React.useState(false)
  const { now, smooth } = useNow(active)
  const timeIn = (id: CityId) => (now == null ? null : cityTime(now, CITIES[id].tz, smooth))
  const cities = ids.map((id) => ({ id, city: CITIES[id], t: timeIn(id) }))
  const missing = ALL_CITIES.filter((id) => !ids.includes(id))
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const popRef = React.useRef<HTMLDivElement>(null)
  const focusAdd = () => wrapRef.current?.querySelector<HTMLButtonElement>("button")?.focus()

  React.useEffect(() => {
    if (!adding) return
    const first = popRef.current?.querySelector<HTMLButtonElement>("button")
    first?.focus()
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      setAdding(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAdding(false)
        wrapRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
      }
    }
    document.addEventListener("pointerdown", down)
    document.addEventListener("keydown", key)
    return () => {
      document.removeEventListener("pointerdown", down)
      document.removeEventListener("keydown", key)
    }
  }, [adding])

  return (
    <>
      <PaneHeader title="World Clock" sub={`${ids.length} ${ids.length === 1 ? "city" : "cities"}`}>
        <div ref={wrapRef} className="relative">
          <GlassButton
            aria-label="Add city"
            aria-haspopup="menu"
            aria-expanded={adding}
            active={adding}
            onClick={() => setAdding((a) => !a)}
          >
            <Plus />
          </GlassButton>
          {adding ? (
            <div
              ref={popRef}
              role="menu"
              aria-label="Add a city"
              className="glass glass-strong absolute top-full right-0 z-20 mt-1.5 w-56 rounded-xl p-1 [animation:glass-widget-in_.3s_var(--glass-spring)_both]"
            >
              {missing.length ? (
                missing.map((id) => (
                  <AddCityItem
                    key={id}
                    id={id}
                    t={timeIn(id)}
                    onPick={() => {
                      setIds((xs) => [...xs, id])
                      setAdding(false)
                      focusAdd()
                    }}
                  />
                ))
              ) : (
                <p className="px-2.5 py-2 text-[12px] ink-soft">Every city is already on the list.</p>
              )}
            </div>
          ) : null}
        </div>
      </PaneHeader>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {ids.length ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(158px,1fr))] gap-2">
            {cities.map(({ id, city, t }) => (
              <li
                key={id}
                className="group relative flex flex-col items-center rounded-2xl px-3 pt-4 pb-3 text-center transition-colors duration-200 hover:bg-[var(--glass-hover)]"
              >
                <AnalogClock size={128} time={t} ariaLabel={describe(city.name, t)} />
                <span className="mt-2.5 text-[13.5px] leading-tight font-semibold ink">{city.name}</span>
                <Late ready={!!t} className="mt-0.5 text-[11.5px] ink-soft">
                  {t ? `${t.dayLabel}, ${t.offsetLabel}` : "Today, +0HRS"}
                </Late>
                <Late ready={!!t} className="mt-0.5 text-[20px] leading-tight font-light tracking-tight tabular-nums ink">
                  {t ? t.hm : "12:00"}
                  <span className="ml-1 text-[12px] font-normal ink-soft">{t ? t.ampm : "AM"}</span>
                </Late>
                <button
                  type="button"
                  aria-label={`Remove ${city.name}`}
                  onClick={() => setIds((xs) => xs.filter((x) => x !== id))}
                  className={cn(
                    "absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-[var(--glass-ink-faint)] ink-soft opacity-0 transition-[opacity,transform] duration-200",
                    "group-hover:opacity-100 hover:bg-[#ff453a] hover:text-white focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)] active:scale-90",
                  )}
                >
                  <X className="size-3.5" strokeWidth={2.5} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid h-full place-items-center text-center">
            <div>
              <Globe className="mx-auto size-8 ink-soft" strokeWidth={1.5} />
              <p className="mt-2 text-[13px] font-medium ink">No cities</p>
              <p className="text-[12px] ink-soft">Use + to add one.</p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function AddCityItem({ id, t, onPick }: { id: CityId; t: CityTime | null; onPick: () => void }) {
  const city = CITIES[id]
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPick}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] ink hover:bg-[var(--glass-accent)] hover:text-white focus-visible:bg-[var(--glass-accent)] focus-visible:text-white focus-visible:outline-none [&:hover_span]:text-white/80 [&:focus-visible_span]:text-white/80"
    >
      {city.name}
      <span className="text-[11.5px] tabular-nums ink-soft">{t ? `${t.hm} ${t.ampm} · ${t.offsetLabel}` : ""}</span>
    </button>
  )
}

// ---- Alarms

type Alarm = { id: number; h: number; m: number; label: string; days: number[]; on: boolean }
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function repeatText(days: number[]) {
  const set = [...days].sort()
  const k = set.join(",")
  if (!set.length) return "Never"
  if (set.length === 7) return "Every day"
  if (k === "1,2,3,4,5") return "Weekdays"
  if (k === "0,6") return "Weekends"
  return set.map((d) => DAY_NAMES[d]).join(", ")
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 [transition-timing-function:var(--glass-ease)]",
        "shadow-[inset_0_0_0_.5px_var(--glass-edge)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--glass-accent)]",
        on ? "bg-[#34c759]" : "bg-[var(--glass-ink-faint)]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-[2px] left-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.3),0_0_0_.5px_rgba(0,0,0,.06)]",
          "transition-transform duration-300 [transition-timing-function:var(--glass-spring)]",
          on && "translate-x-4",
        )}
      />
    </button>
  )
}

function AlarmsPane() {
  const [alarms, setAlarms] = React.useState<Alarm[]>([
    { id: 1, h: 6, m: 30, label: "Wake up", days: [1, 2, 3, 4, 5], on: true },
    { id: 2, h: 9, m: 0, label: "Long run", days: [0, 6], on: false },
    { id: 3, h: 22, m: 15, label: "Wind down", days: [0, 1, 2, 3, 4, 5, 6], on: true },
  ])
  const add = () => {
    const d = new Date()
    const h = (d.getHours() + 1) % 24
    setAlarms((xs) => [...xs, { id: Date.now(), h, m: 0, label: "Alarm", days: [], on: true }])
  }
  const set = (id: number, patch: Partial<Alarm>) => setAlarms((xs) => xs.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  const sorted = [...alarms].sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m))
  const onCount = alarms.filter((a) => a.on).length

  return (
    <>
      <PaneHeader title="Alarms" sub={`${onCount} on`}>
        <GlassButton aria-label="Add alarm at the next hour" onClick={add}>
          <Plus />
        </GlassButton>
      </PaneHeader>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        {sorted.length ? (
          <ul>
            {sorted.map((a, i) => (
              <li key={a.id} className="[animation:glass-widget-in_.35s_var(--glass-spring)_both]">
                {i > 0 ? <Hairline /> : null}
                <div className="group flex items-center gap-3 py-3">
                  <div className={cn("min-w-0 flex-1 transition-opacity duration-200", !a.on && "opacity-55")}>
                    <div className="leading-none ink">
                      <span className="text-[38px] font-light tracking-tight tabular-nums">
                        {a.h % 12 || 12}:{pad(a.m)}
                      </span>
                      <span className="ml-1 text-[17px] font-light">{a.h < 12 ? "AM" : "PM"}</span>
                    </div>
                    <p className="mt-1 truncate text-[12.5px] ink-soft">
                      {a.label}
                      {a.days.length ? `, ${repeatText(a.days)}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Delete ${a.label} alarm`}
                    onClick={() => setAlarms((xs) => xs.filter((x) => x.id !== a.id))}
                    className="grid size-6 place-items-center rounded-full ink-soft opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[#ff453a] hover:text-white focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)]"
                  >
                    <X className="size-3.5" strokeWidth={2.5} />
                  </button>
                  <Switch
                    on={a.on}
                    onChange={(on) => set(a.id, { on })}
                    label={`${a.label}, ${a.h % 12 || 12}:${pad(a.m)} ${a.h < 12 ? "AM" : "PM"}`}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid h-full place-items-center text-center">
            <div>
              <AlarmClock className="mx-auto size-8 ink-soft" strokeWidth={1.5} />
              <p className="mt-2 text-[13px] font-medium ink">No alarms</p>
              <p className="text-[12px] ink-soft">Use + to add one.</p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ---- Stopwatch

function formatStopwatch(ms: number) {
  const cs = Math.floor(ms / 10)
  const c = cs % 100
  const s = Math.floor(cs / 100) % 60
  const m = Math.floor(cs / 6000) % 60
  const h = Math.floor(cs / 360000)
  return `${h ? h + ":" + pad(m) : pad(m)}:${pad(s)}.${pad(c)}`
}

/** The big round macOS Clock buttons. */
function RoundButton({
  tone,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone: "grey" | "green" | "red" | "orange" }) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-[68px] shrink-0 place-items-center rounded-full text-[13px] font-medium",
        "shadow-[0_0_0_2px_var(--glass-bg-strong),0_0_0_3px_var(--glass-ink-faint)]",
        "transition-[transform,background-color,color,opacity] duration-200 [transition-timing-function:var(--glass-ease)] active:scale-95",
        "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--glass-accent)] disabled:opacity-40",
        tone === "grey" && "bg-[var(--glass-ink-faint)] ink",
        tone === "green" && "bg-[#34c759]/20 text-[#1f9d45] dark:text-[#30d158]",
        tone === "red" && "bg-[#ff453a]/20 text-[#e0352b] dark:text-[#ff6961]",
        tone === "orange" && "bg-[#ff9f0a]/20 text-[#c97a00] dark:text-[#ffb340]",
        className,
      )}
      {...rest}
    />
  )
}

type Sw = { running: boolean; acc: number; startedAt: number; elapsed: number; laps: number[] }

function StopwatchPane() {
  const [sw, setSw] = React.useState<Sw>({ running: false, acc: 0, startedAt: 0, elapsed: 0, laps: [] })

  React.useEffect(() => {
    if (!sw.running) return
    let raf = 0
    const loop = () => {
      const t = performance.now()
      setSw((s) => (s.running ? { ...s, elapsed: s.acc + t - s.startedAt } : s))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [sw.running])

  const start = () => {
    const t = performance.now()
    setSw((s) => ({ ...s, running: true, startedAt: t }))
  }
  const stop = () => {
    const t = performance.now()
    setSw((s) => {
      const total = s.acc + t - s.startedAt
      return { ...s, running: false, acc: total, elapsed: total }
    })
  }
  const lap = () => {
    const t = performance.now()
    setSw((s) => {
      const total = s.acc + t - s.startedAt
      const done = s.laps.reduce((a, b) => a + b, 0)
      return { ...s, elapsed: total, laps: [...s.laps, total - done] }
    })
  }
  const reset = () => setSw({ running: false, acc: 0, startedAt: 0, elapsed: 0, laps: [] })

  const lapsTotal = sw.laps.reduce((a, b) => a + b, 0)
  const current = sw.elapsed - lapsTotal
  const ranked = sw.laps.length >= 2
  const fastest = ranked ? Math.min(...sw.laps) : -1
  const slowest = ranked ? Math.max(...sw.laps) : -1

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 px-6 pt-5 pb-4">
        {sw.running ? (
          <RoundButton tone="grey" onClick={lap}>
            Lap
          </RoundButton>
        ) : (
          <RoundButton tone="grey" onClick={reset} disabled={sw.elapsed === 0}>
            {sw.elapsed === 0 ? "Lap" : "Reset"}
          </RoundButton>
        )}
        <div
          role="timer"
          aria-label="Elapsed time"
          className="min-w-0 text-center text-[clamp(40px,12cqw,84px)] leading-none font-extralight tracking-tight tabular-nums ink"
        >
          {formatStopwatch(sw.elapsed)}
        </div>
        {sw.running ? (
          <RoundButton tone="red" onClick={stop}>
            Stop
          </RoundButton>
        ) : (
          <RoundButton tone="green" onClick={start}>
            Start
          </RoundButton>
        )}
      </div>
      <Hairline />
      <ol aria-label="Laps" className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-1">
        {sw.elapsed > 0 ? (
          <LapRow n={sw.laps.length + 1} ms={current} />
        ) : (
          <li className="py-6 text-center text-[12.5px] ink-soft">Laps appear here.</li>
        )}
        {sw.laps
          .map((ms, i) => ({ ms, n: i + 1 }))
          .reverse()
          .map(({ ms, n }) => (
            <LapRow key={n} n={n} ms={ms} tone={ms === fastest ? "fast" : ms === slowest ? "slow" : undefined} />
          ))}
      </ol>
    </div>
  )
}

function LapRow({ n, ms, tone }: { n: number; ms: number; tone?: "fast" | "slow" }) {
  return (
    <li
      className={cn(
        "flex items-center justify-between border-b border-[var(--glass-ink-faint)] py-2 text-[13px] tabular-nums last:border-b-0",
        tone === "fast" ? "text-[#1f9d45] dark:text-[#30d158]" : tone === "slow" ? "text-[#e0352b] dark:text-[#ff6961]" : "ink",
      )}
    >
      <span>Lap {n}</span>
      <span>{formatStopwatch(ms)}</span>
    </li>
  )
}

// ---- Timers

type TimerState = { duration: number; remaining: number; endAt: number | null; done: boolean }
const PRESETS = [1, 5, 10, 25]
const MIN = 60000
const RING_R = 88
const RING_C = 2 * Math.PI * RING_R

function formatTimer(ms: number) {
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor(total / 60) % 60
  const s = total % 60
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function TimersPane() {
  const [tm, setTm] = React.useState<TimerState>({ duration: 5 * MIN, remaining: 5 * MIN, endAt: null, done: false })
  const running = tm.endAt != null
  const fresh = !running && !tm.done && tm.remaining === tm.duration

  React.useEffect(() => {
    if (!running) return
    let raf = 0
    const loop = () => {
      const t = performance.now()
      setTm((s) => {
        if (s.endAt == null) return s
        const r = Math.max(0, s.endAt - t)
        return r === 0 ? { ...s, remaining: 0, endAt: null, done: true } : { ...s, remaining: r }
      })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [running])

  const setDuration = (ms: number) => setTm({ duration: ms, remaining: ms, endAt: null, done: false })
  const start = () => {
    const t = performance.now()
    setTm((s) => {
      const r = s.done || s.remaining <= 0 ? s.duration : s.remaining
      return { ...s, remaining: r, endAt: t + r, done: false }
    })
  }
  const pause = () => {
    const t = performance.now()
    setTm((s) => (s.endAt == null ? s : { ...s, remaining: Math.max(0, s.endAt - t), endAt: null }))
  }
  const reset = () => setTm((s) => ({ ...s, remaining: s.duration, endAt: null, done: false }))

  const frac = tm.duration ? tm.remaining / tm.duration : 0
  const mins = Math.round(tm.duration / MIN)

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-3 px-6 pt-4 pb-5">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div className={cn("relative aspect-square h-full max-h-[250px] min-h-[120px]", tm.done && "motion-safe:animate-pulse")}>
          <svg viewBox="0 0 200 200" className="size-full -rotate-90" aria-hidden="true">
            <circle cx="100" cy="100" r={RING_R} fill="none" stroke="var(--glass-ink-faint)" strokeWidth="7" />
            <circle
              cx="100"
              cy="100"
              r={RING_R}
              fill="none"
              stroke="#ff9f0a"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - frac)}
              className={cn(!running && "transition-[stroke-dashoffset] duration-500 [transition-timing-function:var(--glass-ease)]")}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <div role="timer" aria-label="Time remaining" className="text-[clamp(28px,8cqw,48px)] leading-none font-extralight tracking-tight tabular-nums ink">
              {formatTimer(tm.remaining)}
            </div>
            <div aria-live="polite" className={cn("mt-1.5 flex items-center gap-1 text-[12px]", tm.done ? "font-semibold text-[#c97a00] dark:text-[#ffb340]" : "ink-soft")}>
              <Bell className="size-3" />
              {tm.done ? "Done" : `${mins} min`}
            </div>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-center gap-1.5">
        <GlassButton aria-label="One minute less" disabled={running || mins <= 1} onClick={() => setDuration(Math.max(1, mins - 1) * MIN)}>
          <Minus />
        </GlassButton>
        {PRESETS.map((p) => (
          <GlassButton key={p} active={mins === p} aria-pressed={mins === p} disabled={running} onClick={() => setDuration(p * MIN)} className="tabular-nums">
            {p} min
          </GlassButton>
        ))}
        <GlassButton aria-label="One minute more" disabled={running || mins >= 99} onClick={() => setDuration(Math.min(99, mins + 1) * MIN)}>
          <Plus />
        </GlassButton>
      </div>

      <div className="flex shrink-0 items-center gap-10">
        <RoundButton tone="grey" onClick={reset} disabled={fresh}>
          {tm.done ? "Reset" : "Cancel"}
        </RoundButton>
        {running ? (
          <RoundButton tone="orange" onClick={pause}>
            Pause
          </RoundButton>
        ) : (
          <RoundButton tone="green" onClick={start}>
            {fresh || tm.done ? "Start" : "Resume"}
          </RoundButton>
        )}
      </div>
    </div>
  )
}
