// Existing serving request reference, captured by product code, never a tool
// argument or a latest-active-job lookup. No issued native callback is stored.
import { AsyncLocalStorage } from "node:async_hooks";
import { executionRequestSchema, executionPointSchema, type ExecutionRequest, type ExecutionPoint } from "./execution-contract.js";

export interface ExecutionIngress {
  source: ExecutionPoint | null;
  client_name: string | null;
  native_identity: { pid: number; started_identity: string } | null;
  // Native SDK metadata, never the tool's arguments. Not persisted or exposed.
  metadata: unknown;
}
const requests = new AsyncLocalStorage<{ request: ExecutionRequest; ingress: ExecutionIngress | null }>();
export function withExecutionRequest<T>(input: ExecutionRequest, body: () => T, ingress?: ExecutionIngress): T {
  const fixed = ingress ? structuredClone(ingress) : null;
  if (fixed?.source) fixed.source = executionPointSchema.parse(fixed.source);
  return requests.run({ request: executionRequestSchema.parse(input), ingress: fixed }, body);
}
export function currentExecutionRequest(): ExecutionRequest | null {
  const context = requests.getStore();
  return context ? structuredClone(context.request) : null;
}
export function currentExecutionIngress(): { request: ExecutionRequest; ingress: ExecutionIngress | null } | null {
  const context = requests.getStore();
  return context ? structuredClone(context) : null;
}
