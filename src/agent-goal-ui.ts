/** Native input and admission belong to core; each harness owns its UI. */
export interface GoalNativeUi {
  read(): string;
  paste(text: string): Promise<void>;
  keys(keys: string[], expectedRow?: { row: number; text: string }, confirm?: (screen: string) => boolean): Promise<void>;
  click?(column: number, row: number, confirm: (screen: string) => boolean): Promise<void>;
  pause(ms: number): Promise<void>;
  now?(): number;
}

export function nativeGoalClickBytes(column: number, row: number, columns: number, rows: number): string {
  if (![column, row, columns, rows].every(value => Number.isSafeInteger(value) && value > 0 && value <= 10000)
    || column > columns || row > rows) throw new Error("Goal pointer outside pane");
  return `\x1b[<0;${column};${row}M\x1b[<0;${column};${row}m`;
}

export interface NativeGoalCell { text: string; dim: boolean; decorated: boolean; inverse: boolean }
export function nativeGoalStyledRows(raw: string): NativeGoalCell[][] {
  let dim = false, bold = false, color = false, inverse = false;
  const result: NativeGoalCell[][] = [[]];
  for (const token of raw.matchAll(/\x1b\[([0-9;]*)m|([^\x1b])/gu)) {
    if (token[1] !== undefined) {
      const codes = token[1].split(';').map(Number);
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (code === 0) { dim = false; bold = false; color = false; inverse = false; }
        if (code === 2) dim = true;
        if (code === 7) inverse = true;
        if (code === 27) inverse = false;
        if (code === 22) { dim = false; bold = false; }
        if (code === 1) bold = true;
        if (code === 39) color = false;
        if (code >= 30 && code <= 37 || code >= 90 && code <= 97) color = true;
        if (code === 38 || code === 48) {
          if (code === 38) color = true;
          i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0;
        }
      }
    } else if (token[2] === '\n') result.push([]);
    else result.at(-1)!.push({ text: token[2], dim, decorated: bold || color, inverse });
  }
  return result;
}
