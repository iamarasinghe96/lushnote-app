import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Separate from vitest.config.ts because these need the Firestore emulator
// running. They are started by `npm run test:rules`, which wraps them in
// `firebase emulators:exec`, so they never run by accident in the fast suite.
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, '.') } },
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    // One emulator, shared state cleared between tests — parallel files would
    // race on clearFirestore().
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
})
