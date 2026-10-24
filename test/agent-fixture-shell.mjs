import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
// The fake harness stays alive while its child shell renders controlled panels.
// Match that shell to the renderer below, including native Windows PowerShell 7.
export const agentFixtureShellCommand = process.platform === 'win32'
  ? 'pwsh -NoLogo -NoProfile'
  : '/bin/sh -i';

export function agentFixturePrint(text) {
  if (process.platform === 'win32') {
    return `[Console]::Write([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(text).toString('base64')}')))`;
  }
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t");
  return "printf '%b' '" + escaped.replaceAll("'", "'\\''") + "'";
}
