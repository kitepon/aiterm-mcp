# Request-bound configuration and reconciliation

This contract applies only when the new request fields are supplied to `agent_configure`. Existing calls keep their existing result and error shapes. It cannot recover an old request whose original ID or launch was not retained.

Before the **first** call, the consumer durably saves the original settings, a UUID `id`, the observed target `launch_id`, and the request `digest`. It must first inspect the exact connected server's tool schema: `agent_configure` must advertise `action` with `apply`/`reconcile`, the `request` object below, and output schema `aiterm.agent-configure-request-result.v1`. Check the approved package/version on that same connection. Do not send a tracked apply to an older server: older schemas can silently discard unknown fields and apply without tracking. Missing capability means local not-issued; never fall back to an untracked call. The ID is not an authorization credential; existing management access remains required.

```json
{
  "action": "apply",
  "session_id": "original-seat",
  "request": {
    "id": "ea1dbfa0-c370-4dd7-a209-21325b1be447",
    "launch_id": "11111111111111111111111111111111",
    "digest": "<64 lowercase hexadecimal characters>"
  },
  "model": "requested-model",
  "reasoning_effort": "high",
  "fast": false
}
```

The digest is SHA256 of UTF-8 `JSON.stringify({model,reasoning_effort,fast})`, with keys in that order. Model/effort are trimmed strings or null for missing/null/empty; fast is boolean or null for missing/null. Values are limited to 512 characters. `configurationRequestDigest` in `dist/configure-request.js` implements this exact canonicalization. Persist this binding before issuing the RPC; do not replace it after a timeout. JSON-RPC IDs alone do not identify a request across connections.

Tracked apply exclusively claims `configuration-requests/<id>/receipt.json` in the product state root, then uses the existing file-and-directory-sync checkpoint before invoking the original configuration handler. Each first native mutation marks possible and syncs before input. Failure poisons that local request; neither subsequent cleanup nor a late continuation can issue native input through it. The completed handler, including its finally/goal restoration, is recorded before returning. An existing ID only reads the original record and never invokes configuration again; a changed session/launch/digest is a conflict. A partially created claim is unavailable and cannot replay. Receipts remain until the product state is explicitly disposed; retaining them prevents late duplicate requests from becoming new work. They contain settings and safe result fields, not prompts, credentials, screen output or raw exception text. No general execution graph is created.

Tracked apply currently requires POSIX file/directory sync. Native Windows returns unsupported before applying; legacy `agent_configure` is unchanged. Tracked remote calls are refused before any SSH connection, since forwarding to an old server could silently remove the request binding. Use the exact local consumer connection on the target runtime. This limitation does not authorize replacing a running consumer or changing its connection.

To reconcile, send only the original binding:

```json
{
  "action": "reconcile",
  "session_id": "original-seat",
  "request": {"id":"ea1dbfa0-c370-4dd7-a209-21325b1be447","launch_id":"11111111111111111111111111111111","digest":"<original digest>"}
}
```

Model, effort and fast are forbidden in reconcile. The reader does not create a state root, resume work, send UI keys, invoke vendor commands, register a participant or modify a receipt. It may read across a new MCP connection to the same approved state scope. It returns `aiterm.agent-configure-request-result.v1`:

| Field | Meaning |
| --- | --- |
| `binding` | Exact original ID, session, launch and digest; never a current/latest guess |
| `request_state` | `terminal`, `pending_or_unknown`, `not_recorded`, or `unavailable` |
| `outcome` | Historical `applied`, `not_applied`, or `outcome_unknown`; not a current settings snapshot |
| `terminal_at` | Saved handler/finally completion time, otherwise null |
| `result` | Original successful configure result, otherwise null; its model/effort retain their existing requested-value semantics |
| `later_effect` | `excluded` for saved terminal requests with no native mutation issued, or refused by the Claude model picker before its selection key with the picker read closed afterwards; otherwise `unconfirmed` |
| `current` | `{ "availability": "unsupported" }`; no UI preview is performed |
| `observed_at` | Time this receipt was read |

Any other native mutation, including menu preparation, keeps `later_effect=unconfirmed` even if the handler succeeds or the visible model matches. The one exception is a Claude `/model` picker refusal (`not_applied`): only `s` and the switch confirmation's Enter select a setting, Aiterm sends neither before refusing, and it reads the picker and confirmation closed after its Esc. The receipt then stores `native_effect: "selection_excluded"`; older Aiterm cannot parse that value and reads the receipt as `unavailable`. A refusal whose picker stays open keeps `possible`.

A Claude picker refusal also carries `_meta["aiterm/configure_error"]` = `{"code": "<CODE>", "relaunch": <bool>}` on both tracked and untracked calls. `relaunch: true` means the model is in the native catalog but this live session cannot take it (`CLAUDE_MODEL_NOT_IN_PICKER`, `CLAUDE_MODEL_NOT_SELECTABLE`, `CLAUDE_MODEL_SESSION_ONLY_UNAVAILABLE`): a launch or resume with that model can apply it. A session's alias picker may resolve an alias to an older model than the catalog (Fable → Fable 5.1 while the catalog names Fable 5.2); Aiterm matches the catalog's model, so such a request is refused with `relaunch: true` instead of selecting the older row. A native send acknowledgment does not prove input consumption. Pending records remain uncertain after process exit or restart. Missing/corrupt records are not proof of non-admission: an original packet could still arrive. Receipt loss, elapsed time, a completed goal/turn or a new current launch must not authorize replay or uncertainty removal. The local terminal guard prevents new Aiterm continuations; it cannot retract already issued native input. Removing product state also removes duplicate protection and must never be presented as reconciliation.

For a consumer to consider its own fence, the local uncertainty/version and original binding must still match, and native `request_state=terminal` plus `later_effect=excluded` must both be present. Keep the outcome and desired/current differences separate. This product receipt does not itself delete consumer flags or authorize a message, restart, stop or reconfiguration. `later_effect=unconfirmed` is not a request to retry.

## Existing incidents and explicit recovery

There is no existing public read-only operation that recovers a configuration request whose ID/launch were never retained. This feature does not assign retrospective IDs or infer them from current settings. A consumer's `BOT_SESSION_UNCONFIRMED` remains its own safety fence.

If the original operation cannot be conclusively recovered, replacing the session is a separate explicit operation: the owner must first decide when active work/goal may be interrupted, which transcript/worktree/metadata to retain, who controls the old CLI and late requests, and how a new CLI resumes saved work. A close/restart can interrupt a live goal and lose uncommitted in-memory CLI context. `pty_close` is destructive to product session state and ordinary log/read positions; it is not a log-preserving recovery and must not be proposed as if it retained everything. A normal vendor quit can preserve vendor history but ends the running CLI; it also does not, by itself, fence an uncertain management request or repair consumer bookkeeping. An owner-approved recovery must confirm old request/connection quiescence and respect the consumer's own recovery contract before reusing a name. No such real-seat operation is part of this release.

The implementation/ownership diagram is [model configuration](https://github.com/kitepon/aiterm-mcp/blob/main/docs/architecture/model-configuration.md). Direct tests cover original binding, pre-input durable admission, duplicate/late requests, corrupt/missing receipts, process exit, checkpoint refusal, post-terminal continuation refusal, ordinary MCP errors and a fake Codex on an isolated native PTY. They do not prove real provider behavior or recovery of an existing incident.
