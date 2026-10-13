"use client"

import * as React from "react"
import { Pause, Play, SkipBack, SkipForward } from "lucide-react"
import { GlassObject, GlassPane, GlassSheet, LiquidCanvas, useGlass, useSpringVar, type LiquidRecipe } from "@/components/ui/glass-object"
import { ART_PRESETS, createArtJob, type ArtJob, type ArtPreset, type ArtRecipe } from "@/components/ui/glass-folder-cards"
import { WIDGET, type WidgetSize } from "../glass"
import { useWindowManager } from "../window-manager"

/**
 * Music — a record you can pick up, drawn as an object.
 *
 * Three layers: a liquid light at the back tinted from the current album's
 * palette, the record in the middle (generated album art as a square tile
 * that tilts with the object, and a real five-bar equaliser whose bars are
 * moved on rAF), and a frosted pane carrying the title, the artist, the
 * transport and a thin progress line along its top edge.
 *
 * - **Rest**: the art sits in the light; the bars idle low; the next tracks
 *   wait in the pocket behind the pane, their edges just showing.
 * - **Hover**: the art lifts and tilts a touch more than the object; the bars
 *   wake; the pane leans back.
 * - **Open** (click): the pane folds away; the art slides up and shrinks, the
 *   queue rises out of the pocket as white sheets, and a scrubbable progress
 *   bar appears under the art.
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

function Liquid({ cells, seed }: { cells?: number; seed: number }) {
  const { tone } = useGlass()
  const index = useIndex()
  const recipe = React.useMemo(() => liquidFor(TRACKS[index], tone), [index, tone])
  return <LiquidCanvas recipe={recipe} seed={seed} cells={cells} />
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
// Progress, times, scrubber: all written by ref.

function ProgressLine({ className }: { className?: string }) {
  const fill = React.useRef<HTMLSpanElement>(null)
  const write = React.useCallback((p: Player) => {
    if (fill.current) fill.current.style.transform = `scaleX(${(p.position / TRACKS[p.index].duration).toFixed(4)})`
  }, [])
  usePlayerDOM(write)
  return (
    <span aria-hidden="true" className={"mu-line" + (className ? " " + className : "")}>
      <span ref={fill} className="mu-line-fill" style={{ transform: `scaleX(${(INITIAL.position / TRACKS[INITIAL.index].duration).toFixed(4)})` }} />
    </span>
  )
}

type TimeKind = "elapsed" | "remaining" | "both"
const timeText = (p: Player, kind: TimeKind) => {
  const d = TRACKS[p.index].duration
  return kind === "elapsed" ? fmt(p.position) : kind === "remaining" ? "-" + fmt(d - p.position) : fmt(p.position) + " / " + fmt(d)
}

function Time({ kind, className }: { kind: TimeKind; className?: string }) {
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
    <span ref={ref} className={"go-mono" + (className ? " " + className : "")}>
      {timeText(INITIAL, kind)}
    </span>
  )
}

function Scrubber({ className }: { className?: string }) {
  const { open } = useGlass()
  const index = useIndex()
  const ref = React.useRef<HTMLDivElement>(null)
  const fill = React.useRef<HTMLSpanElement>(null)
  const rail = React.useRef<HTMLSpanElement>(null)
  const write = React.useCallback((p: Player) => {
    const d = TRACKS[p.index].duration
    const f = (p.position / d).toFixed(4)
    if (fill.current) fill.current.style.transform = `scaleX(${f})`
    if (rail.current) rail.current.style.transform = `translateX(${(Number(f) * 100).toFixed(2)}%)`
    ref.current?.setAttribute("aria-valuenow", String(Math.floor(p.position)))
    ref.current?.setAttribute("aria-valuetext", fmt(p.position) + " of " + fmt(d))
  }, [])
  usePlayerDOM(write)

  const seekAt = (clientX: number) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    store.seek(f * TRACKS[player.index].duration)
  }

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={open ? 0 : -1}
      aria-hidden={!open}
      aria-label="Playback position"
      aria-valuemin={0}
      aria-valuenow={Math.floor(INITIAL.position)}
      aria-valuemax={TRACKS[index].duration}
      className={"mu-scrub go-live" + (className ? " " + className : "")}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        seekAt(e.clientX)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e.clientX)
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 5 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -5 : 0
        if (step) {
          e.preventDefault()
          e.stopPropagation()
          store.seek(player.position + step)
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault()
          store.seek(e.key === "Home" ? 0 : TRACKS[player.index].duration)
        }
      }}
    >
      <span className="mu-scrub-track">
        <span ref={fill} className="mu-scrub-fill" />
      </span>
      <span ref={rail} className="mu-scrub-rail">
        <span className="mu-scrub-knob" />
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Transport

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

function Transport({ size, className }: { size: "sm" | "md" | "lg"; className?: string }) {
  const playing = usePlaying()
  const icon = size === "lg" ? 17 : size === "md" ? 15 : 13
  return (
    <div className={"mu-transport mu-transport-" + size + (className ? " " + className : "")}>
      <MuButton label="Previous track" onPress={store.prev}>
        <SkipBack size={icon} fill="currentColor" strokeWidth={1.6} />
      </MuButton>
      <MuButton label={playing ? "Pause" : "Play"} className="mu-play" onPress={store.toggle}>
        {playing ? <Pause size={icon} fill="currentColor" strokeWidth={0} /> : <Play size={icon} fill="currentColor" strokeWidth={0} className="mu-play-icon" />}
      </MuButton>
      <MuButton label="Next track" onPress={store.next}>
        <SkipForward size={icon} fill="currentColor" strokeWidth={1.6} />
      </MuButton>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The pocket: the queue as white sheets that rise when open.

function Queue({ count }: { count: number }) {
  const { open } = useGlass()
  const index = useIndex()
  const tracks = upNext(index, count)
  return (
    <>
      {tracks.map((t, i) => (
        <GlassSheet key={i} className="mu-row" style={{ "--i": i, "--d": (i * 0.1).toFixed(2) } as React.CSSProperties}>
          <button
            type="button"
            tabIndex={open ? 0 : -1}
            aria-hidden={!open}
            aria-label={`Play ${t.title} by ${t.artist}`}
            className="mu-row-btn go-live"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              store.play(TRACKS.indexOf(t))
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") e.stopPropagation()
            }}
          >
            <Art track={t} className="mu-row-art" />
            <span className="mu-row-text">
              <span className="mu-row-title">{t.title}</span>
              <span className="mu-row-artist">{t.artist}</span>
            </span>
            <span className="mu-row-dur go-mono">{fmt(t.duration)}</span>
          </button>
        </GlassSheet>
      ))}
    </>
  )
}

function NowText({ className }: { className?: string }) {
  const t = TRACKS[useIndex()]
  return (
    <span className={"mu-now" + (className ? " " + className : "")}>
      <span className="mu-title">{t.title}</span>
      <span className="mu-artist">{t.artist}</span>
    </span>
  )
}

function MainArt({ chip }: { chip: boolean }) {
  const index = useIndex()
  return (
    <div className="mu-art">
      <Art key={index} track={TRACKS[index]} className="mu-art-img">
        <span className="mu-art-sheen" />
        {chip ? (
          <span className="mu-chip">
            <Equalizer className="mu-eq-chip" />
          </span>
        ) : null}
      </Art>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sizes

/** The small object: art and bars in the light, the pane with the transport, three sheets in the pocket. */
function Small() {
  return (
    <>
      <Liquid seed={3} />
      <div className="mu-side" aria-hidden="true">
        <span className="mu-side-times">
          <Time kind="elapsed" className="mu-side-el" />
          <Time kind="remaining" className="mu-side-rem go-soft" />
        </span>
        <Equalizer className="mu-eq-side" />
      </div>
      <Queue count={3} />
      <MainArt chip={false} />
      <div className="mu-face">
        <NowText className="mu-now-face" />
        <Time kind="both" className="mu-face-time go-soft" />
      </div>
      <Scrubber className="mu-scrub-s" />
      <GlassPane hinge="bottom" lean={-10} openLean={-80} openShift={16} openFade={0.9} radius={18} className="mu-pane mu-pane-s">
        <ProgressLine />
        <div className="mu-pane-row">
          <NowText />
          <Transport size="sm" />
        </div>
      </GlassPane>
    </>
  )
}

/** The wide object: art on the left, the pane on the right; open swings the pane away to show the queue. */
function Medium() {
  return (
    <>
      <Liquid seed={6} cells={120} />
      <Queue count={3} />
      <MainArt chip />
      <div className="mu-face">
        <Scrubber />
        <span className="mu-face-times">
          <Time kind="elapsed" />
          <Time kind="remaining" />
        </span>
        <NowText className="mu-now-face" />
      </div>
      <GlassPane hinge="right" lean={-7} openLean={-82} openFade={0.92} radius={18} className="mu-pane mu-pane-m">
        <div className="mu-pane-col">
          <span className="mu-kicker go-mono">Now Playing</span>
          <NowText />
          <ProgressLine className="mu-line-m" />
          <span className="mu-pane-times">
            <Time kind="elapsed" />
            <Time kind="remaining" />
          </span>
          <Transport size="md" />
        </div>
      </GlassPane>
    </>
  )
}

/** The big object: big art centred in the light; open fans the whole queue. */
function Large() {
  return (
    <>
      <Liquid seed={9} cells={120} />
      <Queue count={TRACKS.length - 1} />
      <MainArt chip />
      <div className="mu-face">
        <NowText className="mu-now-face" />
        <Scrubber />
        <span className="mu-face-times">
          <Time kind="elapsed" />
          <Time kind="remaining" />
        </span>
      </div>
      <span className="mu-upnext go-mono" aria-hidden="true">
        Up Next
      </span>
      <GlassPane hinge="bottom" lean={-8} openLean={-78} openShift={18} openFade={0.9} radius={18} className="mu-pane mu-pane-l">
        <ProgressLine />
        <div className="mu-pane-top">
          <NowText />
          <Time kind="both" className="mu-pane-both go-soft" />
        </div>
        <Transport size="lg" />
      </GlassPane>
    </>
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
.mu-root .go-liquid { border-radius: 24px; }
.mu-root[data-tone="dark"] .mu-back { box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 0 0 .5px rgba(255,255,255,.1); }

/* art */
.mu-art-tile { position: relative; overflow: hidden; }
.mu-art-tile > canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; opacity: 0; }
.mu-art {
  position: absolute; left: var(--ax); top: var(--ay); width: var(--as); height: var(--as);
  transform-origin: 50% 50%;
  transform:
    translate(calc(var(--go-open) * var(--adx)), calc(var(--go-open) * var(--ady) - var(--go-hover) * (1 - var(--go-open)) * 4px))
    perspective(520px)
    rotateX(calc(var(--go-py) * var(--go-hover) * -8deg))
    rotateY(calc(var(--go-px) * var(--go-hover) * 10deg))
    scale(calc(1 + var(--go-hover) * (1 - var(--go-open)) * .035 - var(--go-open) * var(--ads) - var(--go-press) * .015));
}
.mu-art-img {
  position: absolute; inset: 0; border-radius: var(--ar);
  box-shadow:
    0 0 0 .5px rgba(0,0,0,.14),
    0 calc(7px + var(--go-hover) * 7px) calc(16px + var(--go-hover) * 12px) -7px rgba(16,18,24,.5);
}
.mu-root[data-tone="dark"] .mu-art-img { box-shadow: 0 0 0 .5px rgba(255,255,255,.14), 0 calc(8px + var(--go-hover) * 7px) calc(18px + var(--go-hover) * 12px) -6px rgba(0,0,0,.75); }
.mu-art-sheen {
  position: absolute; inset: 0; border-radius: inherit;
  background:
    radial-gradient(110% 80% at calc(25% + var(--go-px) * 35%) calc(-5% + var(--go-py) * 30%), rgba(255,255,255,calc(.2 + var(--go-hover) * .16)), rgba(255,255,255,0) 58%),
    linear-gradient(180deg, rgba(255,255,255,0) 60%, rgba(0,0,0,.12));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.35), inset 0 0 0 .5px rgba(255,255,255,.18);
}

/* equaliser */
.mu-eq { display: flex; align-items: flex-end; }
.mu-bar { position: relative; display: block; height: 100%; overflow: hidden; }
.mu-bar-in { position: absolute; inset: 0; display: block; border-radius: inherit; background: currentColor; }
.mu-eq-side { height: 34px; gap: 3px; color: var(--go-ink); opacity: .78; }
.mu-eq-side .mu-bar { width: 4px; border-radius: 2px; }
.mu-chip {
  position: absolute; left: 8px; bottom: 8px; display: flex; padding: 5px 6px; border-radius: 8px;
  background: rgba(10,10,14,.34); -webkit-backdrop-filter: blur(8px) saturate(1.4); backdrop-filter: blur(8px) saturate(1.4);
  box-shadow: inset 0 0 0 .5px rgba(255,255,255,.22);
  opacity: calc(.82 + var(--go-hover) * .18);
}
.mu-eq-chip { height: 13px; gap: 2px; color: #fff; }
.mu-eq-chip .mu-bar { width: 3px; border-radius: 1.5px; }

/* text */
.mu-now { display: flex; flex-direction: column; min-width: 0; }
.mu-title, .mu-artist { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mu-title { font-size: 12px; font-weight: 600; letter-spacing: -.01em; line-height: 1.25; }
.mu-artist { font-size: 10.5px; color: var(--go-ink-soft); line-height: 1.25; }

/* pane */
.mu-pane .go-pane-body { overflow: hidden; }
.mu-root[data-open] .mu-pane .go-live { pointer-events: none; }
.mu-line { position: absolute; left: 16px; right: 16px; top: 0; height: 2px; border-radius: 0 0 2px 2px; overflow: hidden; background: var(--go-ink-faint); }
.mu-line-fill { position: absolute; inset: 0; display: block; background: var(--go-ink); opacity: .62; transform-origin: 0 50%; }
.mu-transport { display: flex; align-items: center; flex: none; }
.mu-btn {
  all: unset; box-sizing: border-box; display: grid; place-items: center; flex: none;
  width: 22px; height: 26px; border-radius: 8px; color: var(--go-ink); cursor: pointer;
  transform: scale(calc(1 - var(--mu-b, 0) * .14));
}
.mu-btn:focus-visible { outline: 2px solid #4c8dff; outline-offset: 1px; }
.mu-btn.mu-play {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--go-ink); color: rgb(var(--go-glass));
  box-shadow: 0 4px 10px -4px var(--go-shadow);
}
.mu-play-icon { translate: 1px 0; }
.mu-transport-sm { gap: 0; margin-right: -2px; }
.mu-transport-sm .mu-btn { width: 19px; }
.mu-transport-sm .mu-btn.mu-play { width: 27px; height: 27px; margin: 0 1px; }
.mu-transport-md { gap: 10px; }
.mu-transport-md .mu-btn { width: 28px; height: 30px; }
.mu-transport-md .mu-btn.mu-play { width: 34px; height: 34px; }
.mu-transport-lg { gap: 14px; }
.mu-transport-lg .mu-btn { width: 32px; height: 34px; }
.mu-transport-lg .mu-btn.mu-play { width: 40px; height: 40px; }

/* the pocket */
.mu-row {
  --p: max(0, (var(--go-open) - var(--d)) / (1 - var(--d)));
  left: var(--qx); top: calc(var(--qy) + var(--i) * var(--qstep)); width: var(--qw); height: var(--qh);
  border-radius: var(--qr, 10px);
  transform-origin: 50% 0%;
  transform:
    translate(calc((1 - var(--p)) * var(--rx)), calc((1 - var(--p)) * (var(--ry) - var(--i) * var(--rystep))))
    rotate(calc((1 - var(--p)) * (var(--i) - 1) * var(--rrot, 2deg)))
    scale(calc(1 - (1 - var(--p)) * var(--rs)));
}
.mu-root:not([data-open]) .mu-row-btn { pointer-events: none; }
.mu-row-btn {
  all: unset; box-sizing: border-box; position: absolute; inset: 0; display: flex; align-items: center; gap: var(--rgap, 7px);
  padding: 0 9px 0 4px; cursor: pointer; color: #141416; border-radius: inherit;
}
.mu-root[data-tone="dark"] .mu-row-btn { color: #f5f5f7; }
.mu-row-btn:focus-visible { outline: 2px solid #4c8dff; outline-offset: -2px; }
.mu-row-art { flex: none; width: var(--ra); height: var(--ra); border-radius: 5px; box-shadow: 0 0 0 .5px rgba(0,0,0,.12); }
.mu-row-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.mu-row-title, .mu-row-artist { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; }
.mu-row-title { font-size: var(--rt, 10.5px); font-weight: 600; letter-spacing: -.005em; }
.mu-row-artist { font-size: var(--rta, 9px); opacity: .55; }
.mu-row-dur { flex: none; font-size: 9.5px; opacity: .5; font-variant-numeric: tabular-nums; }

/* the open face */
.mu-face {
  position: absolute;
  opacity: var(--go-open);
  transform: translateY(calc((1 - var(--go-open)) * 8px));
}
.mu-root:not([data-open]) .mu-face, .mu-root:not([data-open]) .mu-scrub { pointer-events: none; }
.mu-scrub { position: relative; height: 14px; cursor: pointer; touch-action: none; opacity: var(--go-open); }
.mu-scrub:focus-visible { outline: 2px solid #4c8dff; outline-offset: 2px; border-radius: 4px; }
.mu-scrub-track { position: absolute; left: 0; right: 0; top: 5px; height: 4px; border-radius: 2px; overflow: hidden; background: var(--go-ink-faint); }
.mu-scrub-fill { position: absolute; inset: 0; display: block; background: var(--go-ink); opacity: .75; transform-origin: 0 50%; transform: scaleX(0); }
.mu-scrub-rail { position: absolute; inset: 0; display: block; pointer-events: none; }
.mu-scrub-knob {
  position: absolute; left: -5px; top: 2px; width: 10px; height: 10px; border-radius: 50%;
  background: #fff; box-shadow: 0 0 0 .5px rgba(0,0,0,.18), 0 2px 5px rgba(0,0,0,.25);
  transform: scale(calc(.75 + var(--go-hover) * .25));
}
.mu-face-times { display: flex; justify-content: space-between; font-size: 9.5px; color: var(--go-ink-soft); font-variant-numeric: tabular-nums; }

/* ---- small ---- */
.mu-small { --ax: 14px; --ay: 13px; --as: 92px; --ar: 12px; --adx: -24px; --ady: -25px; --ads: .478; }
.mu-side {
  position: absolute; left: 114px; right: 14px; top: 14px; height: 91px;
  display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end;
  opacity: calc(1 - var(--go-open) * 1.4);
  transform: translateY(calc(var(--go-open) * -10px + var(--go-hover) * -2px));
}
.mu-side-times { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; font-variant-numeric: tabular-nums; }
.mu-side-el { font-size: 11px; font-weight: 600; }
.mu-side-rem { font-size: 9.5px; }
.mu-small .mu-row { --qx: 12px; --qy: 76px; --qstep: 30px; --qw: 146px; --qh: 27px; --qr: 9px; --rx: 0px; --ry: 30px; --rystep: 27px; --ra: 19px; --rgap: 6px; --rt: 10.5px; --rta: 9px; }
.mu-small .mu-row { --rs: calc(.12 - var(--i) * .04); }
.mu-small .mu-face { left: 68px; right: 12px; top: 13px; display: flex; flex-direction: column; gap: 3px; }
.mu-small .mu-now-face .mu-title { font-size: 11.5px; }
.mu-small .mu-now-face .mu-artist { font-size: 10px; }
.mu-face-time { font-size: 9.5px; font-variant-numeric: tabular-nums; }
.mu-scrub-s { position: absolute; left: 12px; right: 12px; top: 58px; }
.mu-pane-s { top: auto; bottom: 0; height: 56px; }
.mu-pane-row { position: absolute; inset: 0; display: flex; align-items: center; gap: 4px; padding: 2px 8px 0 13px; }
.mu-pane-row .mu-now { flex: 1; }

/* ---- medium ---- */
.mu-medium { --ax: 20px; --ay: 21px; --as: 128px; --ar: 14px; --adx: 2px; --ady: -29px; --ads: .3125; }
.mu-medium .mu-row { --qx: 158px; --qy: 16px; --qstep: 48px; --qw: 192px; --qh: 42px; --qr: 12px; --rx: 12px; --ry: 30px; --rystep: 24px; --rs: .05; --rrot: 1.5deg; --ra: 30px; --rgap: 9px; --rt: 11.5px; --rta: 10px; }
.mu-medium .mu-row-btn { padding: 0 12px 0 6px; }
.mu-medium .mu-face { left: 26px; width: 120px; top: 108px; display: flex; flex-direction: column; gap: 1px; }
.mu-medium .mu-now-face { align-items: center; text-align: center; margin-top: 3px; }
.mu-medium .mu-now-face .mu-title { font-size: 11.5px; max-width: 100%; }
.mu-medium .mu-now-face .mu-artist { font-size: 10px; max-width: 100%; }
.mu-pane-m { left: 162px; top: 12px; right: 12px; bottom: 12px; }
.mu-pane-col { position: absolute; inset: 0; display: flex; flex-direction: column; padding: 14px 16px 10px; }
.mu-kicker { font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: var(--go-ink-soft); margin-bottom: 5px; }
.mu-pane-m .mu-title { font-size: 14px; }
.mu-pane-m .mu-artist { font-size: 11.5px; }
.mu-line.mu-line-m { position: relative; left: auto; right: auto; top: auto; display: block; flex: none; margin-top: auto; height: 3px; border-radius: 2px; }
.mu-pane-times { display: flex; justify-content: space-between; margin-top: 4px; padding-bottom: 6px; font-size: 9.5px; color: var(--go-ink-soft); font-variant-numeric: tabular-nums; }
.mu-pane-m .mu-transport { align-self: center; }

/* ---- large ---- */
.mu-large { --ax: 84px; --ay: 30px; --as: 196px; --ar: 18px; --adx: -116px; --ady: -62px; --ads: .49; }
.mu-large .mu-row { --qx: 16px; --qy: 140px; --qstep: 42px; --qw: 332px; --qh: 37px; --qr: 11px; --rx: 0px; --ry: 106px; --rystep: 38px; --rs: calc(.1 - var(--i) * .015); --rrot: 1deg; --ra: 27px; --rgap: 9px; --rt: 12px; --rta: 10.5px; }
.mu-large .mu-row-btn { padding: 0 12px 0 5px; }
.mu-large .mu-face { left: 128px; right: 18px; top: 20px; display: flex; flex-direction: column; gap: 2px; }
.mu-large .mu-now-face { margin-bottom: 12px; }
.mu-large .mu-now-face .mu-title { font-size: 15px; }
.mu-large .mu-now-face .mu-artist { font-size: 12px; }
.mu-large .mu-face-times { font-size: 10px; }
.mu-upnext {
  position: absolute; left: 20px; top: 121px; font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--go-ink-soft);
  opacity: var(--go-open); transform: translateY(calc((1 - var(--go-open)) * 8px));
}
.mu-pane-l { top: auto; bottom: 0; height: 104px; }
.mu-pane-top { position: absolute; left: 18px; right: 18px; top: 16px; display: flex; align-items: flex-start; gap: 12px; }
.mu-pane-top .mu-now { flex: 1; }
.mu-pane-l .mu-title { font-size: 14.5px; }
.mu-pane-l .mu-artist { font-size: 11.5px; }
.mu-pane-both { flex: none; font-size: 10px; padding-top: 3px; font-variant-numeric: tabular-nums; }
.mu-pane-l .mu-transport { position: absolute; left: 0; right: 0; bottom: 10px; justify-content: center; }
`
