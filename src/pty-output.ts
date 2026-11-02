// PTY表示の純粋な縮約。入力・native操作・完了判定はcoreが所有する。
// 出力削減（RTK の CAP 思想を移植）
const MAX_LINES_BEFORE_ELIDE = 60;
const HEAD_LINES = 30;
const TAIL_LINES = 20;
const MAX_LINE_CHARS_BEFORE_ELIDE = 2000;
const LINE_HEAD_CHARS = 1200;
const LINE_TAIL_CHARS = 600;
const DEDUP_MIN_RUN = 3; // 同一行がこれ以上連続したら 1 行＋件数に畳む

// CSI/OSC/ESC エスケープ・制御文字
// CSI / OSC(BEL or ST 終端) / DCS・PM・APC・SOS(ESC P/^/_/X … BEL or ST 終端。ペイロード本文ごと除去=B10) / 残る2文字エスケープ
export const ANSI_RE =
  /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P^_X][\s\S]*?(?:\x07|\x1b\\)|\x1b[@-_]/g;
export const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g; // \t(09) \n(0a) は残す

export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4.0);
}

export function stripControl(text: string): string {
  // OSC/DCS等の本文内のCRを、印字された進捗断片として扱わない。
  text = text.replace(ANSI_RE, sequence => sequence.startsWith("\x1b[") ? sequence : "");
  text = text.replace(/\r\n/g, "\n"); // CRLF 正規化
  const out: string[] = [];
  for (const line of text.split("\n")) {
    let visibleLine = "";
    for (const part of line.split("\r")) {
      const visible = part.replace(ANSI_RE, "").replace(CTRL_RE, "");
      // CRとcursor表示切替だけでは、既に印字した結果や完了印を消さない。
      if (visible !== "" || /\x1b\[[0-2]?K/.test(part)) visibleLine = visible;
    }
    out.push(visibleLine.replace(/\s+$/, "")); // rstrip
  }
  return out.join("\n");
}

function collapseBlanks(lines: string[]): string[] {
  const out: string[] = [];
  let blanks = 0;
  for (const ln of lines) {
    if (ln === "") {
      blanks++;
      if (blanks <= 1) out.push(ln);
    } else {
      blanks = 0;
      out.push(ln);
    }
  }
  while (out.length && out[0] === "") out.shift();
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

function dedupRuns(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    let j = i;
    while (j < n && lines[j] === lines[i]) j++;
    const run = j - i;
    if (run >= DEDUP_MIN_RUN && lines[i] !== "") out.push(`${lines[i]}  〈×${run}〉`);
    else out.push(...lines.slice(i, j));
    i = j;
  }
  return out;
}

function surrogateSafeEnd(text: string, end: number): number {
  return end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])
    ? end + 1
    : end;
}

function surrogateSafeStart(text: string, start: number): number {
  return start > 0 && start < text.length && /[\uD800-\uDBFF]/.test(text[start - 1]) && /[\uDC00-\uDFFF]/.test(text[start])
    ? start - 1
    : start;
}

function elideLongLines(lines: string[]): string[] {
  return lines.map((line) => {
    if (line.length <= MAX_LINE_CHARS_BEFORE_ELIDE) return line;
    const headEnd = surrogateSafeEnd(line, LINE_HEAD_CHARS);
    const tailStart = surrogateSafeStart(line, line.length - LINE_TAIL_CHARS);
    const omitted = tailStart - headEnd;
    return `${line.slice(0, headEnd)}… 〈行内 ${omitted} 文字省略。全文は raw:true か line_range で取得〉 …${line.slice(tailStart)}`;
  });
}

/** RTK 4戦略を移植: 制御除去 / 空白正規化 / 連続重複圧縮 / head+tail 折りたたみ。返り値 [body, meta]。 */
export function reduceOutput(raw: string, name: string, elide = true): [string, string] {
  const rawLinesN = (raw.match(/\n/g)?.length ?? 0) + (raw && !raw.endsWith("\n") ? 1 : 0);
  const cleaned = stripControl(raw);
  let lines = collapseBlanks(cleaned.split("\n"));
  lines = dedupRuns(lines);
  let elided = 0;
  if (elide && lines.length > MAX_LINES_BEFORE_ELIDE) {
    elided = lines.length - HEAD_LINES - TAIL_LINES;
    const hint = `… 〈${elided} 行省略。全文は full=true、範囲は line_range="A:B"〉 …`;
    lines = [...lines.slice(0, HEAD_LINES), hint, ...lines.slice(lines.length - TAIL_LINES)];
  }
  if (elide) lines = elideLongLines(lines);
  const body = lines.join("\n");
  const meta =
    `[aiterm ${name}: ${lines.length} 行 / ~${estimateTokens(body)} tok ` +
    `(raw ${rawLinesN} 行 / ~${estimateTokens(raw)} tok)` +
    (elided ? `; ${elided} 行 hidden]` : "]");
  return [body, meta];
}

