// Private read-only evidence from the serving native scope, never client claims.
import { z } from "zod";
import { executionLaunchSchema } from "./execution-contract.js";
import { executionNativeBindingSchema } from "./execution-close.js";
export const createdLaunchObservationSchema = z.object({
  target: executionLaunchSchema, native: executionNativeBindingSchema,
  initial_prompt: z.literal("none"), initial_prompt_delivery: z.null(),
  harness_alive: z.literal(true), ready: z.literal(true),
}).strict();
export const exitedCreatedLaunchObservationSchema = createdLaunchObservationSchema.extend({
  harness_alive: z.literal(false), ready: z.literal(false),
});
