import type { ProviderRow } from '../db/repos/providers'
import { fakeProvider } from './fake'
import { ollamaProvider } from './ollama'
import { openAiCompatibleProvider } from './openai-compatible'
import type { Provider } from './types'

export const DEFAULT_URLS = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234/v1',
} as const

export function createProvider(
  row: ProviderRow,
  apiKey: string | null,
  fetchImpl: typeof fetch = fetch,
  opts: { fakeScriptPath?: string } = {},
): Provider {
  switch (row.type) {
    case 'ollama':
      return ollamaProvider(row, fetchImpl)
    case 'lmstudio':
    case 'openai-compatible':
      return openAiCompatibleProvider(row, apiKey, fetchImpl)
    case 'fake':
      if (!opts.fakeScriptPath) throw new Error('El proveedor de pruebas no está habilitado.')
      return fakeProvider(opts.fakeScriptPath)
  }
}
