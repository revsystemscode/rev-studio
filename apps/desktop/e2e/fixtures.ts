import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import type { StepEvent } from '@rev/core'

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')

export const finish: StepEvent = { type: 'finish', inputTokens: 1200, outputTokens: 80 }
export const say = (text: string): StepEvent[] => [{ type: 'text', delta: text }, finish]
export const toolCall = (name: string, input: unknown, callId: string): StepEvent[] => [
  { type: 'tool-call', callId, name, input },
  finish,
]

export interface Launched {
  app: ElectronApplication
  page: Page
  /** Proyecto de ejemplo con `src/auth.ts`. */
  projectDir: string
  userData: string
  /** Errores sin capturar del renderer; las pruebas comprueban que quede vacío. */
  pageErrors: string[]
  cleanup(): Promise<void>
}

export async function launchApp(
  opts: { script?: StepEvent[][]; prepare?(userData: string): void; expectWindow?: boolean } = {},
): Promise<Launched> {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'rev-e2e-')))
  const userData = join(base, 'datos')
  const projectDir = join(base, 'mi-web')
  mkdirSync(join(projectDir, 'src'), { recursive: true })
  mkdirSync(userData)
  writeFileSync(join(projectDir, 'src/auth.ts'), 'export const ok = false\n')
  writeFileSync(join(projectDir, 'README.md'), '# mi-web\n')
  const scriptPath = join(base, 'guion.json')
  writeFileSync(scriptPath, JSON.stringify(opts.script ?? []))
  opts.prepare?.(userData)

  const app = await _electron.launch({
    args: ['.'],
    cwd: appDir,
    env: {
      ...(process.env as Record<string, string>),
      REV_STUDIO_E2E: '1',
      REV_STUDIO_USER_DATA: userData,
      REV_STUDIO_PICK_FOLDER: projectDir,
      REV_STUDIO_FAKE_SCRIPT: scriptPath,
    },
  })
  const cleanup = async () => {
    await app.close().catch(() => {})
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
  const pageErrors: string[] = []
  if (opts.expectWindow === false) return { app, page: undefined as never, projectDir, userData, pageErrors, cleanup }
  try {
    const page = await app.firstWindow()
    page.on('pageerror', (e) => pageErrors.push(e.message))
    return { app, page, projectDir, userData, pageErrors, cleanup }
  } catch (e) {
    await cleanup()
    throw e
  }
}
