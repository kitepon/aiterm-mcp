#!/usr/bin/env node
// Claude machine host (a471, ruling 13). Runs in the seat's native session (tmux / psmux): it only holds one resident
// `claude -p --input-format stream-json --output-format stream-json` process and its pipes. It does not render or interpret the stream:
//   - every stdout line of claude is appended, unchanged, to the stream file;
//   - every line Aiterm appends to the input file is written, unchanged, to claude's stdin;
//   - a small state file (idle / busy / blocked ...) is derived from the events, for Aiterm's own observers.
// Contract: docs/architecture/claude-machine-stream.md.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { CLAUDE_MACHINE_FLAGS, type ClaudeMachineState, type ClaudeMachineReason, type ClaudeMachineStateFile, type ClaudeMachinePending } from "./claude-machine.js";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ClaudeMachineHostPorts {
  /** One JSON line to claude's stdin. */
  toClaude(line: string): void;
  /** One claude stdout line, appended to the stream file unchanged. */
  appendStream(line: string): void;
  /** The state file, replaced atomically. */
  writeState(state: ClaudeMachineStateFile): void;
  /** Opens the session's transcript for reminder lookup (called once, at the first line that names the session). */
  openTranscript?(sessionId: string, cwd: string): ClaudeTranscriptTail | null;
  now?: () => string;
  id?: () => string;
}

/** Claude's own transcript of the session: only its new lines are read, and only to see a silent_turn_reminder attachment. */
export interface ClaudeTranscriptTail { /** True when a reminder was recorded since the last call. */ poll(): boolean }

export const SILENT_TURN_REMINDER_LINE = JSON.stringify({ type: "system", subtype: "silent_turn_reminder" });

export class ReminderTail implements ClaudeTranscriptTail {
  private offset = 0;
  private carry = "";
  /** Starts at the file's current end, so a reminder from before this launch (resume) is not marked. A missing file starts at 0. */
  constructor(private readonly file: string) { try { this.offset = fs.statSync(file).size; } catch { /* not created yet */ } }
  poll(): boolean {
    let size: number;
    try { size = fs.statSync(this.file).size; } catch { return false; }
    if (size < this.offset) { this.offset = 0; this.carry = ""; }
    if (size === this.offset) return false;
    const fd = fs.openSync(this.file, "r");
    let chunk: string;
    try {
      const buffer = Buffer.alloc(size - this.offset);
      const n = fs.readSync(fd, buffer, 0, buffer.length, this.offset);
      this.offset += n;
      chunk = buffer.subarray(0, n).toString("utf8");
    } finally { fs.closeSync(fd); }
    const lines = (this.carry + chunk).split("\n");
    this.carry = lines.pop() ?? "";
    let found = false;
    for (const line of lines) {
      if (!line.includes("silent_turn_reminder")) continue;
      try { const record = JSON.parse(line); if (record?.type === "attachment" && record.attachment?.type === "silent_turn_reminder") found = true; } catch { /* a half-written or other line */ }
    }
    return found;
  }
}

/** Claude's transcript path: <config root>/projects/<cwd with every non-alphanumeric as "-">/<session id>.jsonl (same rule as harnesses/claude.ts claudeProjectSlug). */
export function claudeTranscriptFile(sessionId: string, cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(env.HOME ?? os.homedir(), ".claude"), "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${sessionId}.jsonl`);
}

export interface ClaudeMachineHostOptions {
  /** A fork seat has nobody to answer an AskUserQuestion: it is denied at once so the fork never holds. */
  denyQuestions?: boolean;
}

export class ClaudeMachineHost {
  private state: ClaudeMachineState = "starting";
  private reason: ClaudeMachineReason | null = null;
  private pending: ClaudeMachinePending[] = [];
  private lastResult: ClaudeMachineStateFile["last_result"] = null;
  private inputBytes = 0;
  private streamBytes = 0;
  private exited = false;
  private turnOpen = false; // a result is still owed for something claude accepted or started
  private awaiting = 0; // user messages sent that no result has covered yet
  private stopHooks = new Set<string>();
  private started: { model: string; effort: string | null } | null = null; // from the get_settings answer
  private permissionMode: string | null = null; // from system/status; the seat starts in bypassPermissions, EnterPlanMode makes it "plan"
  private transcript: ClaudeTranscriptTail | null = null;
  private readonly id: () => string;
  private readonly now: () => string;
  firstPrompt: string | null = null;

  constructor(private readonly ports: ClaudeMachineHostPorts, private readonly options: ClaudeMachineHostOptions = {}) {
    this.id = ports.id ?? (() => randomUUID());
    this.now = ports.now ?? (() => new Date().toISOString());
  }

  private publish(): void {
    this.ports.writeState({ schema: "aiterm.claude-machine-state.v1", state: this.state, reason: this.reason, pending: this.pending,
      input_bytes_consumed: this.inputBytes, last_result: this.lastResult, exited: this.exited, at: this.now(),
      ...(this.started ? { started: this.started } : {}) });
  }

  private set(state: ClaudeMachineState, reason: ClaudeMachineReason | null = null): void {
    if (this.state === state && this.reason === reason) return;
    this.state = state; this.reason = reason;
    this.publish();
  }

  start(): void {
    this.publish();
    this.ports.toClaude(JSON.stringify({ type: "control_request", request_id: `host-${this.id()}`, request: { subtype: "initialize" } }));
  }

  /** The caller's input line, forwarded unchanged; only the state is updated from what it is. */
  onInputLine(raw: string, bytes: number): void {
    this.inputBytes += bytes;
    if (!raw.trim()) { this.publish(); return; }
    let line: Json | null = null;
    try { line = JSON.parse(raw); } catch { /* claude answers a malformed line itself */ }
    this.ports.toClaude(raw);
    if (line?.type === "user") { this.beginTurn(); this.awaiting++; this.turnOpen = true; this.set("busy"); }
    else if (line?.type === "control_response") {
      const before = this.pending.length;
      this.pending = this.pending.filter(p => p.request_id !== line!.response?.request_id);
      if (this.pending.length !== before) this.settleAfterAnswer();
    }
    this.publish();
  }

  /** A new turn starting while no turn is open: the Stop hooks still unanswered belong to the previous turn. claude can leave one unanswered for good
   * (measured 2026-11-24), and waiting for it would keep the seat busy forever. */
  private beginTurn(): void { if (!this.turnOpen) this.stopHooks.clear(); }

  private settleAfterAnswer(): void {
    if (this.pending.length === 0) this.set(this.turnOpen ? "busy" : "idle");
  }

  private append(line: string): void {
    this.ports.appendStream(line);
    this.streamBytes += Buffer.byteLength(line) + 1;
  }

  /** The answer for a request the host gives itself (an unattended seat has nobody to ask), or null when it waits for the caller. */
  private autoAnswer(request: Json): Json | null {
    const tool = String(request.tool_name ?? "");
    if (tool === "ExitPlanMode") // the PermissionRequest hook answers it as option 1 for an unattended seat; same policy here
      return { behavior: "allow", updatedInput: request.input ?? {}, updatedPermissions: [{ type: "setMode", mode: "bypassPermissions", destination: "session" }] };
    if (tool === "AskUserQuestion" && this.options.denyQuestions)
      return { behavior: "deny", message: "This seat is a disposable fork with nobody to answer a question; decide yourself or say what you could not decide." };
    // In plan mode claude asks for every Bash and out-of-directory Read (measured on a production seat; none in bypassPermissions). Nobody
    // answers an unattended seat, so allow them as bypassPermissions would. Only AskUserQuestion needs a person.
    if (this.permissionMode === "plan" && tool !== "AskUserQuestion") return { behavior: "allow", updatedInput: request.input ?? {} };
    return null;
  }

  onChildLine(raw: string): void {
    let event: Json | null = null;
    try { event = JSON.parse(raw); } catch { /* appended below, unchanged */ }
    if (event) {
      if (!this.transcript && typeof event.session_id === "string" && this.ports.openTranscript)
        this.transcript = this.ports.openTranscript(event.session_id, typeof event.cwd === "string" ? event.cwd : process.cwd());
      // The reminder is only in the transcript, written before the request it prompts: read it just before an answer's first lines, so the marker precedes the words.
      const answerStart = event.type === "assistant" || (event.type === "stream_event" && event.event?.type === "message_start");
      if (answerStart && this.transcript?.poll()) this.append(SILENT_TURN_REMINDER_LINE);
    }
    const lineStart = this.streamBytes;
    // A request that waits is listed in the state before its line reaches the stream: a reader that sees the line (stream first, then
    // state) always finds it pending (N102). The offsets are where the line will sit.
    const request = event?.type === "control_request" && event.request?.subtype === "can_use_tool" ? event.request as Json : null;
    if (request && !this.autoAnswer(request)) {
      const tool = String(request.tool_name ?? "");
      this.pending = [...this.pending, { request_id: String(event!.request_id), subtype: "can_use_tool", tool_name: tool || null,
        stream_offset: lineStart, stream_end: lineStart + Buffer.byteLength(raw) + 1 }];
      this.set("blocked", tool === "AskUserQuestion" ? "unknown_dialog" : "tool_approval");
      this.publish();
    }
    this.append(raw);
    if (!event) return;
    switch (event.type) {
      case "control_response": {
        // The answer to the host's own get_settings: the model and effort claude really runs (a default-launched seat never named them).
        const applied = String(event.response?.request_id ?? "").startsWith("host-settings-") && event.response.subtype === "success" ? event.response.response?.applied : null;
        if (applied && typeof applied.model === "string" && applied.model) {
          this.started = { model: applied.model, effort: typeof applied.effort === "string" && applied.effort ? applied.effort : null };
          this.publish();
          return;
        }
        // The initialize reply is the ready signal; it is for the host's own request.
        if (String(event.response?.request_id ?? "").startsWith("host-") && this.state === "starting") {
          if (event.response.subtype === "success") {
            // The thinking text is empty unless asked for: summarized, with no cap on the thinking itself (measured on Opus, Sonnet, Fable).
            this.ports.toClaude(JSON.stringify({ type: "control_request", request_id: `host-${this.id()}`,
              request: { subtype: "set_max_thinking_tokens", max_thinking_tokens: null, thinking_display: "summarized" } }));
            this.ports.toClaude(JSON.stringify({ type: "control_request", request_id: `host-settings-${this.id()}`, request: { subtype: "get_settings" } }));
            this.set("idle");
            if (this.firstPrompt !== null) { const text = this.firstPrompt; this.firstPrompt = null; this.sendUser(text); }
          } else { this.exited = true; this.set("exited"); }
        }
        return;
      }
      case "control_request": {
        const request = (event.request ?? {}) as Json;
        if (request.subtype !== "can_use_tool") return;
        const answer = this.autoAnswer(request);
        if (answer) this.reply(String(event.request_id), answer);
        return; // a request that waits was already listed, before its line was appended
      }
      case "control_cancel_request": {
        const before = this.pending.length;
        this.pending = this.pending.filter(p => p.request_id !== event.request_id);
        if (this.pending.length !== before) { this.publish(); this.settleAfterAnswer(); }
        return;
      }
      case "command_lifecycle": {
        // A queued command starts only after the previous one completed, so what is still unanswered is the previous turn's.
        if (event.state === "started") this.stopHooks.clear();
        return;
      }
      case "system": {
        if (event.subtype === "status" && typeof event.permissionMode === "string") this.permissionMode = event.permissionMode;
        if (event.hook_event === "Stop" && event.subtype === "hook_started") this.stopHooks.add(String(event.hook_id));
        if (event.hook_event === "Stop" && event.subtype === "hook_response") { this.stopHooks.delete(String(event.hook_id)); this.settle(); }
        return;
      }
      case "assistant": case "stream_event": case "user": {
        if (event.type !== "user" && (this.state === "idle" || this.state === "starting")) { this.turnOpen = true; this.set("busy"); }
        return;
      }
      case "result": {
        this.lastResult = { at: this.now(), subtype: event.subtype ?? null, terminal_reason: event.terminal_reason ?? null, is_error: event.is_error === true };
        this.awaiting = Math.max(0, this.awaiting - Math.max(1, Array.isArray(event.user_message_uuids) ? event.user_message_uuids.length : 1));
        this.turnOpen = this.awaiting > 0;
        this.pending = [];
        this.settle();
        this.publish();
        return;
      }
      default: return;
    }
  }

  private sendUser(text: string): void {
    this.beginTurn(); this.awaiting++; this.turnOpen = true; this.set("busy");
    this.ports.toClaude(JSON.stringify({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, uuid: this.id() }));
  }

  private reply(requestId: string, response: Json): void {
    this.ports.toClaude(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: requestId, response } }));
  }

  /** Idle only once the turn's result is in AND its Stop hooks have answered: Throughline has recorded the turn by then. */
  private settle(): void {
    if (this.turnOpen || this.stopHooks.size > 0 || this.pending.length > 0) return;
    this.set("idle");
  }

  onChildExit(): void {
    if (this.exited) return;
    this.exited = true;
    this.state = "exited"; this.reason = null; this.pending = [];
    this.publish();
  }
}

// ---- process entry ----
export function parseHostArgs(argv: string[]): { claude: string[]; flag: (name: string) => string | null; has: (name: string) => boolean } {
  const index = argv.indexOf("--");
  const own = index < 0 ? argv : argv.slice(0, index);
  return { claude: index < 0 ? [] : argv.slice(index + 1),
    flag: name => { const at = own.indexOf(name); return at >= 0 ? own[at + 1] ?? null : null; },
    has: name => own.includes(name) };
}

async function main(): Promise<void> {
  const args = parseHostArgs(process.argv.slice(2));
  const streamFile = args.flag("--stream-file"), inputFile = args.flag("--input-file"), stateFile = args.flag("--state-file");
  if (!args.claude.length || !streamFile || !inputFile || !stateFile) { process.stderr.write("claude-machine-host: --stream-file, --input-file, --state-file and a claude command after -- are required\n"); process.exit(2); }
  const [bin, ...rest] = args.claude;
  const extra = ["--replay-user-messages", "--include-partial-messages"].filter(flag => args.has(flag));
  const child: ChildProcess = spawn(bin, [...rest.filter(a => a !== ""), ...CLAUDE_MACHINE_FLAGS, ...extra], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
  const streamFd = fs.openSync(streamFile, "a", 0o600);
  const host = new ClaudeMachineHost({
    toClaude: line => { child.stdin!.write(`${line}\n`); },
    appendStream: line => { fs.writeSync(streamFd, `${line}\n`); },
    openTranscript: (sessionId, cwd) => new ReminderTail(claudeTranscriptFile(sessionId, cwd)),
    writeState: state => { fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(state), { mode: 0o600 }); fs.renameSync(`${stateFile}.tmp`, stateFile); },
  }, { denyQuestions: args.has("--deny-questions") });
  const firstPrompt = args.flag("--first-prompt-file");
  if (firstPrompt) { host.firstPrompt = fs.readFileSync(firstPrompt, "utf8"); try { fs.unlinkSync(firstPrompt); } catch { /* best effort */ } }
  createInterface({ input: child.stdout! }).on("line", line => host.onChildLine(line));
  child.on("exit", code => { host.onChildExit(); process.exit(code ?? 1); });
  child.on("error", error => { process.stderr.write(`claude did not start: ${error.message}\n`); host.onChildExit(); process.exit(127); });
  // The input file: Aiterm appends whole lines; each is read once, in order, and forwarded unchanged.
  let offset = 0, carry = Buffer.alloc(0);
  const readInput = (): void => {
    let size: number;
    try { size = fs.statSync(inputFile).size; } catch { return; }
    if (size <= offset) return;
    const fd = fs.openSync(inputFile, "r");
    try {
      const buffer = Buffer.alloc(size - offset);
      const n = fs.readSync(fd, buffer, 0, buffer.length, offset);
      offset += n;
      carry = Buffer.concat([carry, buffer.subarray(0, n)]);
    } finally { fs.closeSync(fd); }
    let at: number;
    while ((at = carry.indexOf(10)) >= 0) {
      const line = carry.subarray(0, at).toString("utf8");
      const bytes = at + 1;
      carry = carry.subarray(bytes);
      host.onInputLine(line, bytes);
    }
  };
  setInterval(readInput, 100);
  process.on("SIGTERM", () => { child.kill("SIGTERM"); });
  process.on("SIGHUP", () => { child.stdin?.end(); });
  process.stdout.write("claude machine seat: the stream is data (stream_read / stream_send), not this screen.\n");
  host.start();
}

if (process.argv[1] && /claude-machine-host\.js$/.test(process.argv[1])) await main();
