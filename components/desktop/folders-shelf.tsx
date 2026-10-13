"use client"

import * as React from "react"
import GlassFolder, { type FolderFile } from "@/components/ui/glass-folder-cards"
import { DESKTOP_FOLDERS } from "@/lib/desktop-data"
import { APPS } from "@/lib/apps"
import { useWindowManager } from "./window-manager"

/**
 * The folders on the desk. Opening one fans its files; choosing a file, or
 * "Open in Finder" from the ··· menu, opens the folder in a Finder window
 * with that file selected.
 */
export function FoldersShelf({ width = 300, className }: { width?: number; className?: string }) {
  const { open, tone } = useWindowManager()

  const openInFinder = (folderId: string, file?: FolderFile) => {
    const folder = DESKTOP_FOLDERS.find((f) => f.id === folderId)
    if (!folder) return
    open("finder", {
      title: folder.label,
      singleton: "finder:" + folderId,
      w: APPS.finder.defaultSize.w,
      h: APPS.finder.defaultSize.h,
      payload: { folderId, selected: file?.name ?? null },
    })
  }

  return (
    <div className={className}>
      {DESKTOP_FOLDERS.map((f, i) => (
        <GlassFolder
          key={f.id}
          width={width}
          label={f.label}
          meta={f.meta}
          tone={tone === "dark" ? "dark" : f.tone}
          art={f.art}
          seed={f.seed}
          files={f.files}
          action={f.action}
          labelPlacement={f.labelPlacement}
          appearDelay={120 + i * 140}
          onFileSelect={(file) => openInFinder(f.id, file)}
          menu={[
            { label: "Open in Finder", onSelect: () => openInFinder(f.id) },
            { label: "Rename" },
            { label: "Share…" },
            { label: "Move to Trash", danger: true },
          ]}
        />
      ))}
    </div>
  )
}
