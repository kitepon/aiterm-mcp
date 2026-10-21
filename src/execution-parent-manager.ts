// Capability-gated factory for the real parent manager. Public steer 0.4.7 has
// no native admission callbacks; it is refused rather than silently bypassed.
import path from "node:path";
import { z } from "zod";
import * as installedSteer from "aiterm-steer-delivery";
import type { ExecutionRequest, ExecutionPoint } from "./execution-contract.js";
import type { createExecutionParentAdapter } from "./execution-parent.js";
import type { createParentNativeAdmission } from "./execution-parent-native.js";
import { createSteerExecutionAdmission } from "./execution-steer.js";
import { ExecutionError } from "./execution-wire.js";
import type { CodexParent } from "./codex-parent-receiver.js";
import { claudeParentSchema, type ClaudeParent } from "./claude-parent-receiver.js";
import { cursorParentSchema, type CursorParent } from "./cursor-parent-receiver.js";

type Parent = CodexParent | ClaudeParent | CursorParent;
type Receipt = { queued_submission_id: string | null };
const selectedParentSchema = z.union([claudeParentSchema, cursorParentSchema,
  z.object({ thread_id: z.uuid(), codex_home: z.string() }).strict()])
  .refine(value => { const root = "hook_root" in value ? value.hook_root : value.codex_home;
    return path.isAbsolute(root) && !/[\r\n\0]/.test(root); });
export interface ParentManagerExecution {
  // Explicit read only. Missing injected observer never falls back to a local PID probe.
  observeOriginOwner?(pid: number): unknown;
  parentFromIngress?(): Parent | null;
  captureEndpointEvidence?(endpoint: unknown): unknown;
  bind(id: string, request: ExecutionRequest, child: ExecutionPoint, endpoint: unknown, evidence?: unknown): Promise<unknown>;
  verifyRecovery?(id: string, request: ExecutionRequest, child: ExecutionPoint, endpoint: unknown, evidence: unknown): Promise<true>;
  diagnoseClaim?(id: string, request: ExecutionRequest, child: ExecutionPoint, endpoint: unknown, evidence?: unknown):
    ReturnType<ReturnType<typeof createExecutionParentAdapter>["diagnoseClaim"]>;
  // Synchronous companion metadata only, called inside the original preparation frame.
  prepareCompanion?(id: string, parent: Parent, evidence?: unknown): void;
  submit(parent: Parent, id: string, text: string): Promise<Receipt>;
  outcomeUnknown?(error: unknown): boolean | null;
  recordChildCompletion?(id: string): Promise<unknown>;
}
export type SteerProvider = Pick<typeof installedSteer, "submitCodexParentAnswer" | "submitClaudeParentAnswer" | "submitCursorParentAnswer">
  & Partial<Pick<typeof installedSteer, "bindClaudeParentDelivery" | "prepareCursorDelivery">>
  & { withDeliveryEffect?: unknown; DELIVERY_ADMISSION_CONTRACT?: unknown; SteerDeliveryError?: typeof installedSteer.SteerDeliveryError };
export function createParentManagerExecution(input: {
  parent: ReturnType<typeof createExecutionParentAdapter>; native: ReturnType<typeof createParentNativeAdmission>;
  profile: installedSteer.ProductProfile; provider?: SteerProvider; codexRuntime?: installedSteer.CodexReceiverRuntime;
  claudeRuntime?: Parameters<typeof installedSteer.submitClaudeParentAnswer>[4];
  verifyCompanion?(id: string, endpoint: unknown, evidence: unknown): unknown;
  parentFromIngress?(): unknown | null;
  observeOriginOwner?(pid: number): unknown;
}): ParentManagerExecution {
  const provider: SteerProvider = input.provider ?? installedSteer;
  const contract = provider.DELIVERY_ADMISSION_CONTRACT as Record<string, unknown> | undefined;
  if (typeof provider.withDeliveryEffect !== "function" || contract?.schema !== "steer.delivery-admission.v1"
    || contract.native_context !== true || contract.cursor_profile_parameter !== true || contract.serialized_required !== true
    || contract.multi_delivery_emit !== true) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const bindClaude = provider.bindClaudeParentDelivery, prepareCursor = provider.prepareCursorDelivery;
  const verifyCompanion = input.verifyCompanion, parentFromIngress = input.parentFromIngress;
  const observeOriginOwner = input.observeOriginOwner;
  const profile = Object.assign({}, input.profile, { delivery_admission: createSteerExecutionAdmission(input.parent, input.native) });
  return {
    ...(observeOriginOwner ? { observeOriginOwner } : {}),
    parentFromIngress() {
      if (typeof parentFromIngress !== "function") throw new ExecutionError("EXECUTION_UNSUPPORTED");
      const selected = parentFromIngress();
      if (selected === null) return null;
      if (selected && typeof (selected as { then?: unknown }).then === "function") {
        void Promise.resolve(selected).catch(() => undefined); throw new ExecutionError("EXECUTION_UNSUPPORTED");
      }
      const parsed = selectedParentSchema.safeParse(selected);
      if (!parsed.success) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      return structuredClone(parsed.data);
    },
    outcomeUnknown(error) {
      // An isolated/new provider has its own class identity. Accept certainty
      // only from that exact provider, never a matching field on an RPC error.
      const ErrorClass = provider.SteerDeliveryError;
      return ErrorClass && error instanceof ErrorClass && typeof error.outcome_unknown === "boolean" ? error.outcome_unknown : null;
    },
    captureEndpointEvidence: endpoint => input.parent.captureEndpointEvidence(endpoint),
    recordChildCompletion: id => input.parent.recordChildCompletion(id),
    bind: (id, request, child, endpoint, evidence) => input.parent.bind(id, request, child, endpoint, evidence),
    verifyRecovery: (id, request, child, endpoint, evidence) => input.parent.verifyRecovery(id, request, child, endpoint, evidence),
    diagnoseClaim: (id, request, child, endpoint, evidence) => input.parent.diagnoseClaim(id, request, child, endpoint, evidence),
    prepareCompanion(id, parent, evidence) {
      if (!("kind" in parent)) return; // Codex has no companion to prepare here.
      if (typeof verifyCompanion !== "function") throw new ExecutionError("EXECUTION_UNSUPPORTED");
      // Recheck the same native owner/endpoint after asynchronous bind. Never
      // fall back to an installed/static profile or invent a missing proof.
      const checked = verifyCompanion(id, parent, evidence);
      if (checked && typeof (checked as { then?: unknown }).then === "function") {
        void Promise.resolve(checked).catch(() => undefined);
        throw new ExecutionError("EXECUTION_UNSUPPORTED");
      }
      if (parent.kind === "claude") {
        if (typeof bindClaude !== "function") throw new ExecutionError("EXECUTION_UNSUPPORTED");
        return bindClaude(profile, parent, id);
      } else {
        if (typeof prepareCursor !== "function") throw new ExecutionError("EXECUTION_UNSUPPORTED");
        return prepareCursor(parent, id);
      }
    },
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
