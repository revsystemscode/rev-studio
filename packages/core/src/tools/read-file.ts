import { readFile as fsReadFile, stat } from 'node:fs/promises'
import { z } from 'zod'
import { resolveInRoot } from './jail'
import { isErrno, ToolError, type ToolDef } from './types'

export const READ_MAX_LINES = 2000
export const READ_MAX_CHARS = 100_000
const READ_MAX_BYTES = 10 * 1024 * 1024

const schema = z.object({
  path: z.string().describe('File path relative to the project root.'),
  startLine: z.number().int().min(1).optional().describe('First line to read (1-indexed).'),
  endLine: z.number().int().min(1).optional().describe('Last line to read (inclusive).'),
})

import { looksBinary } from './text'

export { looksBinary }

export const readFile: ToolDef<z.infer<typeof schema>> = {
  name: 'read_file',
  description: `Read a text file with line numbers. Returns at most ${READ_MAX_LINES} lines per call; use startLine/endLine for the rest.`,
  schema,
  kind: 'read',
  truncateOutput: false,
  async run({ path: p, startLine, endLine }, ctx) {
    const abs = await resolveInRoot(ctx.root, p)
    let buf: Buffer
    try {
      const info = await stat(abs)
      if (info.isDirectory()) throw new ToolError(`"${p}" es una carpeta; usa list_dir.`)
      if (info.size > READ_MAX_BYTES) throw new ToolError(`"${p}" es demasiado grande para leerlo; usa search.`)
      buf = await fsReadFile(abs)
    } catch (e) {
      if (isErrno(e, 'ENOENT')) throw new ToolError(`No existe el archivo "${p}".`)
      throw e
    }
    if (looksBinary(buf)) throw new ToolError(`"${p}" es un archivo binario y no se puede leer como texto.`)

    const lines = buf.toString('utf8').split(/\r?\n/)
    if (lines.at(-1) === '') lines.pop()
    const total = lines.length
    const first = Math.min(startLine ?? 1, Math.max(total, 1))
    let last = Math.min(endLine ?? total, total, first + READ_MAX_LINES - 1)

    const maxChars = ctx.readMaxChars ?? READ_MAX_CHARS
    const out: string[] = []
    let chars = 0
    for (let n = first; n <= last; n++) {
      const line = `${String(n).padStart(6)}\t${lines[n - 1]}`
      if (chars + line.length > maxChars && out.length > 0) {
        last = n - 1
        break
      }
      out.push(line)
      chars += line.length + 1
    }
    const partial = first !== 1 || last !== total
    if (partial) out.push(`[líneas ${first}-${last} de ${total}]`)
    return out.join('\n') || '(archivo vacío)'
  },
}
