import { mkdir, readFile, writeFile as fsWriteFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { resolveInRoot, toRel } from './jail'
import { editableText } from './text'
import { isErrno, type ToolContext, type ToolDef } from './types'

const schema = z.object({
  path: z.string().describe('File path relative to the project root.'),
  content: z.string().describe('Full content of the file.'),
})
type Input = z.infer<typeof schema>

async function locate(p: string, ctx: ToolContext) {
  const abs = await resolveInRoot(ctx.root, p)
  return { abs, rel: toRel(await resolveInRoot(ctx.root, '.'), abs) }
}

/** Contenido actual, o null si no existe. Rechaza sobrescribir binarios o texto que no sea UTF-8. */
async function current(abs: string, p: string): Promise<string | null> {
  const buf = await readFile(abs).catch((e) => {
    if (isErrno(e, 'ENOENT')) return null
    throw e
  })
  return buf === null ? null : editableText(buf, p)
}

export const writeFile: ToolDef<Input> = {
  name: 'write_file',
  description: 'Create a file or overwrite it completely. Prefer edit_file for changes to existing files.',
  schema,
  kind: 'edit',
  truncateOutput: true,
  async preview({ path: p, content }, ctx) {
    const { abs, rel } = await locate(p, ctx)
    return { kind: 'diff', path: rel, original: await current(abs, p), proposed: content }
  },
  async run({ path: p, content }, ctx) {
    const { abs, rel } = await locate(p, ctx)
    await current(abs, p)
    await ctx.snapshots.captureBeforeWrite(abs)
    await mkdir(path.dirname(abs), { recursive: true })
    await fsWriteFile(abs, content)
    ctx.onFileChanged(rel)
    return `Escrito ${rel}.`
  },
}
