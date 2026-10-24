// Print a stand-in TUI panel after a deliberately short-lived fake CLI exits.
// This is the owned agent's shell, distinct from public pty_open's bash.
export function agentFixturePrint(text) {
  if (process.platform === 'win32') {
    return `[Console]::Write([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(text).toString('base64')}')))`;
  }
  return "printf '%s' '" + text.replaceAll("'", "'\\''") + "'";
}
