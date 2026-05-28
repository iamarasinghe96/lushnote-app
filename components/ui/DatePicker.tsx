'use client'

import { useState, useEffect, useRef } from 'react'

interface DatePickerProps {
  value: string       // DD/MM/YYYY
  onChange: (val: string) => void
  label?: string
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December']

function parseDDMMYYYY(s: string): Date | null {
  const parts = s.split('/')
  if (parts.length !== 3) return null
  const d = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  const y = parseInt(parts[2], 10)
  if (!d || !m || !y || y < 1900) return null
  return new Date(y, m - 1, d)
}

function toDDMMYYYY(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const y = date.getFullYear()
  return `${d}/${m}/${y}`
}

export default function DatePicker({ value, onChange, label }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const parsed = parseDDMMYYYY(value)
  const today = new Date()
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? today.getMonth())
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Update view when value changes externally
  useEffect(() => {
    const p = parseDDMMYYYY(value)
    if (p) { setViewYear(p.getFullYear()); setViewMonth(p.getMonth()) }
  }, [value])

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  function handleDayClick(day: number) {
    const d = new Date(viewYear, viewMonth, day)
    onChange(toDDMMYYYY(d))
    setOpen(false)
  }

  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // Pad to complete 6 rows
  while (cells.length < 42) cells.push(null)

  const isSelected = (day: number) => {
    if (!parsed) return false
    return parsed.getFullYear() === viewYear && parsed.getMonth() === viewMonth && parsed.getDate() === day
  }
  const isToday = (day: number) =>
    today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === day

  return (
    <div ref={containerRef} className="w-full relative">
      {label && (
        <label className="block text-sm font-medium text-[var(--text)] mb-1">{label}</label>
      )}
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="DD/MM/YYYY"
        className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                   px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                   outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                   transition-colors cursor-pointer"
        readOnly
      />
      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 bg-white border border-[var(--border)] rounded-[var(--r)] overflow-hidden"
          style={{ boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)', minWidth: 256 }}
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
            <button
              type="button"
              onClick={prevMonth}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--bg)] text-[var(--text2)] active:scale-95 transition-transform"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-[var(--text)]">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--bg)] text-[var(--text2)] active:scale-95 transition-transform"
            >
              ›
            </button>
          </div>

          {/* Day labels */}
          <div className="grid grid-cols-7 px-2 pt-2">
            {DAYS.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-[var(--text3)] pb-1">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 px-2 pb-2">
            {cells.map((day, i) => (
              <div key={i} className="flex items-center justify-center p-0.5">
                {day !== null ? (
                  <button
                    type="button"
                    onClick={() => handleDayClick(day)}
                    className={`w-8 h-8 rounded-full text-xs font-medium transition-colors
                      ${isSelected(day)
                        ? 'bg-[var(--blue)] text-white'
                        : isToday(day)
                          ? 'border border-[var(--blue)] text-[var(--blue)] hover:bg-[var(--blue-lt)]'
                          : 'text-[var(--text)] hover:bg-[var(--bg)]'
                      }`}
                  >
                    {day}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
