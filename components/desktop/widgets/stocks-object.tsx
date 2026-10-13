"use client"

import * as React from "react"
import { GlassObject, GlassPane, GlassSheet, LIQUIDS, LiquidCanvas, useGlass, type LiquidRecipe } from "@/components/ui/glass-object"
import { hashString, rng } from "@/components/ui/glass-folder-cards"
import { WIDGET, type WidgetSize } from "../glass"
import { useWindowManager } from "../window-manager"

/**
 * Stocks — a ticker you can pick up, drawn as an object.
 *
 * Three layers: a milk liquid at the back with a faint green or red cast that
 * follows the market, the tickers as real white cards (symbol, name, price, a
 * change pill and a live sparkline whose path is rewritten by ref on every
 * tick), and a frosted pane along the bottom carrying "Stocks" and the top
 * ticker's price.
 *
 * - **Rest**: the cards sit stacked in a pocket behind the pane, only their
 *   top edges (symbol and pill) showing, like files in the folder.
 * - **Hover**: the pane leans, the stack lifts a little; the lines keep ticking.
 * - **Open** (click): the pane folds down and away; the cards rise out of the
 *   pocket and fan across, each fully readable, the newest tick glowing.
 * - **Activate** (double-click, Enter): the Stocks app, on the card under the
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

const last = (t: Ticker) => t.series[t.series.length - 1]
const pct = (t: Ticker) => ((last(t) - t.open) / t.open) * 100

/** A composite of the given tickers, each normalised to its open, based at 1000. */
function composite(get: (s: string) => Ticker, symbols: string[]): Ticker {
  const series = new Array<number>(POINTS).fill(0)
  for (const s of symbols) {
    const t = get(s)
    for (let i = 0; i < POINTS; i++) series[i] += (t.series[i] / t.open) * (1000 / symbols.length)
  }
  return { symbol: "INDEX", name: "Desk Index", open: 1000, series, sigma: 0, drift: 0 }
}

// ---------------------------------------------------------------------------
// Formatting, locale-free so server and client agree.

function fmtPrice(n: number): string {
  const s = n >= 10000 ? Math.round(n).toString() : n.toFixed(2)
  const [i, d] = s.split(".")
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (d ? "." + d : "")
}

function fmtPct(p: number, digits: number): string {
  return (p >= 0 ? "+" : "−") + Math.abs(p).toFixed(digits) + "%"
}

const display = (symbol: string) => symbol.replace("-USD", "")

/** Sparkline geometry, rounded to a tenth so server and browser agree. */
function geom(series: number[], open: number, w: number, h: number) {
  const pad = 3
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
// A sparkline whose path is rewritten by ref; it never re-renders.

// `source` is a symbol, or "index:" plus a comma list for the composite.

function resolve(source: string, get: (s: string) => Ticker): Ticker {
  return source.startsWith("index:") ? composite(get, source.slice(6).split(",")) : get(source)
}

function Spark({ source, w, h, className }: { source: string; w: number; h: number; className?: string }) {
  const line = React.useRef<SVGPathElement>(null)
  const area = React.useRef<SVGPathElement>(null)
  const base = React.useRef<SVGLineElement>(null)
  const dot = React.useRef<SVGCircleElement>(null)
  const halo = React.useRef<SVGCircleElement>(null)
  React.useEffect(
    () =>
      market.subscribe(() => {
        const t = resolve(source, market.get)
        const g = geom(t.series, t.open, w, h)
        line.current?.setAttribute("d", g.line)
        area.current?.setAttribute("d", g.area)
        base.current?.setAttribute("y1", String(g.base))
        base.current?.setAttribute("y2", String(g.base))
        for (const c of [dot.current, halo.current]) {
          c?.setAttribute("cx", String(g.x))
          c?.setAttribute("cy", String(g.y))
        }
      }),
    [source, w, h],
  )
  const t0 = resolve(source, (s) => INITIAL[s])
  const g = geom(t0.series, t0.open, w, h)
  return (
    <svg viewBox={"0 0 " + w + " " + h} width={w} height={h} className={"st-spark" + (className ? " " + className : "")} aria-hidden="true">
      <line ref={base} x1="0" x2={w} y1={g.base} y2={g.base} className="st-base" />
      <path ref={area} d={g.area} className="st-area" />
      <path ref={line} d={g.line} className="st-line" />
      <circle ref={halo} cx={g.x} cy={g.y} r="5.5" className="st-halo" />
      <circle ref={dot} cx={g.x} cy={g.y} r="2" className="st-dot" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// A ticker card

type Place = { rx: number; ry: number; ox: number; oy: number; rot: number; rest?: number; z: number }

type CardLayout = { kind: "row" | "column"; w: number; h: number; sw: number; sh: number; digits: number }

const LAYOUT: Record<WidgetSize, CardLayout> = {
  small: { kind: "row", w: 146, h: 58, sw: 64, sh: 26, digits: 2 },
  medium: { kind: "column", w: 78, h: 128, sw: 64, sh: 40, digits: 1 },
  large: { kind: "column", w: 108, h: 156, sw: 92, sh: 56, digits: 2 },
}

function Card({ symbol, layout, place }: { symbol: string; layout: CardLayout; place: Place }) {
  const t0 = INITIAL[symbol]
  const root = React.useRef<HTMLDivElement>(null)
  const price = React.useRef<HTMLSpanElement>(null)
  const pill = React.useRef<HTMLSpanElement>(null)
  const { sw, sh, digits } = layout
  React.useEffect(
    () =>
      market.subscribe(() => {
        const t = market.get(symbol)
        const p = pct(t)
        root.current?.setAttribute("data-dir", p >= 0 ? "up" : "down")
        if (price.current) price.current.textContent = fmtPrice(last(t))
        if (pill.current) pill.current.textContent = fmtPct(p, digits)
      }),
    [symbol, digits],
  )
  const p0 = pct(t0)
  return (
    <GlassSheet
      className={"st-card st-card-" + layout.kind}
      style={
        {
          width: layout.w,
          height: layout.h,
          zIndex: place.z,
          "--rx": place.rx,
          "--ry": place.ry,
          "--ox": place.ox,
          "--oy": place.oy,
          "--rot": place.rot,
          "--rest": place.rest ?? 0,
          "--z": place.z,
        } as React.CSSProperties
      }
    >
      <div ref={root} className="st-card-in" data-symbol={symbol} data-dir={p0 >= 0 ? "up" : "down"}>
        <div className="st-head">
          <span className="st-sym">{display(symbol)}</span>
          <span ref={pill} className="st-pill go-mono">
            {fmtPct(p0, digits)}
          </span>
        </div>
        <div className="st-foot">
          <div className="st-meta">
            <span className="st-name">{t0.name}</span>
            <span ref={price} className="st-price">
              {fmtPrice(last(t0))}
            </span>
          </div>
          <Spark source={symbol} w={sw} h={sh} />
        </div>
      </div>
    </GlassSheet>
  )
}

// ---------------------------------------------------------------------------
// Pane readouts

/** The top ticker's price and change, written by ref. */
function TopQuote({ symbol, digits = 2 }: { symbol: string; digits?: number }) {
  const t0 = INITIAL[symbol]
  const root = React.useRef<HTMLDivElement>(null)
  const price = React.useRef<HTMLSpanElement>(null)
  const pill = React.useRef<HTMLSpanElement>(null)
  React.useEffect(
    () =>
      market.subscribe(() => {
        const t = market.get(symbol)
        const p = pct(t)
        root.current?.setAttribute("data-dir", p >= 0 ? "up" : "down")
        if (price.current) price.current.textContent = fmtPrice(last(t))
        if (pill.current) pill.current.textContent = fmtPct(p, digits)
      }),
    [symbol, digits],
  )
  return (
    <div ref={root} className="st-top" data-dir={pct(t0) >= 0 ? "up" : "down"}>
      <span ref={price} className="st-top-price">
        {fmtPrice(last(t0))}
      </span>
      <span ref={pill} className="st-pill go-mono">
        {fmtPct(pct(t0), digits)}
      </span>
    </div>
  )
}

/** The composite index: its value, its change and (optionally) its line. */
function IndexReadout({ symbols, line, className }: { symbols: string[]; line?: { w: number; h: number }; className?: string }) {
  const t0 = composite((s) => INITIAL[s], symbols)
  const root = React.useRef<HTMLDivElement>(null)
  const value = React.useRef<HTMLSpanElement>(null)
  const change = React.useRef<HTMLSpanElement>(null)
  const key = symbols.join(",")
  React.useEffect(
    () =>
      market.subscribe(() => {
        const t = composite(market.get, key.split(","))
        const p = pct(t)
        root.current?.setAttribute("data-dir", p >= 0 ? "up" : "down")
        if (value.current) value.current.textContent = last(t).toFixed(2)
        if (change.current) change.current.textContent = fmtPct(p, 2)
      }),
    [key],
  )
  return (
    <div ref={root} className={"st-index" + (className ? " " + className : "")} data-dir={pct(t0) >= 0 ? "up" : "down"}>
      <div className="st-index-row">
        <span className="st-index-name">Desk Index</span>
        <span ref={value} className="st-index-value go-mono">
          {last(t0).toFixed(2)}
        </span>
        <span ref={change} className="st-index-change go-mono">
          {fmtPct(pct(t0), 2)}
        </span>
      </div>
      {line ? <Spark source={"index:" + key} w={line.w} h={line.h} className="st-index-line" /> : null}
    </div>
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

function Liquid({ symbols, seed, cells }: { symbols: string[]; seed: number; cells?: number }) {
  const { tone } = useGlass()
  const key = symbols.join(",")
  const [dir, setDir] = React.useState<"up" | "down">(() => (pct(composite((s) => INITIAL[s], key.split(","))) >= 0 ? "up" : "down"))
  // re-renders only when the market crosses its open
  React.useEffect(() => market.subscribe(() => setDir(pct(composite(market.get, key.split(","))) >= 0 ? "up" : "down")), [key])
  return <LiquidCanvas recipe={CAST[tone][dir]} seed={seed} cells={cells} />
}

// ---------------------------------------------------------------------------
// Sizes

const SYMBOLS: Record<WidgetSize, string[]> = {
  small: ["AAPL", "NVDA", "TSLA"],
  medium: ["AAPL", "NVDA", "MSFT", "TSLA"],
  large: ["AAPL", "NVDA", "MSFT", "TSLA", "AMZN", "BTC-USD"],
}

const TOP = "AAPL"

/** Rest (rx, ry) in the pocket and open (ox, oy, rot) in the fan, per card. */
function places(size: WidgetSize): Place[] {
  if (size === "small") {
    return [0, 1, 2].map((i) => ({ rx: 12, ry: 8 + i * 22, ox: 12 + (i - 1) * 3, oy: -10 + i * 56, rot: (i - 1) * 1.4, z: i }))
  }
  if (size === "medium") {
    const stagger = [16, 21, 14, 19]
    return [0, 1, 2, 3].map((i) => {
      const c = i - 1.5
      return { rx: 14 + i * 86, ry: stagger[i], ox: 14 + i * 86 + c * 4, oy: 4 + c * c * 3.5, rot: c * 3.2, rest: c * 0.6, z: i }
    })
  }
  return [0, 1, 2, 3, 4, 5].map((i) => {
    const row = Math.floor(i / 3)
    const col = i % 3
    const c = col - 1
    return {
      rx: 12 + col * 116,
      ry: row ? 46 + ((col * 2) % 3) : 9 + ((col * 3) % 4),
      ox: 12 + col * 116 + c * 3,
      oy: 10 + row * 166 + c * c * 3,
      rot: c * (row ? -1.4 : 1.8),
      z: i,
    }
  })
}

function Body({ size }: { size: WidgetSize }) {
  const symbols = SYMBOLS[size]
  const layout = LAYOUT[size]
  const ps = places(size)
  const top = INITIAL[TOP]
  return (
    <>
      <Liquid symbols={symbols} seed={size === "small" ? 3 : size === "medium" ? 6 : 9} cells={size === "small" ? 72 : 120} />
      <div className="st-pocket">
        {symbols.map((s, i) => (
          <Card key={s} symbol={s} layout={layout} place={ps[i]} />
        ))}
      </div>
      {size === "small" ? (
        <GlassPane hinge="bottom" lean={-10} openLean={-80} openShift={22} openFade={0.96} radius={18} className="st-pane st-pane-small">
          <div className="st-label">
            <div className="st-label-row">
              <span className="st-title">Stocks</span>
              <span className="st-top-sym go-mono go-soft">{display(TOP)}</span>
            </div>
            <TopQuote symbol={TOP} />
          </div>
        </GlassPane>
      ) : size === "medium" ? (
        <>
          <GlassPane hinge="bottom" lean={-9} openLean={-82} openShift={24} openFade={0.96} radius={18} className="st-pane st-pane-medium">
            <div className="st-label st-label-wide">
              <div className="st-label-col">
                <span className="st-title">Stocks</span>
                <span className="st-top-name go-soft">
                  <span className="go-mono">{display(TOP)}</span> · {top.name}
                </span>
              </div>
              <TopQuote symbol={TOP} />
            </div>
          </GlassPane>
          <IndexReadout symbols={symbols} className="st-open-label" />
        </>
      ) : (
        <>
          <GlassPane hinge="bottom" lean={-7} openLean={-82} openShift={26} openFade={1} radius={20} className="st-pane st-pane-large">
            <div className="st-label st-label-large">
              <div className="st-label-row">
                <span className="st-title">Stocks</span>
                <span className="st-top-name go-soft">
                  <span className="go-mono">{display(TOP)}</span> · {top.name}
                </span>
              </div>
              <TopQuote symbol={TOP} />
              <IndexReadout symbols={symbols} line={{ w: 332, h: 58 }} />
            </div>
          </GlassPane>
          <IndexReadout symbols={symbols} className="st-open-label" />
        </>
      )}
    </>
  )
}

/** Remembers where the pointer is so Activate can open the card under it. */
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
    const inside = (r: DOMRect, p: { x: number; y: number }) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom
    pickRef.current = () => {
      if (!at) return TOP
      const pane = el.querySelector(".go-pane")
      if (!el.hasAttribute("data-open") && pane && inside(pane.getBoundingClientRect(), at)) return TOP
      const cards = Array.from(el.querySelectorAll<HTMLElement>("[data-symbol]")).reverse() // front-most first
      for (const c of cards) if (inside(c.getBoundingClientRect(), at)) return c.dataset.symbol ?? TOP
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
  const label = "Stocks: " + SYMBOLS[size].map(display).join(", ")
  return (
    <GlassObject
      width={w}
      height={h}
      tone={tone}
      label={label}
      radius={24}
      tilt={size === "large" ? 4 : 5}
      appearDelay={appearDelay}
      className={"st-root st-" + size + (className ? " " + className : "")}
      onActivate={() => open("stocks", { singleton: "app", title: "Stocks", w: 820, h: 560, payload: { symbol: pick.current() } })}
    >
      <style href="stocks-object" precedence="glass-widget">{ST_CSS}</style>
      <div className="st-back" aria-hidden="true" />
      <PointerPick pickRef={pick} />
      <Body size={size} />
    </GlassObject>
  )
}

const ST_CSS = `
.st-root .go-tilt { border-radius: 24px; }
.st-back { position: absolute; inset: 0; border-radius: 24px; overflow: hidden; box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 .5px rgba(0,0,0,.1); }
.st-root .go-liquid { border-radius: 24px; }
.st-root[data-tone="dark"] .st-back { box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 0 0 .5px rgba(255,255,255,.1); }
.st-root { --st-up: #28b552; --st-down: #f0453a; }
.st-root[data-tone="dark"] { --st-up: #30d158; --st-down: #ff5a4f; }

/* the pocket and its cards */
.st-pocket { position: absolute; inset: 0; z-index: 0; }
.st-root .st-card {
  left: 0; top: 0;
  border-radius: 12px;
  transform-origin: 50% 100%;
  transform:
    translate(
      calc((var(--rx) + (var(--ox) - var(--rx)) * var(--go-open)) * 1px + var(--go-px) * var(--z) * var(--go-hover) * 1px),
      calc((var(--ry) + (var(--oy) - var(--ry)) * var(--go-open)) * 1px
        - var(--go-hover) * (1 - var(--go-open)) * (4px + var(--z) * 1.5px)
        + var(--go-press) * 2px))
    rotate(calc(var(--rot) * var(--go-open) * 1deg + var(--rest) * (1 - var(--go-open)) * 1deg));
}
.st-card-in { position: absolute; inset: 0; display: flex; flex-direction: column; padding: 7px 8px 8px; color: var(--go-ink); }
.st-card-in[data-dir="up"] { --st-c: var(--st-up); }
.st-card-in[data-dir="down"] { --st-c: var(--st-down); }
.st-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; min-width: 0; }
.st-sym { font-size: 11.5px; font-weight: 650; letter-spacing: -.01em; white-space: nowrap; }
.st-pill {
  flex: none; font-size: 9.5px; font-weight: 600; line-height: 1; letter-spacing: 0;
  padding: 2.5px 4px; border-radius: 5px;
  color: #fff; background: var(--st-c);
  font-variant-numeric: tabular-nums;
}
.st-name { font-size: 9.5px; line-height: 12px; color: var(--go-ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-foot { flex: 1; display: flex; min-width: 0; min-height: 0; }
.st-meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.st-price { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.01em; white-space: nowrap; }

/* sparklines */
.st-spark { display: block; overflow: visible; color: var(--st-c); flex: none; }
.st-line { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
.st-area { fill: currentColor; fill-opacity: .1; }
.st-base { stroke: var(--go-ink-faint); stroke-width: 1; stroke-dasharray: 1.5 2.5; }
.st-dot { fill: currentColor; stroke: #fff; stroke-width: 1; }
.st-root[data-tone="dark"] .st-dot { stroke: #1c1c1f; }
.st-halo { fill: currentColor; opacity: calc(.08 + var(--go-open) * .22 + var(--go-hover) * .06); transform-box: fill-box; transform-origin: center; transform: scale(calc(.6 + var(--go-open) * .6)); }

/* small: wide, short cards */
.st-card-row .st-card-in { padding: 7px 9px 7px; }
.st-card-row .st-foot { align-items: flex-end; gap: 8px; margin-top: 2px; }
.st-card-row .st-meta { align-self: stretch; }
.st-card-row .st-price { margin-top: auto; font-size: 14px; line-height: 16px; }

/* medium, large: tall cards */
.st-card-column .st-foot { flex-direction: column; gap: 3px; margin-top: 2px; }
.st-card-column .st-price { margin-top: auto; }
.st-card-column .st-spark { margin: 0 -1px; }
.st-medium .st-card-column .st-price { font-size: 12.5px; }
.st-large .st-card-column .st-price { font-size: 15px; }
.st-large .st-card-column .st-name { margin-top: 1px; }

/* the pane */
.st-label { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; padding: 0 14px 12px; gap: 2px; }
.st-label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.st-title { font-size: 12.5px; font-weight: 650; letter-spacing: -.005em; flex: none; }
.st-top-sym { font-size: 10px; }
.st-top-name { font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.st-top[data-dir="up"] { --st-c: var(--st-up); }
.st-top[data-dir="down"] { --st-c: var(--st-down); }
.st-top-price { font-size: 21px; font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.st-top .st-pill { font-size: 10px; padding: 3px 5px; }

.st-root .st-pane-small { top: auto; bottom: 0; height: 92px; }
.st-root .st-pane-medium { top: auto; bottom: 0; height: 110px; }
.st-label-wide { flex-direction: row; align-items: flex-end; justify-content: space-between; padding: 0 16px 14px; }
.st-label-wide .st-top { flex-direction: column; align-items: flex-end; gap: 3px; }
.st-label-col { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.st-root .st-pane-large { top: auto; bottom: 0; height: 250px; }
.st-label-large { padding: 0 16px 14px; gap: 4px; }
.st-label-large .st-top-price { font-size: 26px; }
.st-label-large .st-index { margin-top: 6px; padding-top: 8px; border-top: .5px solid var(--go-ink-faint); }

/* the index */
.st-index { display: flex; flex-direction: column; gap: 4px; color: var(--go-ink); }
.st-index[data-dir="up"] { --st-c: var(--st-up); }
.st-index[data-dir="down"] { --st-c: var(--st-down); }
.st-index-row { display: flex; align-items: baseline; gap: 8px; font-size: 10.5px; }
.st-index-name { color: var(--go-ink-soft); margin-right: auto; }
.st-index-value { font-variant-numeric: tabular-nums; font-weight: 600; }
.st-index-change { color: var(--st-c); font-variant-numeric: tabular-nums; font-weight: 600; }
.st-index-line .st-area { fill-opacity: .14; }

/* revealed once the pane is gone */
.st-open-label {
  position: absolute; left: 18px; right: 18px; bottom: 9px;
  opacity: calc(var(--go-open) * 1);
  transform: translateY(calc((1 - var(--go-open)) * 8px));
}
.st-large .st-open-label { bottom: 10px; }
`
