"use client"

import * as React from "react"
import { Search, TrendingUp } from "lucide-react"
import { Hairline, Pill, Widget, type WidgetSize } from "../glass"
import { GlassWindow, useWindowManager, type WindowState } from "../window-manager"
import { hashString, rng } from "@/components/ui/glass-folder-cards"
import { cn } from "@/lib/utils"

/**
 * Stocks: a simulated market shared by the desktop widget and the Stocks app.
 *
 * Every series is generated from a seeded random walk, so the server and the
 * client paint the same first frame. Live ticking starts only once a component
 * subscribes on the client (inside React's commit), and stops when nothing is
 * listening.
 */

// ---------------------------------------------------------------------------
// Market model

type Spec = {
  symbol: string
  name: string
  base: number
  /** daily volatility (σ of daily returns) */
  vol: number
  shares: number
  eps: number | null
  beta: number | null
  yld: number | null
  avgVol: number
}

const SPECS: Spec[] = [
  { symbol: "AAPL", name: "Apple Inc.", base: 228.4, vol: 0.016, shares: 15.2e9, eps: 6.42, beta: 1.21, yld: 0.44, avgVol: 54e6 },
  { symbol: "NVDA", name: "NVIDIA Corporation", base: 138.2, vol: 0.03, shares: 24.5e9, eps: 2.53, beta: 1.68, yld: 0.03, avgVol: 245e6 },
  { symbol: "MSFT", name: "Microsoft Corporation", base: 418.7, vol: 0.014, shares: 7.43e9, eps: 12.1, beta: 0.9, yld: 0.72, avgVol: 20e6 },
  { symbol: "TSLA", name: "Tesla, Inc.", base: 251.3, vol: 0.035, shares: 3.2e9, eps: 3.65, beta: 2.3, yld: null, avgVol: 92e6 },
  { symbol: "AMZN", name: "Amazon.com, Inc.", base: 186.5, vol: 0.018, shares: 10.5e9, eps: 4.18, beta: 1.15, yld: null, avgVol: 41e6 },
  { symbol: "GOOG", name: "Alphabet Inc.", base: 166.9, vol: 0.017, shares: 12.3e9, eps: 7.54, beta: 1.03, yld: 0.48, avgVol: 22e6 },
  { symbol: "META", name: "Meta Platforms, Inc.", base: 589.2, vol: 0.022, shares: 2.53e9, eps: 21.2, beta: 1.22, yld: 0.34, avgVol: 12e6 },
  { symbol: "BTC-USD", name: "Bitcoin USD", base: 67250, vol: 0.028, shares: 19.76e6, eps: null, beta: null, yld: null, avgVol: 31e9 },
]

const SPEC_BY_SYMBOL = new Map(SPECS.map((s) => [s.symbol, s]))

/** Intraday points are two minutes apart; the session runs 9:30 to 4:00. */
const STEP_MIN = 2
const OPEN_MIN = 9 * 60 + 30
const CLOSE_MIN = 16 * 60
const SESSION_SLOTS = (CLOSE_MIN - OPEN_MIN) / STEP_MIN + 1 // 196
const INITIAL_POINTS = 120
const DAILY_DAYS = 1260 // five years of trading days

type Quote = {
  symbol: string
  name: string
  open: number
  prevClose: number
  price: number
  /** change versus the day's open */
  change: number
  changePct: number
  high: number
  low: number
  volume: number
  /** intraday prices; index i is at minute `startMinute + i * STEP_MIN` */
  intraday: number[]
  startMinute: number
  /** per-symbol drift for the live walk */
  drift: number
}

type Snapshot = { quotes: Record<string, Quote>; live: boolean }

function gaussian(r: () => number) {
  let u = 0
  while (u === 0) u = r()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}

/** A walk that starts at `a`, takes `n` steps and is pinned to land on `b`. */
function bridge(a: number, b: number, n: number, sigma: number, r: () => number): number[] {
  const walk = [0]
  for (let i = 1; i <= n; i++) walk.push(walk[i - 1] + sigma * gaussian(r))
  const end = walk[n]
  const la = Math.log(a)
  const lb = Math.log(b)
  return walk.map((w, i) => Math.exp(la + (lb - la) * (i / n) + w - end * (i / n)))
}

type History = {
  /** daily closes, the last one is yesterday's close */
  daily: number[]
  week: number[]
  month: number[]
}

const HISTORY = new Map<string, History>()

function buildQuote(spec: Spec): Quote {
  const r = rng(hashString(spec.symbol) ^ 0x5eed)
  const stepSigma = spec.vol / Math.sqrt(SESSION_SLOTS - 1)
  const drift = (r() - 0.45) * stepSigma * 0.18

  // yesterday's close sits a small gap away from today's open
  const open = spec.base
  const prevClose = open * (1 + (r() - 0.5) * spec.vol * 0.8)

  // daily closes walked backwards from yesterday's close
  const daily: number[] = new Array(DAILY_DAYS)
  daily[DAILY_DAYS - 1] = prevClose
  const longDrift = 0.0006 + r() * 0.0008 // most of these went up over five years
  for (let i = DAILY_DAYS - 2; i >= 0; i--) {
    daily[i] = daily[i + 1] / (1 + longDrift + spec.vol * gaussian(r))
  }
  // finer ranges: bridge between the daily closes so every range agrees
  const week: number[] = []
  for (let d = DAILY_DAYS - 6; d < DAILY_DAYS - 1; d++) {
    const seg = bridge(daily[d], daily[d + 1], 13, spec.vol / Math.sqrt(13), r)
    week.push(...(week.length ? seg.slice(1) : seg))
  }
  const month: number[] = []
  for (let d = DAILY_DAYS - 23; d < DAILY_DAYS - 1; d++) {
    const seg = bridge(daily[d], daily[d + 1], 4, spec.vol / 2, r)
    month.push(...(month.length ? seg.slice(1) : seg))
  }
  HISTORY.set(spec.symbol, { daily, week, month })

  // today, from the open
  const intraday = [open]
  let volume = 0
  for (let i = 1; i < INITIAL_POINTS; i++) {
    intraday.push(intraday[i - 1] * (1 + drift + stepSigma * gaussian(r)))
    volume += (spec.avgVol / SESSION_SLOTS) * (0.4 + r() * 1.2)
  }
  const price = intraday[intraday.length - 1]
  return {
    symbol: spec.symbol,
    name: spec.name,
    open,
    prevClose,
    price,
    change: price - open,
    changePct: ((price - open) / open) * 100,
    high: Math.max(...intraday),
    low: Math.min(...intraday),
    volume,
    intraday,
    startMinute: OPEN_MIN,
    drift,
  }
}

const INITIAL: Snapshot = {
  quotes: Object.fromEntries(SPECS.map((s) => [s.symbol, buildQuote(s)])),
  live: false,
}

// --- the store ------------------------------------------------------------

let snapshot: Snapshot = INITIAL
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
const tickRng = rng(0x51c0ffee)

function emit() {
  for (const l of listeners) l()
}

function tick() {
  const quotes: Record<string, Quote> = {}
  for (const spec of SPECS) {
    const q = snapshot.quotes[spec.symbol]
    const sigma = (spec.vol / Math.sqrt(SESSION_SLOTS - 1)) * 0.7
    const price = Math.max(0.01, q.price * (1 + q.drift + sigma * gaussian(tickRng)))
    let intraday = [...q.intraday, price]
    let startMinute = q.startMinute
    if (intraday.length > SESSION_SLOTS) {
      intraday = intraday.slice(intraday.length - SESSION_SLOTS)
      startMinute += STEP_MIN
    }
    quotes[spec.symbol] = {
      ...q,
      price,
      change: price - q.open,
      changePct: ((price - q.open) / q.open) * 100,
      high: Math.max(q.high, price),
      low: Math.min(q.low, price),
      volume: q.volume + (spec.avgVol / SESSION_SLOTS) * (0.4 + tickRng() * 1.2),
      intraday,
      startMinute,
    }
  }
  snapshot = { quotes, live: true }
  emit()
}

const market = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    if (!timer && typeof window !== "undefined") {
      timer = setInterval(tick, 1500)
      if (!snapshot.live) {
        snapshot = { ...snapshot, live: true }
        queueMicrotask(emit)
      }
    }
    return () => {
      listeners.delete(listener)
      if (!listeners.size && timer) {
        clearInterval(timer)
        timer = null
      }
    }
  },
  getSnapshot: () => snapshot,
  getServerSnapshot: () => INITIAL,
}

function useMarket(): Snapshot {
  return React.useSyncExternalStore(market.subscribe, market.getSnapshot, market.getServerSnapshot)
}

// --- ranges -----------------------------------------------------------------

const RANGES = ["1D", "1W", "1M", "3M", "1Y", "ALL"] as const
type Range = (typeof RANGES)[number]

type Series = {
  values: number[]
  /** x-domain size; 1D reserves the whole session so the line fills in */
  slots: number
  /** reference line: previous close on 1D, the range's start otherwise */
  baseline: number
  baselineLabel: string
  /** describes point i; only called on the client (hover) */
  label: (i: number) => string
}

function rangeSeries(q: Quote, range: Range): Series {
  if (range === "1D") {
    return {
      values: q.intraday,
      slots: Math.max(SESSION_SLOTS, q.intraday.length),
      baseline: q.prevClose,
      baselineLabel: "Prev close",
      label: (i) => fmtMinute(q.startMinute + i * STEP_MIN),
    }
  }
  const h = HISTORY.get(q.symbol)!
  let values: number[]
  let perDay: number
  if (range === "1W") {
    values = h.week
    perDay = 13
  } else if (range === "1M") {
    values = h.month
    perDay = 4
  } else if (range === "3M") {
    values = h.daily.slice(-63)
    perDay = 1
  } else if (range === "1Y") {
    values = h.daily.slice(-252)
    perDay = 1
  } else {
    values = h.daily.filter((_, i) => (h.daily.length - 1 - i) % 5 === 0)
    perDay = 1 / 5
  }
  const all = [...values, q.price]
  const last = all.length - 1
  return {
    values: all,
    slots: all.length,
    baseline: all[0],
    baselineLabel: "Range start",
    label: (i) => {
      if (i === last) return "Today"
      const daysAgo = (last - i) / perDay
      const date = tradingDaysAgo(Math.ceil(daysAgo))
      const opts: Intl.DateTimeFormatOptions =
        range === "1W"
          ? { weekday: "short", hour: "numeric", minute: "2-digit" }
          : range === "ALL" || range === "1Y"
            ? { month: "short", day: "numeric", year: "numeric" }
            : { month: "short", day: "numeric" }
      if (range === "1W") {
        const frac = Math.ceil(daysAgo) - daysAgo
        date.setHours(9, 30 + Math.round(frac * 390), 0, 0)
      }
      return date.toLocaleString("en-US", opts)
    },
  }
}

function tradingDaysAgo(n: number): Date {
  const d = new Date()
  let left = n
  while (left > 0) {
    d.setDate(d.getDate() - 1)
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) left--
  }
  return d
}

// --- formatting ---------------------------------------------------------------

const priceFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtPrice(p: number) {
  return priceFmt.format(p)
}
function fmtSigned(n: number, digits = 2) {
  return (n >= 0 ? "+" : "−") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
function fmtPct(n: number) {
  return fmtSigned(n) + "%"
}
function fmtBig(n: number) {
  const a = Math.abs(n)
  if (a >= 1e12) return (n / 1e12).toFixed(2) + "T"
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B"
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M"
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K"
  return n.toFixed(0)
}
function fmtMinute(m: number) {
  const mm = ((m % 1440) + 1440) % 1440
  const h = Math.floor(mm / 60)
  const min = mm % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

function statusLine(q: Quote, live: boolean) {
  const last = q.startMinute + (q.intraday.length - 1) * STEP_MIN
  if (q.symbol === "BTC-USD") return `${live ? "Live" : "As of"} · ${fmtMinute(last)} EDT`
  if (last >= CLOSE_MIN) return "At close · 4:00 PM EDT"
  return `${live ? "Market open" : "As of"} · ${fmtMinute(last)} EDT`
}

// ---------------------------------------------------------------------------
// Sparkline

const UP = "text-[#34c759] dark:text-[#30d158]"
const DOWN = "text-[#ff453a] dark:text-[#ff6961]"

function Sparkline({
  values,
  baseline,
  w,
  h,
  up,
  slots,
  className,
  strokeWidth = 1.5,
}: {
  values: number[]
  baseline?: number
  w: number
  h: number
  up: boolean
  slots?: number
  className?: string
  strokeWidth?: number
}) {
  const gid = "spark" + React.useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const n = values.length
  const span = Math.max(slots ?? n, 2) - 1
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (baseline !== undefined) {
    min = Math.min(min, baseline)
    max = Math.max(max, baseline)
  }
  if (max - min < 1e-9) max = min + 1
  const pad = 3
  const x = (i: number) => (i / span) * w
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (h - pad * 2)
  let line = ""
  for (let i = 0; i < n; i++) line += (i ? "L" : "M") + x(i).toFixed(2) + "," + y(values[i]).toFixed(2)
  const lastX = x(n - 1)
  const lastY = y(values[n - 1])
  const area = `${line}L${lastX.toFixed(2)},${h}L0,${h}Z`
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      aria-hidden="true"
      className={cn("block overflow-visible", up ? UP : DOWN, className)}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.32} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      {baseline !== undefined ? (
        <line
          x1={0}
          x2={w}
          y1={y(baseline)}
          y2={y(baseline)}
          stroke="var(--glass-ink-soft)"
          strokeOpacity={0.5}
          strokeWidth={1}
          strokeDasharray="1.5 2.5"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        r={2.5}
        cx={0}
        cy={0}
        fill="currentColor"
        stroke="var(--glass-bg-strong)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        style={{ transform: `translate(${lastX}px, ${lastY}px)` }}
        className="motion-safe:transition-transform motion-safe:duration-700 motion-safe:[transition-timing-function:var(--glass-ease)]"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Widget

function ChangePill({ q, pct = true, className }: { q: Quote; pct?: boolean; className?: string }) {
  return (
    <Pill tone={q.change >= 0 ? "up" : "down"} className={cn("tabular-nums", className)}>
      {pct ? fmtPct(q.changePct) : fmtSigned(q.change)}
    </Pill>
  )
}

function WidgetRow({ q, onOpen, compact }: { q: Quote; onOpen: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${q.symbol}, ${fmtPrice(q.price)}, ${fmtPct(q.changePct)}`}
      className="-mx-1.5 flex min-h-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-left transition-colors hover:bg-[var(--glass-hover)] focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)]"
    >
      <span className="w-[92px] min-w-0 shrink-0">
        <span className="block truncate text-[13px] leading-tight font-semibold ink">{q.symbol}</span>
        <span className="block truncate text-[11px] leading-tight ink-soft">{q.name}</span>
      </span>
      <Sparkline
        values={q.intraday}
        baseline={q.open}
        slots={SESSION_SLOTS}
        w={96}
        h={compact ? 24 : 30}
        up={q.change >= 0}
        className="shrink-0"
      />
      <span className="ml-auto flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-[13px] leading-tight font-medium tabular-nums ink">{fmtPrice(q.price)}</span>
        <ChangePill q={q} className="min-w-[58px] justify-end" />
      </span>
    </button>
  )
}

export function StocksWidget({ size = "small", className }: { size?: WidgetSize; className?: string }) {
  const { quotes } = useMarket()
  const { open } = useWindowManager()
  const openApp = (symbol: string) => open("stocks", { singleton: "app", payload: { symbol }, w: 820, h: 560 })

  if (size === "small") {
    const q = quotes.AAPL
    const up = q.change >= 0
    return (
      <Widget size={size} label="Stocks" className={cn("relative", className)}>
        <button
          type="button"
          onClick={() => openApp(q.symbol)}
          aria-label={`${q.symbol} ${q.name}, ${fmtPrice(q.price)}, ${fmtPct(q.changePct)}. Open Stocks`}
          className="relative flex h-full w-full flex-col p-3.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--glass-accent)] rounded-[22px]"
        >
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block text-[15px] leading-tight font-semibold ink">{q.symbol}</span>
              <span className="block truncate text-[11px] leading-tight ink-soft">{q.name}</span>
            </span>
            <TrendingUp className={cn("size-3.5 shrink-0", up ? UP : DOWN, !up && "-scale-y-100")} aria-hidden="true" />
          </span>
          <span className="mt-1.5 block text-[22px] leading-none font-semibold tracking-tight tabular-nums ink">
            {fmtPrice(q.price)}
          </span>
          <span className="mt-1.5 block">
            <ChangePill q={q} />
          </span>
          <span className="absolute inset-x-0 bottom-0">
            <Sparkline values={q.intraday} baseline={q.open} w={170} h={64} up={up} strokeWidth={1.75} />
          </span>
        </button>
      </Widget>
    )
  }

  const symbols = size === "medium" ? ["AAPL", "NVDA", "TSLA"] : ["AAPL", "NVDA", "MSFT", "TSLA", "AMZN", "META"]
  return (
    <Widget size={size} label="Stocks" className={className}>
      <div className="flex h-full flex-col px-3.5 pt-3 pb-2.5">
        <div className="flex shrink-0 items-center justify-between pb-1.5">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold ink">
            <TrendingUp className="size-3.5" aria-hidden="true" />
            Stocks
          </span>
          <span className="flex items-center gap-1.5 text-[10.5px] ink-soft">
            <span className="relative grid size-1.5 place-items-center">
              <span className="absolute inset-0 rounded-full bg-[#34c759] opacity-60 motion-safe:animate-ping" />
              <span className="relative size-1.5 rounded-full bg-[#34c759]" />
            </span>
            Markets open
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {symbols.map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 ? <Hairline /> : null}
              <WidgetRow q={quotes[s]} onOpen={() => openApp(s)} compact={size === "medium"} />
            </React.Fragment>
          ))}
        </div>
      </div>
    </Widget>
  )
}

// ---------------------------------------------------------------------------
// Window: big chart

const CHART_H = 236
const PAD_T = 12
const PAD_B = 22
const PAD_R = 54

function niceTicks(min: number, max: number, count = 4): number[] {
  const rough = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? rough
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v)
  return out
}

function PriceChart({ q, range }: { q: Quote; range: Range }) {
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(0)
  const [hover, setHover] = React.useState<number | null>(null)
  const gradId = "chart" + React.useId().replace(/[^a-zA-Z0-9_-]/g, "")

  React.useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const s = rangeSeries(q, range)
  const n = s.values.length
  const last = s.values[n - 1]
  const up = last >= (range === "1D" ? q.open : s.baseline)

  let min = Math.min(...s.values, s.baseline)
  let max = Math.max(...s.values, s.baseline)
  const padV = (max - min) * 0.08 || 1
  min -= padV
  max += padV
  const cw = Math.max(0, width - PAD_R)
  const ch = CHART_H - PAD_T - PAD_B
  const x = (i: number) => (i / Math.max(1, s.slots - 1)) * cw
  const y = (v: number) => PAD_T + (1 - (v - min) / (max - min)) * ch

  let line = ""
  for (let i = 0; i < n; i++) line += (i ? "L" : "M") + x(i).toFixed(2) + "," + y(s.values[i]).toFixed(2)
  const area = `${line}L${x(n - 1).toFixed(2)},${PAD_T + ch}L0,${PAD_T + ch}Z`
  const ticks = niceTicks(min, max)
  const hourTicks =
    range === "1D"
      ? [10, 12, 14, 16]
          .map((hr) => ({ hr, i: (hr * 60 - q.startMinute) / STEP_MIN }))
          .filter((t) => t.i >= 0 && t.i <= s.slots - 1)
      : []

  const hi = hover !== null ? Math.min(hover, n - 1) : null

  const pick = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || cw <= 0) return
    const i = Math.round(((clientX - rect.left) / cw) * (s.slots - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault()
      const stepSize = e.shiftKey ? 10 : 1
      setHover((h) => {
        const cur = h ?? n - 1
        return Math.max(0, Math.min(n - 1, cur + (e.key === "ArrowLeft" ? -stepSize : stepSize)))
      })
    } else if (e.key === "Escape") setHover(null)
  }

  const tipLeft = hi !== null ? Math.min(Math.max(x(hi) - 60, 0), Math.max(0, cw - 120)) : 0

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="img"
      aria-label={`${q.symbol} ${range} chart. Last ${fmtPrice(last)}. Use left and right arrow keys to inspect.`}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerLeave={() => setHover(null)}
      onBlur={() => setHover(null)}
      onKeyDown={onKeyDown}
      className="relative w-full rounded-lg outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)]"
      style={{ height: CHART_H }}
    >
      {width > 0 ? (
        <svg width={width} height={CHART_H} viewBox={`0 0 ${width} ${CHART_H}`} className={cn("block overflow-visible", up ? UP : DOWN)}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={cw} y1={y(t)} y2={y(t)} stroke="var(--glass-ink-faint)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text
                x={cw + 8}
                y={y(t)}
                dominantBaseline="middle"
                fill="var(--glass-ink-soft)"
                className="font-sans text-[10.5px] tabular-nums"
              >
                {fmtPrice(t)}
              </text>
            </g>
          ))}
          {hourTicks.map((t) => (
            <text
              key={t.hr}
              x={x(t.i)}
              y={CHART_H - 6}
              textAnchor={t.hr === 16 ? "end" : "middle"}
              fill="var(--glass-ink-soft)"
              className="font-sans text-[10.5px] tabular-nums"
            >
              {t.hr > 12 ? t.hr - 12 : t.hr}
              {t.hr >= 12 ? " PM" : " AM"}
            </text>
          ))}
          <line
            x1={0}
            x2={cw}
            y1={y(s.baseline)}
            y2={y(s.baseline)}
            stroke="var(--glass-ink-soft)"
            strokeWidth={1}
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
          <text x={4} y={y(s.baseline) - 5} fill="var(--glass-ink-soft)" className="font-sans text-[10px]">
            {s.baselineLabel} {fmtPrice(s.baseline)}
          </text>
          <path d={area} fill={`url(#${gradId})`} />
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            r={3}
            cx={0}
            cy={0}
            fill="currentColor"
            stroke="var(--glass-bg-strong)"
            strokeWidth={1.5}
            style={{ transform: `translate(${x(n - 1)}px, ${y(last)}px)` }}
            className="motion-safe:transition-transform motion-safe:duration-700 motion-safe:[transition-timing-function:var(--glass-ease)]"
          />
          {hi !== null ? (
            <g pointerEvents="none">
              <line
                x1={x(hi)}
                x2={x(hi)}
                y1={PAD_T - 4}
                y2={PAD_T + ch}
                stroke="var(--glass-ink-soft)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={x(hi)} cy={y(s.values[hi])} r={4} fill="currentColor" stroke="var(--glass-bg-strong)" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
      ) : null}
      {hi !== null ? (
        <div
          className="glass glass-strong pointer-events-none absolute top-0 z-10 w-[120px] rounded-lg px-2 py-1 text-center"
          style={{ left: tipLeft, transform: "translateY(-70%)" }}
        >
          <p className="text-[10.5px] leading-tight ink-soft">{s.label(hi)}</p>
          <p className="text-[12.5px] leading-tight font-semibold tabular-nums ink">{fmtPrice(s.values[hi])}</p>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Window

const STORY_SOURCES = ["Market Wire", "The Daily Ledger", "Ticker Digest", "Open Close", "The Tape"]
const STORY_TEMPLATES: ((name: string, sym: string) => string)[] = [
  (n) => `${n} edges higher as analysts revisit their sector outlook`,
  (_, s) => `What a busy earnings week could mean for ${s} holders`,
  (n) => `Investors weigh the rate path; large caps such as ${n} in focus`,
  (_, s) => `Options traders position for a wider range in ${s}`,
  (n) => `Five charts that explain ${n}'s year so far`,
]

function storiesFor(symbol: string, name: string) {
  const r = rng(hashString(symbol + ":news"))
  const start = Math.floor(r() * STORY_TEMPLATES.length)
  const short = name.replace(/,? (Inc\.|Corporation|Platforms, Inc\.|USD)$/, "")
  return [0, 1, 2].map((k) => ({
    title: STORY_TEMPLATES[(start + k) % STORY_TEMPLATES.length](short, symbol),
    source: STORY_SOURCES[(start + k * 2) % STORY_SOURCES.length],
    age: `${1 + Math.floor(r() * 3) + k * 2}h ago`,
  }))
}

function statsFor(q: Quote): [string, string][] {
  const spec = SPEC_BY_SYMBOL.get(q.symbol)!
  const year = [...HISTORY.get(q.symbol)!.daily.slice(-252), q.price]
  const dash = "—"
  return [
    ["Open", fmtPrice(q.open)],
    ["High", fmtPrice(q.high)],
    ["Low", fmtPrice(q.low)],
    ["Vol", fmtBig(q.volume)],
    ["P/E", spec.eps ? (q.price / spec.eps).toFixed(2) : dash],
    ["Mkt Cap", fmtBig(q.price * spec.shares)],
    ["52W H", fmtPrice(Math.max(...year, q.high))],
    ["52W L", fmtPrice(Math.min(...year, q.low))],
    ["Avg Vol", fmtBig(spec.avgVol)],
    ["Yield", spec.yld !== null ? spec.yld.toFixed(2) + "%" : dash],
    ["Beta", spec.beta !== null ? spec.beta.toFixed(2) : dash],
    ["EPS", spec.eps !== null ? spec.eps.toFixed(2) : dash],
  ]
}

function payloadSymbol(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "symbol" in payload) {
    const s = (payload as { symbol: unknown }).symbol
    if (typeof s === "string" && SPEC_BY_SYMBOL.has(s)) return s
  }
  return null
}

export function StocksWindow({ win }: { win: WindowState }) {
  const { quotes, live } = useMarket()
  const [selected, setSelected] = React.useState(() => payloadSymbol(win.payload) ?? "AAPL")
  const [range, setRange] = React.useState<Range>("1D")
  const [query, setQuery] = React.useState("")
  const optionRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const listId = React.useId()

  // follow a new payload (e.g. a widget row clicked while the app is open)
  const [lastPayload, setLastPayload] = React.useState(win.payload)
  if (win.payload !== lastPayload) {
    setLastPayload(win.payload)
    const s = payloadSymbol(win.payload)
    if (s) setSelected(s)
  }

  const needle = query.trim().toLowerCase()
  const list = SPECS.filter((s) => !needle || s.symbol.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle)).map(
    (s) => quotes[s.symbol],
  )

  const q = quotes[selected]
  const series = rangeSeries(q, range)
  const ref = range === "1D" ? q.open : series.baseline
  const change = q.price - ref
  const changePct = (change / ref) * 100
  const up = change >= 0
  const stats = statsFor(q)
  const stories = storiesFor(q.symbol, q.name)

  const select = (symbol: string, focus = false) => {
    setSelected(symbol)
    if (focus) optionRefs.current.get(symbol)?.focus()
  }

  const onListKey = (e: React.KeyboardEvent) => {
    if (!list.length) return
    const at = Math.max(
      0,
      list.findIndex((x) => x.symbol === selected),
    )
    let next = -1
    if (e.key === "ArrowDown") next = Math.min(list.length - 1, at + 1)
    else if (e.key === "ArrowUp") next = Math.max(0, at - 1)
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = list.length - 1
    if (next < 0) return
    e.preventDefault()
    select(list[next].symbol, true)
  }

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "ArrowDown" || e.key === "Enter") && list.length) {
      e.preventDefault()
      const target = list.some((x) => x.symbol === selected) ? selected : list[0].symbol
      select(target, true)
    } else if (e.key === "Escape" && query) {
      e.preventDefault()
      setQuery("")
    }
  }

  return (
    <GlassWindow win={win} icon={<TrendingUp />} minW={620} minH={400}>
      <div className="flex h-full min-h-0" data-no-drag>
        {/* watchlist */}
        <aside className="flex w-[240px] shrink-0 flex-col border-r border-[var(--glass-ink-faint)] bg-[var(--glass-bg-thin)]">
          <div className="shrink-0 p-2.5">
            <label className="flex h-7 items-center gap-1.5 rounded-lg bg-[var(--glass-ink-faint)] px-2 transition-shadow focus-within:ring-2 focus-within:ring-[var(--glass-accent)]">
              <Search className="size-3.5 shrink-0 ink-soft" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Search"
                aria-label="Search symbols"
                aria-controls={listId}
                className="min-w-0 flex-1 bg-transparent text-[12.5px] ink outline-none placeholder:text-[var(--glass-ink-soft)]"
              />
            </label>
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label="Watchlist"
            onKeyDown={onListKey}
            className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2"
          >
            {list.length === 0 ? <p className="px-2 py-6 text-center text-[12px] ink-soft">No results</p> : null}
            {list.map((item, i) => {
              const isSel = item.symbol === selected
              return (
                <React.Fragment key={item.symbol}>
                  {i > 0 ? <Hairline className={cn("mx-2 w-auto", (isSel || list[i - 1].symbol === selected) && "opacity-0")} /> : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    tabIndex={isSel || (!list.some((x) => x.symbol === selected) && i === 0) ? 0 : -1}
                    ref={(el) => {
                      if (el) optionRefs.current.set(item.symbol, el)
                      else optionRefs.current.delete(item.symbol)
                    }}
                    onClick={() => select(item.symbol)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors duration-200 [transition-timing-function:var(--glass-ease)]",
                      "focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)]",
                      isSel ? "bg-[var(--glass-ink-faint)]" : "hover:bg-[var(--glass-hover)]",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] leading-tight font-semibold ink">{item.symbol}</span>
                      <span className="block truncate text-[11px] leading-tight ink-soft">{item.name}</span>
                    </span>
                    <Sparkline
                      values={item.intraday}
                      baseline={item.open}
                      slots={SESSION_SLOTS}
                      w={52}
                      h={24}
                      up={item.change >= 0}
                      strokeWidth={1.25}
                      className="shrink-0"
                    />
                    <span className="flex w-[70px] shrink-0 flex-col items-end gap-0.5">
                      <span className="text-[12.5px] leading-tight font-medium tabular-nums ink">{fmtPrice(item.price)}</span>
                      <ChangePill q={item} className="min-w-[56px] justify-end" />
                    </span>
                  </button>
                </React.Fragment>
              )
            })}
          </div>
          <p className="shrink-0 border-t border-[var(--glass-ink-faint)] px-3 py-1.5 text-[10.5px] ink-soft">Simulated market data</p>
        </aside>

        {/* detail */}
        <section aria-label={`${q.symbol} details`} className="no-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pt-4 pb-6">
          <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 className="flex items-baseline gap-2">
                <span className="text-[22px] leading-tight font-bold tracking-tight ink">{q.symbol}</span>
                <span className="truncate text-[13px] ink-soft">{q.name}</span>
              </h2>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-2.5">
                <span className="text-[28px] leading-none font-semibold tracking-tight tabular-nums ink">{fmtPrice(q.price)}</span>
                <span className={cn("text-[14px] font-medium tabular-nums", up ? UP : DOWN)}>
                  {fmtSigned(change)} ({fmtPct(changePct)})
                </span>
                <span className="text-[11.5px] ink-soft">{range === "1D" ? "today" : `past ${range === "ALL" ? "5 years" : range}`}</span>
              </p>
              <p className="mt-1 text-[11.5px] ink-soft">
                {statusLine(q, live)}
              </p>
            </div>
            <div role="group" aria-label="Chart range" className="flex shrink-0 rounded-lg bg-[var(--glass-ink-faint)] p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={r === range}
                  onClick={() => setRange(r)}
                  className={cn(
                    "h-6 min-w-9 rounded-md px-2 text-[11.5px] font-medium tabular-nums transition-[background-color,color,box-shadow] duration-200 [transition-timing-function:var(--glass-ease)]",
                    "focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)]",
                    r === range
                      ? "bg-[var(--glass-bg-strong)] ink shadow-[0_1px_2px_rgba(0,0,0,.12),0_0_0_.5px_var(--glass-edge)]"
                      : "ink-soft hover:ink",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </header>

          <div className="mt-5">
            <PriceChart key={q.symbol + range} q={q} range={range} />
          </div>

          <dl className="mt-5 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            {[stats.slice(0, 6), stats.slice(6)].map((col, c) => (
              <div key={c} className="min-w-0">
                {col.map(([k, v], i) => (
                  <div key={k} className={cn("flex items-baseline justify-between gap-3 py-1.5", i > 0 && "border-t border-[var(--glass-ink-faint)]")}>
                    <dt className="text-[12px] ink-soft">{k}</dt>
                    <dd className="text-[12.5px] font-medium tabular-nums ink">{v}</dd>
                  </div>
                ))}
              </div>
            ))}
          </dl>

          <h3 className="mt-6 mb-2 text-[13px] font-semibold ink">Top Stories</h3>
          <ul className="grid gap-2">
            {stories.map((st) => (
              <li
                key={st.title}
                className="glass-thin rounded-xl px-3 py-2.5 shadow-[inset_0_1px_0_var(--glass-rim),0_0_0_.5px_var(--glass-edge)] transition-colors hover:bg-[var(--glass-hover)]"
              >
                <p className="text-[10.5px] font-semibold tracking-wide uppercase ink-soft">{st.source}</p>
                <p className="mt-0.5 text-[13px] leading-snug font-medium ink">{st.title}</p>
                <p className="mt-1 text-[11px] ink-soft">{st.age}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </GlassWindow>
  )
}
