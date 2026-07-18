'use client'

import { useRef, useMemo, useLayoutEffect, useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react'
import type { HospitalFormDoc, HospitalFormData } from '@/types'
import {
  layoutRows, applyRowEdit, applyEnter, applyBackspaceAtStart, paraOffsetToRowCol,
  type Layout, type WrapConfig,
} from './reflow'

const MM_PER_PX = 96 / 25.4          // 1mm in CSS px at 96dpi
const PT_PER_PX = 96 / 72            // 1pt in CSS px

export interface HospitalFormEditorHandle {
  downloadPdf: () => Promise<void>
}

interface Props {
  form: HospitalFormDoc
  value: HospitalFormData
  onChange: (next: HospitalFormData) => void
  signatureUrl?: string | null
  signatureScale?: number
  onToast?: (msg: string) => void
}

function autoSlashDob(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  let fmt = digits.slice(0, 2)
  if (digits.length > 2) fmt += '/' + digits.slice(2, 4)
  if (digits.length > 4) fmt += '/' + digits.slice(4, 8)
  return fmt
}

const HospitalFormEditor = forwardRef<HospitalFormEditorHandle, Props>(function HospitalFormEditor(
  { form, value, onChange, signatureUrl, signatureScale, onToast }, ref,
) {
  const geo = form.geometry
  const rowsPerPage = geo.rowsPerPage
  const pageCount = Math.max(1, form.pageBackgrounds.length)
  const totalRows = rowsPerPage * pageCount

  const rootRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const noteRefs = useRef<(HTMLInputElement | null)[]>([])
  const pendingCaret = useRef<{ row: number; col: number } | null>(null)
  const layoutRef = useRef<Layout | null>(null)

  // Usable px width of a notes cell — deterministic from geometry (td padding is
  // 1.5mm each side, input fills the content box), refined by a real measurement
  // once mounted so canvas-measured wrapping matches the rendered font exactly.
  const geomWidth = (geo.notesColMm - 3) * MM_PER_PX
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null)
  const maxWidth = Math.max(20, (measuredWidth ?? geomWidth) - 2)

  const cfg = useMemo<WrapConfig>(() => {
    const fontPx = geo.fontPt * PT_PER_PX
    let ctx: CanvasRenderingContext2D | null = null
    if (typeof document !== 'undefined') {
      ctx = document.createElement('canvas').getContext('2d')
      if (ctx) ctx.font = `${fontPx}px Arial, sans-serif`
    }
    return {
      maxWidth,
      measure: (s) => (ctx ? ctx.measureText(s).width : s.length * fontPx * 0.5),
    }
  }, [geo.fontPt, maxWidth])

  const layout = useMemo(() => layoutRows(value.paragraphs, totalRows, cfg), [value.paragraphs, totalRows, cfg])
  layoutRef.current = layout

  // Measure the real notes-cell width once mounted (and on resize).
  useEffect(() => {
    const el = noteRefs.current.find(Boolean)
    if (!el) return
    const measure = () => { const w = el.clientWidth; if (w > 0) setMeasuredWidth(w) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  // Fit the A4 pages to the container width (transforms don't change layout width,
  // so reflow measurement stays correct at any scale).
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const pageWpx = 210 * MM_PER_PX
    const fit = () => {
      const avail = root.clientWidth
      setScale(avail > 0 ? Math.min(1, avail / pageWpx) : 1)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(root)
    return () => ro.disconnect()
  }, [])

  // Apply a pending caret target after a reflow re-render.
  useLayoutEffect(() => {
    const pc = pendingCaret.current
    if (!pc) return
    pendingCaret.current = null
    const el = noteRefs.current[pc.row]
    if (el) { el.focus(); el.setSelectionRange(pc.col, pc.col) }
  })

  const commit = useCallback((paragraphs: string[], caretPara: number, caretOffset: number) => {
    onChange({ ...value, paragraphs })
    // Layout for the NEW paragraphs to map the caret; ref updates next render but
    // we compute here so focus lands on the right row.
    const next = layoutRows(paragraphs, totalRows, cfg)
    pendingCaret.current = paraOffsetToRowCol(next, caretPara, caretOffset)
    if (next.overflow) onToast?.('The note is longer than the form — the overflow is not shown.')
  }, [value, onChange, totalRows, cfg, onToast])

  function onNoteInput(row: number, e: React.ChangeEvent<HTMLInputElement>) {
    const el = e.target
    const r = applyRowEdit(value.paragraphs, layout, row, el.value, el.selectionStart ?? el.value.length)
    commit(r.paragraphs, r.caretPara, r.caretOffset)
  }

  function onNoteKeyDown(row: number, e: React.KeyboardEvent<HTMLInputElement>) {
    const el = e.currentTarget
    if (e.key === 'Enter') {
      e.preventDefault()
      const r = applyEnter(value.paragraphs, layout, row, el.selectionStart ?? el.value.length)
      commit(r.paragraphs, r.caretPara, r.caretOffset)
    } else if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
      const r = applyBackspaceAtStart(value.paragraphs, layout, row)
      if (r) { e.preventDefault(); commit(r.paragraphs, r.caretPara, r.caretOffset) }
    } else if (e.key === 'ArrowUp' && row > 0) {
      e.preventDefault(); const p = noteRefs.current[row - 1]; if (p) { p.focus(); const c = Math.min(el.selectionStart ?? 0, p.value.length); p.setSelectionRange(c, c) }
    } else if (e.key === 'ArrowDown' && row < totalRows - 1) {
      e.preventDefault(); const p = noteRefs.current[row + 1]; if (p) { p.focus(); const c = Math.min(el.selectionStart ?? 0, p.value.length); p.setSelectionRange(c, c) }
    }
  }

  const setPid = (k: keyof HospitalFormData['pid'], v: string) => onChange({ ...value, pid: { ...value.pid, [k]: v } })
  const setDate = (v: string) => onChange({ ...value, dateTime: { ...value.dateTime, date: v } })
  const setTime = (v: string) => onChange({ ...value, dateTime: { ...value.dateTime, time: v } })

  // ── PDF export (direct canvas — draw the background then every input's text at
  //    its own bounding box; both sides always emitted) ──────────────────────
  function loadImg(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })
  }
  const proxied = (url: string) => '/api/proxy-image?url=' + encodeURIComponent(url)

  const downloadPdf = useCallback(async () => {
    const { jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const SCALE = 3
    const fontPx = geo.fontPt * PT_PER_PX * SCALE

    // Which row the signature sits after (row past the last written note row).
    let lastFilled = -1
    const L = layoutRef.current
    if (L) for (let r = 0; r < totalRows; r++) if (L.rowPara[r] !== -1 && L.rows[r].trim()) lastFilled = r
    const sigRow = lastFilled >= 0 ? Math.min(lastFilled + 1, totalRows - 1) : -1
    let sigImg: HTMLImageElement | null = null
    if (signatureUrl && sigRow >= 0) { try { sigImg = await loadImg(proxied(signatureUrl)) } catch { sigImg = null } }

    for (let p = 0; p < pageCount; p++) {
      const page = pageRefs.current[p]
      if (!page) continue
      if (p > 0) pdf.addPage()

      const W = page.offsetWidth * SCALE
      const H = page.offsetHeight * SCALE
      const canvas = document.createElement('canvas')
      canvas.width = W; canvas.height = H
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)

      const bgUrl = form.pageBackgrounds[p]
      if (bgUrl) { try { const bg = await loadImg(proxied(bgUrl)); ctx.drawImage(bg, 0, 0, W, H) } catch { /* keep white */ } }

      // Neutralise the CSS scale transform so getBoundingClientRect returns
      // unscaled layout coordinates (matching offsetWidth used for W/H).
      const savedTransform = page.style.transform
      page.style.transform = 'none'
      const pageRect = page.getBoundingClientRect()

      ctx.textBaseline = 'middle'
      ctx.font = `${fontPx}px Arial, sans-serif`
      page.querySelectorAll<HTMLInputElement>('input').forEach(inp => {
        const r = inp.getBoundingClientRect()
        const x = (r.left - pageRect.left) * SCALE
        const y = (r.top - pageRect.top) * SCALE
        const w = r.width * SCALE
        const h = r.height * SCALE
        if (inp.dataset.hfWhite === '1') { ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, w, h) }
        if (!inp.value) return
        ctx.fillStyle = '#000000'
        if (inp.dataset.hfCenter === '1') { ctx.textAlign = 'center'; ctx.fillText(inp.value, x + w / 2, y + h / 2) }
        else { ctx.textAlign = 'left'; ctx.fillText(inp.value, x, y + h / 2) }
      })

      // Signature — right-aligned in the notes column on the row after the entry.
      if (sigImg && sigRow >= 0 && Math.floor(sigRow / rowsPerPage) === p) {
        const rowInPage = sigRow % rowsPerPage
        const rowTopMm = geo.tableTopMm + geo.rowHeightMm * (1 + rowInPage) // +1 header row
        const notesRightMm = geo.tableLeftMm + geo.dateColMm + geo.notesColMm
        const targetHmm = geo.rowHeightMm * 0.9 * ((signatureScale && signatureScale > 0 ? signatureScale : 100) / 100)
        const ratio = sigImg.naturalWidth / sigImg.naturalHeight || 3
        const hmm = targetHmm, wmm = targetHmm * ratio
        const xmm = notesRightMm - wmm - 1
        ctx.drawImage(sigImg, xmm * MM_PER_PX * SCALE, rowTopMm * MM_PER_PX * SCALE, wmm * MM_PER_PX * SCALE, hmm * MM_PER_PX * SCALE)
      }

      page.style.transform = savedTransform
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', 0, 0, 210, 297)
    }

    const name = [value.pid.surname, value.pid.givenNames].filter(Boolean).join('_') || 'progress-notes'
    pdf.save(`${name}.pdf`)
  }, [form, geo, pageCount, rowsPerPage, totalRows, signatureUrl, signatureScale, value.pid])

  useImperativeHandle(ref, () => ({ downloadPdf }), [downloadPdf])

  // Per-form CSS variables (mm units, exactly like the cloned original :root).
  const pageVars = {
    ['--hf-table-top' as string]: `${geo.tableTopMm}mm`,
    ['--hf-table-left' as string]: `${geo.tableLeftMm}mm`,
    ['--hf-date-col' as string]: `${geo.dateColMm}mm`,
    ['--hf-notes-col' as string]: `${geo.notesColMm}mm`,
    ['--hf-row-h' as string]: `${geo.rowHeightMm}mm`,
    ['--hf-font' as string]: `${geo.fontPt}pt`,
    ['--hf-pid-top' as string]: `${geo.pid.topMm}mm`,
    ['--hf-pid-left' as string]: `${geo.pid.leftMm}mm`,
    ['--hf-pid-width' as string]: `${geo.pid.widthMm}mm`,
    ['--hf-pid-row-h' as string]: `${geo.pid.rowHeightMm}mm`,
    ['--hf-pid-gap' as string]: `${geo.pid.dobSexGapMm}mm`,
    ['--hf-pid-sex-w' as string]: `${geo.pid.sexWidthMm}mm`,
  } as React.CSSProperties

  function renderPid() {
    return (
      <div className="hf-pid">
        <div className="hf-pid-row"><input data-hf-white="1" value={value.pid.urNo} onChange={e => setPid('urNo', e.target.value)} aria-label="UR No" /></div>
        <div className="hf-pid-row"><input data-hf-white="1" value={value.pid.surname} onChange={e => setPid('surname', e.target.value)} aria-label="Surname" /></div>
        <div className="hf-pid-row"><input data-hf-white="1" value={value.pid.givenNames} onChange={e => setPid('givenNames', e.target.value)} aria-label="Given Names" /></div>
        <div className="hf-pid-dobsex">
          <div className="hf-pid-dob">
            <input data-hf-white="1" inputMode="numeric" placeholder="DD/MM/YYYY" value={value.pid.dob}
              onChange={e => setPid('dob', autoSlashDob(e.target.value))} aria-label="Date of Birth" />
          </div>
          <div className="hf-pid-sex">
            <input data-hf-white="1" list="hf-sex-options" value={value.pid.sex}
              onChange={e => setPid('sex', e.target.value)}
              onKeyDown={e => { if (e.key.toLowerCase() === 'm') { e.preventDefault(); setPid('sex', 'Male') } else if (e.key.toLowerCase() === 'f') { e.preventDefault(); setPid('sex', 'Female') } }}
              aria-label="Sex" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="hf-root">
      <style>{HF_CSS}</style>
      <div className="hf-pages" style={{ ['--hf-scale' as string]: String(scale) } as React.CSSProperties}>
        {form.pageBackgrounds.map((bg, p) => (
          <div
            key={p}
            ref={el => { pageRefs.current[p] = el }}
            className="hf-page"
            style={{ ...pageVars, backgroundImage: bg ? `url(${bg})` : undefined }}
          >
            {renderPid()}
            <table className="hf-table">
              <colgroup><col className="hf-col-date" /><col className="hf-col-notes" /></colgroup>
              <thead>
                <tr><th>{form.labels.dateCol}</th><th>{form.labels.notesCol}</th></tr>
              </thead>
              <tbody>
                {Array.from({ length: rowsPerPage }, (_, i) => {
                  const globalRow = p * rowsPerPage + i
                  const isDateCell = globalRow === 0
                  const isTimeCell = globalRow === 1
                  return (
                    <tr key={i}>
                      <td>
                        {isDateCell ? (
                          <input data-hf-center="1" value={value.dateTime.date} onChange={e => setDate(e.target.value)} aria-label="Date" />
                        ) : isTimeCell ? (
                          <input data-hf-center="1" value={value.dateTime.time} onChange={e => setTime(e.target.value)} aria-label="Time" />
                        ) : (
                          <span className="hf-date-empty" />
                        )}
                      </td>
                      <td>
                        <input
                          ref={el => { noteRefs.current[globalRow] = el }}
                          className="hf-note"
                          value={layout.rows[globalRow] ?? ''}
                          onChange={e => onNoteInput(globalRow, e)}
                          onKeyDown={e => onNoteKeyDown(globalRow, e)}
                          aria-label={`Notes line ${globalRow + 1}`}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <datalist id="hf-sex-options"><option value="Male" /><option value="Female" /></datalist>
    </div>
  )
})

export default HospitalFormEditor

// Cloned faithfully from the standalone AWH form, namespaced under .hf-root.
const HF_CSS = `
.hf-root { --hf-scale: 1; display: flex; flex-direction: column; align-items: center; }
.hf-pages { display: flex; flex-direction: column; align-items: center; gap: 8mm; }
.hf-page {
  position: relative; width: 210mm; height: 297mm; background: #fff;
  background-size: 100% 100%; background-position: top left; background-repeat: no-repeat;
  box-shadow: 0 4px 16px rgba(0,0,0,.35);
  transform: scale(var(--hf-scale)); transform-origin: top center;
  margin-bottom: calc((var(--hf-scale) - 1) * 297mm);
}
.hf-table {
  position: absolute; top: var(--hf-table-top); left: var(--hf-table-left);
  width: calc(var(--hf-date-col) + var(--hf-notes-col));
  border-collapse: collapse; table-layout: fixed;
}
.hf-table th, .hf-table td {
  height: var(--hf-row-h); border: 1px solid transparent; padding: 0 1.5mm;
  vertical-align: middle; overflow: hidden; background: transparent;
}
.hf-col-date { width: var(--hf-date-col); }
.hf-col-notes { width: var(--hf-notes-col); }
.hf-table thead th { font: 700 6.5pt Arial, sans-serif; text-align: center; background: transparent; color: transparent; }
.hf-table tbody td input {
  width: 100%; height: 100%; border: none; background: transparent;
  font: var(--hf-font) Arial, sans-serif; padding: 0; outline: none; box-sizing: border-box; color: #000;
}
.hf-table tbody td:first-child input { text-align: center; }
.hf-date-empty { display: block; width: 100%; height: 100%; }
.hf-pid { position: absolute; top: var(--hf-pid-top); left: var(--hf-pid-left); width: var(--hf-pid-width); font: var(--hf-font) Arial, sans-serif; }
.hf-pid-row { display: flex; align-items: baseline; height: var(--hf-pid-row-h); gap: 1mm; }
.hf-pid-row input, .hf-pid-dobsex input {
  flex: 1; border: none; background: #fff; font: var(--hf-font) Arial, sans-serif;
  padding: 0 1mm 0 0; outline: none; min-width: 0; -webkit-appearance: none; appearance: none; color: #000;
}
.hf-pid-dobsex { display: flex; align-items: baseline; height: var(--hf-pid-row-h); gap: var(--hf-pid-gap); }
.hf-pid-dob { display: flex; align-items: baseline; gap: 1mm; flex: 2; max-width: 35mm; }
.hf-pid-sex { display: flex; align-items: baseline; gap: 1mm; flex: 0 0 var(--hf-pid-sex-w); min-width: 0; overflow: hidden; }
@media (prefers-reduced-motion: reduce) { .hf-page { transition: none; } }
`
