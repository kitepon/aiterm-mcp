// Structural callback for the isolated steer-delivery admission API. The
// installed public 0.4.7 does not yet export it. Import no newer/live package;
// cross-package tests exercise its actual producer. No public mount here.
import { z } from "zod";
import type { createExecutionParentAdapter } from "./execution-parent.js";
import type { createParentNativeAdmission } from "./execution-parent-native.js";
import { ExecutionError, executionErrorSchema } from "./execution-wire.js";

type Effect = { delivery_ids: readonly string[]; stage: "queue" | "dequeue" | "emit" | "wake";
  vendor: "codex" | "claude" | "cursor"; endpoint: unknown; native_context?: unknown };
export function createSteerExecutionAdmission(parent: ReturnType<typeof createExecutionParentAdapter>,
  native: ReturnType<typeof createParentNativeAdmission>) {
  return {
    required: true as const,
    async run<T>(input: Effect, action: () => Promise<T>): Promise<T> {
      const ids = z.array(z.uuid()).min(1).parse(input.delivery_ids);
      const endpoint = structuredClone(input.endpoint);
      if (input.stage !== "queue") {
        const result = await native.run(ids, input.stage, endpoint, async (_, issue) => { issue(); return action(); }, input.native_context);
        // A genuine accepted native receipt survives metadata uncertainty. The
        // durable unknown slot still prevents further effects or false stop.
        if (Object.hasOwn(result, "value")) return result.value!;
        const failure = executionErrorSchema.parse(result.error);
        throw new ExecutionError(failure.code, failure.effect);
      }
      if (ids.length !== 1) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      let observed = false, value: T | undefined;
      const result = await parent.submit(ids[0], endpoint, async (_, __, issue) => {
        issue(); value = await action();
        const queued = input.vendor === "codex" ? z.object({ queuedSubmission: z.object({ id: z.string().min(1) }) }).parse(value).queuedSubmission.id : null;
        observed = true;
        return { queued_submission_id: queued };
      });
      if (observed && !result.isError) return value!;
      const failure = executionErrorSchema.parse(result._meta?.["aiterm/execution_error"]);
      throw new ExecutionError(failure.code, failure.effect);
    },
  };
}
