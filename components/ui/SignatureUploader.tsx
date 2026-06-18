'use client'

import { useRef, useState, useCallback } from 'react'

interface Props {
  existingUrl?: string | null
  onSave: (svgDataUrl: string) => Promise<void>
  saving?: boolean
}

function otsuThreshold(pixels: Uint8ClampedArray): number {
  const hist = new Array(256).fill(0)
  const total = pixels.length / 4
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2])
    hist[gray]++
  }
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, max = 0, threshold = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > max) { max = between; threshold = t }
  }
  return threshold
}

function imageToSVG(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const threshold = otsuThreshold(data)

  const binary: boolean[] = new Array(width * height)
  let inkCount = 0
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    const ink = gray <= threshold
    binary[i / 4] = ink
    if (ink) inkCount++
  }

  // Auto-invert if ink covers majority (white-on-dark image)
  if (inkCount > (width * height) / 2) {
    for (let i = 0; i < binary.length; i++) binary[i] = !binary[i]
  }

  // Crop to content bounding box with 4px padding
  let minX = width, minY = height, maxX = 0, maxY = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (binary[y * width + x]) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const PAD = 4
  minX = Math.max(0, minX - PAD)
  minY = Math.max(0, minY - PAD)
  maxX = Math.min(width - 1, maxX + PAD)
  maxY = Math.min(height - 1, maxY + PAD)
  const cw = maxX - minX + 1
  const ch = maxY - minY + 1

  // Scanline rect extraction
  const rects: string[] = []
  for (let y = minY; y <= maxY; y++) {
    let runStart = -1
    for (let x = minX; x <= maxX + 1; x++) {
      const ink = x <= maxX && binary[y * width + x]
      if (ink && runStart < 0) {
        runStart = x
      } else if (!ink && runStart >= 0) {
        const rx = runStart - minX
        const ry = y - minY
        const rw = x - runStart
        rects.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="1"/>`)
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
            Photo of your handwritten signature on white paper
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
