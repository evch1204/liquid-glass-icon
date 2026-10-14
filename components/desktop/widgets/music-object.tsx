"use client"

import * as React from "react"
import { Music, Pause, Play, SkipBack, SkipForward } from "lucide-react"
import { GlassObject, GlassPane, LiquidCanvas, useGlass, useSpringVar, type LiquidHandle, type LiquidRecipe } from "@/components/ui/glass-object"
import { ART_PRESETS, createArtJob, type ArtJob, type ArtPreset, type ArtRecipe } from "@/components/ui/glass-folder-cards"
import { WIDGET, type WidgetSize } from "../glass"
import { useWindowManager } from "../window-manager"

/**
 * Music — the Now Playing widget, and an album that is also a record.
 *
 * At rest it is the macOS widget: the album art, the title and artist, the
 * transport, on one flat glass pane over a liquid light tinted from the
 * album. Nothing ever leaves the card and the card never changes shape.
 *
 * - **Hover**: the art tile lifts 3px with a spreading shadow and tilts
 *   gently toward the pointer; the equaliser bars wake; a light sweep crosses
 *   the art with the pointer.
 * - **Open** (click): the art morphs into a record where it stands. Its
 *   corners spring from a tile to a circle (`--disc`), grooves fade in over
 *   the art, the art shrinks to the label, a spindle appears, and the disc
 *   turns. Its angular velocity is a spring integrated into `--spin` every
 *   frame: it spins up while playing and coasts down on pause. On medium and
 *   large the progress bar becomes an arc around the disc.
 * - **Close** (click, Escape): the disc coasts round to where it started and
 *   the corners spring back: the record is the album art again.
 * - **Activate** (double-click, Enter): the Music app.
 */

// ---------------------------------------------------------------------------
// The queue

type Track = { id: string; title: string; artist: string; duration: number; art: ArtPreset | ArtRecipe; seed: number }

const TRACKS: Track[] = [
  { id: "t1", title: "Low Tide Static", artist: "Hollow Coast", duration: 214, art: "glacier", seed: 11 },
  { id: "t2", title: "Ember Season", artist: "Marrow & Vane", duration: 247, art: "ember", seed: 4 },
  {
    id: "t3",
    title: "Satellites in Velvet",
    artist: "Nadia Orr",
    duration: 188,
    art: { style: "marble", colors: ["#0b0820", "#2d1b69", "#7c4dff", "#1a1033", "#ff6ec7", "#ffd1f0"], scale: 0.7, warp: 3.2, angle: 1.2, gloss: 0.6, veins: 0.4 },
    seed: 23,
  },
  { id: "t4", title: "Paper Lanterns", artist: "The Quiet Hours", duration: 231, art: "dusk", seed: 8 },
  { id: "t5", title: "Moss Garden", artist: "Juniper Field", duration: 202, art: "verdant", seed: 2 },
  {
    id: "t6",
    title: "Long Exposure",
    artist: "Hollow Coast",
    duration: 263,
    art: { style: "streak", colors: ["#fff4e0", "#ffc48a", "#ff7a45", "#3a1c2c", "#1d3b5c", "#7fb6d9", "#eaf4fb"], scale: 0.7, warp: 1.5, angle: -0.4, gloss: 0.22 },
    seed: 31,
  },
]

const recipeOf = (art: ArtPreset | ArtRecipe): ArtRecipe => (typeof art === "string" ? ART_PRESETS[art] : art)

function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** The tracks after the current one, wrapping. */
function upNext(index: number, count: number): Track[] {
  return Array.from({ length: count }, (_, k) => TRACKS[(index + 1 + k) % TRACKS.length])
}

// ---------------------------------------------------------------------------
// Player store: module level, shared by every Music object on the page.

type Player = { playing: boolean; index: number; position: number }
const INITIAL: Player = { playing: false, index: 0, position: 42 }

let player: Player = INITIAL
const listeners = new Set<() => void>()
let ticker: ReturnType<typeof setInterval> | undefined
let lastTick = 0

function emit() {
  listeners.forEach((l) => l())
}

function syncTicker() {
  if (player.playing && !ticker) {
    lastTick = performance.now()
    ticker = setInterval(tickPlayer, 250)
  } else if (!player.playing && ticker) {
    clearInterval(ticker)
    ticker = undefined
  }
}

function setPlayer(patch: Partial<Player>) {
  player = { ...player, ...patch }
  syncTicker()
  emit()
}

function tickPlayer() {
  const t = performance.now()
  const dt = (t - lastTick) / 1000
  lastTick = t
  const position = player.position + dt
  if (position < TRACKS[player.index].duration) {
    player = { ...player, position }
    emit()
  } else setPlayer({ index: (player.index + 1) % TRACKS.length, position: 0 })
}

const store = {
  toggle: () => setPlayer({ playing: !player.playing }),
  play: (index: number) => setPlayer({ index, position: 0, playing: true }),
  next: () => setPlayer({ index: (player.index + 1) % TRACKS.length, position: 0 }),
  prev: () => (player.position > 3 ? setPlayer({ position: 0 }) : setPlayer({ index: (player.index + TRACKS.length - 1) % TRACKS.length, position: 0 })),
  seek: (position: number) => {
    lastTick = performance.now()
    setPlayer({ position: Math.max(0, Math.min(TRACKS[player.index].duration - 0.5, position)) })
  },
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Only the slow-changing parts re-render React; position is written by ref. */
function useIndex() {
  return React.useSyncExternalStore(
    subscribe,
    () => player.index,
    () => INITIAL.index,
  )
}
function usePlaying() {
  return React.useSyncExternalStore(
    subscribe,
    () => player.playing,
    () => INITIAL.playing,
  )
}

/** Run `write` now and on every store change, outside React. */
function usePlayerDOM(write: (p: Player) => void) {
  React.useEffect(() => {
    const run = () => write(player)
    run()
    return subscribe(run)
  }, [write])
}

// ---------------------------------------------------------------------------
// Album art: painted once per recipe + seed + size, time-sliced over frames,
// cached at module level and drawn into any canvas that asks.

const ART_PX = 240
type ArtEntry = { canvas: HTMLCanvasElement | null; waiters: ((c: HTMLCanvasElement) => void)[] }
const artCache = new Map<string, ArtEntry>()
const artQueue: { job: ArtJob; entry: ArtEntry }[] = []
let artPumping = false

function pumpArt() {
  if (artPumping) return
  artPumping = true
  const frame = () => {
    const until = performance.now() + 6
    while (artQueue.length && performance.now() < until) {
      const head = artQueue[0]
      if (head.job.step(4)) {
        artQueue.shift()
        const c = document.createElement("canvas")
        c.width = head.job.width
        c.height = head.job.height
        c.getContext("2d")?.putImageData(new ImageData(head.job.pixels as Uint8ClampedArray<ArrayBuffer>, c.width, c.height), 0, 0)
        head.entry.canvas = c
        head.entry.waiters.splice(0).forEach((w) => w(c))
      }
    }
    if (artQueue.length) requestAnimationFrame(frame)
    else artPumping = false
  }
  requestAnimationFrame(frame)
}

function requestArt(recipe: ArtRecipe, seed: number, size: number): ArtEntry {
  const key = JSON.stringify([recipe, seed, size])
  let entry = artCache.get(key)
  if (!entry) {
    entry = { canvas: null, waiters: [] }
    artQueue.push({ job: createArtJob(size, size, recipe, seed), entry })
    artCache.set(key, entry)
    pumpArt()
  }
  return entry
}

/** Generated album art. Fills its box; fades in by ref once painted, instantly when cached. */
function Art({ track, className, style, children }: { track: Track; className?: string; style?: React.CSSProperties; children?: React.ReactNode }) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  const recipe = recipeOf(track.art)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    let live = true
    let raf = 0
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    const entry = requestArt(recipeOf(track.art), track.seed, ART_PX)
    const draw = (src: HTMLCanvasElement, fade: boolean) => {
      if (!live) return
      el.width = src.width
      el.height = src.height
      el.getContext("2d")?.drawImage(src, 0, 0)
      if (!fade || reduce) {
        el.style.opacity = "1"
        return
      }
      const t0 = performance.now()
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 480)
        el.style.opacity = (1 - Math.pow(1 - k, 3)).toFixed(3)
        raf = k < 1 ? requestAnimationFrame(step) : 0
      }
      raf = requestAnimationFrame(step)
    }
    if (entry.canvas) draw(entry.canvas, false)
    else {
      el.style.opacity = "0"
      entry.waiters.push((c) => draw(c, true))
    }
    return () => {
      live = false
      cancelAnimationFrame(raf)
    }
  }, [track])

  return (
    <div
      aria-hidden="true"
      className={"mu-art-tile" + (className ? " " + className : "")}
      style={{ background: `linear-gradient(135deg, ${recipe.colors.slice(0, 4).join(", ")})`, ...style }}
    >
      <canvas ref={ref} />
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The liquid light, tinted from the album

function mix(a: string, b: string, t: number): string {
  const p = (c: string) => {
    let h = c.replace("#", "")
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    const n = parseInt(h, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const x = p(a)
  const y = p(b)
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")
}

const lum = (c: string) => {
  const n = parseInt(c.slice(1), 16)
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
}

/** Four pale (or, on smoked glass, deep) colours from the album, ordered like the LIQUIDS presets. */
function liquidFor(track: Track, tone: "light" | "dark"): LiquidRecipe {
  const base = recipeOf(track.art).colors
  const to = tone === "dark" ? "#141417" : "#ffffff"
  const amt = tone === "dark" ? 0.8 : 0.7
  const s = base.map((c) => mix(c, to, amt)).sort((a, b) => lum(a) - lum(b))
  const at = (f: number) => s[Math.round(f * (s.length - 1))]
  return { colors: [at(0), at(0.4), tone === "dark" ? at(1) : mix(at(1), "#ffffff", 0.5), at(0.7)], gloss: tone === "dark" ? 0.3 : 0.5, speed: 0.9 }
}
// ---------------------------------------------------------------------------
// The equaliser: five real bars, moved by springs on rAF while playing.

const BARS = [
  { a: 7.1, b: 11.3, p: 0.2, q: 1.7 },
  { a: 9.4, b: 5.2, p: 1.9, q: 0.4 },
  { a: 6.2, b: 13.7, p: 0.8, q: 2.6 },
  { a: 10.6, b: 7.9, p: 2.7, q: 1.1 },
  { a: 8.3, b: 12.1, p: 1.3, q: 3.0 },
]
const IDLE = 0.16
const STILL = [0.55, 0.85, 0.45, 0.7, 0.5]

function Equalizer({ className }: { className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const heights = React.useRef(BARS.map(() => IDLE))
  const { rootRef, hover, focused } = useGlass()
  const playing = usePlaying()
  const awake = hover || focused

  React.useEffect(() => {
    const host = ref.current
    if (!host) return
    const bars = Array.from(host.querySelectorAll<HTMLElement>(".mu-bar-in"))
    const write = (i: number, h: number) => {
      bars[i].style.transform = `translateY(${((1 - h) * 100).toFixed(2)}%)`
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (reduce) {
      BARS.forEach((_, i) => write(i, playing ? STILL[i] : IDLE + (awake ? 0.08 : 0)))
      return
    }
    const h = heights.current
    const v = BARS.map(() => 0)
    let raf = 0
    let last = 0
    const frame = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016
      last = now
      const t = now / 1000
      const hov = parseFloat(rootRef.current?.style.getPropertyValue("--go-hover") || "0")
      let moving = playing || hov > 0.002
      BARS.forEach((b, i) => {
        const target = playing
          ? Math.max(0.12, Math.min(1, 0.5 + 0.28 * Math.sin(t * b.a + b.p) + 0.2 * Math.sin(t * b.b + b.q) + hov * 0.08))
          : IDLE + hov * (0.1 + 0.07 * Math.sin(t * 2.4 + i * 0.9))
        const acc = -320 * (h[i] - target) - 22 * v[i]
        v[i] += acc * dt
        h[i] = Math.max(0.06, Math.min(1.08, h[i] + v[i] * dt))
        if (Math.abs(v[i]) > 0.002 || Math.abs(h[i] - target) > 0.002) moving = true
        write(i, h[i])
      })
      raf = moving ? requestAnimationFrame(frame) : 0
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing, awake, rootRef])

  return (
    <span ref={ref} aria-hidden="true" className={"mu-eq" + (className ? " " + className : "")}>
      {BARS.map((_, i) => (
        <span key={i} className="mu-bar">
          <span className="mu-bar-in" style={{ transform: `translateY(${(1 - IDLE) * 100}%)` }} />
        </span>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Albums and the record's colour

const ALBUM: Record<string, string> = {
  t1: "Undertow",
  t2: "Kindling",
  t3: "Night Signals",
  t4: "Small Hours",
  t5: "Field Notes",
  t6: "Undertow",
}

/** The vinyl's colour: the album's most saturated mid-tone, at 78% so the light shows through. */
function vinylOf(track: Track): string {
  const cs = recipeOf(track.art).colors
  const sat = (c: string) => {
    const n = parseInt(c.slice(1), 16)
    const r = (n >> 16) & 255
    const g = (n >> 8) & 255
    const b = n & 255
    return Math.max(r, g, b) - Math.min(r, g, b)
  }
  const mids = cs.filter((c) => lum(c) > 45 && lum(c) < 215)
  const pick = (mids.length ? mids : cs).slice().sort((a, b) => sat(b) - sat(a))[0]
  return pick + "c7"
}

/** Where the art tile sits, and its corner radius as a tile. */
const ART: Record<WidgetSize, { x: number; y: number; s: number; r: number }> = {
  small: { x: 0, y: 0, s: 170, r: 24 },
  medium: { x: 21, y: 21, s: 128, r: 16 },
  large: { x: 20, y: 20, s: 148, r: 16 },
}

// ---------------------------------------------------------------------------
// The deck: the morph (--disc), the spin (ω integrated into --spin) and the liquid's energy.

const DeckCtx = React.createContext<React.RefObject<LiquidHandle | null> | null>(null)

function Deck({ size, children }: { size: WidgetSize; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const liquid = React.useRef<LiquidHandle | null>(null)
  const playing = usePlaying()
  const { open } = useGlass()
  const disc = useSpringVar(ref, "--disc", 0, 70, 11)
  const drive = React.useRef<(mode: "spin" | "coast" | "home", onHome?: () => void) => void>(() => {})

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    // ω is a spring toward a target speed; going home, the angle is a spring toward a whole turn
    const s = { a: 0, w: 0, v: 0, t: 0, k: 5, c: 4.2, home: false, ha: 0, cb: undefined as (() => void) | undefined }
    let raf = 0
    let last = 0
    const write = () => el.style.setProperty("--spin", (((s.a % 360) + 360) % 360).toFixed(2))
    const loop = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016
      last = now
      let done = false
      if (s.home) {
        const acc = -s.k * (s.a - s.ha) - s.c * s.w
        s.w += acc * dt
        s.a += s.w * dt
        if (s.cb && Math.abs(s.a - s.ha) < 24 && Math.abs(s.w) < 40) {
          s.cb()
          s.cb = undefined
        }
        if (Math.abs(s.a - s.ha) < 0.05 && Math.abs(s.w) < 0.5) {
          s.a = 0
          s.w = 0
          done = true
        }
      } else {
        const acc = -s.k * (s.w - s.t) - s.c * s.v
        s.v += acc * dt
        s.w += s.v * dt
        s.a += s.w * dt
        if (s.t === 0 && Math.abs(s.w) < 0.4 && Math.abs(s.v) < 0.4) {
          s.w = 0
          s.v = 0
          done = true
        }
      }
      write()
      if (done) {
        raf = 0
        last = 0
        return
      }
      raf = requestAnimationFrame(loop)
    }
    drive.current = (mode, onHome) => {
      s.cb = undefined
      if (mode === "home") {
        s.home = true
        s.k = 4
        s.c = 4
        // the next whole turn ahead of where it would coast to; back to the nearest one if it is barely moving
        s.ha = Math.abs(s.w) > 5 ? Math.ceil((s.a + s.w * 0.5) / 360) * 360 : Math.round(s.a / 360) * 360
        if (reduce || (Math.abs(s.a - s.ha) < 0.5 && Math.abs(s.w) < 0.5)) {
          s.a = 0
          s.w = 0
          write()
          onHome?.()
          return
        }
        s.cb = onHome
      } else {
        s.home = false
        s.v = 0
        // 33⅓ rpm is 200°/s: up in ~1.2s, coasting down in ~2.5s
        s.t = mode === "spin" ? 200 : 0
        s.k = mode === "spin" ? 5 : 1.6
        s.c = mode === "spin" ? 4.2 : 2.4
        if (reduce) return
      }
      if (!raf) raf = requestAnimationFrame(loop)
    }
    return () => {
      cancelAnimationFrame(raf)
      drive.current = () => {}
    }
  }, [])

  // open: tile → disc, then it turns if playing; close: coast home, then disc → tile
  React.useEffect(() => {
    if (open) {
      disc(1)
      drive.current(playing ? "spin" : "coast")
    } else drive.current("home", () => disc(0))
  }, [open, playing, disc])

  React.useEffect(() => {
    if (!playing) {
      liquid.current?.energy(1)
      return
    }
    liquid.current?.energy(1.8)
    // the engine eases energy back on its own; keep it up while playing
    const t = window.setInterval(() => liquid.current?.energy(1.8), 300)
    return () => window.clearInterval(t)
  }, [playing])

  const a = ART[size]
  return (
    <DeckCtx.Provider value={liquid}>
      <div
        ref={ref}
        className="mu-deck"
        style={{ "--spin": 0, "--disc": 0, "--ax": a.x + "px", "--ay": a.y + "px", "--as": a.s + "px", "--ar": a.r + "px" } as React.CSSProperties}
      >
        {children}
      </div>
    </DeckCtx.Provider>
  )
}

function Liquid({ cells, seed }: { cells?: number; seed: number }) {
  const { tone } = useGlass()
  const liquid = React.useContext(DeckCtx)
  const index = useIndex()
  const recipe = React.useMemo(() => liquidFor(TRACKS[index], tone), [index, tone])
  return <LiquidCanvas ref={liquid ?? undefined} recipe={recipe} seed={seed} cells={cells} />
}

// ---------------------------------------------------------------------------
// The art, which is also the record

/** Progress as an arc around the disc, written by ref. */
function Arc({ size }: { size: number }) {
  const ref = React.useRef<SVGCircleElement>(null)
  const write = React.useCallback((p: Player) => {
    ref.current?.setAttribute("stroke-dashoffset", (1 - p.position / TRACKS[p.index].duration).toFixed(4))
  }, [])
  usePlayerDOM(write)
  const r = size / 2 + 5
  const box = size + 14
  return (
    <svg className="mu-arc" width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden="true">
      <circle className="mu-arc-track" cx={box / 2} cy={box / 2} r={r} />
      <circle
        ref={ref}
        className="mu-arc-fill"
        cx={box / 2}
        cy={box / 2}
        r={r}
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={(1 - INITIAL.position / TRACKS[INITIAL.index].duration).toFixed(4)}
        transform={`rotate(-90 ${box / 2} ${box / 2})`}
      />
    </svg>
  )
}

function AlbumRecord({ size }: { size: WidgetSize }) {
  const index = useIndex()
  const t = TRACKS[index]
  return (
    <div className={"mu-art mu-art-" + size}>
      {size !== "small" ? <Arc size={ART[size].s} /> : null}
      <div className="mu-lift">
        <div className="mu-disc">
          <div className="mu-disc-spin">
            <div className="mu-vinyl" style={{ "--vinyl": vinylOf(t) } as React.CSSProperties} />
            <Art key={index} track={t} className="mu-face" />
            <div className="mu-grooves" />
          </div>
          <div className="mu-groove-light" />
          <div className="mu-sweep" />
          <span className="mu-spindle" />
        </div>
        {size !== "small" ? (
          <span className="mu-chip">
            <Equalizer className="mu-eq-chip" />
          </span>
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Progress and times, written by ref

function ProgressLine() {
  const fill = React.useRef<HTMLSpanElement>(null)
  const write = React.useCallback((p: Player) => {
    if (fill.current) fill.current.style.transform = `scaleX(${(p.position / TRACKS[p.index].duration).toFixed(4)})`
  }, [])
  usePlayerDOM(write)
  return (
    <span aria-hidden="true" className="mu-line">
      <span ref={fill} className="mu-line-fill" style={{ transform: `scaleX(${(INITIAL.position / TRACKS[INITIAL.index].duration).toFixed(4)})` }} />
    </span>
  )
}

type TimeKind = "elapsed" | "remaining"
const timeText = (p: Player, kind: TimeKind) => (kind === "elapsed" ? fmt(p.position) : "-" + fmt(TRACKS[p.index].duration - p.position))

function Time({ kind }: { kind: TimeKind }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const write = React.useCallback(
    (p: Player) => {
      const s = timeText(p, kind)
      if (ref.current && ref.current.textContent !== s) ref.current.textContent = s
    },
    [kind],
  )
  usePlayerDOM(write)
  return (
    <span ref={ref} className="go-mono">
      {timeText(INITIAL, kind)}
    </span>
  )
}

function Progress() {
  return (
    <div className="mu-progress">
      <ProgressLine />
      <span className="mu-times">
        <Time kind="elapsed" />
        <Time kind="remaining" />
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Transport: round glass buttons with a press spring

function MuButton({ label, className, onPress, children }: { label: string; className?: string; onPress: () => void; children: React.ReactNode }) {
  const ref = React.useRef<HTMLButtonElement>(null)
  const press = useSpringVar(ref, "--mu-b", 0, 520, 24)
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={"mu-btn go-live" + (className ? " " + className : "")}
      onPointerDown={(e) => {
        e.stopPropagation()
        press(1)
      }}
      onPointerUp={() => press(0)}
      onPointerLeave={() => press(0)}
      onClick={(e) => {
        e.stopPropagation()
        onPress()
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") e.stopPropagation()
      }}
    >
      {children}
    </button>
  )
}

function Transport({ size, prev = true, className }: { size: "sm" | "md" | "lg"; prev?: boolean; className?: string }) {
  const playing = usePlaying()
  const icon = size === "lg" ? 15 : size === "md" ? 13 : 11
  return (
    <div className={"mu-transport mu-transport-" + size + (className ? " " + className : "")}>
      {prev ? (
        <MuButton label="Previous track" onPress={store.prev}>
          <SkipBack size={icon} fill="currentColor" strokeWidth={1.4} />
        </MuButton>
      ) : null}
      <MuButton label={playing ? "Pause" : "Play"} className="mu-play" onPress={store.toggle}>
        {playing ? <Pause size={icon + 1} fill="currentColor" strokeWidth={0} /> : <Play size={icon + 1} fill="currentColor" strokeWidth={0} className="mu-play-icon" />}
      </MuButton>
      <MuButton label="Next track" onPress={store.next}>
        <SkipForward size={icon} fill="currentColor" strokeWidth={1.4} />
      </MuButton>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Text

function NowText({ className, album = false }: { className?: string; album?: boolean }) {
  const t = TRACKS[useIndex()]
  return (
    <span className={"mu-now" + (className ? " " + className : "")}>
      <span className="mu-title">{t.title}</span>
      <span className="mu-artist">{t.artist}</span>
      {album ? <span className="mu-album">{ALBUM[t.id]}</span> : null}
    </span>
  )
}

function UpNextList({ count }: { count: number }) {
  const index = useIndex()
  return (
    <div className="mu-upnext-list" aria-hidden="true">
      <span className="mu-kicker">Up Next</span>
      {upNext(index, count).map((t, i) => (
        <span key={i} className="mu-upnext-row">
          <Art track={t} className="mu-upnext-art" />
          <span className="mu-upnext-text">
            <span className="mu-upnext-title">{t.title}</span>
            <span className="mu-upnext-artist">{t.artist}</span>
          </span>
          <span className="mu-upnext-dur go-mono">{fmt(t.duration)}</span>
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sizes. The pane is flat and stays put: everything happens in the art.

const PANE = { hinge: "none", lean: 0, openLean: 0, openShift: 0, openFade: 0, radius: 22 } as const

/** Small: the art edge to edge under a thin frost, white type, two round buttons. */
function Small() {
  return (
    <Deck size="small">
      <Liquid seed={3} />
      <AlbumRecord size="small" />
      <GlassPane {...PANE} frost={0.15} className="mu-pane mu-pane-s">
        <Music size={13} strokeWidth={2.2} className="mu-glyph" aria-hidden="true" />
        <Equalizer className="mu-eq-corner" />
        <NowText className="mu-now-s" />
        <Transport size="sm" prev={false} className="mu-transport-s" />
      </GlassPane>
    </Deck>
  )
}

/** Medium: art on the left; title, artist, album, progress and transport on the right. */
function Medium() {
  return (
    <Deck size="medium">
      <Liquid seed={6} cells={120} />
      <GlassPane {...PANE} frost={0.9} className="mu-pane">
        <div className="mu-col">
          <NowText album className="mu-now-m" />
          <Progress />
          <Transport size="md" />
        </div>
      </GlassPane>
      <AlbumRecord size="medium" />
    </Deck>
  )
}

/** Large: big art, then the controls strip, then Up Next. */
function Large() {
  return (
    <Deck size="large">
      <Liquid seed={9} cells={120} />
      <GlassPane {...PANE} frost={0.9} className="mu-pane">
        <Music size={14} strokeWidth={2.2} className="mu-glyph mu-glyph-ink" aria-hidden="true" />
        <NowText album className="mu-now-l" />
        <div className="mu-strip">
          <Progress />
          <Transport size="lg" />
        </div>
        <UpNextList count={3} />
      </GlassPane>
      <AlbumRecord size="large" />
    </Deck>
  )
}

export function MusicWidget({ size = "small", className, appearDelay = 0 }: { size?: WidgetSize; className?: string; appearDelay?: number }) {
  const { open, tone } = useWindowManager()
  const { w, h } = WIDGET[size]
  return (
    <GlassObject
      width={w}
      height={h}
      tone={tone}
      label="Music"
      radius={24}
      tilt={2}
      appearDelay={appearDelay}
      className={"mu-root mu-" + size + (className ? " " + className : "")}
      onActivate={() => open("music", { singleton: "app", title: "Music", w: 640, h: 420 })}
    >
      <style href="music-object" precedence="glass-widget">{MU_CSS}</style>
      <div className="mu-back" aria-hidden="true" />
      {size === "small" ? <Small /> : size === "medium" ? <Medium /> : <Large />}
    </GlassObject>
  )
}

const MU_CSS = `
.mu-root .go-tilt { border-radius: 24px; }
.mu-back { position: absolute; inset: 0; border-radius: 24px; overflow: hidden; box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 .5px rgba(0,0,0,.1); }
.mu-root[data-tone="dark"] .mu-back { box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 0 0 .5px rgba(255,255,255,.1); }
.mu-deck { position: absolute; inset: 0; border-radius: 24px; }
.mu-root .go-liquid { border-radius: 24px; }

/* ---- the art, which is also the record ---- */
.mu-art-tile { position: relative; overflow: hidden; }
.mu-art-tile > canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; opacity: 0; }
.mu-art { position: absolute; left: var(--ax); top: var(--ay); width: var(--as); height: var(--as); }
/* hover: the tile lifts 3px and tilts gently toward the pointer, on its own */
.mu-lift {
  position: absolute; inset: 0;
  transform:
    translateY(calc(var(--go-hover) * -3px))
    perspective(600px)
    rotateX(calc(var(--go-py) * var(--go-hover) * -4deg))
    rotateY(calc(var(--go-px) * var(--go-hover) * 5deg))
    scale(calc(1 - var(--go-press) * .015));
}
/* the clip: a tile whose corners spring to a circle */
.mu-disc {
  position: absolute; inset: 0; overflow: hidden;
  border-radius: calc(var(--ar) + var(--disc) * (50% - var(--ar)));
  box-shadow:
    0 0 0 .5px rgba(0,0,0,.14),
    0 calc(5px + var(--go-hover) * 6px) calc(12px + var(--go-hover) * 14px) calc(-6px + var(--go-hover) * 1px) rgba(16,18,24,calc(.45 + var(--go-hover) * .1));
}
.mu-root[data-tone="dark"] .mu-disc { box-shadow: 0 0 0 .5px rgba(255,255,255,.14), 0 calc(6px + var(--go-hover) * 6px) calc(14px + var(--go-hover) * 14px) -6px rgba(0,0,0,.75); }
.mu-disc-spin { position: absolute; inset: 0; border-radius: inherit; transform: rotate(calc(var(--spin) * 1deg)); }
.mu-vinyl {
  position: absolute; inset: 0; border-radius: inherit;
  opacity: min(1, calc(var(--disc) * 2));
  background:
    conic-gradient(from 10deg, rgba(255,255,255,.14), rgba(255,255,255,0) 22%, rgba(0,0,0,.08) 40%, rgba(255,255,255,.1) 58%, rgba(255,255,255,0) 76%, rgba(0,0,0,.06) 90%, rgba(255,255,255,.14)),
    var(--vinyl);
}
/* the art shrinks to the label; its own corners round with the disc */
.mu-face {
  position: absolute; inset: 0;
  border-radius: calc(var(--ar) + var(--disc) * (50% - var(--ar)));
  transform: scale(calc(1 - var(--disc) * .63));
}
.mu-grooves {
  position: absolute; inset: 0; border-radius: inherit;
  opacity: var(--disc);
  background: repeating-radial-gradient(circle, transparent 0 1px, rgba(0,0,0,.09) 1px 1.6px);
  -webkit-mask: radial-gradient(circle closest-side, transparent 37%, #000 39%);
  mask: radial-gradient(circle closest-side, transparent 37%, #000 39%);
  box-shadow: inset 0 0 0 1.5px rgba(255,255,255,calc(var(--disc) * .16));
}
/* light that stays with the room while the disc turns under it */
.mu-groove-light {
  position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  opacity: calc(var(--disc) * .9);
  background: conic-gradient(from calc(var(--go-px) * 40deg + 30deg),
    rgba(255,255,255,0) 0deg, rgba(255,255,255,.55) 14deg, rgba(255,255,255,0) 34deg,
    rgba(255,255,255,0) 180deg, rgba(255,255,255,.4) 194deg, rgba(255,255,255,0) 214deg, rgba(255,255,255,0) 360deg);
  -webkit-mask: radial-gradient(circle closest-side, transparent 38%, #000 42%, #000 97%, transparent 100%);
  mask: radial-gradient(circle closest-side, transparent 38%, #000 42%, #000 97%, transparent 100%);
  mix-blend-mode: soft-light;
}
.mu-root[data-tone="dark"] .mu-groove-light { mix-blend-mode: screen; opacity: calc(var(--disc) * .35); }
/* hover: a light sweep crosses the art with the pointer */
.mu-sweep {
  position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(105deg, rgba(255,255,255,0) 38%, rgba(255,255,255,.34) 50%, rgba(255,255,255,0) 62%) no-repeat;
  background-size: 260% 100%;
  background-position: calc(50% - var(--go-px) * 60%) 0;
  opacity: calc(var(--go-hover) * (1 - var(--disc) * .6));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.3), inset 0 0 0 .5px rgba(255,255,255,.16);
}
.mu-spindle {
  position: absolute; left: 50%; top: 50%; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fff, #b6b8be 55%, #6d6f76);
  box-shadow: 0 0 0 .75px rgba(0,0,0,.3), 0 1px 2px rgba(0,0,0,.4);
  opacity: var(--disc);
  transform: scale(calc(.4 + var(--disc) * .6));
}
/* progress as an arc around the disc */
.mu-arc {
  position: absolute; left: -7px; top: -7px; overflow: visible;
  opacity: var(--disc);
  transform: translateY(calc(var(--go-hover) * -3px));
}
.mu-arc circle { fill: none; stroke-width: 2.5; stroke-linecap: round; }
.mu-arc-track { stroke: var(--go-ink-faint); }
.mu-arc-fill { stroke: var(--go-ink); opacity: .6; }

/* ---- equaliser ---- */
.mu-eq { display: flex; align-items: flex-end; }
.mu-bar { position: relative; display: block; height: 100%; overflow: hidden; }
.mu-bar-in { position: absolute; inset: 0; display: block; border-radius: inherit; background: currentColor; }
.mu-chip {
  position: absolute; right: 7px; top: 7px; display: flex; padding: 4px 5px; border-radius: 7px;
  background: rgba(10,10,14,.3); -webkit-backdrop-filter: blur(8px) saturate(1.4); backdrop-filter: blur(8px) saturate(1.4);
  box-shadow: inset 0 0 0 .5px rgba(255,255,255,.22);
  opacity: calc((.75 + var(--go-hover) * .25) * (1 - var(--disc)));
}
.mu-eq-chip { height: 11px; gap: 2px; color: #fff; }
.mu-eq-chip .mu-bar { width: 2.5px; border-radius: 1.25px; }

/* ---- the pane ---- */
.mu-pane .go-pane-body { overflow: hidden; }
.mu-glyph { position: absolute; left: 13px; top: 13px; color: #fff; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
.mu-glyph-ink { left: auto; right: 18px; top: 18px; color: #fa2d48; filter: none; }

/* type */
.mu-now { display: flex; flex-direction: column; min-width: 0; }
.mu-title, .mu-artist, .mu-album { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mu-title { font-size: 13px; font-weight: 600; letter-spacing: -.01em; line-height: 1.25; }
.mu-artist { font-size: 11px; line-height: 1.3; color: var(--go-ink-soft); }
.mu-album { font-size: 11px; line-height: 1.3; color: var(--go-ink-soft); opacity: .8; }
.mu-kicker { font-size: 10px; font-weight: 600; letter-spacing: .02em; color: var(--go-ink-soft); }

/* progress: the bar hands over to the arc when the art is a record */
.mu-progress { display: flex; flex-direction: column; gap: 3px; }
.mu-line { position: relative; display: block; height: 3px; border-radius: 2px; overflow: hidden; background: var(--go-ink-faint); opacity: calc(1 - var(--disc)); }
.mu-line-fill { position: absolute; inset: 0; display: block; background: var(--go-ink); opacity: .6; transform-origin: 0 50%; }
.mu-times { display: flex; justify-content: space-between; font-size: 10px; color: var(--go-ink-soft); font-variant-numeric: tabular-nums; }

/* buttons: round glass */
.mu-transport { display: flex; align-items: center; }
.mu-btn {
  all: unset; box-sizing: border-box; display: grid; place-items: center; flex: none; cursor: pointer;
  width: 28px; height: 28px; border-radius: 50%; color: var(--go-ink);
  background: rgba(var(--go-glass), .38);
  -webkit-backdrop-filter: blur(10px) saturate(1.5); backdrop-filter: blur(10px) saturate(1.5);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.6), inset 0 0 0 .5px rgba(255,255,255,.35), 0 0 0 .5px rgba(0,0,0,.08), 0 calc(3px - var(--mu-b, 0) * 2px) calc(8px - var(--mu-b, 0) * 4px) -3px rgba(0,0,0,.3);
  transform: scale(calc(1 - var(--mu-b, 0) * .12));
}
.mu-root[data-tone="dark"] .mu-btn { box-shadow: inset 0 1px 0 rgba(255,255,255,.16), inset 0 0 0 .5px rgba(255,255,255,.14), 0 calc(3px - var(--mu-b, 0) * 2px) calc(8px - var(--mu-b, 0) * 4px) -3px rgba(0,0,0,.5); }
.mu-btn:focus-visible { outline: 2px solid #4c8dff; outline-offset: 2px; }
.mu-play-icon { translate: 1px 0; }
.mu-transport-sm { gap: 6px; }
.mu-transport-md { gap: 12px; }
.mu-transport-md .mu-play { width: 34px; height: 34px; }
.mu-transport-lg { gap: 16px; }
.mu-transport-lg .mu-btn { width: 32px; height: 32px; }
.mu-transport-lg .mu-play { width: 40px; height: 40px; }

/* ---- small ---- */
.mu-art-small { overflow: hidden; border-radius: 24px; }
.mu-art-small .mu-disc { box-shadow: none; }
.mu-art-small .mu-lift { transform: perspective(600px) rotateX(calc(var(--go-py) * var(--go-hover) * -2deg)) rotateY(calc(var(--go-px) * var(--go-hover) * 2.5deg)) scale(calc(1 + var(--go-hover) * .02 - var(--go-press) * .015)); }
.mu-root.mu-small .mu-pane-s .go-pane-tint {
  background: linear-gradient(180deg, rgba(0,0,0,.2) 0%, rgba(0,0,0,0) 26%, rgba(0,0,0,0) 46%, rgba(0,0,0,.6) 100%);
}
.mu-root.mu-small .mu-pane-s .go-pane-spec { opacity: .5; }
.mu-now-s { position: absolute; left: 13px; right: 76px; bottom: 13px; }
.mu-now-s .mu-title { color: #fff; font-size: 13px; text-shadow: 0 1px 2px rgba(0,0,0,.25); }
.mu-now-s .mu-artist { color: rgba(255,255,255,.75); font-size: 11px; }
.mu-eq-corner { position: absolute; right: 14px; top: 13px; height: 12px; gap: 2px; color: #fff; opacity: calc(.8 + var(--go-hover) * .2); filter: drop-shadow(0 1px 2px rgba(0,0,0,.3)); }
.mu-eq-corner .mu-bar { width: 2.5px; border-radius: 1.25px; }
.mu-transport-s { position: absolute; right: 11px; bottom: 13px; }
.mu-transport-s .mu-btn { color: #fff; background: rgba(255,255,255,.2); }
.mu-transport-s .mu-play { background: rgba(255,255,255,.3); }

/* ---- medium ---- */
.mu-col { position: absolute; left: 166px; right: 20px; top: 22px; bottom: 16px; display: flex; flex-direction: column; }
.mu-now-m .mu-title { font-size: 14px; }
.mu-col .mu-progress { margin-top: auto; }
.mu-col .mu-transport { align-self: center; margin-top: 8px; }

/* ---- large ---- */
.mu-now-l { position: absolute; left: 184px; right: 18px; top: 26px; }
.mu-now-l .mu-title { font-size: 15px; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.mu-now-l .mu-artist, .mu-now-l .mu-album { font-size: 12px; }
.mu-strip { position: absolute; left: 20px; right: 20px; top: 184px; display: flex; flex-direction: column; gap: 8px; }
.mu-strip .mu-transport { align-self: center; }
.mu-upnext-list { position: absolute; left: 20px; right: 20px; top: 266px; display: flex; flex-direction: column; gap: 5px; }
.mu-upnext-row { display: flex; align-items: center; gap: 8px; height: 22px; }
.mu-upnext-art { flex: none; width: 22px; height: 22px; border-radius: 4px; box-shadow: 0 0 0 .5px rgba(0,0,0,.12); }
.mu-upnext-text { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; }
.mu-upnext-title { font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mu-upnext-artist { font-size: 10.5px; color: var(--go-ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mu-upnext-dur { flex: none; font-size: 10px; color: var(--go-ink-soft); }
`
