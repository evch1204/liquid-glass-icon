"use client"

import * as React from "react"
import type { AppId } from "./window-manager"

/**
 * App icons redrawn after the macOS Sonoma set: a 100-unit rounded square
 * (corner radius 22.4%), a vertical gradient, one clear motif, a soft inner
 * highlight along the top and a half-pixel dark edge. Pure SVG, so they stay
 * crisp under the dock's magnification.
 */

const R = 22.4

function Tile({ id, from, to, children, edge = 0.14 }: { id: string; from: string; to: string; children: React.ReactNode; edge?: number }) {
  return (
    <svg viewBox="0 0 100 100" className="dock-icon" aria-hidden="true">
      <defs>
        <linearGradient id={"di-" + id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <linearGradient id={"di-sheen-" + id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.02" />
          <stop offset="1" stopColor="#000" stopOpacity="0.05" />
        </linearGradient>
        <clipPath id={"di-clip-" + id}>
          <rect width="100" height="100" rx={R} />
        </clipPath>
      </defs>
      <rect width="100" height="100" rx={R} fill={"url(#di-" + id + ")"} />
      <g clipPath={"url(#di-clip-" + id + ")"}>{children}</g>
      <rect width="100" height="100" rx={R} fill={"url(#di-sheen-" + id + ")"} />
      <rect x="0.5" y="0.5" width="99" height="99" rx={R - 0.5} fill="none" stroke="#000" strokeOpacity={edge} />
    </svg>
  )
}

/** Finder: the two-tone face. Light blue on the left, deeper blue on the right, split by the profile curve. */
function Finder() {
  return (
    <Tile id="finder" from="#5fc3fa" to="#2b8ff5">
      <defs>
        <linearGradient id="di-finder-r" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a84ee" />
          <stop offset="1" stopColor="#0d5fd8" />
        </linearGradient>
      </defs>
      {/* the right half, with the face's profile as its left edge */}
      <path d="M49 0H100V100H49C53 92 56 84 57 76C58 70 55 66 54 60C56 54 61 50 60 44C59 38 54 36 53 30C52 22 56 12 49 0Z" fill="url(#di-finder-r)" />
      {/* eyes */}
      <rect x="27" y="31" width="7" height="20" rx="3.5" fill="#0a2a5a" />
      <rect x="66" y="31" width="7" height="20" rx="3.5" fill="#0a2a5a" />
      {/* smile */}
      <path d="M22 61C32 78 68 78 78 61" fill="none" stroke="#0a2a5a" strokeWidth="6" strokeLinecap="round" />
      {/* the profile line */}
      <path d="M49 0C56 12 52 22 53 30C54 36 59 38 60 44C61 50 56 54 54 60C55 66 58 70 57 76C56 84 53 92 49 100" fill="none" stroke="#0a3f9a" strokeOpacity="0.35" strokeWidth="1.5" />
    </Tile>
  )
}

/** Photo Booth: a four-frame strip from a real booth, on charcoal. */
function PhotoBooth() {
  const tints = ["#f6b26b", "#79b8f0", "#8fd38f", "#f08fa6"]
  return (
    <Tile id="photo-booth" from="#4b4b52" to="#1d1d22">
      <g transform="rotate(-6 50 50)">
        <rect x="31" y="6" width="38" height="92" rx="3" fill="#f4f4f2" />
        {tints.map((t, i) => (
          <rect key={t} x="35" y={10 + i * 22} width="30" height="18" rx="1.5" fill={t} />
        ))}
        {/* a face silhouette in each frame */}
        {tints.map((t, i) => (
          <g key={"f" + i} fill="#fff" fillOpacity="0.55">
            <circle cx="50" cy={16.5 + i * 22} r="3.4" />
            <path d={`M43 ${28 + i * 22}C43 ${22 + i * 22} 57 ${22 + i * 22} 57 ${28 + i * 22}Z`} />
          </g>
        ))}
      </g>
    </Tile>
  )
}

/** Stocks: the white line climbing out of black, with its shaded fill. */
function Stocks() {
  return (
    <Tile id="stocks" from="#2c2c31" to="#09090b" edge={0.4}>
      <defs>
        <linearGradient id="di-stocks-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M14 74L30 56L44 64L62 40L74 48L88 26V96H14Z" fill="url(#di-stocks-fill)" />
      <path d="M14 74L30 56L44 64L62 40L74 48L88 26" fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
    </Tile>
  )
}

/** Clock: a white dial set to 10:09:30, the time Apple sets its clocks. */
function ClockIcon() {
  return (
    <Tile id="clock" from="#ffffff" to="#ececf0">
      <circle cx="50" cy="50" r="42" fill="#fff" stroke="#d2d2d7" strokeWidth="1.5" />
      {Array.from({ length: 60 }, (_, i) => (
        <line
          key={i}
          x1="50"
          y1="10.5"
          x2="50"
          y2={i % 5 ? 13 : 17}
          transform={`rotate(${i * 6} 50 50)`}
          stroke="#1c1c1e"
          strokeOpacity={i % 5 ? 0.35 : 1}
          strokeWidth={i % 5 ? 1 : 2.4}
          strokeLinecap="round"
        />
      ))}
      <line x1="50" y1="54" x2="35.5" y2="35.5" stroke="#1c1c1e" strokeWidth="6" strokeLinecap="round" />
      <line x1="50" y1="56" x2="66" y2="21" stroke="#1c1c1e" strokeWidth="4.5" strokeLinecap="round" />
      <line x1="50" y1="59" x2="52" y2="78" stroke="#ff9f0a" strokeWidth="2" strokeLinecap="round" />
      <circle cx="50" cy="50" r="3.6" fill="#1c1c1e" />
      <circle cx="50" cy="50" r="1.6" fill="#ff9f0a" />
    </Tile>
  )
}

/** Weather: the sun behind a cloud on a clear blue sky. */
function Weather() {
  return (
    <Tile id="weather" from="#5fc0ff" to="#1f7ff0">
      <defs>
        <radialGradient id="di-sun" cx="50%" cy="45%" r="55%">
          <stop offset="0" stopColor="#fff2b0" />
          <stop offset="0.6" stopColor="#ffd34d" />
          <stop offset="1" stopColor="#ffb52b" />
        </radialGradient>
        <linearGradient id="di-cloud" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e7eef8" />
        </linearGradient>
      </defs>
      <circle cx="41" cy="39" r="22" fill="#ffd34d" fillOpacity="0.28" />
      <circle cx="41" cy="39" r="17" fill="url(#di-sun)" />
      <path d="M34 80H78C85.5 80 91 74.5 91 67.5C91 60.5 85.5 55 78.5 55.2C77 46 69 39.5 60 40.3C52 41 46.5 46.5 45.2 53.2C38 52.4 32 57.8 32 65C32 65.8 32.1 66.6 32.3 67.4C27.8 68.6 24.5 72.7 24.5 77.5C24.5 78.4 25 80 25.5 80Z" fill="url(#di-cloud)" />
    </Tile>
  )
}

/** Calendar: the red leaf with the weekday, and today's date in thin black. */
function Calendar() {
  const wd = React.useRef<SVGTextElement>(null)
  const day = React.useRef<SVGTextElement>(null)
  React.useEffect(() => {
    const d = new Date()
    if (wd.current) wd.current.textContent = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()
    if (day.current) day.current.textContent = String(d.getDate())
  }, [])
  return (
    <Tile id="calendar" from="#ffffff" to="#f3f3f5">
      <rect width="100" height="29" fill="#ff3b30" />
      <text ref={wd} x="50" y="20.5" textAnchor="middle" fontSize="14.5" fontWeight="700" fill="#fff" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" letterSpacing="0.6">
        TUE
      </text>
      <text ref={day} x="50" y="85" textAnchor="middle" fontSize="56" fontWeight="300" fill="#1c1c1e" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" letterSpacing="-2.5">
        14
      </text>
    </Tile>
  )
}

/** Music: a white beamed pair of eighth notes on the red-to-pink gradient. */
function Music() {
  return (
    <Tile id="music" from="#fc6078" to="#fa243c">
      <path d="M41 73V27L73 19V63" fill="none" stroke="#fff" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M41 36L73 28" fill="none" stroke="#fff" strokeWidth="7.5" strokeLinecap="round" />
      <ellipse cx="32.5" cy="74" rx="10.5" ry="8" fill="#fff" />
      <ellipse cx="64.5" cy="64" rx="10.5" ry="8" fill="#fff" />
    </Tile>
  )
}

/** Notes: the yellow header above lined paper. */
function Notes() {
  return (
    <Tile id="notes" from="#fffdf4" to="#fbf5df">
      <rect width="100" height="27" fill="#ffd84d" />
      <rect y="27" width="100" height="1.6" fill="#c9a52e" fillOpacity="0.55" />
      {[44, 58, 72, 86].map((y) => (
        <line key={y} x1="14" y1={y} x2="86" y2={y} stroke="#c7c0a9" strokeWidth="2.2" strokeLinecap="round" />
      ))}
    </Tile>
  )
}

/** System Settings: a large gear on brushed grey. */
function Settings() {
  const teeth = Array.from({ length: 9 }, (_, i) => i * 40)
  return (
    <Tile id="settings" from="#a9a9b1" to="#5a5a63">
      <g fill="#eeeef1">
        {teeth.map((a) => (
          <rect key={a} x="44.5" y="12" width="11" height="17" rx="3.5" transform={`rotate(${a} 50 50)`} />
        ))}
        <circle cx="50" cy="50" r="25" />
      </g>
      <circle cx="50" cy="50" r="11" fill="#6b6b74" />
      <circle cx="50" cy="50" r="11" fill="none" stroke="#000" strokeOpacity="0.15" />
    </Tile>
  )
}

/** Trash: the wire basket at the end of the Dock. Not an app; drawn without a tile. */
export function TrashIcon({ full = false }: { full?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className="dock-icon" aria-hidden="true">
      <defs>
        <linearGradient id="di-trash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e8e8ec" />
          <stop offset="1" stopColor="#b7b7bf" />
        </linearGradient>
      </defs>
      <path d="M22 26L30 92H70L78 26Z" fill="url(#di-trash)" />
      {/* the wire mesh */}
      <g stroke="#8b8b94" strokeOpacity="0.55" strokeWidth="1.2">
        {[32, 40, 48, 56, 64, 72, 80].map((y) => (
          <line key={y} x1={22 + ((y - 26) / 66) * 8} y1={y} x2={78 - ((y - 26) / 66) * 8} y2={y} />
        ))}
        {[30, 38, 46, 54, 62, 70].map((x) => (
          <line key={x} x1={x} y1="26" x2={30 + ((x - 22) / 56) * 40} y2="92" />
        ))}
      </g>
      <rect x="18" y="20" width="64" height="8" rx="4" fill="#d9d9de" stroke="#9a9aa3" strokeWidth="1" />
      {full ? <path d="M30 20C36 12 50 10 56 14C62 10 72 14 70 20Z" fill="#f4f4f6" stroke="#a9a9b1" /> : null}
    </svg>
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
