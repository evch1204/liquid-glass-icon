import type { FolderArt, FolderFile } from "@/components/ui/glass-folder-cards"

/**
 * The folders on the desk. The same records feed the glass folder cards and
 * the Finder window, so what you see fanned out of a folder is what Finder
 * lists when you open it.
 */
export type DesktopFolder = {
  id: string
  label: string
  /** Second line on the folder. Defaults to the item count. */
  meta?: string
  tone: "light" | "dark"
  art: FolderArt
  seed?: number
  action: "add" | "more" | "none"
  labelPlacement: "bottom-left" | "top-left" | "top-right"
  files: FolderFile[]
  /** Where Finder thinks this lives. */
  path: string[]
}

export const DESKTOP_FOLDERS: DesktopFolder[] = [
  {
    id: "my-files",
    label: "My Files",
    tone: "light",
    art: "aurora",
    seed: 3,
    action: "add",
    labelPlacement: "bottom-left",
    path: ["Macintosh HD", "Users", "evan", "My Files"],
    files: [
      { name: "Cover — final", meta: "PNG · 4.8 MB", art: "ember" },
      { name: "Moodboard", meta: "24 images", art: "dusk" },
      { name: "Brief.pdf", meta: "PDF · 1.2 MB" },
    ],
  },
  {
    id: "archives",
    label: "Archives",
    tone: "light",
    art: "none",
    action: "more",
    labelPlacement: "top-left",
    path: ["Macintosh HD", "Users", "evan", "Archives"],
    files: [
      { name: "Lookbook 2024", meta: "38 images", art: "dusk" },
      { name: "Invoices", meta: "12 PDFs" },
      { name: "Shoot — Lisbon", meta: "RAW · 2.1 GB", art: "ember" },
      { name: "Contract.pdf", meta: "PDF · 320 KB" },
    ],
  },
  {
    id: "stills",
    label: "Stills",
    meta: "Wed 19 Aug",
    tone: "dark",
    art: "ember",
    seed: 11,
    action: "none",
    labelPlacement: "top-right",
    path: ["Macintosh HD", "Users", "evan", "Stills"],
    files: [
      { name: "Stills", meta: "64 images", art: "verdant" },
      { name: "Edit notes", meta: "TXT · 4 KB" },
      { name: "Grade v3", meta: "DRX · 18 MB", art: "aurora" },
    ],
  },
  {
    id: "glacier",
    label: "Winter",
    tone: "light",
    art: "glacier",
    seed: 7,
    action: "more",
    labelPlacement: "bottom-left",
    path: ["Macintosh HD", "Users", "evan", "Winter"],
    files: [
      { name: "Snowfield", meta: "TIFF · 62 MB", art: "glacier" },
      { name: "Fjord", meta: "TIFF · 58 MB", art: "glacier" },
      { name: "Light study", meta: "TXT · 2 KB" },
    ],
  },
  {
    id: "verdant",
    label: "Garden",
    tone: "dark",
    art: "verdant",
    seed: 5,
    action: "add",
    labelPlacement: "top-left",
    path: ["Macintosh HD", "Users", "evan", "Garden"],
    files: [
      { name: "Moss", meta: "JPG · 3.1 MB", art: "verdant" },
      { name: "Brass study", meta: "JPG · 2.4 MB", art: "verdant" },
      { name: "Planting plan", meta: "PDF · 820 KB" },
      { name: "Soil notes", meta: "TXT · 1 KB" },
    ],
  },
]

export const folderById = (id: string) => DESKTOP_FOLDERS.find((f) => f.id === id)

/** A rough kind for a file, from its name and meta, for icons and the Finder "Kind" column. */
export function fileKind(file: FolderFile): "image" | "pdf" | "text" | "folder" | "raw" | "video" | "other" {
  const m = (file.meta ?? "").toLowerCase()
  const n = file.name.toLowerCase()
  if (file.art || file.image || m.includes("png") || m.includes("jpg") || m.includes("tiff") || m.includes("images")) return "image"
  if (m.includes("raw") || m.includes("drx")) return "raw"
  if (m.includes("pdf") || n.endsWith(".pdf")) return "pdf"
  if (m.includes("txt") || n.endsWith(".txt") || n.includes("notes")) return "text"
  if (m.includes("mov") || m.includes("mp4")) return "video"
  return "other"
}
