#!/usr/bin/env node
import { updateLocal, updateRemote, resolveTargetVersion, VERSION_RE, UpdateError, type UpdateResult } from "./update.js";
import { remoteTargetSchema } from "./remote.js";

const usage = "使い方: aiterm-update [--version <版|latest>] [--host <ssh接続名>]... [--no-local] [--check] [--json]\n" +
  "この端末と、指定したSSH接続先のAitermを同じ版へ更新し、各端末でaiterm-setupを実行し直します。\n" +
  "--hostは~/.ssh/configの接続名かホスト名です。接続先は保存しません。--checkは入れ替えずに現在の版と更新先だけを確かめます。\n" +
  "更新前から動いているaiterm-mcpは、AIクライアント（Claude Code、Codex等）が起動し直すまで旧版のまま動きます。端末のsessionは残ります。\n";

const args = process.argv.slice(2);
let spec = "latest";
let json = false;
let check = false;
let local = true;
const hosts: string[] = [];
try {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") { process.stdout.write(usage); process.exit(0); }
    else if (arg === "--json") json = true;
    else if (arg === "--check") check = true;
    else if (arg === "--no-local") local = false;
    else if (arg === "--version" && args[i + 1]) spec = args[++i];
    else if (arg === "--host" && args[i + 1]) hosts.push(args[++i]);
    else throw new UpdateError("usage", usage.trimEnd());
  }
  if (!local && hosts.length === 0) throw new UpdateError("usage", "--no-local には --host が必要です");
  const targets = hosts.map((host) => {
    const parsed = remoteTargetSchema.safeParse({ host });
    if (!parsed.success) throw new UpdateError("host_invalid", `接続先の指定が不正です: ${host}`);
    return parsed.data;
  });
  // 全端末を同じ版へ揃えるため、版の解決はこの端末で1回だけ行う。
  const version = VERSION_RE.test(spec) ? spec : resolveTargetVersion(spec);
  const results: UpdateResult[] = [];
  // この端末を先に更新する。失敗しても別端末の更新は続ける。
  if (local) results.push(updateLocal({ version, check }));
  results.push(...await Promise.all(targets.map((target) => updateRemote(target, version, check))));
  const ok = (r: UpdateResult) => ["updated", "already_current", "checked"].includes(r.status)
    && (r.status === "checked" || r.setup_status === "ready" || r.setup_status === "restart_required");
  const restart = results.some((r) => r.setup_status === "restart_required");
  if (json) {
    process.stdout.write(`${JSON.stringify({ schema: "aiterm.update-run.v1", version, results })}\n`);
  } else {
    for (const r of results) {
      const versions = r.from_version && r.to_version && r.from_version !== r.to_version ? `${r.from_version} → ${r.to_version}` : (r.to_version ?? r.from_version ?? "?");
      const setup = r.setup_status ? ` setup=${r.setup_status}${r.setup_reason_code ? `(${r.setup_reason_code})` : ""}` : "";
      // 入れ替えた時だけ、動いているaiterm-mcpは旧版のcodeで動いている。
      const servers = r.running_servers ? ` ${r.status === "updated" ? "旧版で" : ""}動いているaiterm-mcp=${r.running_servers}` : "";
      const reason = r.reason_code ? ` reason=${r.reason_code}` : "";
      process.stdout.write(`${r.target}: ${r.status} ${versions}${setup}${servers}${reason}${r.message ? `\n  ${r.message}` : ""}\n`);
    }
  }
  process.exitCode = results.every(ok) ? (restart ? 3 : 0) : 2;
} catch (error) {
  process.stderr.write(`aiterm-update: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
