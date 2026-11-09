import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Single-file components that import what they use (no Nuxt auto-imports) can be rendered in tests.
  plugins: [vue()],
  resolve: {
    // Same aliases Nuxt provides, so app code under test resolves shared/ and ~/ the same way.
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The database tests build a migrated PGlite (with pgcrypto) once per file: seconds, more on a slow machine.
    hookTimeout: 90_000,
    testTimeout: 30_000,
  },
})
