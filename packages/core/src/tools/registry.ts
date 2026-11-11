import { z } from 'zod'
import type { ToolSpec } from '../providers/types'
import { editFile } from './edit-file'
import { findFiles } from './find-files'
import { listDir } from './list-dir'
import { readFile } from './read-file'
import { runCommand } from './run-command'
import { search } from './search'
import type { ToolDef } from './types'
import { writeFile } from './write-file'

export const allTools: ToolDef[] = [listDir, readFile, findFiles, search, editFile, writeFile, runCommand]

const byName = new Map(allTools.map((t) => [t.name, t]))

export function getTool(name: string): ToolDef | undefined {
  return byName.get(name)
}

export function toolSpecs(): ToolSpec[] {
  return allTools.map((t) => {
    const { $schema: _ignored, ...parameters } = z.toJSONSchema(t.schema) as Record<string, unknown>
    return { name: t.name, description: t.description, parameters }
  })
}
