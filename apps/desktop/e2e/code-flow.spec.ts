import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { StepEvent } from '@rev/core'
import { launchApp, say, toolCall, type Launched } from './fixtures'

let launched: Launched | undefined
test.afterEach(async () => {
  await launched?.cleanup()
  launched = undefined
})

const readAuth = toolCall('read_file', { path: 'src/auth.ts' }, 'c1')
const editAuth = toolCall('edit_file', { path: 'src/auth.ts', oldText: 'false', newText: 'true' }, 'c2')
const authOnDisk = () => readFileSync(join(launched!.projectDir, 'src/auth.ts'), 'utf8')

/** Abre la app con el guion, añade el proyecto, crea una sesión y envía un mensaje. */
async function startTurn(script: StepEvent[][], text = 'arregla el flag'): Promise<Page> {
  launched = await launchApp({ script })
  const { page } = launched
  await page.getByRole('button', { name: '+ Proyecto' }).click()
  await page.getByRole('button', { name: 'Nueva sesión en mi-web' }).click()
  const composer = page.getByRole('textbox', { name: 'Mensaje' })
  await composer.fill(text)
  await composer.press('Enter')
  return page
}

const approvalCard = (page: Page) => page.getByRole('region', { name: 'Aprobación pendiente' })

test('flujo completo de edición con aprobación', async () => {
  const page = await startTurn([readAuth, editAuth, say('Listo')])
  await expect(page.getByText('arregla el flag', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /read_file\s+src\/auth\.ts/ })).toBeVisible()

  const card = approvalCard(page)
  await expect(card).toBeVisible()
  await expect(card.locator('[data-diff="del"]')).toHaveText('export const ok = false')
  await expect(card.locator('[data-diff="add"]')).toHaveText('export const ok = true')
  expect(authOnDisk()).toBe('export const ok = false\n')

  await card.getByRole('button', { name: 'Permitir', exact: true }).click()
  await expect(page.getByText('Listo', { exact: true })).toBeVisible()
  await expect(card).toBeHidden()
  expect(authOnDisk()).toBe('export const ok = true\n')
  // El título de la sesión pasa a ser el primer mensaje.
  await expect(page.getByRole('navigation', { name: 'Proyectos' }).getByRole('button', { name: 'arregla el flag' })).toBeVisible()
  await expect(page.getByTestId('context-meter')).toHaveText(/contexto \d+ %/)
})

test('Denegar deja el archivo intacto y el turno continúa', async () => {
  const page = await startTurn([editAuth, say('Vale, lo dejo como está.')])
  const card = approvalCard(page)
  await card.getByRole('button', { name: 'Denegar' }).click()
  await expect(page.getByText('Vale, lo dejo como está.')).toBeVisible()
  await expect(card).toBeHidden()
  expect(authOnDisk()).toBe('export const ok = false\n')
  const line = page.getByRole('button', { name: /edit_file\s+src\/auth\.ts/ })
  await line.click()
  // Desplegada, la salida de la llamada muestra el motivo completo.
  await expect(page.locator('pre', { hasText: 'El usuario rechazó esta acción.' })).toBeVisible()
})

test('Detener durante la aprobación deja el turno interrumpido y muestra Reintentar', async () => {
  const page = await startTurn([editAuth])
  await expect(approvalCard(page)).toBeVisible()
  await page.getByRole('button', { name: 'Detener' }).click()
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(approvalCard(page)).toBeHidden()
  await expect(page.getByRole('button', { name: 'Detener' })).toBeHidden()
  expect(authOnDisk()).toBe('export const ok = false\n')
})
