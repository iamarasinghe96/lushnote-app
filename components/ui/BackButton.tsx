'use client'

import Link from 'next/link'

// One back control for the whole app.
//
// Every one of these was hand-rolled as the literal character "←" followed by
// text, with different colours, different sizes and no hit area beyond the
// glyph itself. A text arrow is not an icon: it renders at the font's own
// weight, sits on the text baseline rather than optically centred, and changes
// shape between fonts and platforms. Six near-copies of that is what makes a
// console look assembled rather than designed.
//
// The whole control is the target, not the glyph, and the chevron is a real
// stroked icon that matches the rest of the iconography.

interface Props {
  /** What the doctor is going back TO, e.g. "LushNote", "all users". */
  label: string
  /** Where it goes. Give this OR onClick, not both. */
  href?: string
  /** For stepping back inside a modal, where there is no route to link to. */
  onClick?: () => void
  /**
   * `onDark` is for the admin console's blue header. The label needs a
   * different colour there and no other difference, so it is one flag rather
   * than a second component.
   */
  tone?: 'default' | 'onDark'
  /**
   * `outlined` is for a back that sits in a footer row beside a primary button
   * and has to carry the same visual weight. Ghost is right everywhere the
   * back is subordinate to the page behind it.
   */
  variant?: 'ghost' | 'outlined'
  className?: string
}

function Chevron() {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden
      className="shrink-0 motion-safe:transition-transform motion-safe:group-hover:-translate-x-0.5"
    >
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const BASE =
  'group inline-flex items-center gap-1.5 rounded-[var(--r)] pl-1.5 pr-2.5 py-1.5 ' +
  'text-sm font-medium outline-none ' +
  'motion-safe:transition-colors motion-safe:active:scale-[0.98] ' +
  'focus-visible:ring-2 focus-visible:ring-offset-1'

const TONE = {
  default:
    'text-[var(--text2)] hover:text-[var(--text)] hover:bg-[var(--blue-lt)] ' +
    'focus-visible:ring-[var(--blue)] focus-visible:ring-offset-white',
  onDark:
    'text-white/85 hover:text-white hover:bg-white/10 ' +
    'focus-visible:ring-white focus-visible:ring-offset-transparent',
} as const

const OUTLINED =
  'px-4 py-2 border border-[var(--border)] text-[var(--text2)] ' +
  'hover:bg-[var(--bg)] hover:text-[var(--text)] ' +
  'focus-visible:ring-[var(--blue)] focus-visible:ring-offset-white'

export default function BackButton({
  label, href, onClick, tone = 'default', variant = 'ghost', className = '',
}: Props) {
  // The label already says where it goes, so the accessible name is the label.
  // The chevron is decorative and marked aria-hidden above.
  const content = <><Chevron />{label}</>

  // Outlined has a border, so pulling it left would misalign the border with
  // everything beneath it. Only the ghost variant hangs its padding outside.
  const cls = variant === 'outlined'
    ? `${BASE.replace('pl-1.5 pr-2.5 py-1.5 ', '')} ${OUTLINED} ${className}`
    : `${BASE} ${TONE[tone]} -ml-1.5 ${className}`

  if (href) return <Link href={href} className={cls}>{content}</Link>
  return <button type="button" onClick={onClick} className={cls}>{content}</button>
}
