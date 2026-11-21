import type { ApprovalRequest, CoreEvent, Part, SessionSnapshot, StoredMessage } from '@rev/protocol'
import { describe, expect, it } from 'vitest'
import { emptyView, fromSnapshot, reduceSession, type SessionView } from './session-state'

const S = 's1'
let seq = 0
const msg = (role: StoredMessage['role'], parts: Part[], sessionId = S): StoredMessage => ({
  id: `m${++seq}`,
  sessionId,
  seq,
  role,
  parts,
  coversUpToSeq: null,
  createdAt: seq,
})
const approval = (id: string): ApprovalRequest => ({
  id,
  sessionId: S,
  callId: 'c1',
  toolName: 'edit_file',
  preview: { kind: 'diff', path: 'a.ts', original: 'a', proposed: 'b' },
})
const apply = (view: SessionView, ...events: CoreEvent[]) => events.reduce(reduceSession, view)

describe('session-state', () => {
  it('text.delta acumula y message.added de assistant vacía streamingText', () => {
    let view = apply(emptyView(S), { type: 'text.delta', sessionId: S, delta: 'Hola, ' }, { type: 'text.delta', sessionId: S, delta: 'mundo' })
    expect(view.streamingText).toBe('Hola, mundo')
    const user = msg('user', [{ type: 'text', text: 'hola' }])
    view = apply(view, { type: 'message.added', sessionId: S, message: user })
    expect(view.streamingText).toBe('Hola, mundo')
    const done = msg('assistant', [{ type: 'text', text: 'Hola, mundo' }])
    view = apply(view, { type: 'message.added', sessionId: S, message: done })
    expect(view.streamingText).toBe('')
    expect(view.messages).toEqual([user, done])
  })

  it('message.added ignora un mensaje que ya está en la vista', () => {
    const m = msg('user', [{ type: 'text', text: 'hola' }])
    const view = apply(emptyView(S), { type: 'message.added', sessionId: S, message: m }, { type: 'message.added', sessionId: S, message: m })
    expect(view.messages).toEqual([m])
  })

  it('tool.started crea la llamada en running; tool.finished guarda salida y error', () => {
    let view = apply(emptyView(S), { type: 'tool.started', sessionId: S, callId: 'c1', name: 'read_file', input: { path: 'a.ts' } })
    expect(view.toolCalls.c1).toEqual({ callId: 'c1', name: 'read_file', input: { path: 'a.ts' }, output: null, isError: false, running: true })
    view = apply(view, { type: 'tool.finished', sessionId: S, callId: 'c1', output: 'No existe', isError: true })
    expect(view.toolCalls.c1).toEqual({ callId: 'c1', name: 'read_file', input: { path: 'a.ts' }, output: 'No existe', isError: true, running: false })
  })

  it('approval.requested añade y approval.resolved quita', () => {
    let view = apply(emptyView(S), { type: 'approval.requested', sessionId: S, approval: approval('a1') }, { type: 'approval.requested', sessionId: S, approval: approval('a2') })
    expect(view.approvals.map((a) => a.id)).toEqual(['a1', 'a2'])
    view = apply(view, { type: 'approval.resolved', sessionId: S, approvalId: 'a1' })
    expect(view.approvals.map((a) => a.id)).toEqual(['a2'])
  })

  it('context.usage actualiza los tokens', () => {
    const view = apply(emptyView(S), { type: 'context.usage', sessionId: S, usedTokens: 1200, windowTokens: 32768 })
    expect([view.usedTokens, view.windowTokens]).toEqual([1200, 32768])
  })

  it('file.changed añade la ruta una sola vez', () => {
    const view = apply(
      emptyView(S),
      { type: 'file.changed', sessionId: S, path: 'src/a.ts' },
      { type: 'file.changed', sessionId: S, path: 'src/b.ts' },
      { type: 'file.changed', sessionId: S, path: 'src/a.ts' },
    )
    expect(view.changedPaths).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('turn.status fuera de running descarta el texto a medias y las llamadas en curso', () => {
    const view = apply(
      emptyView(S),
      { type: 'text.delta', sessionId: S, delta: 'a medias' },
      { type: 'tool.started', sessionId: S, callId: 'c1', name: 'run_command', input: { command: 'ls' } },
      { type: 'turn.status', sessionId: S, status: 'failed', error: 'Sin conexión' },
    )
    expect(view.streamingText).toBe('')
    expect(view.toolCalls.c1).toMatchObject({ running: false })
  })

  it('fromSnapshot reconstruye toolCalls a partir de tool-call y tool-result guardados', () => {
    const snapshot: SessionSnapshot = {
      session: {
        id: S,
        projectId: 'p',
        title: 't',
        providerId: 'x',
        model: 'm',
        turnStatus: 'idle',
        turnError: null,
        createdAt: 1,
        updatedAt: 1,
      },
      messages: [
        msg('user', [{ type: 'text', text: 'lee' }]),
        msg('assistant', [
          { type: 'text', text: 'Voy' },
          { type: 'tool-call', callId: 'c1', name: 'read_file', input: { path: 'a.ts' } },
          { type: 'tool-call', callId: 'c2', name: 'search', input: { query: 'ok' } },
        ]),
        msg('tool', [
          { type: 'tool-result', callId: 'c1', output: 'contenido', isError: false },
          { type: 'tool-result', callId: 'c2', output: 'falló', isError: true },
        ]),
        msg('assistant', [{ type: 'tool-call', callId: 'c3', name: 'edit_file', input: { path: 'a.ts' } }]),
      ],
      pendingApprovals: [approval('a1')],
      usedTokens: 500,
      windowTokens: 8000,
    }
    const view = fromSnapshot(snapshot)
    expect(view.toolCalls).toEqual({
      c1: { callId: 'c1', name: 'read_file', input: { path: 'a.ts' }, output: 'contenido', isError: false, running: false },
      c2: { callId: 'c2', name: 'search', input: { query: 'ok' }, output: 'falló', isError: true, running: false },
      // Sin resultado guardado: en curso solo si hay una aprobación esperándola.
      c3: { callId: 'c3', name: 'edit_file', input: { path: 'a.ts' }, output: null, isError: false, running: false },
    })
    expect(view).toMatchObject({ sessionId: S, streamingText: '', approvals: [approval('a1')], usedTokens: 500, windowTokens: 8000, changedPaths: [] })
    expect(view.messages).toHaveLength(4)
  })

  it('eventos de otra sesión no cambian la vista', () => {
    const view = emptyView(S)
    const other = 'otra'
    const after = apply(
      view,
      { type: 'text.delta', sessionId: other, delta: 'x' },
      { type: 'file.changed', sessionId: other, path: 'a' },
      { type: 'message.added', sessionId: other, message: msg('user', [], other) },
      { type: 'tree.changed', projectId: 'p', dir: '.' },
    )
    expect(after).toBe(view)
  })
})
