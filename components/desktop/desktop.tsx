"use client"

import * as React from "react"
import type { ArtPreset } from "@/components/ui/glass-folder-cards"
import { Dock } from "./dock"
import { FoldersShelf } from "./folders-shelf"
import { MenuBar } from "./menu-bar"
import { Wallpaper } from "./wallpaper"
import { WindowManager, useWindowManager, type AppId, type WindowState } from "./window-manager"
import { GlassObjectStyles } from "@/components/ui/glass-object"
import FinderWindow from "./apps/finder-window"
import PhotoBoothWindow from "./apps/photo-booth"
import NotesWindow from "./apps/notes-window"
import SettingsWindow from "./apps/settings-window"
import { StocksWindow } from "./widgets/stocks"
import { StocksWidget } from "./widgets/stocks-object"
import { ClockWindow } from "./widgets/clock"
import { ClockWidget } from "./widgets/clock-object"
import { WeatherWindow } from "./widgets/weather"
import { WeatherWidget } from "./widgets/weather-object"
import { CalendarWindow } from "./widgets/calendar"
import { CalendarWidget } from "./widgets/calendar-object"
import { MusicWindow } from "./widgets/music"
import { MusicWidget } from "./widgets/music-object"

/** Which component draws each app's window. */
const APP_WINDOWS: Record<AppId, React.ComponentType<{ win: WindowState }>> = {
  finder: FinderWindow,
  "photo-booth": PhotoBoothWindow,
  stocks: StocksWindow,
  clock: ClockWindow,
  weather: WeatherWindow,
  calendar: CalendarWindow,
  music: MusicWindow,
  notes: NotesWindow,
  settings: SettingsWindow,
}

function Scene() {
  const { windows, tone, focusedId, focus } = useWindowManager()

  return (
    <div
      className="relative h-svh w-full overflow-hidden ink"
      onPointerDown={(e) => {
        // a press on the bare desk takes focus off every window
        if (e.target === e.currentTarget && focusedId) focus("")
      }}
    >
      <GlassObjectStyles />
      <Wallpaper tone={tone} />
      <MenuBar />

      {/* the desk: folders on the left, widgets stacked on the right */}
      <div className="absolute inset-x-0 top-7 bottom-24 overflow-y-auto overflow-x-hidden no-scrollbar">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-10 px-6 pt-20 pb-10 xl:flex-row xl:items-start xl:gap-12">
          <section aria-label="Folders" className="min-w-0 flex-1">
            <FoldersShelf
              width={272}
              className="grid grid-cols-1 justify-items-center gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3"
            />
            <p className="mt-6 text-center font-mono text-[11px] tracking-[0.18em] uppercase ink-soft">
              Hover to lean · Click to open · Pick a file to open Finder
            </p>
          </section>
          <aside aria-label="Widgets" className="flex shrink-0 flex-wrap justify-center gap-4 xl:w-[364px] xl:flex-col xl:items-end">
            <div className="flex gap-4">
              <ClockWidget size="small" />
              <WeatherWidget size="small" />
            </div>
            <StocksWidget size="medium" />
            <div className="flex gap-4">
              <CalendarWidget size="small" />
              <MusicWidget size="small" />
            </div>
          </aside>
        </div>
      </div>

      {/* windows */}
      {windows.map((w) => {
        const Comp = APP_WINDOWS[w.app]
        return <Comp key={w.id} win={w} />
      })}

      <Dock />
    </div>
  )
}

export function Desktop({ wallpaper = "aurora" as ArtPreset, tone = "light" as const }) {
  return (
    <WindowManager defaultWallpaper={wallpaper} defaultTone={tone}>
      <Scene />
    </WindowManager>
  )
}
