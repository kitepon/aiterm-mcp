// coreが保持するnative作用への内部接点。命令はEnterまで含む。
export interface AgentModelUi {
  screen(): string;
  command(text: string): Promise<void>;
  key(...keys: string[]): void;
}

export function lineCounts(screen: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of screen.split("\n").map((value) => value.trim()).filter(Boolean)) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}
