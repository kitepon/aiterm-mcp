// Official TUI input lives here; core owns the existing PTY and admission.
import { codexPaneObservation } from "./codex.js";
import { AgentGoalNotIssuedError, type NativeGoal } from "../agent-goal.js";
export interface CodexGoalUi {
  read(): string;
  paste(text: string): Promise<void>;
  keys(keys: string[]): Promise<void>;
  pause(ms: number): Promise<void>;
  now?(): number;
}
interface Cell { text: string; dim: boolean; decorated: boolean }
function rows(raw: string): Cell[][] {
  let dim = false, bold = false, color = false;
  const result: Cell[][] = [[]];
  for (const token of raw.matchAll(/\x1b\[([0-9;]*)m|([^\x1b])/gu)) {
    if (token[1] !== undefined) {
      const codes = token[1].split(';').map(Number);
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (code === 0) { dim = false; bold = false; color = false; }
        if (code === 2) dim = true;
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
    else result.at(-1)!.push({ text: token[2], dim, decorated: bold || color });
  }
  return result;
}
const plain = (line: Cell[]) => line.map(x => x.text).join('');
export function codexGoalUiState(raw: string): { kind: 'composer' | 'editor' | 'other'; empty: boolean; text: string } {
  const lines = rows(raw), text = lines.map(plain).join('\n');
  let marker = -1;
  for (let i = 0; i < lines.length; i++) if (/^\s*›(?:\s|$)/u.test(plain(lines[i]))) marker = i;
  if (marker < 0) return { kind: 'other', empty: false, text: '' };
  const start = plain(lines[marker]).indexOf('›') + 1;
  const body = [lines[marker].slice(start), ...lines.slice(marker + 1)];
  const header = lines.slice(0, marker).map(plain).join('\n');
  const footer = body.findIndex(line => /^\s*enter submit · esc back\s*$/u.test(plain(line))
    && line.some(cell => cell.decorated && cell.text.trim()));
  if (/\bEdit goal\s*$/u.test(header.trimEnd()) && footer >= 0) {
    const content = body.slice(0, footer).flat();
    const value = body.slice(0, footer).map((line, i) => plain(line).slice(i === 0 ? 1 : 2).trimEnd()).join('\n').trim();
    const empty = value === 'Type a goal objective and press Enter'
      && content.filter(c => c.text.trim()).every(c => c.dim);
    return { kind: 'editor', empty, text: empty ? '' : value };
  }
  if (!['idle', 'busy'].includes(codexPaneObservation(text).state)) return { kind: 'other', empty: false, text: '' };
  const end = body.findIndex(line => {
    const value = plain(line);
    return line.some(c => c.decorated && c.text.trim())
      && (/\? for shortcuts|⚠.*warnings|\s·\s/u.test(value));
  });
  const content = (end < 0 ? body : body.slice(0, end));
  const cells = content.flat().filter(c => c.text.trim());
  return { kind: 'composer', empty: cells.every(c => c.dim),
    text: cells.every(c => c.dim) ? '' : content.map(plain).map(line => line.trimEnd()).join('\n').trim() };
}
async function wait(ui: CodexGoalUi, predicate: (s: ReturnType<typeof codexGoalUiState>) => boolean): Promise<boolean> {
  const now = ui.now ?? (() => performance.now());
  const until = now() + 1500;
  do { if (predicate(codexGoalUiState(ui.read()))) return true; await ui.pause(40); } while (now() < until);
  return false;
}
export async function submitCodexGoalCommand(ui: CodexGoalUi, command: string): Promise<void> {
  const before = codexGoalUiState(ui.read());
  if (before.kind !== 'composer' || !before.empty) throw new AgentGoalNotIssuedError('goal_input_not_empty_or_ready');
  await ui.paste('/goal ' + command);
  if (!await wait(ui, s => s.kind === 'composer' && s.text === '/goal ' + command))
    throw new Error('Goal command input unconfirmed');
  await ui.keys(['Enter']);
}
export function editableCodexGoal(goal: NativeGoal | null): boolean {
  return !!goal && !goal.objective.startsWith('Read the Codex goal objective file at ')
    && !/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(goal.objective);
}
export async function editCodexGoalObjective(ui: CodexGoalUi, before: NativeGoal, objective: string): Promise<void> {
  if (!editableCodexGoal(before) || /[\u0000-\u0009\u000b-\u001f\u007f]/u.test(objective))
    throw new AgentGoalNotIssuedError('native_goal_objective_not_representable', 'unsupported');
  await submitCodexGoalCommand(ui, 'edit');
  if (!await wait(ui, s => s.kind === 'editor')) throw new Error('Native goal editor unconfirmed');
  let submitted = false;
  try {
    const count = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(before.objective)].length;
    await ui.keys(Array(count).fill('BSpace'));
    if (!await wait(ui, s => s.kind === 'editor' && s.empty)) throw new Error('Native goal editor clearing unconfirmed');
    await ui.paste(objective);
    const visibleObjective = objective.split('\n').map(line => line.trimEnd()).join('\n').trim();
    if (!await wait(ui, s => s.kind === 'editor' && s.text === visibleObjective)) throw new Error('Native goal editor input unconfirmed');
    // No command can be retried after this boundary.
    submitted = true;
    await ui.keys(['Enter']);
  } catch (error) {
    if (!submitted && codexGoalUiState(ui.read()).kind === 'editor') {
      // The native prompt handles bare Esc itself. Vim insert takes one Esc
      // before the next cancels; only send another while this editor remains.
      for (let n = 0; n < 2 && codexGoalUiState(ui.read()).kind === 'editor'; n++) {
        await ui.keys(['Escape']); await ui.pause(40);
      }
      if (codexGoalUiState(ui.read()).kind === 'composer')
        throw new AgentGoalNotIssuedError('native_goal_editor_input_unconfirmed', 'unsupported');
    }
    throw error;
  }
}
