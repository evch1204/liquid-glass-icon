"use client"

import * as React from "react"
import type { LucideIcon } from "lucide-react"
import {
  AppWindow,
  ArrowDownWideNarrow,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleArrowDown,
  Clock,
  Cloud,
  Columns3,
  Eye,
  FileText,
  HardDrive,
  LayoutGrid,
  List,
  Monitor,
  PanelLeft,
  PanelRight,
  Radar,
  Search,
  Share,
  Tag,
  X,
} from "lucide-react"
import {
  ART_PRESETS,
  createArtJob,
  hashString,
  rng,
  type ArtJob,
  type ArtPreset,
  type ArtRecipe,
  type FolderFile,
} from "@/components/ui/glass-folder-cards"
import { APPS } from "@/lib/apps"
import { DESKTOP_FOLDERS, fileKind, folderById } from "@/lib/desktop-data"
import { cn } from "@/lib/utils"
import { GlassButton } from "../glass"
import { GlassWindow, TrafficLights, useWindowManager, type AppId, type WindowState } from "../window-manager"

/**
 * Finder: a unified glass toolbar, a vibrant sidebar, icon / list / column
 * views over the desk's folders, a preview pane and Quick Look. Everything it
 * lists comes from `lib/desktop-data`, so it matches what the folder cards fan.
 */

// ---------------------------------------------------------------------------
// Thumbnails: one shared, cached painter. Jobs are stepped a few ms per frame,
// smallest first, and the finished canvases are kept for every window.

type Art = ArtPreset | ArtRecipe
type ThumbJob = { key: string; recipe: ArtRecipe; seed: number; w: number; h: number; job?: ArtJob }

const thumbCache = new Map<string, HTMLCanvasElement>()
const thumbWaiting = new Map<string, Set<(c: HTMLCanvasElement) => void>>()
const thumbQueue: ThumbJob[] = []
let thumbPumping = false

function pumpThumbs() {
  if (thumbPumping) return
  thumbPumping = true
  const tick = () => {
    const until = performance.now() + 6
    while (thumbQueue.length && performance.now() < until) {
      const head = thumbQueue[0]
      head.job ??= createArtJob(head.w, head.h, head.recipe, head.seed)
      if (head.job.step(6)) {
        thumbQueue.shift()
        const c = document.createElement("canvas")
        c.width = head.job.width
        c.height = head.job.height
        c.getContext("2d")?.putImageData(
          new ImageData(head.job.pixels as Uint8ClampedArray<ArrayBuffer>, c.width, c.height),
          0,
          0,
        )
        thumbCache.set(head.key, c)
        const waiting = thumbWaiting.get(head.key)
        thumbWaiting.delete(head.key)
        waiting?.forEach((cb) => cb(c))
      }
    }
    if (thumbQueue.length) requestAnimationFrame(tick)
    else thumbPumping = false
  }
  requestAnimationFrame(tick)
}

/** Ask for a painted thumbnail. Returns an unsubscribe. */
function requestThumb(recipe: ArtRecipe, seed: number, w: number, h: number, cb: (c: HTMLCanvasElement) => void) {
  const key = JSON.stringify([recipe, seed, w, h])
  const done = thumbCache.get(key)
  if (done) {
    cb(done)
    return () => {}
  }
  let waiting = thumbWaiting.get(key)
  if (!waiting) {
    waiting = new Set()
    thumbWaiting.set(key, waiting)
    // small first, but never jump the job already in progress
    let at = thumbQueue.length
    while (at > 1 && thumbQueue[at - 1].w * thumbQueue[at - 1].h > w * h) at--
    thumbQueue.splice(at, 0, { key, recipe, seed, w, h })
    pumpThumbs()
  }
  waiting.add(cb)
  return () => {
    thumbWaiting.get(key)?.delete(cb)
  }
}

const recipeOf = (art: Art): ArtRecipe => (typeof art === "string" ? ART_PRESETS[art] : art)

/** A generated artwork, painted once per recipe + seed + size and shared by every window. */
const ArtThumb = React.memo(function ArtThumb({
  art,
  seed,
  w,
  h,
  cssW,
  cssH,
  className,
}: {
  art: Art
  seed: number
  /** Paint size in device pixels; the canvas is stretched to fill its box. */
  w: number
  h: number
  cssW: number
  cssH: number
  className?: string
}) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  const recipe = recipeOf(art)
  React.useEffect(() => {
    const c = ref.current
    if (c) delete c.dataset.ready
    return requestThumb(recipe, seed, w, h, (src) => {
      const el = ref.current
      if (!el) return
      el.width = src.width
      el.height = src.height
      el.getContext("2d")?.drawImage(src, 0, 0)
      el.dataset.ready = ""
    })
  }, [recipe, seed, w, h])
  return (
    <span
      aria-hidden="true"
      className={cn("relative block overflow-hidden", className)}
      style={{ width: cssW, height: cssH, background: `linear-gradient(${recipe.style === "streak" ? 100 : 35}deg, ${recipe.colors.join(", ")})` }}
    >
      <canvas
        ref={ref}
        width={1}
        height={1}
        className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-300 [transition-timing-function:var(--glass-ease)] data-ready:opacity-100"
      />
    </span>
  )
})

// ---------------------------------------------------------------------------
// The model: locations and the items they list.

type Loc = string
type TagId = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "gray"
type Glyph = "art" | "paper" | "folder" | "app"

type Item = {
  key: string
  name: string
  glyph: Glyph
  art?: Art
  seed: number
  /** Folder-like: opening navigates here. */
  go?: Loc
  app?: AppId
  kind: string
  badge: string
  size: number
  sizeLabel: string
  modified: number
  created: number
  dims?: string
  tags: TagId[]
  /** Second line, e.g. "24 images". */
  note?: string
}

type LocInfo = { title: string; icon: LucideIcon | null; path: string[]; items: Item[]; empty: string }

const TAGS: { id: TagId; label: string; color: string }[] = [
  { id: "red", label: "Red", color: "#ff453a" },
  { id: "orange", label: "Orange", color: "#ff9f0a" },
  { id: "yellow", label: "Yellow", color: "#ffd60a" },
  { id: "green", label: "Green", color: "#30d158" },
  { id: "blue", label: "Blue", color: "#0a84ff" },
  { id: "purple", label: "Purple", color: "#bf5af2" },
  { id: "gray", label: "Gray", color: "#8e8e93" },
]
const TAG_COLOR = Object.fromEntries(TAGS.map((t) => [t.id, t.color])) as Record<TagId, string>

const FAVORITES: { id: Loc; label: string; icon: LucideIcon }[] = [
  { id: "airdrop", label: "AirDrop", icon: Radar },
  { id: "recents", label: "Recents", icon: Clock },
  { id: "applications", label: "Applications", icon: AppWindow },
  { id: "desktop", label: "Desktop", icon: Monitor },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "downloads", label: "Downloads", icon: CircleArrowDown },
]
const LOCATIONS: { id: Loc; label: string; icon: LucideIcon }[] = [
  { id: "hd", label: "Macintosh HD", icon: HardDrive },
  { id: "icloud", label: "iCloud Drive", icon: Cloud },
]
const PLACES = [...FAVORITES, ...LOCATIONS]
/** Path segments that lead somewhere when clicked in the path bar. */
const PATH_TARGET: Record<string, Loc> = {
  "Macintosh HD": "hd",
  Applications: "applications",
  Desktop: "desktop",
  Documents: "documents",
  Downloads: "downloads",
  "iCloud Drive": "icloud",
}

const UNITS: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9 }
function formatBytes(n: number): string {
  if (n < 0) return "--"
  if (n < 1e3) return n + " bytes"
  if (n < 1e6) return Math.round(n / 1e3) + " KB"
  if (n < 1e9) return (n / 1e6).toFixed(1) + " MB"
  return (n / 1e9).toFixed(1) + " GB"
}

// Dates are derived from names, from a fixed epoch, and formatted in UTC so the
// server and the browser always agree.
const EPOCH = Date.UTC(2026, 8, 28, 17, 0)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
function formatDate(t: number): string {
  const d = new Date(t)
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mm = String(d.getUTCMinutes()).padStart(2, "0")
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} at ${hh}:${mm}`
}
function datesFor(name: string) {
  const h = hashString(name + "#date")
  const modified = EPOCH - (h % (60 * 24 * 120)) * 60_000
  const created = modified - ((h >>> 9) % (60 * 24 * 300)) * 60_000
  return { modified, created }
}
function tagsFor(name: string): TagId[] {
  const r = rng(hashString(name + "#tags"))
  if (r() < 0.45) return []
  const first = TAGS[Math.floor(r() * TAGS.length)].id
  const second = TAGS[Math.floor(r() * TAGS.length)].id
  return r() < 0.25 && second !== first ? [first, second] : [first]
}

const EXT_KIND: Record<string, string> = {
  PNG: "PNG image",
  JPG: "JPEG image",
  TIFF: "TIFF image",
  PDF: "PDF document",
  TXT: "Plain text",
  RAW: "Camera RAW",
  DRX: "DaVinci grade",
}

function fileItem(folderId: string, file: FolderFile): Item {
  const h = hashString(file.name)
  const meta = file.meta ?? ""
  const parts = meta.split(" · ").map((s) => s.trim())
  const ext = parts.length > 1 ? parts[0].toUpperCase() : file.name.toLowerCase().endsWith(".pdf") ? "PDF" : ""
  const sizeMatch = /^([\d.]+)\s*(B|KB|MB|GB)$/i.exec(parts[parts.length - 1] ?? "")
  const count = /^(\d+)\s+(images|pdfs|files)$/i.exec(meta)
  const r = rng(h)
  let size: number
  if (sizeMatch) size = Math.round(parseFloat(sizeMatch[1]) * UNITS[sizeMatch[2].toUpperCase()])
  else if (count) size = Math.round(Number(count[1]) * (/pdf/i.test(count[2]) ? 0.4e6 : 2e6 + r() * 4e6))
  else size = Math.round(2e3 + r() * 9e5)
  const k = fileKind(file)
  const kind = count ? "Folder" : EXT_KIND[ext] ?? (k === "image" ? "Image" : k === "text" ? "Plain text" : k === "pdf" ? "PDF document" : "Document")
  const badge = ext || (k === "text" ? "TXT" : k === "pdf" ? "PDF" : k === "raw" ? "RAW" : "DOC")
  const art = file.art
  const ratio = r() < 0.5 ? [6000, 4000] : [4032, 3024]
  return {
    key: folderId + "/" + file.name,
    name: file.name,
    glyph: art ? "art" : count ? "folder" : "paper",
    art,
    seed: h % 997,
    kind,
    badge,
    size,
    sizeLabel: formatBytes(size),
    ...datesFor(file.name),
    dims: art && !count ? `${ratio[0]} × ${ratio[1]}` : undefined,
    tags: tagsFor(file.name),
    note: count ? meta : undefined,
  }
}

function goItem(name: string, go: Loc, note?: string): Item {
  return {
    key: "loc:" + go,
    name,
    glyph: "folder",
    seed: hashString(name) % 997,
    go,
    kind: "Folder",
    badge: "",
    size: -1,
    sizeLabel: "--",
    ...datesFor(name),
    tags: [],
    note,
  }
}

const ALL_FILES = (): Item[] => DESKTOP_FOLDERS.flatMap((f) => f.files.map((file) => fileItem(f.id, file)))
const USER = ["Macintosh HD", "Users", "evan"]

const infoCache = new Map<Loc, LocInfo>()
function resolve(loc: Loc): LocInfo {
  const hit = infoCache.get(loc)
  if (hit) return hit
  let info: LocInfo
  const folder = folderById(loc)
  const place = PLACES.find((p) => p.id === loc)
  if (folder) {
    info = { title: folder.label, icon: null, path: folder.path, items: folder.files.map((f) => fileItem(folder.id, f)), empty: "This folder is empty." }
  } else if (loc.startsWith("tag:")) {
    const tag = TAGS.find((t) => "tag:" + t.id === loc) ?? TAGS[0]
    info = { title: tag.label, icon: Tag, path: [tag.label], items: ALL_FILES().filter((i) => i.tags.includes(tag.id)), empty: `Nothing is tagged ${tag.label}.` }
  } else {
    const title = place?.label ?? "Recents"
    const icon = place?.icon ?? Clock
    switch (loc) {
      case "airdrop":
        info = { title, icon, path: ["AirDrop"], items: [], empty: "AirDrop lets you share instantly with people nearby." }
        break
      case "applications":
        info = {
          title,
          icon,
          path: ["Macintosh HD", "Applications"],
          items: Object.values(APPS)
            .map((a): Item => {
              const h = hashString(a.id + "#app")
              const size = 12e6 + (h % 900) * 1e5
              return {
                key: "app:" + a.id,
                name: a.name,
                glyph: "app",
                seed: h % 997,
                app: a.id,
                kind: "Application",
                badge: "",
                size,
                sizeLabel: formatBytes(size),
                ...datesFor(a.name),
                tags: [],
              }
            }),
          empty: "No applications.",
        }
        break
      case "desktop":
        info = {
          title,
          icon,
          path: [...USER, "Desktop"],
          items: DESKTOP_FOLDERS.map((f) => goItem(f.label, f.id, f.files.length + " items")),
          empty: "Your desktop is clear.",
        }
        break
      case "documents":
        info = {
          title,
          icon,
          path: [...USER, "Documents"],
          items: ALL_FILES().filter((i) => i.glyph === "paper"),
          empty: "No documents.",
        }
        break
      case "downloads":
        info = {
          title,
          icon,
          path: [...USER, "Downloads"],
          items: ALL_FILES().filter((i) => hashString(i.name) % 3 === 0),
          empty: "Downloads is empty.",
        }
        break
      case "hd":
        info = {
          title,
          icon,
          path: ["Macintosh HD"],
          items: [goItem("Applications", "applications"), goItem("Desktop", "desktop"), goItem("Documents", "documents"), goItem("Downloads", "downloads")],
          empty: "",
        }
        break
      case "icloud":
        info = { title, icon, path: ["iCloud Drive"], items: [goItem("Desktop", "desktop"), goItem("Documents", "documents")], empty: "" }
        break
      default:
        info = { title: "Recents", icon: Clock, path: ["Recents"], items: ALL_FILES(), empty: "No recent files." }
    }
  }
  infoCache.set(loc, info)
  return info
}

function readPayload(p: unknown): { loc: Loc; sel: string | null } | null {
  if (!p || typeof p !== "object") return null
  const { folderId, selected } = p as { folderId?: unknown; selected?: unknown }
  if (typeof folderId !== "string" || !folderById(folderId)) return null
  return { loc: folderId, sel: typeof selected === "string" ? folderId + "/" + selected : null }
}

// ---------------------------------------------------------------------------
// State

type View = "icons" | "list" | "columns"
type SortKey = "name" | "modified" | "size" | "kind"
type MenuId = "sort" | "share" | null

type State = {
  stack: Loc[]
  at: number
  /** Selected keys; the last one is the lead (what the preview and Quick Look show). */
  sel: string[]
  anchor: string | null
  query: string
  view: View
  sortKey: SortKey
  sortDir: 1 | -1
  groups: boolean
  preview: boolean
  sidebar: boolean
  ql: boolean
  menu: MenuId
}

type Action =
  | { t: "nav"; loc: Loc; sel?: string[] }
  | { t: "back" }
  | { t: "fwd" }
  | { t: "select"; keys: string[] }
  | { t: "click"; key: string; mode: "single" | "toggle" | "range"; order: string[] }
  | { t: "query"; q: string }
  | { t: "view"; v: View }
  | { t: "sort"; key: SortKey; dir?: 1 | -1 }
  | { t: "toggle"; k: "groups" | "preview" | "sidebar" }
  | { t: "ql"; open: boolean }
  | { t: "menu"; m: MenuId }

function initState(payload: unknown): State {
  const p = readPayload(payload)
  const sel = p?.sel && resolve(p.loc).items.some((i) => i.key === p.sel) ? [p.sel] : []
  return {
    stack: [p?.loc ?? DESKTOP_FOLDERS[0].id],
    at: 0,
    sel,
    anchor: sel[0] ?? null,
    query: "",
    view: "icons",
    sortKey: "name",
    sortDir: 1,
    groups: false,
    preview: true,
    sidebar: true,
    ql: false,
    menu: null,
  }
}

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case "nav": {
      const sel = a.sel ?? []
      const base = { ...s, sel, anchor: sel[0] ?? null, query: "", ql: false, menu: null }
      if (s.stack[s.at] === a.loc) return base
      const stack = [...s.stack.slice(0, s.at + 1), a.loc]
      return { ...base, stack, at: stack.length - 1 }
    }
    case "back":
    case "fwd": {
      const at = a.t === "back" ? s.at - 1 : s.at + 1
      if (at < 0 || at >= s.stack.length) return s
      return { ...s, at, sel: [], anchor: null, query: "", ql: false, menu: null }
    }
    case "select":
      return { ...s, sel: a.keys, anchor: a.keys[0] ?? null, ql: a.keys.length ? s.ql : false }
    case "click": {
      if (a.mode === "toggle") {
        const has = s.sel.includes(a.key)
        const sel = has ? s.sel.filter((k) => k !== a.key) : [...s.sel, a.key]
        return { ...s, sel, anchor: a.key, ql: sel.length ? s.ql : false }
      }
      if (a.mode === "range" && s.anchor) {
        const from = a.order.indexOf(s.anchor)
        const to = a.order.indexOf(a.key)
        if (from >= 0 && to >= 0) {
          const range = a.order.slice(Math.min(from, to), Math.max(from, to) + 1)
          return { ...s, sel: to < from ? range.reverse() : range }
        }
      }
      return { ...s, sel: [a.key], anchor: a.key }
    }
    case "query":
      return { ...s, query: a.q }
    case "view":
      return { ...s, view: a.v }
    case "sort":
      return { ...s, sortKey: a.key, sortDir: a.dir ?? (s.sortKey === a.key ? (s.sortDir === 1 ? -1 : 1) : 1), menu: null }
    case "toggle":
      return { ...s, [a.k]: !s[a.k] }
    case "ql":
      return { ...s, ql: a.open && s.sel.length > 0 }
    case "menu":
      return { ...s, menu: a.m }
  }
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" })
function compare(a: Item, b: Item, key: SortKey): number {
  if (key === "modified") return a.modified - b.modified
  if (key === "size") return a.size - b.size
  if (key === "kind") return collator.compare(a.kind, b.kind) || collator.compare(a.name, b.name)
  return collator.compare(a.name, b.name)
}

// ---------------------------------------------------------------------------
// Icons for items

function FolderGlyph({ w, className }: { w: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 50" width={w} height={(w * 50) / 64} aria-hidden="true" className={cn("drop-shadow-[0_1px_1px_rgba(0,0,0,.18)]", className)}>
      <path d="M2 8a4 4 0 0 1 4-4h15.5a4 4 0 0 1 2.8 1.2L28 9h30a4 4 0 0 1 4 4v31a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" fill="#3b8fe8" />
      <path d="M2 17a4 4 0 0 1 4-4h52a4 4 0 0 1 4 4v27a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" fill="#6cb3f9" />
      <path d="M6 13h52a4 4 0 0 1 4 4v1.4H2V17a4 4 0 0 1 4-4z" fill="#fff" opacity=".38" />
    </svg>
  )
}

const BADGE_COLOR: Record<string, string> = { PDF: "#e5484d", TXT: "#8e8e93", RAW: "#6e56cf", DRX: "#e5484d" }

/** A white sheet of paper with a folded corner, faint lines and a kind badge. */
function Paper({ w, badge, seed, title }: { w: number; badge: string; seed: number; title?: string }) {
  const h = Math.round(w * 1.294)
  const n = w < 24 ? 3 : w < 80 ? 7 : 16
  const r = rng(seed + 31)
  const lines = Array.from({ length: n }, (_, i) => (i === 0 && title ? 0 : 45 + r() * 55))
  const lh = Math.max(1, w * 0.022)
  return (
    <span className="relative block shrink-0 drop-shadow-[0_1px_1.5px_rgba(0,0,0,.28)]" style={{ width: w, height: h }} aria-hidden="true">
      <span className="absolute inset-0 bg-white" style={{ clipPath: "polygon(0 0, 74% 0, 100% 20%, 100% 100%, 0 100%)" }}>
        <span className="absolute flex flex-col" style={{ inset: `${w * 0.3}px ${w * 0.14}px auto`, gap: lh * 2.6 }}>
          {lines.map((pct, i) =>
            i === 0 && title ? (
              <span key={i} className="truncate font-semibold text-black/70" style={{ fontSize: w * 0.06, lineHeight: 1.2 }}>
                {title}
              </span>
            ) : (
              <span key={i} className="block rounded-full bg-black/10" style={{ width: pct + "%", height: lh }} />
            ),
          )}
        </span>
      </span>
      <span
        className="absolute top-0 right-0"
        style={{ width: "26%", height: "20%", background: "linear-gradient(to top right, #dcdce2 50%, transparent 50%)" }}
      />
      {badge && w >= 24 ? (
        <span
          className="absolute left-1/2 -translate-x-1/2 rounded-[3px] font-semibold tracking-wide text-white"
          style={{ bottom: h * 0.1, fontSize: Math.max(7, w * 0.15), padding: `0 ${w * 0.05}px`, background: BADGE_COLOR[badge] ?? "#6b7280" }}
        >
          {badge}
        </span>
      ) : null}
    </span>
  )
}

function AppGlyph({ app, w }: { app: AppId; w: number }) {
  const a = APPS[app]
  const Icon = a.icon
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 place-items-center rounded-[23%] shadow-[inset_0_1px_0_rgba(255,255,255,.4),0_0_0_.5px_rgba(0,0,0,.18),0_2px_6px_-2px_rgba(0,0,0,.4)]", a.tile, a.glyph)}
      style={{ width: w, height: w }}
    >
      <Icon style={{ width: w * 0.56, height: w * 0.56 }} />
    </span>
  )
}

type ThumbSize = "row" | "tile" | "preview" | "ql"
const ART_PX: Record<ThumbSize, [number, number]> = { row: [128, 96], tile: [128, 96], preview: [256, 192], ql: [512, 384] }
const ART_CSS: Record<ThumbSize, [number, number]> = { row: [20, 15], tile: [80, 60], preview: [188, 141], ql: [0, 0] }
const GLYPH_W: Record<ThumbSize, { paper: number; folder: number; app: number }> = {
  row: { paper: 13, folder: 18, app: 16 },
  tile: { paper: 48, folder: 68, app: 56 },
  preview: { paper: 110, folder: 128, app: 96 },
  ql: { paper: 250, folder: 200, app: 140 },
}

const Thumb = React.memo(function Thumb({ item, size, artWidth }: { item: Item; size: ThumbSize; artWidth?: number }) {
  if (item.glyph === "art" && item.art) {
    const [pw, ph] = ART_PX[size]
    const [cw, ch] = size === "ql" ? [artWidth ?? 480, Math.round(((artWidth ?? 480) * 3) / 4)] : ART_CSS[size]
    return (
      <ArtThumb
        art={item.art}
        seed={item.seed}
        w={pw}
        h={ph}
        className={cn(
          "shrink-0",
          size === "row" ? "rounded-[2px]" : size === "tile" ? "rounded-[3px] shadow-[0_0_0_2px_#fff,0_2px_6px_-1px_rgba(0,0,0,.35)]" : "rounded-lg shadow-[0_0_0_.5px_rgba(0,0,0,.15),0_10px_30px_-12px_rgba(0,0,0,.5)]",
        )}
        cssW={cw}
        cssH={ch}
      />
    )
  }
  const g = GLYPH_W[size]
  if (item.glyph === "folder") return <FolderGlyph w={g.folder} />
  if (item.glyph === "app" && item.app) return <AppGlyph app={item.app} w={g.app} />
  return <Paper w={g.paper} badge={item.badge} seed={item.seed} title={size === "ql" || size === "preview" ? item.name : undefined} />
})

function TagDots({ tags, className }: { tags: TagId[]; className?: string }) {
  if (!tags.length) return null
  return (
    <span className={cn("inline-flex shrink-0 items-center -space-x-1", className)} aria-label={"Tags: " + tags.join(", ")}>
      {tags.map((t) => (
        <span key={t} className="size-2 rounded-full ring-1 ring-white/70 dark:ring-black/40" style={{ background: TAG_COLOR[t] }} />
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Items in each view. Memoised: resizing the window re-renders the frame, not these.

const optionId = (prefix: string, key: string) => prefix + "-" + key.replace(/\s+/g, "_")

type ItemProps = {
  item: Item
  selected: boolean
  idPrefix: string
  onClick: (key: string, e: React.MouseEvent) => void
  onOpen: (key: string) => void
}

const Tile = React.memo(function Tile({ item, selected, idPrefix, onClick, onOpen }: ItemProps) {
  return (
    <div
      role="option"
      id={optionId(idPrefix, item.key)}
      aria-selected={selected}
      data-key={item.key}
      onClick={(e) => onClick(item.key, e)}
      onDoubleClick={() => onOpen(item.key)}
      title={item.name}
      className="flex min-w-0 cursor-default flex-col items-center gap-1 rounded-md p-1 select-none"
    >
      <span
        className={cn(
          "grid h-[78px] w-[94px] place-items-center rounded-[7px] transition-colors duration-100",
          selected && "bg-[var(--glass-ink-faint)] group-focus-within/list:bg-[color-mix(in_srgb,var(--glass-accent)_24%,transparent)]",
        )}
      >
        <Thumb item={item} size="tile" />
      </span>
      <span className="flex max-w-full items-start gap-1">
        <span
          className={cn(
            "line-clamp-2 max-w-[104px] rounded-[4px] px-1.5 py-px text-center text-[12px] leading-[15px] tracking-[-0.01em] break-words ink",
            selected && "bg-[var(--glass-ink-faint)] group-focus-within/list:bg-[var(--glass-accent)] group-focus-within/list:text-white",
          )}
        >
          {item.name}
        </span>
      </span>
      <TagDots tags={item.tags} className="-mt-0.5" />
    </div>
  )
})

const Row = React.memo(function Row({
  item,
  selected,
  idPrefix,
  onClick,
  onOpen,
  zebra,
  cols,
  showDate,
  showKind,
}: ItemProps & { zebra: boolean; cols: string; showDate: boolean; showKind: boolean }) {
  const soft = cn("truncate ink-soft", selected && "group-focus-within/list:text-white/85")
  return (
    <div
      role="option"
      id={optionId(idPrefix, item.key)}
      aria-selected={selected}
      data-key={item.key}
      onClick={(e) => onClick(item.key, e)}
      onDoubleClick={() => onOpen(item.key)}
      className={cn(
        "grid h-6 cursor-default items-center gap-3 rounded-[5px] px-2.5 text-[12.5px] tracking-[-0.01em] select-none",
        zebra && !selected && "bg-[var(--glass-hover)]",
        selected && "bg-[var(--glass-ink-faint)] group-focus-within/list:bg-[var(--glass-accent)] group-focus-within/list:text-white",
      )}
      style={{ gridTemplateColumns: cols }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="grid w-5 shrink-0 place-items-center">
          <Thumb item={item} size="row" />
        </span>
        <span className="truncate">{item.name}</span>
        <TagDots tags={item.tags} />
        {item.go ? <ChevronRight className={cn("ml-auto size-3 shrink-0", soft)} /> : null}
      </span>
      {showDate ? <span className={soft}>{formatDate(item.modified)}</span> : null}
      <span className={cn(soft, "text-right tabular-nums")}>{item.sizeLabel}</span>
      {showKind ? <span className={soft}>{item.kind}</span> : null}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Menus

function MenuPopover({
  label,
  onClose,
  triggerRef,
  children,
  className,
}: {
  label: string
  onClose: () => void
  /** Wraps the trigger button; focus returns to it on Escape. */
  triggerRef: React.RefObject<HTMLDivElement | null>
  children: React.ReactNode
  className?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role^=menuitem]")?.focus()
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (ref.current?.contains(t) || t.closest?.("[data-menu-trigger]")) return
      onClose()
    }
    document.addEventListener("pointerdown", down, true)
    return () => document.removeEventListener("pointerdown", down, true)
  }, [onClose])
  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const d = e.key === "ArrowDown" ? 1 : -1
      items[(i + d + items.length) % items.length]?.focus()
    } else if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      triggerRef.current?.querySelector("button")?.focus()
    } else if (e.key === "Tab") {
      onClose()
    }
  }
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "glass glass-strong absolute top-full right-0 z-40 mt-1.5 min-w-48 rounded-[10px] p-1.5",
        "origin-top-right [animation:glass-widget-in_.18s_var(--glass-ease)_both]",
        className,
      )}
    >
      {children}
    </div>
  )
}

function MenuItem({
  children,
  checked,
  role = "menuitem",
  onSelect,
  disabled,
}: {
  children: React.ReactNode
  checked?: boolean
  role?: "menuitem" | "menuitemradio" | "menuitemcheckbox"
  onSelect: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === "menuitem" ? undefined : !!checked}
      disabled={disabled}
      tabIndex={-1}
      onClick={onSelect}
      className={cn(
        "flex h-[22px] w-full items-center gap-1.5 rounded-[5px] pr-3 pl-1 text-left text-[13px] tracking-[-0.01em] ink outline-none",
        "hover:bg-[var(--glass-accent)] hover:text-white focus-visible:bg-[var(--glass-accent)] focus-visible:text-white focus:bg-[var(--glass-accent)] focus:text-white",
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      <span className="grid w-4 shrink-0 place-items-center">{checked ? <Check className="size-3.5" strokeWidth={2.5} /> : null}</span>
      {children}
    </button>
  )
}

const MenuSep = () => <div role="separator" className="mx-2 my-1 h-px bg-[var(--glass-ink-faint)]" />

// ---------------------------------------------------------------------------
// Preview pane / Quick Look body

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px] text-[11.5px]">
      <span className="shrink-0 ink-soft">{label}</span>
      <span className="min-w-0 truncate text-right ink">{value}</span>
    </div>
  )
}

function PreviewBody({ items, info, count, onQuickLook }: { items: Item[]; info: LocInfo; count: number; onQuickLook: () => void }) {
  const one = items.length === 1 ? items[0] : null
  if (!items.length) {
    const Icon = info.icon
    return (
      <div className="flex flex-col items-center gap-2 px-4 pt-8 text-center">
        {Icon ? <Icon className="size-16 text-[var(--glass-accent)]" strokeWidth={1.2} /> : <FolderGlyph w={112} />}
        <p className="mt-2 text-[13.5px] font-semibold tracking-tight ink">{info.title}</p>
        <p className="text-[11.5px] ink-soft">
          {count} {count === 1 ? "item" : "items"}
        </p>
      </div>
    )
  }
  if (!one) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 pt-8 text-center">
        <div className="relative h-36 w-44">
          {items.slice(-3).map((it, i, arr) => (
            <span
              key={it.key}
              className="absolute inset-0 grid place-items-center"
              style={{ transform: `rotate(${(i - (arr.length - 1) / 2) * 7}deg) translateY(${(arr.length - 1 - i) * -4}px)` }}
            >
              <Thumb item={it} size="tile" />
            </span>
          ))}
        </div>
        <p className="text-[13.5px] font-semibold tracking-tight ink">{items.length} items</p>
        <p className="text-[11.5px] ink-soft">{formatBytes(items.reduce((s, i) => s + Math.max(0, i.size), 0))}</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col px-4 pt-5 pb-4">
      <div className="grid h-[168px] place-items-center">
        <Thumb item={one} size="preview" />
      </div>
      <p className="mt-3 text-[13.5px] leading-tight font-semibold tracking-tight break-words ink">{one.name}</p>
      <p className="mt-0.5 text-[11.5px] ink-soft">
        {one.kind}
        {one.size >= 0 ? " – " + one.sizeLabel : ""}
      </p>
      <p className="mt-4 mb-1 text-[11.5px] font-semibold ink">Information</p>
      <div className="divide-y divide-[var(--glass-ink-faint)] border-t border-[var(--glass-ink-faint)]">
        <InfoRow label="Created" value={formatDate(one.created)} />
        <InfoRow label="Modified" value={formatDate(one.modified)} />
        {one.dims ? <InfoRow label="Dimensions" value={one.dims} /> : null}
        {one.note ? <InfoRow label="Contents" value={one.note} /> : null}
      </div>
      <p className="mt-4 mb-1 text-[11.5px] font-semibold ink">Tags</p>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px]">
        {one.tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 ink">
            <span className="size-2.5 rounded-full" style={{ background: TAG_COLOR[t] }} />
            {TAGS.find((x) => x.id === t)?.label}
          </span>
        ))}
        <span className="ink-soft">Add Tags…</span>
      </div>
      {!one.go && !one.app ? (
        <GlassButton className="mt-4 self-start border border-[var(--glass-ink-faint)] text-[12px]" onClick={onQuickLook}>
          <Eye /> Quick Look
        </GlassButton>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

const AVAILABLE = "128.4 GB available"

export default function FinderWindow({ win }: { win: WindowState }) {
  const { open, update } = useWindowManager()
  const [s, dispatch] = React.useReducer(reducer, win.payload, initState)
  const idPrefix = React.useId().replace(/[^a-zA-Z0-9_-]/g, "") + "f"
  const listRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const sortRef = React.useRef<HTMLDivElement>(null)
  const shareRef = React.useRef<HTMLDivElement>(null)
  const qlCloseRef = React.useRef<HTMLButtonElement>(null)

  // Re-opened from a folder card: go there and select the file.
  const [seenPayload, setSeenPayload] = React.useState(win.payload)
  if (seenPayload !== win.payload) {
    setSeenPayload(win.payload)
    const p = readPayload(win.payload)
    if (p) dispatch({ t: "nav", loc: p.loc, sel: p.sel && resolve(p.loc).items.some((i) => i.key === p.sel) ? [p.sel] : [] })
  }

  const loc = s.stack[s.at]
  const info = resolve(loc)
  const folder = folderById(loc)

  const groups = React.useMemo(() => {
    const q = s.query.trim().toLowerCase()
    const items = (q ? info.items.filter((i) => i.name.toLowerCase().includes(q)) : info.items.slice()).sort(
      (a, b) => compare(a, b, s.sortKey) * s.sortDir,
    )
    if (!s.groups) return [{ label: null as string | null, items }]
    const by = new Map<string, Item[]>()
    for (const it of items) by.set(it.kind, [...(by.get(it.kind) ?? []), it])
    return [...by.keys()].sort(collator.compare).map((label) => ({ label: label as string | null, items: by.get(label)! }))
  }, [info, s.query, s.sortKey, s.sortDir, s.groups])
  const visible = React.useMemo(() => groups.flatMap((g) => g.items), [groups])
  const order = React.useMemo(() => visible.map((i) => i.key), [visible])
  const selSet = React.useMemo(() => new Set(s.sel), [s.sel])
  const selItems = React.useMemo(
    () => s.sel.map((k) => info.items.find((i) => i.key === k)).filter((i): i is Item => !!i),
    [s.sel, info],
  )
  const lead = selItems[selItems.length - 1] ?? null

  // ---- layout, derived from the window's size (no measuring)
  const sidebarShown = s.sidebar && win.w >= 560
  const previewShown = s.preview && s.view !== "columns" && win.w >= 720
  const mainW = win.w - (sidebarShown ? 190 : 0)
  const contentW = mainW - (previewShown ? 220 : 0)
  const compact = mainW < 540
  const showDate = contentW >= 470
  const showKind = contentW >= 390
  const cols = ["minmax(0,1fr)", showDate && "150px", "64px", showKind && "104px"].filter(Boolean).join(" ")
  const qlW = Math.max(200, Math.min(520, mainW - 64, ((win.h - 52 - 48 - 130) * 4) / 3))

  // ---- actions
  const openApp = React.useCallback(
    (id: AppId) => {
      const a = APPS[id]
      open(id, { title: a.name, w: a.defaultSize.w, h: a.defaultSize.h, singleton: a.singleton ? "app" : undefined })
    },
    [open],
  )
  const onItemClick = React.useCallback(
    (key: string, e: React.MouseEvent) => {
      const mode = e.metaKey || e.ctrlKey ? "toggle" : e.shiftKey ? "range" : "single"
      dispatch({ t: "click", key, mode, order })
    },
    [order],
  )
  const openItem = React.useCallback(
    (item: Item) => {
      if (item.go) dispatch({ t: "nav", loc: item.go })
      else if (item.app) openApp(item.app)
      else {
        dispatch({ t: "select", keys: [item.key] })
        dispatch({ t: "ql", open: true })
      }
    },
    [openApp],
  )
  const onItemOpen = React.useCallback(
    (key: string) => {
      const it = visible.find((i) => i.key === key)
      if (it) openItem(it)
    },
    [visible, openItem],
  )
  const closeMenu = React.useCallback(() => dispatch({ t: "menu", m: null }), [])
  const focusList = () => listRef.current?.focus({ preventScroll: true })

  /** The next item in a direction, by geometry, so wrapped grids and groups both work. */
  const neighbour = (dir: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): string | null => {
    const els = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-key]") ?? [])
    if (!els.length) return null
    const leadKey = s.sel[s.sel.length - 1]
    const idx = els.findIndex((el) => el.dataset.key === leadKey)
    const backwards = dir === "ArrowUp" || dir === "ArrowLeft"
    if (idx < 0) return els[backwards ? els.length - 1 : 0].dataset.key ?? null
    const horizontal = dir === "ArrowLeft" || dir === "ArrowRight"
    if (s.view !== "icons" || horizontal) {
      if (s.view !== "icons" && horizontal) return null
      return els[idx + (backwards ? -1 : 1)]?.dataset.key ?? null
    }
    const r = els[idx].getBoundingClientRect()
    const cx = r.left + r.width / 2
    let best: HTMLElement | null = null
    let bestScore = Infinity
    for (const el of els) {
      const e = el.getBoundingClientRect()
      const ok = dir === "ArrowDown" ? e.top >= r.bottom - 2 : e.bottom <= r.top + 2
      if (!ok) continue
      const score = Math.abs(e.top - r.top) * 1000 + Math.abs(e.left + e.width / 2 - cx)
      if (score < bestScore) {
        bestScore = score
        best = el
      }
    }
    return best?.dataset.key ?? null
  }

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey
    switch (e.key) {
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight": {
        if (mod && e.key === "ArrowDown") {
          e.preventDefault()
          if (lead) openItem(lead)
          return
        }
        const next = neighbour(e.key)
        e.preventDefault()
        if (next) dispatch({ t: "click", key: next, mode: e.shiftKey ? "range" : "single", order })
        return
      }
      case "Enter":
        if (lead) {
          e.preventDefault()
          openItem(lead)
        }
        return
      case " ":
        e.preventDefault()
        dispatch({ t: "ql", open: !s.ql })
        return
      case "Escape":
        if (s.sel.length) {
          e.preventDefault()
          dispatch({ t: "select", keys: [] })
        }
        return
      case "a":
      case "A":
        if (mod) {
          e.preventDefault()
          dispatch({ t: "select", keys: order })
        }
        return
    }
  }

  const onRootKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const inInput = (e.target as HTMLElement).tagName === "INPUT"
    if (e.key === "f" || e.key === "F") {
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    } else if (!inInput && e.key === "[") {
      e.preventDefault()
      dispatch({ t: "back" })
    } else if (!inInput && e.key === "]") {
      e.preventDefault()
      dispatch({ t: "fwd" })
    } else if (!inInput && e.key === "ArrowUp" && folder) {
      e.preventDefault()
      dispatch({ t: "nav", loc: "desktop" })
    }
  }

  const onQlKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" || e.key === " ") {
      e.preventDefault()
      e.stopPropagation()
      dispatch({ t: "ql", open: false })
    } else if (e.key.startsWith("Arrow")) {
      e.preventDefault()
      const next = neighbour(e.key as "ArrowUp")
      if (next) dispatch({ t: "select", keys: [next] })
    } else if (e.key === "Tab") {
      e.preventDefault()
    }
  }

  // ---- effects: focus, scroll-into-view, window title
  React.useEffect(() => {
    listRef.current?.focus({ preventScroll: true })
  }, [win.payload])

  const leadKey = s.sel[s.sel.length - 1]
  React.useEffect(() => {
    if (!leadKey) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(leadKey)}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [leadKey, s.view])

  const qlWasOpen = React.useRef(false)
  React.useEffect(() => {
    if (s.ql) qlCloseRef.current?.focus()
    else if (qlWasOpen.current) listRef.current?.focus({ preventScroll: true })
    qlWasOpen.current = s.ql
  }, [s.ql])

  React.useEffect(() => {
    if (win.title !== info.title) update(win.id, { title: info.title })
  }, [info.title, win.id, win.title, update])

  // ---- pieces
  const listProps = {
    ref: listRef,
    role: "listbox" as const,
    tabIndex: 0,
    "aria-label": info.title,
    "aria-multiselectable": true,
    "aria-activedescendant": leadKey && order.includes(leadKey) ? optionId(idPrefix, leadKey) : undefined,
    onKeyDown: onListKeyDown,
    onClick: (e: React.MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-key]")) dispatch({ t: "select", keys: [] })
    },
  }

  const emptyState = (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="flex max-w-60 flex-col items-center gap-3">
        {loc === "airdrop" ? (
          <span className="relative grid size-24 place-items-center">
            {[0, 1, 2].map((i) => (
              <span key={i} className="absolute rounded-full border border-[var(--glass-accent)]/40" style={{ inset: i * 14 }} />
            ))}
            <Radar className="size-8 text-[var(--glass-accent)]" />
          </span>
        ) : null}
        <p className="text-[12.5px] ink-soft">{s.query ? `No results for “${s.query}”` : info.empty}</p>
      </div>
    </div>
  )

  let content: React.ReactNode
  if (s.view === "icons") {
    content = (
      <div {...listProps} className="group/list h-full overflow-y-auto px-3 pt-2 pb-4 outline-none">
        {visible.length === 0
          ? emptyState
          : groups.map((g) => (
              <div key={g.label ?? "all"} role="group" aria-label={g.label ?? undefined}>
                {g.label ? (
                  <div className="sticky top-0 z-10 -mx-3 mb-1 border-b border-[var(--glass-ink-faint)] bg-white/70 px-4 pt-2 pb-1 text-[12px] font-semibold ink backdrop-blur-md dark:bg-[#202024]/80">
                    {g.label}
                  </div>
                ) : null}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(106px,1fr))] gap-x-1 gap-y-2 pb-2">
                  {g.items.map((it) => (
                    <Tile key={it.key} item={it} selected={selSet.has(it.key)} idPrefix={idPrefix} onClick={onItemClick} onOpen={onItemOpen} />
                  ))}
                </div>
              </div>
            ))}
      </div>
    )
  } else if (s.view === "list") {
    const header = (key: SortKey, label: string, right?: boolean) => (
      <button
        type="button"
        onClick={() => dispatch({ t: "sort", key })}
        aria-label={`Sort by ${label}`}
        aria-pressed={s.sortKey === key}
        className={cn(
          "flex min-w-0 items-center gap-1 truncate rounded px-0 text-left text-[11.5px] hover:ink focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)]",
          s.sortKey === key ? "font-semibold ink" : "ink-soft",
          right && "justify-end",
        )}
      >
        <span className="truncate">{label}</span>
        {s.sortKey === key ? <ChevronDown className={cn("size-3 shrink-0 transition-transform", s.sortDir === 1 && "rotate-180")} /> : null}
      </button>
    )
    content = (
      <div className="flex h-full flex-col">
        <div className="grid h-7 shrink-0 items-center gap-3 border-b border-[var(--glass-ink-faint)] px-5" style={{ gridTemplateColumns: cols }}>
          {header("name", "Name")}
          {showDate ? header("modified", "Date Modified") : null}
          {header("size", "Size", true)}
          {showKind ? header("kind", "Kind") : null}
        </div>
        <div {...listProps} className="group/list min-h-0 flex-1 overflow-y-auto px-2.5 py-1 outline-none">
          {visible.length === 0
            ? emptyState
            : groups.map((g) => (
                <div key={g.label ?? "all"} role="group" aria-label={g.label ?? undefined}>
                  {g.label ? <div className="px-2.5 pt-2 pb-1 text-[12px] font-semibold ink">{g.label}</div> : null}
                  {g.items.map((it, i) => (
                    <Row
                      key={it.key}
                      item={it}
                      selected={selSet.has(it.key)}
                      idPrefix={idPrefix}
                      onClick={onItemClick}
                      onOpen={onItemOpen}
                      zebra={i % 2 === 1}
                      cols={cols}
                      showDate={showDate}
                      showKind={showKind}
                    />
                  ))}
                </div>
              ))}
        </div>
      </div>
    )
  } else {
    content = (
      <div className="flex h-full">
        <div className="w-[176px] shrink-0 overflow-y-auto border-r border-[var(--glass-ink-faint)] px-1.5 py-1.5">
          {DESKTOP_FOLDERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => dispatch({ t: "nav", loc: f.id })}
              aria-current={f.id === loc ? "page" : undefined}
              className={cn(
                "flex h-6 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[12.5px] ink outline-none hover:bg-[var(--glass-hover)] focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)]",
                f.id === loc && "bg-[var(--glass-ink-faint)] hover:bg-[var(--glass-ink-faint)]",
              )}
            >
              <FolderGlyph w={18} />
              <span className="min-w-0 flex-1 truncate">{f.label}</span>
              <ChevronRight className="size-3 shrink-0 ink-soft" />
            </button>
          ))}
        </div>
        <div {...listProps} className="group/list w-[230px] shrink-0 overflow-y-auto border-r border-[var(--glass-ink-faint)] px-1.5 py-1.5 outline-none">
          {visible.length === 0
            ? emptyState
            : visible.map((it) => (
                <Row
                  key={it.key}
                  item={it}
                  selected={selSet.has(it.key)}
                  idPrefix={idPrefix}
                  onClick={onItemClick}
                  onOpen={onItemOpen}
                  zebra={false}
                  cols="minmax(0,1fr)"
                  showDate={false}
                  showKind={false}
                />
              ))}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <PreviewBody items={selItems} info={info} count={visible.length} onQuickLook={() => dispatch({ t: "ql", open: true })} />
        </div>
      </div>
    )
  }

  const ViewIcon = { icons: LayoutGrid, list: List, columns: Columns3 } as const
  const TitleIcon = info.icon
  const sidebarToggle = (
    <GlassButton aria-label={s.sidebar ? "Hide sidebar" : "Show sidebar"} aria-pressed={s.sidebar} onClick={() => dispatch({ t: "toggle", k: "sidebar" })} className="px-1.5">
      <PanelLeft />
    </GlassButton>
  )

  return (
    <GlassWindow win={win} titleBar={false} minW={420} minH={300}>
      <div className="flex h-full" onKeyDown={onRootKeyDown}>
        {/* ---- sidebar: the window's own glass, so it reads lighter than the content */}
        {sidebarShown ? (
          <nav aria-label="Sidebar" className="flex w-[190px] shrink-0 flex-col border-r border-[var(--glass-ink-faint)]">
            <div data-drag-handle className="flex h-[52px] shrink-0 items-center justify-between pr-2 pl-4 select-none">
              <TrafficLights id={win.id} />
              <span data-no-drag>{win.w >= 560 ? sidebarToggle : null}</span>
            </div>
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 pb-3" data-no-drag>
              <SidebarSection title="Favorites">
                {FAVORITES.map((p) => (
                  <SidebarItem key={p.id} active={loc === p.id} onClick={() => dispatch({ t: "nav", loc: p.id })} label={p.label}>
                    <p.icon className="size-4 text-[var(--glass-accent)]" strokeWidth={1.8} />
                  </SidebarItem>
                ))}
              </SidebarSection>
              <SidebarSection title="Desktop">
                {DESKTOP_FOLDERS.map((f) => (
                  <SidebarItem key={f.id} active={loc === f.id} onClick={() => dispatch({ t: "nav", loc: f.id })} label={f.label}>
                    <FolderGlyph w={16} />
                  </SidebarItem>
                ))}
              </SidebarSection>
              <SidebarSection title="Locations">
                {LOCATIONS.map((p) => (
                  <SidebarItem key={p.id} active={loc === p.id} onClick={() => dispatch({ t: "nav", loc: p.id })} label={p.label}>
                    <p.icon className="size-4 text-[var(--glass-accent)]" strokeWidth={1.8} />
                  </SidebarItem>
                ))}
              </SidebarSection>
              <SidebarSection title="Tags">
                {TAGS.map((t) => (
                  <SidebarItem key={t.id} active={loc === "tag:" + t.id} onClick={() => dispatch({ t: "nav", loc: "tag:" + t.id })} label={t.label}>
                    <span className="mx-[3px] size-2.5 rounded-full shadow-[inset_0_0_0_.5px_rgba(0,0,0,.2)]" style={{ background: t.color }} />
                  </SidebarItem>
                ))}
              </SidebarSection>
            </div>
          </nav>
        ) : null}

        {/* ---- main column: denser glass for toolbar, content and status */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-white/45 dark:bg-[#18181c]/45">
          <div data-drag-handle className="relative z-30 flex h-[52px] shrink-0 items-center gap-1 border-b border-[var(--glass-ink-faint)] px-2.5 select-none">
            {!sidebarShown ? (
              <>
                <TrafficLights id={win.id} className="mr-2 ml-1.5" />
                {win.w >= 560 ? sidebarToggle : null}
              </>
            ) : null}
            <div className="flex items-center" data-no-drag>
              <GlassButton aria-label="Back" title="Back" disabled={s.at === 0} onClick={() => dispatch({ t: "back" })} className="px-1">
                <ChevronLeft className="!size-[18px]" />
              </GlassButton>
              <GlassButton aria-label="Forward" title="Forward" disabled={s.at >= s.stack.length - 1} onClick={() => dispatch({ t: "fwd" })} className="px-1">
                <ChevronRight className="!size-[18px]" />
              </GlassButton>
            </div>
            <div className="ml-1 flex min-w-0 items-center gap-1.5">
              {TitleIcon ? <TitleIcon className="size-4 shrink-0 text-[var(--glass-accent)]" strokeWidth={1.8} /> : <FolderGlyph w={17} className="shrink-0" />}
              <h2 className="truncate text-[13.5px] font-semibold tracking-[-0.01em] ink">{info.title}</h2>
            </div>
            <div className="min-w-2 flex-1 self-stretch" />

            <div data-no-drag className="flex shrink-0 items-center gap-1">
              <div role="radiogroup" aria-label="View" className="flex items-center rounded-[7px] bg-[var(--glass-ink-faint)] p-[2px]">
                {(["icons", "list", "columns"] as const).map((v) => {
                  const Icon = ViewIcon[v]
                  const on = s.view === v
                  return (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`as ${v[0].toUpperCase() + v.slice(1)}`}
                      title={`View as ${v[0].toUpperCase() + v.slice(1)}`}
                      onClick={() => dispatch({ t: "view", v })}
                      className={cn(
                        "grid h-6 w-7 place-items-center rounded-[5px] transition-[background-color,box-shadow] duration-150 [transition-timing-function:var(--glass-ease)] focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)]",
                        on ? "bg-white ink shadow-[0_1px_2px_rgba(0,0,0,.15),0_0_0_.5px_rgba(0,0,0,.06)] dark:bg-white/20" : "ink-soft hover:ink",
                      )}
                    >
                      <Icon className="size-[15px]" />
                    </button>
                  )
                })}
              </div>

              <div className="relative" ref={sortRef}>
                <GlassButton
                  data-menu-trigger
                  aria-label="Sort and group"
                  title="Sort and group"
                  aria-haspopup="menu"
                  aria-expanded={s.menu === "sort"}
                  active={s.menu === "sort"}
                  onClick={() => dispatch({ t: "menu", m: s.menu === "sort" ? null : "sort" })}
                  className="gap-0.5 px-1.5"
                >
                  <ArrowDownWideNarrow />
                  <ChevronDown className="!size-3" />
                </GlassButton>
                {s.menu === "sort" ? (
                  <MenuPopover label="Sort and group" onClose={closeMenu} triggerRef={sortRef}>
                    <MenuItem role="menuitemcheckbox" checked={s.groups} onSelect={() => dispatch({ t: "toggle", k: "groups" })}>
                      Use Groups
                    </MenuItem>
                    <MenuSep />
                    <p className="px-2 pt-0.5 pb-1 text-[11px] font-semibold ink-soft">Sort By</p>
                    {(
                      [
                        ["name", "Name"],
                        ["kind", "Kind"],
                        ["modified", "Date Modified"],
                        ["size", "Size"],
                      ] as const
                    ).map(([k, label]) => (
                      <MenuItem key={k} role="menuitemradio" checked={s.sortKey === k} onSelect={() => dispatch({ t: "sort", key: k, dir: s.sortDir })}>
                        {label}
                      </MenuItem>
                    ))}
                    <MenuSep />
                    <MenuItem role="menuitemradio" checked={s.sortDir === 1} onSelect={() => dispatch({ t: "sort", key: s.sortKey, dir: 1 })}>
                      Ascending
                    </MenuItem>
                    <MenuItem role="menuitemradio" checked={s.sortDir === -1} onSelect={() => dispatch({ t: "sort", key: s.sortKey, dir: -1 })}>
                      Descending
                    </MenuItem>
                  </MenuPopover>
                ) : null}
              </div>

              {!compact ? (
                <div className="relative" ref={shareRef}>
                  <GlassButton
                    data-menu-trigger
                    aria-label="Share"
                    title="Share"
                    aria-haspopup="menu"
                    aria-expanded={s.menu === "share"}
                    active={s.menu === "share"}
                    disabled={!s.sel.length}
                    onClick={() => dispatch({ t: "menu", m: s.menu === "share" ? null : "share" })}
                    className="px-1.5"
                  >
                    <Share />
                  </GlassButton>
                  {s.menu === "share" ? (
                    <MenuPopover label="Share" onClose={closeMenu} triggerRef={shareRef}>
                      {["AirDrop", "Mail", "Messages", "Notes"].map((m) => (
                        <MenuItem key={m} onSelect={closeMenu}>
                          {m}
                        </MenuItem>
                      ))}
                      <MenuSep />
                      <MenuItem
                        onSelect={() => {
                          void navigator.clipboard?.writeText(selItems.map((i) => i.name).join("\n")).catch(() => {})
                          closeMenu()
                        }}
                      >
                        Copy {s.sel.length === 1 ? "Name" : "Names"}
                      </MenuItem>
                    </MenuPopover>
                  ) : null}
                </div>
              ) : null}

              {!compact && s.view !== "columns" && win.w >= 720 ? (
                <GlassButton
                  aria-label={s.preview ? "Hide preview" : "Show preview"}
                  title={s.preview ? "Hide preview" : "Show preview"}
                  aria-pressed={s.preview}
                  active={s.preview}
                  onClick={() => dispatch({ t: "toggle", k: "preview" })}
                  className="px-1.5"
                >
                  <PanelRight />
                </GlassButton>
              ) : null}

              <label className="relative ml-1 flex items-center">
                <span className="sr-only">Search</span>
                <Search className="pointer-events-none absolute left-2 size-3.5 ink-soft" />
                <input
                  ref={searchRef}
                  role="searchbox"
                  type="text"
                  value={s.query}
                  placeholder="Search"
                  spellCheck={false}
                  onChange={(e) => dispatch({ t: "query", q: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault()
                      dispatch({ t: "query", q: "" })
                      focusList()
                    } else if (e.key === "Enter" || e.key === "ArrowDown") {
                      e.preventDefault()
                      if (order[0]) dispatch({ t: "select", keys: [order[0]] })
                      focusList()
                    }
                  }}
                  className={cn(
                    "h-7 rounded-[7px] bg-[var(--glass-ink-faint)] pr-6 pl-7 text-[12.5px] ink outline-none placeholder:text-[var(--glass-ink-soft)]",
                    "transition-[width,box-shadow] duration-200 [transition-timing-function:var(--glass-ease)]",
                    "focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--glass-accent)_45%,transparent)]",
                    compact ? "w-[110px] focus:w-[140px]" : "w-[150px] focus:w-[190px]",
                  )}
                />
                {s.query ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      dispatch({ t: "query", q: "" })
                      searchRef.current?.focus()
                    }}
                    className="absolute right-1.5 grid size-4 place-items-center rounded-full bg-[var(--glass-ink-soft)] text-white dark:text-black"
                  >
                    <X className="size-2.5" strokeWidth={3} />
                  </button>
                ) : null}
              </label>
            </div>
          </div>

          {/* ---- content + preview */}
          <div className="relative flex min-h-0 flex-1" data-no-drag>
            <div className="relative min-w-0 flex-1">{content}</div>
            {previewShown ? (
              <aside aria-label="Preview" className="w-[220px] shrink-0 overflow-y-auto border-l border-[var(--glass-ink-faint)]">
                <PreviewBody items={selItems} info={info} count={visible.length} onQuickLook={() => dispatch({ t: "ql", open: true })} />
              </aside>
            ) : null}

            {/* ---- Quick Look */}
            {s.ql && lead ? (
              <div
                className="absolute inset-0 z-20 grid place-items-center bg-black/[.06] p-6 [animation:glass-widget-in_.2s_var(--glass-ease)_both] dark:bg-black/30"
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) dispatch({ t: "ql", open: false })
                }}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label={"Quick Look: " + lead.name}
                  onKeyDown={onQlKeyDown}
                  className="glass glass-strong flex max-h-full max-w-full flex-col overflow-hidden rounded-xl [animation:glass-window-in_.34s_var(--glass-spring)_both]"
                  style={{ width: qlW + 32 }}
                >
                  <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--glass-ink-faint)] px-2.5">
                    <button
                      ref={qlCloseRef}
                      type="button"
                      aria-label="Close Quick Look"
                      onClick={() => dispatch({ t: "ql", open: false })}
                      className="grid size-6 place-items-center rounded-md ink-soft hover:bg-[var(--glass-hover)] hover:ink focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)]"
                    >
                      <X className="size-4" />
                    </button>
                    <p className="min-w-0 flex-1 truncate text-center text-[13px] font-semibold tracking-[-0.01em] ink">{lead.name}</p>
                    <span className="w-6" />
                  </div>
                  <div className="grid min-h-0 flex-1 place-items-center overflow-hidden p-4">
                    <Thumb item={lead} size="ql" artWidth={qlW} />
                  </div>
                  <div className="flex shrink-0 items-center justify-center gap-2 px-4 pb-3 text-[11.5px] ink-soft">
                    <span>{lead.kind}</span>
                    {lead.size >= 0 ? <span>· {lead.sizeLabel}</span> : null}
                    {lead.dims ? <span>· {lead.dims}</span> : null}
                    <span className="hidden sm:inline">· Modified {formatDate(lead.modified)}</span>
                    <TagDots tags={lead.tags} className="ml-1" />
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* ---- path bar + status bar */}
          <div className="shrink-0 border-t border-[var(--glass-ink-faint)] text-[11px]" data-no-drag>
            <nav aria-label="Path" className="no-scrollbar flex h-6 items-center gap-0.5 overflow-x-auto px-3 whitespace-nowrap">
              {info.path.map((seg, i) => {
                const last = i === info.path.length - 1
                const target = PATH_TARGET[seg]
                const Icon = i === 0 && seg === "Macintosh HD" ? HardDrive : null
                const inner = (
                  <>
                    {Icon ? <Icon className="size-3.5 ink-soft" /> : last && !info.icon ? <FolderGlyph w={13} /> : !last ? <FolderGlyph w={13} /> : null}
                    <span>{seg}</span>
                  </>
                )
                return (
                  <React.Fragment key={i}>
                    {i > 0 ? <ChevronRight className="size-3 shrink-0 ink-soft" /> : null}
                    {target && !last ? (
                      <button
                        type="button"
                        onClick={() => dispatch({ t: "nav", loc: target })}
                        className="flex items-center gap-1 rounded px-1 ink-soft hover:bg-[var(--glass-hover)] hover:ink focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)]"
                      >
                        {inner}
                      </button>
                    ) : (
                      <span className={cn("flex items-center gap-1 px-1", last ? "ink" : "ink-soft")} aria-current={last ? "location" : undefined}>
                        {inner}
                      </span>
                    )}
                  </React.Fragment>
                )
              })}
            </nav>
            <p className="flex h-6 items-center justify-center border-t border-[var(--glass-ink-faint)] px-3 ink-soft" aria-live="polite">
              {visible.length} {visible.length === 1 ? "item" : "items"}
              {s.sel.length ? `, ${s.sel.length} selected` : ""} · {AVAILABLE}
            </p>
          </div>
        </div>
      </div>
    </GlassWindow>
  )
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(true)
  return (
    <div className="mt-3 first:mt-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group/sec flex w-full items-center justify-between rounded px-2 pb-1 text-left text-[11px] font-semibold ink-soft focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)]"
      >
        {title}
        <ChevronDown className={cn("size-3 opacity-0 transition-[opacity,transform] group-hover/sec:opacity-100 group-focus-visible/sec:opacity-100", !open && "-rotate-90")} />
      </button>
      {open ? <ul className="flex flex-col gap-px">{children}</ul> : null}
    </div>
  )
}

function SidebarItem({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-[26px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] tracking-[-0.01em] ink transition-colors duration-100 outline-none",
          "hover:bg-[var(--glass-hover)] focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)]",
          active && "bg-[var(--glass-ink-faint)] hover:bg-[var(--glass-ink-faint)]",
        )}
      >
        <span className="grid w-4 shrink-0 place-items-center">{children}</span>
        <span className="truncate">{label}</span>
      </button>
    </li>
  )
}
