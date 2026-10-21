// Request-local adapter for the serving stdio dispatcher. No live I/O, core
// imports or public mount at import. Uncovered ordinary/native/remote targets
// fail before the handler; they must acquire their own generation adapter.
import { executionLaunchSchema, executionPointSchema, executionRequestSchema,
  type ExecutionPoint } from "./execution-contract.js";
import { ExecutionService } from "./execution-service.js";
import { executionSourceFromEnvironment } from "./execution-runtime.js";
import { runDeferredBoundExecution } from "./execution-tools.js";
import { ExecutionError, executionErrorResult, executionRefFromMeta, executionHostSourceFromMeta,
  EXECUTION_REQUEST_META_KEY, type ExecutionTransportSource } from "./execution-wire.js";
import { EXECUTION_SOURCE_META_KEY } from "./execution-wire.js";
import { withExecutionRequest } from "./execution-context.js";

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
}

export function createExecutionDispatcher(bindings: ExecutionDispatcherBindings): {
  dispatch(name: string, args: Arguments, extra: Extra,
    body: (fixedArgs: Arguments, fixedExtra: Extra) => Promise<ToolResult>): Promise<ToolResult>;
} {
  const environment = { ...bindings.sourceEnvironment };
  const directSource = executionSourceFromEnvironment(environment);
  const native = bindings.nativeIdentity && { ...bindings.nativeIdentity };
  const directSeat = environment.AITERM_SESSION_ID ?? environment.AITERM_AGENT_SESSION_ID ?? null;
  const sourceFieldsPresent = ["AITERM_SESSION_ID", "AITERM_AGENT_SESSION_ID", "AITERM_AGENT_LAUNCH_ID"]
    .some(name => environment[name] !== undefined);
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
    async dispatch(name, input, extra, body) {
      try {
        bindings.assertParticipant?.();
        // Fix input/transport context synchronously, before any async lookup.
        // Handlers must consume these copies, not their mutable ingress object.
        const args = structuredClone(input), fixedExtra = { ...extra,
          requestId: extra.requestId, _meta: extra._meta === undefined ? undefined : structuredClone(extra._meta) };
        const route = routeFor(name, args);
        if (!route) return await body(args, fixedExtra);
        const client = bindings.initializedClientName();
        const host = executionHostSourceFromMeta(fixedExtra._meta, client);
        const source = host !== undefined ? host.source : directSource;
        // Partial/mismatched stdio identity is not an independent operator.
        if (host === undefined && sourceFieldsPresent && !source) throw new ExecutionError("EXECUTION_UNCONFIRMED");
        const context: ExecutionTransportSource = { schema: "aiterm.execution-source.v1", source };
        const supplied = executionRefFromMeta(fixedExtra._meta);
        if (args.remote !== undefined && args.remote !== null) throw new ExecutionError("EXECUTION_UNSUPPORTED");
        let reference = supplied;
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
        } else {
          // BellTeam must retain its existing delivery/room/call reference.
          if (client === "bellteam" || !native) throw new ExecutionError("EXECUTION_UNSUPPORTED");
          const current = await observe(route.target);
          if (route.stage === "send" && !current.point) throw new ExecutionError("EXECUTION_STALE_GENERATION");
          const request = executionRequestSchema.parse({ kind: "mcp", process_pid: native.pid,
            process_started_identity: native.started_identity, request_id: fixedExtra.requestId,
            tool: route.tool, target_session_id: route.target });
          await bindings.service.execute({ action: "register", source_session_id: source?.launch.session_id ?? directSeat,
            reservation: { schema: "aiterm.execution-reservation.v1", request,
              source: { launch: source?.launch ?? null, boundary: source?.boundary ?? null },
              target: { session_id: route.target, expected_launch_id: current.point?.launch.launch_id ?? null } } }, context);
          reference = { schema: "aiterm.execution-ref.v1", request };
        }
        const status = await bindings.service.execute({ action: "status", request: reference.request });
        const expected = status.relation.target?.launch ?? (status.reservation.target.expected_launch_id
          ? { session_id: route.target, launch_id: status.reservation.target.expected_launch_id } : null);
        const requestMeta = { ...(fixedExtra._meta as Record<string, unknown> | undefined), [EXECUTION_REQUEST_META_KEY]: reference };
        return await runDeferredBoundExecution(bindings.service, requestMeta, route.stage, route.target, async () => {
          const result = await withExecutionRequest(reference!.request, () => body(args, { ...fixedExtra, _meta: requestMeta }), {
            source: status.source.status === "verified" ? status.source.point : null,
            client_name: client ?? null, native_identity: native,
            metadata: fixedExtra._meta === undefined ? null : fixedExtra._meta,
          });
          if (result.isError) throw new ExecutionError("EXECUTION_UNCONFIRMED");
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
            }
          } catch { /* preserve receipt and let service mark binding unknown */ }
          return { result, target };
        });
      } catch (error) { return executionErrorResult(error); }
    },
  };
}
