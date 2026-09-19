import { accessSync, constants } from "node:fs";
import { SetupError } from "./setup-platform.js";

// HomebrewのCellar実体は更新で消える。保存する起動先には同じformulaのoptを使う。
export function setupNodeExecutable(executable = process.execPath): string {
  const brew = /^(.*)\/Cellar\/(node(?:@\d+)?)\/[^/]+\/bin\/node$/.exec(executable);
  if (!brew) return executable;
  const node = `${brew[1]}/opt/${brew[2]}/bin/node`;
  try { accessSync(node, constants.X_OK); }
  catch { throw new SetupError("node_runtime_unavailable", "HomebrewのNode起動先を実行できません。Nodeの導入状態を確認してください"); }
  return node;
}
