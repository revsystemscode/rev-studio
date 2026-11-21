import { z } from 'zod'
import { ApprovalRequestSchema, StoredMessageSchema, TurnStatusSchema } from './entities'

const sessionId = z.string()

export const CoreEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message.added'), sessionId, message: StoredMessageSchema }),
  z.object({ type: z.literal('text.delta'), sessionId, delta: z.string() }),
  z.object({ type: z.literal('tool.started'), sessionId, callId: z.string(), name: z.string(), input: z.unknown() }),
  z.object({
    type: z.literal('tool.finished'),
    sessionId,
    callId: z.string(),
    output: z.string(),
    isError: z.boolean(),
  }),
  z.object({ type: z.literal('approval.requested'), sessionId, approval: ApprovalRequestSchema }),
  z.object({ type: z.literal('approval.resolved'), sessionId, approvalId: z.string() }),
  z.object({ type: z.literal('file.changed'), sessionId, path: z.string() }),
  z.object({ type: z.literal('tree.changed'), projectId: z.string(), dir: z.string() }),
  z.object({
    type: z.literal('context.usage'),
    sessionId,
    usedTokens: z.number(),
    windowTokens: z.number().nullable(),
  }),
  z.object({
    type: z.literal('turn.status'),
    sessionId,
    status: TurnStatusSchema,
    error: z.string().nullable(),
  }),
])
export type CoreEvent = z.infer<typeof CoreEventSchema>
