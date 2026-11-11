import { randomUUID } from 'node:crypto'
import type { ApprovalDecision, ApprovalRequest, CoreEvent, Part, TurnStatus } from '@rev/protocol'
import { z } from 'zod'
import type { messagesRepo } from '../db/repos/messages'
import { DEFAULT_SESSION_TITLE, type sessionsRepo } from '../db/repos/sessions'
import type { PermissionService } from '../permissions/service'
import type { ModelClient } from '../providers/types'
import type { SnapshotStore } from '../snapshots/store'
import { allTools, getTool, toolSpecs } from '../tools/registry'
import { truncateOutput } from '../tools/truncate'
import { ToolError, type ToolContext } from '../tools/types'
import { buildModelMessages, INTERRUPTED_OUTPUT } from './history'

export const MAX_STEPS = 50
export const MAX_MALFORMED = 3
const TITLE_MAX = 60

const LIMIT_MESSAGE = `Se alcanzó el límite de ${MAX_STEPS} pasos. Escribe para continuar.`
const MALFORMED_MESSAGE = 'El modelo no consigue llamar a las herramientas correctamente. Prueba con otro modelo.'
const DENIED_OUTPUT = 'El usuario rechazó esta acción.'

export interface RunnerDeps {
  sessionId: string
  projectId: string
  root: string
  rgPath: string
  model: ModelClient
  contextWindow: number | null
  messages: ReturnType<typeof messagesRepo>
  sessions: ReturnType<typeof sessionsRepo>
  permissions: PermissionService
  snapshots: SnapshotStore
  emit(event: CoreEvent): void
  /** Se ejecuta antes de cada llamada al modelo; aquí se engancha la compactación. */
  beforeStep?(signal: AbortSignal): Promise<void>
}

interface ToolCall {
  callId: string
  name: string
  input: unknown
}
type ToolResult = Extract<Part, { type: 'tool-result' }>
type Outcome = { status: Exclude<TurnStatus, 'running'>; error: string | null }
type Decision = ApprovalDecision | 'stopped'

/** Ejecuta los turnos de una sesión: llama al modelo, ejecuta herramientas con permiso y guarda todo. */
export class SessionRunner {
  usedTokens = 0
  private abort: AbortController | null = null
  private readonly approvals = new Map<string, { request: ApprovalRequest; resolve(d: Decision): void }>()

  constructor(private readonly deps: RunnerDeps) {}

  get running(): boolean {
    return this.abort !== null
  }

  /** Lanza si ya hay un turno en curso. La promesa se resuelve al terminar el turno y nunca rechaza. */
  send(text: string): Promise<void> {
    this.assertIdle()
    const { sessionId, messages, sessions } = this.deps
    const message = messages.append(sessionId, 'user', [{ type: 'text', text }])
    this.deps.emit({ type: 'message.added', sessionId, message })
    if (sessions.get(sessionId)?.title === DEFAULT_SESSION_TITLE) {
      sessions.setTitle(sessionId, text.trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX) || DEFAULT_SESSION_TITLE)
    }
    return this.runTurn()
  }

  /** Reanuda desde el historial guardado, sin añadir un mensaje del usuario. */
  retry(): Promise<void> {
    this.assertIdle()
    return this.runTurn()
  }

  stop(): void {
    this.abort?.abort()
    for (const pending of this.approvals.values()) pending.resolve('stopped')
  }

  pendingApprovals(): ApprovalRequest[] {
    return [...this.approvals.values()].map((a) => a.request)
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision): void {
    this.approvals.get(approvalId)?.resolve(decision)
  }

  private assertIdle(): void {
    if (this.running) throw new Error('Ya hay un turno en curso en esta sesión.')
  }

  private setStatus(status: TurnStatus, error: string | null): void {
    this.deps.sessions.setTurnStatus(this.deps.sessionId, status, error)
    this.deps.emit({ type: 'turn.status', sessionId: this.deps.sessionId, status, error })
  }

  private async runTurn(): Promise<void> {
    const abort = new AbortController()
    this.abort = abort
    this.setStatus('running', null)
    let outcome: Outcome
    try {
      outcome = await this.loop(abort.signal)
    } catch (e) {
      outcome = abort.signal.aborted
        ? { status: 'interrupted', error: null }
        : { status: 'failed', error: e instanceof Error ? e.message : String(e) }
    }
    this.abort = null
    this.approvals.clear()
    this.setStatus(outcome.status, outcome.error)
  }

  private append(role: 'assistant' | 'tool', parts: Part[]): void {
    const message = this.deps.messages.append(this.deps.sessionId, role, parts)
    this.deps.emit({ type: 'message.added', sessionId: this.deps.sessionId, message })
  }

  private async loop(signal: AbortSignal): Promise<Outcome> {
    const { sessionId, root, model } = this.deps
    const interrupted: Outcome = { status: 'interrupted', error: null }
    let malformedStreak = 0

    for (let step = 1; step <= MAX_STEPS; step++) {
      await this.deps.beforeStep?.(signal)
      if (signal.aborted) return interrupted

      const request = buildModelMessages(this.deps.messages.list(sessionId), root)
      let text = ''
      const calls: ToolCall[] = []
      let inputTokens: number | null = null
      let outputTokens: number | null = null

      for await (const event of model.streamStep({ messages: request, tools: toolSpecs(), signal })) {
        if (event.type === 'text') {
          text += event.delta
          this.deps.emit({ type: 'text.delta', sessionId, delta: event.delta })
        } else if (event.type === 'tool-call') {
          calls.push({ callId: event.callId, name: event.name, input: event.input })
        } else {
          inputTokens = event.inputTokens
          outputTokens = event.outputTokens
        }
      }

      if (signal.aborted) {
        // Se conserva lo ya escrito, pero no llamadas que nunca se ejecutarán.
        if (text) this.append('assistant', [{ type: 'text', text }])
        return interrupted
      }

      const parts: Part[] = [...(text ? [{ type: 'text' as const, text }] : []), ...calls.map((c) => ({ type: 'tool-call' as const, ...c }))]
      this.append('assistant', parts)

      this.usedTokens =
        inputTokens !== null
          ? inputTokens + (outputTokens ?? 0)
          : Math.ceil((JSON.stringify(request).length + JSON.stringify(parts).length) / 4)
      this.deps.emit({ type: 'context.usage', sessionId, usedTokens: this.usedTokens, windowTokens: this.deps.contextWindow })

      if (calls.length === 0) return { status: 'idle', error: null }

      const results: ToolResult[] = []
      let malformed = false
      for (const call of calls) {
        if (signal.aborted) {
          results.push({ type: 'tool-result', callId: call.callId, output: INTERRUPTED_OUTPUT, isError: true })
          continue
        }
        const r = await this.execute(call, signal)
        malformed ||= r.malformed
        results.push({ type: 'tool-result', callId: call.callId, output: r.output, isError: r.isError })
      }
      this.append('tool', results)
      if (signal.aborted) return interrupted

      malformedStreak = malformed ? malformedStreak + 1 : 0
      if (malformedStreak >= MAX_MALFORMED) return { status: 'failed', error: MALFORMED_MESSAGE }
    }

    this.append('assistant', [{ type: 'text', text: LIMIT_MESSAGE }])
    return { status: 'idle', error: null }
  }

  private async execute(call: ToolCall, signal: AbortSignal): Promise<{ output: string; isError: boolean; malformed: boolean }> {
    const { sessionId } = this.deps
    this.deps.emit({ type: 'tool.started', sessionId, callId: call.callId, name: call.name, input: call.input })
    const result = await this.executeInner(call, signal)
    this.deps.emit({ type: 'tool.finished', sessionId, callId: call.callId, output: result.output, isError: result.isError })
    return result
  }

  private async executeInner(call: ToolCall, signal: AbortSignal) {
    const fail = (output: string, malformed = false) => ({ output, isError: true, malformed })

    const tool = getTool(call.name)
    if (!tool) {
      return fail(`Herramienta desconocida: "${call.name}". Disponibles: ${allTools.map((t) => t.name).join(', ')}.`, true)
    }
    const parsed = tool.schema.safeParse(call.input)
    if (!parsed.success) {
      const detail = typeof call.input === 'string' ? 'los argumentos no son JSON válido' : z.prettifyError(parsed.error)
      return fail(`Argumentos inválidos para ${call.name}: ${detail}`, true)
    }
    const input = parsed.data

    const ctx: ToolContext = {
      root: this.deps.root,
      sessionId: this.deps.sessionId,
      signal,
      rgPath: this.deps.rgPath,
      snapshots: this.deps.snapshots,
      onFileChanged: (path) => this.deps.emit({ type: 'file.changed', sessionId: this.deps.sessionId, path }),
    }

    try {
      if (this.deps.permissions.check(this.deps.projectId, tool, input) === 'ask') {
        // La vista previa valida la acción: si es imposible, no se molesta al usuario.
        const preview = await tool.preview!(input, ctx)
        const decision = await this.askApproval(call, preview)
        if (decision === 'stopped') return fail(INTERRUPTED_OUTPUT)
        if (decision === 'deny') return fail(DENIED_OUTPUT)
        if (decision === 'always') this.deps.permissions.remember(this.deps.projectId, tool, input)
      }
      const output = await tool.run(input, ctx)
      return { output: tool.truncateOutput ? truncateOutput(output) : output, isError: false, malformed: false }
    } catch (e) {
      if (e instanceof ToolError) return fail(e.message)
      return fail(`Error al ejecutar ${call.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private async askApproval(call: ToolCall, preview: ApprovalRequest['preview']): Promise<Decision> {
    const { sessionId } = this.deps
    const request: ApprovalRequest = { id: randomUUID(), sessionId, callId: call.callId, toolName: call.name, preview }
    const decision = await new Promise<Decision>((resolve) => {
      this.approvals.set(request.id, { request, resolve })
      this.deps.emit({ type: 'approval.requested', sessionId, approval: request })
    })
    this.approvals.delete(request.id)
    this.deps.emit({ type: 'approval.resolved', sessionId, approvalId: request.id })
    return decision
  }
}
