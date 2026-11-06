# Host-controller MCP identity

## Function map

| Component | Ownership and I/O |
|---|---|
| host-controller.ts | One host-controller predicate on initialized client name/capabilities. Any MCP client declares capabilities.experimental["io.github.kitepon/aiterm-mcp/host-controller"]={}. Exact legacy name bellteam remains a compatibility alias. Neither is authentication. |
| execution-participant/dispatch | Obtain capability from serving SDK initialization; use predicate for existing host management/reference routing. Never accept the role from tool args or request metadata. All source, generation, cancellation and effect guards unchanged. |
| execution-wire/agent-goal | Same predicate admits existing host-source and user-origin metadata; all closed schema checks remain. |
| interim-words/index | A declared controller opts in with request _meta["aiterm/caller"] equal to its actual initialized name; blank name uses "MCP client". Legacy "BellTeam" marker remains accepted exactly as before. No fixed label for new controllers. |

## Data flow

MCP initialize clientInfo.name + capabilities.experimental -> serving SDK -> single predicate -> existing host source/management/reference flow OR unchanged ordinary direct flow. No capability and no legacy name -> direct; malformed role is not a declaration. Self-declared role never supplies source/effect/generation proof.

Controller actual initialized name -> request caller marker -> existing interim/follow/seat-turn metadata. No marker -> no extra metadata. Legacy marker compatibility is retained independently, as before; it is not authorization.

A single changed-contact case covers declared non-bellteam routing, undeclared direct routing, existing BellTeam routing, closed host-source/goal checks and dynamic interim label. Existing require_existing_resume input/output is unchanged. Separate0.63.11 publication; no installed or production operation.
