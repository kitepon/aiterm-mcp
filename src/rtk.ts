/**
 * rtk — RTK の出力削減を「自前実装」で移植した read 側リデューサ群（Node/TS 版）。
 *
 * 要件C: rtk のファイルは複製せず、アルゴリズムを参照に自分のコードとして書き起こす。
 * rtk バイナリが無い場所でも縮約が効くよう、観測済み出力に対して動く。
 * 手本は rtk 0.50.0。pytest は同版の出力と厳密一致させ、grep は上限に届かなければ出力をそのまま返す。
 * rtk の never_worse と同じく、縮めた結果が元より多くのトークンを使うなら reducer を適用しない。
 *
 * 公開 API: reduce(command, output) -> [reducedText|null, reducerName|null] / classify / stripShellFrame
 */

// rtk 由来のキャップ（truncate.rs / config.rs / main.rs の値。数値のみ参照、コードは自作）
const CAP_GREP_TOTAL = 200; // grep: まとめる時に表示する最大行（文脈行を含む）
const CAP_GREP_PER_FILE = 25; // grep: まとめる時のファイルあたり最大
const GREP_MAX_LEN = 80; // grep: まとめる時の 1 行の最大幅（UTF-8 バイトで判定）
const COMPACT_PATH_THRESH = 50; // grep: パス短縮の閾値
const MAX_PYTEST_FAILURES = 10; // pytest: 失敗ブロック最大
const MAX_XFAIL = 10; // pytest: xfail/xpass 行 最大
const PYTEST_RELEVANT_PER_FAIL = 3;
const LOG_LIMIT_DEFAULT = 10; // git log: 既定コミット数
const LOG_BODY_LINES = 3;
const LOG_WIDTH = 80;
const LOG_WIDTH_USER_LIMIT = 120; // git log: 利用者が件数を決めた時の幅

/** char(コードポイント)ベース切り詰め（rtk utils::truncate と同等）。 */
function truncate(s: string, n: number): string {
  const cp = Array.from(s);
  if (cp.length <= n) return s;
  if (n < 3) return "...";
  return cp.slice(0, n - 3).join("") + "...";
}

// プロンプト行の判定（C3）: 行全体が「プロンプト前置文字(語/@ : ~ / \ [] . -)＋プロンプト記号($#%>)＋末尾空白」
// の形のときだけプロンプトとみなす。末尾記号だけを見ると `</div>` `>>>` `echo x >` 等の本文行を誤除去する。
const PROMPT_TAIL = /^[\w@.:~\/\\\[\]-]*[$#%>]\s*$/;

/** 観測ログ片からエコー行と前後のプロンプト行を落とし、コマンド出力本体だけ残す（発見的）。 */
export function stripShellFrame(text: string, command: string): string {
  const lines = text.split("\n");
  const cmd = command.trim();
  let start = 0;
  if (cmd) {
    // 最初の一致（＝コマンドエコー行）だけを落とす。最後の一致まで進めると、出力本体に cmd 文字列が
    // 再出現（cat したファイル内・commit メッセージ内 等）した場合に本体を丸ごと捨ててしまう（C2）。
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(cmd)) {
        start = i + 1;
        break;
      }
    }
  }
  let end = lines.length;
  while (end > start) {
    const last = lines[end - 1];
    if (!last.trim() || (PROMPT_TAIL.test(last) && (!cmd || !last.includes(cmd)))) end--;
    else break;
  }
  return lines.slice(start, end).join("\n");
}

// ---------------------------------------------------------------- pytest

export function reducePytest(output: string): string | null {
  let summaryLine = "";
  const failures: string[] = [];
  const xfailLines: string[] = [];
  let pytestEvidence = false;
  let state = "header";
  let current: string[] = [];
  const flush = () => {
    if (current.length) {
      failures.push(current.join("\n"));
      current = [];
    }
  };

  for (const line of output.split("\n")) {
    const t = line.trim();
    if (t.startsWith("===") && t.includes("test session starts")) {
      state = "header";
      continue;
    }
    if (t.startsWith("===") && t.includes("FAILURES")) {
      pytestEvidence = true;
      state = "failures";
      continue;
    }
    if (t.startsWith("===") && t.includes("short test summary")) {
      pytestEvidence = true;
      state = "summary";
      flush();
      continue;
    }
    if (t.includes("no tests ran in")) pytestEvidence = true;
    if (
      t.startsWith("===") &&
      (t.includes("passed") || t.includes("failed") || t.includes("skipped") || t.includes("error"))
    ) {
      // 収集エラーのみ（`=== 1 error in Xs ===`）も要約行として拾う。拾わないと全ゼロ扱いで
      // "No tests collected"（無害誤読）に潰れる。"ERRORS" セクション見出しは大文字ゆえ非該当。
      summaryLine = t;
      continue;
    }
    if (
      !summaryLine &&
      !t.startsWith("===") &&
      !t.startsWith("FAILED") &&
      !t.startsWith("ERROR") &&
      (t.includes(" passed") || t.includes(" failed") || t.includes(" skipped") || t.includes(" error")) &&
      t.includes(" in ")
    ) {
      summaryLine = t;
      continue;
    }
    if (state === "header") {
      if (t.startsWith("collected")) state = "progress";
    } else if (state === "progress") {
      // 進捗ドット行は捨てる
    } else if (state === "failures") {
      if (t.startsWith("___")) {
        flush();
        current.push(t);
      } else if (t && !t.startsWith("===")) {
        current.push(t);
      }
    } else if (state === "summary") {
      if (t.startsWith("FAILED") || t.startsWith("ERROR")) failures.push(t);
      else if (t.startsWith("XFAIL") || t.startsWith("XPASS")) xfailLines.push(t);
    }
  }
  flush();

  const [p, f, s, xf, xp, e] = parsePytestCounts(summaryLine);
  if (/\b\d+\s+(?:passed|failed|skipped|xfailed|xpassed|errors?)\b/.test(summaryLine)) pytestEvidence = true;
  if (!pytestEvidence) return null;
  if (p === 0 && f === 0 && s === 0 && xf === 0 && xp === 0 && e === 0) {
    // rtk 0.50.0 は報告前に落ちた実行（exit≠0,5）を "No tests collected" にせず元の出力を返す。
    // read 側は終了コードを持たないので、pytest 自身の異常終了の印で見分ける。
    if (/^(INTERNALERROR>|ERROR: )/m.test(output)) return null;
    return "Pytest: No tests collected";
  }
  // error(収集/内部エラー)は失敗の一種＝緑扱いにしない。extras に含め、"N passed" 早期 return を止める。
  const extras = s > 0 || xf > 0 || xp > 0 || e > 0 || xfailLines.length > 0;
  if (f === 0 && p > 0 && !extras) return `Pytest: ${p} passed`;

  let head = `Pytest: ${p} passed, ${f} failed`;
  if (e > 0) head += `, ${e} error${e === 1 ? "" : "s"}`;
  if (s > 0) head += `, ${s} skipped`;
  if (xf > 0) head += `, ${xf} xfailed`;
  if (xp > 0) head += `, ${xp} xpassed`;
  const out: string[] = [head];

  if (xfailLines.length) {
    out.push("", "Expected-failure outcomes:");
    for (const ln of xfailLines.slice(0, MAX_XFAIL)) out.push("  " + truncate(ln, 120));
    if (xfailLines.length > MAX_XFAIL) out.push(`  … +${xfailLines.length - MAX_XFAIL} more`);
  }

  if (failures.length) {
    out.push("", "Failures:");
    const shown = failures.slice(0, MAX_PYTEST_FAILURES);
    for (let i = 0; i < shown.length; i++) {
      const lines = shown[i].split("\n");
      const first = lines[0];
      if (first.startsWith("___")) {
        const name = first.replace(/^_+|_+$/g, "").trim();
        out.push(`${i + 1}. [FAIL] ${name}`);
      } else if (first.startsWith("FAILED")) {
        const parts = first.split(" - ");
        const name = parts[0].slice("FAILED".length).trim();
        out.push(`${i + 1}. [FAIL] ${name}`);
        // 失敗理由は全文保持（可読性優先。rtk 0.50.0 は最初の " - " segment で切るが、本実装は情報を残す）。
        // 末尾セパレータは continue で入れない（rtk 0.50.0 と同じ）。
        if (parts.length > 1) out.push("     " + truncate(parts.slice(1).join(" - "), 100));
        continue;
      } else {
        out.push(`${i + 1}. [FAIL] ${first}`);
      }
      let rel = 0;
      for (const body of lines.slice(1)) {
        const bt = body.trim();
        const isRel =
          bt.startsWith(">") ||
          bt.startsWith("E") ||
          bt.toLowerCase().includes("assert") ||
          bt.toLowerCase().includes("error") ||
          body.includes(".py:");
        if (isRel) {
          out.push("     " + truncate(body, 100));
          rel++;
          if (rel >= PYTEST_RELEVANT_PER_FAIL) break;
        }
      }
      // rtk 0.50.0 互換: セパレータ判定は表示数(shown)でなく全失敗数(failures)基準（cap 超過時の空行数まで一致）。
      if (i < failures.length - 1) out.push("");
    }
    if (failures.length > MAX_PYTEST_FAILURES) out.push("", `… +${failures.length - MAX_PYTEST_FAILURES} more failures`);
  }
  return out.join("\n").trim();
}

function parsePytestCounts(summary: string): [number, number, number, number, number, number] {
  let p = 0,
    f = 0,
    s = 0,
    xf = 0,
    xp = 0,
    e = 0;
  for (const part of summary.split(",")) {
    const words = part.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      if (i === 0) continue;
      const n = parseInt(words[i - 1], 10);
      if (Number.isNaN(n)) continue;
      const w = words[i];
      // "error"/"errors" は passed/failed/skipped/xfailed/xpassed のいずれの部分文字列でもないので順不同で安全。
      if (w.includes("xpassed")) xp = n;
      else if (w.includes("xfailed")) xf = n;
      else if (w.includes("passed")) p = n;
      else if (w.includes("failed")) f = n;
      else if (w.includes("skipped")) s = n;
      else if (w.includes("error")) e = n;
    }
  }
  return [p, f, s, xf, xp, e];
}

// ---------------------------------------------------------------- grep

const GREP_LINE = /^(.*?):(\d+):(.*)$/;
const GREP_CONTEXT_TAIL = /^(\d+)-(.*)$/;

function compactPath(p: string): string {
  if (p.length <= COMPACT_PATH_THRESH) return p;
  const parts = p.split("/");
  if (parts.length <= 3) return p;
  return `${parts[0]}/.../${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

/** rtk search.rs の clean_line と同じ: 長い行はパターンの周りを残し、無ければ先頭を残す。 */
function cleanGrepLine(line: string, maxLen: number, pattern: string): string {
  const trimmed = line.trim();
  if (Buffer.byteLength(trimmed, "utf8") <= maxLen) return trimmed;
  const chars = Array.from(trimmed);
  const lower = trimmed.toLowerCase();
  const pos = pattern ? lower.indexOf(pattern.toLowerCase()) : -1;
  if (pos < 0) return chars.slice(0, maxLen - 3).join("") + "...";
  const charPos = Array.from(lower.slice(0, pos)).length;
  const charLen = chars.length;
  let start = Math.max(0, charPos - Math.floor(maxLen / 3));
  const end = Math.min(start + maxLen, charLen);
  if (end === charLen) start = Math.max(0, end - maxLen);
  const slice = chars.slice(start, end).join("");
  if (start > 0 && end < charLen) return `...${slice}...`;
  if (start > 0) return `...${slice}`;
  return `${slice}...`;
}

type GrepEntry = [number, boolean, string];

/** `file:N:content`（一致）と、既知ファイルの `file-N-content`（文脈）を読む。 */
function parseGrepLine(line: string, knownFiles: string[]): [string, number, boolean, string] | null {
  for (const f of knownFiles) {
    if (!line.startsWith(f + "-")) continue;
    const m = GREP_CONTEXT_TAIL.exec(line.slice(f.length + 1));
    if (m) return [f, parseInt(m[1], 10), false, m[2]];
  }
  const m = GREP_LINE.exec(line);
  if (!m || !m[1]) return null;
  return [m[1], parseInt(m[2], 10), true, m[3]];
}

/**
 * rtk 0.50.0 の grep: 上限（全体 200 行・ファイルあたり 25 行）に届かなければ出力をそのまま返す。
 * 上限を超えた時だけファイルごとにまとめ、それが元より短い時に限りまとめた形を返す。
 * 読めるのはファイル名と行番号の付いた出力だけで、それ以外は null（→ 汎用削減）。
 */
export function reduceGrep(output: string, pattern = ""): string | null {
  const lines = output.split("\n");
  const candidates = new Set<string>();
  for (const line of lines) {
    const m = GREP_LINE.exec(line);
    if (m && m[1]) candidates.add(m[1]);
  }
  if (!candidates.size) return null;
  // 長いファイル名から照合し、`a-1-x` を `a` の文脈行として先に拾う
  const knownFiles = [...candidates].sort((a, b) => b.length - a.length);

  const byFile = new Map<string, GrepEntry[]>();
  let total = 0;
  let hasContext = false;
  for (const line of lines) {
    if (line === "--") {
      hasContext = true;
      continue;
    }
    const parsed = parseGrepLine(line, knownFiles);
    if (!parsed) continue;
    const [fname, lineno, isMatch, content] = parsed;
    if (isMatch) total++;
    else hasContext = true;
    if (!byFile.has(fname)) byFile.set(fname, []);
    byFile.get(fname)!.push([lineno, isMatch, cleanGrepLine(content, GREP_MAX_LEN, pattern)]);
  }
  if (total === 0) return null;
  const plain = output.replace(/\n+$/, "");

  const body: string[] = [];
  let shown = 0;
  let skippedFiles = 0;
  for (const fname of [...byFile.keys()].sort()) {
    const entries = byFile.get(fname)!;
    if (shown >= CAP_GREP_TOTAL) {
      skippedFiles++;
      continue;
    }
    const disp = compactPath(fname);
    let fileShown = 0;
    let prev = 0;
    for (const [lineno, isMatch, content] of entries.slice(0, CAP_GREP_PER_FILE)) {
      if (shown >= CAP_GREP_TOTAL) break;
      if (hasContext && prev > 0 && lineno > prev + 1) body.push("--");
      prev = lineno;
      const sep = isMatch ? ":" : "-";
      body.push(`${disp}${sep}${lineno}${sep}${content}`);
      shown++;
      fileShown++;
    }
    const remaining = entries.length - fileShown;
    if (remaining > 0) body.push(`  +${remaining} more in ${disp}`);
  }
  if (skippedFiles > 0) body.push(`+${skippedFiles} more files`);

  // rtk と同じく、表示数（文脈行を含む）と一致数を比べて上限で削ったかを決める
  const capped = shown < total || skippedFiles > 0;
  if (!capped) return plain;
  const grouped = `${total} matches in ${byFile.size} files:\n\n${body.join("\n")}`;
  return Buffer.byteLength(grouped, "utf8") < Buffer.byteLength(plain, "utf8") ? grouped : plain;
}

// ---------------------------------------------------------------- git status / log

const GIT_HINT = /^\(use "git |^\(create\/copy files/;

export function reduceGitStatus(output: string): string | null {
  const lines = output.split("\n");
  const nonempty = lines.filter((ln) => ln.trim());
  if (!nonempty.length) return null;
  const porc = nonempty.filter((ln) => /^(##|[ MADRCU?!]{2}) /.test(ln));
  if (porc.length && porc.length >= nonempty.length - 1) {
    const out: string[] = [];
    for (let i = 0; i < nonempty.length; i++) {
      const ln = nonempty[i];
      if (i === 0 && ln.startsWith("## ")) out.push("* " + ln.slice(3));
      else out.push(ln);
    }
    return out.join("\n");
  }
  const kept: string[] = [];
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) continue;
    if (GIT_HINT.test(t) || t.includes('(use "git add') || t.includes('(use "git restore')) continue;
    if (t.includes("nothing to commit") && t.includes("working tree clean")) {
      kept.push(t);
      break;
    }
    kept.push(ln);
  }
  return kept.length ? kept.join("\n") : "ok";
}

/**
 * git log の引数から、利用者が件数（-n N / -N / --max-count）や範囲（A..B）を決めたかを読む。
 * rtk は件数を決めたlogを打ち切らず幅を 120 にする。0.50.0 は範囲も利用者の決めた境界として打ち切らない。
 */
function gitLogBounds(args: string[]): { userLimit: boolean; range: boolean } {
  let userLimit = false;
  let range = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") break;
    if (/^-\d+$/.test(a) || /^-n\d+$/.test(a) || /^--max-count=\d+$/.test(a)) userLimit = true;
    else if ((a === "-n" || a === "--max-count") && /^\d+$/.test(args[i + 1] ?? "")) {
      userLimit = true;
      i++;
    } else if (!a.startsWith("-") && a.includes("..")) range = true;
  }
  return { userLimit, range };
}

export function reduceGitLog(output: string, args: string[] = []): string | null {
  if (!output.includes("commit ")) return null;
  const blocks = output.split(/(?=^commit [0-9a-f]{7,40})/m).filter((b) => b.trim().startsWith("commit "));
  if (!blocks.length) return null;
  const { userLimit, range } = gitLogBounds(args);
  const width = userLimit ? LOG_WIDTH_USER_LIMIT : LOG_WIDTH;
  // 件数も範囲も決めていない時だけ既定の 10 件に絞り、絞ったことを書く（黙って捨てない）
  const limit = userLimit || range ? blocks.length : LOG_LIMIT_DEFAULT;
  const out: string[] = [];
  for (const b of blocks.slice(0, limit)) {
    const bl = b.split("\n").map((x) => x.replace(/\s+$/, ""));
    let commit = "",
      author = "",
      subject = "";
    const body: string[] = [];
    for (const ln of bl) {
      const t = ln.trim();
      if (t.startsWith("commit ")) commit = t.split(/\s+/)[1].slice(0, 9);
      else if (t.startsWith("Author:")) author = t.slice("Author:".length).trim();
      else if (t.startsWith("Date:") || t.startsWith("Merge:")) continue;
      else if (t && !subject && (ln.startsWith("    ") || ln.startsWith("\t"))) subject = t;
      else if (t && (ln.startsWith("    ") || ln.startsWith("\t"))) {
        // trailer は大小文字が実装依存（本リポ規約は Co-Authored-By:）。大小無視で除外する（C5）。
        if (!/^(signed-off-by|co-authored-by):/i.test(t)) body.push(t);
      }
    }
    const am = /<([^>]+)>/.exec(author);
    const who = am ? am[1] : author;
    let head = truncate(`${commit} ${subject}`.trim(), width);
    if (who) head += `  <${who}>`;
    const entry = [head];
    for (const bln of body.slice(0, LOG_BODY_LINES)) entry.push("  " + truncate(bln, width));
    if (body.length > LOG_BODY_LINES) entry.push(`  [+${body.length - LOG_BODY_LINES} lines omitted]`);
    out.push(entry.join("\n"));
  }
  if (blocks.length > limit) out.push(`[+${blocks.length - limit} more commits]`);
  return out.join("\n").trim();
}

// ---------------------------------------------------------------- 汎用ライン整形 engine（自作フィルタ）

interface FilterRule {
  name: string;
  match: RegExp;
  strip?: RegExp[];
  keep?: RegExp[];
  maxLines?: number;
  onEmpty?: string;
}

const FILTERS: FilterRule[] = [
  { name: "df", match: /^df\b/, strip: [/^$/], maxLines: 40, onEmpty: "df: ok" },
  { name: "free", match: /^free\b/, strip: [/^$/], maxLines: 20, onEmpty: "free: ok" },
  { name: "make", match: /^make\b/, strip: [/^make\[\d+\]:/, /^$/, /^Nothing to be done/], maxLines: 50, onEmpty: "make: ok" },
  { name: "systemctl", match: /^systemctl\s+status\b/, strip: [/^\s*$/], maxLines: 30, onEmpty: "systemctl: ok" },
];

function applyFilter(rule: FilterRule, output: string): string {
  const lines = output.split("\n");
  const kept: string[] = [];
  for (const ln of lines) {
    if (rule.strip && rule.strip.some((r) => r.test(ln))) continue;
    if (rule.keep && rule.keep.length && !rule.keep.some((r) => r.test(ln))) continue;
    kept.push(ln);
  }
  let result = kept;
  if (rule.maxLines && kept.length > rule.maxLines) {
    const omitted = kept.length - rule.maxLines;
    result = [...kept.slice(0, rule.maxLines), `... (${omitted} lines truncated)`];
  }
  const body = result.join("\n").trim();
  if (!body && rule.onEmpty) return rule.onEmpty;
  return body;
}

// ---------------------------------------------------------------- ルーティング

const WRAPPERS = new Set(["sudo", "env", "command", "exec"]);
const RUNNERS = new Set(["uv", "poetry", "pdm", "rye", "hatch", "pipenv"]);

// [verb, sub, stripped]。stripped は前置(ラッパー/環境代入/フラグ/ランナー run)を除いた実コマンド。
// 誤分類は classify で null→generic に落ちるだけなので、読み飛ばしは積極的で安全（C4）。
function basenameCmd(command: string): [string, string, string] {
  const toks = command.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  // 前置ラッパー(sudo/env/…)・環境代入(FOO=1)・そのフラグ(-E/-i 等)を読み飛ばす
  while (i < toks.length && (toks[i].includes("=") || WRAPPERS.has(toks[i]) || toks[i].startsWith("-"))) i++;
  // ランナー( uv/poetry run <cmd> )は run と共に読み飛ばして実コマンドへ
  if (i + 1 < toks.length && RUNNERS.has(toks[i]) && toks[i + 1] === "run") {
    i += 2;
    while (i < toks.length && (toks[i].includes("=") || toks[i].startsWith("-"))) i++;
  }
  const stripped = toks.slice(i).join(" ");
  if (i >= toks.length) return ["", "", ""];
  const verb = toks[i].split("/").pop()!;
  let sub = "";
  for (const t of toks.slice(i + 1)) {
    if (!t.startsWith("-")) {
      sub = t;
      break;
    }
  }
  return [verb, sub, stripped];
}

export function classify(command: string): string | null {
  const [verb, sub, stripped] = basenameCmd(command);
  if (verb === "git") {
    if (sub === "status") return "git-status";
    if (sub === "log") return "git-log";
    return null;
  }
  if (verb === "grep" || verb === "rg") return "grep";
  if (verb === "pytest" || verb === "py.test") return "pytest";
  // python3 / python3.11 等のバージョン付きも許容（C4: `python3 -m pytest` を拾う）
  if (/^python[0-9.]*$/.test(verb) && command.includes("pytest")) return "pytest";
  // FILTERS は basename 経由の stripped で判定（C6: `sudo df` `sudo make` も分類できる）
  for (const rule of FILTERS) if (rule.match.test(stripped)) return rule.name;
  return null;
}

/** 引用符（'…' "…"）と \\ を解いた語の列。読み取り専用の解析なので、展開や置換はしない。 */
function shellWords(command: string): string[] {
  const words: string[] = [];
  let cur = "";
  let has = false;
  let quote = "";
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && i + 1 < command.length) cur += command[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === "\\" && i + 1 < command.length) {
      cur += command[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has) words.push(cur);
      cur = "";
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) words.push(cur);
  return words;
}

/** verb（git/grep 等）より後ろの語。前置ラッパーは basenameCmd と同じく読み飛ばす。 */
function argsAfterVerb(command: string): string[] {
  const [verb, , stripped] = basenameCmd(command);
  if (!verb) return [];
  const words = shellWords(stripped);
  return words.slice(1);
}

// 値を取る grep / rg のフラグ（別の語で値を渡す形）。パターンを値と取り違えないために使う。
const GREP_VALUE_SHORT = new Set(["e", "f", "m", "A", "B", "C", "d", "D"]);
const RG_VALUE_SHORT = new Set(["e", "f", "m", "A", "B", "C", "d", "g", "t", "T", "M", "j", "E", "r"]);
const GREP_VALUE_LONG = new Set([
  "regexp", "file", "max-count", "after-context", "before-context", "context", "devices", "directories",
  "include", "exclude", "exclude-dir", "exclude-from", "label", "glob", "iglob", "type", "type-not",
  "max-columns", "threads", "max-depth", "color", "colors", "sort", "sortr", "encoding", "pre", "replace",
]);

/** grep / rg の検索パターン（-e が複数なら `|` で結ぶ。rtk の pattern_display と同じ）。 */
export function grepPattern(command: string): string {
  const args = argsAfterVerb(command);
  const valueShort = basenameCmd(command)[0] === "rg" ? RG_VALUE_SHORT : GREP_VALUE_SHORT;
  const explicit: string[] = [];
  const positional: string[] = [];
  let endOfFlags = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (endOfFlags || !a.startsWith("-") || a === "-") {
      positional.push(a);
      continue;
    }
    if (a === "--") {
      endOfFlags = true;
      continue;
    }
    if (a.startsWith("--")) {
      const [name, attached] = a.slice(2).split(/=(.*)/s);
      const value = attached !== undefined ? attached : GREP_VALUE_LONG.has(name) ? args[++i] : undefined;
      if (name === "regexp" && value !== undefined) explicit.push(value);
      continue;
    }
    const cluster = a.slice(1);
    for (let j = 0; j < cluster.length; j++) {
      if (!valueShort.has(cluster[j])) continue;
      const rest = cluster.slice(j + 1);
      const value = rest || args[++i];
      if (cluster[j] === "e" && value !== undefined) explicit.push(value);
      break;
    }
  }
  if (explicit.length) return explicit.join("|");
  return positional[0] ?? "";
}

/** `git [opts] log <args>` の log より後ろの語。 */
function gitLogArgs(command: string): string[] {
  const args = argsAfterVerb(command);
  const i = args.indexOf("log");
  return i >= 0 ? args.slice(i + 1) : [];
}

const REDUCERS: Record<string, (o: string, command: string) => string | null> = {
  "git-status": (o) => reduceGitStatus(o),
  "git-log": (o, c) => reduceGitLog(o, gitLogArgs(c)),
  grep: (o, c) => reduceGrep(o, grepPattern(c)),
  pytest: (o) => reducePytest(o),
};

/** rtk の estimate_tokens と同じ（UTF-8 バイト数 / 4 の切り上げ）。 */
function estimateTokens(s: string): number {
  return Math.ceil(Buffer.byteLength(s, "utf8") / 4);
}

/**
 * コマンドに応じた reducer を観測出力へ適用。返り値 [reducedText|null, reducerName|null]。
 * 前提(C13): `output` は制御文字除去済み（ANSI/CR 等）であること。色付き/生 PTY 出力を直接渡すと
 * 誤パースし得る。呼び手 core.readOutput は `stripShellFrame(stripControl(text), cmd)` で前処理してから渡す。
 */
export function reduce(command: string, output: string): [string | null, string | null] {
  const name = classify(command);
  if (name === null) return [null, null];
  let red: string | null = null;
  if (name in REDUCERS) red = REDUCERS[name](output, command);
  else {
    const rule = FILTERS.find((r) => r.name === name);
    if (rule) red = applyFilter(rule, output);
  }
  if (red === null) return [null, null];
  // rtk の never_worse: 縮めた結果の方がトークンを使うなら適用しない（→ 呼び手の汎用削減へ）
  if (estimateTokens(red) > estimateTokens(output)) return [null, null];
  return [red, name];
}
