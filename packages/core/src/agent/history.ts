import type { Part, StoredMessage } from '@rev/protocol'
import type { ChatMessage } from '../providers/types'

export const SYSTEM_PROMPT = `You are Rev Studio, a coding agent working inside the user's project folder.

How to work:
- Explore before changing anything: use search and find_files to locate code, and read_file to read it. Never guess file contents.
- All file paths are relative to the project root. You cannot access files outside it.
- To change an existing file use edit_file with an exact, unique oldText copied from the file. Use write_file only for new files or full rewrites.
- Use run_command for builds, tests and other non-interactive commands. Commands run from the project root and have a time limit.
- Edits and commands may need the user's approval. If the user rejects an action, do not retry the same action; ask what they prefer or take a different approach.
- If a tool returns an error, read it and correct your call instead of repeating it.
- Keep working until the request is done, then give a short summary of what you changed.

Reply in the language the user writes in.`

export const INTERRUPTED_OUTPUT = 'Interrumpido.'

function environment(root: string): string {
  const shell = process.platform === 'win32' ? 'PowerShell' : 'zsh'
  return `Project root: ${root}\nPlatform: ${process.platform} (commands run in ${shell})`
}

/**
 * Convierte el historial guardado en lo que se envía al modelo: prompt de sistema, el último resumen
 * (si lo hay) en lugar de lo que cubre, y toda llamada a herramienta emparejada con un resultado.
 */
export function buildModelMessages(stored: StoredMessage[], root: string): ChatMessage[] {
  const summary = stored.findLast((m) => m.role === 'summary')
  const cutoff = summary?.coversUpToSeq ?? 0
  const live = stored.filter((m) => m.role !== 'summary' && m.seq > cutoff)

  const out: ChatMessage[] = [{ role: 'system', parts: [{ type: 'text', text: `${SYSTEM_PROMPT}\n\n${environment(root)}` }] }]
  if (summary) {
    const text = summary.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')
    out.push({ role: 'user', parts: [{ type: 'text', text: `Summary of the earlier conversation:\n${text}` }] })
  }

  for (let i = 0; i < live.length; i++) {
    const m = live[i]!
    if (m.role === 'user') {
      out.push({ role: 'user', parts: m.parts })
    } else if (m.role === 'assistant') {
      if (m.parts.length === 0) continue
      out.push({ role: 'assistant', parts: m.parts })
      const calls = m.parts.flatMap((p) => (p.type === 'tool-call' ? [p] : []))
      if (calls.length === 0) continue
      // Un turno interrumpido puede dejar llamadas sin resultado; los modelos exigen la pareja completa.
      const next = live[i + 1]
      const results = next?.role === 'tool' ? next.parts : []
      const parts: Part[] = calls.map(
        (c) =>
          results.find((r) => r.type === 'tool-result' && r.callId === c.callId) ?? {
            type: 'tool-result',
            callId: c.callId,
            output: INTERRUPTED_OUTPUT,
            isError: true,
          },
      )
      out.push({ role: 'tool', parts })
      if (next?.role === 'tool') i++
    }
    // Un mensaje `tool` sin su assistant delante no debería existir; se descarta.
  }
  return out
}
