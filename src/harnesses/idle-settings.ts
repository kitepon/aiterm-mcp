import { claudeModelPicker, claudeModelPickerRow } from './claude.js';
import { sleep, type AgentKind } from '../agent-shared.js';

export interface IdleSettings { model: string | null; reasoning_effort: string | null; fast: boolean }
export interface IdleSettingsUi {
  screen(): string;
  command(text: string): Promise<void>;
  text(text: string): void;
  key(...keys: string[]): void;
  ready(): Promise<boolean>;
}

export function codexSettingsPreview(screen: string): {
  rows: { id: string; checked: boolean; cursor: boolean }[]; preview: string;
} | null {
  const lines = screen.split(/\r?\n/);
  let head = lines.length - 1;
  while (head >= 0 && !/^\s*Configure Status Line\s*$/.test(lines[head])) head--;
  if (head < 0) return null;
  const footer = lines.findIndex((line, i) => i > head && /space toggle.*enter save.*esc cancel/.test(line));
  if (footer < 0 || lines.slice(footer + 1).some(line => line.trim())) return null;
  const rows = lines.slice(head + 1, footer - 1).flatMap(line => {
    const match = /^\s*(›\s*)?\[([x ])\]\s+([a-z][a-z0-9-]*)\s{2,}\S/.exec(line);
    return match ? [{ id: match[3], checked: match[2] === 'x', cursor: !!match[1] }] : [];
  });
  return { rows, preview: lines[footer - 1].trim() };
}

export function codexPreviewMatchesSettings(preview: string, expected: IdleSettings): boolean {
  const match = /^(\S+) (none|minimal|low|medium|high|xhigh|max|ultra)( Fast)? · (Standard|Fast|Fast off)$/.exec(preview);
  return !!match && !!expected.model && match[1].toLowerCase() === expected.model.toLowerCase()
    && match[2] === expected.reasoning_effort && !!match[3] === (match[4] === 'Fast')
    && (match[4] === 'Fast') === expected.fast;
}

function claudeFastMenu(screen: string): boolean {
  return /(?:^|\n)\s*↯ Fast mode\s*\n/.test(screen) && /(?:^|\n)\s*Esc to cancel\s*$/.test(screen);
}

async function until<T>(read: () => T | null): Promise<T | null> {
  const deadline = performance.now() + 1500;
  do { const value = read(); if (value !== null) return value; await sleep(75); }
  while (performance.now() < deadline);
  return null;
}

/** Preview only: Enter is used to open a command, never to save a selection. */
export async function inspectIdleSettings(kind: AgentKind, expected: IdleSettings, ui: IdleSettingsUi): Promise<boolean> {
  if (!expected.model || !expected.reasoning_effort || !['claude', 'codex'].includes(kind)) return false;
  if (kind === 'claude' && !/^claude-[a-z]+-\d+(?:-\d{1,2})?$/.test(expected.model)) return false;
  const inMenu = (screen: string) => kind === 'codex' ? codexSettingsPreview(screen) !== null
    : (claudeModelPicker(screen) !== null && /Esc to cancel\s*$/.test(screen)) || claudeFastMenu(screen);
  const close = async (): Promise<boolean> => {
    for (let i = 0; i < 3 && inMenu(ui.screen()); i++) {
      ui.key('Escape');
      await until(() => !inMenu(ui.screen()) ? true : null);
    }
    return !inMenu(ui.screen()) && await ui.ready();
  };
  let matched = false;
  try {
    if (kind === 'codex') {
      await ui.command('/statusline');
      if (!await until(() => codexSettingsPreview(ui.screen()))) return false;
      let query = '';
      const select = async (id: string, checked: boolean): Promise<boolean> => {
        if (query.length) ui.key(...Array<string>(query.length).fill('BSpace'));
        ui.text(id); query = id;
        const row = () => {
          const menu = codexSettingsPreview(ui.screen());
          return menu?.rows.length === 1 && menu.rows[0].id === id && menu.rows[0].cursor ? menu.rows[0] : null;
        };
        const before = await until(row);
        if (!before) return false;
        if (before.checked !== checked) {
          ui.key('Space');
          if (!await until(() => row()?.checked === checked ? true : null)) return false;
        }
        return true;
      };
      // These default items otherwise clip the native settings at narrow widths.
      for (const [id, checked] of [['current-dir', false], ['thread-name', false], ['model-with-reasoning', true], ['fast-mode', true]] as const)
        if (!await select(id, checked)) return false;
      const preview = codexSettingsPreview(ui.screen());
      matched = !!preview && codexPreviewMatchesSettings(preview.preview, expected);
    } else {
      await ui.command('/model');
      const menu = await until(() => claudeModelPicker(ui.screen()));
      if (!menu) return false;
      const current = menu.rows.filter(row => row.current);
      const requested = claudeModelPickerRow(menu.rows, expected.model);
      if (current.length !== 1 || !current[0].cursor || requested !== current[0] || menu.effort !== expected.reasoning_effort) return false;
      if (!await close()) return false;
      await ui.command('/fast');
      if (!await until(() => claudeFastMenu(ui.screen()) ? true : null)) return false;
      // Other account/menu layouts remain unknown until their native receipt is accepted.
      matched = !expected.fast && /^\s*Fast mode requires usage credits · \/usage-credits to turn them on\s*$/m.test(ui.screen());
    }
  } finally {
    if (!await close()) matched = false;
  }
  return matched;
}
