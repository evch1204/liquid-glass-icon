"use client"

import * as React from "react"
import { GlassObject, GlassPane, GlassSheet, LIQUIDS, LiquidCanvas, useGlass } from "@/components/ui/glass-object"
import { rng } from "@/components/ui/glass-folder-cards"
import { WIDGET, type WidgetSize } from "../glass"
import { APPS } from "@/lib/apps"
import { useWindowManager } from "../window-manager"

/**
 * Calendar — a date you can pick up, drawn as an object.
 *
 * Three layers: a milk liquid light at the back, the date as a real object in
 * the middle (the weekday in Calendar red small caps over a very large day
 * number, like a tear-off page, casting a soft shadow onto the liquid), and a
 * frosted pane along the bottom carrying the next event.
 *
 * - **Rest**: the day number stands in the light; the pane shows the next
 *   event; the top edge of the month peeks from behind the pane.
 * - **Hover**: the number lifts and tilts with the object; the pane leans back.
 * - **Open** (click): the pane folds away; the month rises out of the pocket as
 *   a white sheet, the number shrinks into the corner, and the rest of today
 *   appears as a short stack of sheets.
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

// ---------------------------------------------------------------------------
// Pieces

const NBSP = " "

/** The date as an object: red weekday small caps over a very large day number. */
function Page({ today, className }: { today: Today | null; className?: string }) {
  return (
    <div className={"cal-page" + (className ? " " + className : "")} aria-hidden="true">
      <span className="cal-wd">{today ? WEEKDAYS[weekdayOf(today)] : NBSP}</span>
      <span className="cal-num">{today ? today.d : NBSP}</span>
    </div>
  )
}

/** What the page says once it has shrunk into the corner: weekday, month and year, beside the number. */
function Corner({ today, className }: { today: Today | null; className?: string }) {
  return (
    <div className={"cal-corner" + (className ? " " + className : "")} aria-hidden="true">
      <span className="cal-corner-wd">{today ? WEEKDAYS[weekdayOf(today)] : NBSP}</span>
      <span className="cal-corner-m go-soft">{today ? MONTHS[today.m] + " " + today.y : NBSP}</span>
    </div>
  )
}

/** The next event, as carried on the pane. */
function NextLine({ today }: { today: Today | null }) {
  if (!today) return <div className="cal-next" />
  const up = upcoming(today)
  const e = up.events[0]
  if (!e)
    return (
      <div className="cal-next">
        <span className="cal-next-title go-soft">No more events today</span>
      </div>
    )
  return (
    <div className="cal-next">
      <span className="cal-dot" style={{ background: COLOR[e.cal] }} />
      <span className="cal-next-text">
        <span className="cal-next-title">{e.title}</span>
        <span className="cal-next-time go-mono">
          {up.label ? up.label + " · " : ""}
          {timeLabel(e)}
        </span>
      </span>
    </div>
  )
}

/** A month as a white sheet: today in a red filled circle, faint dots on days with events. */
function Month({ today, className, chips = false }: { today: Today | null; className?: string; chips?: boolean }) {
  const cells = today ? monthCells(today.y, today.m) : []
  const rows = cells.length / 7 || 6
  const month = today ? eventsForMonth(today.y, today.m, today) : []
  return (
    <div className={"cal-month" + (className ? " " + className : "")} style={{ "--rows": rows } as React.CSSProperties} aria-hidden="true">
      <div className="cal-month-head">
        <span className="cal-month-name">{today ? MONTHS[today.m] : NBSP}</span>
        {chips && today ? <span className="cal-month-year go-soft">{today.y}</span> : null}
      </div>
      <div className="cal-month-wd">
        {WEEKDAYS.map((w, i) => (
          <span key={i}>{chips ? w.slice(0, 3) : w[0]}</span>
        ))}
      </div>
      <div className="cal-month-grid">
        {cells.map((c) => {
          const isToday = today ? same(c, today) : false
          const ev = c.inMonth ? month.filter((e) => e.d === c.d) : []
          return (
            <span key={`${c.y}-${c.m}-${c.d}`} className={"cal-cell" + (c.inMonth ? "" : " cal-out") + (isToday ? " cal-today" : "")}>
              <span className="cal-cell-n">{c.d}</span>
              {chips ? (
                ev.slice(0, 1).map((e) => (
                  <span key={e.id} className="cal-chip" style={{ "--c": COLOR[e.cal] } as React.CSSProperties}>
                    {e.title}
                  </span>
                ))
              ) : (
                <span className="cal-dots">
                  {ev.slice(0, 3).map((e) => (
                    <i key={e.id} />
                  ))}
                </span>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** One event as a small white sheet. */
function EventSheet({ e, i, n, className }: { e: CalEvent; i: number; n: number; className?: string }) {
  return (
    <GlassSheet className={"cal-ev" + (className ? " " + className : "")} style={{ "--i": i, "--n": n, "--c": COLOR[e.cal] } as React.CSSProperties}>
      <span className="cal-ev-bar" />
      <span className="cal-ev-time go-mono">{timeLabel(e, true)}</span>
      <span className="cal-ev-title">{e.title}</span>
      {e.where ? <span className="cal-ev-where">{e.where}</span> : null}
    </GlassSheet>
  )
}

function Liquid({ seed, cells }: { seed: number; cells?: number }) {
  const { tone } = useGlass()
  return <LiquidCanvas recipe={tone === "dark" ? LIQUIDS.smoke : LIQUIDS.milk} seed={seed} cells={cells} />
}

// ---------------------------------------------------------------------------
// Sizes

/** The small object: the page, the month peeking from the pocket, the next event on the pane. */
function Small({ today }: { today: Today | null }) {
  const rest = today ? upcoming(today) : { label: null, events: [] }
  const stack = rest.events.slice(0, 3)
  return (
    <>
      <Liquid seed={3} />
      <div className="cal-pocket">
        <GlassSheet className="cal-sheet cal-sheet-s">
          <Month today={today} />
        </GlassSheet>
      </div>
      <div className="cal-stack cal-stack-s">
        {stack.map((e, i) => (
          <EventSheet key={e.id} e={e} i={i} n={stack.length} />
        ))}
      </div>
      <Page today={today} className="cal-page-s" />
      <Corner today={today} className="cal-corner-s" />
      <GlassPane hinge="bottom" lean={-10} openLean={-80} openShift={20} openFade={0.9} radius={18} className="cal-pane cal-pane-s">
        <NextLine today={today} />
      </GlassPane>
    </>
  )
}

/** The wide object: the page on the left, the month always on the right; open lifts the pane off today's events. */
function Medium({ today }: { today: Today | null }) {
  const ev = today ? eventsOn(today, today).slice(0, 3) : []
  return (
    <>
      <Liquid seed={6} cells={120} />
      <GlassSheet className="cal-sheet cal-sheet-m">
        <Month today={today} />
      </GlassSheet>
      <div className="cal-stack cal-stack-m">
        {ev.map((e, i) => (
          <EventSheet key={e.id} e={e} i={i} n={ev.length} />
        ))}
      </div>
      <Page today={today} className="cal-page-m" />
      <Corner today={today} className="cal-corner-m" />
      <GlassPane hinge="bottom" lean={-9} openLean={18} openShift={-74} openFade={1} radius={16} className="cal-pane cal-pane-m">
        <NextLine today={today} />
      </GlassPane>
    </>
  )
}

/** The big object: the whole month in the light with chips; open fans the day's events out as sheets. */
function Large({ today }: { today: Today | null }) {
  const all = today ? eventsOn(today, today) : []
  const ev = all.slice(0, 3)
  return (
    <>
      <Liquid seed={9} cells={120} />
      <div className="cal-head-l">
        <Page today={today} className="cal-page-l" />
      </div>
      <Month today={today} chips className="cal-month-l" />
      <div className="cal-fan">
        {ev.map((e, i) => (
          <EventSheet key={e.id} e={e} i={i} n={ev.length} className="cal-ev-l" />
        ))}
        {all.length > ev.length ? <span className="cal-more go-soft">+{all.length - ev.length} more today</span> : null}
      </div>
      <GlassPane hinge="bottom" lean={-8} openLean={-78} openShift={18} openFade={0.9} radius={18} className="cal-pane cal-pane-l">
        <NextLine today={today} />
      </GlassPane>
    </>
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
      radius={24}
      appearDelay={appearDelay}
      className={"cal-root cal-" + size + (className ? " " + className : "")}
      onActivate={() => open("calendar", { singleton: "app", title: APPS.calendar.name, w: 760, h: 540 })}
    >
      <style href="calendar-object" precedence="glass-widget">{CAL_CSS}</style>
      <div className="cal-back" aria-hidden="true" />
      <div className="cal-body" data-ready={today ? "true" : undefined}>
        {size === "small" ? <Small today={today} /> : size === "medium" ? <Medium today={today} /> : <Large today={today} />}
      </div>
    </GlassObject>
  )
}

const CAL_CSS = `
.cal-root .go-tilt { border-radius: 24px; }
.cal-back { position: absolute; inset: 0; border-radius: 24px; box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 .5px rgba(0,0,0,.1); }
.cal-root[data-tone="dark"] .cal-back { box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 0 0 .5px rgba(255,255,255,.1); }
.cal-body { position: absolute; inset: 0; border-radius: 24px; }
.cal-root .go-liquid { border-radius: 24px; }
.cal-body:not([data-ready]) > :not(.go-liquid):not(.go-pane) { visibility: hidden; }
.cal-stack, .cal-fan { opacity: var(--go-open); }

/* the page: the date as an object standing in the light */
.cal-page {
  position: absolute; left: 16px; top: 13px;
  display: flex; flex-direction: column; align-items: flex-start;
  transform-origin: 0% 0%;
  --lift: calc(var(--go-hover) * (1 - var(--go-open)));
  transform:
    perspective(600px)
    translate(calc(var(--go-px) * var(--lift) * 2.5px), calc(var(--go-py) * var(--lift) * 1.5px - var(--lift) * 3px))
    rotateY(calc(var(--go-px) * var(--lift) * 7deg))
    rotateX(calc(var(--go-py) * var(--lift) * -5deg))
    scale(calc(1 + var(--lift) * .03 - var(--go-open) * var(--shrink, .5)));
}
.cal-wd {
  font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
  font-variant: small-caps; color: #ff3b30; line-height: 1.1;
  text-shadow: 0 1px 2px rgba(255,59,48,.12);
}
.cal-num {
  font-size: 74px; font-weight: 300; letter-spacing: -.045em; line-height: .9;
  margin-left: -3px; font-variant-numeric: tabular-nums; color: var(--go-ink);
  text-shadow:
    0 1px 0 rgba(255,255,255,.6),
    0 calc(5px + var(--go-hover) * 5px) calc(9px + var(--go-hover) * 7px) rgba(16,18,24,calc(.13 + var(--go-hover) * .07));
}
.cal-root[data-tone="dark"] .cal-num { text-shadow: 0 calc(5px + var(--go-hover) * 5px) calc(10px + var(--go-hover) * 7px) rgba(0,0,0,.55); }

.cal-page .cal-wd { opacity: calc(1 - var(--go-open) * var(--fadewd, 0)); }
.cal-corner {
  position: absolute; top: 15px; display: flex; flex-direction: column; gap: 1px; line-height: 1.15;
  opacity: var(--go-open);
  transform: translateX(calc((1 - var(--go-open)) * 10px));
}
.cal-corner-wd { font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #ff3b30; }
.cal-corner-m { font-size: 10px; font-weight: 500; }
.cal-pocket { position: absolute; inset: 0; border-radius: 24px; overflow: hidden; }

/* the pane and the next event on it */
.cal-pane { top: auto; bottom: 0; height: 50px; }
.cal-next { position: absolute; inset: 0; display: flex; align-items: center; gap: 8px; padding: 0 14px; min-width: 0; }
.cal-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; box-shadow: 0 0 0 2px rgba(255,255,255,.35); }
.cal-root[data-tone="dark"] .cal-dot { box-shadow: 0 0 0 2px rgba(0,0,0,.2); }
.cal-next-text { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.cal-next-title { font-size: 12.5px; font-weight: 600; letter-spacing: -.005em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cal-next-time { font-size: 10.5px; color: var(--go-ink-soft); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* the month */
.cal-month { position: absolute; inset: 0; display: flex; flex-direction: column; color: var(--go-ink); }
.cal-month-head { display: flex; align-items: baseline; gap: 5px; }
.cal-month-name { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #ff3b30; }
.cal-month-year { font-size: 10px; font-weight: 600; }
.cal-month-wd { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 8px; font-weight: 600; color: var(--go-ink-soft); margin-top: 3px; }
.cal-month-grid { flex: 1; display: grid; grid-template-columns: repeat(7, 1fr); grid-template-rows: repeat(var(--rows), minmax(0, 1fr)); margin-top: 1px; }
.cal-cell { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 0; }
.cal-cell-n { display: grid; place-items: center; width: 14px; height: 14px; border-radius: 50%; font-size: 8.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.cal-out .cal-cell-n { opacity: 0; }
.cal-today .cal-cell-n { background: #ff3b30; color: #fff; box-shadow: 0 2px 5px -1px rgba(255,59,48,.5); }
.cal-dots { display: flex; gap: 1.5px; height: 2.5px; margin-top: .5px; }
.cal-dots i { width: 2.5px; height: 2.5px; border-radius: 50%; background: var(--go-ink-soft); opacity: .55; }
.cal-today .cal-dots i { background: #ff3b30; opacity: .8; }

/* sheets of events */
.cal-ev { display: flex; flex-direction: column; justify-content: center; gap: 1px; padding: 0 7px 0 10px; border-radius: 9px; min-width: 0; color: var(--go-ink); }
.cal-ev-bar { position: absolute; left: 4px; top: 6px; bottom: 6px; width: 2.5px; border-radius: 2px; background: var(--c); }
.cal-ev-time { font-size: 9px; color: var(--go-ink-soft); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cal-ev-title { font-size: 10px; font-weight: 600; line-height: 1.15; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.cal-ev-where { display: none; font-size: 9.5px; color: var(--go-ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cal-stack { position: absolute; inset: 0; }

/* ---- small ---- */
.cal-page-s { --shrink: .6; --fadewd: 1; }
.cal-corner-s { left: 52px; top: 13px; }
.cal-sheet { will-change: transform; }
.cal-sheet-s {
  left: 9px; top: 44px; width: 102px; height: 118px; padding: 6px 4px 3px; border-radius: 12px;
  transform: translateY(calc((1 - var(--go-open)) * 60px - var(--go-hover) * (1 - var(--go-open)) * 3px)) scale(calc(.94 + var(--go-open) * .06));
  transform-origin: 50% 100%;
}
.cal-sheet-s .cal-month-head { padding-left: 4px; }
.cal-stack-s .cal-ev {
  left: 116px; width: 46px; height: 36px; top: calc(44px + var(--i) * 41px); padding: 0 4px 0 9px;
  transform: translate(calc((1 - var(--go-open)) * -20px), calc((1 - var(--go-open)) * (34px + var(--i) * 16px))) rotate(calc((1 - var(--go-open)) * -6deg));
}
.cal-stack-s .cal-ev-title { font-size: 9.5px; }

/* ---- medium ---- */
.cal-page-m { left: 18px; top: 15px; --shrink: .6; --fadewd: 1; }
.cal-corner-m { left: 56px; top: 16px; }
.cal-medium .cal-num { font-size: 78px; }
.cal-sheet-m {
  left: 166px; top: 10px; width: 188px; height: 150px; padding: 8px 8px 4px; border-radius: 16px;
  transform: translateY(calc(var(--go-hover) * -2px)) rotate(calc(var(--go-px) * var(--go-hover) * .6deg));
}
.cal-sheet-m .cal-month-head { padding-left: 4px; }
.cal-sheet-m .cal-month-wd { font-size: 8.5px; }
.cal-sheet-m .cal-cell-n { width: 17px; height: 17px; font-size: 10px; }
.cal-pane-m { left: 10px; right: auto; bottom: 10px; width: 146px; height: 50px; }
.cal-pane-m .cal-next { padding: 0 11px; }
.cal-stack-m .cal-ev {
  left: 12px; width: 142px; height: 34px; top: calc(52px + var(--i) * 37px);
  transform: translateY(calc((1 - var(--go-open)) * (26px + var(--i) * 10px))) scale(calc(.92 + var(--go-open) * .08));
}
.cal-stack-m .cal-ev-title { -webkit-line-clamp: 1; display: block; white-space: nowrap; text-overflow: ellipsis; font-size: 11px; }
.cal-stack-m .cal-ev-time { font-size: 9.5px; }

/* ---- large ---- */
.cal-head-l { position: absolute; left: 0; right: 0; top: 0; height: 70px; }
.cal-page-l { left: 18px; top: 14px; flex-direction: row; align-items: baseline; gap: 10px; --shrink: .0; }
.cal-page-l .cal-num { font-size: 52px; order: -1; }
.cal-page-l .cal-wd { font-size: 12px; }
.cal-month-l {
  inset: 76px 12px 66px;
  transform: translateY(calc(var(--go-hover) * (1 - var(--go-open)) * -2px)) scale(calc(1 - var(--go-open) * .03));
  transform-origin: 50% 0%;
  opacity: calc(1 - var(--go-open) * .72);
}
.cal-month-l .cal-month-head { position: absolute; right: 6px; top: -50px; }
.cal-month-l .cal-month-name { font-size: 13px; letter-spacing: .02em; text-transform: none; color: var(--go-ink); font-weight: 650; }
.cal-month-l .cal-month-year { font-size: 13px; }
.cal-month-l .cal-month-wd { margin-top: 0; font-size: 8.5px; letter-spacing: .04em; text-transform: uppercase; padding-bottom: 3px; border-bottom: .5px solid var(--go-ink-faint); }
.cal-month-l .cal-cell { justify-content: flex-start; align-items: stretch; padding: 2px 1.5px 0; border-bottom: .5px solid var(--go-ink-faint); gap: 1px; }
.cal-month-l .cal-cell:nth-last-child(-n+7) { border-bottom: 0; }
.cal-month-l .cal-cell-n { align-self: center; width: 17px; height: 17px; font-size: 10px; }
.cal-chip {
  display: block; font-size: 7.5px; font-weight: 600; line-height: 11px; height: 11px; padding: 0 3px; border-radius: 3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: color-mix(in srgb, var(--c) 62%, var(--go-ink));
  background: color-mix(in srgb, var(--c) 17%, transparent);
}
.cal-pane-l { height: 56px; }
.cal-pane-l .cal-next { padding: 0 18px; }
.cal-pane-l .cal-next-title { font-size: 13px; }
.cal-pane-l .cal-next-time { font-size: 11px; }
.cal-fan { position: absolute; inset: 0; }
.cal-ev-l {
  left: 50%; top: 168px; width: 108px; height: 96px; padding: 10px 12px 10px 16px; justify-content: flex-start; gap: 3px; border-radius: 13px;
  --mid: calc((var(--n) - 1) / 2);
  --step: 114px;
  transform-origin: 50% 160%;
  transform:
    translateX(calc(-50% + (var(--i) - var(--mid)) * var(--step) * var(--go-open)))
    translateY(calc((1 - var(--go-open)) * 150px + (var(--i) - var(--mid)) * (var(--i) - var(--mid)) * 7px * var(--go-open)))
    rotate(calc((var(--i) - var(--mid)) * 7deg * var(--go-open)));
}
.cal-more {
  position: absolute; left: 0; right: 0; top: 282px; text-align: center; font-size: 10.5px; font-weight: 500;
  transform: translateY(calc((1 - var(--go-open)) * 10px));
}
.cal-ev-l .cal-ev-bar { left: 6px; top: 10px; bottom: 10px; width: 3px; }
.cal-ev-l .cal-ev-time { font-size: 10px; }
.cal-ev-l .cal-ev-title { font-size: 12.5px; }
.cal-ev-l .cal-ev-where { display: block; font-size: 10px; }

@media (prefers-reduced-motion: reduce) {
  .cal-page { --lift: 0; }
}
`
