import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { StepEvent } from '@rev/core'
import { launchApp, say, toolCall, type Launched } from './fixtures'

let launched: Launched | undefined
test.afterEach(async () => {
  const errors = launched?.pageErrors ?? []
  await launched?.cleanup()
  expect(errors, 'errores sin capturar en el renderer').toEqual([])
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
  await expect(card).toContainText('permitirá al agente editar archivos de este proyecto sin preguntar')
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

/** Hace el flujo de edición aprobada y devuelve la página con el turno terminado. */
async function approvedEdit(): Promise<Page> {
  const page = await startTurn([readAuth, editAuth, say('Listo')])
  await approvalCard(page).getByRole('button', { name: 'Permitir', exact: true }).click()
  await expect(page.getByText('Listo', { exact: true })).toBeVisible()
  return page
}
const filesPanel = (page: Page) => page.getByRole('region', { name: 'Archivos del proyecto' })

test('el árbol muestra src/auth.ts con marca M y la pestaña dice Cambios (1)', async () => {
  const page = await approvedEdit()
  const panel = filesPanel(page)
  await expect(panel.getByRole('tab', { name: 'Cambios (1)' })).toBeVisible()
  await panel.getByRole('treeitem', { name: /^src/ }).click()
  const file = panel.getByRole('treeitem', { name: /auth\.ts/ })
  await expect(file).toBeVisible()
  await expect(file.getByLabel('Modificado en esta sesión')).toHaveText('M')
  await expect(panel.getByRole('treeitem', { name: /README\.md/ }).getByLabel('Modificado en esta sesión')).toHaveCount(0)
})

test('seleccionar el cambio muestra el diff con false a la izquierda y true a la derecha', async () => {
  const page = await approvedEdit()
  const panel = filesPanel(page)
  await panel.getByRole('tab', { name: 'Cambios (1)' }).click()
  await panel.getByRole('button', { name: 'src/auth.ts', exact: true }).click()
  const diff = panel.getByTestId('diff-editor')
  await expect(diff.locator('.editor.original .view-lines')).toContainText(/ok\s=\sfalse/)
  await expect(diff.locator('.editor.modified .view-lines')).toContainText(/ok\s=\strue/)
  // Pasar del diff a un archivo desmonta el editor de diff sin errores.
  await panel.getByRole('tab', { name: 'Archivos' }).click()
  await panel.getByRole('treeitem', { name: /README\.md/ }).click()
  await expect(panel.getByTestId('file-editor').locator('.view-lines')).toContainText('# mi-web')
})

test('Revertir restaura el archivo en disco y deja Cambios (0)', async () => {
  const page = await approvedEdit()
  const panel = filesPanel(page)
  await panel.getByRole('tab', { name: 'Cambios (1)' }).click()
  await panel.getByRole('button', { name: 'Revertir src/auth.ts' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revertir' }).click()
  await expect(panel.getByRole('tab', { name: 'Cambios (0)' })).toBeVisible()
  expect(authOnDisk()).toBe('export const ok = false\n')
})

test('abrir un archivo, editarlo y guardar con Ctrl/Cmd+S lo escribe en disco', async () => {
  launched = await launchApp()
  const { page } = launched
  await page.getByRole('button', { name: '+ Proyecto' }).click()
  await page.getByRole('button', { name: 'Nueva sesión en mi-web' }).click()
  const panel = filesPanel(page)
  await panel.getByRole('treeitem', { name: /README\.md/ }).click()
  const editor = panel.getByTestId('file-editor')
  await expect(editor.locator('.view-lines')).toContainText('# mi-web')
  await editor.locator('.view-lines').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('Hola desde Rev Studio')
  await expect(panel.getByText('Sin guardar')).toBeVisible()
  // Cerrar con cambios sin guardar pide confirmación; seguir editando no pierde nada.
  await panel.getByRole('button', { name: 'Cerrar el editor' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Seguir editando' }).click()
  await expect(panel.getByText('Sin guardar')).toBeVisible()
  await editor.locator('.view-lines').click()
  await page.keyboard.press('ControlOrMeta+s')
  await expect(panel.getByText('Sin guardar')).toBeHidden()
  expect(readFileSync(join(launched.projectDir, 'README.md'), 'utf8')).toBe('# mi-web\nHola desde Rev Studio')
})

test('el texto sin guardar sobrevive a abrir Ajustes y volver', async () => {
  launched = await launchApp()
  const { page } = launched
  await page.getByRole('button', { name: '+ Proyecto' }).click()
  await page.getByRole('button', { name: 'Nueva sesión en mi-web' }).click()
  const panel = filesPanel(page)
  await panel.getByRole('treeitem', { name: /README\.md/ }).click()
  const editor = panel.getByTestId('file-editor')
  await editor.locator('.view-lines').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('borrador importante')
  await page.getByRole('button', { name: 'Ajustes' }).click()
  await page.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect(filesPanel(page).getByText('Sin guardar')).toBeVisible()
  await expect(filesPanel(page).getByTestId('file-editor').locator('.view-lines')).toContainText('borrador importante')
  expect(readFileSync(join(launched.projectDir, 'README.md'), 'utf8')).toBe('# mi-web\n')
  // Se guarda para que cerrar la app al terminar no pida confirmación.
  await filesPanel(page).getByRole('button', { name: 'Guardar' }).click()
  await expect(filesPanel(page).getByText('Sin guardar')).toBeHidden()
})

test('cerrar la app mata los comandos que el agente tenía en marcha', async () => {
  const long = "node -e \"require('fs').writeFileSync('pid.txt', String(process.pid)); setInterval(() => {}, 1000)\""
  const page = await startTurn([toolCall('run_command', { command: long }, 'c1')], 'arranca el servidor')
  await approvalCard(page).getByRole('button', { name: 'Permitir', exact: true }).click()
  const pidFile = join(launched!.projectDir, 'pid.txt')
  await expect.poll(() => existsSync(pidFile), { timeout: 15_000 }).toBe(true)
  const pid = Number(readFileSync(pidFile, 'utf8'))
  const alive = () => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  expect(alive()).toBe(true)
  await launched!.app.close()
  await expect.poll(alive, { timeout: 10_000 }).toBe(false)
})
