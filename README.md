# Glass Desk

A desktop made of glass. One page: a painted wallpaper under a dotted canvas,
the glass folder cards sitting on it, and a working macOS-style shell on top of
them — Finder, Photo Booth, Stocks, Clock, Weather, Calendar, Music, Notes and
System Settings, a dock and a menu bar — all drawn with the same frosted-glass
recipe.

```
pnpm install
pnpm dev
```

## How it is put together

| Layer | Where | What it does |
| --- | --- | --- |
| Glass tokens | `app/globals.css` | `--glass-*` variables plus `.glass`, `.glass-strong`, `.glass-thin`, `.glass-sheen`, `.ink`, `.ink-soft`, `.dot-canvas`. The desk toggles `.dark` on `<html>`, so one switch re-tints every surface. |
| Folder | `components/ui/glass-folder-cards.tsx` | The original component, unchanged. Also the source of the art generator (`createArtJob`, `ART_PRESETS`, `rng`, `hashString`) that everything else borrows. |
| Desk | `components/desktop/wallpaper.tsx` | Smooth white paper with a dotted grid, charcoal in dark tone. |
| Glass objects | `components/ui/glass-object.tsx` | The engine behind every widget, dock tile and menu chip: `GlassObject` (springs on requestAnimationFrame written as CSS variables, hover / open / activate protocol), `GlassPane` (the frosted pane with rim and specular), `LiquidCanvas` (a liquid light repainted every frame, with a ripple under the pointer), `GlassSheet`, `useSpringVar`. No CSS transitions anywhere in the motion. |
| Window manager | `components/desktop/window-manager.tsx` | Open / close / focus / minimise / zoom, z-order, drag and resize. `GlassWindow` is the frame every app renders inside; `TrafficLights` is the three dots. |
| Shell | `components/desktop/desktop.tsx`, `menu-bar.tsx`, `dock.tsx`, `folders-shelf.tsx` | The scene. Folders on the left, widgets on the right, windows above, dock below. |
| Apps | `components/desktop/apps/*` | Finder (opens a folder, with the same files the card fans out), Photo Booth (webcam, effects, film strip), Notes (the design notes), System Settings (tone and wallpaper). |
| Widgets | `components/desktop/widgets/*-object.tsx` | Clock, Stocks, Weather, Calendar, Music as glass objects: liquid at the back, real elements in the middle, a hinged pane in front. Hover tilts, click opens a second face, double-click opens the app. The matching `Window` components live in the files without the suffix. |
| Data | `lib/desktop-data.ts`, `lib/apps.ts` | The folders and their files; the app registry the dock and menu bar read. |

Nothing is downloaded: the folder art, the file thumbnails, album covers and
the wallpaper are all one noise field shaded as a liquid surface and painted
into canvases over a few animation frames.

## Using it

- Hover a folder to lean its glass; click to open it and fan its files.
- Pick a file, or choose "Open in Finder" from a folder's `···` menu, to open that folder in Finder with the file selected.
- The dock launches apps. A dot marks the ones with a window open; clicking again minimises.
- The moon / sun in the menu bar flips the desk between milk and smoked glass. The Apple menu opens System Settings, where the wallpaper preset lives.

## Stack

Next.js (app router), React 19, TypeScript, Tailwind v4, shadcn (`components/ui`), lucide-react.
