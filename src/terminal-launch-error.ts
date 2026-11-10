// remote-terminal.md R18: a terminal launch refused before any seat exists, as a code plus a fixed plain Japanese
// sentence the Owner reads. Only codes raised before the seat exists are listed; anything else may have started.
const ACTIONS: Record<string, string> = {
  TERMINAL_INVALID: "起動の指定（端末の情報か作業フォルダ）が正しくありません。BellTeamの不具合の恐れがあります。",
  TARGET_INVALID: "起動の指定（端末の情報）が正しくありません。BellTeamの不具合の恐れがあります。",
  TERMINAL_OS_MISMATCH: "端末のOSが、登録されているOSと違います。別の機械を指している恐れがあり止めました。端末の登録（OS）を確かめてください。",
  TERMINAL_PLATFORM_UNSUPPORTED: "この端末のOSは、Mac・Linux・Windowsのどれとも確かめられず、席を起こせません。Mac、Linux、Windowsのどれかの端末を使ってください。",
  TERMINAL_HARNESS_UNSUPPORTED: "この端末で起こせるAIは、今はClaude CodeとCodexだけです。メンバーのAIをClaude CodeかCodexにしてください。",
  REF_INVALID: "端末の登録が見つかりません。端末の登録を確かめてください。",
  BINDING_UNKNOWN: "端末の登録が見つかりません。端末の登録を確かめてください。",
  BINDING_STORE_UNREADABLE: "端末の登録を読めませんでした。端末の登録をやり直してください。",
  TARGET_MISMATCH: "端末の登録内容（宛先）が変わったため止めました。端末の登録を確かめてください。",
  HOST_TRUST_MISSING: "端末の本人確認（ホスト鍵の確認）が済んでいません。端末の画面でホスト鍵を確かめてください。",
  KNOWN_HOSTS_UNREADABLE: "端末の本人確認の記録を読めませんでした。端末の画面でホスト鍵を確かめ直してください。",
  HOST_KEY_MISMATCH: "端末が前と違うホスト鍵を示したため、別の機械の恐れがあり止めました。端末の画面でホスト鍵を確かめ直してください。",
  HOST_TRUST_STALE: "端末のホスト鍵の確認が新しくなりました。新しい登録内容で起こし直すまでお待ちください。",
  CREDENTIAL_REQUIRED: "端末へ入る鍵が登録されていません。端末の登録で鍵を設定してください。",
  CREDENTIAL_NOT_LOADED: "端末へ入る鍵がまだ読み込まれていません。読み込み直してから起こし直します。",
  CREDENTIAL_REVISION_STALE: "端末へ入る鍵が新しくなりました。新しい鍵で起こし直します。",
  CREDENTIAL_UNAVAILABLE: "端末へ入る鍵を使えません。端末の登録で鍵を確かめてください。",
  AUTH_FAILED: "端末が鍵を受け付けませんでした。端末の登録から、パスワードで鍵を許可し直してください。",
  CONNECTION_REFUSED: "端末がSSHの接続を断りました。端末のSSHサーバーが入になっているか確かめてください（Macは「リモートログイン」、Linuxはsshdの起動、WindowsはオプションのOpenSSHサーバーの追加とsshdサービスの起動）。",
  UNREACHABLE: "端末につながりません。電源とネットワークを確かめてください。つながれば起こし直します。",
  CONNECTION_FAILED: "端末へのSSH接続に失敗しました。端末の電源とSSHの設定を確かめてください。",
  REMOTE_AITERM_UNAVAILABLE: "端末にAitermが入っていません（またはsshで入った時のPATHにありません）。端末の準備（Aitermの導入）をやり直してください。",
  REMOTE_AITERM_TOO_OLD: "端末のAitermが古いため起こせません。端末のAitermを更新してください。",
  SEAT_FORWARD_UNAVAILABLE: "端末からBellTeamへ戻る通り道がまだ用意できていません。少し待ってから起こし直してください。",
  CWD_UNAVAILABLE: "端末に作業フォルダがありません。メンバーの作業フォルダを選び直すか、そのフォルダを作ってください。",
  AGENT_LAUNCH_NOT_STARTED: "席を作る途中で失敗しました。席は残っていません。もう一度起こし直します。",
  CLAUDE_AUTH_NOT_AUTHENTICATED: "端末のClaude Codeにログインしていません。端末でClaude Codeにログインしてください。",
  CLAUDE_AUTH_STATUS_UNCONFIRMED: "端末のClaude Codeのログイン状態を確かめられませんでした。少し待ってから起こし直してください。",
  CLAUDE_AUTH_STATUS_TIMEOUT: "端末のClaude Codeのログイン状態を時間内に確かめられませんでした。少し待ってから起こし直してください。",
};

/** The code of an Aiterm error text ("CODE: ..." or the terminal's "aiterm: CODE: ..."), or null. */
export function errorCode(text: string): string | null {
  return /^(?:aiterm: )?([A-Z][A-Z0-9_]{2,63}):/.exec(text)?.[1] ?? null;
}

export function terminalLaunchAction(code: unknown): string | null {
  return typeof code === "string" && Object.hasOwn(ACTIONS, code) ? ACTIONS[code] : null;
}

export const LAUNCH_ERROR_META = "aiterm/launch_error";
export const ERROR_CODE_META = "aiterm/error_code";

/** R18 for a local launch: the fresh native creation left no seat (core.freshLaunchFailure). */
export function launchNotStartedMeta(harness: string, phase: "native_create" | "input" = "native_create"): Record<string, unknown> {
  const code = "AGENT_LAUNCH_NOT_STARTED";
  return { [LAUNCH_ERROR_META]: { schema: "aiterm.agent-launch-error.v1", harness, code, phase,
    effect: "not_started", session_created: false, action: phase === "input" ? INPUT_ACTION : ACTIONS[code] } };
}
// phase "input": refused from the arguments alone; nothing was started, so launching again unchanged fails the same way.
const INPUT_ACTION = "起動の指定（追加の指示かMCPの設定）をこのAIでは使えません。席は作られていません。指定を見直してください。";

/** R19: the leading symbolic code of a refused call, so the caller does not parse text. It claims no effect. */
export function withErrorCode(result: any): any {
  if (!result?.isError) return result;
  const code = errorCode(result.content?.find((item: any) => item.type === "text")?.text ?? "");
  return code ? { ...result, _meta: { ...result._meta, [ERROR_CODE_META]: { schema: "aiterm.error-code.v1", code } } } : result;
}

/** Adds R18's `_meta` to a failed terminal launch result; a result whose code is not listed is returned unchanged.
 * `_meta`, not structuredContent: SDK clients that listed the tools validate structuredContent against the
 * success outputSchema even on isError, and would turn this refusal into a protocol error. */
export function withTerminalLaunchAction(result: any, harness = "claude-code"): any {
  if (!result?.isError || result._meta?.[LAUNCH_ERROR_META]) return result;
  const structured = result.structuredContent;
  const preflight = structured?.schema === "aiterm.agent-launch-error.v1";
  if (structured && !preflight) return result;
  const code = preflight ? structured.code : errorCode(result.content?.find((item: any) => item.type === "text")?.text ?? "");
  const action = terminalLaunchAction(code);
  if (!action) return result;
  const failure = preflight
    ? { schema: structured.schema, harness: structured.harness, code, phase: structured.phase, effect: structured.effect, session_created: false, action }
    : { schema: "aiterm.agent-launch-error.v1", harness, code, phase: "terminal", effect: "not_started", session_created: false, action };
  return { ...result, _meta: { ...result._meta, [LAUNCH_ERROR_META]: failure } };
}
