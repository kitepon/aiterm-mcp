// ほかの製品が、Aitermの親配送の入口（aiterm-parent-delivery）の場所を知るための記録（ADR 0098）。
// 製品のprocess（MCP serverや常駐process）は、PATHにnpmの置き場が無い環境で起きる事がある（macOSのアプリ配下など）。
// setupが、nodeと命令の絶対pathをHOMEの下へ残す。製品は読むだけで、書かない。
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { writeJson0600 } from "aiterm-steer-delivery";
import type { Registration } from "./setup-integrations.js";

export const DELIVERY_PROVIDER_SCHEMA = "aiterm.delivery-provider.v1";
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

export function deliveryProviderFile(home = process.env.HOME ?? homedir()): string {
  return path.join(home, ".config", "aiterm-mcp", "delivery-provider.json");
}

/**
 * 登録（nodeの絶対pathとdist/index.js）から、同じ導入のaiterm-parent-deliveryの場所を記録する。変わりが無ければ書かない。
 * MCPの本体の起動時には呼ばない（試験用に別の場所から起こした本体が、導入済みの記録を書き換えるため）。
 */
export function writeDeliveryProvider(home: string, registration: Registration): "configured" | "unchanged" {
  const entry = registration.args[0];
  if (!path.isAbsolute(home) || !path.isAbsolute(registration.command) || typeof entry !== "string" || !path.isAbsolute(entry)) {
    throw new Error("delivery providerの記録には、homeと登録の絶対pathが要ります");
  }
  const cli = path.join(path.dirname(entry), "parent-delivery-cli.js");
  if (!fs.existsSync(cli)) throw new Error("aiterm-parent-deliveryの入口が、登録と同じ導入の中にありません");
  const next = { schema: DELIVERY_PROVIDER_SCHEMA, version: pkg.version, node: registration.command, cli };
  const file = deliveryProviderFile(home);
  try { if (isDeepStrictEqual(JSON.parse(fs.readFileSync(file, "utf8")), next)) return "unchanged"; } catch { /* 無い・読めない時は書く */ }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeJson0600(file, next);
  return "configured";
}
