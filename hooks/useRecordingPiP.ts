'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Keep a recording alive while the doctor uses another app.
//
// Android Chrome freezes a backgrounded tab and releases the microphone, which
// silently kills a dictation the moment the doctor switches apps (iOS is more
// forgiving, but locking the phone stops it there too). A page that is driving
// an ACTIVE Picture-in-Picture video is treated as user-visible, so it is not
// frozen and keeps its mic — which is what actually saves the recording.
//
// There is no DOM-in-PiP on mobile (Document PiP is desktop-Chrome only), so we
// paint a small recording HUD onto a canvas, turn that canvas into a video
// stream, and put THAT video into PiP. The floating window doubles as the
// recording indicator: timer, status, and a reminder not to close it.
//
// Entering PiP requires a user gesture, and iOS ends that gesture at the first
// await — so the flow is: prepare() while the pre-record screen is showing
// (canvas + video created, playing, metadata settled), then enter() as the very
// first statement of the Start tap, before anything is awaited.

interface WebkitVideo extends HTMLVideoElement {
  webkitSupportsPresentationMode?: (mode: string) => boolean
  webkitSetPresentationMode?: (mode: string) => void
  webkitPresentationMode?: string
  // Standard PiP attribute: browsers that honour it pop the window open by
  // themselves when the page is hidden. Not in lib.dom yet.
  autoPictureInPicture?: boolean
}

export interface PiPStatus {
  seconds: number
  micLost: boolean
  label: string          // e.g. "Referral Letter" / "Dictating"
}

const W = 480
const H = 270

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Every browser on iOS is WebKit underneath, so this covers Safari, Chrome and
// Brave alike (and iPadOS, which reports itself as a Mac with a touchscreen).
function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

// Feature detection without a live element: standard PiP exposes a document
// flag; iOS Safari only exposes webkitSetPresentationMode on the element.
//
// iOS is deliberately excluded even though the API exists. Recording there
// already survives switching apps, so the floating window buys nothing — while
// handing the video to the system player introduces its own problems (the
// browser reopening the site in a fresh tab on return). The window exists to fix
// Android, where backgrounding genuinely kills the microphone.
function detectSupport(): boolean {
  if (typeof document === 'undefined') return false
  if (detectIOS()) return false
  const canvasOk = typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function'
  if (!canvasOk) return false
  if (document.pictureInPictureEnabled) return true
  const probe = document.createElement('video') as WebkitVideo
  return typeof probe.webkitSetPresentationMode === 'function'
}

export function useRecordingPiP() {
  const [supported, setSupported] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const videoRef = useRef<WebkitVideo | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Latest status, read by the draw loop — a ref so the loop never restarts
  // (and never goes stale) as the timer ticks.
  const statusRef = useRef<PiPStatus>({ seconds: 0, micLost: false, label: 'Dictating' })
  // True while a recording is live, so the visibility handler knows it may
  // open the window on its own.
  const armedRef = useRef(false)

  useEffect(() => { setSupported(detectSupport()); setIsIOS(detectIOS()) }, [])

  // Refine support once the element exists: method presence alone can be a false
  // positive, whereas webkitSupportsPresentationMode answers for this build.
  const refineSupport = useCallback((video: WebkitVideo) => {
    if (typeof video.webkitSupportsPresentationMode === 'function') {
      setSupported(video.webkitSupportsPresentationMode('picture-in-picture')
        || (typeof video.requestPictureInPicture === 'function' && !!document.pictureInPictureEnabled))
    }
  }, [])

  const setStatus = useCallback((s: PiPStatus) => { statusRef.current = s }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { seconds, micLost, label } = statusRef.current

    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, W, H)

    // Brand row
    ctx.fillStyle = '#5ad6a7'
    ctx.beginPath()
    ctx.arc(30, 34, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '600 17px system-ui, -apple-system, Inter, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('LushNote', 48, 35)

    // Recording dot — pulses unless the doctor asked for reduced motion.
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const pulse = reduce ? 1 : 0.45 + 0.55 * Math.abs(Math.sin(Date.now() / 500))
    ctx.globalAlpha = micLost ? 1 : pulse
    ctx.fillStyle = micLost ? '#f59e0b' : '#ef4444'
    ctx.beginPath()
    ctx.arc(W - 34, 34, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1

    // Timer
    ctx.fillStyle = '#ffffff'
    ctx.font = '700 62px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.fillText(formatDuration(seconds), W / 2, H / 2 - 6)

    // Status
    ctx.fillStyle = micLost ? '#fbbf24' : '#10b981'
    ctx.font = '600 18px system-ui, -apple-system, Inter, sans-serif'
    ctx.fillText(micLost ? 'Paused — microphone interrupted' : `${label}…`, W / 2, H / 2 + 44)

    // Reminder — closing this window ends the protection, so say so.
    ctx.fillStyle = '#94a3b8'
    ctx.font = '400 15px system-ui, -apple-system, Inter, sans-serif'
    ctx.fillText('Keep this window open while recording', W / 2, H - 30)
  }, [])

  // Build the canvas + muted video and start playing, so the element is ready
  // the instant the doctor taps (PiP rejects a video without metadata).
  const prepare = useCallback(async () => {
    if (!detectSupport() || videoRef.current) return
    setError(null)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      canvasRef.current = canvas
      draw()

      const stream = canvas.captureStream(2)
      streamRef.current = stream

      const video = document.createElement('video') as WebkitVideo
      video.srcObject = stream
      video.muted = true
      video.autoplay = true
      video.playsInline = true
      video.setAttribute('playsinline', '')
      // Browsers that implement this open the floating window themselves the
      // moment the page is hidden — the seamless path, no gesture involved.
      video.autoPictureInPicture = true
      video.setAttribute('autopictureinpicture', '')
      // PiP needs the element in the document; display:none would disqualify it,
      // so park it as a 1px, non-interactive, invisible element instead.
      video.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;'
      document.body.appendChild(video)
      videoRef.current = video

      video.addEventListener('enterpictureinpicture', () => setActive(true))
      video.addEventListener('leavepictureinpicture', () => setActive(false))
      video.addEventListener('webkitpresentationmodechanged', () => {
        setActive(video.webkitPresentationMode === 'picture-in-picture')
      })

      await video.play().catch(() => { /* muted autoplay; retried on enter() */ })

      // PiP rejects a video whose metadata hasn't loaded, so settle that here —
      // enter() is called straight after and must not lose the user's gesture.
      await new Promise<void>(resolve => {
        if (video.readyState >= 1) { resolve(); return }
        const done = () => resolve()
        video.addEventListener('loadedmetadata', done, { once: true })
        setTimeout(done, 1200)
      })

      // Two drivers so the HUD keeps ticking: rAF while visible (smooth), and an
      // interval that survives backgrounding (throttled, but ~1s is plenty).
      const loop = () => { draw(); rafRef.current = requestAnimationFrame(loop) }
      rafRef.current = requestAnimationFrame(loop)
      tickRef.current = setInterval(draw, 1000)
      armedRef.current = true
      refineSupport(video)
    } catch {
      setError('Could not start the floating window.')
    }
  }, [draw, refineSupport])

  // `silent` is used by the automatic attempts: browsers reject PiP without a
  // user gesture, and that expected rejection must not surface as an error.
  const enter = useCallback(async (opts?: { silent?: boolean }) => {
    const video = videoRef.current
    if (!video) return false
    if (!opts?.silent) setError(null)
    try {
      // Deliberately NOT awaited: iOS only honours a picture-in-picture request
      // made inside the user's gesture, and awaiting anything first spends it.
      // The element is prepared and already playing well before this runs.
      if (video.paused) void video.play().catch(() => {})
      if (typeof video.requestPictureInPicture === 'function' && document.pictureInPictureEnabled) {
        await video.requestPictureInPicture()
        setActive(true)
        return true
      }
      if (typeof video.webkitSetPresentationMode === 'function') {
        video.webkitSetPresentationMode('picture-in-picture')
        setActive(true)
        return true
      }
      if (!opts?.silent) setError('Your browser does not support a floating window. Use split-screen instead.')
      return false
    } catch {
      if (!opts?.silent) setError('Could not open the floating window. Use split-screen instead.')
      return false
    }
  }, [])

  const exit = useCallback(async () => {
    const video = videoRef.current
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else if (video && typeof video.webkitSetPresentationMode === 'function'
        && video.webkitPresentationMode === 'picture-in-picture') {
        video.webkitSetPresentationMode('inline')
      }
    } catch { /* already closed */ }
    setActive(false)
  }, [])

  // Last-ditch attempt for browsers that ignore autoPictureInPicture: the moment
  // the page is hidden, try to open the window anyway. Most browsers reject this
  // (no user gesture) — which is exactly why enter() is also fired up-front when
  // recording starts — but where it is allowed, the doctor gets it for free.
  useEffect(() => {
    function onHide() {
      if (document.visibilityState !== 'hidden') return
      if (!armedRef.current || document.pictureInPictureElement) return
      void enter({ silent: true })
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [enter])

  const teardown = useCallback(() => {
    armedRef.current = false
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    void exit()
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    const video = videoRef.current
    if (video) {
      video.srcObject = null
      video.remove()
      videoRef.current = null
    }
    canvasRef.current = null
    setActive(false)
  }, [exit])

  useEffect(() => () => { teardown() }, [teardown])

  return { supported, isIOS, active, error, prepare, enter, exit, teardown, setStatus }
}
