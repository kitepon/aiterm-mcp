// ファスト（高速の応答）の切り替えの、harness中立の部分（ADR 0114）。
// harnessごとの切り替え方は src/harnesses/ と core が持ち、ここは断りの符号と、起動時の扱いだけを持つ。
import { AitermError } from "./errors.js";

/**
 * 断りの符号（4つのharnessで共通。文の先頭に付く）。
 * - FAST_MODE_NOT_SUPPORTED: そのharness・そのmodelはfastへ切り替えられない（fast: true の時だけ）。
 * - FAST_MODE_UNAVAILABLE: アカウントや契約で使えない（harnessの出した文を添える）。
 * - FAST_MODE_MODEL_CONFLICT: modelへfast版のIDを直に書いて、fast: false を渡した。
 * - FAST_MODE_UNCONFIRMED: 切り替えた後の状態を画面で確かめられない。
 */
export type FastModeErrorCode =
  | "FAST_MODE_NOT_SUPPORTED"
  | "FAST_MODE_UNAVAILABLE"
  | "FAST_MODE_MODEL_CONFLICT"
  | "FAST_MODE_UNCONFIRMED";

export class FastModeError extends AitermError {
  readonly fast_code: FastModeErrorCode;
  constructor(code: FastModeErrorCode, detail: string) {
    super(`${code}: ${detail}`, 2);
    this.name = "FastModeError";
    this.fast_code = code;
  }
}

/** 起動の返りの fast_error。fastへ出来ずに通常の速度で起こした時だけ入る。 */
export interface FastModeFailure {
  code: FastModeErrorCode;
  message: string;
}

/**
 * 起動時にfastへ出来なかった時、起動を断らずに通常の速度で起こす符号か。
 * アカウントの都合（credits切れ等）や確かめられない時に起動まで断ると、呼び手の席が起きず、届いた文が落ちる。
 * 設定の誤り（対応していないmodel、IDとの食い違い）は、起動の前に断る。
 */
export function launchContinuesWithoutFast(code: FastModeErrorCode): boolean {
  return code === "FAST_MODE_UNAVAILABLE" || code === "FAST_MODE_UNCONFIRMED";
}

export function fastModeFailure(error: unknown): FastModeFailure | null {
  return error instanceof FastModeError ? { code: error.fast_code, message: error.message } : null;
}
