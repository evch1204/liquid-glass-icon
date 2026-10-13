"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * The desk: smooth white paper with a dotted grid, like a cutting mat. Dark
 * tone is the same mat in charcoal. A faint pool of light sits under the
 * middle so the glass has something to catch.
 */
export function Wallpaper({ tone, className }: { tone: "light" | "dark"; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("absolute inset-0 overflow-hidden", className)}>
      <div className={cn("absolute inset-0", tone === "dark" ? "bg-[#0f0f12]" : "bg-[#f6f5f3]")} />
      <div
        className={cn(
          "absolute inset-0",
          tone === "dark"
            ? "bg-[radial-gradient(90%_70%_at_50%_40%,rgba(255,255,255,.05),transparent_70%)]"
            : "bg-[radial-gradient(90%_70%_at_50%_40%,#ffffff,transparent_70%)]",
        )}
      />
      <div className="dot-canvas absolute inset-0" />
      <div
        className={cn(
          "absolute inset-0",
          tone === "dark"
            ? "bg-[radial-gradient(120%_90%_at_50%_40%,transparent_60%,rgba(0,0,0,.35)_100%)]"
            : "bg-[radial-gradient(120%_90%_at_50%_40%,transparent_60%,rgba(20,20,22,.06)_100%)]",
        )}
      />
    </div>
  )
}
