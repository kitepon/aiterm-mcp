import { existsSync } from "node:fs";

/**
 * このprocessのNodeを、後からでも起こせる場所で返す。自分でNodeを起こす時と、呼び手へ「起こす先」として渡す時に使う。
 * `process.execPath`は起きた時の実体で、長く動くprocessでは後から消える事がある（Homebrewは版ごとの場所へ入れ、更新で前の版を消す。
 * 2026-10-12、MacでNodeが26.10.0_1から26.11.1へ上がり、前の版から起きていたMCP process 19個が、無いNodeを起こそうとして黙って失敗していた）。
 * Homebrewの時は同じformulaのopt（更新でも残る）を返す。実体が消えていて代わりも無い時は、PATHから探させる（`node`）。
 * aiterm-steer-deliveryの同じ名前の関数と同じ決まり（0.4.6〜）。
 */
export function liveNodeExecutable(executable = process.execPath, exists: (file: string) => boolean = existsSync): string {
  const brew = /^(.*)\/Cellar\/(node(?:@\d+)?)\/[^/]+\/bin\/node$/.exec(executable);
  if (brew) {
    const opt = `${brew[1]}/opt/${brew[2]}/bin/node`;
    if (exists(opt)) return opt;
  }
  return exists(executable) ? executable : "node";
}
