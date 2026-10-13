"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Small glass primitives shared by widgets, menus and app chrome.
 * Everything here reads the tokens in globals.css (`--glass-*`), so it
 * follows the desk's tone automatically.
 */

/** macOS desktop widget sizes, in px. */
export const WIDGET = {
  small: { w: 170, h: 170 },
  medium: { w: 364, h: 170 },
  large: { w: 364, h: 364 },
} as const

export type WidgetSize = keyof typeof WIDGET

export function GlassCard({
  className,
  children,
  sheen = true,
  strong = false,
  thin = false,
  style,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { sheen?: boolean; strong?: boolean; thin?: boolean }) {
  return (
    <div
      className={cn("glass overflow-hidden rounded-[22px]", sheen && "glass-sheen", strong && "glass-strong", thin && "glass-thin", className)}
      style={style}
      {...rest}
    >
      {children}
    </div>
  )
}

/** A desktop widget: a glass card at one of the three system sizes. */
export function Widget({
  size = "small",
  className,
  children,
  label,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { size?: WidgetSize; label?: string }) {
  const { w, h } = WIDGET[size]
  return (
    <GlassCard
      role="group"
      aria-label={label}
      data-widget={size}
      className={cn("shrink-0 [animation:glass-widget-in_.7s_var(--glass-spring)_both]", className)}
      style={{ width: w, height: h }}
      {...rest}
    >
      {children}
    </GlassCard>
  )
}

/** A tiny pill, for status (▲ 1.2%) or kind (PDF). */
export function Pill({ className, children, tone = "neutral" }: { className?: string; children: React.ReactNode; tone?: "neutral" | "up" | "down" | "accent" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] leading-none tracking-wide",
        tone === "neutral" && "bg-[var(--glass-ink-faint)] ink-soft",
        tone === "up" && "bg-[#34c759] text-white",
        tone === "down" && "bg-[#ff453a] text-white",
        tone === "accent" && "bg-[var(--glass-accent)] text-white",
        className,
      )}
    >
      {children}
    </span>
  )
}

/** A frosted toolbar button. */
export function GlassButton({
  className,
  active,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      data-no-drag
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium ink-soft transition-colors",
        "hover:bg-[var(--glass-hover)] hover:ink active:scale-[.97] disabled:opacity-40 disabled:pointer-events-none",
        "[&_svg]:size-4 focus-visible:outline-2 focus-visible:outline-[var(--glass-accent)] outline-offset-2",
        active && "bg-[var(--glass-ink-faint)] ink",
        className,
      )}
      {...rest}
    />
  )
}

/** A hairline divider that matches the glass. */
export function Hairline({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div aria-hidden="true" className={cn("bg-[var(--glass-ink-faint)]", vertical ? "w-px self-stretch" : "h-px w-full", className)} />
}
