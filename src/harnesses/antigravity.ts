import { z } from "zod";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { AitermError } from "../errors.js";
import { checkedCatalog, catalogInvalid, catalogUnavailable, type AgentModelCatalog } from "../model-catalog.js";
import { spawnAgentControlCommand } from "../agent-resolver.js";
import { liveNodeExecutable } from "../live-node.js";
import { powershellInvocation } from "../windows-powershell.js";
import { agentEventPath, agentLineageFields, agentsDir, createEmpty0600, readFileRange, safeStatSize, shq, writeAgentMetadata, writeJson0600, type AgentMetadata, type AgentLineageContext, type InitialPromptState, type HarnessPaneObservation, type AgentDoneEvent, type StartupAction } from "../agent-shared.js";
import { authUrl, type AgentAuthPane, type AgentAuthStatus } from "../agent-auth.js";

// agy 1.4.10 exposes effort-specific IDs; overriding an ID's effort is rejected by the CLI.
export function antigravityCatalog(stdout: string, selected: string): AgentModelCatalog {
  const rows = (text: string) => text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const fields = line.split("\t");
    if (fields.length !== 2 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(fields[0]) || !fields[1].trim()) {
      throw catalogInvalid("Antigravity", "agy modelsのIDと表示名を確認できません");
    }
    return { id: fields[0], display_name: fields[1] };
  });
  const models = rows(stdout).map(model => {
    const effort = /-(low|medium|high|xhigh|max)$/.exec(model.id)?.[1] ?? null;
    return { ...model, efforts: effort ? [effort] : [], default_effort: effort, hidden: false, fast: false };
  });
  const current = rows(selected);
  if (current.length !== 1) throw catalogInvalid("Antigravity", "agy -p /modelの選択modelを確認できません");
  return checkedCatalog("Antigravity", {
    source: "agy models / agy -p /model", harness_version: null,
    default_model: current[0].id, models, adapter_efforts: {},
  });
}

export function realAntigravityHome(): string {
  return path.join(process.env.HOME ?? os.homedir(), ".gemini", "antigravity-cli");
}

export function antigravityModelChoices(bin: string, cwd: string): AgentModelCatalog {
  const run = (args: string[]) => {
    const r = spawnAgentControlCommand(bin, args, cwd, { cwd, env: process.env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
    if (r.error || r.status !== 0) throw catalogUnavailable("Antigravity", r.error?.message ?? r.stderr?.trim() ?? `exit=${r.status}`);
    return r.stdout;
  };
  const catalog = antigravityCatalog(run(["models"]), run(["-p", "/model"]));
  catalog.harness_version = run(["--version"]).trim();
  return catalog;
}

export function antigravityAuthStatus(bin: string, cwd: string, env = process.env): AgentAuthStatus {
  const r = spawnAgentControlCommand(bin, ["models"], cwd, { cwd, env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
  if (!r.error && r.status === 0 && /^\S+\t.+/m.test(r.stdout)) return { status: "authenticated", message: null };
  if (/Please sign in to view available models/.test(r.stderr)) return { status: "unauthenticated", message: "Antigravity CLIのGoogleサインインが必要です" };
  return { status: "failed", message: "Antigravity CLIの認証状態を確認できません" };
}

export function antigravityAuthPane(screen: string): AgentAuthPane {
  const lines = screen.split("\n"), start = lines.findIndex(line => line.includes("https://accounts.google.com/"));
  const urlLines: string[] = [];
  if (start >= 0) for (const line of lines.slice(start)) {
    if (/^\s*─|After authenticating|authorization code/i.test(line)) break;
    urlLines.push(line.trim());
  }
  const url = authUrl(urlLines.join(""), ["accounts.google.com"]);
  const complete = /Do you trust the contents of this project\?/.test(screen)
    || (/\? for shortcuts/.test(screen) && /^\s*>\s*$/m.test(screen));
  const base: AgentAuthPane = { url, user_code: null, input_required: false, message: null, onboarding_complete: complete };
  if (complete) return base;
  if (/authorization code/i.test(screen)) {
    const empty = lines.some(line => /^\s*authorization code(?:\.{3}|…)?\s*$/.test(line));
    return { ...base, input_required: true, native_input: { kind: "authorization_code", empty },
      ...(empty ? { ui: { stage: "paste_code" as const, title: "Antigravityの認証コード", message: "公式ページで認証し、表示されたコードを入力してください。", input: "authorization_code" as const, choices: [] } } : {}) };
  }
  const rows: { id: string; label: string; selected: boolean }[] = [];
  let title = "";
  if (/Select login method:/.test(screen)) {
    title = "Antigravityのログイン方法";
    for (const line of lines) {
      const m = /^\s*(>)?\s*([12])\. (Google OAuth|Use a Google Cloud project)\s*$/.exec(line);
      if (m) rows.push({ id: `option-${m[2]}`, label: m[3], selected: !!m[1] });
    }
  } else if (/Choose your color scheme:/.test(screen)) {
    title = "Antigravityの表示テーマ";
    for (const line of lines) {
      const m = /^\s*(>)?\s*(terminal|light|solarized light|colorblind-friendly light|dark|solarized dark|colorblind-friendly dark|tokyo night)\s*(?:│.*)?$/.exec(line);
      if (m) rows.push({ id: `option-${rows.length + 1}`, label: m[2], selected: !!m[1] });
    }
  } else if (/Terms of Service & Data Use/.test(screen)) {
    title = "Antigravityのデータ提供設定";
    const checkbox = /^\s*(>)?\s*\[([ x])\] Yes, I agree/m.exec(screen);
    if (!checkbox) return base;
    rows.push({ id: "option-1", label: `任意の会話データ提供を${checkbox[2] === "x" ? "オフ" : "オン"}にする`, selected: !!checkbox[1] });
    rows.push({ id: "option-2", label: "前の画面へ戻る", selected: />\s*Previous/.test(screen) });
    rows.push({ id: "option-3", label: "現在の設定で完了する", selected: />\s*Done/.test(screen) });
  }
  const selected = rows.filter(row => row.selected);
  if (!rows.length || selected.length !== 1) return base;
  return { ...base, input_required: true, native_input: { kind: "choice", selected_id: selected[0].id },
    ui: { stage: "select", title, message: "公式CLIの選択肢を選んでください。", input: "choice", choices: rows.map(({ id, label }) => ({ id, label })) } };
}

export function antigravityAuthChoiceKey(screen: string, target: string): string {
  const pane = antigravityAuthPane(screen);
  if (pane.native_input?.kind !== "choice" || !pane.ui?.choices.some(item => item.id === target)) throw new AitermError("Antigravity認証の選択肢が変わりました", 2);
  const current = pane.native_input.selected_id;
  if (current === target) return "Enter";
  if (!/Terms of Service & Data Use/.test(screen)) return "Down";
  if (current === "option-1") return "Down";
  if (target === "option-1") return "Up";
  return current === "option-2" ? "Right" : "Left";
}

export function antigravityPaneObservation(screen: string): HarnessPaneObservation {
  if (/esc to dismiss/.test(screen)) return { state: "blocked", reason: "vendor_notice" };
  if (/Select login method|authorization code|Choose your color scheme|Terms of Service|Do you trust|ask_permission|Always Allow|Allow for this session/i.test(screen))
    return { state: "blocked", reason: "vendor_action_required" };
  if (/(?:Generating|Working)(?:\.{3}|…)|esc to interrupt/i.test(screen)) return { state: "busy", reason: "vendor_generating" };
  if (/\? for shortcuts/.test(screen) && /^\s*>\s*$/m.test(screen)) return { state: "idle", reason: "composer_ready" };
  return { state: "unknown", reason: "vendor_state_unknown" };
}

export function antigravityStartupAction(screen: string, trust: boolean, cwd: string | null): StartupAction | null {
  if (/esc to dismiss/.test(screen)) return { kind: "antigravity_notice", keys: ["Escape"] };
  const heading = screen.indexOf("Do you trust the contents of this project?");
  const lines = heading < 0 ? [] : screen.slice(0, heading).trimEnd().split("\n");
  const normalize = (value: string) => value.replace(/\\/g, "/");
  const matches = cwd && lines.some((_, at) => normalize(lines.slice(at).map(line => line.trim()).join("")) === normalize(cwd));
  if (trust && matches)
    return { kind: "antigravity_trust", keys: ["Enter"], selected: /^>\s*Yes, I trust this folder/ };
  return null;
}

export function antigravityCurrentModel(screen: string, catalog: AgentModelCatalog): string | null {
  const header = screen.split("\n").slice(0, 10).map(line => line.trim());
  const footer = screen.split("\n").slice(-5).join("\n");
  const matches = catalog.models.filter(model => model.display_name && (header.some(line => line.endsWith(model.display_name!))
    || (model.default_effort && footer.includes(`${model.display_name.replace(/ \((?:Low|Medium|High|Xhigh|Max)\)$/, "")} · ${model.default_effort}`))));
  return matches.length === 1 ? matches[0].id : null;
}

export function antigravityHookFile(home = process.env.HOME ?? os.homedir()): string {
  return path.join(home, ".gemini", "config", "hooks.json");
}

export function mergeAntigravityHooks(file = antigravityHookFile(), node = liveNodeExecutable(), script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "antigravity-hook.js")): "configured" | "unchanged" {
  const target = fs.existsSync(file) ? fs.realpathSync(file) : file;
  let current: Record<string, unknown> = {};
  if (fs.existsSync(target)) current = z.record(z.string(), z.unknown()).parse(JSON.parse(fs.readFileSync(target, "utf8")));
  const previous = current["aiterm-native"];
  if (previous && typeof previous === "object" && (previous as Record<string, unknown>).enabled === false)
    throw new AitermError("ANTIGRAVITY_HOOK_DISABLED: aiterm-native hookは利用者が無効にしています", 2);
  const command = (event: string) => process.platform === "win32"
    ? `pwsh.exe ${powershellInvocation(node, [script, event]).join(" ")}`
    : [node, script, event].map(shq).join(" ");
  const entry = { SessionStart: [{ type: "command", command: command("SessionStart"), timeout: 10 }], Stop: [{ type: "command", command: command("Stop"), timeout: 10 }] };
  if (isDeepStrictEqual(current["aiterm-native"], entry)) return "unchanged";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.aiterm-backup`);
  writeJson0600(target, { ...current, "aiterm-native": entry });
  if (!isDeepStrictEqual(JSON.parse(fs.readFileSync(target, "utf8"))["aiterm-native"], entry)) throw new AitermError("ANTIGRAVITY_HOOK_READBACK_FAILED", 2);
  return "configured";
}

export function createAntigravityAgentMetadata(name: string, cwd: string | null, initial: InitialPromptState, writeScope: string | undefined, lineage: AgentLineageContext): AgentMetadata {
  const launchId = randomBytes(16).toString("hex");
  const meta: AgentMetadata = { kind: "antigravity", aiterm_session: name, launch_id: launchId, event_file: agentEventPath(name, launchId),
    created_at: new Date().toISOString(), cwd, vendor_session_id: null, initial_prompt: initial,
    hook_route: "shared_antigravity_home", antigravity_home: realAntigravityHome(), ...agentLineageFields(lineage),
    ...(writeScope ? { write_scope: writeScope } : {}), node_platform: process.platform };
  createEmpty0600(meta.event_file);
  writeAgentMetadata(meta);
  return meta;
}

export function antigravityAgentArgv(bin: string, model: string | null, effort: string | null, prompt: string | null): string[] {
  return [bin, "--dangerously-skip-permissions", "--settings", '{"queuedMessages":"send-immediately"}', ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : []), ...(prompt ? ["--prompt-interactive", prompt] : [])];
}

export function antigravityBindingFile(meta: AgentMetadata): string {
  return path.join(agentsDir(), `${meta.aiterm_session}.${meta.launch_id}.antigravity-session.json`);
}

const bindingSchema = z.object({ conversation_id: z.uuid(), transcript: z.string().min(1) }).strict();
export function antigravityBinding(meta: AgentMetadata): z.infer<typeof bindingSchema> | null {
  const file = antigravityBindingFile(meta);
  if (!fs.existsSync(file)) return null;
  const result = bindingSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!meta.antigravity_home || !path.isAbsolute(result.transcript) || !path.relative(path.join(meta.antigravity_home, "brain", result.conversation_id), result.transcript).startsWith(".system_generated" + path.sep))
    throw new AitermError("ANTIGRAVITY_BINDING_INVALID", 2);
  return result;
}

export function bindAntigravitySession(meta: AgentMetadata): void {
  const binding = antigravityBinding(meta);
  if (!binding) return;
  if (meta.vendor_session_id && meta.vendor_session_id !== binding.conversation_id) throw new AitermError("ANTIGRAVITY_SESSION_MISMATCH", 2);
  if (!meta.vendor_session_id) { meta.vendor_session_id = binding.conversation_id; writeAgentMetadata(meta); }
}

export function antigravityResultPath(meta: AgentMetadata, turn: string): string {
  if (!/^\d{1,15}-\d{1,15}$/.test(turn)) throw new AitermError("ANTIGRAVITY_TURN_INVALID", 2);
  return path.join(agentsDir(), `${meta.aiterm_session}.${meta.launch_id}.antigravity-result-${turn}.json`);
}

export function antigravityTranscriptText(meta: AgentMetadata, done: AgentDoneEvent): string {
  const body = z.object({ text: z.string(), conversation_id: z.uuid(), user_step: z.number().int().nonnegative(), execution: z.number().int().nonnegative() }).strict()
    .parse(JSON.parse(fs.readFileSync(antigravityResultPath(meta, done.turn_id ?? ""), "utf8")));
  if (body.conversation_id !== done.vendor_session_id || `${body.user_step}-${body.execution}` !== done.turn_id || Buffer.byteLength(body.text) !== done.result_bytes
    || createHash("sha256").update(body.text).digest("hex") !== done.result_digest) throw new AitermError("ANTIGRAVITY_RESULT_MISMATCH", 2);
  return body.text;
}

export function antigravityTurn(file: string, requireAnswer: boolean): { user_step: number; text: string } {
  const size = safeStatSize(file), limit = 4 * 1024 * 1024;
  if (!size) throw new AitermError("ANTIGRAVITY_TRANSCRIPT_UNAVAILABLE", 2);
  let text = readFileRange(file, Math.max(0, size - limit), size).toString("utf8");
  if (size > limit) text = text.slice(text.indexOf("\n") + 1);
  const lines = text.split("\n");
  if (lines.pop()?.trim()) throw new AitermError("ANTIGRAVITY_TRANSCRIPT_INCOMPLETE", 2);
  let answer: { step: number; text: string } | null = null;
  for (const line of lines.reverse()) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.type === "USER_INPUT") {
      if (!Number.isSafeInteger(row.step_index) || row.step_index < 0 || (answer && answer.step <= row.step_index)) break;
      if (requireAnswer && !answer) break;
      return { user_step: row.step_index, text: requireAnswer ? answer!.text : "" };
    }
    if (!answer && row.type === "PLANNER_RESPONSE" && row.status === "DONE" && typeof row.content === "string"
      && Number.isSafeInteger(row.step_index)) answer = { step: row.step_index, text: row.content };
  }
  throw new AitermError("ANTIGRAVITY_FINAL_RESPONSE_UNAVAILABLE", 2);
}
