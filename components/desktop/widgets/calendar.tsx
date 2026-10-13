"use client"

import * as React from "react"
import { CalendarDays, Check, ChevronLeft, ChevronRight, MapPin } from "lucide-react"
import { rng } from "@/components/ui/glass-folder-cards"
import { cn } from "@/lib/utils"
import { GlassButton, Widget, type WidgetSize } from "../glass"
import { GlassWindow, type WindowState } from "../window-manager"

/**
 * Calendar. The month is the real one, read after mount; the events are
 * fictional, seeded by the month so they stay put while you look around.
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

function useNow(): number | null {
  return React.useSyncExternalStore(
    subscribeNow,
    () => nowValue,
    () => null,
  )
}

// ---------------------------------------------------------------------------
// Dates as plain numbers (no time zones involved)

type Ymd = { y: number; m: number; d: number }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const RED = "#ff3b30"

const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
const weekdayOf = (y: number, m: number, d: number) => new Date(y, m, d).getDay()
const keyOf = (v: Ymd) => `${v.y}-${v.m}-${v.d}`
const same = (a: Ymd | null, b: Ymd | null) => !!a && !!b && a.y === b.y && a.m === b.m && a.d === b.d
const addDays = (v: Ymd, n: number): Ymd => {
  const t = new Date(v.y, v.m, v.d + n)
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() }
}
const addMonths = (y: number, m: number, n: number) => {
  const t = new Date(y, m + n, 1)
  return { y: t.getFullYear(), m: t.getMonth() }
}

type Today = Ymd & { minutes: number }

function todayOf(now: number | null): Today | null {
  if (now === null) return null
  const t = new Date(now)
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate(), minutes: t.getHours() * 60 + t.getMinutes() }
}

/** Six weeks of cells covering a month, Sunday first. */
function monthCells(y: number, m: number): (Ymd & { inMonth: boolean })[] {
  const lead = weekdayOf(y, m, 1)
  const first = { y, m, d: 1 }
  return Array.from({ length: 42 }, (_, i) => {
    const v = addDays(first, i - lead)
    return { ...v, inMonth: v.m === m }
  })
}

function fmtTime(min: number, short = false) {
  const h = Math.floor(min / 60)
  const mm = min % 60
  const hh = h % 12 === 0 ? 12 : h % 12
  if (short) return `${hh}${mm ? ":" + String(mm).padStart(2, "0") : ""}${h < 12 ? "a" : "p"}`
  return `${hh}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

// ---------------------------------------------------------------------------
// Calendars and events

type CalId = "home" | "work" | "family" | "birthdays"

const CALENDARS: { id: CalId; name: string; color: string }[] = [
  { id: "home", name: "Home", color: "#0a84ff" },
  { id: "work", name: "Work", color: "#ff9f0a" },
  { id: "family", name: "Family", color: "#30d158" },
  { id: "birthdays", name: "Birthdays", color: "#bf5af2" },
]
const COLOR: Record<CalId, string> = Object.fromEntries(CALENDARS.map((c) => [c.id, c.color])) as Record<CalId, string>

type CalEvent = Ymd & {
  id: string
  title: string
  cal: CalId
  /** minutes after midnight; null is all-day */
  start: number | null
  /** minutes */
  dur: number
  where?: string
}

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

/** ~12 events for a month, deterministic for that month (and today, when it is this month). */
function eventsForMonth(y: number, m: number, today: Today | null): CalEvent[] {
  const isThis = !!today && today.y === y && today.m === m
  const cacheKey = `${y}-${m}-${isThis ? today!.d : ""}`
  const hit = eventCache.get(cacheKey)
  if (hit) return hit
  const r = rng(y * 12 + m + 101)
  const n = daysIn(y, m)
  const out: CalEvent[] = []
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const startTime = () => (8 + Math.floor(r() * 10)) * 60 + (r() < 0.5 ? 0 : 30)
  const push = (d: number, p: (typeof POOL)[number], start: number | null) =>
    out.push({ y, m, d, id: `${y}-${m}-${out.length}`, title: p.title, cal: p.cal, where: p.where, start: p.allDay ? null : start, dur: p.dur ?? 60 })

  // two dated anchors: birthdays
  out.push({ y, m, d: 3 + Math.floor(r() * 10), id: `${y}-${m}-b0`, title: BIRTHDAYS[(y + m) % 2], cal: "birthdays", start: null, dur: 0 })
  // and a run of ordinary days
  const pool = [...POOL]
  for (let i = 0; i < 9; i++) {
    const p = pool.splice(Math.floor(r() * pool.length), 1)[0] ?? pick(POOL)
    push(1 + Math.floor(r() * n), p, startTime())
  }
  // today always has something on it, and so does tomorrow
  if (isThis) {
    const d = today!.d
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

function eventsOn(v: Ymd, today: Today | null, show?: Set<CalId>) {
  return eventsForMonth(v.y, v.m, today).filter((e) => e.d === v.d && (!show || show.has(e.cal)))
}

function timeLabel(e: CalEvent) {
  return e.start === null ? "All-day" : `${fmtTime(e.start)}`
}

/** The next one or two events from now: later today, else tomorrow. */
function upNext(today: Today, count: number): { label: string | null; events: CalEvent[] } {
  const rest = eventsOn(today, today).filter((e) => e.start === null || e.start + e.dur > today.minutes)
  if (rest.length) return { label: null, events: rest.slice(0, count) }
  const tomorrow = addDays(today, 1)
  const t = eventsOn(tomorrow, today)
  return { label: t.length ? "Tomorrow" : null, events: t.slice(0, count) }
}

// ---------------------------------------------------------------------------
// Widget

function Dot({ cal, className }: { cal: CalId; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-[7px] shrink-0 rounded-full", className)} style={{ background: COLOR[cal] }} />
}

function TodayBlock({ today, count, dense }: { today: Today | null; count: number; dense?: boolean }) {
  const next = today ? upNext(today, count) : { label: null, events: [] }
  return (
    <div className="flex h-full min-w-0 flex-col">
      <p className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: RED }}>
        {today ? WEEKDAYS[weekdayOf(today.y, today.m, today.d)] : " "}
      </p>
      <p className={cn("leading-[0.95] font-light tracking-tight tabular-nums ink", dense ? "text-[42px]" : "text-[46px]")}>{today ? today.d : " "}</p>
      <div className="mt-auto min-w-0">
        {next.label ? <p className="mb-0.5 text-[10.5px] font-semibold tracking-wide uppercase ink-soft">{next.label}</p> : null}
        {next.events.length ? (
          <ul className="flex flex-col gap-1">
            {next.events.map((e) => (
              <li key={e.id} className="flex min-w-0 gap-1.5">
                <Dot cal={e.cal} className="mt-[5px]" />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] leading-tight font-semibold ink">{e.title}</span>
                  <span className="block text-[11px] leading-tight tabular-nums ink-soft">{timeLabel(e)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] ink-soft">{today ? "No more events today" : " "}</p>
        )}
      </div>
    </div>
  )
}

function MiniMonth({ today, dots, className }: { today: Today; dots?: boolean; className?: string }) {
  const cells = monthCells(today.y, today.m)
  const rows = cells[35].inMonth ? 6 : 5
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <div className="grid grid-cols-7 text-center text-[9.5px] font-semibold ink-soft">
        {WEEKDAYS.map((w, i) => (
          <span key={i} aria-hidden="true">
            {w[0]}
          </span>
        ))}
      </div>
      <div className="mt-0.5 grid flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {cells.slice(0, rows * 7).map((c) => {
          const isToday = same(c, today)
          const ev = dots && c.inMonth ? eventsOn(c, today) : []
          return (
            <span key={keyOf(c)} className="relative flex flex-col items-center justify-center">
              <span
                className={cn(
                  "grid place-items-center rounded-full font-semibold tabular-nums",
                  dots ? "size-[22px] text-[11.5px]" : "size-[17px] text-[10px]",
                  !c.inMonth && "opacity-0",
                  isToday ? "text-white" : "ink",
                )}
                style={isToday ? { background: RED } : undefined}
              >
                {c.d}
              </span>
              {dots ? (
                <span className="flex h-1 gap-[2px]" aria-hidden="true">
                  {ev.slice(0, 3).map((e) => (
                    <span key={e.id} className="size-1 rounded-full" style={{ background: COLOR[e.cal] }} />
                  ))}
                </span>
              ) : null}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function CalendarWidget({ size = "small", className }: { size?: WidgetSize; className?: string }) {
  const today = todayOf(useNow())
  const label = today ? `Calendar, ${WEEKDAYS[weekdayOf(today.y, today.m, today.d)]} ${MONTHS[today.m]} ${today.d}` : "Calendar"
  return (
    <Widget size={size} label={label} className={className}>
      <div
        className={cn(
          "flex h-full p-3.5 transition-opacity duration-500 [transition-timing-function:var(--glass-ease)]",
          today ? "opacity-100" : "opacity-0",
        )}
      >
        {size === "small" ? (
          <TodayBlock today={today} count={2} />
        ) : size === "medium" ? (
          <div className="flex h-full w-full gap-3">
            <div className="w-[138px] shrink-0">
              <TodayBlock today={today} count={2} dense />
            </div>
            {today ? (
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="mb-0.5 px-1 text-[10.5px] font-semibold tracking-[0.08em] uppercase" style={{ color: RED }}>
                  {MONTHS[today.m]}
                </p>
                <MiniMonth today={today} className="flex-1" />
              </div>
            ) : null}
          </div>
        ) : today ? (
          <div className="flex h-full w-full flex-col">
            <div className="flex items-baseline justify-between px-0.5">
              <p className="text-[13px] font-semibold tracking-[0.06em] uppercase" style={{ color: RED }}>
                {MONTHS[today.m]}
              </p>
              <p className="text-[12px] font-medium tabular-nums ink-soft">
                {WEEKDAYS[weekdayOf(today.y, today.m, today.d)].slice(0, 3)} {today.d}
              </p>
            </div>
            <MiniMonth today={today} dots className="mt-1 h-[176px] shrink-0" />
            <div className="my-2 h-px shrink-0 bg-[var(--glass-ink-faint)]" />
            <p className="text-[10.5px] font-semibold tracking-wide uppercase ink-soft">Today</p>
            <ul className="mt-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
              {eventsOn(today, today).map((e) => (
                <li key={e.id} className="flex min-w-0 items-stretch gap-2">
                  <span aria-hidden="true" className="w-[3px] shrink-0 rounded-full" style={{ background: COLOR[e.cal] }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] leading-tight font-semibold ink">{e.title}</span>
                    <span className="block truncate text-[11px] leading-tight tabular-nums ink-soft">
                      {e.start === null ? "All-day" : `${fmtTime(e.start)} – ${fmtTime(e.start + e.dur)}`}
                      {e.where ? ` · ${e.where}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Widget>
  )
}

// ---------------------------------------------------------------------------
// Window

type View = "day" | "week" | "month"

function Segmented({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const opts: View[] = ["day", "week", "month"]
  return (
    <div role="radiogroup" aria-label="View" className="flex rounded-lg bg-[var(--glass-ink-faint)] p-0.5" data-no-drag>
      {opts.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={cn(
            "h-6 rounded-md px-3 text-[12px] font-medium capitalize transition-[background,box-shadow,color] duration-200",
            "focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)]",
            value === o ? "bg-[var(--glass-bg-strong)] shadow-[0_1px_2px_rgba(0,0,0,.12),0_0_0_.5px_var(--glass-edge)] ink" : "ink-soft hover:ink",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

function Chip({ e }: { e: CalEvent }) {
  const allDay = e.start === null
  return (
    <span
      className={cn("flex min-w-0 items-center gap-1 rounded-[4px] px-1 text-[11px] leading-[15px] shrink-0", allDay ? "font-medium text-white" : "ink")}
      style={allDay ? { background: COLOR[e.cal] } : { background: `color-mix(in srgb, ${COLOR[e.cal]} 18%, transparent)` }}
    >
      {!allDay ? <Dot cal={e.cal} className="size-1.5" /> : null}
      <span className="truncate">{e.title}</span>
      {!allDay ? <span className="ml-auto hidden shrink-0 tabular-nums ink-soft @min-[120px]:inline">{fmtTime(e.start!, true)}</span> : null}
    </span>
  )
}

function MonthGrid({
  y,
  m,
  today,
  selected,
  onSelect,
  show,
}: {
  y: number
  m: number
  today: Today
  selected: Ymd
  onSelect: (v: Ymd) => void
  show: Set<CalId>
}) {
  const cells = monthCells(y, m)
  const gridRef = React.useRef<HTMLDivElement>(null)
  const focusNext = React.useRef(false)

  React.useEffect(() => {
    if (!focusNext.current) return
    focusNext.current = false
    gridRef.current?.querySelector<HTMLButtonElement>('[data-selected="true"]')?.focus()
  }, [selected])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (!step) return
    e.preventDefault()
    focusNext.current = true
    onSelect(addDays(selected, step))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-[var(--glass-ink-faint)]">
        {WEEKDAYS.map((w) => (
          <span key={w} className="px-2 py-1 text-right text-[11.5px] font-medium ink-soft">
            {w.slice(0, 3)}
          </span>
        ))}
      </div>
      <div ref={gridRef} role="grid" aria-label={`${MONTHS[m]} ${y}`} onKeyDown={onKeyDown} className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {cells.map((c, i) => {
          const ev = eventsOn(c, today, show)
          const isToday = same(c, today)
          const isSel = same(c, selected)
          return (
            <button
              key={keyOf(c)}
              type="button"
              role="gridcell"
              aria-selected={isSel}
              data-selected={isSel}
              tabIndex={isSel ? 0 : -1}
              aria-label={`${WEEKDAYS[i % 7]}, ${MONTHS[c.m]} ${c.d}${ev.length ? `, ${ev.length} event${ev.length > 1 ? "s" : ""}` : ""}`}
              onClick={() => onSelect(c)}
              className={cn(
                "@container flex min-h-0 min-w-0 flex-col gap-px overflow-hidden border-r border-b border-[var(--glass-ink-faint)] p-[3px] text-left transition-colors duration-150",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--glass-accent)]",
                i % 7 === 6 && "border-r-0",
                i % 7 === 0 || i % 7 === 6 ? "bg-[var(--glass-ink-faint)]/40" : "",
                isSel ? "bg-[var(--glass-accent)]/12" : "hover:bg-[var(--glass-hover)]",
              )}
            >
              <span className="flex shrink-0 justify-end">
                <span
                  className={cn(
                    "grid h-[19px] min-w-[19px] place-items-center rounded-full px-1 text-[12px] font-medium tabular-nums",
                    !c.inMonth && "opacity-35",
                    isToday ? "text-white" : "ink",
                  )}
                  style={isToday ? { background: RED } : undefined}
                >
                  {c.d === 1 ? `${MONTHS[c.m].slice(0, 3)} 1` : c.d}
                </span>
              </span>
              {ev.slice(0, 2).map((e) => (
                <Chip key={e.id} e={e} />
              ))}
              {ev.length > 2 ? <span className="shrink-0 px-1 text-[10.5px] leading-[13px] font-medium ink-soft">+{ev.length - 2} more</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const HOUR_PX = 44
const FIRST_HOUR = 7
const LAST_HOUR = 22

function TimeGrid({ days, today, show, selected, onSelect }: { days: Ymd[]; today: Today; show: Set<CalId>; selected: Ymd; onSelect: (v: Ymd) => void }) {
  const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i)
  const nowTop = ((today.minutes - FIRST_HOUR * 60) / 60) * HOUR_PX
  const cols = `52px repeat(${days.length}, minmax(0, 1fr))`
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 border-b border-[var(--glass-ink-faint)]" style={{ gridTemplateColumns: cols }}>
        <span />
        {days.map((d) => {
          const isToday = same(d, today)
          return (
            <button
              key={keyOf(d)}
              type="button"
              onClick={() => onSelect(d)}
              aria-pressed={same(d, selected)}
              className={cn("flex items-center justify-center gap-1.5 py-1.5 text-[12px] ink-soft hover:bg-[var(--glass-hover)]", same(d, selected) && "ink")}
            >
              {WEEKDAYS[weekdayOf(d.y, d.m, d.d)].slice(0, 3)}
              <span
                className={cn("grid size-6 place-items-center rounded-full text-[13px] font-semibold tabular-nums", isToday ? "text-white" : "ink")}
                style={isToday ? { background: RED } : undefined}
              >
                {d.d}
              </span>
            </button>
          )
        })}
      </div>
      {/* all-day row */}
      <div className="grid shrink-0 border-b border-[var(--glass-ink-faint)]" style={{ gridTemplateColumns: cols }}>
        <span className="py-1 pr-2 text-right text-[10.5px] ink-soft">all-day</span>
        {days.map((d) => (
          <div key={keyOf(d)} className="flex min-w-0 flex-col gap-0.5 border-l border-[var(--glass-ink-faint)] p-0.5">
            {eventsOn(d, today, show)
              .filter((e) => e.start === null)
              .map((e) => (
                <Chip key={e.id} e={e} />
              ))}
          </div>
        ))}
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: cols, height: hours.length * HOUR_PX }}>
          <div className="relative">
            {hours.map((h, i) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[10.5px] tabular-nums ink-soft" style={{ top: i * HOUR_PX }}>
                {i === 0 ? "" : `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div key={keyOf(d)} className="relative border-l border-[var(--glass-ink-faint)]">
              {hours.map((h, i) => (
                <div key={h} className="absolute inset-x-0 border-t border-[var(--glass-ink-faint)]" style={{ top: i * HOUR_PX }} />
              ))}
              {eventsOn(d, today, show)
                .filter((e) => e.start !== null)
                .map((e) => {
                  const top = ((e.start! - FIRST_HOUR * 60) / 60) * HOUR_PX
                  const h = Math.max(20, (e.dur / 60) * HOUR_PX - 2)
                  return (
                    <div
                      key={e.id}
                      className="absolute right-1 left-1 overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-[11px] leading-tight"
                      style={{ top, height: h, borderColor: COLOR[e.cal], background: `color-mix(in srgb, ${COLOR[e.cal]} 22%, transparent)` }}
                    >
                      <p className="truncate font-semibold ink">{e.title}</p>
                      {h > 30 ? (
                        <p className="truncate tabular-nums ink-soft">
                          {fmtTime(e.start!)}
                          {e.where ? ` · ${e.where}` : ""}
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              {same(d, today) && nowTop >= 0 && nowTop <= hours.length * HOUR_PX ? (
                <div className="pointer-events-none absolute inset-x-0 z-10 h-px" style={{ top: nowTop, background: RED }}>
                  <span className="absolute -top-[3.5px] -left-1 size-2 rounded-full" style={{ background: RED }} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Inspector({ day, today, show }: { day: Ymd; today: Today; show: Set<CalId> }) {
  const ev = eventsOn(day, today, show)
  return (
    <aside aria-label="Selected day" className="flex w-56 shrink-0 flex-col overflow-y-auto [scrollbar-width:thin] border-l border-[var(--glass-ink-faint)] p-3">
      <p className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: RED }}>
        {WEEKDAYS[weekdayOf(day.y, day.m, day.d)]}
      </p>
      <p className="text-[17px] font-semibold tracking-tight ink">
        {MONTHS[day.m]} {day.d}, {day.y}
      </p>
      <div className="my-3 h-px bg-[var(--glass-ink-faint)]" />
      {ev.length ? (
        <ul className="flex flex-col gap-2.5">
          {ev.map((e) => (
            <li key={e.id} className="flex gap-2.5 rounded-lg p-2" style={{ background: `color-mix(in srgb, ${COLOR[e.cal]} 12%, transparent)` }}>
              <span aria-hidden="true" className="w-[3px] shrink-0 rounded-full" style={{ background: COLOR[e.cal] }} />
              <div className="min-w-0">
                <p className="text-[13px] leading-tight font-semibold ink">{e.title}</p>
                <p className="mt-0.5 text-[11.5px] tabular-nums ink-soft">
                  {e.start === null ? "All-day" : `${fmtTime(e.start)} – ${fmtTime(e.start + e.dur)}`}
                </p>
                {e.where ? (
                  <p className="mt-0.5 flex items-center gap-1 text-[11.5px] ink-soft">
                    <MapPin className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{e.where}</span>
                  </p>
                ) : null}
                <p className="mt-1 text-[10.5px] font-medium tracking-wide uppercase" style={{ color: COLOR[e.cal] }}>
                  {CALENDARS.find((c) => c.id === e.cal)?.name}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-center text-[13px] ink-soft">No Events</p>
      )}
    </aside>
  )
}

export function CalendarWindow({ win }: { win: WindowState }) {
  const today = todayOf(useNow())
  const [view, setView] = React.useState<View>("month")
  const [pickedMonth, setPickedMonth] = React.useState<{ y: number; m: number } | null>(null)
  const [picked, setPicked] = React.useState<Ymd | null>(null)
  const [show, setShow] = React.useState<Set<CalId>>(() => new Set(CALENDARS.map((c) => c.id)))

  if (!today) {
    return (
      <GlassWindow win={win} icon={<CalendarDays />} minW={640} minH={420}>
        <div className="h-full" />
      </GlassWindow>
    )
  }

  const selected = picked ?? today
  const shown = pickedMonth ?? { y: today.y, m: today.m }
  const select = (v: Ymd) => {
    setPicked(v)
    if (v.y !== shown.y || v.m !== shown.m) setPickedMonth({ y: v.y, m: v.m })
  }
  const step = (n: number) => {
    if (view === "month") {
      const next = addMonths(shown.y, shown.m, n)
      setPickedMonth(next)
      setPicked({ ...next, d: Math.min(selected.d, daysIn(next.y, next.m)) })
    } else select(addDays(selected, n * (view === "week" ? 7 : 1)))
  }
  const goToday = () => {
    setPicked(null)
    setPickedMonth(null)
  }
  const weekStart = addDays(selected, -weekdayOf(selected.y, selected.m, selected.d))
  const toggle = (id: CalId) =>
    setShow((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const title =
    view === "day" ? (
      <>
        <span className="font-bold">
          {MONTHS[selected.m]} {selected.d},
        </span>{" "}
        <span className="font-normal ink-soft">{selected.y}</span>
      </>
    ) : (
      <>
        <span className="font-bold">{MONTHS[view === "week" ? weekStart.m : shown.m]}</span>{" "}
        <span className="font-normal ink-soft">{view === "week" ? weekStart.y : shown.y}</span>
      </>
    )

  return (
    <GlassWindow win={win} icon={<CalendarDays />} minW={640} minH={420}>
      <div className="@container flex h-full" data-no-drag>
        {/* sidebar */}
        <aside className="hidden w-44 shrink-0 flex-col gap-1 border-r border-[var(--glass-ink-faint)] p-3 @3xl:flex" aria-label="Calendars">
          <p className="px-1 pb-1 text-[11px] font-semibold tracking-wide uppercase ink-soft">Calendars</p>
          {CALENDARS.map((c) => {
            const on = show.has(c.id)
            return (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[13px] ink hover:bg-[var(--glass-hover)]">
                <input type="checkbox" className="peer sr-only" checked={on} onChange={() => toggle(c.id)} />
                <span
                  aria-hidden="true"
                  className="grid size-[15px] place-items-center rounded-[4px] border-[1.5px] text-white transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-[var(--glass-accent)]"
                  style={{ borderColor: c.color, background: on ? c.color : "transparent" }}
                >
                  {on ? <Check className="size-3" strokeWidth={3.2} /> : null}
                </span>
                {c.name}
              </label>
            )
          })}
          <div className="mt-auto rounded-xl bg-[var(--glass-hover)] p-2">
            <MiniMonth today={today} />
          </div>
        </aside>

        {/* main */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-3 px-4 pt-2.5 pb-2">
            <h2 className="min-w-0 flex-1 truncate text-[22px] tracking-tight ink">{title}</h2>
            <Segmented value={view} onChange={setView} />
            <div className="flex items-center rounded-lg bg-[var(--glass-ink-faint)] p-0.5">
              <GlassButton aria-label={`Previous ${view}`} onClick={() => step(-1)} className="h-6 px-1">
                <ChevronLeft />
              </GlassButton>
              <GlassButton onClick={goToday} className="h-6 px-2 text-[12px]">
                Today
              </GlassButton>
              <GlassButton aria-label={`Next ${view}`} onClick={() => step(1)} className="h-6 px-1">
                <ChevronRight />
              </GlassButton>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 border-t border-[var(--glass-ink-faint)]">
            <div key={view + shown.y + shown.m} className="flex min-w-0 flex-1 flex-col [animation:cal-in_.35s_var(--glass-ease)_both] motion-reduce:[animation:none]">
              <style href="glass-calendar" precedence="default">
                {"@keyframes cal-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }"}
              </style>
              {view === "month" ? (
                <MonthGrid y={shown.y} m={shown.m} today={today} selected={selected} onSelect={select} show={show} />
              ) : (
                <TimeGrid
                  days={view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [selected]}
                  today={today}
                  show={show}
                  selected={selected}
                  onSelect={select}
                />
              )}
            </div>
            <Inspector day={selected} today={today} show={show} />
          </div>
        </div>
      </div>
    </GlassWindow>
  )
}
