// What a Claude Code seat started with when the launch named no model/effort (a442e). The CLI prints it in its start banner:
//   ▝▜██████▀  Opus 5.5 with high effort · API Usage Billing
//   ▝▜██████▀  Opus 5.5 (1M context) with high effort · ...
// shortcut: the banner scrolls away in a long first screen and a model without effort support prints no "with … effort"; both read as null
// (the seat then stays unable to hibernate, as before this change). Upgrade when a stable machine-readable source exists.
const BANNER_RE = /\b([A-Z][a-z]+) (\d+)(?:\.(\d+))?( \(1M context\))? with (low|medium|high|xhigh|max) effort\b/u;

export function claudeBannerSettings(screen: string): { model: string; effort: string } | null {
  for (const line of screen.split(/\r?\n/u).slice(0, 12)) {
    const hit = BANNER_RE.exec(line);
    if (!hit) continue;
    const [, family, major, minor, million, effort] = hit;
    return { model: `claude-${family.toLowerCase()}-${major}${minor === undefined ? "" : `-${minor}`}${million ? "[1m]" : ""}`, effort };
  }
  return null;
}
