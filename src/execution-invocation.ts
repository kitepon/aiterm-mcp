// Product-internal action orchestration. The caller owns request decoding and
// receipt rendering; this module neither knows MCP result shapes nor maps errors.
import { executionPointSchema, type ExecutionPoint } from "./execution-contract.js";
import type { ExecutionService } from "./execution-service.js";
import { withExecutionEffectScope, bindExecutionManagementCloseTarget } from "./execution-effect.js";
import type { ExecutionNativeServer } from "./execution-close.js";
import { ExecutionError } from "./execution-wire.js";

export async function invokeExecutionAction<T>(service: ExecutionService, ref: unknown, stage: "launch" | "send",
  body: () => Promise<{ result: T; target: ExecutionPoint | null }>, targetSessionId: string | undefined,
  deferred: boolean, observe: (value: T) => void, admission?: () => void) {
  const run = async () => {
    const action = await body();
    if (!deferred) observe(action.result);
    return { value: action.result, target: action.target };
  };
  return deferred
    ? service.invokeDeferred(ref, stage, async (issue, prepare) => {
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
      observe(action.value);
      return action;
    }, targetSessionId!, admission)
    : service.invoke(ref, stage, async () => {
      const action = await run();
      return { value: action.value, target: executionPointSchema.parse(action.target) };
    }, targetSessionId);
}
