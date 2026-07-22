'use client'

import { useState, useEffect, useRef } from 'react'
import { useNoteStore } from '@/hooks/useNoteStore'
import { useAuth } from '@/hooks/useAuth'
import { buildNoteText, buildCoverLetterEmail, buildPreviewHTML, buildLetterPreviewHTML, withTimeout } from '@/lib/utils'
import { downloadNotePDF, shareNotePDF } from '@/lib/pdf'
import { downloadLetterPDF, openLetterEmail, type LetterExportParams } from '@/lib/letterExport'
import { getPatientProfiles } from '@/lib/firestore/patients'
import HospitalFormView from '@/components/hospital-form/HospitalFormView'
import type { PatientProfile, LetterType } from '@/types'

export default function ExportPage() {
  const store = useNoteStore()
  const { currentNote } = store
  const { user, profile } = useAuth()
  const [patientProfiles, setPatientProfiles] = useState<Record<string, PatientProfile>>({})

  useEffect(() => {
    if (!user) return
    getPatientProfiles(user.uid).then(setPatientProfiles).catch(() => {})
  }, [user?.uid])
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const letterType = store.letterType as LetterType | null
  const isLetterMode = letterType !== null

  const isEmpty = isLetterMode
    ? false
    : !currentNote.patient && !currentNote.content && !currentNote.summary

  const previewHtml = isLetterMode
    ? buildLetterPreviewHTML({
        letterType: letterType!,
        common: store.letterCommonFields,
        referral: store.referralFields,
        records: store.recordsFields,
        freetext: store.freetextFields,
        custom: { sections: store.customLetterSections },
        letterheadHeaderUrl: store.activeLetterhead?.headerUrl ?? null,
        letterheadFooterUrl: store.activeLetterhead?.footerUrl ?? null,
        signatureUrl: profile?.signatureUrl ?? null,
        signatureScale: profile?.signatureScale ?? 60,
        fontSize: profile?.letterFontSize ?? 11,
        lineHeight: profile?.letterLineSpacing ?? 1,
        margin: profile?.letterMargin ?? 12,
        clinicianName: profile?.displayName,
        credentials: profile?.credentials,
        providerNumber: profile?.providerNumber,
        workPhone: profile?.workPhone,
        position: profile?.position,
        workplaceName: profile?.workplaces?.find(w => w.id === profile?.activeWorkplaceId)?.name,
      })
    : buildPreviewHTML(currentNote)

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
      await withTimeout(navigator.clipboard.writeText(noteText))
      showToast('Copied to clipboard')
    } catch {
      showToast('Copy failed - please copy manually')
    }
    setMenuOpen(false)
  }

  function handlePDF() {
    const matchedProfile = currentNote.patient
      ? Object.values(patientProfiles).find(
          p => p.displayName.trim().toLowerCase() === currentNote.patient!.trim().toLowerCase()
        )
      : undefined
    downloadNotePDF(currentNote, profile?.displayName, matchedProfile
      ? { dob: matchedProfile.dob, gender: matchedProfile.gender }
      : undefined
    )
    setMenuOpen(false)
  }

  function handlePrint() {
    window.print()
    setMenuOpen(false)
  }

  function handleEmail() {
    const body = encodeURIComponent(buildCoverLetterEmail(currentNote, profile || {}))
    const subject = encodeURIComponent(
      `Progress Note - ${currentNote.patient || ''} - ${currentNote.date || ''}`
    )
    window.location.href = `mailto:?subject=${subject}&body=${body}`
    setMenuOpen(false)
  }

  function handleSubmitAsText() {
    const body = encodeURIComponent(buildNoteText(currentNote))
    window.location.href = `mailto:?body=${body}`
    setMenuOpen(false)
  }

  function letterParams(): LetterExportParams {
    return {
      letterType: letterType!,
      common: store.letterCommonFields,
      referral: store.referralFields,
      records: store.recordsFields,
      freetext: store.freetextFields,
      customSections: store.customLetterSections,
      letterheadHeaderUrl: store.activeLetterhead?.headerUrl ?? null,
      letterheadFooterUrl: store.activeLetterhead?.footerUrl ?? null,
      signatureUrl: profile?.signatureUrl ?? null,
      signatureScale: profile?.signatureScale ?? 100,
      fontSize: profile?.letterFontSize ?? 11,
      lineSpacing: profile?.letterLineSpacing ?? 1.4,
      margin: profile?.letterMargin ?? 20,
      clinicianName: profile?.displayName,
      credentials: profile?.credentials,
      providerNumber: profile?.providerNumber,
      workPhone: profile?.workPhone,
      position: profile?.position,
      workplaceName: profile?.workplaces?.find(w => w.id === profile?.activeWorkplaceId)?.name,
    }
  }
  async function handleLetterDownload() { setMenuOpen(false); try { await downloadLetterPDF(letterParams()) } catch { showToast('Could not build the PDF.') } }
  function handleLetterEmailExport() { setMenuOpen(false); openLetterEmail(letterParams()) }

  function handleShareNote() {
    const matchedProfile = currentNote.patient
      ? Object.values(patientProfiles).find(p => p.displayName.trim().toLowerCase() === currentNote.patient!.trim().toLowerCase())
      : undefined
    setMenuOpen(false)
    shareNotePDF(currentNote, profile?.displayName, matchedProfile ? { dob: matchedProfile.dob, gender: matchedProfile.gender } : undefined)
      .catch(() => showToast('Could not share the PDF.'))
  }
  async function handleLetterShare() {
    setMenuOpen(false)
    const label = letterType === 'referral' ? 'Referral' : letterType === 'records' ? 'Medical records request' : 'Letter'
    const caption = [label, store.letterCommonFields.patientName, store.letterCommonFields.letterDate].filter(Boolean).join(' · ')
    try { await downloadLetterPDF(letterParams(), caption) } catch { showToast('Could not share the PDF.') }
  }
  const canShareFiles = typeof navigator !== 'undefined' && !!navigator.share

  const menuItems = isLetterMode
    ? [
        { label: 'Download PDF',        action: handleLetterDownload },
        ...(canShareFiles ? [{ label: 'Share PDF', action: handleLetterShare }] : []),
        { label: 'Email (Outlook)',     action: handleLetterEmailExport },
        { label: 'Print',               action: handlePrint },
      ]
    : [
        { label: 'Copy to Clipboard',  action: handleCopyClipboard },
        { label: 'Download PDF',       action: handlePDF },
        ...(canShareFiles ? [{ label: 'Share PDF', action: handleShareNote }] : []),
        { label: 'Print',              action: handlePrint },
        { label: 'Email to Colleague', action: handleEmail },
        { label: 'Submit as Text',     action: handleSubmitAsText },
      ]

  // A hospital form previews as the rendered form (read-only) with its own
  // Download PDF, mirroring how letters export from the Edit toolbar.
  if (store.hospitalForm) {
    return <HospitalFormView readOnly />
  }

  return (
    <div className="h-full relative overflow-hidden">

      {/* Preview pane - full height */}
      <div className="absolute inset-0 overflow-y-auto scrollbar-none px-4 pt-header pb-tabbar">
        {isEmpty ? (
          <div className="flex items-center justify-center h-full text-[var(--text3)] text-sm">
            No note loaded. Generate or load a note to export.
          </div>
        ) : (
          <div
            className={isLetterMode ? 'max-w-2xl mx-auto' : 'preview-pane max-w-2xl mx-auto'}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}
      </div>

      {/* Floating Export button - top-right corner (notes and letters) */}
      {(
        <div ref={menuRef} className="absolute right-4 z-10 no-print" style={{ top: 'calc(env(safe-area-inset-top) + 80px)' }}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            disabled={isEmpty}
            className="text-white text-xs font-semibold px-4 py-2 rounded-full
                       flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none
                       motion-safe:transition-colors motion-safe:active:scale-[0.97]"
            style={{
              background: 'rgba(14,159,110,0.90)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.25)',
              boxShadow: '0 2px 8px rgba(14,159,110,0.30)',
            }}
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
      )}

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
