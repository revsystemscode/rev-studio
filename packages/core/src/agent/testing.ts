// Utilidades de prueba para montar un SessionRunner sobre un proyecto temporal.
import type { CoreEvent } from '@rev/protocol'
import { messagesRepo } from '../db/repos/messages'
import { permissionsRepo } from '../db/repos/permissions'
import { sessionsRepo } from '../db/repos/sessions'
import { PermissionService } from '../permissions/service'
import { FakeModelClient } from '../providers/fake'
import type { ModelClient, StepEvent } from '../providers/types'
import { makeProject, type TestProject } from '../testing/project'
import { SessionRunner, type RunnerDeps } from './runner'

export const finish: StepEvent = { type: 'finish', inputTokens: 100, outputTokens: 10 }
export const say = (text: string): StepEvent[] => [{ type: 'text', delta: text }, finish]
let nextCall = 0
export const call = (name: string, input: unknown, callId = `c${++nextCall}`): StepEvent[] => [
  { type: 'tool-call', callId, name, input },
  finish,
]

export interface Harness {
  p: TestProject
  model: FakeModelClient
  runner: SessionRunner
  events: CoreEvent[]
  messages: ReturnType<typeof messagesRepo>
  sessions: ReturnType<typeof sessionsRepo>
  permissions: PermissionService
  statuses(): string[]
  /** Espera a que aparezca un evento que cumpla la condición. */
  waitFor<T extends CoreEvent['type']>(type: T, n?: number): Promise<Extract<CoreEvent, { type: T }>>
}

export function harness(
  script: StepEvent[][],
  files: Record<string, string> = {},
  overrides: Partial<RunnerDeps> & { model?: ModelClient; delayMs?: number } = {},
): Harness {
  const p = makeProject(files)
  const model = new FakeModelClient(script, overrides.delayMs)
  const events: CoreEvent[] = []
  const messages = messagesRepo(p.db)
  const sessions = sessionsRepo(p.db)
  const permissions = new PermissionService(permissionsRepo(p.db))
  const runner = new SessionRunner({
    sessionId: p.sessionId,
    projectId: p.projectId,
    root: p.root,
    rgPath: p.ctx.rgPath,
    model,
    contextWindow: 32_768,
    messages,
    sessions,
    permissions,
    snapshots: p.ctx.snapshots,
    emit: (e) => events.push(e),
    ...overrides,
  })
  return {
    p,
    model,
    runner,
    events,
    messages,
    sessions,
    permissions,
    statuses: () => events.flatMap((e) => (e.type === 'turn.status' ? [e.status] : [])),
    async waitFor(type, n = 1) {
      const deadline = Date.now() + 10_000
      for (;;) {
        const found = events.filter((e) => e.type === type)
        if (found.length >= n) return found[n - 1] as never
        if (Date.now() > deadline) throw new Error(`No llegó el evento ${type} (#${n})`)
        await new Promise((r) => setTimeout(r, 10))
      }
    },
  }
}
