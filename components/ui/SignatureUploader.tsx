'use client'

import { useRef, useState, useCallback } from 'react'

interface Props {
  existingUrl?: string | null
  onSave: (svgDataUrl: string) => Promise<void>
  saving?: boolean
}

// Adaptive local thresholding via integral image (Bradley–Roth method).
// Each pixel is compared against the mean brightness of its surrounding
// window rather than a single global threshold. This correctly handles
// textured, grey, or uneven-illumination backgrounds where Otsu fails.
function imageToSVG(img: HTMLImageElement): string {
  // Downsample large phone photos — SVG doesn't need full resolution
  const MAX_DIM = 1400
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight))
  const width  = Math.round(img.naturalWidth  * scale)
  const height = Math.round(img.naturalHeight * scale)

  const canvas = document.createElement('canvas')
  canvas.width  = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, width, height)
  const { data } = ctx.getImageData(0, 0, width, height)

  // Greyscale
  const gray = new Float32Array(width * height)
  for (let i = 0; i < data.length; i += 4) {
    gray[i >> 2] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }

  // Integral image (summed area table) for O(1) rectangular mean queries
  const W1 = width + 1
  const integral = new Float64Array(W1 * (height + 1))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      integral[(y + 1) * W1 + (x + 1)] =
        gray[y * width + x] +
        integral[y * W1 + (x + 1)] +
        integral[(y + 1) * W1 + x] -
        integral[y * W1 + x]
    }
  }

  // Adaptive threshold: pixel is ink when it is >sensitivity darker than
  // the local mean of a radius-sized window.
  // radius = 4% of shorter edge, clamped 12-40 px
  const radius = Math.max(12, Math.min(Math.round(Math.min(width, height) * 0.04), 40))
  const sensitivity = 0.12   // must be 12% darker than local average

  const binary = new Uint8Array(width * height)
  let inkCount = 0
  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - radius)
    const y2 = Math.min(height - 1, y + radius)
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - radius)
      const x2 = Math.min(width - 1, x + radius)
      const count = (x2 - x1 + 1) * (y2 - y1 + 1)
      const sum =
        integral[(y2 + 1) * W1 + (x2 + 1)] -
        integral[y1 * W1 + (x2 + 1)] -
        integral[(y2 + 1) * W1 + x1] +
        integral[y1 * W1 + x1]
      const mean = sum / count
      if (gray[y * width + x] < mean * (1 - sensitivity)) {
        binary[y * width + x] = 1
        inkCount++
      }
    }
  }

  // Auto-invert for white-ink-on-dark images
  if (inkCount > (width * height) / 2) {
    for (let i = 0; i < binary.length; i++) {
      binary[i] = binary[i] ? 0 : 1
    }
    inkCount = width * height - inkCount
  }

  // Denoise: remove isolated speckle pixels (no ink neighbour in 4-connectivity).
  // Signature strokes are always connected; random texture noise is not.
  const denoised = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (!binary[idx]) continue
      const hasNeighbour =
        (x > 0          && binary[idx - 1]) ||
        (x < width  - 1 && binary[idx + 1]) ||
        (y > 0          && binary[idx - width]) ||
        (y < height - 1 && binary[idx + width])
      if (hasNeighbour) denoised[idx] = 1
    }
  }

  // Crop to ink bounding box with small padding
  let minX = width, minY = height, maxX = 0, maxY = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!denoised[y * width + x]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (minX > maxX || minY > maxY) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"></svg>`
  }
  const PAD = 4
  minX = Math.max(0, minX - PAD)
  minY = Math.max(0, minY - PAD)
  maxX = Math.min(width  - 1, maxX + PAD)
  maxY = Math.min(height - 1, maxY + PAD)
  const cw = maxX - minX + 1
  const ch = maxY - minY + 1

  // Build SVG with horizontal run-length rects
  const rects: string[] = []
  for (let y = minY; y <= maxY; y++) {
    let runStart = -1
    for (let x = minX; x <= maxX + 1; x++) {
      const ink = x <= maxX && denoised[y * width + x]
      if (ink && runStart < 0) {
        runStart = x
      } else if (!ink && runStart >= 0) {
        rects.push(`<rect x="${runStart - minX}" y="${y - minY}" width="${x - runStart}" height="1"/>`)
        runStart = -1
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cw} ${ch}"><g fill="#1a1a1a">${rects.join('')}</g></svg>`
}

export default function SignatureUploader({ existingUrl, onSave, saving }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [svgDataUrl, setSvgDataUrl] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    setProcessing(true)
    const reader = new FileReader()
    reader.onload = (e) => {
      const url = e.target?.result as string
      const img = new Image()
      img.onload = () => {
        try {
          const svg = imageToSVG(img)
          const encoded = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
          setSvgDataUrl(encoded)
        } finally {
          setProcessing(false)
        }
      }
      img.onerror = () => setProcessing(false)
      img.src = url
    }
    reader.readAsDataURL(file)
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  const displayUrl = svgDataUrl || existingUrl

  return (
    <div className="space-y-3">
      {/* Checkerboard preview */}
      {displayUrl && (
        <div className="rounded-[var(--r)] overflow-hidden border border-[var(--border)]"
          style={{
            background: 'repeating-conic-gradient(#e2e8f0 0% 25%, #fff 0% 50%) 0 0 / 16px 16px',
          }}>
          <img
            src={displayUrl}
            alt="Signature preview"
            className="h-20 w-full object-contain p-2"
          />
        </div>
      )}

      {/* Upload zone - shown when no extracted SVG yet */}
      {!svgDataUrl && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-[var(--r)] p-6 text-center cursor-pointer
            motion-safe:transition-colors
            ${dragOver ? 'border-[var(--blue)] bg-[var(--blue-lt)]' : 'border-[var(--border)] hover:border-[var(--blue)]/50'}`}>
          <svg className="mx-auto mb-2 text-[var(--text3)]" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <p className="text-sm font-medium text-[var(--text)]">
            {processing ? 'Processing image…' : 'Upload signature photo'}
          </p>
          <p className="text-xs text-[var(--text3)] mt-1">
            Works on any background — white, grey, or textured paper
          </p>
        </div>
      )}

      {/* Action buttons after extraction */}
      {svgDataUrl && (
        <div className="flex gap-2">
          <button
            onClick={() => { setSvgDataUrl(null) }}
            className="flex-1 text-xs border border-[var(--border)] rounded-[var(--r)] py-2 text-[var(--text2)] hover:border-[var(--blue)]/50 motion-safe:transition-colors">
            Re-upload
          </button>
          <button
            onClick={() => onSave(svgDataUrl)}
            disabled={saving}
            className="flex-1 text-xs bg-[var(--blue)] text-white rounded-[var(--r)] py-2 font-medium disabled:opacity-50 motion-safe:transition-opacity">
            {saving ? 'Saving…' : 'Save signature'}
          </button>
        </div>
      )}

      {/* Update button - shown when existing URL but no new extraction yet */}
      {!svgDataUrl && existingUrl && (
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full text-xs border border-[var(--border)] rounded-[var(--r)] py-2 text-[var(--text2)] hover:border-[var(--blue)]/50 motion-safe:transition-colors">
          Update signature
        </button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}
