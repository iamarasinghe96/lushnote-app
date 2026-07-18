'use client'

import { useRef, useMemo, useEffect, useState, forwardRef, useImperativeHandle, useCallback } from 'react'
import type { HospitalFormDoc, HospitalFormData } from '@/types'
import { layoutRows, fillFromText, type WrapConfig } from './reflow'

const MM_PER_PX = 96 / 25.4          // 1mm in CSS px at 96dpi
const PT_PER_PX = 96 / 72            // 1pt in CSS px

export interface HospitalFormEditorHandle {
  downloadPdf: () => Promise<void>
}

interface Props {
  form: HospitalFormDoc
  value: HospitalFormData
  signatureUrl?: string | null
  signatureScale?: number
}

// Read-only renderer of a filled hospital form: draws the free-text note wrapped
// onto the form's ruled lines, over the campus's page-background PNGs. Used by the
// Export tab for preview + the direct-canvas PDF (both sides always emitted). The
// doctor edits plain fields elsewhere (HospitalFormView); this only renders.
const HospitalFormEditor = forwardRef<HospitalFormEditorHandle, Props>(function HospitalFormEditor(
  { form, value, signatureUrl, signatureScale }, ref,
) {
  const geo = form.geometry
  const rowsPerPage = geo.rowsPerPage
  const pageCount = Math.max(1, form.pageBackgrounds.length)
  const totalRows = rowsPerPage * pageCount

  const rootRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const noteCellRef = useRef<HTMLInputElement | null>(null)

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
    return { maxWidth, measure: (s) => (ctx ? ctx.measureText(s).width : s.length * fontPx * 0.5) }
  }, [geo.fontPt, maxWidth])

  const layout = useMemo(() => layoutRows(fillFromText(value.noteText || ''), totalRows, cfg), [value.noteText, totalRows, cfg])
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  useEffect(() => {
    const el = noteCellRef.current
    if (!el) return
    const measure = () => { const w = el.clientWidth; if (w > 0) setMeasuredWidth(w) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  const [scale, setScale] = useState(1)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const pageWpx = 210 * MM_PER_PX
    const fit = () => { const avail = root.clientWidth; setScale(avail > 0 ? Math.min(1, avail / pageWpx) : 1) }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(root)
    return () => ro.disconnect()
  }, [])

  // ── PDF export (direct canvas — background then every input at its box) ──────
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

    const L = layoutRef.current
    let lastFilled = -1
    for (let r = 0; r < totalRows; r++) if (L.rowPara[r] !== -1 && L.rows[r].trim()) lastFilled = r
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

      if (sigImg && sigRow >= 0 && Math.floor(sigRow / rowsPerPage) === p) {
        const rowInPage = sigRow % rowsPerPage
        const rowTopMm = geo.tableTopMm + geo.rowHeightMm * (1 + rowInPage)
        const notesRightMm = geo.tableLeftMm + geo.dateColMm + geo.notesColMm
        const targetHmm = geo.rowHeightMm * 0.9 * ((signatureScale && signatureScale > 0 ? signatureScale : 100) / 100)
        const ratio = sigImg.naturalWidth / sigImg.naturalHeight || 3
        const wmm = targetHmm * ratio
        const xmm = notesRightMm - wmm - 1
        ctx.drawImage(sigImg, xmm * MM_PER_PX * SCALE, rowTopMm * MM_PER_PX * SCALE, wmm * MM_PER_PX * SCALE, targetHmm * MM_PER_PX * SCALE)
      }

      page.style.transform = savedTransform
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', 0, 0, 210, 297)
    }

    const name = [value.pid.surname, value.pid.givenNames].filter(Boolean).join('_') || 'progress-notes'
    pdf.save(`${name}.pdf`)
  }, [form, geo, pageCount, rowsPerPage, totalRows, signatureUrl, signatureScale, value.pid])

  useImperativeHandle(ref, () => ({ downloadPdf }), [downloadPdf])

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

  const ro = { readOnly: true, tabIndex: -1 } as const

  function renderPid() {
    return (
      <div className="hf-pid">
        <div className="hf-pid-row"><input {...ro} data-hf-white="1" value={value.pid.urNo} readOnly aria-label="UR No" /></div>
        <div className="hf-pid-row"><input {...ro} data-hf-white="1" value={value.pid.surname} readOnly aria-label="Surname" /></div>
        <div className="hf-pid-row"><input {...ro} data-hf-white="1" value={value.pid.givenNames} readOnly aria-label="Given Names" /></div>
        <div className="hf-pid-dobsex">
          <div className="hf-pid-dob"><input {...ro} data-hf-white="1" value={value.pid.dob} readOnly aria-label="Date of Birth" /></div>
          <div className="hf-pid-sex"><input {...ro} data-hf-white="1" value={value.pid.sex} readOnly aria-label="Sex" /></div>
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="hf-root">
      <style>{HF_CSS}</style>
      <div className="hf-pages" style={{ ['--hf-scale' as string]: String(scale) } as React.CSSProperties}>
        {form.pageBackgrounds.map((bg, p) => (
          <div key={p} ref={el => { pageRefs.current[p] = el }} className="hf-page" style={{ ...pageVars, backgroundImage: bg ? `url(${bg})` : undefined }}>
            {renderPid()}
            <table className="hf-table">
              <colgroup><col className="hf-col-date" /><col className="hf-col-notes" /></colgroup>
              <thead><tr><th>{form.labels.dateCol}</th><th>{form.labels.notesCol}</th></tr></thead>
              <tbody>
                {Array.from({ length: rowsPerPage }, (_, i) => {
                  const globalRow = p * rowsPerPage + i
                  return (
                    <tr key={i}>
                      <td>
                        {globalRow === 0 ? <input {...ro} data-hf-center="1" value={value.dateTime.date} readOnly aria-label="Date" />
                          : globalRow === 1 ? <input {...ro} data-hf-center="1" value={value.dateTime.time} readOnly aria-label="Time" />
                          : <span className="hf-date-empty" />}
                      </td>
                      <td>
                        <input {...ro} ref={globalRow === 0 ? noteCellRef : undefined} className="hf-note" value={layout.rows[globalRow] ?? ''} readOnly aria-label={`Notes line ${globalRow + 1}`} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
})

export default HospitalFormEditor

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
`
