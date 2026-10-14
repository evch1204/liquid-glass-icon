"use client"

import * as React from "react"
import { GlassObject, GlassPane, LIQUIDS, LiquidCanvas, useGlass, useSpringVar, type LiquidHandle, type LiquidRecipe } from "@/components/ui/glass-object"
import { hashString, rng } from "@/components/ui/glass-folder-cards"
import { WIDGET, type WidgetSize } from "../glass"
import { useWindowManager } from "../window-manager"

/**
 * Stocks — the macOS Stocks widget, drawn as an object.
 *
 * At rest it is the native widget: one frosted pane over a liquid with a faint
 * green or red cast, the quotes printed on it (symbol and name, a sparkline,
 * the price and its pill). The market ticks every 1.5s: prices and the newest
 * point are rewritten by ref, the end dot glows for a moment and the liquid
 * stirs.
 *
 * Nothing ever leaves the card and the card never changes size or shape.
 *
 * - **Hover**: a soft band brightens the row under the pointer and slides from
 *   row to row on a spring; that row's sparkline redraws from the left, its
 *   end dot glows and its price rolls up to the live value.
 * - **Open** (click): an accordion. The clicked row (AAPL on small) expands in
 *   place into a chart — gridlines, the previous close, a stroke that inks
 *   itself in, O/H/L/Vol — while the others compress to one-line strips
 *   below. Clicking a strip swaps it in; Escape or a click outside collapses
 *   back to the native list.
 * - **Activate** (double-click, Enter): the Stocks app on the row under the
 *   pointer (or the top ticker).
 */

// ---------------------------------------------------------------------------
// A tiny seeded market. The Stocks app keeps its own model private, so this
// mirrors its symbols and base prices; the first frame is identical on server
// and client, and live ticks start only once something subscribes.

type Spec = { symbol: string; name: string; base: number; vol: number }

const SPECS: Spec[] = [
  { symbol: "AAPL", name: "Apple Inc.", base: 228.4, vol: 0.016 },
  { symbol: "NVDA", name: "NVIDIA Corporation", base: 138.2, vol: 0.03 },
  { symbol: "MSFT", name: "Microsoft Corporation", base: 418.7, vol: 0.014 },
  { symbol: "TSLA", name: "Tesla, Inc.", base: 251.3, vol: 0.035 },
  { symbol: "AMZN", name: "Amazon.com, Inc.", base: 186.5, vol: 0.018 },
  { symbol: "GOOG", name: "Alphabet Inc.", base: 166.9, vol: 0.017 },
  { symbol: "META", name: "Meta Platforms, Inc.", base: 589.2, vol: 0.022 },
  { symbol: "BTC-USD", name: "Bitcoin USD", base: 67250, vol: 0.028 },
]

const POINTS = 60
const TICK_MS = 1500

type Ticker = { symbol: string; name: string; open: number; series: number[]; sigma: number; drift: number }

/** Roughly normal, from a seeded uniform source. */
function noise(r: () => number): number {
  return (r() + r() + r() + r() - 2) * 1.73
}

function build(spec: Spec): Ticker {
  const r = rng(hashString(spec.symbol) ^ 0x0b1ec7)
  const sigma = spec.vol / 9
  const drift = (r() - 0.45) * sigma * 0.22
  const open = spec.base
  const series = [open]
  for (let i = 1; i < POINTS; i++) series.push(series[i - 1] * (1 + drift + sigma * noise(r)))
  return { symbol: spec.symbol, name: spec.name, open, series, sigma, drift }
}

/** The first frame, never mutated: what the server paints. */
const INITIAL: Record<string, Ticker> = Object.fromEntries(SPECS.map((s) => [s.symbol, build(s)]))
const initialGet = (s: string) => INITIAL[s]

const market = (() => {
  const live: Record<string, Ticker> = Object.fromEntries(
    SPECS.map((s) => [s.symbol, { ...INITIAL[s.symbol], series: INITIAL[s.symbol].series.slice() }]),
  )
  const subs = new Set<() => void>()
  const r = rng(0x570c45)
  let timer = 0
  const step = () => {
    for (const s of SPECS) {
      const t = live[s.symbol]
      // a gentle pull back toward the open keeps the walk on the card
      const prev = t.series[t.series.length - 1]
      const pull = Math.log(t.open / prev) * 0.02
      t.series.push(prev * (1 + t.drift + pull + t.sigma * noise(r)))
      t.series.shift()
    }
    subs.forEach((f) => f())
  }
  return {
    get: (symbol: string) => live[symbol],
    /** Calls `f` now and after every tick; the clock runs while anyone listens. */
    subscribe(f: () => void) {
      subs.add(f)
      f()
      if (!timer) timer = window.setInterval(step, TICK_MS)
      return () => {
        subs.delete(f)
        if (!subs.size) {
          window.clearInterval(timer)
          timer = 0
        }
      }
    },
  }
})()

/** Like `market.subscribe`, but skips the immediate call: `f` runs on real ticks only. */
function onTick(f: () => void) {
  let first = true
  return market.subscribe(() => {
    if (first) first = false
    else f()
  })
}

const last = (t: Ticker) => t.series[t.series.length - 1]
const pct = (t: Ticker) => ((last(t) - t.open) / t.open) * 100
const high = (t: Ticker) => Math.max(...t.series)
const low = (t: Ticker) => Math.min(...t.series)

/** A composite of the given tickers, each normalised to its open, based at 1000. */
function composite(get: (s: string) => Ticker, symbols: string[]): Ticker {
  const series = new Array<number>(POINTS).fill(0)
  for (const s of symbols) {
    const t = get(s)
    for (let i = 0; i < POINTS; i++) series[i] += (t.series[i] / t.open) * (1000 / symbols.length)
  }
  return { symbol: "INDEX", name: "Desk Index", open: 1000, series, sigma: 0, drift: 0 }
}

/** `source` is a symbol, or "index:" plus a comma list for the composite. */
function resolve(source: string, get: (s: string) => Ticker): Ticker {
  return source.startsWith("index:") ? composite(get, source.slice(6).split(",")) : get(source)
}

// ---------------------------------------------------------------------------
// Formatting, locale-free so server and client agree.

function fmtPrice(n: number): string {
  const s = n >= 10000 ? Math.round(n).toString() : n.toFixed(2)
  const [i, d] = s.split(".")
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (d ? "." + d : "")
}

function fmtPct(p: number): string {
  return (p >= 0 ? "+" : "−") + Math.abs(p).toFixed(2) + "%"
}

const display = (symbol: string) => symbol.replace("-USD", "")
const dirOf = (t: Ticker) => (pct(t) >= 0 ? "up" : "down")

/** Sparkline geometry, rounded to a tenth so server and browser agree. */
function geom(series: number[], open: number, w: number, h: number, pad: number) {
  let lo = open
  let hi = open
  for (const v of series) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const span = hi - lo || 1
  const X = (i: number) => Math.round((pad + (i / (series.length - 1)) * (w - pad * 2)) * 10) / 10
  const Y = (v: number) => Math.round((pad + (1 - (v - lo) / span) * (h - pad * 2)) * 10) / 10
  let line = ""
  for (let i = 0; i < series.length; i++) line += (i ? "L" : "M") + X(i) + " " + Y(series[i])
  const area = line + "L" + X(series.length - 1) + " " + h + "L" + X(0) + " " + h + "Z"
  return { line, area, x: X(series.length - 1), y: Y(series[series.length - 1]), base: Y(open) }
}

// ---------------------------------------------------------------------------
// A sparkline whose path is rewritten by ref on every tick; it never re-renders.
// `chart` adds gridlines and a dashed previous close.

function Spark({ source, w, h, chart = false, className }: { source: string; w: number; h: number; chart?: boolean; className?: string }) {
  const gid = "st-g" + React.useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const pad = chart ? 6 : 3
  const line = React.useRef<SVGPathElement>(null)
  const area = React.useRef<SVGPathElement>(null)
  const base = React.useRef<SVGLineElement>(null)
  const dot = React.useRef<SVGCircleElement>(null)
  const halo = React.useRef<SVGCircleElement>(null)
  React.useEffect(
    () =>
      market.subscribe(() => {
        const t = resolve(source, market.get)
        const g = geom(t.series, t.open, w, h, pad)
        line.current?.setAttribute("d", g.line)
        area.current?.setAttribute("d", g.area)
        base.current?.setAttribute("y1", String(g.base))
        base.current?.setAttribute("y2", String(g.base))
        for (const c of [dot.current, halo.current]) {
          c?.setAttribute("cx", String(g.x))
          c?.setAttribute("cy", String(g.y))
        }
      }),
    [source, w, h, pad],
  )
  const t0 = resolve(source, initialGet)
  const g = geom(t0.series, t0.open, w, h, pad)
  return (
    <svg viewBox={"0 0 " + w + " " + h} width={w} height={h} className={"st-spark" + (className ? " " + className : "")} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.34" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {chart ? [0.2, 0.5, 0.8].map((f) => <line key={f} x1="0" x2={w} y1={Math.round(h * f) + 0.5} y2={Math.round(h * f) + 0.5} className="st-grid" />) : null}
      <line ref={base} x1="0" x2={w} y1={g.base} y2={g.base} className={chart ? "st-prev" : "st-base"} />
      <path ref={area} d={g.area} fill={"url(#" + gid + ")"} className="st-area" />
      <path ref={line} d={g.line} className="st-line" pathLength={1} />
      <circle ref={halo} cx={g.x} cy={g.y} r={chart ? 7 : 5.5} className="st-halo" />
      <circle ref={dot} cx={g.x} cy={g.y} r={chart ? 2.6 : 2.1} className="st-dot" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// The liquid takes a faint cast from the market.

const CAST: Record<"light" | "dark", Record<"up" | "down", LiquidRecipe>> = {
  light: {
    up: { ...LIQUIDS.milk, colors: ["#dde9e1", "#eff6f1", "#ffffff", "#e7eee9"] },
    down: { ...LIQUIDS.milk, colors: ["#efdfdf", "#f8f0f0", "#ffffff", "#f1e7e7"] },
  },
  dark: {
    up: { ...LIQUIDS.smoke, colors: ["#141a16", "#1f2a23", "#313f37", "#1a201c"] },
    down: { ...LIQUIDS.smoke, colors: ["#1b1415", "#2a2123", "#3f3236", "#201a1b"] },
  },
}

function Liquid({ symbols, seed, cells, handle }: { symbols: string[]; seed: number; cells?: number; handle: React.Ref<LiquidHandle> }) {
  const { tone } = useGlass()
  const key = symbols.join(",")
  const [dir, setDir] = React.useState<"up" | "down">(() => dirOf(composite(initialGet, key.split(","))))
  // re-renders only when the market crosses its open
  React.useEffect(() => market.subscribe(() => setDir(dirOf(composite(market.get, key.split(","))))), [key])
  return <LiquidCanvas ref={handle} recipe={CAST[tone][dir]} seed={seed} cells={cells} />
}

// ---------------------------------------------------------------------------
// Layout, per size. Every number is a pixel in the widget's own box. Nothing
// ever leaves the card: open is an accordion inside the same frame.

type Layout = {
  symbols: string[]
  hero: boolean
  header: boolean
  /** Rows' left edge and width. */
  x: number
  w: number
  /** Rest: first row's top, and each row's height. */
  top: number
  rowH: number
  /** Open: the expanded row's box, and the strips below it. */
  ey: number
  eh: number
  sy: number
  sh: number
  restSpark: { w: number; h: number }
  chart: { w: number; h: number }
}

const LAYOUT: Record<WidgetSize, Layout> = {
  small: {
    symbols: ["AAPL"],
    hero: true,
    header: false,
    x: 0,
    w: 170,
    top: 0,
    rowH: 170,
    ey: 0,
    eh: 170,
    sy: 0,
    sh: 0,
    restSpark: { w: 142, h: 52 },
    chart: { w: 146, h: 62 },
  },
  medium: {
    symbols: ["AAPL", "NVDA", "TSLA"],
    hero: false,
    header: true,
    x: 14,
    w: 336,
    top: 36,
    rowH: 42,
    ey: 8,
    eh: 114,
    sy: 124,
    sh: 18,
    restSpark: { w: 90, h: 28 },
    chart: { w: 336, h: 50 },
  },
  large: {
    symbols: ["AAPL", "NVDA", "MSFT", "TSLA", "AMZN", "BTC-USD"],
    hero: false,
    header: true,
    x: 14,
    w: 336,
    top: 40,
    rowH: 52,
    ey: 8,
    eh: 178,
    sy: 192,
    sh: 32,
    restSpark: { w: 120, h: 30 },
    chart: { w: 336, h: 104 },
  },
}

type RowBox = { y: number; h: number; e: number; c: number; strip: number }

/** Where every row sits, with `ex` expanded (or -1 for the native list). */
function boxes(L: Layout, ex: number): RowBox[] {
  if (L.hero) return [{ y: 0, h: 170, e: ex === 0 ? 1 : 0, c: 0, strip: -1 }]
  let k = 0
  return L.symbols.map((_, i) => {
    if (ex < 0) return { y: L.top + i * L.rowH, h: L.rowH, e: 0, c: 0, strip: -1 }
    if (i === ex) return { y: L.ey, h: L.eh, e: 1, c: 0, strip: -1 }
    const strip = k++
    return { y: L.sy + strip * L.sh, h: L.sh, e: 0, c: 1, strip }
  })
}

const TOP = "AAPL"
const SPRING = { k: 90, c: 13 }

/** A plausible session volume per symbol, fixed so server and client agree. */
function volume(symbol: string): string {
  const v = ((hashString(symbol + "vol") % 900) + 120) / 10
  return v.toFixed(1) + "M"
}

// ---------------------------------------------------------------------------
// One row: a native list row, a one-line strip, or the expanded chart.

type RowProps = {
  symbol: string
  i: number
  L: Layout
  box: RowBox
  hot: boolean
  live: boolean
  onPick: (i: number) => void
  onActivate: (symbol: string) => void
}

function Row({ symbol, i, L, box, hot, live, onPick, onActivate }: RowProps) {
  const t0 = INITIAL[symbol]
  const root = React.useRef<HTMLDivElement>(null)
  const rest = boxes(L, -1)[i]
  const y = useSpringVar(root, "--y", rest.y, SPRING.k, SPRING.c)
  const h = useSpringVar(root, "--h", rest.h, SPRING.k, SPRING.c)
  const e = useSpringVar(root, "--e", 0, SPRING.k, SPRING.c)
  const c = useSpringVar(root, "--c", 0, SPRING.k, SPRING.c)
  const hotS = useSpringVar(root, "--hot", 0, 200, 20)
  const tick = useSpringVar(root, "--tick", 0, 40, 14)
  const rolling = React.useRef(false)

  React.useEffect(() => {
    y(box.y)
    h(box.h)
    e(box.e)
    c(box.c)
  }, [box.y, box.h, box.e, box.c, y, h, e, c])
  React.useEffect(() => hotS(hot ? 1 : 0), [hot, hotS])

  // live numbers, written by ref; the end dot glows for a moment on each tick
  React.useEffect(() => {
    const el = root.current
    if (!el) return
    const write = () => {
      const t = market.get(symbol)
      el.setAttribute("data-dir", dirOf(t))
      if (!rolling.current) el.querySelectorAll("[data-f=price]").forEach((n) => (n.textContent = fmtPrice(last(t))))
      el.querySelectorAll("[data-f=pill]").forEach((n) => (n.textContent = fmtPct(pct(t))))
      el.querySelectorAll("[data-f=high]").forEach((n) => (n.textContent = fmtPrice(high(t))))
      el.querySelectorAll("[data-f=low]").forEach((n) => (n.textContent = fmtPrice(low(t))))
    }
    write()
    return onTick(() => {
      write()
      tick(undefined, { impulse: 14 })
    })
  }, [symbol, tick])

  // hover: the sparkline redraws left to right on a spring, and the price rolls up to its live value
  React.useEffect(() => {
    const el = root.current
    if (!hot || !el) return
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
    const prices = el.querySelectorAll(".st-rest [data-f=price]")
    const t = market.get(symbol)
    const from = t.series[t.series.length - 7]
    let p = 0
    let v = 0
    let lastT = 0
    let raf = 0
    const K = 42
    const C = 2 * Math.sqrt(K)
    rolling.current = true
    const frame = (now: number) => {
      const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0.016
      lastT = now
      v += (-K * (p - 1) - C * v) * dt
      p += v * dt
      const done = Math.abs(1 - p) < 0.002 && Math.abs(v) < 0.01
      if (done) p = 1
      el.style.setProperty("--replay", p.toFixed(4))
      const to = last(market.get(symbol))
      const shown = fmtPrice(from + (to - from) * Math.min(1, p * 1.6))
      prices.forEach((n) => (n.textContent = shown))
      if (!done) raf = requestAnimationFrame(frame)
      else rolling.current = false
    }
    el.style.setProperty("--replay", "0")
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      rolling.current = false
      el.style.setProperty("--replay", "1")
      const now = fmtPrice(last(market.get(symbol)))
      prices.forEach((n) => (n.textContent = now))
    }
  }, [hot, symbol])

  const pill = (
    <span className="st-pill go-mono" data-f="pill">
      {fmtPct(pct(t0))}
    </span>
  )
  const price = (cls: string) => (
    <span className={cls} data-f="price">
      {fmtPrice(last(t0))}
    </span>
  )
  const ohlv = (
    <div className="st-ohl go-mono">
      <span>
        <i>O</i>
        {fmtPrice(t0.open)}
      </span>
      <span>
        <i>H</i>
        <b data-f="high">{fmtPrice(high(t0))}</b>
      </span>
      <span>
        <i>L</i>
        <b data-f="low">{fmtPrice(low(t0))}</b>
      </span>
      <span>
        <i>Vol</i>
        {volume(symbol)}
      </span>
    </div>
  )
  return (
    <div
      ref={root}
      className={"st-q" + (live ? " go-live" : "")}
      data-symbol={symbol}
      data-i={i}
      data-dir={dirOf(t0)}
      data-strip={box.strip}
      onClick={
        live
          ? (ev) => {
              ev.stopPropagation()
              onPick(i)
            }
          : undefined
      }
      onDoubleClick={
        live
          ? (ev) => {
              ev.stopPropagation()
              onActivate(symbol)
            }
          : undefined
      }
      style={
        {
          left: L.x,
          width: L.w,
          "--y": rest.y,
          "--h": rest.h,
          "--e": 0,
          "--c": 0,
          "--hot": 0,
          "--tick": 0,
          "--replay": 1,
        } as React.CSSProperties
      }
    >
      {L.hero ? (
        <>
          <div className="st-face st-rest st-hero" style={{ width: 170, height: 170 }}>
            <span className="st-sym">{display(symbol)}</span>
            <span className="st-name">{t0.name}</span>
            <Spark source={symbol} w={L.restSpark.w} h={L.restSpark.h} className="st-replay st-hero-spark" />
            <div className="st-hero-foot">
              {price("st-hero-price")}
              {pill}
            </div>
          </div>
          <div className="st-face st-chart st-chart-hero" style={{ width: 170, height: 170 }}>
            <div className="st-chart-top">
              <span className="st-sym">{display(symbol)}</span>
              {pill}
            </div>
            {price("st-hero-price")}
            <Spark source={symbol} w={L.chart.w} h={L.chart.h} chart className="st-ink" />
            {ohlv}
          </div>
        </>
      ) : (
        <>
          <div className="st-face st-rest st-rowline" data-first={i === 0 || undefined} style={{ height: L.rowH }}>
            <div className="st-id">
              <span className="st-sym">{display(symbol)}</span>
              <span className="st-name">{t0.name}</span>
            </div>
            <Spark source={symbol} w={L.restSpark.w} h={L.restSpark.h} className="st-replay" />
            <div className="st-px">
              {price("st-price")}
              {pill}
            </div>
          </div>
          <div className="st-face st-strip">
            <span className="st-sym">{display(symbol)}</span>
            {price("st-price")}
            {pill}
          </div>
          <div className="st-face st-chart" style={{ height: L.eh }}>
            <div className="st-chart-head">
              <div className="st-id">
                <span className="st-sym">{display(symbol)}</span>
                <span className="st-name">{t0.name}</span>
              </div>
              <div className="st-px">
                {price("st-price")}
                {pill}
              </div>
            </div>
            <Spark source={symbol} w={L.chart.w} h={L.chart.h} chart className="st-ink" />
            {ohlv}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The widget

function Body({ size, onActivate }: { size: WidgetSize; onActivate: (symbol: string) => void }) {
  const L = LAYOUT[size]
  const { open, rootRef } = useGlass()
  const wrap = React.useRef<HTMLDivElement>(null)
  const liquid = React.useRef<LiquidHandle>(null)
  const [hot, setHot] = React.useState(-1)
  const [focus, setFocus] = React.useState(0)
  const openRef = React.useRef(open)
  React.useEffect(() => {
    openRef.current = open
  }, [open])

  const expand = useSpringVar(wrap, "--expand", 0, SPRING.k, SPRING.c)
  const band = useSpringVar(wrap, "--row-hl", L.top, 180, 18)
  const bandH = useSpringVar(wrap, "--row-hl-h", L.rowH, 180, 18)
  const bandO = useSpringVar(wrap, "--hl-o", 0, 160, 20)
  React.useEffect(() => expand(open ? 1 : 0), [open, expand])

  // which row is under the pointer; while closed it is also the one a click expands
  React.useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const move = (e: PointerEvent) => {
      let at = -1
      for (const q of el.querySelectorAll<HTMLElement>(".st-q[data-i]")) {
        const b = q.getBoundingClientRect()
        if (e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom) at = Number(q.dataset.i)
      }
      setHot(at)
      if (at >= 0 && !openRef.current) setFocus(at)
    }
    const leave = () => setHot(-1)
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerleave", leave)
    return () => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerleave", leave)
    }
  }, [rootRef])

  // the liquid stirs on every tick
  React.useEffect(() => onTick(() => liquid.current?.energy(1.7)), [])

  const ex = open ? (L.hero ? 0 : focus) : -1
  const bs = boxes(L, ex)

  // the highlight band follows the hovered row; not over the expanded chart
  const hb = hot >= 0 && !L.hero && hot !== ex ? bs[hot] : null
  React.useEffect(() => {
    if (!hb) {
      bandO(0)
      return
    }
    band(hb.y)
    bandH(hb.h)
    bandO(1)
  }, [hb?.y, hb?.h, hb, band, bandH, bandO])

  return (
    <div
      ref={wrap}
      className="st-m"
      style={{ "--expand": 0, "--row-hl": L.top, "--row-hl-h": L.rowH, "--hl-o": 0 } as React.CSSProperties}
    >
      <Liquid symbols={L.symbols} seed={size === "small" ? 3 : size === "medium" ? 6 : 9} cells={size === "small" ? 72 : 120} handle={liquid} />
      <GlassPane hinge="none" lean={0} openLean={0} frost={0.9} radius={22} className="st-pane">
        {L.header ? (
          <div className="st-head">
            <span className="st-title">Stocks</span>
            <span className="st-status">
              <i className="st-status-dot" />
              Markets open
            </span>
          </div>
        ) : null}
      </GlassPane>
      {L.hero ? null : <div className="st-band" style={{ left: L.x - 6, width: L.w + 12 }} aria-hidden="true" />}
      {L.symbols.map((s, i) => (
        <Row
          key={s}
          symbol={s}
          i={i}
          L={L}
          box={bs[i]}
          hot={hot === i && i !== ex}
          live={open && !L.hero && i !== ex}
          onPick={setFocus}
          onActivate={onActivate}
        />
      ))}
    </div>
  )
}

/** Remembers where the pointer is so Activate can open the row under it. */
function PointerPick({ pickRef }: { pickRef: React.RefObject<() => string> }) {
  const { rootRef } = useGlass()
  React.useEffect(() => {
    const el = rootRef.current
    if (!el) return
    let at: { x: number; y: number } | null = null
    const move = (e: PointerEvent) => {
      at = { x: e.clientX, y: e.clientY }
    }
    const leave = () => {
      at = null
    }
    pickRef.current = () => {
      if (!at) return TOP
      for (const q of el.querySelectorAll<HTMLElement>(".st-q[data-symbol]")) {
        const b = q.getBoundingClientRect()
        if (at.x >= b.left && at.x <= b.right && at.y >= b.top && at.y <= b.bottom) return q.dataset.symbol ?? TOP
      }
      return TOP
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerleave", leave)
    return () => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerleave", leave)
    }
  }, [rootRef, pickRef])
  return null
}

export function StocksWidget({ size = "small", className, appearDelay = 0 }: { size?: WidgetSize; className?: string; appearDelay?: number }) {
  const { open, tone } = useWindowManager()
  const { w, h } = WIDGET[size]
  const pick = React.useRef<() => string>(() => TOP)
  const label = "Stocks: " + LAYOUT[size].symbols.map(display).join(", ")
  const launch = React.useCallback(
    (symbol: string) => open("stocks", { singleton: "app", title: "Stocks", w: 820, h: 560, payload: { symbol } }),
    [open],
  )
  return (
    <GlassObject
      width={w}
      height={h}
      tone={tone}
      label={label}
      radius={22}
      tilt={2}
      overflow="hidden"
      appearDelay={appearDelay}
      className={"st-root st-" + size + (className ? " " + className : "")}
      onActivate={() => launch(pick.current())}
    >
      <style href="stocks-object" precedence="glass-widget">
        {ST_CSS}
      </style>
      <PointerPick pickRef={pick} />
      <Body size={size} onActivate={launch} />
    </GlassObject>
  )
}

const ST_CSS = `
.st-root { --st-up: #34c759; --st-down: #ff453a; }
.st-root .go-tilt { border-radius: 22px; }
.st-root .go-liquid { border-radius: 22px; }
.st-m { position: absolute; inset: 0; border-radius: 22px; overflow: hidden; }
.st-root .st-pane { box-shadow: 0 0 0 .5px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.6), 0 14px 30px -14px var(--go-shadow); }
.st-root[data-tone="dark"] .st-pane { box-shadow: 0 0 0 .5px rgba(255,255,255,.1), inset 0 1px 0 rgba(255,255,255,.1), 0 14px 30px -14px var(--go-shadow); }

/* header, on the pane; it makes way for the chart */
.st-head {
  position: absolute; left: 16px; right: 16px; top: 12px; display: flex; align-items: baseline; gap: 8px;
  opacity: clamp(0, 1 - var(--expand) * 2, 1);
}
.st-title { font-size: 13px; font-weight: 600; letter-spacing: -.01em; }
.st-status { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: var(--go-ink-soft); }
.st-status-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--st-up); box-shadow: 0 0 0 2px color-mix(in srgb, var(--st-up) 22%, transparent); }

/* the hover band: a soft brightening that slides from row to row */
.st-band {
  position: absolute; top: 0; border-radius: 10px; pointer-events: none;
  transform: translateY(calc(var(--row-hl) * 1px));
  height: calc(var(--row-hl-h) * 1px);
  opacity: clamp(0, var(--hl-o), 1);
  background: linear-gradient(180deg, rgba(255,255,255,.75), rgba(255,255,255,.5));
  box-shadow: inset 0 0 0 .5px rgba(255,255,255,.9), 0 1px 3px rgba(0,0,0,.05);
}
.st-root[data-tone="dark"] .st-band { background: rgba(255,255,255,.07); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.1); }

/* a row: its top and height ride springs; the card itself never changes */
.st-q {
  position: absolute; top: 0; overflow: hidden;
  transform: translateY(calc(var(--y) * 1px));
  height: calc(var(--h) * 1px);
  color: var(--go-ink);
}
.st-q.go-live { cursor: pointer; }
.st-q[data-dir="up"] { --st-c: var(--st-up); }
.st-q[data-dir="down"] { --st-c: var(--st-down); }
.st-face { position: absolute; left: 0; top: 0; right: 0; box-sizing: border-box; }
.st-rest { opacity: clamp(0, 1 - (var(--e) + var(--c)) * 2.5, 1); }
.st-chart { opacity: clamp(0, (var(--e) - .35) * 2, 1); }
.st-strip { opacity: clamp(0, (var(--c) - .4) * 2.5, 1); }

/* type */
.st-sym { font-size: 13px; font-weight: 600; letter-spacing: -.01em; line-height: 16px; white-space: nowrap; }
.st-name { font-size: 11px; line-height: 14px; color: var(--go-ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.st-price { font-size: 13px; font-weight: 600; line-height: 16px; font-variant-numeric: tabular-nums; letter-spacing: -.01em; white-space: nowrap; }
.st-pill {
  display: inline-block; box-sizing: border-box; min-width: 54px; padding: 2px 5px; border-radius: 4px;
  font-size: 11px; line-height: 13px; font-weight: 600; letter-spacing: 0; text-align: right;
  color: #fff; background: var(--st-c); font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* the native row; it shrinks toward a strip as it compresses */
.st-rowline { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; column-gap: 10px; border-top: .5px solid var(--go-ink-faint); }
.st-rowline[data-first] { border-top-color: transparent; }
.st-rowline .st-sym { font-size: calc(13px - var(--c) * 2px); }
.st-rowline .st-price { font-size: calc(13px - var(--c) * 2px); }
.st-id { display: flex; flex-direction: column; min-width: 0; }
.st-px { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }

/* small: the hero quote */
.st-hero { display: flex; flex-direction: column; padding: 14px 14px 13px; }
.st-hero .st-name { margin-top: 1px; }
.st-hero-spark { margin: auto -2px; }
.st-hero-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.st-hero-price { font-size: 24px; line-height: 28px; font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.st-hero .st-pill, .st-chart-hero .st-pill { min-width: 0; }

/* a compressed one-line strip */
.st-strip { height: 100%; display: flex; align-items: center; gap: 8px; border-top: .5px solid var(--go-ink-faint); padding: 0 2px; }
.st-q[data-strip="0"] .st-strip { border-top-color: transparent; }
.st-strip .st-sym { font-size: 11px; line-height: 13px; width: 44px; }
.st-strip .st-price { font-size: 11px; line-height: 13px; margin-left: auto; }
.st-strip .st-pill { font-size: 10px; line-height: 12px; padding: 1px 4px; min-width: 50px; }
.st-large .st-strip .st-sym, .st-large .st-strip .st-price { font-size: 11px; }

/* the sparkline */
.st-spark { display: block; overflow: visible; flex: none; color: var(--st-c); }
.st-spark .st-line { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
.st-base { stroke: var(--go-ink-faint); stroke-width: 1; stroke-dasharray: 1.5 2.5; }
.st-grid { stroke: var(--go-ink-faint); stroke-width: .5; }
.st-prev { stroke: var(--go-ink-soft); stroke-width: .75; stroke-dasharray: 2 3; opacity: .7; }
.st-dot { fill: currentColor; stroke: rgba(255,255,255,.9); stroke-width: 1; }
.st-root[data-tone="dark"] .st-dot { stroke: rgba(30,30,32,.9); }
.st-halo { fill: currentColor; opacity: clamp(0, max(var(--hot) * .35, var(--tick) * .45), .5); transform-box: fill-box; transform-origin: center; transform: scale(calc(.5 + var(--hot) * .5 + var(--tick) * .6)); }
/* hover: the line redraws from the left */
.st-replay .st-line { stroke-dasharray: 1 1.01; stroke-linecap: butt; stroke-dashoffset: clamp(0, 1 - var(--replay), 1); }
.st-replay .st-area { opacity: clamp(0, var(--replay) * 1.4 - .4, 1); }
/* open: the chart's stroke inks itself in as the row expands */
.st-ink .st-line { stroke-dasharray: 1 1.01; stroke-linecap: butt; stroke-dashoffset: clamp(0, 1 - (var(--e) - .25) * 1.4, 1); }
.st-ink .st-area { opacity: clamp(0, (var(--e) - .6) * 2.5, 1); }
.st-ink .st-dot { opacity: clamp(0, (var(--e) - .85) * 6, 1); }

/* the expanded chart */
.st-chart { display: flex; flex-direction: column; gap: 4px; padding: 2px 0 2px; }
.st-chart-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.st-chart .st-spark { margin: auto 0; }
.st-ohl { display: flex; gap: 12px; font-size: 10px; line-height: 12px; color: var(--go-ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
.st-ohl i { font-style: normal; color: var(--go-ink-soft); margin-right: 4px; }
.st-ohl b { font-weight: 500; }
.st-large .st-chart { padding-top: 4px; gap: 6px; }
.st-chart-hero { padding: 13px 12px 11px; gap: 0; }
.st-chart-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.st-chart-hero .st-hero-price { margin-top: 2px; }
.st-chart-hero .st-ohl { display: grid; grid-template-columns: auto auto; justify-content: space-between; row-gap: 2px; column-gap: 8px; }
.st-chart-hero .st-ohl i { margin-right: 3px; }
`
