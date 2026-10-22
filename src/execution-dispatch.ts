// Request-local adapter for the serving stdio dispatcher. No live I/O, core
// imports or public mount at import. Uncovered ordinary/native/remote targets
// fail before the handler; they must acquire their own generation adapter.
import { executionLaunchSchema, executionPointSchema, executionRequestSchema,
  type ExecutionPoint, type ExecutionRequest } from "./execution-contract.js";
import { ExecutionService } from "./execution-service.js";
import { executionSourceFromEnvironment } from "./execution-runtime.js";
import { runDeferredBoundExecution, type ExecutionControlRegistration } from "./execution-tools.js";
import { ExecutionError, executionErrorResult, executionRefFromMeta, executionHostSourceFromMeta,
  EXECUTION_REQUEST_META_KEY, EXECUTION_ERROR_META_KEY, type ExecutionTransportSource } from "./execution-wire.js";
import { EXECUTION_SOURCE_META_KEY } from "./execution-wire.js";
import { withExecutionRequest, type ExecutionIngress } from "./execution-context.js";
import { readExecutionSendBoundary } from "./execution-effect.js";

type ToolResult = {
  content: { type: "text"; text: string }[]; isError?: boolean;
  structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown>;
};
type Arguments = Record<string, unknown>;
type Extra = { requestId?: unknown; _meta?: unknown; [key: string]: unknown };
type NativeRequest = Extract<ReturnType<typeof executionRequestSchema.parse>, { kind: "mcp" }>;
type Route = { tool: NativeRequest["tool"]; target: string; stage: "launch" | "send" };
const launches = new Set(["agent_launch", "claude_agent", "codex_agent", "grok_agent"]);
const reads = new Set(["diagnostics", "pty_list", "pty_read", "pty_observe", "agent_models"]);
const controls = new Set(["agent_execution", "agent_execution_roots", "agent_stop"]);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function routeFor(name: string, args: Arguments): Route | null {
  if (reads.has(name)) return null;
  if ((name === "agent_approval" || name === "claude_approval") && args.action === "inspect") return null;
  if (name === "claude_turn" && args.action === "recover") return null;
  if (name === "agent_auth" && args.action === "status" && args.session_id === undefined) return null;
  let tool: string = name;
  if (["agent_auth", "agent_approval", "claude_approval", "claude_turn"].includes(name)) {
    const actions = name === "agent_auth" ? ["start", "status", "cancel"]
      : name === "claude_turn" ? ["issue"] : ["respond"];
    if (!actions.includes(String(args.action))) throw new ExecutionError("EXECUTION_INVALID");
    tool += "." + args.action;
  }
  const nativeTool = executionRequestSchema.options[4].shape.tool.safeParse(tool);
  if (!nativeTool.success) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const target = launches.has(name) ? args.session_name : name === "pty_open" ? args.name : args.session_id;
  // Automatic names are selected inside existing core today. Do not guess the
  // future name or act before reserving it at the actual selection boundary.
  if (target === undefined || target === null) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const session = executionLaunchSchema.shape.session_id.safeParse(target);
  if (!session.success) throw new ExecutionError("EXECUTION_INVALID");
  return { tool: nativeTool.data, target: session.data, stage: launches.has(name) ? "launch" : "send" };
}

// The SDK signal belongs to this serving RPC, not to a whole CLI turn. Keep
// an immediate local gate while the shared metadata lock may be awaiting I/O.
// The durable tombstone also fences later parent-return workers. Neither path
// sends a key, closes a session, or discards an issued action's late receipt.
function requestCancellation(service: ExecutionService, request: ExecutionRequest, input: unknown) {
  if (input === undefined) return undefined;
  if (!(input instanceof AbortSignal)) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const signal = input;
  let cancelled = signal.aborted;
  let pending: Promise<void> | undefined;
  let failure: unknown;
  const persist = () => {
    pending = service.cancelRequestActions(request).catch(error => { failure = error; });
  };
  const abort = () => { cancelled = true; persist(); };
  signal.addEventListener("abort", abort, { once: true });
  if (cancelled) persist();
  return {
    assert() { if (cancelled) throw new ExecutionError("EXECUTION_STOPPING"); },
    async finish() {
      signal.removeEventListener("abort", abort);
      if (!cancelled) return;
      await pending;
      // Cancellation may have arrived before register created the record.
      // Reconcile the same ref only; do not retry any native action.
      await service.cancelRequestActions(request);
      if (failure) throw failure;
    },
  };
}

export interface ExecutionDispatcherBindings {
  service: ExecutionService;
  // Snapshot the existing native identity of this serving stdio process. The
  // product adapter uses readProcessIdentities([process.pid]); never a random
  // ID, wall clock estimate or PID alone. One stdio connection per process.
  nativeIdentity: { pid: number; started_identity: string } | null;
  sourceEnvironment: Readonly<Record<string, string | undefined>>;
  initializedClientName(): string | undefined;
  observeSessionGeneration(session: string): unknown | Promise<unknown>;
  assertParticipant?(): void;
  // Same-process private producer; no tool/meta argument can set this proof.
  captureNativeParent?(): unknown | null;
}

export function createExecutionDispatcher(bindings: ExecutionDispatcherBindings): {
  prepareControlRegistration(service: ExecutionService): ExecutionControlRegistration;
  dispatch(name: string, args: Arguments, extra: Extra,
    body: (fixedArgs: Arguments, fixedExtra: Extra) => Promise<ToolResult>): Promise<ToolResult>;
} {
  const captureNativeParent = bindings.captureNativeParent;
  if (captureNativeParent !== undefined && typeof captureNativeParent !== "function") throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const environment = { ...bindings.sourceEnvironment };
  const directSource = executionSourceFromEnvironment(environment);
  const native = bindings.nativeIdentity && { ...bindings.nativeIdentity };
  const directSeat = environment.AITERM_SESSION_ID ?? environment.AITERM_AGENT_SESSION_ID ?? null;
  const sourceFieldsPresent = ["AITERM_SESSION_ID", "AITERM_AGENT_SESSION_ID", "AITERM_AGENT_LAUNCH_ID"]
    .some(name => environment[name] !== undefined);
  let registeredControls = false;
  const observe = async (session: string): Promise<{ state: "absent" | "present"; point: ExecutionPoint | null }> => {
    const value = await bindings.observeSessionGeneration(session) as Record<string, unknown> | null;
    if (!value || value.schema !== "aiterm.pty-observe-result.v1" || value.session_id !== session
      || typeof value.exists !== "boolean") throw new ExecutionError("EXECUTION_UNCONFIRMED");
    if (!value.exists) {
      if (value.launch_id !== null) throw new ExecutionError("EXECUTION_UNCONFIRMED");
      return { state: "absent", point: null };
    }
    const launch = executionLaunchSchema.safeParse({ session_id: session, launch_id: value.launch_id });
    if (!launch.success) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    return { state: "present", point: { launch: launch.data, boundary: null } };
  };

  return {
    prepareControlRegistration(service) {
      if (service !== bindings.service) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      bindings.assertParticipant?.();
      return { sourceContext: extra => executionHostSourceFromMeta(extra._meta, bindings.initializedClientName()),
        activate: () => { registeredControls = true; } };
    },
    async dispatch(name, input, extra, body) {
      let cancellation: ReturnType<typeof requestCancellation>;
      const run = async (): Promise<ToolResult> => {
        try {
          bindings.assertParticipant?.();
          // Fix input/transport context synchronously, before any async lookup.
          // Handlers must consume these copies, not their mutable ingress object.
          const args = structuredClone(input), fixedExtra: Extra = { ...extra,
            requestId: extra.requestId, _meta: extra._meta === undefined ? undefined : structuredClone(extra._meta) };
          if (controls.has(name)) {
            if (!registeredControls || args.remote !== undefined) throw new ExecutionError("EXECUTION_UNSUPPORTED");
            // Only the same server's registered typed handlers run here. They
            // already own metadata admission/stop; no synthetic send edge/frame.
            executionHostSourceFromMeta(fixedExtra._meta, bindings.initializedClientName());
            return await body(args, fixedExtra);
          }
          const route = routeFor(name, args);
          if (!route) return await body(args, fixedExtra);
          const client = bindings.initializedClientName();
          const host = executionHostSourceFromMeta(fixedExtra._meta, client);
          const source = host !== undefined ? host.source : directSource;
          // Partial/mismatched stdio identity is not an independent operator.
          if (host === undefined && sourceFieldsPresent && !source) throw new ExecutionError("EXECUTION_UNCONFIRMED");
          const context: ExecutionTransportSource = { schema: "aiterm.execution-source.v1", source };
          const supplied = executionRefFromMeta(fixedExtra._meta);
          // A host's explicit session close is a management RPC with its own
          // existing process/request identity, not a delivery or resend.
          const hostClose = client === "bellteam" && route.tool === "pty_close" && !supplied;
          if (args.remote !== undefined && args.remote !== null) throw new ExecutionError("EXECUTION_UNSUPPORTED");
          let reference = supplied;
          let directRequest: NativeRequest | null = null;
          let frozenParent: unknown | null = null;
          if (!reference && (client !== "bellteam" || hostClose) && native) {
            directRequest = executionRequestSchema.options[4].parse({ kind: "mcp", process_pid: native.pid,
              process_started_identity: native.started_identity, request_id: fixedExtra.requestId,
              tool: route.tool, target_session_id: route.target });
            cancellation = requestCancellation(bindings.service, directRequest, fixedExtra.signal);
            cancellation?.assert();
            if (captureNativeParent) {
              const ingress: ExecutionIngress = { source, client_name: client ?? null, native_identity: native,
                metadata: fixedExtra._meta === undefined ? null : fixedExtra._meta };
              const captured = withExecutionRequest(directRequest, captureNativeParent, ingress);
              if (captured && typeof (captured as { then?: unknown }).then === "function") {
                void Promise.resolve(captured).catch(() => undefined); throw new ExecutionError("EXECUTION_UNSUPPORTED");
              }
              frozenParent = captured === null ? null : structuredClone(captured);
            }
          }
          if (reference) {
            // External host refs are created by the real Bridge ingress. Direct
            // model requests cannot borrow another call's reservation or choose
            // a native control label to suppress an invocation edge.
            if (client !== "bellteam" || reference.request.kind === "mcp"
              || (route.tool !== "agent_launch" && route.tool !== "pty_send"))
              throw new ExecutionError("EXECUTION_UNSUPPORTED");
            const record = await bindings.service.execute({ action: "status", request: reference.request });
            if (record.reservation.target.session_id !== route.target) throw new ExecutionError("EXECUTION_CONFLICT");
            // register fixed and verified the original HTTP ingress source. The
            // subsequent host launch/send carries that same existing ref, not a
            // new source context requirement. If supplied, an explicit context
            // must still match; absence must not overwrite it with host env/null.
            const hasContext = fixedExtra._meta && typeof fixedExtra._meta === "object"
              && EXECUTION_SOURCE_META_KEY in fixedExtra._meta;
            if (hasContext && (!same(record.reservation.source.launch, source?.launch ?? null)
              || (record.reservation.source.boundary && !same(record.reservation.source.boundary, source?.boundary ?? null)))
            ) throw new ExecutionError("EXECUTION_STALE_GENERATION");
            cancellation = requestCancellation(bindings.service, reference.request, fixedExtra.signal);
            cancellation?.assert();
          } else {
            // BellTeam must retain its existing delivery/room/call reference.
            if ((client === "bellteam" && !hostClose) || !directRequest) throw new ExecutionError("EXECUTION_UNSUPPORTED");
            const current = await observe(route.target);
            if (route.stage === "send" && !current.point) throw new ExecutionError("EXECUTION_STALE_GENERATION");
            const request = directRequest;
            cancellation?.assert();
            await bindings.service.execute({ action: "register", source_session_id: source?.launch.session_id ?? directSeat,
              reservation: { schema: "aiterm.execution-reservation.v1", request,
                source: { launch: source?.launch ?? null, boundary: source?.boundary ?? null },
                target: { session_id: route.target, expected_launch_id: current.point?.launch.launch_id ?? null } } }, context);
            reference = { schema: "aiterm.execution-ref.v1", request };
          }
          cancellation?.assert();
          const status = await bindings.service.execute({ action: "status", request: reference.request });
          const expected = status.relation.target?.launch ?? (status.reservation.target.expected_launch_id
            ? { session_id: route.target, launch_id: status.reservation.target.expected_launch_id } : null);
          const requestMeta = { ...(fixedExtra._meta as Record<string, unknown> | undefined), [EXECUTION_REQUEST_META_KEY]: reference };
          let handlerFailure: ToolResult | undefined;
          const bound = await runDeferredBoundExecution(bindings.service, requestMeta, route.stage, route.target, async () => {
            const result = await withExecutionRequest(reference!.request, () => body(args, { ...fixedExtra, _meta: requestMeta }), {
              source: status.source.status === "verified" ? status.source.point : null,
              client_name: client ?? null, native_identity: native,
              metadata: fixedExtra._meta === undefined ? null : fixedExtra._meta,
              ...(captureNativeParent ? { native_parent: frozenParent } : {}),
            });
            if (result.isError) {
              // Keep the original native/handler refusal for the caller. It is
              // still an error, never an accepted receipt or replay permission;
              // the service determines whether an effect crossed its gate.
              handlerFailure = result;
              throw new ExecutionError("EXECUTION_UNCONFIRMED");
            }
            // Missing/invalid binding evidence is returned as null. The wrapper
            // retains the genuine successful receipt if binding then fails; it
            // must not turn a valid accepted action into permission to resend.
            let target: ExecutionPoint | null = null;
            try {
              if (route.tool === "pty_close") target = expected ? { launch: expected, boundary: null } : null;
              else {
                const current = await observe(route.target);
                target = current.point;
                const receipt = result.structuredContent;
                if (receipt && receipt.session_id !== undefined && receipt.session_id !== route.target) target = null;
                else if (receipt?.launch_id !== undefined && receipt.launch_id !== null
                  && receipt.launch_id !== target?.launch.launch_id) target = null;
                if (target && (launches.has(name) || name === "pty_send")) {
                  const cursor = receipt?.event_cursor;
                  const steer = result._meta?.["aiterm/steer"] as Record<string, unknown> | undefined;
                  if (Number.isSafeInteger(cursor) && Number(cursor) >= 0 && receipt?.mode !== "sent") {
                    const candidate = executionPointSchema.safeParse({ launch: target.launch, boundary: {
                      event_cursor: cursor, operation_id: null, turn_id: null,
                      steer_id: receipt?.mode === "agent_steer" ? steer?.steer_id : null } });
                    // An untracked steer is a generation edge, not a fabricated
                    // new dispatch boundary. Preserve its lifetime uncertainty.
                    if (candidate.success) target = candidate.data;
                  }
                }
                const captured = readExecutionSendBoundary(route.target);
                if (target && captured && receipt?.mode !== "agent_steer") {
                  // This came from actual core before_send in the same admitted
                  // request, not args/result.operation_id or a current-file read.
                  // Contradictory successful receipts remain successful receipts,
                  // with unknown binding and no permission to resend.
                  if (!same(captured.launch, target.launch) || receipt?.mode === "sent"
                    || (receipt?.event_cursor !== undefined && receipt.event_cursor !== captured.boundary?.event_cursor)
                    || (receipt?.operation_id !== undefined && receipt.operation_id !== captured.boundary?.operation_id)) target = null;
                  else target = captured;
                }
              }
            } catch { target = null; /* preserve receipt and let service mark binding unknown */ }
            return { result, target };
          }, cancellation?.assert);
          return handlerFailure && bound.isError ? { ...handlerFailure,
            _meta: { ...handlerFailure._meta, ...bound._meta } } : bound;
        } catch (error) { return executionErrorResult(error); }
      };
      const result = await run();
      try { await cancellation?.finish(); }
      catch {
        const failure = executionErrorResult(new ExecutionError("EXECUTION_UNCONFIRMED", "possible"));
        // Preserve a genuine accepted result even when cancellation recording
        // failed. Status-only uncertainty must never become permission to resend.
        return { ...result, _meta: { ...result._meta,
          [EXECUTION_ERROR_META_KEY]: failure._meta![EXECUTION_ERROR_META_KEY] } };
      }
      return result;
    },
  };
}
