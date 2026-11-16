import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, type Launched } from './fixtures'

let launched: Launched | undefined
test.afterEach(async () => {
  await launched?.cleanup()
  launched = undefined
})

test('la ventana abre y el renderer habla con el core', async () => {
  launched = await launchApp()
  await expect(launched.page.getByTestId('core-status')).toHaveText('conectado')
  await expect(launched.page).toHaveTitle('Rev Studio')
})

test('el renderer no tiene acceso a Node', async () => {
  launched = await launchApp()
  const access = await launched.page.evaluate(() => ({
    require: typeof (globalThis as any).require,
    process: typeof (globalThis as any).process,
    bridge: Object.keys((globalThis as any).rev).sort(),
  }))
  expect(access.require).toBe('undefined')
  expect(access.process).toBe('undefined')
  expect(access.bridge).toEqual(['encryptSecret', 'getAppInfo', 'openExternal', 'pickFolder', 'requestCorePort'])
})

test('si el core muere, se reinicia y el renderer vuelve a conectar', async () => {
  launched = await launchApp()
  const { app, page } = launched
  await expect(page.getByTestId('core-status')).toHaveText('conectado')
  const pids = await app.evaluate(({ app }) => app.getAppMetrics().filter((m) => m.type === 'Utility' && m.name === 'rev-core').map((m) => m.pid))
  expect(pids).toHaveLength(1)
  process.kill(pids[0]!, 'SIGKILL')
  await expect(page.getByTestId('core-connections')).toHaveText('2')
  await expect(page.getByTestId('core-status')).toHaveText('conectado')
})

test('con una base de datos corrupta la app avisa y termina sin abrir la ventana principal', async () => {
  launched = await launchApp({ expectWindow: false, prepare: (userData) => writeFileSync(join(userData, 'rev-studio.db'), 'esto no es sqlite, es basura '.repeat(200)) })
  const { app } = launched
  const code = await new Promise<number | null>((resolve) => {
    const proc = app.process()
    if (proc.exitCode !== null) resolve(proc.exitCode)
    else proc.once('exit', (c) => resolve(c))
  })
  expect(code).toBe(1)
  expect(app.windows()).toHaveLength(0)
})

test('añadir proyecto y crear sesión aparecen en la barra lateral', async () => {
  launched = await launchApp()
  const { page } = launched
  await page.getByRole('button', { name: '+ Proyecto' }).click()
  const sidebar = page.getByRole('navigation', { name: 'Proyectos' })
  await expect(sidebar.getByText('mi-web')).toBeVisible()
  await page.getByRole('button', { name: 'Nueva sesión en mi-web' }).click()
  await expect(sidebar.getByRole('button', { name: 'Nueva sesión', exact: true })).toBeVisible()
})

test('Ajustes muestra el proveedor fake como Conectado', async () => {
  launched = await launchApp()
  const { page } = launched
  await page.getByRole('button', { name: 'Ajustes' }).click()
  const row = page.getByTestId('provider-row').filter({ hasText: 'Pruebas' })
  await expect(row).toContainText('Conectado')
})
