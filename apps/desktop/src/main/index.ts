import { join } from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { CoreProcess } from './core-process'
import { encryptSecret } from './secrets'

const here = import.meta.dirname
const env = process.env
/** En pruebas de extremo a extremo no se muestran diálogos modales, que bloquearían la app. */
const e2e = env.REV_STUDIO_E2E === '1'

if (env.REV_STUDIO_USER_DATA) app.setPath('userData', env.REV_STUDIO_USER_DATA)
app.setName('Rev Studio')

function showError(title: string, detail: string): void {
  if (e2e) console.error(`${title}: ${detail}`)
  else dialog.showErrorBox(title, detail)
}

let quitting = false
const core = new CoreProcess({
  entry: join(here, 'core-entry.js'),
  env: {
    REV_DB_PATH: join(app.getPath('userData'), 'rev-studio.db'),
    // Dentro del .asar no se puede ejecutar un binario: electron-builder lo deja desempaquetado al lado.
    REV_RG_PATH: rgPath.replace('app.asar', 'app.asar.unpacked'),
  },
  onRestart: () => {
    for (const win of BrowserWindow.getAllWindows()) core.connect(win.webContents)
  },
  onGiveUp: () => {
    showError('Rev Studio dejó de funcionar', 'El motor interno se cerró varias veces seguidas. Reinicia la aplicación.')
  },
  onFatal: (message, backupPath) => {
    showError(
      'No se pudo abrir la base de datos',
      backupPath ? `${message}\n\nHay una copia de seguridad en:\n${backupPath}` : message,
    )
    quitting = true
    app.exit(1)
  },
})

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Rev Studio',
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // La interfaz nunca navega ni abre ventanas: los enlaces externos pasan por openExternal.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  if (env.ELECTRON_RENDERER_URL) void win.loadURL(env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(here, '../renderer/index.html'))
}

ipcMain.handle('request-core-port', (event) => core.connect(event.sender))
ipcMain.handle('pick-folder', async (event) => {
  if (env.REV_STUDIO_PICK_FOLDER) return env.REV_STUDIO_PICK_FOLDER
  const win = BrowserWindow.fromWebContents(event.sender)
  const options = { properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
})
ipcMain.handle('encrypt-secret', (_event, plain: unknown) => {
  if (typeof plain !== 'string' || plain.length === 0) throw new Error('Clave vacía.')
  return encryptSecret(plain)
})
ipcMain.handle('open-external', async (_event, url: unknown) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Solo se abren enlaces https.')
  await shell.openExternal(url)
})
ipcMain.handle('app-info', () => ({ version: app.getVersion(), platform: process.platform }))

app.on('before-quit', () => {
  quitting = true
  core.stop()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && !quitting) createWindow()
})

void app.whenReady().then(async () => {
  try {
    // La ventana solo se abre con el core listo: así nunca se ve una interfaz sin datos.
    await core.start()
  } catch {
    if (!quitting) app.exit(1)
    return
  }
  createWindow()
})
