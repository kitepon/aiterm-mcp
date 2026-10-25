/** Native input and admission belong to core; each harness owns its UI. */
export interface GoalNativeUi {
  read(): string;
  paste(text: string): Promise<void>;
  keys(keys: string[]): Promise<void>;
  pause(ms: number): Promise<void>;
  now?(): number;
}
