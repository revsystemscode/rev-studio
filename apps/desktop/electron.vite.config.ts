import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

// Los paquetes del monorepo y zod se empaquetan dentro del bundle; el resto queda externo.
const bundled = ['@rev/core', '@rev/protocol', 'zod']

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: bundled },
      rollupOptions: { input: { index: 'src/main/index.ts', 'core-entry': 'src/core-entry.ts' } },
    },
  },
  preload: {
    build: {
      // Un preload con sandbox debe ser CommonJS.
      rollupOptions: { input: { index: 'src/preload/index.ts' }, output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: 'src/renderer/index.html' } },
    plugins: [react()],
  },
})
