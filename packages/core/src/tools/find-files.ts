import { execFile } from 'node:child_process'
import { z } from 'zod'
import { ToolError, type ToolDef } from './types'

export const FIND_MAX_RESULTS = 500

const schema = z.object({
  pattern: z.string().min(1).describe('Glob pattern relative to the project root, e.g. "src/**/*.ts".'),
})

export const findFiles: ToolDef<z.infer<typeof schema>> = {
  name: 'find_files',
  description: `Find files by glob pattern. Respects .gitignore. Returns at most ${FIND_MAX_RESULTS} paths.`,
  schema,
  kind: 'read',
  truncateOutput: true,
  async run({ pattern }, ctx) {
    if (pattern.split(/[\\/]/).includes('..') || /^([a-zA-Z]:|[\\/])/.test(pattern)) {
      throw new ToolError('El patrón debe ser relativo a la carpeta del proyecto y no puede contener "..".')
    }
    return new Promise<string>((resolve, reject) => {
      execFile(
        ctx.rgPath,
        // --no-require-git: respeta .gitignore aunque la carpeta no sea un repositorio.
        ['--files', '--hidden', '--no-require-git', '--glob', '!.git/', '--glob', pattern, '--sort', 'path'],
        { cwd: ctx.root, maxBuffer: 64 * 1024 * 1024, signal: ctx.signal, windowsHide: true },
        (error, stdout, stderr) => {
          // rg sale con 1 cuando no hay coincidencias.
          if (error && (error as { code?: unknown }).code !== 1) {
            return reject(new ToolError(`find_files falló: ${stderr.trim() || error.message}`))
          }
          const files = stdout.split(/\r?\n/).filter(Boolean).map((f) => f.replaceAll('\\', '/'))
          if (files.length === 0) return resolve('Sin resultados.')
          const shown = files.slice(0, FIND_MAX_RESULTS)
          if (files.length > shown.length) {
            shown.push(`[… ${files.length - shown.length} resultados más; usa un patrón más específico …]`)
          }
          resolve(shown.join('\n'))
        },
      )
    })
  },
}
