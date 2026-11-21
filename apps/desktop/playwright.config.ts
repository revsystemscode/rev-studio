import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Cada prueba abre su propia app con su propia carpeta de datos.
  workers: 1,
  reporter: [['list']],
})
