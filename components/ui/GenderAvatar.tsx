interface GenderAvatarProps {
  gender?: 'male' | 'female' | 'other' | 'prefer-not-to-say' | null
  size?: number
}

export function GenderAvatar({ gender, size = 48 }: GenderAvatarProps) {
  if (gender === 'male') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
        <circle cx="24" cy="24" r="24" fill="#dbeafe" />
        <circle cx="24" cy="18" r="8" fill="#93c5fd" />
        <path d="M8 44c0-8.8 7.2-16 16-16s16 7.2 16 16" fill="#93c5fd" />
      </svg>
    )
  }
  if (gender === 'female') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
        <circle cx="24" cy="24" r="24" fill="#fce7f3" />
        <circle cx="24" cy="18" r="8" fill="#f9a8d4" />
        <path d="M8 46c0-8.8 7.2-14 16-14s16 5.2 16 14" fill="#f9a8d4" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <circle cx="24" cy="24" r="24" fill="#f1f5f9" />
      <circle cx="24" cy="18" r="8" fill="#cbd5e1" />
      <path d="M8 44c0-8.8 7.2-16 16-16s16 7.2 16 16" fill="#cbd5e1" />
    </svg>
  )
}
