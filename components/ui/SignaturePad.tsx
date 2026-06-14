'use client'

import { useState, useRef, useEffect } from 'react'

interface SignaturePadProps {
  onSave: (dataUrl: string) => void
  existingUrl?: string | null
}

export default function SignaturePad({ onSave, existingUrl }: SignaturePadProps) {
  const [isEmpty, setIsEmpty] = useState(true)
  const [saved, setSaved] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current as HTMLCanvasElement
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    function getMousePos(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    function onMouseDown(e: MouseEvent) {
      drawingRef.current = true
      setIsEmpty(false)
      const { x, y } = getMousePos(e)
      ctx.beginPath()
      ctx.moveTo(x, y)
    }

    function onMouseMove(e: MouseEvent) {
      if (!drawingRef.current) return
      const { x, y } = getMousePos(e)
      ctx.lineTo(x, y)
      ctx.stroke()
    }

    function onMouseUp() { drawingRef.current = false }
    function onMouseLeave() { drawingRef.current = false }

    function onTouchStart(e: TouchEvent) {
      e.preventDefault()
      drawingRef.current = true
      setIsEmpty(false)
      const rect = canvas.getBoundingClientRect()
      const t = e.touches[0]
      ctx.beginPath()
      ctx.moveTo(t.clientX - rect.left, t.clientY - rect.top)
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault()
      if (!drawingRef.current) return
      const rect = canvas.getBoundingClientRect()
      const t = e.touches[0]
      ctx.lineTo(t.clientX - rect.left, t.clientY - rect.top)
      ctx.stroke()
    }

    function onTouchEnd() { drawingRef.current = false }

    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('mouseleave', onMouseLeave)
    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', onTouchMove, { passive: false })
    canvas.addEventListener('touchend', onTouchEnd)

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('mouseleave', onMouseLeave)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  function handleClear() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setIsEmpty(true)
    setSaved(false)
  }

  function handleSave() {
    const canvas = canvasRef.current
    if (!canvas) return
    onSave(canvas.toDataURL('image/png'))
    setSaved(true)
  }

  return (
    <div
      className="rounded-[var(--r-lg)] p-4"
      style={{
        background: 'rgba(255,255,255,0.75)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
      }}
    >
      {existingUrl && !saved && (
        <div className="mb-3">
          <div className="border border-[var(--border)] rounded-[var(--r)] bg-white p-2 inline-block">
            <img src={existingUrl} alt="Saved signature" className="h-12 object-contain max-w-xs" />
          </div>
          <p className="text-xs text-[var(--text3)] mt-1">Draw below to replace</p>
        </div>
      )}

      <canvas
        ref={canvasRef}
        width={400}
        height={150}
        className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white touch-none"
        style={{ maxWidth: 400, cursor: 'crosshair' }}
        aria-label="Signature pad"
      />

      <div className="flex gap-2 mt-2">
        <button
          onClick={handleClear}
          className="text-xs text-[var(--text2)] border border-[var(--border)] rounded-[var(--r)]
                     px-3 py-1.5 hover:bg-[var(--bg)]
                     motion-safe:active:scale-95 motion-safe:transition-transform"
        >
          Clear
        </button>
        <button
          onClick={handleSave}
          disabled={isEmpty}
          className="text-xs bg-[var(--blue)] text-white rounded-[var(--r)]
                     px-3 py-1.5 disabled:opacity-40
                     motion-safe:active:scale-95 motion-safe:transition-transform"
        >
          Save Signature
        </button>
      </div>
    </div>
  )
}
