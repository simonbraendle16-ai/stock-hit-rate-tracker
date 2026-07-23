import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      // gleicher Alias wie in tsconfig.json, damit '@/lib/…' auch im Test greift
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Nur die reine Rechenlogik — Server Actions und React-Komponenten
    // brauchen eine Laufzeitumgebung und gehören hier nicht hinein.
    include: ['lib/**/*.test.ts'],
  },
})
