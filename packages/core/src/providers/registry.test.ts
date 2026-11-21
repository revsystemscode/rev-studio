import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProviderRow } from '../db/repos/providers'
import { createProvider, DEFAULT_URLS } from './registry'
import { collect } from './testing'

const base: ProviderRow = { id: 'p', type: 'fake', name: 'Fake', baseUrl: 'fake://', keyCipher: null, contextSize: null }

describe('createProvider', () => {
  it('el proveedor fake reproduce su guion paso a paso y luego termina con texto', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rev-fake-'))
    const scriptPath = join(dir, 'script.json')
    writeFileSync(scriptPath, JSON.stringify([[{ type: 'text', delta: 'uno' }, { type: 'finish', inputTokens: 1, outputTokens: 1 }]]))
    const p = createProvider(base, null, fetch, { fakeScriptPath: scriptPath })
    expect(await p.listModels()).toEqual(['fake-model'])
    expect(await p.getCapabilities('fake-model')).toEqual({ tools: 'yes', contextWindow: 32768 })
    expect(await p.ping()).toBe(true)
    const model = p.createModel('fake-model')
    const req = { messages: [], tools: [], signal: new AbortController().signal }
    expect((await collect(model.streamStep(req)))[0]).toEqual({ type: 'text', delta: 'uno' })
    expect((await collect(model.streamStep(req)))[0]).toEqual({ type: 'text', delta: 'fin' })
    rmSync(dir, { recursive: true, force: true })
  })

  it('un proveedor fake sin guion configurado se rechaza', () => {
    expect(() => createProvider(base, null)).toThrow()
  })

  it('las URL por defecto son las locales de Ollama y LM Studio', () => {
    expect(DEFAULT_URLS).toEqual({ ollama: 'http://localhost:11434', lmstudio: 'http://localhost:1234/v1' })
  })
})
