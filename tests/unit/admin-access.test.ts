import { describe, it, expect } from 'vitest'
import { isOwner, hasAdminAccess, adminChangeRefusal } from '@/lib/adminAccess'

// Who reaches the admin console, and who decides that. The console shows every
// doctor's account and billing and can remove accounts and promote releases,
// so a mistake here is not cosmetic.

const OWNER = 'owner-uid'

describe('hasAdminAccess', () => {
  it('lets the owner in without any claim', () => {
    expect(hasAdminAccess(OWNER, null, OWNER)).toBe(true)
  })

  it('lets in someone holding the admin claim', () => {
    expect(hasAdminAccess('friend', { admin: true }, OWNER)).toBe(true)
  })

  it('refuses everyone else, including a claim that is merely truthy', () => {
    expect(hasAdminAccess('doctor', {}, OWNER)).toBe(false)
    expect(hasAdminAccess('doctor', { admin: 'true' }, OWNER)).toBe(false)
    expect(hasAdminAccess('doctor', { admin: false }, OWNER)).toBe(false)
  })

  it('never treats an unset owner as matching an unset uid', () => {
    expect(hasAdminAccess('', null, '')).toBe(false)
    expect(isOwner(undefined, undefined)).toBe(false)
  })
})

describe('adminChangeRefusal', () => {
  it('lets the owner grant and revoke for someone else', () => {
    expect(adminChangeRefusal(OWNER, 'friend', OWNER)).toBeNull()
  })

  it('refuses a granted admin, so nobody can keep themselves an admin', () => {
    expect(adminChangeRefusal('friend', 'someone', OWNER)).toMatch(/Only the owner/)
    expect(adminChangeRefusal('friend', 'friend', OWNER)).toMatch(/Only the owner/)
  })

  it('refuses the owner changing their own access', () => {
    expect(adminChangeRefusal(OWNER, OWNER, OWNER)).toMatch(/always an admin/)
  })

  it('refuses everyone when no owner is configured', () => {
    expect(adminChangeRefusal('anyone', 'friend', '')).toMatch(/Only the owner/)
  })
})
