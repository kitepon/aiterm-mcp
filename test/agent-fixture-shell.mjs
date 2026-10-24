import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
// Print a stand-in TUI panel after a deliberately short-lived fake CLI exits.
// This is the owned agent's shell, distinct from public pty_open's bash.
export function agentFixturePrint(text) {
  if (process.platform === 'win32') {
    return `[Console]::Write([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(text).toString('base64')}')))`;
  }
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t");
  return "printf '%b' '" + escaped.replaceAll("'", "'\\''") + "'";
}
