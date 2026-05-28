'use client'

interface TimePickerProps {
  value: string       // "HH:MM – HH:MM" or ""
  onChange: (val: string) => void
  label?: string
}

const TIME_SLOTS: string[] = []
for (let h = 7; h <= 21; h++) {
  const maxM = h === 21 ? 0 : 55
  for (let m = 0; m <= maxM; m += 5) {
    TIME_SLOTS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
}

function parseTime(value: string): { start: string; end: string } {
  const match = value.match(/^(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})$/)
  if (match) return { start: match[1], end: match[2] }
  return { start: '', end: '' }
}

const selectClass = `
  flex-1 rounded-[var(--r-sm)] border border-[var(--border)] bg-white
  px-2 py-2 text-sm text-[var(--text)]
  outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
  transition-colors
`

export default function TimePicker({ value, onChange, label }: TimePickerProps) {
  const { start, end } = parseTime(value)

  function handleStart(v: string) {
    const newEnd = end || v
    onChange(v && newEnd ? `${v} – ${newEnd}` : '')
  }

  function handleEnd(v: string) {
    const newStart = start || v
    onChange(newStart && v ? `${newStart} – ${v}` : '')
  }

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-[var(--text)] mb-1">{label}</label>
      )}
      <div className="flex items-center gap-2">
        <select value={start} onChange={e => handleStart(e.target.value)} className={selectClass}>
          <option value="">Start</option>
          {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="text-[var(--text3)] text-sm shrink-0">–</span>
        <select value={end} onChange={e => handleEnd(e.target.value)} className={selectClass}>
          <option value="">End</option>
          {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
    </div>
  )
}
