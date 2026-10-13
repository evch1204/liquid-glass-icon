"use client"

import * as React from "react"
import type { AppId } from "./window-manager"

/**
 * App icons drawn the way macOS draws them: an opaque rounded square with a
 * vertical gradient, a single clear motif, and a soft inner highlight. Pure
 * SVG, so they scale with the dock's magnification without blurring.
 */

const R = 22 // corner radius on a 100-unit tile (macOS is ~22.4%)

function Tile({ id, from, to, children }: { id: string; from: string; to: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 100 100" className="dock-icon" aria-hidden="true">
      <defs>
        <linearGradient id={"di-" + id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <linearGradient id={"di-sheen-" + id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.02" />
          <stop offset="1" stopColor="#000" stopOpacity="0.06" />
        </linearGradient>
        <clipPath id={"di-clip-" + id}>
          <rect width="100" height="100" rx={R} />
        </clipPath>
      </defs>
      <rect width="100" height="100" rx={R} fill={"url(#di-" + id + ")"} />
      <g clipPath={"url(#di-clip-" + id + ")"}>{children}</g>
      <rect width="100" height="100" rx={R} fill={"url(#di-sheen-" + id + ")"} />
      <rect x="0.5" y="0.5" width="99" height="99" rx={R - 0.5} fill="none" stroke="#000" strokeOpacity="0.14" />
    </svg>
  )
}

function Finder() {
  return (
    <Tile id="finder" from="#4fb5f8" to="#1c7de6">
      {/* the darker right half of the face */}
      <path d="M50 0H100V100H50C56 84 58 66 58 50C58 34 56 16 50 0Z" fill="#1266d6" />
      <path d="M50 0C56 16 58 34 58 50C58 66 56 84 50 100" fill="none" stroke="#0b4fb0" strokeWidth="2" strokeOpacity="0.5" />
      {/* eyes */}
      <rect x="29" y="30" width="6" height="18" rx="3" fill="#0b2a5c" />
      <rect x="65" y="30" width="6" height="18" rx="3" fill="#0b2a5c" />
      {/* smile */}
      <path d="M24 62C34 76 66 76 76 62" fill="none" stroke="#0b2a5c" strokeWidth="5.5" strokeLinecap="round" />
    </Tile>
  )
}

function PhotoBooth() {
  return (
    <Tile id="photo-booth" from="#4a4a52" to="#1f1f24">
      {/* a strip of three photos, slightly curved */}
      {[0, 1, 2].map((i) => (
        <rect key={i} x={22} y={14 + i * 25} width="56" height="20" rx="3" fill="#f2f2f4" />
      ))}
      {[0, 1, 2].map((i) => (
        <rect key={i} x={26} y={17 + i * 25} width="48" height="14" rx="2" fill={["#ff8a65", "#64b5f6", "#81c784"][i]} />
      ))}
      <rect x="22" y="12" width="56" height="78" rx="4" fill="none" stroke="#000" strokeOpacity="0.25" />
    </Tile>
  )
}

function Stocks() {
  return (
    <Tile id="stocks" from="#2a2a2f" to="#0c0c0e">
      <path d="M14 70L32 52L46 62L68 36L86 44" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M72 30H88V46" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </Tile>
  )
}

function ClockIcon() {
  return (
    <Tile id="clock" from="#ffffff" to="#e9e9ee">
      <circle cx="50" cy="50" r="40" fill="#fff" stroke="#c9c9cf" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1="50" y1="13" x2="50" y2={i % 3 ? 17 : 20} transform={`rotate(${i * 30} 50 50)`} stroke="#1c1c1e" strokeWidth={i % 3 ? 2 : 3} strokeLinecap="round" />
      ))}
      {/* 10:09:36, the way Apple sets its clocks */}
      <line x1="50" y1="50" x2="35" y2="33" stroke="#1c1c1e" strokeWidth="6" strokeLinecap="round" />
      <line x1="50" y1="50" x2="68" y2="24" stroke="#1c1c1e" strokeWidth="4.5" strokeLinecap="round" />
      <line x1="50" y1="58" x2="70" y2="76" stroke="#ff9f0a" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="50" cy="50" r="3.5" fill="#ff9f0a" />
      <circle cx="50" cy="50" r="1.3" fill="#fff" />
    </Tile>
  )
}

function Weather() {
  return (
    <Tile id="weather" from="#5ec3ff" to="#1e86f0">
      <circle cx="40" cy="38" r="17" fill="#ffd60a" />
      <circle cx="40" cy="38" r="22" fill="#ffd60a" fillOpacity="0.25" />
      <path d="M30 76H74C82 76 87 70 87 64C87 57 81 52 74 53C72 44 64 38 55 39C47 40 42 46 41 52C34 51 28 56 28 63C28 70 29 76 30 76Z" fill="#fff" />
    </Tile>
  )
}

function Calendar() {
  const ref = React.useRef<SVGTextElement>(null)
  const day = React.useRef<SVGTextElement>(null)
  React.useEffect(() => {
    const d = new Date()
    if (ref.current) ref.current.textContent = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()
    if (day.current) day.current.textContent = String(d.getDate())
  }, [])
  return (
    <Tile id="calendar" from="#ffffff" to="#f0f0f3">
      <rect width="100" height="30" fill="#ff3b30" />
      <text ref={ref} x="50" y="21" textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff" fontFamily="ui-sans-serif, system-ui, sans-serif" letterSpacing="0.5">
        TUE
      </text>
      <text ref={day} x="50" y="84" textAnchor="middle" fontSize="54" fontWeight="300" fill="#1c1c1e" fontFamily="ui-sans-serif, system-ui, sans-serif" letterSpacing="-2">
        13
      </text>
    </Tile>
  )
}

function Music() {
  return (
    <Tile id="music" from="#fb5c74" to="#fa243c">
      <path d="M40 72V30L72 22V64" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="31" cy="73" rx="10" ry="7.5" fill="#fff" />
      <ellipse cx="63" cy="65" rx="10" ry="7.5" fill="#fff" />
    </Tile>
  )
}

function Notes() {
  return (
    <Tile id="notes" from="#fff8e1" to="#fdf1c9">
      <rect width="100" height="24" fill="#ffd54a" />
      <rect y="24" width="100" height="2" fill="#000" fillOpacity="0.12" />
      {[42, 56, 70, 84].map((y) => (
        <line key={y} x1="16" y1={y} x2="84" y2={y} stroke="#bfb79a" strokeWidth="2" strokeLinecap="round" />
      ))}
      {[22, 38, 54, 70, 86].map((x) => (
        <circle key={x} cx={x} cy="12" r="3" fill="#000" fillOpacity="0.2" />
      ))}
    </Tile>
  )
}

function Settings() {
  const teeth = Array.from({ length: 8 }, (_, i) => i * 45)
  return (
    <Tile id="settings" from="#a3a3ab" to="#5f5f68">
      <g fill="#e8e8ec">
        {teeth.map((a) => (
          <rect key={a} x="44" y="14" width="12" height="16" rx="3" transform={`rotate(${a} 50 50)`} />
        ))}
        <circle cx="50" cy="50" r="24" />
      </g>
      <circle cx="50" cy="50" r="10" fill="#5f5f68" />
    </Tile>
  )
}

export const DOCK_ICONS: Record<AppId, React.ComponentType> = {
  finder: Finder,
  "photo-booth": PhotoBooth,
  stocks: Stocks,
  clock: ClockIcon,
  weather: Weather,
  calendar: Calendar,
  music: Music,
  notes: Notes,
  settings: Settings,
}
