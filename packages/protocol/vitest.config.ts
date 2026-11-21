import { defineConfig } from 'vitest/config'

// En GitHub Actions cada fallo se publica también como anotación, legible sin iniciar sesión.
export default defineConfig({ test: { reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'] } })
