# Resume-only admission on the ordinary launch contact

## Function map

| Function | Owner | Contract |
|---|---|---|
| Prior working selection | Execution/Molly | Existing saved activity selects targets; hibernation alone never proves prior activity |
| Existing agent_launch | Native | Optional require_existing_resume:true requires session_name and no prompt/images/Throughline fork; omitted/false preserves ordinary behavior |
| Locked admission | Native existing agent send lock | Load current saved target/lifecycle/recipe inside lock; absent/invalid/changed/unsupported returns typed unavailable without reaching fresh creation |
| Same-conversation resume | Existing native/harness adapters | Retain all recipe/config/lifecycle guards; existing eligible Claude/Codex recovery only; old process survival not required |
| Resume readiness budget | `core.resumeAgentInLock` | Default Codex resume and eligible failed-resume recovery allow50s for native redraw plus stable readiness. Explicit caller deadlines, including0, override it; other harnesses retain30s. This is a readiness phase budget, not a whole-RPC deadline. |
| Actual resume result | Original ordinary caller | Existing launch ready/not_requested on success; actual resume-start uncertainty keeps existing error semantics |

## Data flow

Execution saved prior-working reference -> agent_launch(session_name,harness,require_existing_resume:true,no prompt) -> existing per-session send lock -> current saved eligible recipe. Missing/invalid/unsupported -> isError:true _meta[aiterm/resume_unavailable] {schema:aiterm.agent-resume-unavailable.v1,code:AGENT_RESUME_UNAVAILABLE,session_id,outcome:unavailable,effect:not_started,input:not_sent}. This effect is only the requested resume, never old business effects. There is no edge from this refusal to fresh launch.

Eligible recipe -> existing config validation -> existing resumeAgentInLock -> existing same-vendor conversation/new native launch/readiness -> ordinary aiterm.agent-launch-result.v1 startup.ready + initial_prompt.not_requested. Existing UNCONFIRMED/FAILED after actual resume admission retain uncertainty and are not converted to not_started. No summary/input is sent by this native flag. Parent callback and once-summary are execution ownership.

0.63.14 timing: caller timeout (if present) -> unchanged explicit readiness budget; otherwise current metadata.kind=codex ->50s, other kinds ->30s -> existing prepareAgentInput or completeFailedCodexResume -> unchanged stable samples/deadline/native proof -> ready or existing failed/inspect-session result. A partial draw no longer requires the launch-echo predicate to obtain the50s Codex resume budget. Fresh launch and subsequent ordinary dispatch retain their existing30s defaults. Current native/recipe/failed-resolution ownership and the source of every recovery decision remain unchanged.

The flag skips opportunistic idle-clock maintenance in the tool handler so a refused request does not first mutate another seat. No new store, provider fallback, historical lookup, process-survival gate or production action. Focused case: MCP missing/invalid/unsupported target cannot create a fresh native session; metadata may disappear before the call; a valid saved recipe follows existing guarded branch. Source and docs ship together.

Wire compatibility: error structuredContent is validated as success by SDK1.29 Client.callTool. The new unavailable envelope is therefore in typed _meta[aiterm/resume_unavailable], without structuredContent; success outputSchema remains unchanged. Caller retains this typed field.

Remote boundary: this new flag is local-only; remote requests are rejected before connection because an older remote server could strip the unknown optional flag and launch fresh. No capability negotiation or remote fallback is added.


## 0.63.9: saved working conversation after native loss

Function change: only require_existing_resume admission may prepare a saved working target with no lifecycle. Under the same send lock, require matching harness, captured vendor UUID, no resume attempt, and a known native snapshot with the requested name absent. refreshAgentResumeRecipe must produce a complete recipe and confirmedAgentResumeRecipe must accept it. Codex uses existing captureCodexRecoveryProof, which pins the inherited conversation without requiring old task completion; no input is replayed. Unknown native absence, live target, missing vendor/config or mismatches refuse unchanged.

DFD: saved metadata/confirmed template -> fresh recipe -> existing Codex cold proof -> candidate hibernated lifecycle -> existing recipe/config checks -> metadata/native absence recheck -> same lifecycle file -> existing resumeAgentInLock -> normal readiness/new-launch receipt. Ordinary flag-absent launch and idle-timeout stop/write path stay unchanged.

Lifecycle representation: add an explicit origin:restart variant of the existing v1 hibernated record with the same launch/socket/recipe/proof/at/anchor fields, without old pane/native identity. It asserts verified absence and resumable configuration, not a successful idle stop or a surviving old worker. Do not fabricate PID/argv/native fields for a disappeared process. Existing idle record schema remains unchanged and strict. This is an additive record variant in the same native-owned store, no migration/new store. Older0.63.8 cannot read this new variant; do not roll it back mid-resume as a recovery action.

One focused native fixture case: working Codex without lifecycle/recipe, native killed retaining metadata -> missing vendor refused -> valid saved UUID/recipe resumes same conversation with a new launch; existing idle-hibernated path still resumes. No live vendor/auth/production targets or old test sweep.

The resume-only caller retains the existing queue/file lock and launch identity recheck, but passes the existing pinResume=false option: a disappeared old native must not be pinned before the locked absence/recipe decision. The resumed native is still created and verified by the existing resume path, including withAgentResumeTarget after readiness. Ordinary callers retain pinResume=true.

Preparation retains assertExecutionResumeSupported before refreshing recipe/proof and the existing withExecutionPreparation gate when committing lifecycle. Config mismatch still refuses before lifecycle commit or native creation.


## 0.63.10: launch-bound identity and retained default effort

Function map: require-existing preparation first proves native absence, then the existing strict Codex root resolver supplies a unique non-fork/newline-complete/cwd-matching launch-marked rollout and its current turn_context. Existing bindCodexTranscriptSession binds its UUID; the native owner retains the proven model and explicit effort or an explicit vendor_default origin for null effort. Missing/mixed/partial evidence refuses. Claude and ordinary launch are unchanged.

DFD: saved working metadata -> locked absent-native admission -> strict retained root + same-turn configuration -> UUID binding/model + confirmed template with optional reasoning_effort_source:vendor_default -> existing recipe/cold proof -> final metadata/native recheck -> existing resume. vendor_default is accepted only for Codex with null effort; absence of the marker remains incomplete configuration. Resume supplies the retained model and omits an effort override, under existing keepingCodexDefaults so normal configuration defaults are preserved. No guessed effective effort or fresh fallback. Pinned effort and idle-hibernation retain their existing paths.

One changed-contact case covers killed unbound working/default effort -> same UUID resume, missing/mixed/incomplete root rejection, unchanged pinned/idle path and canonical input preservation. The original failed lab request is not retried or reclassified.

Retained-root configuration reads use the existing16MiB transcript increment bound; larger or changing roots refuse rather than allocating unbounded data. Explicit later configuration clears the vendor-default marker. The existing readiness/template and recipe outputs retain that marker across generation changes.
