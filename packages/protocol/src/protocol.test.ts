import { describe, expect, it } from 'vitest'
import { CoreEventSchema, methods, RequestSchema, ResponseSchema } from './index'

describe('protocol', () => {
  it('acepta una petición válida de turn.send', () => {
    expect(methods['turn.send'].params.safeParse({ sessionId: 's1', text: 'hola' }).success).toBe(true)
  })
  it('rechaza turn.send sin texto', () => {
    expect(methods['turn.send'].params.safeParse({ sessionId: 's1' }).success).toBe(false)
  })
  it('rechaza un evento con tipo desconocido', () => {
    expect(CoreEventSchema.safeParse({ type: 'nope' }).success).toBe(false)
  })
  it('acepta un evento text.delta válido', () => {
    expect(CoreEventSchema.safeParse({ type: 'text.delta', sessionId: 's', delta: 'x' }).success).toBe(true)
  })
  it('rechaza una decisión de aprobación inválida', () => {
    expect(methods['approval.resolve'].params.safeParse({ approvalId: 'a', decision: 'maybe' }).success).toBe(false)
  })
  it('toda entrada de methods tiene params y result', () => {
    for (const m of Object.values(methods)) {
      expect(m.params).toBeDefined()
      expect(m.result).toBeDefined()
    }
  })
  it('valida sobres de petición y de respuesta con error', () => {
    expect(RequestSchema.safeParse({ id: 1, method: 'projects.list', params: {} }).success).toBe(true)
    expect(ResponseSchema.safeParse({ id: 1, error: { code: 'not_found', message: 'x' } }).success).toBe(true)
    expect(ResponseSchema.safeParse({ id: 1, error: { code: 'weird', message: 'x' } }).success).toBe(false)
  })
})

describe('isChained', () => {
  it('detecta encadenado, redirección y sustitución; un comando simple no lo es', async () => {
    const { isChained } = await import('./index')
    for (const c of ['a && b', 'a | b', 'a; b', 'a > f', 'echo `x`', 'echo $(x)', 'echo ${x}', 'a\nb']) expect(isChained(c)).toBe(true)
    for (const c of ['npm test', 'git status --short', 'node -e "1+1"']) expect(isChained(c)).toBe(false)
  })
})
