#!/usr/bin/env node
// Claude machine host (a471). Runs in the seat's pane in place of the Claude TUI: it owns one resident
// `claude -p --input-format stream-json --output-format stream-json` process, reads the pane's keys like a composer
// (bracketed paste + Enter = a user message, Escape = interrupt, digits/Enter/arrows answer a pending dialog) and prints
// the stream as plain text with a state marker (claude-machine.ts). Design: docs/architecture/claude-machine-host.md.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { claudeMachineMarkerLine, CLAUDE_MACHINE_FLAGS, type ClaudeMachineReason, type ClaudeMachineState } from "./claude-machine.js";

const PASTE_START = "\x1b[200~", PASTE_END = "\x1b[201~";
const SHOWN_RESULT_LINES = 6, SHOWN_RESULT_CHARS = 400, SHOWN_INPUT_CHARS = 160;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface PendingDialog {
  requestId: string;
  tool: string;
  input: Json;
  reason: ClaudeMachineReason;
  options: string[];
  cursor: number;
  question: string | null;
}

export interface ClaudeMachineHostPorts {
  /** One JSON line to claude's stdin. */
  send(line: string): void;
  /** Plain text for the pane (already newline-terminated). */
  print(text: string): void;
  id?: () => string;
  /** The newest turn end, for Aiterm (an -p interrupt is not in the transcript until the next input). */
  recordEnd?(end: { at: string; subtype: unknown; terminal_reason: unknown; is_error: unknown }): void;
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

function toolSummary(name: string, input: Json): string {
  const pick = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.description ?? input.query;
  return `${name}(${typeof pick === "string" ? clip(oneLine(pick), SHOWN_INPUT_CHARS) : clip(oneLine(JSON.stringify(input)), SHOWN_INPUT_CHARS)})`;
}

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(part => (part && typeof part === "object" && typeof (part as Json).text === "string" ? (part as Json).text : "")).join("");
}

export class ClaudeMachineHost {
  state: ClaudeMachineState = "starting";
  private reason: ClaudeMachineReason | null = null;
  private readonly id: () => string;
  private turnOpen = false; // a result is still owed for something claude accepted or started
  private stopHooks = new Set<string>();
  private awaitingResult = 0; // user messages sent that no result has covered yet
  private pending: PendingDialog | null = null;
  private compose = "";
  private paste: string | null = null;
  private control = new Map<string, (response: Json) => void>();
  private exited = false;
  firstPrompt: string | null = null;

  constructor(private readonly ports: ClaudeMachineHostPorts) { this.id = ports.id ?? (() => randomUUID()); }

  private mark(state: ClaudeMachineState, reason: ClaudeMachineReason | null = null): void {
    if (this.state === state && this.reason === reason) return;
    this.state = state; this.reason = reason;
    this.ports.print(`${claudeMachineMarkerLine(state, reason)}\n`);
  }

  private line(text: string): void { this.ports.print(`${text}\n`); }

  start(): void {
    this.ports.print("\x1b[?2004h"); // ask for bracketed paste: tmux/psmux send the markers only to a pane that asked
    this.line(claudeMachineMarkerLine("starting"));
    this.request({ subtype: "initialize" }, response => {
      if (response.subtype !== "success") { this.line(`! initialize failed: ${clip(oneLine(JSON.stringify(response)), 300)}`); return; }
      this.state = "starting"; // printed by mark below even if unchanged
      this.mark("idle");
      if (this.firstPrompt !== null) { const text = this.firstPrompt; this.firstPrompt = null; this.submit(text); }
    });
  }

  /** A control request to claude; `done` gets the control_response body. */
  request(request: Json, done: (response: Json) => void = () => {}): string {
    const requestId = this.id();
    this.control.set(requestId, done);
    this.ports.send(JSON.stringify({ type: "control_request", request_id: requestId, request }));
    return requestId;
  }

  // ---- pane input ----
  onInput(chunk: string): void {
    let rest = chunk;
    while (rest.length) {
      if (this.paste !== null) {
        const end = rest.indexOf(PASTE_END);
        if (end < 0) { this.paste += rest; return; }
        this.compose += this.paste + rest.slice(0, end);
        this.paste = null; rest = rest.slice(end + PASTE_END.length);
        continue;
      }
      if (rest.startsWith(PASTE_START)) { this.paste = ""; rest = rest.slice(PASTE_START.length); continue; }
      if (rest.startsWith("\x1b[A")) { this.moveCursor(-1); rest = rest.slice(3); continue; }
      if (rest.startsWith("\x1b[B")) { this.moveCursor(1); rest = rest.slice(3); continue; }
      if (rest.startsWith("\x1b[")) { const m = /^\x1b\[[0-9;?]*[ -/]*[@-~]/.exec(rest); rest = rest.slice(m ? m[0].length : 2); continue; }
      const ch = rest[0];
      rest = rest.slice(1);
      if (ch === "\x1b") { if (rest.length && rest[0] !== "\x1b") rest = rest.slice(1); else this.interrupt(); continue; } // Esc+key (Alt) is ignored
      if (ch === "\x03") { this.interrupt(); continue; }
      if (ch === "\r" || ch === "\n") { this.enter(); continue; }
      if (this.pending && /[1-9]/.test(ch)) { this.pickDigit(Number(ch)); continue; }
      if (ch === "\x7f" || ch === "\b") { this.compose = this.compose.slice(0, -1); continue; }
      if (ch >= " " || ch === "\t") this.compose += ch;
    }
  }

  private enter(): void {
    if (this.pending) { this.answerDialog(); return; }
    const text = this.compose;
    this.compose = "";
    if (text.trim()) this.submit(text);
  }

  /** One user message to claude. Aiterm waits for idle before it types, so a send while busy is a steer. */
  submit(text: string): void {
    const trimmed = text.trim();
    const configure = /^\/aiterm-config\s+(\{.*\})\s*$/s.exec(trimmed);
    if (configure) { this.configure(configure[1]); return; }
    this.line(`» ${clip(oneLine(text), 240)}`);
    this.awaitingResult++;
    this.turnOpen = true;
    this.mark("busy");
    this.ports.send(JSON.stringify({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, uuid: this.id() }));
  }

  /** Host-only command: {"model":..,"effort":..} -> set_model / apply_flag_settings; the outcome is a plain line Aiterm reads. */
  private configure(json: string): void {
    let want: { model?: string; effort?: string; fast?: boolean };
    try { want = JSON.parse(json); } catch { this.line("[aiterm-machine] config=error reason=unreadable"); return; }
    const steps: Json[] = [];
    if (typeof want.model === "string") steps.push({ subtype: "set_model", model: want.model });
    if (typeof want.effort === "string") steps.push({ subtype: "apply_flag_settings", settings: { effortLevel: want.effort } });
    if (typeof want.fast === "boolean") steps.push({ subtype: "apply_flag_settings", settings: { fastMode: want.fast } });
    const run = (index: number): void => {
      if (index >= steps.length) { this.line(`[aiterm-machine] config=ok${want.model ? ` model=${want.model}` : ""}${want.effort ? ` effort=${want.effort}` : ""}${typeof want.fast === "boolean" ? ` fast=${want.fast}` : ""}`); return; }
      this.request(steps[index], response => {
        if (response.subtype === "success") run(index + 1);
        else this.line(`[aiterm-machine] config=error reason=${clip(oneLine(String(response.error ?? response.subtype)), 120)}`);
      });
    };
    run(0);
  }

  interrupt(): void {
    if (!this.turnOpen && !this.pending) return;
    this.request({ subtype: "interrupt" });
  }

  // ---- dialogs (can_use_tool) ----
  private onCanUseTool(requestId: string, request: Json): void {
    const tool = String(request.tool_name ?? "");
    const input = (request.input ?? {}) as Json;
    if (tool === "ExitPlanMode") { // the PermissionRequest hook answers this as option 1 today; same policy if it reaches here
      this.respondTool(requestId, { behavior: "allow", updatedInput: input,
        updatedPermissions: [{ type: "setMode", mode: "bypassPermissions", destination: "session" }] });
      return;
    }
    if (tool === "AskUserQuestion" && Array.isArray(input.questions) && input.questions.length === 1) {
      const q = input.questions[0] as Json;
      const options = (Array.isArray(q.options) ? q.options : []).map((o: Json) => String(o?.label ?? o));
      this.pending = { requestId, tool, input, reason: "unknown_dialog", options, cursor: 0, question: String(q.question ?? "") };
      this.line(clip(oneLine(this.pending.question ?? ""), 400));
      this.renderOptions();
      this.mark("blocked", "unknown_dialog");
      return;
    }
    this.pending = { requestId, tool, input, reason: tool === "AskUserQuestion" ? "unknown_dialog" : "tool_approval",
      options: ["Yes", "No"], cursor: 0, question: null };
    if (tool === "AskUserQuestion") { // several questions: not answerable here, refuse so the seat does not hang
      this.pending = null;
      this.respondTool(requestId, { behavior: "deny", message: "Aiterm machine seat answers one question at a time" });
      return;
    }
    this.line(toolSummary(tool, input));
    this.line("Do you want to proceed?");
    this.renderOptions();
    this.mark("blocked", "tool_approval");
  }

  private renderOptions(): void {
    const p = this.pending!;
    p.options.forEach((label, i) => this.line(`${i === p.cursor ? "❯ " : "  "}${i + 1}. ${label}`));
  }

  private moveCursor(delta: number): void {
    const p = this.pending;
    if (!p) return;
    p.cursor = Math.min(p.options.length - 1, Math.max(0, p.cursor + delta));
  }

  private pickDigit(n: number): void {
    const p = this.pending;
    if (p && n <= p.options.length) p.cursor = n - 1;
  }

  private answerDialog(): void {
    const p = this.pending!;
    this.pending = null;
    if (p.tool === "AskUserQuestion") {
      const q = (p.input.questions as Json[])[0];
      this.respondTool(p.requestId, { behavior: "allow", updatedInput: { ...p.input, answers: { [String(q.question)]: p.options[p.cursor] } } });
    } else if (p.cursor === 0) this.respondTool(p.requestId, { behavior: "allow", updatedInput: p.input });
    else this.respondTool(p.requestId, { behavior: "deny", message: "Denied from the Aiterm seat" });
    this.line(`  → ${p.options[p.cursor]}`);
    this.mark("busy");
  }

  private respondTool(requestId: string, response: Json): void {
    this.ports.send(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: requestId, response } }));
  }

  // ---- claude output ----
  onChildLine(raw: string): void {
    let event: Json;
    try { event = JSON.parse(raw); } catch { if (raw.trim()) this.line(clip(raw, 400)); return; }
    switch (event.type) {
      case "control_response": {
        const body = (event.response ?? {}) as Json;
        const done = this.control.get(String(body.request_id));
        if (done) { this.control.delete(String(body.request_id)); done(body); }
        return;
      }
      case "control_request": {
        const request = (event.request ?? {}) as Json;
        if (request.subtype === "can_use_tool") this.onCanUseTool(String(event.request_id), request);
        return;
      }
      case "control_cancel_request": {
        if (this.pending?.requestId === event.request_id) { this.pending = null; this.mark("busy"); }
        return;
      }
      case "system": return this.onSystem(event);
      case "assistant": return this.onAssistant(event);
      case "user": return this.onToolResult(event);
      case "rate_limit_event": {
        const info = (event.rate_limit_info ?? event) as Json;
        if (info.status === "rejected") this.line(`! usage limit reached (${info.rateLimitType ?? "limit"}) resetsAt=${info.resetsAt ?? "?"}`);
        return;
      }
      case "result": return this.onResult(event);
      default: return;
    }
  }

  private activity(): void { if (this.state === "idle" || this.state === "starting") { this.turnOpen = true; this.mark("busy"); } }

  private onSystem(event: Json): void {
    switch (event.subtype) {
      case "hook_started": if (event.hook_event === "Stop") this.stopHooks.add(String(event.hook_id)); return;
      case "hook_response": if (event.hook_event === "Stop") { this.stopHooks.delete(String(event.hook_id)); this.settle(); } return;
      case "api_retry": this.line(`! api retry ${event.attempt ?? ""} (${event.error ?? "error"})`); return;
      default: return;
    }
  }

  private onAssistant(event: Json): void {
    this.activity();
    const content = (event.message as Json | undefined)?.content;
    if (!Array.isArray(content)) return;
    for (const part of content as Json[]) {
      if (part.type === "text" && typeof part.text === "string" && part.text.trim()) this.line(part.text.replace(/\s+$/, ""));
      else if (part.type === "tool_use") this.line(`● ${toolSummary(String(part.name), (part.input ?? {}) as Json)}`);
    }
  }

  private onToolResult(event: Json): void {
    const content = (event.message as Json | undefined)?.content;
    if (!Array.isArray(content)) return;
    for (const part of content as Json[]) {
      if (part.type !== "tool_result") continue;
      const text = blockText(part.content).replace(/\s+$/, "");
      if (!text) continue;
      const lines = text.split(/\r?\n/u);
      for (const shown of lines.slice(0, SHOWN_RESULT_LINES)) this.line(`  ⎿ ${clip(shown, SHOWN_RESULT_CHARS)}`);
      if (lines.length > SHOWN_RESULT_LINES) this.line(`  ⎿ … ${lines.length - SHOWN_RESULT_LINES} more lines`);
    }
  }

  private onResult(event: Json): void {
    this.ports.recordEnd?.({ at: new Date().toISOString(), subtype: event.subtype, terminal_reason: event.terminal_reason, is_error: event.is_error });
    if (event.is_error && typeof event.result === "string") this.line(`! ${clip(oneLine(event.result), 400)}`);
    this.awaitingResult = Math.max(0, this.awaitingResult - Math.max(1, Array.isArray(event.user_message_uuids) ? event.user_message_uuids.length : 1));
    this.turnOpen = this.awaitingResult > 0;
    this.pending = null;
    this.settle();
  }

  /** Idle only once the turn's result is in AND its Stop hooks have answered: Throughline has recorded the turn by then. */
  private settle(): void {
    if (this.turnOpen || this.stopHooks.size > 0 || this.pending) return;
    this.mark("idle");
  }

  onChildExit(code: number | null, signal: string | null): void {
    if (this.exited) return;
    this.exited = true;
    this.line(`! claude exited (code=${code ?? "none"}${signal ? ` signal=${signal}` : ""})`);
  }
}

// ---- process entry ----
export function parseHostArgs(argv: string[]): { claude: string[]; firstPrompt: string | null; endFile: string | null } {
  const index = argv.indexOf("--");
  const own = index < 0 ? argv : argv.slice(0, index);
  const claude = index < 0 ? [] : argv.slice(index + 1);
  const value = (flag: string): string | null => { const at = own.indexOf(flag); return at >= 0 ? own[at + 1] ?? null : null; };
  return { claude, firstPrompt: value("--first-prompt-file"), endFile: value("--end-file") };
}

async function main(): Promise<void> {
  const { claude, firstPrompt, endFile } = parseHostArgs(process.argv.slice(2));
  if (!claude.length) { process.stderr.write("claude-machine-host: no claude command after --\n"); process.exit(2); }
  const fs = await import("node:fs");
  const [bin, ...args] = claude;
  const child: ChildProcess = spawn(bin, [...args.filter(a => a !== ""), ...CLAUDE_MACHINE_FLAGS], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
  const host = new ClaudeMachineHost({
    send: line => { child.stdin!.write(`${line}\n`); },
    // Raw mode can leave the pane without ONLCR (a resumed seat drew a staircase and its state line missed column 0): send CR explicitly.
    print: text => { process.stdout.write(text.replace(/\r?\n/g, "\r\n")); },
    recordEnd: end => {
      if (!endFile) return;
      try { fs.writeFileSync(`${endFile}.tmp`, JSON.stringify(end), { mode: 0o600 }); fs.renameSync(`${endFile}.tmp`, endFile); } catch { /* the transcript rule still applies */ }
    },
  });
  if (firstPrompt) { host.firstPrompt = fs.readFileSync(firstPrompt, "utf8"); try { fs.unlinkSync(firstPrompt); } catch { /* best effort */ } }
  createInterface({ input: child.stdout! }).on("line", line => host.onChildLine(line));
  child.on("exit", (code, signal) => { host.onChildExit(code, signal); process.exit(code ?? 1); });
  child.on("error", error => { process.stdout.write(`! claude did not start: ${error.message}\n`); process.exit(127); });
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => host.onInput(chunk));
  process.stdin.resume();
  const stop = () => { child.stdin?.end(); };
  process.on("SIGTERM", () => { child.kill("SIGTERM"); });
  process.on("SIGHUP", stop);
  host.start();
}

if (process.argv[1] && /claude-machine-host\.js$/.test(process.argv[1])) await main();
