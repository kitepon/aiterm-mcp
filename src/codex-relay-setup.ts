import { readRelayConfig, type RelayConfig } from "./codex-relay-config.js";
import { SetupError } from "./setup-platform.js";

export type CodexSteerAction = "enable" | "disable" | "status";
export type CodexSteerResult = {
  status: "ready" | "disabled" | "restart_required" | "unsupported" | "failed";
  reason_code?: string;
};
export type RelaySetupRuntime = {
  directory: string; socket_root: string; node: string;
  findBinary: () => string;
  getGui: (key: string) => string | null;
  setGui: (key: string, value: string | null) => void;
  persist: (launcher: string) => void;
  unpersist: (launcher: string) => void;
  prepare: (directory: string) => void;
  build: (binary: string) => Promise<string>;
  save: (directory: string, config: RelayConfig) => void;
  live: (config: RelayConfig) => Promise<boolean>;
};

// 設定・競合・再実行・復元・実効確認の順序は全OSで同じにする。
export async function configureRelay(action: CodexSteerAction, runtime: RelaySetupRuntime): Promise<CodexSteerResult> {
  const previous = readRelayConfig(runtime.directory);
  if (action === "status") {
    if (!previous?.enabled) return { status: "disabled" };
    if (runtime.getGui("CODEX_CLI_PATH") !== previous.launcher) return { status: "failed", reason_code: "codex_steer_configuration_changed" };
    return await runtime.live(previous) ? { status: "ready" } : { status: "restart_required", reason_code: "codex_restart_required" };
  }
  if (action === "disable") {
    if (!previous?.enabled) return { status: "disabled" };
    if (![previous.launcher, previous.previous_cli_path].includes(runtime.getGui("CODEX_CLI_PATH"))) throw new SetupError("codex_steer_configuration_changed", "起動設定が他から変更されています。所有外の値は上書きしません");
    runtime.unpersist(previous.launcher);
    runtime.setGui("CODEX_CLI_PATH", previous.previous_cli_path);
    if (runtime.getGui("CODEX_CLI_PATH") !== previous.previous_cli_path) throw new SetupError("codex_steer_readback_failed", "元の起動設定を確認できません");
    runtime.save(runtime.directory, { ...previous, enabled: false });
    return { status: "restart_required", reason_code: "codex_restart_required" };
  }
  for (const key of ["CODEX_APP_SERVER_WS_URL", "CODEX_APP_SERVER_USE_LOCAL_DAEMON", "CODEX_APP_SERVER_FORCE_CLI"]) {
    if (runtime.getGui(key)) throw new SetupError("codex_steer_configuration_conflict", `${key}が設定されています。既存の接続設定は上書きしません`);
  }
  const binary = runtime.findBinary();
  const current = runtime.getGui("CODEX_CLI_PATH");
  if (previous?.enabled && ![previous.launcher, previous.previous_cli_path].includes(current)) throw new SetupError("codex_steer_configuration_changed", "起動設定が他から変更されています");
  runtime.prepare(runtime.directory);
  const launcher = await runtime.build(binary);
  const config: RelayConfig = { schema: "aiterm.codex-relay.v1", enabled: true, binary, node: runtime.node,
    launcher, socket_root: runtime.socket_root, previous_cli_path: previous?.enabled ? previous.previous_cli_path : current };
  // 起動設定の変更前に復元値を保存する。読戻し不一致を成功扱いしない。
  runtime.save(runtime.directory, config);
  runtime.persist(launcher);
  runtime.setGui("CODEX_CLI_PATH", launcher);
  if (runtime.getGui("CODEX_CLI_PATH") !== launcher) throw new SetupError("codex_steer_readback_failed", "Steerの起動設定を確認できません");
  return await runtime.live(config) ? { status: "ready" } : { status: "restart_required", reason_code: "codex_restart_required" };
}
