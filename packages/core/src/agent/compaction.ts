import type { CoreEvent } from '@rev/protocol'
import type { messagesRepo } from '../db/repos/messages'
import type { ChatMessage, ModelClient } from '../providers/types'
import { buildModelMessages } from './history'

export const COMPACT_THRESHOLD = 0.8
export const KEEP_TURNS = 2

const SUMMARIZER_SYSTEM = 'You compress conversations between a user and a coding agent so the agent can keep working with less context.'

const SUMMARY_REQUEST = `Summarize the conversation above so the work can continue without it. Include:
- the user's goal and any constraints or preferences they stated
- decisions made and why
- files read, created or modified, with what changed in each
- commands run and their relevant results
- what is still pending or was in progress

Be specific (file paths, function names, exact error messages). Do not call tools. Reply with the summary only.`

export function shouldCompact(usedTokens: number, contextWindow: number | null): boolean {
  return contextWindow !== null && usedTokens > contextWindow * COMPACT_THRESHOLD
}

export interface CompactDeps {
  sessionId: string
  root: string
  model: ModelClient
  messages: ReturnType<typeof messagesRepo>
  signal: AbortSignal
  emit?(event: CoreEvent): void
}

/**
 * Sustituye, para el modelo, los turnos antiguos por un resumen y conserva íntegros los últimos KEEP_TURNS.
 * Devuelve false si no había nada que compactar o si no se pudo resumir; en ese caso no cambia nada.
 */
export async function compact(deps: CompactDeps): Promise<boolean> {
  const stored = deps.messages.list(deps.sessionId)
  const covered = stored.findLast((m) => m.role === 'summary')?.coversUpToSeq ?? 0
  // Un turno empieza en cada mensaje del usuario; nunca se corta a mitad de uno.
  const turnStarts = stored.filter((m) => m.role === 'user' && m.seq > covered)
  if (turnStarts.length <= KEEP_TURNS) return false
  const cut = turnStarts[turnStarts.length - KEEP_TURNS]!.seq - 1

  const old = buildModelMessages(stored.filter((m) => m.seq <= cut), deps.root).slice(1)
  const request: ChatMessage[] = [
    { role: 'system', parts: [{ type: 'text', text: SUMMARIZER_SYSTEM }] },
    ...old,
    { role: 'user', parts: [{ type: 'text', text: SUMMARY_REQUEST }] },
  ]

  let text = ''
  try {
    for await (const event of deps.model.streamStep({ messages: request, tools: [], signal: deps.signal })) {
      if (event.type === 'text') text += event.delta
    }
  } catch {
    return false
  }
  if (deps.signal.aborted || !text.trim()) return false

  const message = deps.messages.append(deps.sessionId, 'summary', [{ type: 'text', text: text.trim() }], cut)
  deps.emit?.({ type: 'message.added', sessionId: deps.sessionId, message })
  return true
}
