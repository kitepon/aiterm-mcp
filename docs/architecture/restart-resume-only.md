# Resume-only admission on the ordinary launch contact

## Function map

| Function | Owner | Contract |
|---|---|---|
| Prior working selection | Execution/Molly | Existing saved activity selects targets; hibernation alone never proves prior activity |
| Existing agent_launch | Native | Optional require_existing_resume:true requires session_name and no prompt/images/Throughline fork; omitted/false preserves ordinary behavior |
| Locked admission | Native existing agent send lock | Load current saved target/lifecycle/recipe inside lock; absent/invalid/changed/unsupported returns typed unavailable without reaching fresh creation |
| Same-conversation resume | Existing native/harness adapters | Retain all recipe/config/lifecycle guards; existing eligible Claude/Codex recovery only; old process survival not required |
| Actual resume result | Original ordinary caller | Existing launch ready/not_requested on success; actual resume-start uncertainty keeps existing error semantics |

## Data flow

Execution saved prior-working reference -> agent_launch(session_name,harness,require_existing_resume:true,no prompt) -> existing per-session send lock -> current saved eligible recipe. Missing/invalid/unsupported -> isError:true _meta[aiterm/resume_unavailable] {schema:aiterm.agent-resume-unavailable.v1,code:AGENT_RESUME_UNAVAILABLE,session_id,outcome:unavailable,effect:not_started,input:not_sent}. This effect is only the requested resume, never old business effects. There is no edge from this refusal to fresh launch.

Eligible recipe -> existing config validation -> existing resumeAgentInLock -> existing same-vendor conversation/new native launch/readiness -> ordinary aiterm.agent-launch-result.v1 startup.ready + initial_prompt.not_requested. Existing UNCONFIRMED/FAILED after actual resume admission retain uncertainty and are not converted to not_started. No summary/input is sent by this native flag. Parent callback and once-summary are execution ownership.

The flag skips opportunistic idle-clock maintenance in the tool handler so a refused request does not first mutate another seat. No new store, provider fallback, historical lookup, process-survival gate or production action. Focused case: MCP missing/invalid/unsupported target cannot create a fresh native session; metadata may disappear before the call; a valid saved recipe follows existing guarded branch. Source and docs ship together.

Wire compatibility: error structuredContent is validated as success by SDK1.29 Client.callTool. The new unavailable envelope is therefore in typed _meta[aiterm/resume_unavailable], without structuredContent; success outputSchema remains unchanged. Caller retains this typed field.

Remote boundary: this new flag is local-only; remote requests are rejected before connection because an older remote server could strip the unknown optional flag and launch fresh. No capability negotiation or remote fallback is added.
