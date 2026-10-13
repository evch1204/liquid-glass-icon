"use client"

import * as React from "react"
import { GlassObject, GlassPane, GlassSheet, LIQUIDS, LiquidCanvas, useGlass, useSpringVar, type LiquidRecipe } from "@/components/ui/glass-object"
import { rng } from "@/components/ui/glass-folder-cards"
import { WIDGET, type WidgetSize } from "../glass"
import { APPS } from "@/lib/apps"
import { useWindowManager } from "../window-manager"

/**
 * Calendar — the macOS Calendar widget, with a real page in it.
 *
 * At rest it reads exactly as the native widget: one frosted card over a
 * paper-warm liquid light, the weekday in Calendar red over a light day
 * number, the next events with coloured dots, and (wider sizes) the month.
 * The one difference is that the date is printed on a page: a white sheet
 * with a hair of paper edge, lying on the glass.
 *
 * - **Hover**: the card leans back and lifts; the thumb catches the page's
 *   bottom-right corner and `--curl` lifts it — the page is cut along a
 *   diagonal and the back of the paper folds over as a flap with its own
 *   shadow; the events list lifts 2px.
 * - **Press**: the thumb flattens the curl and the page dips; on release the
 *   corner springs back past where it was, then settles.
 * - **Open** (click): the corner is grabbed (`--curl` → 1), then the page flips
 *   (`--flip`) up about its top edge, bending like paper on the way, and ends
 *   leaning back past vertical as a sliver of its ruled Notes side. Under it:
 *   the rest of today and this week. Medium raises today's events as chips;
 *   large fans the day's events out as sheets. The card only drops a little.
 * - **Close**: the page slaps down, overshoots a few degrees, and drops again;
 *   its shadow sharpens on impact.
 * - **Midnight**: if the date changes while the widget is on the desk, the
 *   page tears off along its perforation and falls away; the new date is
 *   underneath.
 * - **Activate** (double-click, Enter): the Calendar app.
 *
 * The date is read only after mount, so server and client markup agree; the
 * events are fictional, generated exactly as the Calendar app generates them
 * (same seed, same pool), so the widget and the app tell the same story.
 */

// ---------------------------------------------------------------------------
// Time, read only after mount (hydration safe), shared by every instance

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
    }, 15_000)
  }
  return () => {
    nowListeners.delete(cb)
    if (!nowListeners.size && nowTimer) {
      clearInterval(nowTimer)
      nowTimer = undefined
    }
  }
}

function useToday(): Today | null {
  const now = React.useSyncExternalStore(
    subscribeNow,
    () => nowValue,
    () => null,
  )
  return React.useMemo(() => {
    if (now === null) return null
    const t = new Date(now)
    return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate(), minutes: t.getHours() * 60 + t.getMinutes() }
  }, [now])
}

// ---------------------------------------------------------------------------
// Dates as plain numbers

type Ymd = { y: number; m: number; d: number }
type Today = Ymd & { minutes: number }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
const weekdayOf = (v: Ymd) => new Date(v.y, v.m, v.d).getDay()
const same = (a: Ymd, b: Ymd) => a.y === b.y && a.m === b.m && a.d === b.d
const addDays = (v: Ymd, n: number): Ymd => {
  const t = new Date(v.y, v.m, v.d + n)
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() }
}

/** Five or six weeks of cells covering a month, Sunday first. */
function monthCells(y: number, m: number): (Ymd & { inMonth: boolean })[] {
  const first = { y, m, d: 1 }
  const lead = weekdayOf(first)
  const all = Array.from({ length: 42 }, (_, i) => {
    const v = addDays(first, i - lead)
    return { ...v, inMonth: v.m === m }
  })
  return all[35].inMonth ? all : all.slice(0, 35)
}

function fmtTime(min: number, short = false) {
  const h = Math.floor(min / 60)
  const mm = min % 60
  const hh = h % 12 === 0 ? 12 : h % 12
  if (short) return `${hh}${mm ? ":" + String(mm).padStart(2, "0") : ""}${h < 12 ? "a" : "p"}`
  return `${hh}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

// ---------------------------------------------------------------------------
// Events: the same generator as the Calendar app (./calendar.tsx), which does
// not export it. Keep the two in step.

type CalId = "home" | "work" | "family" | "birthdays"
const COLOR: Record<CalId, string> = { home: "#0a84ff", work: "#ff9f0a", family: "#30d158", birthdays: "#bf5af2" }

type CalEvent = Ymd & { id: string; title: string; cal: CalId; start: number | null; dur: number; where?: string }

const POOL: { title: string; cal: CalId; where?: string; allDay?: boolean; dur?: number }[] = [
  { title: "Design review", cal: "work", where: "Studio 2", dur: 60 },
  { title: "Dentist", cal: "home", where: "Dr. Okafor", dur: 45 },
  { title: "Lisbon shoot", cal: "work", where: "Alfama", allDay: true },
  { title: "Glass type crit", cal: "work", where: "Zoom", dur: 45 },
  { title: "Yoga", cal: "home", where: "Studio Nine", dur: 60 },
  { title: "Dinner at Mum's", cal: "family", where: "Los Gatos", dur: 120 },
  { title: "Farmers market", cal: "home", dur: 90 },
  { title: "Ship 2.4 build", cal: "work", dur: 30 },
  { title: "Soccer practice", cal: "family", where: "Memorial Park", dur: 90 },
  { title: "1:1 with Priya", cal: "work", dur: 30 },
  { title: "Pick up prints", cal: "home", where: "Lab on 3rd", dur: 30 },
  { title: "Movie night", cal: "family", dur: 150 },
]
const BIRTHDAYS = ["Maya's Birthday", "Theo's Birthday"]

const eventCache = new Map<string, CalEvent[]>()

function eventsForMonth(y: number, m: number, today: Today): CalEvent[] {
  const isThis = today.y === y && today.m === m
  const cacheKey = `${y}-${m}-${isThis ? today.d : ""}`
  const hit = eventCache.get(cacheKey)
  if (hit) return hit
  const r = rng(y * 12 + m + 101)
  const n = daysIn(y, m)
  const out: CalEvent[] = []
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const startTime = () => (8 + Math.floor(r() * 10)) * 60 + (r() < 0.5 ? 0 : 30)
  const push = (d: number, p: (typeof POOL)[number], start: number | null) =>
    out.push({ y, m, d, id: `${y}-${m}-${out.length}`, title: p.title, cal: p.cal, where: p.where, start: p.allDay ? null : start, dur: p.dur ?? 60 })
  out.push({ y, m, d: 3 + Math.floor(r() * 10), id: `${y}-${m}-b0`, title: BIRTHDAYS[(y + m) % 2], cal: "birthdays", start: null, dur: 0 })
  const pool = [...POOL]
  for (let i = 0; i < 9; i++) {
    const p = pool.splice(Math.floor(r() * pool.length), 1)[0] ?? pick(POOL)
    push(1 + Math.floor(r() * n), p, startTime())
  }
  if (isThis) {
    const d = today.d
    push(d, POOL[0], 10 * 60)
    push(d, POOL[9], 14 * 60 + 30)
    push(d, POOL[4], 18 * 60)
    if (d < n) push(d + 1, POOL[1], 9 * 60 + 30)
  } else {
    push(1 + Math.floor(r() * n), POOL[0], 11 * 60)
    push(1 + Math.floor(r() * n), POOL[1], 9 * 60 + 30)
  }
  out.sort((a, b) => a.d - b.d || (a.start ?? -1) - (b.start ?? -1))
  eventCache.set(cacheKey, out)
  return out
}

const eventsOn = (v: Ymd, today: Today) => eventsForMonth(v.y, v.m, today).filter((e) => e.d === v.d)
const timeLabel = (e: CalEvent, short = false) => (e.start === null ? "All-day" : fmtTime(e.start, short))

/** What is still to come: the rest of today, else tomorrow (labelled). */
function upcoming(today: Today): { label: string | null; events: CalEvent[] } {
  const rest = eventsOn(today, today).filter((e) => e.start === null || e.start + e.dur > today.minutes)
  if (rest.length) return { label: null, events: rest }
  const t = eventsOn(addDays(today, 1), today)
  return { label: t.length ? "Tomorrow" : null, events: t }
}

/** The next `n` events from now on, across days and months. */
function nextEvents(today: Today, n: number): CalEvent[] {
  const out: CalEvent[] = []
  for (let i = 0; i < 62 && out.length < n; i++) {
    const day = addDays(today, i)
    for (const e of eventsOn(day, today)) {
      if (i === 0 && e.start !== null && e.start + e.dur <= today.minutes) continue
      out.push(e)
      if (out.length >= n) break
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Geometry: where the page lies on the card, and how far it turns when open.

type Geo = { x: number; y: number; w: number; h: number; deg: number }

const GEO: Record<WidgetSize, Geo> = {
  small: { x: 10, y: 10, w: 150, h: 74, deg: 100 },
  medium: { x: 10, y: 10, w: 150, h: 150, deg: 96 },
  large: { x: 12, y: 12, w: 156, h: 114, deg: 100 },
}

const PAPER: LiquidRecipe = { colors: ["#ece8e1", "#f7f4ef", "#ffffff", "#efebe4"], gloss: 0.5 }

/** A perforated edge for the torn page: teeth along the top. */
const PERFORATION = (() => {
  const n = 28
  const pts: string[] = []
  for (let i = 0; i <= n; i++) pts.push(`${((i / n) * 100).toFixed(2)}% ${i % 2 ? 3.5 : 0}px`)
  return `polygon(${pts.join(", ")}, 100% 100%, 0 100%)`
})()

const NBSP = " "

// ---------------------------------------------------------------------------
// Small pieces

function Dot({ e }: { e: CalEvent }) {
  return <span className="cal-dot" style={{ background: COLOR[e.cal] }} />
}

/** One event as the native widget lists it: dot, title, time. */
function EventLine({ e, prefix, where = false, past = false }: { e: CalEvent; prefix?: string | null; where?: boolean; past?: boolean }) {
  return (
    <div className={"cal-evl" + (past ? " cal-past" : "")}>
      <Dot e={e} />
      <span className="cal-evl-text">
        <span className="cal-evl-title">{e.title}</span>
        <span className="cal-evl-time go-mono">
          {prefix ? prefix + " · " : ""}
          {timeLabel(e)}
          {where && e.where ? <span className="cal-evl-where"> · {e.where}</span> : null}
        </span>
      </span>
    </div>
  )
}

/** The front of the page: red weekday, a light day number, and what each size adds. */
function Front({ today, size }: { today: Today | null; size: WidgetSize }) {
  const up = today && size === "medium" ? upcoming(today) : null
  return (
    <div className="cal-front" aria-hidden="true">
      <span className="cal-wd">{today ? WEEKDAYS[weekdayOf(today)] : NBSP}</span>
      <span className="cal-num">{today ? today.d : NBSP}</span>
      {size === "large" ? <span className="cal-my go-soft">{today ? MONTHS[today.m] + " " + today.y : NBSP}</span> : null}
      {up ? (
        <div className="cal-front-next">
          {up.events[0] ? <EventLine e={up.events[0]} prefix={up.label} /> : <span className="cal-none go-soft">No more events today</span>}
        </div>
      ) : null}
    </div>
  )
}

/** The page: front, ruled Notes back, the curled corner's flap. */
function Leaf({ today, size }: { today: Today | null; size: WidgetSize }) {
  return (
    <div className="cal-leaf" aria-hidden="true">
      <div className="cal-sheet">
        <Front today={today} size={size} />
        <span className="cal-ghost">{today ? today.d : NBSP}</span>
        <div className="cal-notes">
          <span className="cal-notes-h">Notes</span>
        </div>
      </div>
      <div className="cal-flaphost">
        <div className="cal-flap" />
      </div>
    </div>
  )
}

/** Yesterday's page, torn off along its perforation and falling in rAF physics. */
function Torn({ day, size, onDone }: { day: Today; size: WidgetSize; onDone: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const done = React.useRef(onDone)
  React.useLayoutEffect(() => {
    done.current = onDone
  })
  React.useEffect(() => {
    const el = ref.current
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    let raf = 0
    let last = 0
    let x = 0
    let y = 0
    let vy = -40
    let rot = 0
    const step = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016
      last = now
      vy += 900 * dt
      y += vy * dt
      x += 40 * dt
      rot += 60 * dt
      if (el) {
        el.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${rot.toFixed(2)}deg)`
        el.style.opacity = String(Math.max(0, 1 - Math.max(0, y) / 200))
      }
      if (reduce || y > 200) {
        done.current()
        return
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div ref={ref} className="cal-torn" style={{ clipPath: PERFORATION }} aria-hidden="true">
      <Front today={day} size={size} />
    </div>
  )
}

/** This week, Sunday first, with a dot on days that have events. */
function Week({ today }: { today: Today }) {
  const start = addDays(today, -weekdayOf(today))
  return (
    <div className="cal-week">
      {Array.from({ length: 7 }, (_, i) => {
        const d = addDays(start, i)
        const has = eventsOn(d, today).length > 0
        return (
          <span key={i} className={"cal-wk" + (same(d, today) ? " cal-wk-now" : "")}>
            <span className="cal-wk-l">{WEEKDAYS[i][0]}</span>
            <span className="cal-wk-n">{d.d}</span>
            <i className={has ? "cal-wk-dot" : "cal-wk-dot cal-wk-none"} />
          </span>
        )
      })}
    </div>
  )
}

/** What the page was covering: the rest of today (then the coming days) and this week. */
function Under({ today, size }: { today: Today | null; size: WidgetSize }) {
  if (!today) return <div className="cal-under" />
  if (size === "medium") {
    const ev = eventsOn(today, today).slice(0, 3)
    return (
      <div className="cal-under" aria-hidden="true">
        <Week today={today} />
        <div className="cal-chips">
          {ev.map((e, i) => (
            <GlassSheet key={e.id} className="cal-chip" style={{ "--c": COLOR[e.cal], "--nl": `var(--n${i})` } as React.CSSProperties}>
              <span className="cal-chip-bar" />
              <span className="cal-chip-title">{e.title}</span>
              <span className="cal-chip-time go-mono">{timeLabel(e, true)}</span>
            </GlassSheet>
          ))}
        </div>
      </div>
    )
  }
  const rows = nextEvents(today, 4)
  return (
    <div className="cal-under" aria-hidden="true">
      <div className="cal-agenda">
        {rows.length ? null : <span className="cal-none go-soft">Nothing coming up</span>}
        {rows.map((e) => {
          const isToday = same(e, today)
          return (
            <div key={e.id} className="cal-row" style={{ "--c": COLOR[e.cal] } as React.CSSProperties}>
              <span className="cal-row-time go-mono">{isToday ? timeLabel(e, true) : WEEKDAYS[weekdayOf(e)].slice(0, 3) + " " + e.d}</span>
              <span className="cal-row-bar" />
              <span className="cal-row-title">{e.title}</span>
            </div>
          )
        })}
      </div>
      <Week today={today} />
    </div>
  )
}

/** A month: today in a red filled circle, faint dots on days with events. */
function Month({ today, className }: { today: Today | null; className?: string }) {
  const cells = today ? monthCells(today.y, today.m) : []
  const rows = cells.length / 7 || 6
  const month = today ? eventsForMonth(today.y, today.m, today) : []
  return (
    <div className={"cal-month" + (className ? " " + className : "")} style={{ "--rows": rows } as React.CSSProperties} aria-hidden="true">
      <div className="cal-month-head">
        <span className="cal-month-name">{today ? MONTHS[today.m] : NBSP}</span>
      </div>
      <div className="cal-month-wd">
        {WEEKDAYS.map((w, i) => (
          <span key={i}>{w[0]}</span>
        ))}
      </div>
      <div className="cal-month-grid">
        {cells.map((c) => {
          const isToday = today ? same(c, today) : false
          const has = c.inMonth && month.some((e) => e.d === c.d)
          return (
            <span key={`${c.y}-${c.m}-${c.d}`} className={"cal-cell" + (c.inMonth ? "" : " cal-out") + (isToday ? " cal-today" : "")}>
              <span className="cal-cell-n">{c.d}</span>
              <i className={has ? "cal-cell-dot" : "cal-cell-dot cal-wk-none"} />
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** Small: the next two events under the page. */
function SmallList({ today }: { today: Today | null }) {
  if (!today) return <div className="cal-list" />
  const up = upcoming(today)
  const ev = up.events.slice(0, 2)
  return (
    <div className="cal-list" aria-hidden="true">
      {ev.length ? ev.map((e) => <EventLine key={e.id} e={e} prefix={up.label} />) : <span className="cal-none go-soft">No more events today</span>}
    </div>
  )
}

/** Large: the day's events beside the page; open fans them out as sheets. */
function LargeList({ today }: { today: Today | null }) {
  const ev = today ? eventsOn(today, today).slice(0, 4) : []
  return (
    <>
      <div className="cal-list cal-list-l" aria-hidden="true">
        <span className="cal-list-h go-soft">Today</span>
        {today && !ev.length ? <span className="cal-none go-soft">No events</span> : null}
        {ev.map((e) => (
          <EventLine key={e.id} e={e} where past={!!today && e.start !== null && e.start + e.dur <= today.minutes} />
        ))}
      </div>
      <div className="cal-fan" aria-hidden="true">
        {ev.map((e, i) => (
          <GlassSheet key={e.id} className="cal-fan-sheet" style={{ "--i": i, "--mid": (ev.length - 1) / 2, "--c": COLOR[e.cal], "--nl": `var(--n${i})` } as React.CSSProperties}>
            <span className="cal-chip-bar" />
            <span className="cal-fan-time go-mono">{timeLabel(e, true)}</span>
            <span className="cal-chip-title">{e.title}</span>
            {e.where ? <span className="cal-fan-where go-soft">{e.where}</span> : null}
          </GlassSheet>
        ))}
      </div>
    </>
  )
}

/** The page, what lies under it, its shadow, and yesterday's page if it is falling. */
function Page({ today, size }: { today: Today | null; size: WidgetSize }) {
  const g = GEO[size]
  // the page that was today, kept just long enough to tear it off
  const [shown, setShown] = React.useState<Today | null>(null)
  const [torn, setTorn] = React.useState<Today | null>(null)
  if (today && (!shown || !same(shown, today))) {
    if (shown) setTorn(shown)
    setShown(today)
  }
  return (
    <div className="cal-page" style={{ left: g.x, top: g.y, width: g.w, height: g.h, "--deg": g.deg + "deg" } as React.CSSProperties}>
      <Under today={today} size={size} />
      <div className="cal-leafshadow" aria-hidden="true" />
      <Leaf today={today} size={size} />
      {torn ? <Torn key={`${torn.y}-${torn.m}-${torn.d}`} day={torn} size={size} onDone={() => setTorn(null)} /> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The object's own springs and their staging

function Card({ today, size }: { today: Today | null; size: WidgetSize }) {
  const { hover, pressed, open, tone } = useGlass()
  const wrap = React.useRef<HTMLDivElement>(null)
  const curl = useSpringVar(wrap, "--curl", 0, 140, 12)
  const flip = useSpringVar(wrap, "--flip", 0, 60, 9)
  const n0 = useSpringVar(wrap, "--n0", 0, 150, 14)
  const n1 = useSpringVar(wrap, "--n1", 0, 150, 14)
  const n2 = useSpringVar(wrap, "--n2", 0, 150, 14)
  const n3 = useSpringVar(wrap, "--n3", 0, 150, 14)
  const was = React.useRef({ open: false, pressed: false })
  const timers = React.useRef<number[]>([])

  React.useEffect(() => {
    const prev = was.current
    was.current = { open, pressed }
    const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms))
    const sheets = [n0, n1, n2, n3]
    if (open !== prev.open) {
      // a new order of events: whatever the last one had queued is dropped
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current = []
      if (open) {
        // the grab: the corner comes right up under the thumb…
        curl(1, { k: 520, c: 34 })
        // …then the page goes over, straightening as it travels
        later(80, () => flip(1, { k: 60, c: 9 }))
        later(220, () => curl(0, { k: 90, c: 13 }))
        // and what it uncovered rises, one after another
        sheets.forEach((n, i) => later(230 + i * 70, () => n(1, { k: 150, c: 13 })))
      } else {
        // the slap: stiff and underdamped, so it lands, bounces, lands
        flip(0, { k: 120, c: 9 })
        later(320, () => curl(hover ? 0.35 : 0, { k: 140, c: 12 }))
        sheets.forEach((n) => n(0, { k: 260, c: 26 }))
      }
      return
    }
    if (open) return
    if (pressed) curl(0.15, { k: 420, c: 30 })
    else if (prev.pressed) curl(hover ? 0.35 : 0, { k: 140, c: 9 })
    else curl(hover ? 0.35 : 0, { k: 140, c: 12 })
  }, [open, pressed, hover, curl, flip, n0, n1, n2, n3])

  React.useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  return (
    <div ref={wrap} className="cal-body" data-ready={today ? "true" : undefined}>
      <LiquidCanvas recipe={tone === "dark" ? LIQUIDS.smoke : PAPER} seed={size === "small" ? 3 : size === "medium" ? 6 : 9} cells={size === "small" ? 72 : 120} />
      <GlassPane hinge="bottom" lean={-9} openLean={-18} openShift={6} openFade={0.35} frost={0.9} radius={22} drive={{ open: "--flip" }} className="cal-card">
        {size === "small" ? <SmallList today={today} /> : null}
        {size === "medium" ? <Month today={today} className="cal-month-m" /> : null}
        {size === "large" ? (
          <>
            <Month today={today} className="cal-month-l" />
            <LargeList today={today} />
          </>
        ) : null}
        <Page today={today} size={size} />
      </GlassPane>
    </div>
  )
}

export function CalendarWidget({ size = "small", className, appearDelay = 0 }: { size?: WidgetSize; className?: string; appearDelay?: number }) {
  const { open, tone } = useWindowManager()
  const today = useToday()
  const { w, h } = WIDGET[size]
  const label = today ? `Calendar, ${WEEKDAYS[weekdayOf(today)]} ${MONTHS[today.m]} ${today.d}` : "Calendar"
  return (
    <GlassObject
      width={w}
      height={h}
      tone={tone}
      label={label}
      radius={22}
      tilt={4}
      pivot="base"
      appearDelay={appearDelay}
      className={"cal-root cal-" + size + (className ? " " + className : "")}
      onActivate={() => open("calendar", { singleton: "app", title: APPS.calendar.name, w: 760, h: 540 })}
    >
      <style href="calendar-object" precedence="glass-widget">
        {CAL_CSS}
      </style>
      <Card today={today} size={size} />
    </GlassObject>
  )
}

const CAL_CSS = `
.cal-root {
  --paper: 255, 255, 255;
  --paper-a: .9;
  --paper-back: #eceae6;
  --paper-fold: #d9d6cf;
  --paper-edge: #dcdad3;
}
.cal-root[data-tone="dark"] {
  --paper: 58, 58, 62;
  --paper-a: .84;
  --paper-back: #2a2a2e;
  --paper-fold: #141416;
  --paper-edge: #121214;
}
.cal-root .go-tilt { border-radius: 22px; }
.cal-root .go-liquid { border-radius: 22px; }

/* every spring the widget uses lives here, so every child can read it */
.cal-body {
  position: absolute; inset: 0; border-radius: 22px;
  --curl: 0; --flip: 0; --flip-v: 0; --n0: 0; --n1: 0; --n2: 0; --n3: 0;
  /* the paper bend peaks mid-flip: 4·f·(1−f) */
  --bend: max(0, 4 * var(--flip) * (1 - var(--flip)));
  /* past flat, the slap only goes a few degrees: 1/8 of the spring's undershoot */
  --fa: max(var(--flip), var(--flip) * .125);
  /* which face of the page is toward you: edge-on at 90° */
  --front: clamp(0, (.9 - var(--flip)) * 1000, 1);
  --backv: clamp(0, (var(--flip) - .9) * 1000, 1);
  /* how hard the page is landing */
  --slap: clamp(0, var(--flip-v) * -.13, 1);
  /* how far the uncovered things have come up */
  --shown: clamp(0, (var(--flip) - .4) * 2.4, 1);
}
.cal-body:not([data-ready]) .go-pane-body > * { visibility: hidden; }
.cal-card { inset: 0; }

/* ---- type, as the native widget sets it ---- */
.cal-wd { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #ff3b30; line-height: 1.1; }
.cal-num { font-size: 44px; font-weight: 300; letter-spacing: -.02em; line-height: .95; margin-left: -1.5px; font-variant-numeric: tabular-nums; color: var(--go-ink); }
.cal-my { font-size: 11px; font-weight: 500; margin-top: 3px; }
.cal-none { font-size: 11px; font-weight: 500; }
.cal-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; margin-top: 4px; }
.cal-evl { display: flex; align-items: flex-start; gap: 6px; min-width: 0; }
.cal-evl-text { display: flex; flex-direction: column; min-width: 0; gap: 0; }
.cal-evl-title { font-size: 11.5px; font-weight: 600; line-height: 1.25; letter-spacing: -.005em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--go-ink); }
.cal-evl-time { font-size: 10px; line-height: 1.25; color: var(--go-ink-soft); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: 0; }
.cal-evl-where { font-family: ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Segoe UI", sans-serif; }
.cal-past { opacity: .45; }

/* ---- the page ---- */
.cal-page { position: absolute; }
.cal-leaf, .cal-leafshadow, .cal-torn, .cal-under { position: absolute; inset: 0; }

/* its paper edge and shadow on the glass: soft at rest, sharp on the slap */
.cal-leafshadow {
  border-radius: 9px;
  box-shadow:
    0 1px 0 var(--paper-edge),
    0 calc(2px - var(--slap) * 1.2px) calc(5px - var(--slap) * 4px) rgba(16, 18, 24, calc(.1 + var(--slap) * .4));
  opacity: calc(1 - min(1, max(0, var(--flip)) * 5));
}
.cal-leaf {
  z-index: 2;
  /* the curl: a corner cut of size s, at 45° ± 10° with the pointer */
  --s: max(0px, 2px + var(--curl) * (28px + max(0, var(--go-px)) * 16px));
  --a: calc(45deg + var(--go-py) * 10deg);
  --sx: calc(var(--s) * 1.4142 * sin(var(--a)));
  --sy: calc(var(--s) * 1.4142 * cos(var(--a)));
  transform-origin: 50% 0;
  transform:
    translateY(calc(var(--go-press) * .5px - var(--go-hover) * (1 - min(1, max(0, var(--flip)) * 4)) * 1px))
    perspective(500px)
    rotateX(calc(var(--fa) * var(--deg) * -1))
    rotateZ(calc(var(--bend) * -6deg))
    skewX(calc(var(--bend) * 3deg));
}
.cal-sheet {
  position: absolute; inset: 0; overflow: hidden; border-radius: 9px;
  /* light through paper: once it lifts, the page lets the liquid through */
  background: rgba(var(--paper), calc(var(--paper-a) - min(1, max(0, var(--flip)) * 3) * .12));
  -webkit-backdrop-filter: blur(6px) brightness(1.08);
  backdrop-filter: blur(6px) brightness(1.08);
  box-shadow: inset 0 0 0 .5px rgba(0, 0, 0, .05), inset 0 1px 0 rgba(255, 255, 255, .7);
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--sy)), calc(100% - var(--sx)) 100%, 0 100%);
}
.cal-root[data-tone="dark"] .cal-sheet { box-shadow: inset 0 0 0 .5px rgba(255,255,255,.07), inset 0 1px 0 rgba(255,255,255,.1); }
.cal-front {
  position: absolute; inset: 0; padding: 9px 11px 10px;
  display: flex; flex-direction: column; align-items: flex-start;
  opacity: var(--front);
}
.cal-front-next { margin-top: auto; width: 100%; padding-top: 8px; border-top: .5px solid var(--go-ink-faint); }
.cal-ghost {
  position: absolute; left: 9.5px; top: calc(9px + 12px);
  font-size: 44px; font-weight: 300; letter-spacing: -.02em; line-height: .95; color: var(--go-ink);
  opacity: calc(var(--backv) * .07);
}
.cal-notes {
  position: absolute; inset: 0; transform: scaleY(-1); opacity: var(--backv);
  padding: 7px 10px;
  background: repeating-linear-gradient(180deg, transparent 0 13px, rgba(10, 132, 255, .18) 13px 14px);
  background-position: 0 10px;
}
.cal-notes-h { font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #ff3b30; }

/* the curled corner: the back of the paper folded over the page */
.cal-flaphost {
  position: absolute; inset: 0; pointer-events: none;
  filter: drop-shadow(calc(var(--go-px) * 3px - .5px) calc(.8px + var(--curl) * 1.6px) calc(.8px + var(--curl) * 2.5px) rgba(16, 18, 24, .26));
  opacity: var(--front);
}
.cal-flap {
  position: absolute; right: 0; bottom: 0; width: var(--sx); height: var(--sy);
  transform-origin: 0 100%;
  transform: rotate(calc(var(--a) - 90deg)) scaleY(-1) rotate(calc(90deg - var(--a)));
  clip-path: polygon(100% 0, 100% 100%, 0 100%);
  background: linear-gradient(to bottom right, transparent 49.5%, var(--paper-fold) 50%, var(--paper-back) 72%, rgba(var(--paper), .95) 100%);
}

/* yesterday, falling */
.cal-torn { z-index: 3; overflow: hidden; border-radius: 0 0 9px 9px; background: rgb(var(--paper)); box-shadow: 0 4px 10px -2px rgba(16,18,24,.3); transform-origin: 30% 10%; }
.cal-torn .cal-front { opacity: 1; }

/* ---- what the page was covering ---- */
.cal-under { display: flex; flex-direction: column; gap: 6px; padding: 4px 2px 0; opacity: var(--shown); transform: translateY(calc((1 - var(--shown)) * 4px)); }
.cal-agenda { display: flex; flex-direction: column; gap: 1px; }
.cal-row { display: grid; grid-template-columns: 38px 2px 1fr; align-items: center; column-gap: 6px; height: 16px; min-width: 0; }
.cal-row-time { font-size: 10px; color: var(--go-ink-soft); font-variant-numeric: tabular-nums; white-space: nowrap; letter-spacing: 0; }
.cal-row-bar { width: 2.5px; height: 12px; border-radius: 2px; background: var(--c); }
.cal-row-title { font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--go-ink); }
.cal-week { display: grid; grid-template-columns: repeat(7, 1fr); padding-top: 5px; border-top: .5px solid var(--go-ink-faint); }
.cal-wk { display: flex; flex-direction: column; align-items: center; line-height: 1.2; }
.cal-wk-l { font-size: 9px; font-weight: 600; color: var(--go-ink-soft); }
.cal-wk-n { font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--go-ink); }
.cal-wk-now .cal-wk-l, .cal-wk-now .cal-wk-n { color: #ff3b30; }
.cal-wk-dot { width: 3px; height: 3px; border-radius: 50%; margin-top: 1px; background: var(--go-ink-soft); }
.cal-wk-now .cal-wk-dot { background: #ff3b30; }
.cal-wk-none { visibility: hidden; }

/* medium: today's events rise as chips */
.cal-medium .cal-under { padding-top: 6px; }
.cal-medium .cal-week { order: -1; border-top: 0; padding-top: 0; padding-bottom: 6px; border-bottom: .5px solid var(--go-ink-faint); }
.cal-chips { position: relative; flex: 1; }
.cal-chip {
  position: relative; display: grid; grid-template-columns: 1fr auto; align-items: center; column-gap: 6px;
  height: 28px; margin-bottom: 5px; padding: 0 8px 0 12px; border-radius: 9px; color: var(--go-ink);
  opacity: clamp(0, var(--nl) * 1.6, 1);
  transform: translateY(calc((1 - var(--nl)) * 16px)) scale(calc(.94 + var(--nl) * .06));
}
.cal-chip-bar { position: absolute; left: 5px; top: 7px; bottom: 7px; width: 2.5px; border-radius: 2px; background: var(--c); }
.cal-chip-title { font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cal-chip-time { font-size: 10px; color: var(--go-ink-soft); white-space: nowrap; letter-spacing: 0; }

/* ---- the lists on the glass ---- */
.cal-list {
  position: absolute; display: flex; flex-direction: column; gap: 6px;
  transform: translateY(calc(var(--go-hover) * -2px + var(--flip) * 6px));
  opacity: calc(1 - var(--shown));
}
.cal-small .cal-list { left: 12px; right: 12px; top: 96px; }
.cal-list-l { left: 184px; right: 14px; top: 13px; gap: 5px; }
.cal-list-h { font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.cal-fan { position: absolute; left: 180px; right: 12px; top: 10px; height: 130px; pointer-events: none; }
.cal-fan-sheet {
  left: 0; right: 4px; height: 28px; top: calc(4px + var(--i) * 31px);
  display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 6px; align-content: center;
  padding: 0 8px 0 12px; border-radius: 9px; color: var(--go-ink);
  opacity: clamp(0, var(--nl) * 1.6, 1);
  transform-origin: 0% 50%;
  transform:
    translate(calc(var(--nl) * (var(--i) - var(--mid)) * 3px), calc(var(--nl) * (var(--i) - var(--mid)) * 4px + (1 - var(--nl)) * 10px))
    rotate(calc(var(--nl) * (var(--i) - var(--mid)) * 2.2deg));
}
.cal-fan-time { font-size: 10px; color: var(--go-ink-soft); letter-spacing: 0; grid-row: 1 / span 2; align-self: center; }
.cal-fan-sheet .cal-chip-title { grid-column: 2; }
.cal-fan-where { font-size: 9.5px; grid-column: 2; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cal-fan-sheet:has(.cal-fan-where) { height: 32px; }

/* ---- the month ---- */
.cal-month { position: absolute; display: flex; flex-direction: column; color: var(--go-ink); }
.cal-month-head { padding-left: 2px; }
.cal-month-name { font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #ff3b30; }
.cal-month-wd { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 9px; font-weight: 600; color: var(--go-ink-soft); margin-top: 5px; }
.cal-month-grid { flex: 1; display: grid; grid-template-columns: repeat(7, 1fr); grid-template-rows: repeat(var(--rows), minmax(0, 1fr)); margin-top: 1px; }
.cal-cell { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 0; }
.cal-cell-n { display: grid; place-items: center; width: 17px; height: 17px; border-radius: 50%; font-size: 10px; font-weight: 500; font-variant-numeric: tabular-nums; }
.cal-out .cal-cell-n { opacity: 0; }
.cal-today .cal-cell-n { background: #ff3b30; color: #fff; font-weight: 600; }
.cal-cell-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--go-ink-soft); opacity: .6; margin-top: .5px; }
.cal-today .cal-cell-dot { visibility: hidden; }
.cal-month-m { left: 176px; right: 12px; top: 13px; bottom: 9px; }
.cal-month-l { left: 14px; right: 14px; top: 146px; bottom: 12px; }
.cal-month-l .cal-month-wd { padding-bottom: 3px; border-bottom: .5px solid var(--go-ink-faint); }
.cal-month-l .cal-cell-n { width: 22px; height: 22px; font-size: 11px; }
.cal-large .cal-num { font-size: 52px; }
.cal-large .cal-ghost { font-size: 52px; }
`
