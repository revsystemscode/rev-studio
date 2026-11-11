import type { permissionsRepo } from '../db/repos/permissions'
import type { ToolDef } from '../tools/types'
import { commandPrefix, isChained, words } from './command-prefix'

const ANY = '*'

function commandOf(input: unknown): string {
  const command = (input as { command?: unknown } | null)?.command
  return typeof command === 'string' ? command : ''
}

export class PermissionService {
  constructor(private readonly repo: ReturnType<typeof permissionsRepo>) {}

  check(projectId: string, tool: ToolDef, input: unknown): 'allow' | 'ask' {
    if (tool.kind === 'read') return 'allow'
    const rules = this.repo.list(projectId).filter((r) => r.toolName === tool.name)

    if (tool.kind === 'edit') return rules.some((r) => r.pattern === ANY) ? 'allow' : 'ask'

    const command = commandOf(input)
    if (isChained(command)) return 'ask'
    const w = words(command)
    const allowed = rules.some((r) => {
      const prefix = words(r.pattern)
      // Comparación palabra a palabra: "npm test" no cubre "npm testx". Una regla "*" no vale para comandos.
      return r.pattern !== ANY && prefix.length > 0 && prefix.length <= w.length && prefix.every((p, i) => p === w[i])
    })
    return allowed ? 'allow' : 'ask'
  }

  /** Guarda la regla de "permitir siempre" correspondiente a esta llamada. */
  remember(projectId: string, tool: ToolDef, input: unknown): void {
    if (tool.kind === 'edit') {
      this.repo.add(projectId, tool.name, ANY)
    } else if (tool.kind === 'command') {
      const prefix = commandPrefix(commandOf(input))
      if (prefix) this.repo.add(projectId, tool.name, prefix)
    }
  }
}
