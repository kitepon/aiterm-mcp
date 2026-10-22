// Injectable MCP surface for fake/integration acceptance. index.ts must mount
// it only after supplying the runtime evidence and mutation-path adapters.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executionReservationSchema, executionRequestSchema, executionPointSchema, cascadeInterruptRequestSchema, cascadeInterruptResultObjectSchema,
  type ExecutionPoint } from "./execution-contract.js";
import { executionActionSchema, executionFinishSchema, executionRecordSchema, executionBindingSchema,
  executionRootsRequestSchema, executionRootsResultObjectSchema,
  executionRefFromMeta, executionErrorResult, ExecutionError,
  EXECUTION_BINDING_META_KEY, EXECUTION_ERROR_META_KEY,
  EXECUTION_SOURCE_META_KEY, type ExecutionTransportSource,
  type ExecutionRecord } from "./execution-wire.js";
import { ExecutionService } from "./execution-service.js";
import { withExecutionEffectScope, bindExecutionManagementCloseTarget } from "./execution-effect.js";
import type { ExecutionNativeServer } from "./execution-close.js";

import { immediateStopInputSchema, immediateStopResultSchema } from "./execution-immediate-stop.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
};
export function executionBindingMeta(record: ExecutionRecord): Record<string, unknown> {
  return { [EXECUTION_BINDING_META_KEY]: executionBindingSchema.parse({
    schema: "aiterm.execution-binding.v1", request: record.reservation.request,
    source: record.source, target: record.relation.target, phase: record.relation.phase,
  }) };
}

export interface ExecutionToolOptions {
  // Installed by the serving host adapter, not supplied as tool arguments.
  sourceContext?(extra: { _meta?: unknown }): ExecutionTransportSource | undefined;
  // Explicit private host composition only. The default registration stays
  // read-only; neither wire args nor native callback presence enable keys.
  // A capable controller still reports missing abort/preservation/fence proof.
  interruptCurrentRun?: boolean;
  interruptSessionsNow?(input: unknown): ReturnType<typeof immediateStopResultSchema.parse>;
}
// Private same-server handshake. A guarded dispatcher must recognize the
// exact bound service before these three controls become callable. Ordinary
// standalone fake MCP handlers retain their existing explicit registration.
export interface ExecutionControlRegistration {
  sourceContext: NonNullable<ExecutionToolOptions["sourceContext"]>;
  activate(): void;
}
const controlRegistrars = new WeakMap<McpServer, (service: ExecutionService) => ExecutionControlRegistration>();
export function attachExecutionControlRegistrar(server: McpServer,
  register: (service: ExecutionService) => ExecutionControlRegistration): void {
  if (controlRegistrars.has(server)) throw new ExecutionError("EXECUTION_CONFLICT");
  controlRegistrars.set(server, register);
}
export function createExecutionToolHandlers(service: ExecutionService, options: ExecutionToolOptions = {}): {
  agent_execution(input: unknown, extra?: { _meta?: unknown }): Promise<ToolResult>;
  agent_stop(input: unknown): Promise<ToolResult>;
  agent_execution_roots(input: unknown): Promise<ToolResult>;
} {
  if (options.interruptCurrentRun !== undefined && typeof options.interruptCurrentRun !== "boolean")
    throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const interruptCurrentRun = options.interruptCurrentRun === true;
  return {
    async agent_execution(input, extra = {}) {
      try {
        const args = executionActionSchema.parse(input);
        // Native RPC refs belong to the serving dispatcher. A model/tool
        // argument must not select another operation type to hide a real call.
        if (args.action === "register" && args.reservation.request.kind === "mcp")
          throw new ExecutionError("EXECUTION_UNSUPPORTED");
        if (!options.sourceContext && extra._meta && typeof extra._meta === "object"
          && EXECUTION_SOURCE_META_KEY in extra._meta) throw new ExecutionError("EXECUTION_UNSUPPORTED");
        // Capture and detach before entering the shared-store transaction.
        const context = options.sourceContext?.(extra);
        const result = await service.execute(args, context === undefined ? undefined : structuredClone(context));
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result,
          _meta: executionBindingMeta(result) };
      } catch (error) { return executionErrorResult(error); }
    },
    async agent_stop(input) {
      try {
        const result = options.interruptSessionsNow
          ? options.interruptSessionsNow(immediateStopInputSchema.parse(input))
          : await (interruptCurrentRun ? service.interruptCascade(input) : service.stop(input));
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) { return executionErrorResult(error); }
    },
    async agent_execution_roots(input) {
      try {
        const result = await service.roots(input);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) { return executionErrorResult(error); }
    },
  };
}

export function registerExecutionTools(server: McpServer, service: ExecutionService, options: ExecutionToolOptions = {}): void {
  const registration = controlRegistrars.get(server)?.(service);
  const handlers = createExecutionToolHandlers(service, { ...options,
    ...(registration ? { sourceContext: registration.sourceContext } : {}) });
  server.registerTool("agent_execution", {
    description: "既存の実配送/実行参照を送信前に登録、照会、対応終了証拠で更新する。本文や再送queueは保存しない。",
    // MCP accepts a raw object shape; the handler enforces the stricter action
    // union, including required fields and forbidden fields for each action.
    inputSchema: { action: z.enum(["register", "status", "finish"]),
      reservation: executionReservationSchema.optional(), source_session_id: z.string().nullable().optional(),
      request: executionRequestSchema.optional(), evidence: executionFinishSchema.shape.evidence.optional(),
      remote: z.never().optional() },
    outputSchema: executionRecordSchema.shape,
  }, async (args, extra) => handlers.agent_execution(args, extra));
  server.registerTool("agent_stop", {
    description: options.interruptSessionsNow
      ? "指定sessionと記録済み呼出先へ末端からEscapeを送る。sentはキー送信結果で中断完了証明ではない。会話を閉じず、失敗を個別に返す。"
      : "現在処理の中断・会話維持を診断する旧v2 control。",
    inputSchema: options.interruptSessionsNow ? immediateStopInputSchema.shape : { ...cascadeInterruptRequestSchema.shape, remote: z.never().optional() },
    outputSchema: options.interruptSessionsNow ? immediateStopResultSchema.shape : cascadeInterruptResultObjectSchema.shape,
  }, async (args: unknown) => handlers.agent_stop(args));
  server.registerTool("agent_execution_roots", {
    description: "指定席の現在launchと保存済み未完了branchの実世代/期待世代を読む。過去完了履歴は返さず、停止や登録は行わない。",
    inputSchema: { ...executionRootsRequestSchema.shape, remote: z.never().optional() },
    outputSchema: executionRootsResultObjectSchema.shape,
  }, async args => handlers.agent_execution_roots(args));
  registration?.activate();
}

/** Wrapper for the registered launch/send path. A successful action receipt
 * survives failure to bind the metadata after the action. The caller must keep
 * observing the accepted action and use status only for the uncertain relation;
 * it must not resend just because execution_error is present.
 */
export async function runBoundExecution(service: ExecutionService, meta: unknown, stage: "launch" | "send",
  body: () => Promise<{ result: ToolResult; target: ExecutionPoint }>, targetSessionId?: string): Promise<ToolResult> {
  return runExecutionReceipt(service, meta, stage, body, targetSessionId, false);
}

/** The native tmux/psmux gate is installed for this body. Preflight and idle
 * waits remain preparing; the first native effect commits the shared slot.
 */
export async function runDeferredBoundExecution(service: ExecutionService, meta: unknown, stage: "launch" | "send",
  targetSessionId: string, body: () => Promise<{ result: ToolResult; target: ExecutionPoint | null }>,
  admission?: () => void): Promise<ToolResult> {
  return runExecutionReceipt(service, meta, stage, body, targetSessionId, true, admission);
}

async function runExecutionReceipt(service: ExecutionService, meta: unknown, stage: "launch" | "send",
  body: () => Promise<{ result: ToolResult; target: ExecutionPoint | null }>, targetSessionId: string | undefined,
  deferred: boolean, admission?: () => void): Promise<ToolResult> {
  let observed: ToolResult | undefined;
  try {
    const ref = executionRefFromMeta(meta);
    if (!ref) throw new ExecutionError("EXECUTION_INVALID");
    const run = async () => {
      const action = await body();
      if (!deferred) observed = action.result;
      return { value: action.result, target: action.target };
    };
    const result = deferred
      ? await service.invokeDeferred(ref, stage, async (issue, prepare) => {
        let expectedServer: ExecutionNativeServer | null | undefined;
        const action = await withExecutionEffectScope(targetSessionId!, issue, () => {
          const native = service.managementCloseNative(ref);
          if (native) bindExecutionManagementCloseTarget(targetSessionId!, native);
          return run();
        }, stage === "launch" ? {
          prepare: () => { expectedServer = service.prepareCreation(ref); return expectedServer; },
          verifyServer: () => { if (expectedServer === undefined) throw new ExecutionError("EXECUTION_UNSUPPORTED"); service.verifyCreationServer(ref, expectedServer); },
          native: (session, nativeId, serverPid) => { if (expectedServer === undefined) throw new ExecutionError("EXECUTION_UNSUPPORTED");
            return service.captureCreatedNative(ref, session, nativeId, expectedServer, serverPid); },
          launch: launch => service.bindCreatedLaunch(ref, launch),
        } : undefined, prepare, body => service.admitNative(body));
        // A swallowed native refusal poisons the frame. Only a cleanly returned
        // frame has a genuine successful action receipt to preserve on binding.
        observed = action.value;
        return action;
      }, targetSessionId!, admission)
      : await service.invoke(ref, stage, async () => {
        const action = await run();
        return { value: action.value, target: executionPointSchema.parse(action.target) };
      }, targetSessionId);
    return { ...result.value, _meta: { ...result.value._meta, ...executionBindingMeta(result.record) } };
  } catch (error) {
    const failure = executionErrorResult(error);
    if (observed) return { ...observed, _meta: { ...observed._meta,
      [EXECUTION_ERROR_META_KEY]: failure._meta[EXECUTION_ERROR_META_KEY] } };
    return failure;
  }
}
