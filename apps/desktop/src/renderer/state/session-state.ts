import type { ApprovalRequest, CoreEvent, SessionSnapshot, StoredMessage } from '@rev/protocol'

export interface ToolCallView {
  callId: string
  name: string
  input: unknown
  output: string | null
  isError: boolean
  running: boolean
}

/** Lo que el chat muestra de una sesión. Se construye con `fromSnapshot` y avanza con `reduceSession`. */
export interface SessionView {
  sessionId: string
  messages: StoredMessage[]
  /** Texto del paso en curso que aún no se ha guardado como mensaje. */
  streamingText: string
  toolCalls: Record<string, ToolCallView>
  approvals: ApprovalRequest[]
  usedTokens: number
  windowTokens: number | null
  /** Archivos que el agente ha tocado desde que se abrió la vista (lo usa el panel de archivos). */
  changedPaths: string[]
}

export function emptyView(sessionId: string): SessionView {
  return { sessionId, messages: [], streamingText: '', toolCalls: {}, approvals: [], usedTokens: 0, windowTokens: null, changedPaths: [] }
}

export function fromSnapshot(s: SessionSnapshot): SessionView {
  const toolCalls: Record<string, ToolCallView> = {}
  for (const message of s.messages) {
    for (const part of message.parts) {
      if (part.type === 'tool-call') {
        toolCalls[part.callId] = { callId: part.callId, name: part.name, input: part.input, output: null, isError: false, running: false }
      } else if (part.type === 'tool-result') {
        const call = toolCalls[part.callId]
        if (call) toolCalls[part.callId] = { ...call, output: part.output, isError: part.isError }
      }
    }
  }
  // Una llamada con aprobación pendiente sigue en curso aunque no tenga resultado guardado.
  for (const approval of s.pendingApprovals) {
    const call = toolCalls[approval.callId]
    if (call && call.output === null) toolCalls[approval.callId] = { ...call, running: true }
  }
  return {
    ...emptyView(s.session.id),
    messages: s.messages,
    toolCalls,
    approvals: s.pendingApprovals,
    usedTokens: s.usedTokens,
    windowTokens: s.windowTokens,
  }
}

export function reduceSession(view: SessionView, e: CoreEvent): SessionView {
  if (!('sessionId' in e) || e.sessionId !== view.sessionId) return view
  switch (e.type) {
    case 'text.delta':
      return { ...view, streamingText: view.streamingText + e.delta }
    case 'message.added': {
      if (view.messages.some((m) => m.id === e.message.id)) return view
      const messages = [...view.messages, e.message]
      return e.message.role === 'assistant' ? { ...view, messages, streamingText: '' } : { ...view, messages }
    }
    case 'tool.started':
      return {
        ...view,
        toolCalls: {
          ...view.toolCalls,
          [e.callId]: { callId: e.callId, name: e.name, input: e.input, output: null, isError: false, running: true },
        },
      }
    case 'tool.finished': {
      const call = view.toolCalls[e.callId] ?? { callId: e.callId, name: '', input: null, output: null, isError: false, running: false }
      return { ...view, toolCalls: { ...view.toolCalls, [e.callId]: { ...call, output: e.output, isError: e.isError, running: false } } }
    }
    case 'approval.requested':
      if (view.approvals.some((a) => a.id === e.approval.id)) return view
      return { ...view, approvals: [...view.approvals, e.approval] }
    case 'approval.resolved':
      return { ...view, approvals: view.approvals.filter((a) => a.id !== e.approvalId) }
    case 'context.usage':
      return { ...view, usedTokens: e.usedTokens, windowTokens: e.windowTokens }
    case 'file.changed':
      return view.changedPaths.includes(e.path) ? view : { ...view, changedPaths: [...view.changedPaths, e.path] }
    case 'turn.status': {
      if (e.status === 'running') return view
      // El turno terminó: lo que quedó a medias ya no va a completarse.
      const toolCalls = Object.fromEntries(Object.entries(view.toolCalls).map(([id, c]) => [id, c.running ? { ...c, running: false } : c]))
      return { ...view, streamingText: '', toolCalls, approvals: [] }
    }
    default:
      return view
  }
}
