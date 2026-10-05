// 中継（mcp-lazy）の見分け。取り決めはmcp-lazyのREADMEにある（実行ファイルの名前が`mcp-lazy`で始まる）。
// process表の読み手（process-runtime）と、登録の読み手（setup-integrations）が同じ決まりを使う。
// setup-integrationsは連携元のprocessへ直接読み込まれるので、ここはnode:pathだけに依存する。
import path from "node:path";

/** 実行ファイルのpathが中継（mcp-lazy）か。名前（basename）が`mcp-lazy`で始まる物。 */
export function lazyRelayExecutable(file: string): boolean {
  return path.posix.basename(file.replace(/\\/g, "/")).toLowerCase().startsWith("mcp-lazy");
}
