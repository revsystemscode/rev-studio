import { watch, type FSWatcher } from 'node:fs'
import type { CoreEvent } from '@rev/protocol'

const IGNORED = new Set(['.git', 'node_modules'])
const DEBOUNCE_MS = 200

/** Vigila las carpetas de los proyectos abiertos y avisa, agrupando ráfagas, de qué carpeta cambió. */
export class ProjectWatcher {
  private readonly watchers = new Map<string, { watcher: FSWatcher; timers: Map<string, NodeJS.Timeout> }>()

  constructor(private readonly emit: (event: CoreEvent) => void) {}

  watch(projectId: string, root: string): void {
    if (this.watchers.has(projectId)) return
    const timers = new Map<string, NodeJS.Timeout>()
    let watcher: FSWatcher
    try {
      watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const segments = filename.split(/[\\/]/)
        if (segments.some((s) => IGNORED.has(s))) return
        const dir = segments.slice(0, -1).join('/')
        if (timers.has(dir)) return
        timers.set(
          dir,
          setTimeout(() => {
            timers.delete(dir)
            this.emit({ type: 'tree.changed', projectId, dir })
          }, DEBOUNCE_MS),
        )
      })
    } catch {
      // La carpeta no existe o no se puede vigilar: el árbol simplemente no se actualizará solo.
      return
    }
    // Si la carpeta desaparece el watcher falla; no debe tumbar el proceso.
    watcher.on('error', () => this.close(projectId))
    this.watchers.set(projectId, { watcher, timers })
  }

  close(projectId: string): void {
    const entry = this.watchers.get(projectId)
    if (!entry) return
    this.watchers.delete(projectId)
    for (const t of entry.timers.values()) clearTimeout(t)
    entry.watcher.close()
  }

  closeAll(): void {
    for (const id of [...this.watchers.keys()]) this.close(id)
  }
}
