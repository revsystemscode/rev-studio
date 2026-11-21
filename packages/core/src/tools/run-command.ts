import { z } from 'zod'
import { runProcess, shellInvocation } from '../exec/spawn-tree'
import type { ToolDef } from './types'

export const DEFAULT_TIMEOUT_SECONDS = 120
export const MAX_TIMEOUT_SECONDS = 600

const schema = z.object({
  command: z.string().min(1).describe('Shell command line. Runs in the project root (zsh on macOS, PowerShell on Windows).'),
  timeoutSeconds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`Defaults to ${DEFAULT_TIMEOUT_SECONDS}; maximum ${MAX_TIMEOUT_SECONDS}.`),
})

export function effectiveTimeoutSeconds(requested: number | undefined): number {
  return Math.min(requested ?? DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS)
}

export const runCommand: ToolDef<z.infer<typeof schema>> = {
  name: 'run_command',
  description: 'Run a non-interactive shell command in the project root and return its combined output and exit code.',
  schema,
  kind: 'command',
  truncateOutput: true,
  async preview({ command }, ctx) {
    return { kind: 'command', command, cwd: ctx.root }
  },
  async run({ command, timeoutSeconds }, ctx) {
    const seconds = effectiveTimeoutSeconds(timeoutSeconds)
    const r = await runProcess({
      ...shellInvocation(command),
      cwd: ctx.root,
      timeoutMs: seconds * 1000,
      signal: ctx.signal,
    })
    const status = r.aborted
      ? '[cancelado]'
      : r.timedOut
        ? `[tiempo agotado tras ${seconds} s]`
        : `[código de salida: ${r.exitCode}]`
    const output = r.output.trimEnd()
    return output ? `${output}\n${status}` : status
  },
}
