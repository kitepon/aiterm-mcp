// harnessの描画済みtoken表示。累積usageの正本ではなく、画面上の直近表示だけを返す。
export function paneTokenHint(screen: string): number | null {
  let latest: number | null = null;
  for (const match of screen.matchAll(/[↓↑]\s*([0-9]+(?:\.[0-9]+)?)\s*([kKmM]?)\s*tokens\b/gu)) {
    const multiplier = match[2].toLowerCase() === "m" ? 1_000_000 : match[2].toLowerCase() === "k" ? 1_000 : 1;
    const value = Math.round(Number(match[1]) * multiplier);
    if (Number.isSafeInteger(value) && value >= 0) latest = value;
  }
  return latest;
}
