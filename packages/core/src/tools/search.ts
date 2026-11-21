import { z } from 'zod'
import { runProcess } from '../exec/spawn-tree'
import { ToolError, type ToolDef } from './types'

const schema = z.object({
  query: z.string().min(1).describe('Regular expression to search for.'),
  glob: z.string().optional().describe('Only search files matching this glob, e.g. "*.ts".'),
  caseSensitive: z.boolean().optional().describe('Defaults to false.'),
})

export const search: ToolDef<z.infer<typeof schema>> = {
  name: 'search',
  description: 'Search file contents in the project with a regular expression (ripgrep). Respects .gitignore. Returns path:line:text.',
  schema,
  kind: 'read',
  truncateOutput: true,
  async run({ query, glob, caseSensitive }, ctx) {
    const args = [
      '--line-number',
      '--no-heading',
      '--color', 'never',
      '--max-count', '50',
      '--max-columns', '300',
      '--sort', 'path',
      '--hidden',
      '--no-require-git',
      '--glob', '!.git/',
    ]
    if (!caseSensitive) args.push('-i')
    if (glob) args.push('--glob', glob)
    args.push('-e', query, './')

    const r = await runProcess({ file: ctx.rgPath, args, cwd: ctx.root, timeoutMs: 30_000, signal: ctx.signal })
    if (r.aborted) return '[cancelado]'
    if (r.timedOut) throw new ToolError('La búsqueda tardó demasiado; usa un patrón o un glob más específico.')
    if (r.exitCode === 1) return 'Sin resultados.'
    if (r.exitCode !== 0) throw new ToolError(`search falló: ${r.output.trim()}`)
    return r.output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.replace(/^\.[\\/]/, '').replace(/^([^:]*):/, (m) => m.replaceAll('\\', '/')))
      .join('\n')
  },
}
