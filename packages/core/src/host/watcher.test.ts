import type { FSWatcher, WatchListener } from 'node:fs'
import type { CoreEvent } from '@rev/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectWatcher, type WatchImpl } from './watcher'

/** fs.watch simulado: guarda el último oyente para disparar eventos a mano. */
function fakeWatch() {
  const created: { root: string; listener: WatchListener<string>; closed: boolean }[] = []
  const impl: WatchImpl = (root, _opts, listener) => {
    const entry = { root, listener, closed: false }
    created.push(entry)
    return { on: () => undefined, close: () => (entry.closed = true) } as unknown as FSWatcher
  }
  const fire = (filename: string | null) => created.at(-1)!.listener('rename', filename as string)
  return { impl, created, fire }
}

afterEach(() => vi.useRealTimers())

describe('ProjectWatcher', () => {
  it('agrupa eventos por carpeta e ignora node_modules y .git', () => {
    vi.useFakeTimers()
    const events: CoreEvent[] = []
    const fake = fakeWatch()
    const w = new ProjectWatcher((e) => events.push(e), fake.impl)
    w.watch('p', '/r', '')
    for (let i = 0; i < 5; i++) fake.fire(`src\\f${i}.ts`)
    fake.fire('node_modules/dep/a.js')
    fake.fire('.git/HEAD')
    vi.advanceTimersByTime(500)
    expect(events).toEqual([{ type: 'tree.changed', projectId: 'p', dir: 'src' }])
  })

  it('si el sistema pierde eventos (nombre null), reinicia la vigilancia y avisa de todas las carpetas listadas', () => {
    vi.useFakeTimers()
    const events: CoreEvent[] = []
    const fake = fakeWatch()
    const w = new ProjectWatcher((e) => events.push(e), fake.impl)
    w.watch('p', '/r', '')
    w.watch('p', '/r', 'src')
    w.watch('p', '/r', 'src/sub')
    expect(fake.created).toHaveLength(1)
    fake.fire(null)
    fake.fire(null)
    vi.advanceTimersByTime(500)
    // Un único reinicio: el vigilante anterior se cierra y se crea otro sobre la misma carpeta.
    expect(fake.created).toHaveLength(2)
    expect(fake.created[0]!.closed).toBe(true)
    expect(fake.created[1]!.root).toBe('/r')
    expect(events.map((e) => (e.type === 'tree.changed' ? e.dir : e.type)).sort()).toEqual(['', 'src', 'src/sub'])
    // El vigilante nuevo sigue funcionando.
    fake.fire('src/otro.ts')
    vi.advanceTimersByTime(500)
    expect(events.at(-1)).toEqual({ type: 'tree.changed', projectId: 'p', dir: 'src' })
  })

  it('close cierra el vigilante y cancela un reinicio pendiente', () => {
    vi.useFakeTimers()
    const events: CoreEvent[] = []
    const fake = fakeWatch()
    const w = new ProjectWatcher((e) => events.push(e), fake.impl)
    w.watch('p', '/r', '')
    fake.fire(null)
    w.close('p')
    vi.advanceTimersByTime(500)
    expect(fake.created).toHaveLength(1)
    expect(fake.created[0]!.closed).toBe(true)
    expect(events).toEqual([])
  })
})
