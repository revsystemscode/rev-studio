import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { resolveInRoot, toRel } from './jail'
import { isErrno, ToolError, type ToolContext, type ToolDef } from './types'

const schema = z.object({
  path: z.string().describe('File path relative to the project root.'),
  oldText: z.string().min(1).describe('Exact text to replace. Must appear exactly once in the file.'),
  newText: z.string().describe('Replacement text.'),
})
type Input = z.infer<typeof schema>

async function plan({ path: p, oldText, newText }: Input, ctx: ToolContext) {
  const abs = await resolveInRoot(ctx.root, p)
  let original: string
  try {
    original = await readFile(abs, 'utf8')
  } catch (e) {
    if (isErrno(e, 'ENOENT')) throw new ToolError(`No existe el archivo "${p}". Usa write_file para crearlo.`)
    throw e
  }
  // El modelo casi siempre envía \n; el archivo puede usar \r\n. Se compara en el formato del archivo.
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const adapt = (s: string) => s.replaceAll('\r\n', '\n').replaceAll('\n', eol)
  const search = adapt(oldText)
  const count = original.split(search).length - 1
  if (count === 0) throw new ToolError(`oldText no aparece en "${p}". Vuelve a leer el archivo y usa el texto exacto.`)
  if (count > 1) throw new ToolError(`oldText aparece ${count} veces en "${p}". Añade contexto para que sea único.`)
  const proposed = original.replace(search, () => adapt(newText))
  return { abs, rel: toRel(await resolveInRoot(ctx.root, '.'), abs), original, proposed }
}

export const editFile: ToolDef<Input> = {
  name: 'edit_file',
  description: 'Replace one exact occurrence of oldText with newText in an existing file. Read the file first.',
  schema,
  kind: 'edit',
  truncateOutput: true,
  async preview(input, ctx) {
    const { rel, original, proposed } = await plan(input, ctx)
    return { kind: 'diff', path: rel, original, proposed }
  },
  async run(input, ctx) {
    const { abs, rel, proposed } = await plan(input, ctx)
    await ctx.snapshots.captureBeforeWrite(abs)
    await writeFile(abs, proposed)
    ctx.onFileChanged(rel)
    return `Editado ${rel}.`
  },
}
