import { watch, type FSWatcher, type WatchListener } from 'node:fs'
import type { CoreEvent } from '@rev/protocol'

const IGNORED = new Set(['.git', 'node_modules'])
const DEBOUNCE_MS = 200

export type WatchImpl = (root: string, options: { recursive: true }, listener: WatchListener<string>) => FSWatcher

interface Entry {
  root: string
  watcher: FSWatcher
  timers: Map<string, NodeJS.Timeout>
  /** Carpetas que la interfaz ha listado: son las que hay que refrescar si se pierden eventos. */
  listed: Set<string>
  restart: NodeJS.Timeout | null
}

/** Vigila las carpetas de los proyectos abiertos y avisa, agrupando ráfagas, de qué carpeta cambió. */
export class ProjectWatcher {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly emit: (event: CoreEvent) => void,
    private readonly watchImpl: WatchImpl = watch,
  ) {}

  /** Empieza a vigilar el proyecto (si no lo hacía ya) y anota que la interfaz listó `dir`. */
  watch(projectId: string, root: string, listedDir = ''): void {
    // Los eventos llaman '' a la raíz; las peticiones pueden usar '.'.
    const dir = listedDir === '.' ? '' : listedDir.replace(/[\\/]+$/, '')
    const existing = this.entries.get(projectId)
    if (existing) {
      existing.listed.add(dir)
      return
    }
    const entry: Entry = { root, watcher: null as unknown as FSWatcher, timers: new Map(), listed: new Set([dir]), restart: null }
    const watcher = this.start(projectId, entry)
    if (!watcher) return
    entry.watcher = watcher
    this.entries.set(projectId, entry)
  }

  close(projectId: string): void {
    const entry = this.entries.get(projectId)
    if (!entry) return
    this.entries.delete(projectId)
    for (const t of entry.timers.values()) clearTimeout(t)
    if (entry.restart) clearTimeout(entry.restart)
    entry.watcher.close()
  }

  closeAll(): void {
    for (const id of [...this.entries.keys()]) this.close(id)
  }

  private start(projectId: string, entry: Entry): FSWatcher | null {
    let watcher: FSWatcher
    try {
      watcher = this.watchImpl(entry.root, { recursive: true }, (_event, filename) => {
        if (!filename) {
          // Sin nombre: el sistema perdió eventos (en Windows, al desbordarse el búfer en una ráfaga,
          // y después deja de avisar). Se reinicia la vigilancia y se refresca todo lo listado.
          this.scheduleRestart(projectId, entry)
          return
        }
        const segments = filename.split(/[\\/]/)
        if (segments.some((s) => IGNORED.has(s))) return
        this.changed(projectId, entry, segments.slice(0, -1).join('/'))
      })
    } catch {
      // La carpeta no existe o no se puede vigilar: el árbol simplemente no se actualizará solo.
      return null
    }
    // Si la carpeta desaparece el watcher falla; no debe tumbar el proceso.
    watcher.on('error', () => this.close(projectId))
    return watcher
  }

  private changed(projectId: string, entry: Entry, dir: string): void {
    if (entry.timers.has(dir)) return
    entry.timers.set(
      dir,
      setTimeout(() => {
        entry.timers.delete(dir)
        this.emit({ type: 'tree.changed', projectId, dir })
      }, DEBOUNCE_MS),
    )
  }

  private scheduleRestart(projectId: string, entry: Entry): void {
    if (entry.restart) return
    // Se espera a que pase la ráfaga antes de volver a vigilar.
    entry.restart = setTimeout(() => {
      entry.restart = null
      if (this.entries.get(projectId) !== entry) return
      entry.watcher.close()
      const watcher = this.start(projectId, entry)
      if (!watcher) {
        this.entries.delete(projectId)
        return
      }
      entry.watcher = watcher
      for (const dir of entry.listed) this.changed(projectId, entry, dir)
    }, DEBOUNCE_MS)
  }
}
