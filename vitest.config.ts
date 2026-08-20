import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Unit tests only, and deliberately only over the PURE modules — entitlement,
// sweep decisions, event routing. Anything that needs Firestore or Stripe is
// covered by the Playwright suite against a real preview deployment instead of
// by a pile of mocks that would only ever prove the mocks work.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
})
