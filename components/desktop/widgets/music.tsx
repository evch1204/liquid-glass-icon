"use client"

import * as React from "react"
import {
  Clock,
  Disc3,
  LayoutGrid,
  ListMusic,
  Mic2,
  Music,
  Music2,
  Pause,
  Play,
  PlayCircle,
  Radio,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  SquarePlay,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react"
import { createArtJob, type ArtJob, type ArtRecipe, ART_PRESETS, type ArtPreset } from "@/components/ui/glass-folder-cards"
import { cn } from "@/lib/utils"
import { Widget, type WidgetSize } from "../glass"
import { GlassWindow, type WindowState } from "../window-manager"

/**
 * Music. There is no audio: a six-track queue, a shared clock that advances
 * the position while "playing", and album art painted by the same generator
 * as the folders and the wallpaper. The widget and the window read one store,
 * so they always agree.
 */

// ---------------------------------------------------------------------------
// The queue

type Track = { id: string; title: string; artist: string; album: string; duration: number; art: ArtPreset | ArtRecipe; seed: number }

const TRACKS: Track[] = [
  { id: "t1", title: "Low Tide Static", artist: "Hollow Coast", album: "Salt Glass", duration: 214, art: "glacier", seed: 11 },
  { id: "t2", title: "Ember Season", artist: "Marrow & Vane", album: "Red Water", duration: 247, art: "ember", seed: 4 },
  {
    id: "t3",
    title: "Satellites in Velvet",
    artist: "Nadia Orr",
    album: "Night Bloom",
    duration: 188,
    art: { style: "marble", colors: ["#0b0820", "#2d1b69", "#7c4dff", "#1a1033", "#ff6ec7", "#ffd1f0"], scale: 0.7, warp: 3.2, angle: 1.2, gloss: 0.6, veins: 0.4 },
    seed: 23,
  },
  { id: "t4", title: "Paper Lanterns", artist: "The Quiet Hours", album: "Dusk Tapes", duration: 231, art: "dusk", seed: 8 },
  { id: "t5", title: "Moss Garden", artist: "Juniper Field", album: "Verdant", duration: 202, art: "verdant", seed: 2 },
  {
    id: "t6",
    title: "Long Exposure",
    artist: "Hollow Coast",
    album: "Salt Glass",
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

// ---------------------------------------------------------------------------
// Player store (module-level, shared by every widget and window)

type RepeatMode = "off" | "all" | "one"
type Player = { playing: boolean; index: number; position: number; shuffle: boolean; repeat: RepeatMode; volume: number; muted: boolean }

const INITIAL: Player = { playing: false, index: 0, position: 42, shuffle: false, repeat: "off", volume: 0.7, muted: false }

let player: Player = INITIAL
const listeners = new Set<() => void>()
let ticker: ReturnType<typeof setInterval> | undefined
let lastTick = 0

function emit() {
  listeners.forEach((l) => l())
}

function setPlayer(patch: Partial<Player>) {
  player = { ...player, ...patch }
  syncTicker()
  emit()
}

function nextIndex(dir: 1 | -1) {
  const n = TRACKS.length
  if (player.shuffle && dir === 1) return (player.index + 1 + Math.floor(Math.random() * (n - 1))) % n
  return (player.index + dir + n) % n
}

function tick() {
  const t = performance.now()
  const dt = (t - lastTick) / 1000
  lastTick = t
  const track = TRACKS[player.index]
  let position = player.position + dt
  if (position < track.duration) {
    player = { ...player, position }
    emit()
    return
  }
  // the track ran out
  if (player.repeat === "one") position = 0
  else if (player.index === TRACKS.length - 1 && player.repeat === "off" && !player.shuffle) {
    setPlayer({ index: 0, position: 0, playing: false })
    return
  } else {
    setPlayer({ index: nextIndex(1), position: 0 })
    return
  }
  player = { ...player, position }
  emit()
}

function syncTicker() {
  if (player.playing && !ticker) {
    lastTick = performance.now()
    ticker = setInterval(tick, 250)
  } else if (!player.playing && ticker) {
    clearInterval(ticker)
    ticker = undefined
  }
}

const actions = {
  toggle: () => setPlayer({ playing: !player.playing }),
  play: (index: number) => setPlayer({ index, position: 0, playing: true }),
  next: () => setPlayer({ index: nextIndex(1), position: 0 }),
  prev: () => (player.position > 3 ? setPlayer({ position: 0 }) : setPlayer({ index: nextIndex(-1), position: 0 })),
  seek: (position: number) => {
    lastTick = performance.now()
    setPlayer({ position: Math.max(0, Math.min(TRACKS[player.index].duration - 0.5, position)) })
  },
  shuffle: () => setPlayer({ shuffle: !player.shuffle }),
  repeat: () => setPlayer({ repeat: player.repeat === "off" ? "all" : player.repeat === "all" ? "one" : "off" }),
  volume: (v: number) => setPlayer({ volume: Math.max(0, Math.min(1, v)), muted: false }),
  mute: () => setPlayer({ muted: !player.muted }),
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function usePlayer(): Player {
  return React.useSyncExternalStore(
    subscribe,
    () => player,
    () => INITIAL,
  )
}

// ---------------------------------------------------------------------------
// Album art: painted once per recipe + seed + size, time-sliced over frames

const ART_PX = 160
const artCache = new Map<string, { canvas: HTMLCanvasElement | null; promise: Promise<HTMLCanvasElement> }>()
const artQueue: { job: ArtJob; done: (c: HTMLCanvasElement) => void }[] = []
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
        head.done(c)
      }
    }
    if (artQueue.length) requestAnimationFrame(frame)
    else artPumping = false
  }
  requestAnimationFrame(frame)
}

function paintArt(recipe: ArtRecipe, seed: number, size: number) {
  const key = JSON.stringify([recipe, seed, size])
  let entry = artCache.get(key)
  if (!entry) {
    let resolve: (c: HTMLCanvasElement) => void = () => {}
    const e = { canvas: null as HTMLCanvasElement | null, promise: new Promise<HTMLCanvasElement>((r) => (resolve = r)) }
    artQueue.push({
      job: createArtJob(size, size, recipe, seed),
      done: (c) => {
        e.canvas = c
        resolve(c)
      },
    })
    pumpArt()
    artCache.set(key, e)
    entry = e
  }
  return entry
}

/** Generated album art. Fills its box; fades in once painted, instantly when cached. */
function AlbumArt({ track, className, rounded = "rounded-lg" }: { track: Track; className?: string; rounded?: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  const recipe = recipeOf(track.art)
  const key = JSON.stringify(recipe)
  const seed = track.seed

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    let live = true
    const entry = paintArt(JSON.parse(key) as ArtRecipe, seed, ART_PX)
    const draw = (src: HTMLCanvasElement, fade: boolean) => {
      if (!live) return
      el.width = src.width
      el.height = src.height
      el.getContext("2d")?.drawImage(src, 0, 0)
      el.style.transition = fade ? "opacity .5s var(--glass-ease)" : "none"
      el.style.opacity = "1"
    }
    if (entry.canvas) draw(entry.canvas, false)
    else {
      el.style.transition = "none"
      el.style.opacity = "0"
      entry.promise.then((c) => requestAnimationFrame(() => draw(c, true)))
    }
    return () => {
      live = false
    }
  }, [key, seed])

  return (
    <div
      aria-hidden="true"
      className={cn("relative overflow-hidden", rounded, className)}
      style={{ background: `linear-gradient(135deg, ${recipe.colors.slice(0, 4).join(", ")})` }}
    >
      <canvas ref={ref} className="absolute inset-0 size-full opacity-0" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Motion

const MU_CSS = `
@keyframes mu-eq { 0%, 100% { transform: scaleY(.25) } 50% { transform: scaleY(1) } }
.mu-eq > span { transform-origin: bottom; transform: scaleY(.25); animation: mu-eq .9s ease-in-out infinite; animation-play-state: paused }
.mu-eq[data-on] > span { animation-play-state: running }
@media (prefers-reduced-motion: reduce) { .mu-eq > span { animation: none; transform: scaleY(.6) } }
`

function MusicStyles() {
  return (
    <style href="glass-music" precedence="default">
      {MU_CSS}
    </style>
  )
}

const EQ = [
  { d: 0.82, delay: -0.2 },
  { d: 1.04, delay: -0.55 },
  { d: 0.7, delay: -0.1 },
  { d: 0.96, delay: -0.7 },
  { d: 0.78, delay: -0.35 },
]

function Equalizer({ on, bars = 5, className, barClassName }: { on: boolean; bars?: number; className?: string; barClassName?: string }) {
  return (
    <span aria-hidden="true" data-on={on || undefined} className={cn("mu-eq inline-flex items-end gap-[2px]", className)}>
      {EQ.slice(0, bars).map((b, i) => (
        <span key={i} className={cn("h-full w-[3px] rounded-full bg-current", barClassName)} style={{ animationDuration: `${b.d}s`, animationDelay: `${b.delay}s` }} />
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Controls

function IconButton({
  label,
  onClick,
  children,
  active,
  className,
  pressed,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  active?: boolean
  pressed?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      data-no-drag
      aria-label={label}
      aria-pressed={pressed}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "grid shrink-0 place-items-center rounded-full transition-[transform,background,color,opacity] duration-200 [transition-timing-function:var(--glass-ease)]",
        "hover:bg-[var(--glass-hover)] active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--glass-accent)]",
        active === false && "opacity-55 hover:opacity-90",
        active && "text-[var(--glass-accent)]",
        className,
      )}
    >
      {children}
    </button>
  )
}

/** A scrubbable horizontal slider: click or drag to set, arrow keys to nudge. */
function Slider({
  value,
  max,
  onChange,
  label,
  valueText,
  step,
  className,
  thin,
}: {
  value: number
  max: number
  onChange: (v: number) => void
  label: string
  valueText?: string
  step: number
  className?: string
  thin?: boolean
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [drag, setDrag] = React.useState<number | null>(null)
  const shown = drag ?? value
  const pct = max > 0 ? Math.max(0, Math.min(1, shown / max)) * 100 : 0

  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * max
  }

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      data-no-drag
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={valueText}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        const v = at(e.clientX)
        setDrag(v)
        onChange(v)
      }}
      onPointerMove={(e) => {
        if (drag === null) return
        const v = at(e.clientX)
        setDrag(v)
        onChange(v)
      }}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : 0
        if (e.key === "Home") onChange(0)
        else if (e.key === "End") onChange(max)
        else if (d) onChange(Math.max(0, Math.min(max, value + d)))
        else return
        e.preventDefault()
      }}
      className={cn(
        "group/slider relative flex h-4 cursor-pointer touch-none items-center rounded-full outline-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--glass-accent)]",
        className,
      )}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-[var(--glass-ink-faint)] transition-[height] duration-200 [transition-timing-function:var(--glass-ease)]",
          thin ? "h-1 group-hover/slider:h-1.5" : "h-1.5 group-hover/slider:h-2",
          drag !== null && (thin ? "h-1.5" : "h-2"),
        )}
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--glass-ink-soft)] group-hover/slider:bg-[var(--glass-ink)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Scrubber({ p, track, className, labels = true }: { p: Player; track: Track; className?: string; labels?: boolean }) {
  return (
    <div className={cn("min-w-0", className)}>
      <Slider
        value={p.position}
        max={track.duration}
        step={5}
        onChange={actions.seek}
        label="Playback position"
        valueText={`${fmt(p.position)} of ${fmt(track.duration)}`}
      />
      {labels ? (
        <div className="flex justify-between font-mono text-[10.5px] tabular-nums ink-soft">
          <span>{fmt(p.position)}</span>
          <span>-{fmt(track.duration - p.position)}</span>
        </div>
      ) : null}
    </div>
  )
}

function Transport({ p, size = "md", className }: { p: Player; size?: "md" | "lg"; className?: string }) {
  const lg = size === "lg"
  const s = lg ? "size-9 [&_svg]:size-5" : "size-7 [&_svg]:size-4"
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <IconButton label="Shuffle" pressed={p.shuffle} active={p.shuffle} onClick={actions.shuffle} className={cn(s, "[&_svg]:size-3.5", lg && "[&_svg]:size-4")}>
        <Shuffle />
      </IconButton>
      <IconButton label="Previous" onClick={actions.prev} className={s}>
        <SkipBack className="fill-current" />
      </IconButton>
      <IconButton label={p.playing ? "Pause" : "Play"} onClick={actions.toggle} className={cn(lg ? "size-12 [&_svg]:size-7" : "size-9 [&_svg]:size-5")}>
        {p.playing ? <Pause className="fill-current" /> : <Play className="translate-x-[1px] fill-current" />}
      </IconButton>
      <IconButton label="Next" onClick={actions.next} className={s}>
        <SkipForward className="fill-current" />
      </IconButton>
      <IconButton
        label={p.repeat === "one" ? "Repeat one" : p.repeat === "all" ? "Repeat all" : "Repeat off"}
        pressed={p.repeat !== "off"}
        active={p.repeat !== "off"}
        onClick={actions.repeat}
        className={cn(s, "[&_svg]:size-3.5", lg && "[&_svg]:size-4")}
      >
        {p.repeat === "one" ? <Repeat1 /> : <Repeat />}
      </IconButton>
    </div>
  )
}

function upNext(p: Player, count: number) {
  return Array.from({ length: Math.min(count, TRACKS.length - 1) }, (_, i) => ({ track: TRACKS[(p.index + 1 + i) % TRACKS.length], index: (p.index + 1 + i) % TRACKS.length }))
}

// ---------------------------------------------------------------------------
// Widget

export function MusicWidget({ size = "small", className }: { size?: WidgetSize; className?: string }) {
  const p = usePlayer()
  const track = TRACKS[p.index]
  const label = `Music, ${p.playing ? "playing" : "paused"}: ${track.title} by ${track.artist}`

  if (size === "small") {
    return (
      <Widget size={size} label={label} className={cn("text-white", className)}>
        <MusicStyles />
        <AlbumArt track={track} rounded="rounded-none" className="absolute inset-0" />
        <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.12)_0%,transparent_30%,rgba(0,0,0,.18)_50%,rgba(0,0,0,.72)_100%)]" />
        <div className="relative flex h-full flex-col p-3">
          <div className="flex items-start justify-between">
            <span className="grid size-6 place-items-center rounded-md bg-[linear-gradient(180deg,#ff5c75,#fa233b)] shadow-sm">
              <Music2 className="size-3.5 text-white" aria-hidden="true" />
            </span>
            <Equalizer on={p.playing} className={cn("h-3.5 transition-opacity duration-300", p.playing ? "opacity-100" : "opacity-0")} />
          </div>
          <div className="mt-auto min-w-0 [text-shadow:0_1px_6px_rgba(0,0,0,.35)]">
            <p className="truncate text-[13px] leading-tight font-semibold">{track.title}</p>
            <p className="truncate text-[11.5px] leading-tight text-white/75">{track.artist}</p>
          </div>
          <div className="mt-1.5 flex items-center gap-1">
            <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/25" aria-hidden="true">
              <div className="h-full rounded-full bg-white/90" style={{ width: `${(p.position / track.duration) * 100}%` }} />
            </div>
            <IconButton label={p.playing ? "Pause" : "Play"} onClick={actions.toggle} className="size-7 hover:bg-white/15 [&_svg]:size-4">
              {p.playing ? <Pause className="fill-current" /> : <Play className="translate-x-[1px] fill-current" />}
            </IconButton>
            <IconButton label="Next" onClick={actions.next} className="size-7 hover:bg-white/15 [&_svg]:size-4">
              <SkipForward className="fill-current" />
            </IconButton>
          </div>
        </div>
      </Widget>
    )
  }

  return (
    <Widget size={size} label={label} className={className}>
      <MusicStyles />
      <div className="flex h-full flex-col p-3.5">
        <div className="flex h-[142px] shrink-0 gap-3.5">
          <div className="relative size-[142px] shrink-0">
            <AlbumArt track={track} rounded="rounded-xl" className="size-full shadow-[0_8px_20px_-8px_rgba(0,0,0,.45),0_0_0_.5px_rgba(0,0,0,.12)]" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[13.5px] leading-tight font-semibold ink">{track.title}</p>
                <p className="truncate text-[12px] leading-tight ink-soft">{track.artist}</p>
                <p className="truncate text-[11.5px] leading-tight ink-soft opacity-80">{track.album}</p>
              </div>
              <Equalizer on={p.playing} className={cn("mt-0.5 h-3 shrink-0 text-[#fa233b] transition-opacity", p.playing ? "opacity-100" : "opacity-0")} />
            </div>
            <Scrubber p={p} track={track} className="mt-auto" />
            <Transport p={p} className="mt-1 -mx-1 ink" />
          </div>
        </div>
        {size === "large" ? (
          <>
            <div className="mt-3 mb-1.5 flex items-baseline justify-between">
              <p className="text-[11px] font-semibold tracking-wide uppercase ink-soft">Up Next</p>
              <p className="text-[11px] ink-soft">{TRACKS.length - 1} songs</p>
            </div>
            <ul className="flex min-h-0 flex-1 flex-col justify-between">
              {upNext(p, 4).map(({ track: t, index }) => (
                <li key={t.id}>
                  <button
                    type="button"
                    data-no-drag
                    onClick={() => actions.play(index)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-[var(--glass-hover)] focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)]"
                  >
                    <AlbumArt track={t} rounded="rounded-[5px]" className="size-8 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] leading-tight font-medium ink">{t.title}</span>
                      <span className="block truncate text-[11px] leading-tight ink-soft">{t.artist}</span>
                    </span>
                    <span className="font-mono text-[10.5px] tabular-nums ink-soft">{fmt(t.duration)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </Widget>
  )
}

// ---------------------------------------------------------------------------
// Window

const SIDEBAR: { group: string | null; items: { label: string; icon: React.ReactNode }[] }[] = [
  {
    group: null,
    items: [
      { label: "Listen Now", icon: <PlayCircle /> },
      { label: "Browse", icon: <LayoutGrid /> },
      { label: "Radio", icon: <Radio /> },
    ],
  },
  {
    group: "Library",
    items: [
      { label: "Recently Added", icon: <Clock /> },
      { label: "Artists", icon: <Mic2 /> },
      { label: "Albums", icon: <SquarePlay /> },
      { label: "Songs", icon: <Music /> },
    ],
  },
  {
    group: "Playlists",
    items: [
      { label: "Glass Desk Mix", icon: <ListMusic /> },
      { label: "Late Night Focus", icon: <ListMusic /> },
      { label: "Field Recordings", icon: <ListMusic /> },
    ],
  },
]

export function MusicWindow({ win }: { win: WindowState }) {
  const p = usePlayer()
  const track = TRACKS[p.index]
  const [section, setSection] = React.useState("Listen Now")
  const vol = p.muted ? 0 : p.volume

  return (
    <GlassWindow win={win} icon={<Music2 />} minW={620} minH={460}>
      <MusicStyles />
      <div className="@container flex h-full" data-no-drag>
        {/* sidebar */}
        <nav aria-label="Music library" className="hidden w-48 shrink-0 flex-col gap-3 overflow-y-auto border-r border-[var(--glass-ink-faint)] p-2 @2xl:flex">
          {SIDEBAR.map((g) => (
            <div key={g.group ?? "top"}>
              {g.group ? <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide ink-soft">{g.group}</p> : null}
              <ul className="flex flex-col gap-px">
                {g.items.map((it) => (
                  <li key={it.label}>
                    <button
                      type="button"
                      aria-current={section === it.label ? "page" : undefined}
                      onClick={() => setSection(it.label)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] ink transition-colors hover:bg-[var(--glass-hover)]",
                        "focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)] [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-[#fa233b]",
                        section === it.label && "bg-[var(--glass-ink-faint)]",
                      )}
                    >
                      {it.icon}
                      <span className="truncate">{it.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* now playing hero, with a blurred copy of the art behind it as ambience */}
          <section aria-label="Now Playing" className="relative shrink-0 overflow-hidden border-b border-[var(--glass-ink-faint)]">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-60 dark:opacity-45">
              <AlbumArt track={track} rounded="rounded-none" className="absolute inset-[-25%] scale-110 blur-[48px] saturate-150" />
            </div>
            <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(180deg,transparent,var(--glass-bg)_95%)]" />
            <div className="relative flex items-end gap-5 p-5">
              <AlbumArt
                track={track}
                rounded="rounded-xl"
                className={cn(
                  "size-[150px] shrink-0 shadow-[0_18px_40px_-14px_rgba(0,0,0,.55),0_0_0_.5px_rgba(0,0,0,.15)] transition-transform duration-500 [transition-timing-function:var(--glass-spring)] @3xl:size-[184px]",
                  p.playing ? "scale-100" : "scale-[.94]",
                )}
              />
              <div className="flex max-w-[640px] min-w-0 flex-1 flex-col">
                <p className="text-[11px] font-semibold tracking-[0.12em] text-[#fa233b] uppercase">Now Playing</p>
                <h2 className="mt-1 truncate text-[22px] leading-tight font-bold tracking-tight ink">{track.title}</h2>
                <p className="truncate text-[14px] ink-soft">
                  {track.artist} — {track.album}
                </p>
                <Scrubber p={p} track={track} className="mt-4" />
                <div className="mt-1 flex items-center gap-4">
                  <Transport p={p} size="lg" className="w-[240px] ink" />
                  <div className="ml-auto flex w-36 items-center gap-1.5 ink-soft">
                    <IconButton label={p.muted ? "Unmute" : "Mute"} onClick={actions.mute} className="size-6 [&_svg]:size-4">
                      {vol === 0 ? <VolumeX /> : vol < 0.5 ? <Volume1 /> : <Volume2 />}
                    </IconButton>
                    <Slider
                      value={vol}
                      max={1}
                      step={0.05}
                      onChange={actions.volume}
                      label="Volume"
                      valueText={`${Math.round(vol * 100)}%`}
                      thin
                      className="flex-1"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* the queue */}
          <section aria-label="Queue" className="flex min-h-0 flex-1 flex-col">
            <div className="grid shrink-0 grid-cols-[36px_minmax(0,2fr)_minmax(0,1.3fr)_52px] items-center gap-3 border-b border-[var(--glass-ink-faint)] px-4 py-1.5 text-[11px] font-medium ink-soft @3xl:grid-cols-[36px_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_52px]">
              <span className="text-right">#</span>
              <span>Title</span>
              <span>Artist</span>
              <span className="hidden @3xl:block">Album</span>
              <span className="flex justify-end">
                <Clock className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Duration</span>
              </span>
            </div>
            <ol className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
              {TRACKS.map((t, i) => {
                const current = i === p.index
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => (current ? actions.toggle() : actions.play(i))}
                      aria-current={current ? "true" : undefined}
                      aria-label={`${t.title} by ${t.artist}, ${fmt(t.duration)}${current ? (p.playing ? ", playing" : ", paused") : ""}`}
                      className={cn(
                        "group/row grid w-full grid-cols-[36px_minmax(0,2fr)_minmax(0,1.3fr)_52px] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
                        "@3xl:grid-cols-[36px_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_52px]",
                        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--glass-accent)]",
                        current ? "bg-[#fa233b]/12 dark:bg-[#fa233b]/18" : i % 2 ? "hover:bg-[var(--glass-hover)]" : "bg-[var(--glass-hover)]/50 hover:bg-[var(--glass-hover)]",
                      )}
                    >
                      <span className="flex justify-end font-mono text-[11.5px] tabular-nums ink-soft">
                        {current ? (
                          <Equalizer on={p.playing} bars={4} className="h-3 text-[#fa233b]" barClassName="w-[2.5px]" />
                        ) : (
                          <>
                            <span className="group-hover/row:hidden">{i + 1}</span>
                            <Play className="hidden size-3 fill-current ink group-hover/row:block" aria-hidden="true" />
                          </>
                        )}
                      </span>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <AlbumArt track={t} rounded="rounded-[4px]" className="size-7 shrink-0" />
                        <span className={cn("truncate font-medium", current ? "text-[#fa233b]" : "ink")}>{t.title}</span>
                      </span>
                      <span className="truncate ink-soft">{t.artist}</span>
                      <span className="hidden truncate ink-soft @3xl:block">{t.album}</span>
                      <span className="text-right font-mono text-[11.5px] tabular-nums ink-soft">{fmt(t.duration)}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
            <p className="flex shrink-0 items-center gap-1.5 border-t border-[var(--glass-ink-faint)] px-4 py-1.5 text-[11px] ink-soft">
              <Disc3 className="size-3.5" aria-hidden="true" />
              {TRACKS.length} songs, {Math.round(TRACKS.reduce((s, t) => s + t.duration, 0) / 60)} minutes
              <span className="ml-auto">{section}</span>
            </p>
          </section>
        </div>
      </div>
    </GlassWindow>
  )
}
