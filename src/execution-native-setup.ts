// Compatibility (0.70.109): the old name and output schema of native-setup.ts, kept until the release that drops it
// (bellteam-boundary.md "汎用の入口"). The output is what 0.70.58 to 0.70.108 printed: bellteam.harness-entries.v1, the old entry only.
import { nativeHookEntries } from "./native-setup.js";

export async function nativeExecutionHarnessEntries(home: string, options: Parameters<typeof nativeHookEntries>[1]) {
  const { schema: _generic, owns, ...rest } = await nativeHookEntries(home, options);
  return { ...rest, schema: "bellteam.harness-entries.v1" as const, owns: { commandIncludes: owns.commandIncludes.filter(name => name !== "native-entry.js") } };
}
