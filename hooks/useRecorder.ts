'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface UseRecorderReturn {
  isRecording: boolean
  duration: number
  startRecording: (stream: MediaStream) => void
  stopRecording: () => Promise<{ blob: Blob; mimeType: string; duration: number }>
  error: string | null
}

export function useRecorder(): UseRecorderReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resolveRef = useRef<((v: { blob: Blob; mimeType: string; duration: number }) => void) | null>(null)
  const mimeTypeRef = useRef<string>('')
  const isRecordingRef = useRef(false)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
    }
  }, [])

  // Resync timer on visibility change (phone screen unlock)
  useEffect(() => {
    function onVisibilityChange() {
      if (!isRecordingRef.current) return
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  const startRecording = useCallback((stream: MediaStream) => {
    setError(null)
    chunksRef.current = []

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : 'audio/mp4'
    mimeTypeRef.current = mimeType

    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48000 })

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current })
      const dur = Math.floor((Date.now() - startTimeRef.current) / 1000)
      if (resolveRef.current) {
        resolveRef.current({ blob, mimeType: mimeTypeRef.current, duration: dur })
        resolveRef.current = null
      }
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      isRecordingRef.current = false
      setIsRecording(false)
      setDuration(0)
    }

    recorder.onerror = () => {
      setError('Recording error occurred')
      isRecordingRef.current = false
      setIsRecording(false)
    }

    startTimeRef.current = Date.now()
    recorder.start(1000)
    mediaRecorderRef.current = recorder
    isRecordingRef.current = true
    setIsRecording(true)

    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
  }, [])

  const stopRecording = useCallback((): Promise<{ blob: Blob; mimeType: string; duration: number }> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      } else {
        resolve({ blob: new Blob(), mimeType: mimeTypeRef.current, duration: 0 })
      }
    })
  }, [])

  return { isRecording, duration, startRecording, stopRecording, error }
}
