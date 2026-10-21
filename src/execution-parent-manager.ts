// Capability-gated factory for the real parent manager. Public steer 0.4.7 has
// no native admission callbacks; it is refused rather than silently bypassed.
import * as installedSteer from "aiterm-steer-delivery";
import type { ExecutionRequest, ExecutionPoint } from "./execution-contract.js";
import type { createExecutionParentAdapter } from "./execution-parent.js";
import type { createParentNativeAdmission } from "./execution-parent-native.js";
import { createSteerExecutionAdmission } from "./execution-steer.js";
import { ExecutionError } from "./execution-wire.js";
import type { CodexParent } from "./codex-parent-receiver.js";
import type { ClaudeParent } from "./claude-parent-receiver.js";
import type { CursorParent } from "./cursor-parent-receiver.js";

type Parent = CodexParent | ClaudeParent | CursorParent;
type Receipt = { queued_submission_id: string | null };
export interface ParentManagerExecution {
  captureEndpointEvidence?(endpoint: unknown): unknown;
  bind(id: string, request: ExecutionRequest, child: ExecutionPoint, endpoint: unknown, evidence?: unknown): Promise<unknown>;
  submit(parent: Parent, id: string, text: string): Promise<Receipt>;
  outcomeUnknown?(error: unknown): boolean | null;
  recordChildCompletion?(id: string): Promise<unknown>;
}
export type SteerProvider = Pick<typeof installedSteer, "submitCodexParentAnswer" | "submitClaudeParentAnswer" | "submitCursorParentAnswer">
  & { withDeliveryEffect?: unknown; DELIVERY_ADMISSION_CONTRACT?: unknown; SteerDeliveryError?: typeof installedSteer.SteerDeliveryError };
export function createParentManagerExecution(input: {
  parent: ReturnType<typeof createExecutionParentAdapter>; native: ReturnType<typeof createParentNativeAdmission>;
  profile: installedSteer.ProductProfile; provider?: SteerProvider; codexRuntime?: installedSteer.CodexReceiverRuntime;
  claudeRuntime?: Parameters<typeof installedSteer.submitClaudeParentAnswer>[4];
}): ParentManagerExecution {
  const provider: SteerProvider = input.provider ?? installedSteer;
  const contract = provider.DELIVERY_ADMISSION_CONTRACT as Record<string, unknown> | undefined;
  if (typeof provider.withDeliveryEffect !== "function" || contract?.schema !== "steer.delivery-admission.v1"
    || contract.native_context !== true || contract.cursor_profile_parameter !== true || contract.serialized_required !== true
    || contract.multi_delivery_emit !== true) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const profile = Object.assign({}, input.profile, { delivery_admission: createSteerExecutionAdmission(input.parent, input.native) });
  return {
    outcomeUnknown(error) {
      // An isolated/new provider has its own class identity. Accept certainty
      // only from that exact provider, never a matching field on an RPC error.
      const ErrorClass = provider.SteerDeliveryError;
      return ErrorClass && error instanceof ErrorClass && typeof error.outcome_unknown === "boolean" ? error.outcome_unknown : null;
    },
    captureEndpointEvidence: endpoint => input.parent.captureEndpointEvidence(endpoint),
    recordChildCompletion: id => input.parent.recordChildCompletion(id),
    bind: (id, request, child, endpoint, evidence) => input.parent.bind(id, request, child, endpoint, evidence),
    submit(parent, id, text) {
      if ("kind" in parent && parent.kind === "claude") return provider.submitClaudeParentAnswer(profile, parent, id, text, input.claudeRuntime);
      if ("kind" in parent && parent.kind === "cursor") {
        // The optional profile parameter is provided by the capability-gated
        // newer provider only. The installed old provider cannot reach here.
        return (provider.submitCursorParentAnswer as (parent: CursorParent, id: string, text: string,
          timeout: undefined, profile: installedSteer.ProductProfile) => Promise<Receipt>)(parent, id, text, undefined, profile);
      }
      return provider.submitCodexParentAnswer(profile, parent as CodexParent, id, text, input.codexRuntime);
    },
  };
}
