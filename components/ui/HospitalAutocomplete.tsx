'use client'

import { useState, useRef, useEffect } from 'react'
import hospitals from '@/data/declared-hospitals.json'

interface Props {
  value: string
  onChange: (value: string) => void
  label?: string
  placeholder?: string
  className?: string
  inputClassName?: string
}

export default function HospitalAutocomplete({ value, onChange, label, placeholder, className, inputClassName }: Props) {
  const [suggestions, setSuggestions] = useState<typeof hospitals>([])
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  function handleChange(val: string) {
    onChange(val)
    if (val.trim().length >= 2) {
      const q = val.toLowerCase()
      const filtered = hospitals
        .filter(h => h.name.toLowerCase().includes(q))
        .slice(0, 8)
      setSuggestions(filtered)
      setOpen(filtered.length > 0)
    } else {
      setSuggestions([])
      setOpen(false)
    }
  }

  function pick(name: string) {
    onChange(name)
    setSuggestions([])
    setOpen(false)
  }

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      {label && (
        <label className="block text-sm font-medium text-[var(--text)] mb-1">{label}</label>
      )}
      <input
        type="text"
        value={value}
        onChange={e => handleChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClassName ?? 'w-full rounded-[var(--r)] border border-[var(--border)] bg-white px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10'}
      />
      {open && suggestions.length > 0 && (
        <div
          className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-[var(--border)] rounded-[var(--r)] overflow-hidden"
          style={{ boxShadow: '0 8px 24px rgba(15,23,42,.12)' }}
        >
          {suggestions.map(h => (
            <button
              key={`${h.name}-${h.state}-${h.suburb}`}
              type="button"
              onPointerDown={e => { e.preventDefault(); pick(h.name) }}
              className="w-full text-left px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg)] flex items-baseline justify-between gap-2"
            >
              <span className="truncate">{h.name}</span>
              <span className="shrink-0 text-xs text-[var(--text3)]">{h.suburb ? `${h.suburb}, ` : ''}{h.state}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
