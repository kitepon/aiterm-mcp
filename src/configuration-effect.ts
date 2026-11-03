// Only tracked configuration requests use this local guard; no graph or admission is created.
import { AsyncLocalStorage } from "node:async_hooks";
import { AitermError } from "./errors.js";

type ConfigurationEffectScope = { closed: boolean; failed: boolean; failure?: unknown; beforeEffect(): void };
const requests = new AsyncLocalStorage<ConfigurationEffectScope>();
export function hasConfigurationEffects(): boolean { return requests.getStore() !== undefined; }
export function beforeConfigurationEffect(): void {
  const request = requests.getStore();
  if (!request) return;
  if (request.closed) throw new AitermError("CONFIGURATION_REQUEST_TERMINAL: later input refused", 2);
  if (request.failed) throw request.failure;
  try { request.beforeEffect(); } catch (error) { request.failed = true; request.failure = error; throw error; }
}
export async function withConfigurationEffects<T>(beforeEffect: () => void, body: () => Promise<T>): Promise<T> {
  if (requests.getStore()) throw new AitermError("CONFIGURATION_REQUEST_NESTED", 2);
  const request: ConfigurationEffectScope = { closed: false, failed: false, beforeEffect };
  return requests.run(request, async () => {
    try {
      const value = await body();
      if (request.failed) throw request.failure;
      return value;
    } finally { request.closed = true; }
  });
}
