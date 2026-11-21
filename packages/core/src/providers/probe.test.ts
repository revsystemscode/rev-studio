import { describe, expect, it } from 'vitest'
import { FakeModelClient } from './fake'
import { probeTools } from './probe'
import { ProviderHttpError, ProviderUnreachableError, type ModelClient } from './types'

const failing = (error: Error): ModelClient => ({
  // eslint-disable-next-line require-yield
  async *streamStep() {
    throw error
  },
})

describe('probeTools', () => {
  it('yes si el modelo llama a ping', async () => {
    const client = new FakeModelClient([[{ type: 'tool-call', callId: '1', name: 'ping', input: {} }, { type: 'finish', inputTokens: 1, outputTokens: 1 }]])
    expect(await probeTools(client)).toBe('yes')
    expect(client.toolRequests[0]!.map((t) => t.name)).toEqual(['ping'])
  })
  it('no si responde solo texto', async () => {
    expect(await probeTools(new FakeModelClient([[{ type: 'text', delta: 'pong' }, { type: 'finish', inputTokens: 1, outputTokens: 1 }]]))).toBe('no')
  })
  it('no si el proveedor responde con error 4xx', async () => {
    expect(await probeTools(failing(new ProviderHttpError(400, 'tools not supported')))).toBe('no')
  })
  it('propaga los fallos de conexión', async () => {
    await expect(probeTools(failing(new ProviderUnreachableError('x')))).rejects.toBeInstanceOf(ProviderUnreachableError)
  })
})
