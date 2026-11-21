import { z } from 'zod'

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  available: z.boolean(),
})
export type Project = z.infer<typeof ProjectSchema>

export const TurnStatusSchema = z.enum(['idle', 'running', 'interrupted', 'failed'])
export type TurnStatus = z.infer<typeof TurnStatusSchema>

export const SessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  providerId: z.string(),
  model: z.string(),
  turnStatus: TurnStatusSchema,
  turnError: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Session = z.infer<typeof SessionSchema>

export const PartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('tool-call'), callId: z.string(), name: z.string(), input: z.unknown() }),
  z.object({ type: z.literal('tool-result'), callId: z.string(), output: z.string(), isError: z.boolean() }),
])
export type Part = z.infer<typeof PartSchema>

export const MessageRoleSchema = z.enum(['user', 'assistant', 'tool', 'summary'])
export type MessageRole = z.infer<typeof MessageRoleSchema>

export const StoredMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  seq: z.number().int(),
  role: MessageRoleSchema,
  parts: z.array(PartSchema),
  coversUpToSeq: z.number().int().nullable(),
  createdAt: z.number(),
})
export type StoredMessage = z.infer<typeof StoredMessageSchema>

export const ProviderTypeSchema = z.enum(['ollama', 'lmstudio', 'openai-compatible', 'fake'])
export type ProviderType = z.infer<typeof ProviderTypeSchema>

export const ProviderConfigSchema = z.object({
  id: z.string(),
  type: ProviderTypeSchema,
  name: z.string(),
  baseUrl: z.string(),
  hasKey: z.boolean(),
  contextSize: z.number().int().positive().nullable(),
})
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

export const ProviderStatusSchema = z.object({ config: ProviderConfigSchema, reachable: z.boolean() })
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>

export const CapabilitiesSchema = z.object({
  tools: z.enum(['yes', 'no', 'unknown']),
  contextWindow: z.number().int().positive().nullable(),
})
export type Capabilities = z.infer<typeof CapabilitiesSchema>

export const ApprovalPreviewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('diff'), path: z.string(), original: z.string().nullable(), proposed: z.string() }),
  z.object({ kind: z.literal('command'), command: z.string(), cwd: z.string() }),
])
export type ApprovalPreview = z.infer<typeof ApprovalPreviewSchema>

export const ApprovalRequestSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  callId: z.string(),
  toolName: z.string(),
  preview: ApprovalPreviewSchema,
})
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>

export const ApprovalDecisionSchema = z.enum(['once', 'always', 'deny'])
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>

export const PermissionRuleSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  toolName: z.string(),
  pattern: z.string(),
})
export type PermissionRule = z.infer<typeof PermissionRuleSchema>

export const ChangedFileSchema = z.object({
  path: z.string(),
  status: z.enum(['modified', 'created', 'deleted']),
})
export type ChangedFile = z.infer<typeof ChangedFileSchema>

export const DirEntrySchema = z.object({ name: z.string(), path: z.string(), isDir: z.boolean() })
export type DirEntry = z.infer<typeof DirEntrySchema>
