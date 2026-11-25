/**
 * A short, masked excerpt of a startup screen Aiterm refused to answer, so a caller can log what the seat stopped on after the seat is
 * closed (AGENT_STARTUP_BLOCKED, agent_launch error `_meta["aiterm/launch_error"].startup_screen_excerpt`).
 * shortcut: masking is pattern-based (URL query/fragment, long opaque runs, key=value secrets, e-mail); a short bare secret on its own line is not caught.
 */
const MAX_LINES = 20, MAX_LINE = 200, MAX_TOTAL = 3000;
// eslint-disable-next-line no-control-regex
const CONTROL = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|[\u0000-\u0008\u000b-\u001f\u007f]/g;
// The shell line that started the harness carries the seat's launch environment: never part of the excerpt.
const LAUNCH_ECHO = /AITERM_[A-Z_]+=|^\S+@\S+:\S*[$#] /;
const maskRun = (run: string) => run.length >= 24 && (/\d/.test(run) || (/[a-z]/.test(run) && /[A-Z]/.test(run))) ? "[masked]" : run;
export function maskScreenLine(line: string): string {
  return line
    .replace(/(https?:\/\/[^\s?#]*)[?#]\S*/gi, "$1?[masked]")
    .replace(/\b(api[_-]?key|token|secret|password|passwd|authorization|code)\b(\s*[:=]\s*)(?!\[masked\])(\S+)/gi, (_all, key, sep) => `${key}${sep}[masked]`)
    .replace(/\b(bearer)\s+(?!\[masked\])\S+/gi, "$1 [masked]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/[A-Za-z0-9_+=-]{24,}/g, maskRun);
}
/** The last non-empty lines of a captured screen, masked and capped; null when nothing readable remains. */
export function startupScreenExcerpt(screen: string | null | undefined): string | null {
  if (typeof screen !== "string") return null;
  const lines = screen.replace(CONTROL, "").split(/\r?\n/).map(line => line.replace(/\s+$/, "")).filter(line => line.trim() !== "" && !LAUNCH_ECHO.test(line.trim())).slice(-MAX_LINES)
    .map(line => { const masked = maskScreenLine(line); return masked.length > MAX_LINE ? masked.slice(0, MAX_LINE - 1) + "…" : masked; });
  const text = lines.join("\n");
  if (!text) return null;
  return text.length > MAX_TOTAL ? "…" + text.slice(-(MAX_TOTAL - 1)) : text;
}
