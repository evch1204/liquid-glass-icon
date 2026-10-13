import type { LucideIcon } from "lucide-react"
import { CalendarDays, Camera, Clock, CloudSun, FolderOpen, Music, NotebookPen, Settings2, TrendingUp } from "lucide-react"
import type { AppId } from "@/components/desktop/window-manager"

/**
 * Everything the dock and menu bar know about an app. The component that
 * renders each app's window is wired up in `components/desktop/desktop.tsx`.
 */
export type DesktopApp = {
  id: AppId
  name: string
  icon: LucideIcon
  /** Tailwind background classes for the dock tile. */
  tile: string
  /** Icon colour on the tile. */
  glyph: string
  defaultSize: { w: number; h: number }
  /** Whether the dock opens one window of this app and then toggles it. */
  singleton: boolean
}

export const APPS: Record<AppId, DesktopApp> = {
  finder: {
    id: "finder",
    name: "Finder",
    icon: FolderOpen,
    tile: "bg-[linear-gradient(180deg,#5ac8fa_0%,#2f8df5_100%)]",
    glyph: "text-white",
    defaultSize: { w: 880, h: 560 },
    singleton: false,
  },
  "photo-booth": {
    id: "photo-booth",
    name: "Photo Booth",
    icon: Camera,
    tile: "bg-[linear-gradient(180deg,#ff8a80_0%,#d32f2f_100%)]",
    glyph: "text-white",
    defaultSize: { w: 760, h: 620 },
    singleton: true,
  },
  stocks: {
    id: "stocks",
    name: "Stocks",
    icon: TrendingUp,
    tile: "bg-[linear-gradient(180deg,#3a3a3f_0%,#111113_100%)]",
    glyph: "text-white",
    defaultSize: { w: 820, h: 560 },
    singleton: true,
  },
  clock: {
    id: "clock",
    name: "Clock",
    icon: Clock,
    tile: "bg-[linear-gradient(180deg,#ffffff_0%,#dcdce0_100%)]",
    glyph: "text-black",
    defaultSize: { w: 720, h: 460 },
    singleton: true,
  },
  weather: {
    id: "weather",
    name: "Weather",
    icon: CloudSun,
    tile: "bg-[linear-gradient(180deg,#64b5f6_0%,#1e88e5_100%)]",
    glyph: "text-white",
    defaultSize: { w: 720, h: 520 },
    singleton: true,
  },
  calendar: {
    id: "calendar",
    name: "Calendar",
    icon: CalendarDays,
    tile: "bg-[linear-gradient(180deg,#ffffff_0%,#f1f1f3_100%)]",
    glyph: "text-[#ff3b30]",
    defaultSize: { w: 760, h: 540 },
    singleton: true,
  },
  music: {
    id: "music",
    name: "Music",
    icon: Music,
    tile: "bg-[linear-gradient(180deg,#ff6b81_0%,#fc3c44_100%)]",
    glyph: "text-white",
    defaultSize: { w: 640, h: 420 },
    singleton: true,
  },
  notes: {
    id: "notes",
    name: "Notes",
    icon: NotebookPen,
    tile: "bg-[linear-gradient(180deg,#ffe082_0%,#ffb300_100%)]",
    glyph: "text-black/80",
    defaultSize: { w: 640, h: 520 },
    singleton: true,
  },
  settings: {
    id: "settings",
    name: "System Settings",
    icon: Settings2,
    tile: "bg-[linear-gradient(180deg,#9e9ea4_0%,#5f5f66_100%)]",
    glyph: "text-white",
    defaultSize: { w: 620, h: 500 },
    singleton: true,
  },
}

/** Dock order, left to right. */
export const DOCK_ORDER: AppId[] = ["finder", "photo-booth", "stocks", "clock", "weather", "calendar", "music", "notes", "settings"]
