import { z } from 'zod'
import { CoreEventSchema } from './events'

export const ErrorCodeSchema = z.enum([
  'invalid_params',
  'not_found',
  'outside_root',
  'too_large',
  'binary',
  'provider_unreachable',
  'internal',
])
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

export const RequestSchema = z.object({ id: z.number().int(), method: z.string(), params: z.unknown() })
export type Request = z.infer<typeof RequestSchema>

export const ResponseSchema = z.union([
  z.object({ id: z.number().int(), error: z.object({ code: ErrorCodeSchema, message: z.string() }) }).strict(),
  z.object({ id: z.number().int(), result: z.unknown() }).strict(),
])
export type Response = z.infer<typeof ResponseSchema>

export const EventEnvelopeSchema = z.object({ event: CoreEventSchema })
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>
