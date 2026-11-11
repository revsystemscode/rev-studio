import { mkdir, readFile, writeFile as fsWriteFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { resolveInRoot, toRel } from './jail'
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

export const writeFile: ToolDef<Input> = {
  name: 'write_file',
  description: 'Create a file or overwrite it completely. Prefer edit_file for changes to existing files.',
  schema,
  kind: 'edit',
  truncateOutput: true,
  async preview({ path: p, content }, ctx) {
    const { abs, rel } = await locate(p, ctx)
    const original = await readFile(abs, 'utf8').catch((e) => {
      if (isErrno(e, 'ENOENT')) return null
      throw e
    })
    return { kind: 'diff', path: rel, original, proposed: content }
  },
  async run({ path: p, content }, ctx) {
    const { abs, rel } = await locate(p, ctx)
    await ctx.snapshots.captureBeforeWrite(abs)
    await mkdir(path.dirname(abs), { recursive: true })
    await fsWriteFile(abs, content)
    ctx.onFileChanged(rel)
    return `Escrito ${rel}.`
  },
}
