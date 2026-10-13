"use client"

import * as React from "react"
import { Moon, Settings2, Sun } from "lucide-react"
import { cn } from "@/lib/utils"
import { GlassWindow, type WindowState } from "../window-manager"
import { useWindowManager } from "../window-manager"

/** System Settings: Appearance, the one thing this desk has to set. */
export default function SettingsWindow({ win }: { win: WindowState }) {
  const { tone, setTone } = useWindowManager()
  return (
    <GlassWindow win={win} icon={<Settings2 />} minW={480} minH={320}>
      <div className="h-full overflow-y-auto p-6" data-no-drag>
        <section>
          <h2 className="text-[13px] font-semibold tracking-wide uppercase ink-soft">Appearance</h2>
          <p className="mt-1 text-[12.5px] ink-soft">Milk glass on white paper, or smoked glass on charcoal. Every surface follows.</p>
          <div className="mt-3 flex gap-3">
            {(["light", "dark"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTone(t)}
                aria-pressed={tone === t}
                className={cn(
                  "flex flex-1 items-center gap-3 rounded-xl p-3 text-left transition-shadow",
                  "shadow-[0_0_0_.5px_var(--glass-edge)] hover:bg-[var(--glass-hover)]",
                  tone === t && "shadow-[0_0_0_2px_var(--glass-accent)]",
                )}
              >
                <span
                  className={cn(
                    "grid size-10 place-items-center rounded-lg",
                    t === "light" ? "bg-[linear-gradient(180deg,#fff,#e4e4e8)] text-black" : "bg-[linear-gradient(180deg,#3a3a40,#121214)] text-white",
                  )}
                >
                  {t === "light" ? <Sun className="size-5" /> : <Moon className="size-5" />}
                </span>
                <span>
                  <span className="block text-[13.5px] font-medium ink capitalize">{t}</span>
                  <span className="block text-[12px] ink-soft">{t === "light" ? "Milk glass" : "Smoked glass"}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-7">
          <h2 className="text-[13px] font-semibold tracking-wide uppercase ink-soft">How the glass works</h2>
          <ul className="mt-2 space-y-1.5 text-[12.5px] ink">
            <li>Hover an object to tilt it toward you. The light inside follows the cursor.</li>
            <li>Click a widget to open its second face. Escape, or a press on the desk, closes it.</li>
            <li>Double-click a widget to open its app. The dock does the same with one click.</li>
          </ul>
        </section>
      </div>
    </GlassWindow>
  )
}
