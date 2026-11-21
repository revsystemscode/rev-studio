import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src/renderer', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // En GitHub Actions cada fallo se publica también como anotación, legible sin iniciar sesión.
    reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
  },
})
