"use client"

import * as React from "react"
import { Aperture, ArrowLeft, Camera, CameraOff, ChevronLeft, ChevronRight, Download, Images, Layers, RotateCcw, Trash2, Video } from "lucide-react"
import { ART_PRESETS, createArtJob, hashString } from "@/components/ui/glass-folder-cards"
import { cn } from "@/lib/utils"
import { GlassWindow, TrafficLights, type WindowState } from "../window-manager"

/**
 * Photo Booth: a mirrored camera stage in dark glass, a page of live effect
 * tiles, a 3-2-1 shutter with a flash, and a film strip of snapshots.
 *
 * Every effect is described once (a CSS filter plus optional mirrored
 * layers) and rendered twice: as stacked, clipped, transformed elements for
 * the live preview, and with the same operations on a canvas at capture
 * time, so what you see is what you get. Without a camera the stage shows a
 * painted liquid artwork instead, and everything still works.
 */

// ---------------------------------------------------------------------------
// Effects

type Layer = {
  /** Flip relative to the (already mirrored) preview. */
  flipX?: boolean
  flipY?: boolean
  /** Insets as fractions of the stage, in display space: [top, right, bottom, left]. */
  clip?: [number, number, number, number]
  /** A blurred, brightened copy screened over the layers below. */
  glow?: boolean
  filter?: string
}

type Effect = { id: string; name: string; filter?: string; layers?: Layer[] }

/** Glow blur radius, as a fraction of the stage width. */
const GLOW_BLUR = 0.014
const GLOW_FILTER = (px: number) => `blur(${px.toFixed(2)}px) brightness(1.35) saturate(1.4)`

const BASE: Layer = {}
const NORMAL: Effect = { id: "normal", name: "Normal" }

const PAGES: Effect[][] = [
  [
    { id: "sepia", name: "Sepia", filter: "sepia(1) contrast(1.05) brightness(1.02)" },
    { id: "bw", name: "Black & White", filter: "grayscale(1) contrast(1.15)" },
    { id: "glow", name: "Glow", filter: "brightness(1.05) saturate(1.15)", layers: [BASE, { glow: true }] },
    { id: "comic", name: "Comic Book", filter: "contrast(2.4) saturate(2) brightness(1.08)" },
    NORMAL,
    { id: "thermal", name: "Thermal Camera", filter: "hue-rotate(180deg) saturate(6) contrast(1.6) brightness(1.1)" },
    { id: "xray", name: "X-Ray", filter: "invert(1) grayscale(1) contrast(1.3) brightness(1.05)" },
    { id: "pop", name: "Pop Art", filter: "saturate(4) hue-rotate(110deg) contrast(1.8)" },
    { id: "mirror", name: "Mirror", layers: [BASE, { flipX: true, clip: [0, 0, 0, 0.5] }] },
  ],
  [
    {
      id: "kaleido",
      name: "Kaleidoscope",
      filter: "saturate(1.3)",
      layers: [
        BASE,
        { flipX: true, clip: [0, 0, 0, 0.5] },
        { flipY: true, clip: [0.5, 0.5, 0, 0] },
        { flipX: true, flipY: true, clip: [0.5, 0, 0, 0.5] },
      ],
    },
    { id: "lake", name: "Lake", layers: [BASE, { flipY: true, clip: [0.5, 0, 0, 0], filter: "brightness(.82) saturate(1.25) hue-rotate(-12deg)" }] },
    { id: "neon", name: "Neon", filter: "invert(1) hue-rotate(180deg) saturate(3) contrast(1.4)", layers: [BASE, { glow: true }] },
    { id: "faded", name: "Faded", filter: "sepia(.25) saturate(.7) contrast(.85) brightness(1.1)" },
    NORMAL,
    { id: "noir", name: "Noir", filter: "grayscale(1) contrast(2) brightness(.9)" },
    { id: "chrome", name: "Chrome", filter: "saturate(1.4) contrast(1.15) sepia(.12)" },
    { id: "blueprint", name: "Blueprint", filter: "grayscale(1) sepia(1) hue-rotate(170deg) saturate(3)" },
    { id: "infrared", name: "Infrared", filter: "hue-rotate(260deg) saturate(2.6) contrast(1.15)" },
  ],
]

const EFFECTS = new Map<string, Effect>(PAGES.flat().map((e) => [e.id, e]))
const layersOf = (e: Effect) => e.layers ?? [BASE]

// ---------------------------------------------------------------------------
// Capture: the same effect description, drawn with canvas operations

const ART_W = 640
const ART_H = 360
/** The fallback art drifts zoomed in a little; captures crop the same way. */
const ART_ZOOM = 1.12

function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, W: number, H: number, zoom = 1) {
  const s = Math.max(W / sw, H / sh) * zoom
  const dw = sw * s
  const dh = sh * s
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh)
}

function renderEffect(src: CanvasImageSource, sw: number, sh: number, effect: Effect, W: number, H: number, zoom: number): string | null {
  const a = document.createElement("canvas")
  a.width = W
  a.height = H
  const actx = a.getContext("2d")
  if (!actx) return null
  actx.fillStyle = "#000"
  actx.fillRect(0, 0, W, H)
  for (const layer of layersOf(effect)) {
    actx.save()
    if (layer.clip) {
      const [t, r, b, l] = layer.clip
      actx.beginPath()
      actx.rect(l * W, t * H, W * (1 - l - r), H * (1 - t - b))
      actx.clip()
    }
    const mx = !layer.flipX // the preview is a mirror; a flipped layer undoes it
    const fy = !!layer.flipY
    actx.setTransform(mx ? -1 : 1, 0, 0, fy ? -1 : 1, mx ? W : 0, fy ? H : 0)
    if (layer.glow) {
      actx.filter = GLOW_FILTER(W * GLOW_BLUR)
      actx.globalCompositeOperation = "screen"
      actx.globalAlpha = 0.55
    } else {
      actx.filter = layer.filter ?? "none"
    }
    drawCover(actx, src, sw, sh, W, H, zoom)
    actx.restore()
  }
  const b = document.createElement("canvas")
  b.width = W
  b.height = H
  const bctx = b.getContext("2d")
  if (!bctx) return null
  bctx.filter = effect.filter ?? "none"
  bctx.drawImage(a, 0, 0)
  return b.toDataURL("image/jpeg", 0.92)
}

// ---------------------------------------------------------------------------
// Preview: stacked layers of the same source

/** One <video> on the shared stream. */
function LiveVideo({ stream }: { stream: MediaStream }) {
  const ref = React.useRef<HTMLVideoElement>(null)
  React.useEffect(() => {
    const v = ref.current
    if (!v) return
    v.srcObject = stream
    v.play().catch(() => {})
    return () => {
      v.srcObject = null
    }
  }, [stream])
  return <video ref={ref} muted playsInline autoPlay aria-hidden="true" className="absolute inset-0 size-full object-cover" />
}

/** The fallback: painted art, slowly drifting. */
function ArtSource({ artUrl }: { artUrl: string | null }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[radial-gradient(120%_90%_at_30%_20%,#5b3d6b_0%,#2b1a24_55%,#120c18_100%)]">
      {artUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute inset-0 size-full scale-[1.12] object-cover motion-safe:[animation:pb-drift_26s_ease-in-out_infinite_alternate]"
        />
      ) : null}
    </div>
  )
}

function EffectView({
  effect,
  stream,
  artUrl,
  width,
}: {
  effect: Effect
  stream: MediaStream | null
  artUrl: string | null
  /** Rendered width in px, so the glow's blur scales with the view. */
  width: number
}) {
  return (
    <div className="absolute inset-0 isolate overflow-hidden bg-black" style={{ filter: effect.filter }}>
      {layersOf(effect).map((layer, i) => {
        const clip = layer.clip ? `inset(${layer.clip.map((n) => `${n * 100}%`).join(" ")})` : undefined
        return (
          <div
            key={i}
            className="absolute inset-0"
            style={{
              clipPath: clip,
              filter: layer.glow ? GLOW_FILTER(width * GLOW_BLUR) : layer.filter,
              mixBlendMode: layer.glow ? "screen" : undefined,
              opacity: layer.glow ? 0.55 : undefined,
            }}
          >
            <div className="absolute inset-0" style={{ transform: `scale(${layer.flipX ? 1 : -1}, ${layer.flipY ? -1 : 1})` }}>
              {stream ? <LiveVideo stream={stream} /> : <ArtSource artUrl={artUrl} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The app

type Shot = { id: string; url: string; effect: string; label: string }
type Cam = { status: "pending" | "live" | "error"; reason?: string }
type View = { kind: "camera" } | { kind: "effects" } | { kind: "review"; id: string }

function cameraError(err: unknown): string {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : ""
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Camera access was denied."
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "No camera was found."
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is in use by another app."
    case "AbortError":
      return "The camera stopped before it started."
    default:
      return "The camera couldn't be started."
  }
}

const fileName = (label: string) => `${label.replace(/[^\w ]+/g, "").replace(/\s+/g, " ").trim()}.jpg`

export default function PhotoBoothWindow({ win }: { win: WindowState }) {
  const [cam, setCam] = React.useState<Cam>({ status: "pending" })
  const [stream, setStream] = React.useState<MediaStream | null>(null)
  const [artUrl, setArtUrl] = React.useState<string | null>(null)
  const [effectId, setEffectId] = React.useState("normal")
  const [view, setView] = React.useState<View>({ kind: "camera" })
  const [page, setPage] = React.useState(0)
  const [shots, setShots] = React.useState<Shot[]>([])
  const [countdown, setCountdown] = React.useState<number | null>(null)
  const [flashKey, setFlashKey] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const [burst, setBurst] = React.useState(false)
  const [stage, setStage] = React.useState({ w: 0, h: 0 })

  const streamRef = React.useRef<MediaStream | null>(null)
  const captureVideo = React.useRef<HTMLVideoElement>(null)
  const artCanvas = React.useRef<HTMLCanvasElement | null>(null)
  const stageBox = React.useRef<HTMLDivElement>(null)
  const timers = React.useRef<number[]>([])
  const alive = React.useRef(true)
  const closing = win.phase === "closing"
  const closingRef = React.useRef(closing)
  const shotCounter = React.useRef(0)

  const effect = EFFECTS.get(effectId) ?? NORMAL
  const reviewing = view.kind === "review" ? (shots.find((s) => s.id === view.id) ?? null) : null

  // ---- camera lifecycle
  const startCamera = React.useCallback(async () => {
    if (closingRef.current) return
    setCam({ status: "pending" })
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      setCam({ status: "error", reason: "The camera isn't available here." })
      return
    }
    if (!window.isSecureContext) {
      setCam({ status: "error", reason: "The camera needs a secure (HTTPS) connection." })
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCam({ status: "error", reason: "This browser can't use a camera." })
      return
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 1280, height: 720 },
        audio: false,
      })
      if (!alive.current || closingRef.current) {
        s.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = s
      setStream(s)
      setCam({ status: "live" })
      // if the camera is unplugged or revoked mid-session, fall back to the art
      s.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (streamRef.current !== s || !alive.current) return
        streamRef.current = null
        setStream(null)
        setCam({ status: "error", reason: "The camera was disconnected." })
      })
    } catch (err) {
      if (!alive.current) return
      setCam({ status: "error", reason: cameraError(err) })
    }
  }, [])

  React.useEffect(() => {
    alive.current = true
    // deferred a tick so a strict-mode double mount doesn't open the camera twice
    const t = window.setTimeout(() => void startCamera(), 0)
    const pending = timers.current
    return () => {
      alive.current = false
      window.clearTimeout(t)
      pending.splice(0).forEach((id) => window.clearTimeout(id))
      streamRef.current?.getTracks().forEach((tr) => tr.stop())
      streamRef.current = null
    }
  }, [startCamera])

  // stop the camera as soon as the window starts closing, not when it unmounts
  React.useEffect(() => {
    closingRef.current = closing
    if (!closing || !streamRef.current) return
    streamRef.current.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
  }, [closing])

  // the hidden capture video always holds the stream, whatever the stage shows
  React.useEffect(() => {
    const v = captureVideo.current
    if (!v) return
    v.srcObject = stream
    if (stream) v.play().catch(() => {})
  }, [stream])

  // ---- the fallback art, painted once over a few frames
  React.useEffect(() => {
    const job = createArtJob(ART_W, ART_H, ART_PRESETS.dusk, hashString("photo-booth"))
    let raf = 0
    const tick = () => {
      if (!job.step(14)) {
        raf = requestAnimationFrame(tick)
        return
      }
      const c = document.createElement("canvas")
      c.width = job.width
      c.height = job.height
      const ctx = c.getContext("2d")
      if (!ctx) return
      ctx.putImageData(new ImageData(new Uint8ClampedArray(job.pixels), job.width, job.height), 0, 0)
      artCanvas.current = c
      setArtUrl(c.toDataURL("image/jpeg", 0.9))
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ---- letterbox the 16:9 stage inside whatever space the window gives it
  React.useEffect(() => {
    const el = stageBox.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const w = Math.max(0, Math.min(width, (height * 16) / 9))
      setStage({ w: Math.floor(w), h: Math.floor((w * 9) / 16) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- capture
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      const at = timers.current.indexOf(id)
      if (at >= 0) timers.current.splice(at, 1)
      if (alive.current) fn()
    }, ms)
    timers.current.push(id)
  }

  const grab = (fx: Effect) => {
    const v = captureVideo.current
    let url: string | null = null
    if (streamRef.current && v && v.videoWidth > 0) {
      const vw = v.videoWidth
      const vh = v.videoHeight
      // the stage is 16:9 and object-cover; crop the native frame the same way
      const wide = vw / vh > 16 / 9
      const W = wide ? Math.round((vh * 16) / 9) : vw
      const H = wide ? vh : Math.round((vw * 9) / 16)
      url = renderEffect(v, vw, vh, fx, W, H, 1)
    } else if (artCanvas.current) {
      const c = artCanvas.current
      url = renderEffect(c, c.width, c.height, fx, 1280, 720, ART_ZOOM)
    }
    setFlashKey((k) => k + 1)
    if (!url) return
    const n = ++shotCounter.current
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    const shot: Shot = { id: `shot-${n}-${Date.now()}`, url, effect: fx.name, label: `Photo ${n} · ${time}` }
    setShots((s) => [shot, ...s])
  }

  const shoot = () => {
    if (busy || closing) return
    const fx = effect
    const count = burst ? 4 : 1
    setView({ kind: "camera" })
    setBusy(true)
    setCountdown(3)
    later(() => setCountdown(2), 1000)
    later(() => setCountdown(1), 2000)
    later(() => {
      setCountdown(null)
      for (let i = 0; i < count; i++) later(() => grab(fx), i * 380)
      later(() => setBusy(false), (count - 1) * 380 + 450)
    }, 3000)
  }

  const remove = (id: string) => {
    setShots((s) => s.filter((x) => x.id !== id))
    if (view.kind === "review" && view.id === id) setView({ kind: "camera" })
  }

  const pickEffect = (id: string) => {
    setEffectId(id)
    setView({ kind: "camera" })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && view.kind !== "camera") {
      e.stopPropagation()
      setView({ kind: "camera" })
    } else if (view.kind === "effects" && (e.key === "PageDown" || e.key === "PageUp")) {
      e.preventDefault()
      setPage((p) => Math.max(0, Math.min(PAGES.length - 1, p + (e.key === "PageDown" ? 1 : -1))))
    }
  }

  const tileW = Math.max(60, (stage.w - 24) / 3)
  const showCameraOff = cam.status === "error" && view.kind === "camera" && countdown === null && !busy

  return (
    <GlassWindow win={win} titleBar={false} minW={480} minH={420} contentClassName="flex flex-col">
      <style href="photo-booth-keyframes" precedence="default">{`
@keyframes pb-drift { 0% { transform: scale(1.12) translate3d(-2.5%, -1.5%, 0) rotate(-.6deg) } 100% { transform: scale(1.18) translate3d(2.5%, 1.5%, 0) rotate(.6deg) } }
@keyframes pb-tick { 0% { transform: scale(1.5); opacity: 0 } 18% { transform: scale(1); opacity: 1 } 80% { transform: scale(.96); opacity: 1 } 100% { transform: scale(.8); opacity: 0 } }
@keyframes pb-flash { 0% { opacity: 1 } 100% { opacity: 0 } }
@keyframes pb-slide { 0% { transform: translateX(-70%) scale(.6); opacity: 0 } 100% { transform: none; opacity: 1 } }
@keyframes pb-fade { 0% { opacity: 0; transform: scale(.985) } 100% { opacity: 1; transform: none } }
`}</style>

      {/* dark glass over the window's frost */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#1c1c1f]/72 dark:bg-black/45" />

      <div className="relative flex min-h-0 flex-1 flex-col text-white" onKeyDown={onKeyDown}>
        {/* title bar */}
        <div data-drag-handle className="relative flex h-9 shrink-0 items-center px-3.5 select-none">
          <TrafficLights id={win.id} />
          <div className="pointer-events-none absolute inset-x-0 flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-white/85">
            <Aperture className="size-3.5 text-white/60" aria-hidden="true" />
            Photo Booth
          </div>
          {effectId !== "normal" ? (
            <span className="pointer-events-none ml-auto rounded-md bg-white/10 px-1.5 py-0.5 text-[10.5px] font-medium tracking-wide text-white/70">
              {effect.name}
            </span>
          ) : null}
        </div>

        {/* stage */}
        <div ref={stageBox} className="relative mx-3 min-h-0 flex-1">
          {stage.w > 0 ? (
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[10px] bg-black shadow-[0_0_0_.5px_rgba(255,255,255,.14),0_12px_32px_-12px_rgba(0,0,0,.7)]"
              style={{ width: stage.w, height: stage.h }}
            >
              {view.kind === "effects" ? (
                <div className="absolute inset-0 flex flex-col bg-[#111]/90 p-2 [animation:pb-fade_.28s_var(--glass-ease)_both]">
                  <div role="listbox" aria-label="Effects" className="grid min-h-0 flex-1 grid-cols-3 grid-rows-3 gap-1.5">
                    {PAGES[page].map((e, i) => (
                      <button
                        key={`${page}-${i}`}
                        type="button"
                        role="option"
                        aria-selected={e.id === effectId}
                        onClick={() => pickEffect(e.id)}
                        className={cn(
                          "relative min-h-0 overflow-hidden rounded-md outline-none",
                          "shadow-[0_0_0_.5px_rgba(255,255,255,.12)] transition-[transform,box-shadow] duration-200 [transition-timing-function:var(--glass-ease)]",
                          "hover:scale-[1.02] focus-visible:shadow-[0_0_0_2px_var(--glass-accent)]",
                          e.id === effectId && "shadow-[0_0_0_2px_#fff]",
                        )}
                      >
                        <EffectView effect={e} stream={stream} artUrl={artUrl} width={tileW} />
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1 pt-3 pb-1 text-center text-[11px] font-medium text-white [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
                          {e.name}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="flex h-6 shrink-0 items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      aria-label="Previous effects page"
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                      className="grid size-5 place-items-center rounded text-white/70 hover:bg-white/10 disabled:opacity-25"
                    >
                      <ChevronLeft className="size-3.5" />
                    </button>
                    {PAGES.map((_, p) => (
                      <button
                        key={p}
                        type="button"
                        aria-label={`Effects page ${p + 1}`}
                        aria-current={p === page}
                        onClick={() => setPage(p)}
                        className={cn("size-1.5 rounded-full transition-colors", p === page ? "bg-white" : "bg-white/30 hover:bg-white/55")}
                      />
                    ))}
                    <button
                      type="button"
                      aria-label="Next effects page"
                      disabled={page === PAGES.length - 1}
                      onClick={() => setPage((p) => p + 1)}
                      className="grid size-5 place-items-center rounded text-white/70 hover:bg-white/10 disabled:opacity-25"
                    >
                      <ChevronRight className="size-3.5" />
                    </button>
                  </div>
                </div>
              ) : reviewing ? (
                <div className="absolute inset-0 [animation:pb-fade_.3s_var(--glass-ease)_both]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={reviewing.url} alt={`${reviewing.label}, ${reviewing.effect}`} className="absolute inset-0 size-full object-cover" />
                  <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/55 to-transparent p-2.5">
                    <button
                      type="button"
                      onClick={() => setView({ kind: "camera" })}
                      className="inline-flex h-7 items-center gap-1.5 rounded-full bg-black/35 px-3 text-[12px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,.18)] backdrop-blur-xl transition-colors hover:bg-black/50"
                    >
                      <ArrowLeft className="size-3.5" />
                      Back to camera
                    </button>
                    <div className="flex items-center gap-1.5">
                      <a
                        href={reviewing.url}
                        download={fileName(reviewing.label)}
                        aria-label="Download photo"
                        className="grid size-7 place-items-center rounded-full bg-black/35 text-white backdrop-blur-xl transition-colors hover:bg-black/50"
                      >
                        <Download className="size-3.5" />
                      </a>
                      <button
                        type="button"
                        aria-label="Delete photo"
                        onClick={() => remove(reviewing.id)}
                        className="grid size-7 place-items-center rounded-full bg-black/35 text-white backdrop-blur-xl transition-colors hover:bg-[#ff453a]/80"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="absolute bottom-2 left-3 text-[11px] font-medium text-white/80 [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
                    {reviewing.label} · {reviewing.effect}
                  </p>
                </div>
              ) : (
                <>
                  <EffectView effect={effect} stream={stream} artUrl={artUrl} width={stage.w} />
                  {cam.status === "pending" ? (
                    <div className="absolute inset-0 grid place-items-center bg-black/25 backdrop-blur-sm">
                      <span className="inline-flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 text-[12px] text-white/85 backdrop-blur-xl">
                        <Camera className="size-3.5 motion-safe:animate-pulse" />
                        Starting camera…
                      </span>
                    </div>
                  ) : null}
                  {showCameraOff ? (
                    <div className="absolute inset-0 grid place-items-center p-4">
                      <div className="flex max-w-[86%] flex-col items-center gap-2 rounded-2xl bg-black/30 px-5 py-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,.18),0_0_0_.5px_rgba(255,255,255,.12)] backdrop-blur-xl [animation:pb-fade_.4s_var(--glass-ease)_both]">
                        <CameraOff className="size-6 text-white/85" aria-hidden="true" />
                        <p className="text-[12.5px] leading-snug text-white/90" role="status">
                          {cam.reason}
                        </p>
                        <button
                          type="button"
                          onClick={() => void startCamera()}
                          className="mt-0.5 inline-flex h-6.5 items-center gap-1.5 rounded-full bg-white/18 px-3 text-[12px] font-medium text-white transition-colors hover:bg-white/28 focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)]"
                        >
                          <RotateCcw className="size-3" />
                          Try again
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}

              {/* countdown */}
              <div aria-live="assertive" className="pointer-events-none absolute inset-0 grid place-items-center">
                {countdown !== null ? (
                  <span
                    key={countdown}
                    className="grid place-items-center rounded-[28%] bg-white/14 font-semibold text-white tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,.45),0_0_0_.5px_rgba(255,255,255,.25),0_20px_50px_-20px_rgba(0,0,0,.6)] backdrop-blur-2xl [animation:pb-tick_1s_var(--glass-spring)_both] [text-shadow:0_2px_12px_rgba(0,0,0,.35)]"
                    style={{ width: Math.max(72, stage.h * 0.42), height: Math.max(72, stage.h * 0.42), fontSize: Math.max(44, stage.h * 0.3) }}
                  >
                    {countdown}
                  </span>
                ) : null}
              </div>

              {/* flash */}
              {flashKey > 0 ? (
                <div key={flashKey} aria-hidden="true" className="pointer-events-none absolute inset-0 bg-white [animation:pb-flash_.55s_var(--glass-ease)_both]" />
              ) : null}
            </div>
          ) : null}
        </div>

        {/* controls */}
        <div className="relative flex h-16 shrink-0 items-center px-4">
          <div className="flex flex-1 items-center gap-2">
            <div role="radiogroup" aria-label="Capture mode" className="flex rounded-lg bg-white/10 p-0.5 shadow-[inset_0_0_0_.5px_rgba(255,255,255,.1)]">
              <button
                type="button"
                role="radio"
                aria-checked
                className="inline-flex h-6 items-center gap-1 rounded-md bg-white/22 px-2 text-[11.5px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,.25)]"
              >
                <Camera className="size-3.5" />
                Photo
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={false}
                disabled
                title="Video recording isn't available on this desk"
                className="inline-flex h-6 cursor-not-allowed items-center gap-1 rounded-md px-2 text-[11.5px] font-medium text-white/35"
              >
                <Video className="size-3.5" />
                Video
              </button>
            </div>
            <button
              type="button"
              aria-pressed={burst}
              onClick={() => setBurst((b) => !b)}
              title="Take four quick photos"
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] font-medium transition-colors",
                burst ? "bg-white/22 text-white" : "text-white/65 hover:bg-white/10 hover:text-white",
              )}
            >
              <Layers className="size-3.5" />
              <span className="max-[560px]:hidden">Burst</span>
            </button>
          </div>

          <button
            type="button"
            aria-label={burst ? "Take four photos" : "Take photo"}
            onClick={shoot}
            disabled={busy || closing}
            className={cn(
              "relative grid size-12 shrink-0 place-items-center rounded-full",
              "bg-[radial-gradient(circle_at_50%_30%,#ff6b61_0%,#e0251b_62%,#b3150d_100%)]",
              "shadow-[0_0_0_3px_rgba(255,255,255,.16),0_0_0_4px_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.45),0_8px_18px_-6px_rgba(224,37,27,.7)]",
              "transition-transform duration-200 [transition-timing-function:var(--glass-spring)] hover:scale-105 active:scale-95",
              "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white",
              "disabled:scale-95 disabled:opacity-70",
            )}
          >
            {burst ? <Layers className="size-5 text-white/90" aria-hidden="true" /> : <Camera className="size-5 text-white/90" aria-hidden="true" />}
          </button>

          <div className="flex flex-1 items-center justify-end">
            <button
              type="button"
              aria-pressed={view.kind === "effects"}
              onClick={() => setView((v) => (v.kind === "effects" ? { kind: "camera" } : { kind: "effects" }))}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors",
                view.kind === "effects" ? "bg-white/22 text-white" : "bg-white/10 text-white/85 hover:bg-white/16 hover:text-white",
                "focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)]",
              )}
            >
              <Images className="size-3.5" />
              Effects
            </button>
          </div>
        </div>

        {/* film strip */}
        <div className="mx-3 mb-3 shrink-0 rounded-xl bg-black/30 shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_0_0_.5px_rgba(255,255,255,.08)] backdrop-blur-xl">
          <div className="flex items-center justify-between px-2.5 pt-1.5 text-[10.5px] font-medium tracking-wide text-white/50">
            <span>Film Strip</span>
            <span aria-live="polite" className="rounded-full bg-white/10 px-1.5 py-px text-white/70 tabular-nums">
              {shots.length} {shots.length === 1 ? "photo" : "photos"}
            </span>
          </div>
          <ul className="no-scrollbar flex h-[68px] items-center gap-2 overflow-x-auto px-2.5 pt-1 pb-2" aria-label="Photos">
            {shots.length === 0 ? (
              <li className="flex h-full w-full items-center justify-center text-[11.5px] text-white/40">Photos you take appear here.</li>
            ) : (
              shots.map((s) => {
                const active = reviewing?.id === s.id
                return (
                  <li key={s.id} className="group/shot relative h-[52px] w-[92px] shrink-0 [animation:pb-slide_.55s_var(--glass-spring)_both]">
                    <button
                      type="button"
                      onClick={() => setView({ kind: "review", id: s.id })}
                      aria-label={`View ${s.label}`}
                      aria-current={active}
                      className={cn(
                        "block size-full overflow-hidden rounded-md shadow-[0_0_0_.5px_rgba(255,255,255,.2)] transition-shadow outline-none",
                        "focus-visible:shadow-[0_0_0_2px_var(--glass-accent)]",
                        active && "shadow-[0_0_0_2px_#fff]",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.url} alt="" draggable={false} className="size-full object-cover" />
                    </button>
                    <div className="pointer-events-none absolute top-1 right-1 flex gap-0.5 opacity-0 transition-opacity group-focus-within/shot:pointer-events-auto group-focus-within/shot:opacity-100 group-hover/shot:pointer-events-auto group-hover/shot:opacity-100">
                      <a
                        href={s.url}
                        download={fileName(s.label)}
                        aria-label={`Download ${s.label}`}
                        className="grid size-5 place-items-center rounded bg-black/55 text-white backdrop-blur-md hover:bg-black/75"
                      >
                        <Download className="size-3" />
                      </a>
                      <button
                        type="button"
                        aria-label={`Delete ${s.label}`}
                        onClick={() => remove(s.id)}
                        className="grid size-5 place-items-center rounded bg-black/55 text-white backdrop-blur-md hover:bg-[#ff453a]"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </li>
                )
              })
            )}
          </ul>
        </div>

        {/* the capture source: always mounted, never shown */}
        <video ref={captureVideo} muted playsInline autoPlay aria-hidden="true" className="pointer-events-none absolute size-px opacity-0" />
      </div>
    </GlassWindow>
  )
}
