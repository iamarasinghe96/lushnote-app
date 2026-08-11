'use client'

import { useEffect, useRef, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { getGeminiKey } from '@/lib/utils'

export interface ScannedPatient {
  name: string
  urNumber: string
  dob: string
  gender: 'male' | 'female' | ''
}

interface ScanNoteModalProps {
  open: boolean
  uid?: string
  onClose: () => void
  onScanned: (text: string, patient: ScannedPatient) => void
}

// A phone photo is 3–12 MP; sent whole it blows past the request body limit and
// costs far more tokens than the handwriting needs. Long edge 2000px keeps ward
// handwriting legible while landing around a few hundred KB.
const MAX_EDGE = 2000
const JPEG_QUALITY = 0.85
const MAX_PHOTOS = 4

function downscale(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const { naturalWidth: w, naturalHeight: h } = img
      const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(w * scale))
      canvas.height = Math.max(1, Math.round(h * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('canvas')); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', JPEG_QUALITY)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')) }
    img.src = url
  })
}

// Photograph a ward progress note and read it with Gemini. The photo is
// downscaled here, posted, and dropped — nothing is stored on the device or the
// server; only the transcribed text comes back.
export default function ScanNoteModal({ open, uid, onClose, onScanned }: ScanNoteModalProps) {
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) return
    setFiles([])
    setError(null)
    setBusy(false)
  }, [open])

  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f))
    setPreviews(urls)
    return () => { urls.forEach(URL.revokeObjectURL) }
  }, [files])

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    setError(null)
    setFiles(prev => [...prev, ...Array.from(list)].slice(0, MAX_PHOTOS))
  }

  function removeFile(i: number) {
    setFiles(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handleScan() {
    if (!files.length || !uid) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('uid', uid)
      for (const f of files) {
        const blob = await downscale(f).catch(() => f)
        form.append('images', blob, 'note.jpg')
      }
      const headers: Record<string, string> = {}
      const geminiKey = getGeminiKey()
      if (geminiKey) headers['x-gemini-key'] = geminiKey
      const res = await fetch('/api/ocr', { method: 'POST', headers, body: form })
      const data = await res.json() as { text?: string; patient?: ScannedPatient; error?: string }
      if (!res.ok || !data.text) {
        setError(data.error || 'Could not read that photo. Please try again.')
        return
      }
      onScanned(data.text, data.patient ?? { name: '', urNumber: '', dob: '', gender: '' })
    } catch {
      setError('Could not reach the scanner. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="Scan a ward note" maxWidth="lg">
      <div className="px-5 pb-5 space-y-4">
        <p className="text-xs text-[var(--text2)]">
          Photograph the whole page, straight on and well lit. The photo is read and discarded — it is never stored.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => { addFiles(e.target.files); e.target.value = '' }}
        />

        {previews.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {previews.map((src, i) => (
              <div key={src} className="relative rounded-[var(--r)] overflow-hidden border border-[var(--border)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Page ${i + 1}`} className="w-full h-24 object-cover" />
                {!busy && (
                  <button
                    onClick={() => removeFile(i)}
                    aria-label={`Remove page ${i + 1}`}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 text-[var(--text2)]
                               flex items-center justify-center text-sm leading-none
                               motion-safe:active:scale-95 motion-safe:transition-transform"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {files.length < MAX_PHOTOS && (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="w-full py-6 rounded-[var(--r-lg)] border border-dashed border-[var(--border)]
                       text-sm text-[var(--text2)] bg-white
                       hover:border-[var(--blue)] hover:text-[var(--blue)]
                       disabled:opacity-50 disabled:pointer-events-none
                       motion-safe:active:scale-[0.99] motion-safe:transition-all"
          >
            {files.length ? 'Add another page' : 'Take a photo or choose an image'}
          </button>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy} className="flex-1">Cancel</Button>
          <Button variant="primary" onClick={handleScan} loading={busy} disabled={!files.length} className="flex-1">
            {busy ? 'Reading…' : 'Read note'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
