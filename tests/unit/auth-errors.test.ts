import { describe, it, expect } from 'vitest'
import { signInErrorMessage } from '@/lib/authErrors'

// The landing page used to show one sentence for every possible failure, so a
// blocked popup, an unauthorised preview domain and a dead connection were
// indistinguishable — and "please try again" was wrong advice for two of them.

describe('signInErrorMessage', () => {
  describe('things the person chose to do', () => {
    it.each([
      'auth/popup-closed-by-user',
      'auth/cancelled-popup-request',
      'auth/user-cancelled',
    ])('says nothing at all for %s', code => {
      // Closing the popup is a decision. Painting a red error over it makes the
      // app look broken when it did exactly what was asked.
      expect(signInErrorMessage(code)).toBe(null)
    })
  })

  describe('things with a specific fix', () => {
    it('names Firebase and the exact setting for an unauthorised domain', () => {
      // The preview-deployment case. Without naming the console this is a
      // black popup that vanishes and no way to find out why.
      const msg = signInErrorMessage('auth/unauthorized-domain')
      expect(msg).toMatch(/Firebase/)
      expect(msg).toMatch(/Authorized domains/)
    })

    it('tells the doctor to allow popups when the browser blocked one', () => {
      expect(signInErrorMessage('auth/popup-blocked')).toMatch(/popup/i)
    })

    it('blames the connection when the request never landed', () => {
      expect(signInErrorMessage('auth/network-request-failed')).toMatch(/connection/i)
    })

    it('points at the sign-in method setting when Google is not enabled', () => {
      expect(signInErrorMessage('auth/operation-not-allowed')).toMatch(/Sign-in method/)
    })

    it('says to wait rather than retry when rate limited', () => {
      expect(signInErrorMessage('auth/too-many-requests')).toMatch(/Wait/i)
    })
  })

  describe('anything unrecognised', () => {
    it('carries the raw code through instead of swallowing it', () => {
      // The difference between a support thread and a search that finds the
      // answer. Every code Firebase adds later lands here.
      expect(signInErrorMessage('auth/some-future-code')).toContain('auth/some-future-code')
    })

    it('still says something when there is no code at all', () => {
      expect(signInErrorMessage(undefined)).toBe('Sign-in failed. Please try again.')
      expect(signInErrorMessage('')).toBe('Sign-in failed. Please try again.')
    })
  })

  it('never returns an empty string, which would clear the error silently', () => {
    for (const code of ['auth/unauthorized-domain', 'auth/popup-blocked', 'auth/x', undefined]) {
      const msg = signInErrorMessage(code)
      if (msg !== null) expect(msg.length).toBeGreaterThan(10)
    }
  })
})
