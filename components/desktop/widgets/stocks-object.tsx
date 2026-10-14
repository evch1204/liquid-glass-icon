"use client"

import * as React from "react"
import { GlassObject, GlassPane, GlassSheet, LIQUIDS, LiquidCanvas, useGlass, useSpringVar, type LiquidHandle, type LiquidRecipe } from "@/components/ui/glass-object"
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
 * - **Hover**: the pane leans back and the object lifts; the quotes lift off
 *   the pane in a stagger with spreading shadows, the one under the pointer a
 *   little more, its sparkline tip glowing.
 * - **Open** (click): the pane hinges down and away like the folder's front;
 *   the quotes rise out as cards and fan, and the one under the pointer (or
 *   the first) opens into a chart: gridlines, the previous close, a stroke
 *   that inks itself in, and Open / High / Low.
 * - **Activate** (double-click, Enter): the Stocks app on the quote under the
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
// Layout, per size. Every number is a pixel in the widget's own box.

type Box = { x: number; y: number; w: number; h: number }
/** Where an open card goes, and how far it turns as it fans. */
type Slot = Box & { rot: number }
type Layout = {
  symbols: string[]
  header: boolean
  /** Rest boxes for the quotes; `hidden` ones wait behind the pane until it opens. */
  rest: (Box & { hidden?: boolean })[]
  /** Open slots: the first is the chart, the rest are cards. */
  slots: Slot[]
  restFace: "hero" | "line"
  cardFace: "card" | "mini"
  index?: { rest: Box; open: Slot; card: boolean; spark: { w: number; h: number } }
  /** Pixels between the lifts of neighbouring quotes on hover. */
  liftStep: number
  chart: { w: number; h: number }
  restSpark: { w: number; h: number }
  cardSpark: { w: number; h: number }
}

const LAYOUT: Record<WidgetSize, Layout> = {
  small: {
    symbols: ["AAPL", "NVDA", "TSLA"],
    header: false,
    rest: [
      { x: 0, y: 0, w: 170, h: 170 },
      { x: 40, y: 64, w: 90, h: 44, hidden: true },
      { x: 40, y: 64, w: 90, h: 44, hidden: true },
    ],
    slots: [
      { x: 8, y: 8, w: 154, h: 114, rot: 0 },
      { x: 8, y: 126, w: 154, h: 18, rot: -0.8 },
      { x: 8, y: 147, w: 154, h: 18, rot: 0.6 },
    ],
    restFace: "hero",
    cardFace: "mini",
    liftStep: 2,
    chart: { w: 138, h: 50 },
    restSpark: { w: 142, h: 52 },
    cardSpark: { w: 0, h: 0 },
  },
  medium: {
    symbols: ["AAPL", "NVDA", "TSLA"],
    header: true,
    rest: [0, 1, 2].map((i) => ({ x: 14, y: 36 + i * 42, w: 336, h: 42 })),
    slots: [
      { x: 10, y: 8, w: 206, h: 128, rot: 0 },
      { x: 222, y: 8, w: 132, h: 60, rot: 1.4 },
      { x: 222, y: 74, w: 132, h: 60, rot: -1.2 },
    ],
    restFace: "line",
    cardFace: "card",
    index: { rest: { x: 14, y: 150, w: 336, h: 16 }, open: { x: 14, y: 142, w: 336, h: 22, rot: 0 }, card: false, spark: { w: 150, h: 16 } },
    liftStep: 2,
    chart: { w: 190, h: 56 },
    restSpark: { w: 90, h: 28 },
    cardSpark: { w: 52, h: 18 },
  },
  large: {
    symbols: ["AAPL", "NVDA", "MSFT", "TSLA", "AMZN", "BTC-USD"],
    header: true,
    rest: [0, 1, 2, 3, 4, 5].map((i) => ({ x: 14, y: 40 + i * 52, w: 336, h: 52 })),
    slots: [
      { x: 10, y: 10, w: 344, h: 160, rot: 0 },
      { x: 10, y: 178, w: 168, h: 54, rot: -0.8 },
      { x: 186, y: 178, w: 168, h: 54, rot: 0.8 },
      { x: 10, y: 238, w: 168, h: 54, rot: 0.6 },
      { x: 186, y: 238, w: 168, h: 54, rot: -0.6 },
      { x: 10, y: 298, w: 168, h: 54, rot: -0.5 },
    ],
    restFace: "line",
    cardFace: "card",
    index: { rest: { x: 186, y: 330, w: 168, h: 20 }, open: { x: 186, y: 298, w: 168, h: 54, rot: 0.5 }, card: true, spark: { w: 148, h: 20 } },
    liftStep: 1.5,
    chart: { w: 324, h: 86 },
    restSpark: { w: 120, h: 30 },
    cardSpark: { w: 70, h: 20 },
  },
}

const TOP = "AAPL"

// ---------------------------------------------------------------------------
// One quote: printed on the pane at rest, a glass card when open.

type QuoteProps = {
  symbol: string
  /** Index at rest, top first: sets the hover stagger. */
  i: number
  /** Index among the open cards: sets the open stagger; 0 is the chart. */
  order: number
  count: number
  rest: Box & { hidden?: boolean }
  slot: Slot
  L: Layout
  up: boolean
  open: boolean
  hot: boolean
}

function Quote({ symbol, i, order, count, rest, slot, L, up, open, hot }: QuoteProps) {
  const t0 = INITIAL[symbol]
  const root = React.useRef<HTMLDivElement>(null)
  const o = useSpringVar(root, "--o", 0, 160, 15)
  const h = useSpringVar(root, "--h", 0, 140, 14)
  const hotS = useSpringVar(root, "--hot", 0, 220, 20)
  const tick = useSpringVar(root, "--tick", 0, 40, 14)
  const chart = order === 0

  // live numbers, written by ref; the end dot glows for a moment on each tick
  React.useEffect(() => {
    const el = root.current
    if (!el) return
    const write = () => {
      const t = market.get(symbol)
      el.setAttribute("data-dir", dirOf(t))
      el.querySelectorAll("[data-f=price]").forEach((n) => (n.textContent = fmtPrice(last(t))))
      el.querySelectorAll("[data-f=pill]").forEach((n) => (n.textContent = fmtPct(pct(t))))
      el.querySelectorAll("[data-f=high]").forEach((n) => (n.textContent = fmtPrice(high(t))))
      el.querySelectorAll("[data-f=low]").forEach((n) => (n.textContent = fmtPrice(low(t))))
    }
    write()
    return onTick(() => {
      write()
      tick(undefined, { impulse: 14 })
    })
  }, [symbol, chart, tick])

  // hover: lift off the pane, top row first
  const hoverTimer = React.useRef(0)
  React.useEffect(() => {
    window.clearTimeout(hoverTimer.current)
    const lift = up && !open && !rest.hidden
    hoverTimer.current = window.setTimeout(() => h(lift ? 1 : 0), lift ? i * 40 : (count - 1 - i) * 25)
  }, [up, open, i, count, rest.hidden, h])
  React.useEffect(() => hotS(hot ? 1 : 0), [hot, hotS])

  // open: rise out as a card, one after another; close in reverse
  const openTimer = React.useRef(0)
  const mounted = React.useRef(false)
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      if (!open) return
    }
    window.clearTimeout(openTimer.current)
    openTimer.current = window.setTimeout(() => o(open ? 1 : 0), open ? 60 + order * 70 : (count - 1 - order) * 50)
  }, [open, order, count, o])
  React.useEffect(
    () => () => {
      window.clearTimeout(openTimer.current)
      window.clearTimeout(hoverTimer.current)
    },
    [],
  )

  const lift = rest.hidden ? 0 : L.liftStep + (count - 1 - i) * L.liftStep
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
  const card = L.cardFace
  return (
    <div
      ref={root}
      className="st-q"
      data-symbol={symbol}
      data-i={i}
      data-hidden={rest.hidden || undefined}
      data-dir={dirOf(t0)}
      data-hot={hot || undefined}
      style={
        {
          "--o": 0,
          "--h": 0,
          "--hot": 0,
          "--tick": 0,
          "--x0": rest.x,
          "--y0": rest.y,
          "--w0": rest.w,
          "--h0": rest.h,
          "--x1": slot.x,
          "--y1": slot.y,
          "--w1": slot.w,
          "--h1": slot.h,
          "--rot": slot.rot,
          "--op0": rest.hidden ? 0 : 1,
          "--lift": lift,
          zIndex: chart ? 30 : 20 + order,
        } as React.CSSProperties
      }
    >
      <GlassSheet className="st-sheet" />

      {/* at rest: printed on the pane */}
      {rest.hidden ? null : L.restFace === "hero" ? (
        <div className="st-face st-rest st-hero" style={{ width: rest.w, height: rest.h }}>
          <span className="st-sym">{display(symbol)}</span>
          <span className="st-name">{t0.name}</span>
          <Spark source={symbol} w={L.restSpark.w} h={L.restSpark.h} className="st-hero-spark" />
          <div className="st-hero-foot">
            {price("st-hero-price")}
            {pill}
          </div>
        </div>
      ) : (
        <div className="st-face st-rest st-rowline" data-first={i === 0 || undefined} style={{ width: rest.w, height: rest.h }}>
          <div className="st-id">
            <span className="st-sym">{display(symbol)}</span>
            <span className="st-name">{t0.name}</span>
          </div>
          <Spark source={symbol} w={L.restSpark.w} h={L.restSpark.h} />
          <div className="st-px">
            {price("st-price")}
            {pill}
          </div>
        </div>
      )}

      {/* open: a chart, or a card */}
      {chart ? (
        <div className="st-face st-open st-chart" style={{ width: slot.w, height: slot.h }}>
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
          </div>
        </div>
      ) : (
        <div className={"st-face st-open st-" + card} style={{ width: slot.w, height: slot.h }}>
          <div className="st-card-top">
            <span className="st-sym">{display(symbol)}</span>
            {pill}
          </div>
          <div className="st-card-foot">
            {price("st-price")}
            {card === "card" ? <Spark source={symbol} w={L.cardSpark.w} h={L.cardSpark.h} className="st-ink" /> : null}
          </div>
        </div>
      )}
    </div>
  )
}

/** The Desk Index: a line that prints along the bottom (medium) or a card of its own (large). */
function IndexQuote({ L, open, order }: { L: Layout; open: boolean; order: number }) {
  const ix = L.index!
  const key = L.symbols.join(",")
  const t0 = composite(initialGet, L.symbols)
  const root = React.useRef<HTMLDivElement>(null)
  const o = useSpringVar(root, "--o", 0, 160, 15)
  React.useEffect(() => {
    const el = root.current
    if (!el) return
    return market.subscribe(() => {
      const t = composite(market.get, key.split(","))
      el.setAttribute("data-dir", dirOf(t))
      el.querySelectorAll("[data-f=value]").forEach((n) => (n.textContent = last(t).toFixed(2)))
      el.querySelectorAll("[data-f=change]").forEach((n) => (n.textContent = fmtPct(pct(t))))
    })
  }, [key])
  const timer = React.useRef(0)
  const mounted = React.useRef(false)
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      if (!open) return
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => o(open ? 1 : 0), open ? 60 + order * 70 : 0)
  }, [open, order, o])
  React.useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <div
      ref={root}
      className={"st-q st-index" + (ix.card ? " st-index-card" : " st-index-strip")}
      data-dir={dirOf(t0)}
      style={
        {
          "--o": 0,
          "--h": 0,
          "--hot": 0,
          "--tick": 0,
          "--x0": ix.rest.x,
          "--y0": ix.rest.y,
          "--w0": ix.rest.w,
          "--h0": ix.rest.h,
          "--x1": ix.open.x,
          "--y1": ix.open.y,
          "--w1": ix.open.w,
          "--h1": ix.open.h,
          "--rot": ix.open.rot,
          "--op0": 0,
          "--lift": 0,
          zIndex: 20 + order,
        } as React.CSSProperties
      }
    >
      {ix.card ? <GlassSheet className="st-sheet" /> : null}
      <div className="st-face st-open st-index-face" style={{ width: ix.open.w, height: ix.open.h }}>
        <div className="st-index-text go-mono">
          <span className="st-index-name">Desk Index</span>
          <b data-f="value">{last(t0).toFixed(2)}</b>
          <b data-f="change" className="st-index-change">
            {fmtPct(pct(t0))}
          </b>
        </div>
        <Spark source={"index:" + key} w={ix.spark.w} h={ix.spark.h} className="st-ink" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The widget

function Body({ size }: { size: WidgetSize }) {
  const L = LAYOUT[size]
  const { hover, focused, open, rootRef } = useGlass()
  const up = hover || focused
  const liquid = React.useRef<LiquidHandle>(null)
  const [hot, setHot] = React.useState(-1)
  const [focus, setFocus] = React.useState(0)
  const openRef = React.useRef(open)
  React.useEffect(() => {
    openRef.current = open
  }, [open])

  // which quote is under the pointer; the one that opens into the chart is frozen at the click
  React.useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const move = (e: PointerEvent) => {
      let at = -1
      for (const q of el.querySelectorAll<HTMLElement>(".st-q[data-symbol]:not([data-hidden])")) {
        const b = q.getBoundingClientRect()
        if (e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom) at = Number(q.dataset.i)
      }
      if (openRef.current) return
      setHot(at)
      if (at >= 0) setFocus(at)
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

  const n = L.symbols.length
  const order = [focus, ...L.symbols.map((_, i) => i).filter((i) => i !== focus)]
  const visible = L.rest.filter((r) => !r.hidden).length
  return (
    <>
      <Liquid symbols={L.symbols} seed={size === "small" ? 3 : size === "medium" ? 6 : 9} cells={size === "small" ? 48 : 80} handle={liquid} />
      <GlassPane hinge="bottom" lean={-9} openLean={-70} openShift={14} openFade={0.8} frost={0.9} radius={22} className="st-pane">
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
      {L.symbols.map((s, i) => {
        const k = order.indexOf(i)
        return (
          <Quote
            key={s}
            symbol={s}
            i={i}
            order={k}
            count={L.rest[i].hidden ? n : visible}
            rest={L.rest[i]}
            slot={L.slots[k]}
            L={L}
            up={up}
            open={open}
            hot={!open && hot === i}
          />
        )
      })}
      {L.index ? <IndexQuote L={L} open={open} order={n} /> : null}
    </>
  )
}

/** Remembers where the pointer is so Activate can open the quote under it. */
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
      const qs = Array.from(el.querySelectorAll<HTMLElement>(".st-q[data-symbol]:not([data-hidden])"))
      if (el.hasAttribute("data-open")) qs.push(...Array.from(el.querySelectorAll<HTMLElement>(".st-q[data-hidden]")))
      for (const q of qs) {
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
  return (
    <GlassObject
      width={w}
      height={h}
      tone={tone}
      label={label}
      radius={22}
      tilt={size === "large" ? 4 : 5}
      appearDelay={appearDelay}
      className={"st-root st-" + size + (className ? " " + className : "")}
      onActivate={() => open("stocks", { singleton: "app", title: "Stocks", w: 820, h: 560, payload: { symbol: pick.current() } })}
    >
      <style href="stocks-object" precedence="glass-widget">
        {ST_CSS}
      </style>
      <PointerPick pickRef={pick} />
      <Body size={size} />
    </GlassObject>
  )
}

const ST_CSS = `
.st-root { --st-up: #34c759; --st-down: #ff453a; }
.st-root .go-tilt { border-radius: 22px; }
.st-root .go-liquid { border-radius: 22px; }
.st-root .st-pane { box-shadow: 0 0 0 .5px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.6), 0 14px 30px -14px var(--go-shadow); }
.st-root[data-tone="dark"] .st-pane { box-shadow: 0 0 0 .5px rgba(255,255,255,.1), inset 0 1px 0 rgba(255,255,255,.1), 0 14px 30px -14px var(--go-shadow); }

/* header, on the pane */
.st-head { position: absolute; left: 16px; right: 16px; top: 12px; display: flex; align-items: baseline; gap: 8px; }
.st-title { font-size: 13px; font-weight: 600; letter-spacing: -.01em; }
.st-status { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: var(--go-ink-soft); }
.st-status-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--st-up); box-shadow: 0 0 0 2px color-mix(in srgb, var(--st-up) 22%, transparent); }

/* a quote: rest box -> open slot along its own spring --o */
.st-q {
  position: absolute; left: 0; top: 0;
  transform:
    translate(
      calc((var(--x0) + (var(--x1) - var(--x0)) * var(--o)) * 1px),
      calc((var(--y0) + (var(--y1) - var(--y0)) * var(--o)) * 1px - var(--h) * var(--lift) * 1px - var(--hot) * (1 - var(--o)) * 2px))
    rotate(calc(var(--rot) * var(--o) * 1deg));
  width: calc((var(--w0) + (var(--w1) - var(--w0)) * var(--o)) * 1px);
  height: calc((var(--h0) + (var(--h1) - var(--h0)) * var(--o)) * 1px);
  opacity: clamp(0, var(--op0) + var(--o) * 3, 1);
  color: var(--go-ink);
}
.st-q[data-dir="up"] { --st-c: var(--st-up); }
.st-q[data-dir="down"] { --st-c: var(--st-down); }
.st-root .st-sheet { position: absolute; inset: 0; border-radius: 14px; opacity: clamp(0, var(--o) * 3, 1); }
.st-small .st-sheet { border-radius: 12px; }
.st-face { position: absolute; left: 0; top: 0; box-sizing: border-box; }
.st-rest {
  opacity: clamp(0, 1 - var(--o) * 2.5, 1);
  filter: drop-shadow(0 calc(var(--h) * 2px + var(--hot) * 2px) calc(var(--h) * 4px + var(--hot) * 3px) rgba(0,0,0,calc(var(--h) * .12 + var(--hot) * .06)));
}
.st-open { opacity: clamp(0, (var(--o) - .3) * 2, 1); }

/* type */
.st-sym { font-size: 13px; font-weight: 600; letter-spacing: -.01em; line-height: 16px; white-space: nowrap; }
.st-name { font-size: 11px; line-height: 14px; color: var(--go-ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.st-price { font-size: 13px; font-weight: 600; line-height: 16px; font-variant-numeric: tabular-nums; letter-spacing: -.01em; white-space: nowrap; }
.st-pill {
  display: inline-block; box-sizing: border-box; min-width: 54px; padding: 2px 5px; border-radius: 4px;
  font-size: 11px; line-height: 13px; font-weight: 600; letter-spacing: 0; text-align: right;
  color: #fff; background: var(--st-c); font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* small: the hero quote */
.st-hero { display: flex; flex-direction: column; padding: 14px 14px 13px; }
.st-hero .st-name { margin-top: 1px; }
.st-hero-spark { margin: auto -2px; }
.st-hero-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.st-hero-price { font-size: 24px; line-height: 28px; font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.st-hero .st-pill { min-width: 0; }

/* medium, large: a row */
.st-rowline { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; column-gap: 10px; border-top: .5px solid var(--go-ink-faint); }
.st-rowline[data-first] { border-top-color: transparent; }
.st-id { display: flex; flex-direction: column; min-width: 0; }
.st-px { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }

/* the sparkline */
.st-spark { display: block; overflow: visible; flex: none; color: var(--st-c); }
.st-spark .st-line { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
.st-base { stroke: var(--go-ink-faint); stroke-width: 1; stroke-dasharray: 1.5 2.5; }
.st-grid { stroke: var(--go-ink-faint); stroke-width: .5; }
.st-prev { stroke: var(--go-ink-soft); stroke-width: .75; stroke-dasharray: 2 3; opacity: .7; }
.st-dot { fill: currentColor; stroke: rgba(255,255,255,.9); stroke-width: 1; }
.st-root[data-tone="dark"] .st-dot { stroke: rgba(30,30,32,.9); }
.st-halo { fill: currentColor; opacity: clamp(0, max(var(--hot) * .35, var(--tick) * .45), .5); transform-box: fill-box; transform-origin: center; transform: scale(calc(.5 + var(--hot) * .5 + var(--tick) * .6)); }
/* open: the stroke inks itself in */
.st-ink .st-line { stroke-dasharray: 1 1.01; stroke-linecap: butt; stroke-dashoffset: clamp(0, 1 - (var(--o) - .25) * 1.4, 1); }
.st-ink .st-area { opacity: clamp(0, (var(--o) - .6) * 2.5, 1); }
.st-ink .st-dot, .st-ink .st-halo { opacity: clamp(0, (var(--o) - .85) * 6, 1); }

/* open: the chart */
.st-chart { display: flex; flex-direction: column; padding: 10px 8px 8px; gap: 4px; }
.st-chart-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; padding: 0 4px; }
.st-chart .st-spark { margin: auto 0; }
.st-ohl { display: flex; gap: 10px; font-size: 10px; line-height: 12px; padding: 0 4px; color: var(--go-ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
.st-ohl i { font-style: normal; color: var(--go-ink-soft); margin-right: 4px; }
.st-ohl b { font-weight: 500; }
.st-small .st-chart { padding: 9px 8px 7px; }
.st-small .st-chart .st-name { display: none; }
.st-small .st-chart .st-ohl { gap: 6px; letter-spacing: 0; }
.st-small .st-chart .st-ohl i { margin-right: 2px; }
.st-large .st-chart { padding: 12px 10px 10px; }

/* open: a card */
.st-card, .st-mini { display: flex; flex-direction: column; justify-content: space-between; padding: 8px 10px; }
.st-card-top, .st-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.st-card .st-pill { min-width: 0; }
.st-mini { flex-direction: row; align-items: center; padding: 0 3px 0 8px; gap: 6px; }
.st-mini .st-card-top, .st-mini .st-card-foot { display: contents; }
.st-mini .st-sym { font-size: 11px; line-height: 13px; order: 0; }
.st-mini .st-price { font-size: 11px; line-height: 13px; order: 1; margin-left: auto; }
.st-mini .st-pill { order: 2; min-width: 48px; font-size: 10px; line-height: 12px; padding: 0 4px; }
.st-small .st-q:not([data-i="0"]) .st-sheet { border-radius: 6px; }

/* the Desk Index */
.st-index-face { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 2px; }
.st-index-card .st-index-face { flex-direction: column; align-items: stretch; justify-content: space-between; padding: 8px 10px; gap: 2px; }
.st-index-text { display: flex; align-items: baseline; gap: 6px; font-size: 10px; line-height: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.st-index-name { color: var(--go-ink-soft); margin-right: auto; }
.st-index-strip .st-index-name { margin-right: 0; }
.st-index-change { color: var(--st-c); }
.st-index .st-spark .st-area { display: none; }
`
