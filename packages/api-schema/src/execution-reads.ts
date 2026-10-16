import { z } from "zod";
export const executionStatusSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  agentId: z.string().nullable(),
  trigger: z.enum(["manual", "schedule"]),
  marketId: z.string().nullable(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  configVersion: z.number(),
  error: z.string().nullable(),
  resultAvailable: z.boolean(),
  lastEventId: z.string().nullable(),
});
export const runSummaryPageSchema = z.object({
  items: z.array(executionStatusSchema),
  nextCursor: z.string().nullable(),
});
export const executionEventSchema = z.union([
  z.object({
    id: z.string().regex(/^\d+$/),
    type: z.string(),
    createdAt: z.number(),
    oversized: z.literal(true),
    detailUrl: z.string(),
  }),
  z.object({
    id: z.string().regex(/^\d+$/),
    type: z.string(),
    createdAt: z.number(),
    data: z.unknown(),
  }),
]);
export const eventPageSchema = z.object({
  items: z.array(executionEventSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type ExecutionStatusDto = z.infer<typeof executionStatusSchema>;
export type RunSummaryDto = ExecutionStatusDto;
export type ExecutionEventDto = z.infer<typeof executionEventSchema>;
export type EventPageDto = z.infer<typeof eventPageSchema>;
