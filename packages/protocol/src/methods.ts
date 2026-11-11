import { z } from 'zod'
import {
  ApprovalDecisionSchema,
  ApprovalRequestSchema,
  CapabilitiesSchema,
  ChangedFileSchema,
  DirEntrySchema,
  PermissionRuleSchema,
  ProjectSchema,
  ProviderConfigSchema,
  ProviderStatusSchema,
  ProviderTypeSchema,
  SessionSchema,
  StoredMessageSchema,
} from './entities'

const empty = z.object({})
const id = z.object({ id: z.string() })
const sessionRef = z.object({ sessionId: z.string() })
const modelRef = z.object({ providerId: z.string(), model: z.string() })

export const SessionSnapshotSchema = z.object({
  session: SessionSchema,
  messages: z.array(StoredMessageSchema),
  pendingApprovals: z.array(ApprovalRequestSchema),
  usedTokens: z.number(),
  windowTokens: z.number().nullable(),
})
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>

export const SettingsSchema = z.object({
  defaultProviderId: z.string().nullable(),
  defaultModel: z.string().nullable(),
})
export type Settings = z.infer<typeof SettingsSchema>

export const methods = {
  'projects.list': { params: empty, result: z.array(ProjectSchema) },
  'projects.add': { params: z.object({ path: z.string().min(1) }), result: ProjectSchema },
  'projects.remove': { params: id, result: empty },
  'projects.relocate': { params: z.object({ id: z.string(), path: z.string().min(1) }), result: ProjectSchema },

  'sessions.list': { params: z.object({ projectId: z.string() }), result: z.array(SessionSchema) },
  'sessions.create': { params: modelRef.extend({ projectId: z.string() }), result: SessionSchema },
  'sessions.delete': { params: id, result: empty },
  'sessions.setModel': { params: modelRef.extend({ id: z.string() }), result: SessionSchema },
  'sessions.get': { params: id, result: SessionSnapshotSchema },

  'turn.send': { params: sessionRef.extend({ text: z.string().min(1) }), result: empty },
  'turn.stop': { params: sessionRef, result: empty },
  'turn.retry': { params: sessionRef, result: empty },
  'approval.resolve': {
    params: z.object({ approvalId: z.string(), decision: ApprovalDecisionSchema }),
    result: empty,
  },

  'fs.list': { params: z.object({ projectId: z.string(), dir: z.string() }), result: z.array(DirEntrySchema) },
  'fs.read': {
    params: z.object({ projectId: z.string(), path: z.string() }),
    result: z.object({ content: z.string() }),
  },
  'fs.write': {
    params: z.object({ projectId: z.string(), path: z.string(), content: z.string() }),
    result: empty,
  },

  'changes.list': { params: sessionRef, result: z.array(ChangedFileSchema) },
  'changes.diff': {
    params: sessionRef.extend({ path: z.string() }),
    result: z.object({ original: z.string().nullable(), current: z.string().nullable() }),
  },
  'changes.revert': { params: sessionRef.extend({ path: z.string() }), result: empty },

  'providers.list': { params: empty, result: z.array(ProviderStatusSchema) },
  'providers.save': {
    params: z.object({
      id: z.string().optional(),
      type: ProviderTypeSchema,
      name: z.string().min(1),
      baseUrl: z.string().min(1),
      /** undefined conserva la clave guardada; null la borra. */
      keyCipher: z.string().nullable().optional(),
      contextSize: z.number().int().positive().nullable(),
    }),
    result: ProviderConfigSchema,
  },
  'providers.remove': { params: id, result: empty },
  'providers.models': { params: z.object({ providerId: z.string() }), result: z.array(z.string()) },
  'providers.capabilities': { params: modelRef, result: CapabilitiesSchema },

  'permissions.list': { params: z.object({ projectId: z.string() }), result: z.array(PermissionRuleSchema) },
  'permissions.remove': { params: id, result: empty },

  'settings.get': { params: empty, result: SettingsSchema },
  'settings.set': { params: SettingsSchema, result: empty },
} as const

export type MethodName = keyof typeof methods
export type ParamsOf<M extends MethodName> = z.input<(typeof methods)[M]['params']>
export type ResultOf<M extends MethodName> = z.output<(typeof methods)[M]['result']>
