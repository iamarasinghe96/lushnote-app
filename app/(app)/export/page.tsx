'use client'

import { useState, useEffect, useRef } from 'react'
import { useNoteStore } from '@/hooks/useNoteStore'
import { useAuth } from '@/hooks/useAuth'
import { buildNoteText, buildCoverLetterEmail, buildPreviewHTML } from '@/lib/utils'
import { downloadNotePDF } from '@/lib/pdf'

export default function ExportPage() {
  const { currentNote } = useNoteStore()
  const { profile } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const isEmpty = !currentNote.patient && !currentNote.content && !currentNote.summary

  const previewHtml = buildPreviewHTML(currentNote)

  useEffect(() => {
    if (!menuOpen) return
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [menuOpen])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  async function handleCopyClipboard() {
    const noteText = buildNoteText(currentNote)
    try {
      await navigator.clipboard.writeText(noteText)
      showToast('Copied to clipboard')
    } catch {
      showToast('Copy failed — please copy manually')
    }
    setMenuOpen(false)
  }

  function handlePDF() {
    downloadNotePDF(currentNote, profile?.displayName)
    setMenuOpen(false)
  }

  function handlePrint() {
    window.print()
    setMenuOpen(false)
  }

  function handleEmail() {
    const body = encodeURIComponent(buildCoverLetterEmail(currentNote, profile || {}))
    const subject = encodeURIComponent(
      `Progress Note — ${currentNote.patient || ''} — ${currentNote.date || ''}`
    )
    window.location.href = `mailto:?subject=${subject}&body=${body}`
    setMenuOpen(false)
  }

  function handleSubmitAsText() {
    const body = encodeURIComponent(buildNoteText(currentNote))
    window.location.href = `mailto:?body=${body}`
    setMenuOpen(false)
  }

  const menuItems = [
    { label: 'Copy to Clipboard',  action: handleCopyClipboard },
    { label: 'Download PDF',       action: handlePDF },
    { label: 'Print',              action: handlePrint },
    { label: 'Email to Colleague', action: handleEmail },
    { label: 'Submit as Text',     action: handleSubmitAsText },
  ]

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Action bar */}
      <div
        className="shrink-0 border-b border-[var(--border)] px-4 py-3 flex items-center justify-between no-print"
        style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)' }}
      >
        <h2 className="text-sm font-semibold text-[var(--text)]">Export Note</h2>

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            disabled={isEmpty}
            className="bg-[var(--blue)] text-white text-sm font-medium px-4 py-2 rounded-[var(--r)]
                       flex items-center gap-2 hover:bg-[var(--blue-dk)] active:scale-[0.97]
                       disabled:opacity-40 disabled:pointer-events-none transition-all"
          >
            Export ▾
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-full mt-1 w-52 bg-white border border-[var(--border)]
                         rounded-[var(--r-lg)] z-50 overflow-hidden"
              style={{ boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' }}
            >
              {menuItems.map(item => (
                <button
                  key={item.label}
                  onClick={item.action}
                  className="w-full text-left px-4 py-2.5 text-sm text-[var(--text)]
                             hover:bg-[var(--bg)] border-b border-[var(--border)] last:border-0
                             active:scale-[0.98] transition-colors"
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Preview pane */}
      <div className="flex-1 overflow-y-auto p-4">
        {isEmpty ? (
          <div className="flex items-center justify-center h-full text-[var(--text3)] text-sm">
            No note loaded. Generate or load a note to export.
          </div>
        ) : (
          <div
            className="preview-pane max-w-2xl mx-auto"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-[var(--text)] text-white
                     text-sm px-4 py-2 rounded-[var(--r)] z-50 no-print"
          style={{ boxShadow: '0 2px 8px rgba(15,23,42,.18)' }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
