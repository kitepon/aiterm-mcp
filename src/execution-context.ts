// Existing serving request reference, captured by product code, never a tool
// argument or a latest-active-job lookup. No issued native callback is stored.
import { AsyncLocalStorage } from "node:async_hooks";
import { executionRequestSchema, type ExecutionRequest } from "./execution-contract.js";

const requests = new AsyncLocalStorage<ExecutionRequest>();
export function withExecutionRequest<T>(input: ExecutionRequest, body: () => T): T {
  return requests.run(executionRequestSchema.parse(input), body);
}
export function currentExecutionRequest(): ExecutionRequest | null {
  const request = requests.getStore();
  return request ? structuredClone(request) : null;
}
