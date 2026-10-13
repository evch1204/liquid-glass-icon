"use client"

import * as React from "react"
import { NotebookPen } from "lucide-react"
import { GlassWindow, type WindowState } from "../window-manager"
import { cn } from "@/lib/utils"

/**
 * Notes: the design notes for this desk, as a note. Each note explains one
 * part of the glass system, so the showcase documents itself.
 */
const NOTES: { title: string; date: string; body: string[] }[] = [
  {
    title: "What the glass is made of",
    date: "Today",
    body: [
      "Every surface here is the same recipe: a translucent fill, a backdrop blur with a little extra saturation, a one-pixel white rim along the top edge, a half-pixel dark edge around the outside, and a soft, low shadow. Light tone is milk glass; dark tone is smoked glass.",
      "The tokens live in globals.css as --glass-* variables and the .glass class. Windows, widgets, the dock, the menu bar and the folder's own front panel all read them, so one change moves everything.",
    ],
  },
  {
    title: "The folder is an object, not a picture",
    date: "Yesterday",
    body: [
      "A folder is three layers: a back panel holding generated artwork, the real file elements sitting in the pocket, and a frosted front panel hinged at its bottom edge. Because the files are real DOM, the glass frosts them as they move.",
      "Hover leans the front panel toward you. Click opens it: the panel falls further and the files rise and fan. Choosing a file opens the same folder in Finder, with that file selected.",
    ],
  },
  {
    title: "Widgets are objects too",
    date: "Monday",
    body: [
      "Every widget, dock tile and menu chip is built on the same engine as the folder: a liquid light painted in a canvas at the back, real elements in the middle, a frosted pane in front. Nothing animates with CSS transitions. Each motion value is a spring integrated on requestAnimationFrame and written to the object as a CSS variable.",
      "Hover tilts an object toward you. A click opens its second face: the pane folds away and something rises out of the pocket. A double-click hands off to the app.",
    ],
  },
  {
    title: "The artwork is painted, not fetched",
    date: "Monday",
    body: [
      "No images are loaded. The folder art, the file thumbnails and the album covers are one generator: a domain-warped noise field shaded as a liquid surface, painted into a canvas over a few animation frames. The liquid under the widgets is a lighter cousin, repainted every frame.",
    ],
  },
  {
    title: "Windows",
    date: "Sunday",
    body: [
      "Drag by the title bar, resize from the bottom-right corner, click to bring forward. The yellow light minimises into the dock; the green one zooms. Escape closes an open folder.",
      "Each app is a small, self-contained component that renders inside the shared GlassWindow frame.",
    ],
  },
]

export default function NotesWindow({ win }: { win: WindowState }) {
  const [at, setAt] = React.useState(0)
  const note = NOTES[at]
  return (
    <GlassWindow win={win} titleBar icon={<NotebookPen />} minW={520} minH={360}>
      <div className="flex h-full">
        <aside className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--glass-ink-faint)] p-2" data-no-drag>
          <p className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-wide uppercase ink-soft">Notes</p>
          {NOTES.map((n, i) => (
            <button
              key={n.title}
              type="button"
              onClick={() => setAt(i)}
              className={cn(
                "rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--glass-hover)]",
                i === at && "bg-[#ffd60a]/35 hover:bg-[#ffd60a]/45",
              )}
            >
              <span className="block truncate text-[13px] font-semibold ink">{n.title}</span>
              <span className="block truncate text-[11.5px] ink-soft">
                {n.date} · {n.body[0].slice(0, 32)}…
              </span>
            </button>
          ))}
        </aside>
        <article className="min-w-0 flex-1 overflow-y-auto bg-white/25 px-8 py-6 dark:bg-black/15" data-no-drag>
          <p className="text-center font-mono text-[11px] ink-soft">{note.date}</p>
          <h2 className="mt-3 text-[22px] font-semibold tracking-tight ink">{note.title}</h2>
          {note.body.map((p, i) => (
            <p key={i} className="mt-3 text-[14px] leading-relaxed ink">
              {p}
            </p>
          ))}
        </article>
      </div>
    </GlassWindow>
  )
}
