// Official TUI input lives here; core owns the existing PTY and admission.
import { codexPaneObservation } from "./codex.js";
import { AgentGoalNotIssuedError, type NativeGoal } from "../agent-goal.js";
import type { GoalNativeUi } from "../agent-goal-ui.js";
export type CodexGoalUi = GoalNativeUi;
import { nativeGoalStyledRows as rows, type NativeGoalCell as Cell } from "../agent-goal-ui.js";
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
      && (/^\s*\? for shortcuts|^\s*⚠\s*\d+ warnings|^\s*\S+\s+(?:default|minimal|low|medium|high|xhigh|ultra)\s*·\s/u.test(value));
  });
  const content = (end < 0 ? body : body.slice(0, end));
  const cells = content.flat().filter(c => c.text.trim());
  return { kind: 'composer', empty: cells.every(c => c.dim),
    text: cells.every(c => c.dim) ? '' : content.map((line, i) => plain(line).slice(i === 0 ? 1 : 2).trimEnd()).join('\n').trim() };
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
export async function createCodexGoalObjective(ui: CodexGoalUi, objective: string): Promise<void> {
  if (['clear', 'edit', 'pause', 'resume'].includes(objective.trim().toLowerCase()))
    throw new AgentGoalNotIssuedError('native_goal_create_objective_reserved', 'unsupported');
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(objective))
    throw new AgentGoalNotIssuedError('native_goal_objective_not_representable', 'unsupported');
  const before = codexGoalUiState(ui.read());
  if (before.kind !== 'composer' || !before.empty) throw new AgentGoalNotIssuedError('goal_input_not_empty_or_ready');
  // The official composer folds an individual paste above 1000 characters
  // into an attachment. Complete bounded literal paste events avoid that
  // transformation; core preserves their order on the same input channel.
  const text = '/goal ' + objective;
  let chunk = '';
  for (const character of text) {
    chunk += character;
    if ([...chunk].length >= 128 || character === '\n') {
      await ui.paste(chunk); chunk = ''; await ui.pause(40);
      if (codexGoalUiState(ui.read()).kind !== 'composer') throw new Error('Goal creation input owner changed');
    }
  }
  if (chunk) await ui.paste(chunk);
  const expected = text.split('\n').map(line => line.trimEnd()).join('\n').trim();
  if (!await wait(ui, state => {
    if (state.kind !== 'composer' || state.empty || /\[Pasted (?:Content|Text)/u.test(state.text)) return false;
    if (state.text === expected) return true;
    // A native viewport can hide earlier rows. The last visible row must
    // finish the ordered literal input; canonical readback still compares
    // the complete objective, never a suffix or a display approximation.
    const tail = state.text.split('\n').filter(line => line.trim()).at(-1)?.trim() ?? '';
    return tail.length > 0 && expected.endsWith(tail);
  })) throw new Error('Goal creation input unconfirmed');
  await ui.keys(['Enter']);
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
