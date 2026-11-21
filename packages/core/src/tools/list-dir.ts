import { readdir } from 'node:fs/promises'
import { z } from 'zod'
import { resolveInRoot } from './jail'
import { isErrno, ToolError, type ToolDef } from './types'

const schema = z.object({ path: z.string().describe('Directory path relative to the project root. Use "." for the root.') })

export const listDir: ToolDef<z.infer<typeof schema>> = {
  name: 'list_dir',
  description: 'List the entries of a directory in the project. Directories end with "/".',
  schema,
  kind: 'read',
  truncateOutput: true,
  async run({ path: p }, ctx) {
    const abs = await resolveInRoot(ctx.root, p)
    let entries
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch (e) {
      if (isErrno(e, 'ENOENT')) throw new ToolError(`No existe la carpeta "${p}".`)
      if (isErrno(e, 'ENOTDIR')) throw new ToolError(`"${p}" no es una carpeta.`)
      throw e
    }
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => `${e.name}/`)
    const files = entries.filter((e) => !e.isDirectory()).map((e) => e.name)
    const out = [...dirs.sort(), ...files.sort()].join('\n')
    return out || '(carpeta vacía)'
  },
}
