import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Same alias Nuxt provides, so app code under test resolves shared/ the same way.
    alias: { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The database tests build a migrated PGlite (with pgcrypto) once per file: seconds, more on a slow machine.
    hookTimeout: 90_000,
    testTimeout: 30_000,
  },
})
