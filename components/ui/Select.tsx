'use client'

import { useEffect, useRef, useState } from 'react'

// A dropdown whose OPEN list matches the app.
//
// A native `<select>` renders its control in the page and its list in the
// operating system, so `rounded-xl` styles the closed box and nothing at all
// once it opens — which is why the menu arrived as a square grey OS panel on a
// rounded form. No amount of CSS fixes that; the list has to be ours.
//
// What that costs is keyboard and screen-reader behaviour the browser gave for
// free, so it is rebuilt here rather than left out: roles, arrow keys, Home/End,
// Escape, type-ahead, focus return, and `aria-activedescendant` so a reader
// follows the highlight.

/** A bare string is its own label — the common case. The object form is for the
 *  fields whose stored value is not what a doctor should read ('none' → 'None'). */
export type SelectOption = string | { value: string; label: string }

interface Props {
  value: string
  onChange: (v: string) => void
  options: readonly SelectOption[]
  id?: string
  /** Solid white, never glass — the house rule for anything that takes input. */
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

export default function Select({
  value, onChange, options: raw, id, className = '', disabled, 'aria-label': ariaLabel,
}: Props) {
  const options = raw.map(o => (typeof o === 'string' ? { value: o, label: o } : o))
  const selectedLabel = options.find(o => o.value === value)?.label ?? value
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(() => Math.max(0, options.findIndex(o => o.value === value)))
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const typeAhead = useRef({ buffer: '', at: 0 })

  // Reopening on a value chosen elsewhere (a draft restore, a reset) should
  // highlight what is actually selected, not where the cursor was last time.
  useEffect(() => {
    if (!open) setActive(Math.max(0, options.findIndex(o => o.value === value)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, open])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Keep the highlighted row in view when arrowing past the visible window.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  function commit(i: number) {
    const next = options[i]
    if (next !== undefined) onChange(next.value)
    setOpen(false)
    // Focus goes back to the control, or the next Tab starts from the document.
    buttonRef.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return

    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'Escape':    e.preventDefault(); setOpen(false); buttonRef.current?.focus(); break
      case 'Tab':       setOpen(false); break
      case 'Enter':
      case ' ':         e.preventDefault(); commit(active); break
      case 'ArrowDown': e.preventDefault(); setActive(i => Math.min(options.length - 1, i + 1)); break
      case 'ArrowUp':   e.preventDefault(); setActive(i => Math.max(0, i - 1)); break
      case 'Home':      e.preventDefault(); setActive(0); break
      case 'End':       e.preventDefault(); setActive(options.length - 1); break
      default: {
        // Type-ahead, as a native select does: consecutive letters within a
        // second build a prefix, a pause starts a new one.
        if (e.key.length !== 1) break
        const now = Date.now()
        const t = typeAhead.current
        t.buffer = now - t.at < 1000 ? t.buffer + e.key : e.key
        t.at = now
        const found = options.findIndex(o => o.label.toLowerCase().startsWith(t.buffer.toLowerCase()))
        if (found !== -1) setActive(found)
      }
    }
  }

  const listId = id ? `${id}-listbox` : undefined

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-activedescendant={open && listId ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        onKeyDown={onKeyDown}
        className={`flex w-full items-center justify-between rounded-xl border border-[var(--border)]
                    bg-white px-3 py-2.5 text-left text-sm text-[var(--text)] outline-none
                    focus:border-[#10b981] focus:ring-1 focus:ring-[#10b981]
                    disabled:cursor-not-allowed disabled:opacity-50
                    motion-safe:transition-colors ${className}`}
      >
        <span className="truncate">{selectedLabel}</span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          aria-hidden
          className={`ml-2 shrink-0 text-[var(--text3)] motion-safe:transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-[var(--border)] p-1"
          style={{
            background: 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
            animation: 'select-open 0.15s ease-out both',
          }}
        >
          {options.map((o, i) => {
            const selected = o.value === value
            return (
              <li
                key={o.value}
                id={listId ? `${listId}-${i}` : undefined}
                role="option"
                aria-selected={selected}
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                // mousedown, not click: the outside-click listener fires first
                // on click and closes the list before the choice registers.
                onMouseDown={e => { e.preventDefault(); commit(i) }}
                className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm
                  ${i === active ? 'bg-[var(--blue-lt)] text-[var(--text)]' : 'text-[var(--text2)]'}
                  ${selected ? 'font-medium text-[var(--text)]' : ''}`}
              >
                <span className="truncate">{o.label}</span>
                {selected && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" aria-hidden>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
