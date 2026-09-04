// Validating a date of birth typed as DD/MM/YYYY.
//
// `formatDob` masks digits into the right shape and stops there, so until now
// nothing rejected 45/45/9999, 31/02/1990, or a child born next Tuesday. A DOB
// is used to identify a patient and reaches letters, hospital forms and the
// patient record, so a typo in it is a record attached to the wrong person.
//
// Only things the app can KNOW are wrong are errors here. A date that is
// merely unusual — a 104-year-old, a baby born yesterday — is a real patient
// somewhere, and an app that argues with a doctor about a correct entry teaches
// them to click past warnings.

export interface DobCheck {
  valid: boolean
  /** Present only when invalid. Written for a doctor, not a developer. */
  error?: string
}

const OK: DobCheck = { valid: true }

/** Beyond this a birth year is a typo, not a patient. The oldest verified human
 *  reached 122; 130 leaves room and still catches a mistyped century. */
const MAX_AGE_YEARS = 130

function daysInMonth(month: number, year: number): number {
  // Leap years matter: 29/02/2000 is a real birthday and 29/02/1900 is not.
  // (Divisible by 4, except centuries, except those divisible by 400.)
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    return leap ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/**
 * `now` is injected rather than read from the clock so the future-date rule is
 * testable, and so a note generated on a machine with a wrong clock is judged
 * against the same instant everything else on the page uses.
 */
export function validateDob(raw: string, now: Date = new Date()): DobCheck {
  const value = (raw ?? '').trim()

  // Empty is valid: DOB is optional everywhere it is asked for, and colouring
  // an untouched field red is how a form starts nagging before it has been used.
  if (!value) return OK

  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  // Partially typed is not yet wrong. The doctor is mid-keystroke and the mask
  // is feeding them digits one at a time; red while typing "1" is noise.
  if (!m) return { valid: false, error: 'Use DD/MM/YYYY' }

  const day = Number(m[1])
  const month = Number(m[2])
  const year = Number(m[3])

  if (month < 1 || month > 12) return { valid: false, error: 'Month must be 01–12' }
  if (day < 1) return { valid: false, error: 'Day must be 01 or later' }

  const max = daysInMonth(month, year)
  if (day > max) {
    return {
      valid: false,
      error: month === 2 && day === 29
        ? `${year} is not a leap year`
        : `That month has ${max} days`,
    }
  }

  // Compare whole days, so a birthday today is valid rather than "in the
  // future" because of the hours since midnight.
  const dob = new Date(year, month - 1, day)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (dob.getTime() > today.getTime()) return { valid: false, error: 'Date of birth is in the future' }

  const oldest = new Date(today.getFullYear() - MAX_AGE_YEARS, today.getMonth(), today.getDate())
  if (dob.getTime() < oldest.getTime()) return { valid: false, error: `More than ${MAX_AGE_YEARS} years ago — check the year` }

  return OK
}

/**
 * Whether to paint the field red *right now*.
 *
 * Separate from validateDob because a half-typed date is invalid but must not
 * look like an error: the doctor is still typing it. The border turns red only
 * once the date is complete enough to judge, which for a masked DD/MM/YYYY
 * field means all eight digits are in.
 */
export function shouldFlagDob(raw: string, now: Date = new Date()): boolean {
  const value = (raw ?? '').trim()
  if (value.length < 10) return false
  return !validateDob(value, now).valid
}
