// Holiday tiles uploaded from the admin console, rather than committed to the
// repo. The build script in scripts/ still works and is the better route for a
// one-off, but it needs a terminal and a checkout — this path needs neither, so
// artwork can be swapped from a phone.

import { db } from '@/lib/firebase'
import { doc, getDoc } from 'firebase/firestore'
import type { HolidayKey } from '@/lib/holidayTheme'

export type HolidayTileMap = Partial<Record<HolidayKey, string>>
export type HolidayScrimMap = Partial<Record<HolidayKey, number>>

export interface HolidayAppearance {
  tiles: HolidayTileMap
  scrims: HolidayScrimMap
}

export async function getHolidayAppearance(): Promise<HolidayAppearance> {
  try {
    const snap = await getDoc(doc(db, 'appearance', 'holidayTiles'))
    if (!snap.exists()) return { tiles: {}, scrims: {} }
    const d = snap.data()
    return { tiles: (d.tiles ?? {}) as HolidayTileMap, scrims: (d.scrims ?? {}) as HolidayScrimMap }
  } catch {
    return { tiles: {}, scrims: {} }
  }
}

// Same geometry as scripts/build-holiday-tiles.py, so a tile built either way is
// identical. The header is 60 CSS px tall and draws the tile at `auto 100%`, so
// the tile's whole height maps to those 60px — which is why `zoom` matters far
// more than it looks: a generated pattern usually has four or five rows of
// motifs, and all of them land inside 60px unless you crop in.
export const TILE_H = 240
export const HALF_W = 240
const BUDGET_BYTES = 30 * 1024
const QUALITIES = [0.82, 0.74, 0.66, 0.58, 0.5, 0.45]

/**
 * Crop, mirror and compress a chosen image into the tile the header wants.
 *
 * Mirroring is what makes the repeat invisible: the tile becomes
 * [slice | flipped slice], so every junction — inside the tile and between
 * copies — meets an identical column of pixels. Artwork almost never tiles on
 * its own, and a hard seam is far more noticeable than the symmetry.
 *
 * `zoom` keeps the centre 1/zoom of the source before any of that, so motifs
 * that would render at 12px can be brought up to something readable.
 */
export async function buildTileDataUrl(file: File, zoom = 1): Promise<string> {
  const bitmap = await createImageBitmap(file)

  const sw = Math.max(1, Math.round(bitmap.width / zoom))
  const sh = Math.max(1, Math.round(bitmap.height / zoom))
  const sx = (bitmap.width - sw) / 2
  const sy = (bitmap.height - sh) / 2

  // Scale so the height matches, then take the middle band — the centre of a
  // generated image is where the composition is.
  const scaledW = Math.max(HALF_W, Math.round(sw * (TILE_H / sh)))
  const srcW = sw * (HALF_W / scaledW)

  const half = document.createElement('canvas')
  half.width = HALF_W
  half.height = TILE_H
  const hc = half.getContext('2d')
  if (!hc) throw new Error('Canvas unavailable')
  hc.imageSmoothingQuality = 'high'
  hc.drawImage(bitmap, sx + (sw - srcW) / 2, sy, srcW, sh, 0, 0, HALF_W, TILE_H)

  const tile = document.createElement('canvas')
  tile.width = HALF_W * 2
  tile.height = TILE_H
  const tc = tile.getContext('2d')
  if (!tc) throw new Error('Canvas unavailable')
  // No colour grading here. Anything applied at this point is burnt into the
  // saved file and can never be undone, so keeping the artwork's own colours is
  // what lets the scrim — which IS reversible — be the only darkening.
  tc.drawImage(half, 0, 0)
  tc.translate(HALF_W * 2, 0)
  tc.scale(-1, 1)
  tc.drawImage(half, 0, 0)

  bitmap.close()

  for (const q of QUALITIES) {
    const url = tile.toDataURL('image/webp', q)
    if (url.length * 0.75 <= BUDGET_BYTES) return url
  }
  return tile.toDataURL('image/webp', QUALITIES[QUALITIES.length - 1])
}
