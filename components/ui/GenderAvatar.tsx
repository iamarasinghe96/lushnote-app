interface GenderAvatarProps {
  gender?: 'male' | 'female' | 'other' | 'prefer-not-to-say' | null
  size?: number
}

export function GenderAvatar({ gender, size = 48 }: GenderAvatarProps) {
  if (gender === 'male') {
    return (
      <img
        src="/assets/undraw_male-avatar_zkzx.svg"
        width={size}
        height={size}
        alt="Male avatar"
        style={{ borderRadius: '50%', objectFit: 'cover', boxShadow: '0 0 0 1.5px rgba(15,23,42,0.08), 0 1px 4px rgba(15,23,42,0.06)' }}
      />
    )
  }
  if (gender === 'female') {
    return (
      <img
        src="/assets/undraw_female-avatar_7t6k.svg"
        width={size}
        height={size}
        alt="Female avatar"
        style={{ borderRadius: '50%', objectFit: 'cover', boxShadow: '0 0 0 1.5px rgba(15,23,42,0.08), 0 1px 4px rgba(15,23,42,0.06)' }}
      />
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

