import { contextBridge, ipcRenderer } from 'electron'

// Un MessagePort no puede cruzar contextBridge: se entrega a la página con window.postMessage.
ipcRenderer.on('core-port', (event) => {
  window.postMessage('rev-core-port', '*', event.ports)
})

const bridge = {
  /** Pide un canal con el core; llega como mensaje 'rev-core-port' con el puerto adjunto. */
  requestCorePort: (): Promise<void> => ipcRenderer.invoke('request-core-port'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  encryptSecret: (plain: string): Promise<string> => ipcRenderer.invoke('encrypt-secret', plain),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  getAppInfo: (): Promise<{ version: string; platform: string }> => ipcRenderer.invoke('app-info'),
  /** Versión publicada más nueva que la instalada, o null. */
  checkForUpdate: (): Promise<{ version: string; url: string } | null> => ipcRenderer.invoke('check-for-update'),
}

export type RevBridge = typeof bridge

contextBridge.exposeInMainWorld('rev', bridge)
