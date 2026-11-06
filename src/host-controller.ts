/** Initialize-time routing declaration, never authentication or native-effect proof. */
export const HOST_CONTROLLER_CAPABILITY = "io.github.kitepon/aiterm-mcp/host-controller";
export const LEGACY_HOST_CONTROLLER_NAME = "bellteam";
export const LEGACY_INTERIM_CALLER = "BellTeam";

export function isHostControllerClient(name: string | undefined, capabilities?: unknown): boolean {
  if (name === LEGACY_HOST_CONTROLLER_NAME) return true;
  if (!capabilities || typeof capabilities !== "object") return false;
  const experimental = (capabilities as Record<string, unknown>).experimental;
  if (!experimental || typeof experimental !== "object") return false;
  const role = (experimental as Record<string, unknown>)[HOST_CONTROLLER_CAPABILITY];
  return role !== null && typeof role === "object" && !Array.isArray(role);
}

export function hostControllerLabel(name: string | undefined): string {
  return name?.trim() ? name : "MCP client";
}
