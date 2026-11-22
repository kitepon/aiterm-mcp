// The actor identity (pid + start time) that parent-delivery records carry. The participant inventory that was built from the
// execution store is gone with the store (0.70.104, a532b2 1b).
import { z } from "zod";

export const executionActorSchema = z.object({
  pid: z.number().int().positive().safe(),
  started_identity: z.string().min(1).max(256).refine(value => Number.isFinite(Date.parse(value))),
}).strict();
export type ExecutionActor = z.infer<typeof executionActorSchema>;

export const executionActorObservationSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("present"), actor: executionActorSchema }).strict(),
  z.object({ state: z.literal("absent"), pid: executionActorSchema.shape.pid }).strict(),
  z.object({ state: z.literal("unknown"), pid: executionActorSchema.shape.pid }).strict(),
]);
export type ExecutionActorObservation = z.infer<typeof executionActorObservationSchema>;
