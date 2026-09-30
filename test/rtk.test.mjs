// rtk reducer の回帰テスト（モデル非依存の核）。
// - pytest: 実機 rtk 0.50.0 から採取した golden(recall 行除去) と一致を固定。
//   例外: proj_ra(FAILED 要約行) は理由を全文保持する自前挙動を期待値にしている(可読性優先・rtk とは意図的に相違)。
// - grep: 実機 rtk 0.50.0 の `rtk grep` と一致を固定（fixtures/grep）。上限に届かない small は、
//   rtk が内部で足す -I で grep 自身の並びが変わるため、利用者が打った grep の出力そのものを期待値にする。
// - git/filters: Python プロトタイプ(=同一アルゴリズム)で生成した期待値を固定。
// - classify ルーティング / truncate コードポイント境界 / reduce フォールバックを検証。
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as rtk from "../dist/rtk.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures");
const rstrip = (s) => s.replace(/\s+$/, "");

// ---------------------------------------------------------------- pytest（rtk 0.50.0 と byte 一致）
// rtk は縮めた方が長ければ元の出力を返す（never_worse）。reduce が null の時は呼び手が元の出力を見せる。
const trim = (s) => s.replace(/^\s+|\s+$/g, "");
const PYTEST_CASES = ["proj", "proj_ra", "allpass", "notests", "onlyskip", "cap"];
for (const c of PYTEST_CASES) {
  test(`reduce pytest byte-exact vs rtk 0.50.0: ${c}`, () => {
    const input = fs.readFileSync(path.join(FIX, "pytest", `${c}.input.txt`), "utf8");
    const expected = fs.readFileSync(path.join(FIX, "pytest", `${c}.expected.txt`), "utf8");
    const [got] = rtk.reduce("pytest", input);
    assert.equal(trim(got ?? input), trim(expected));
  });
}

test("reducePytest: 見出しの下に罫線を置かない（rtk 0.50.0）", () => {
  const input = fs.readFileSync(path.join(FIX, "pytest", "proj.input.txt"), "utf8");
  assert.doesNotMatch(rtk.reducePytest(input), /═/);
});

test("reducePytest: 報告前に落ちた実行を 'No tests collected' にしない", () => {
  const internal = [
    "INTERNALERROR> Traceback (most recent call last):",
    'INTERNALERROR>   File "/usr/lib/python3/dist-packages/_pytest/main.py", line 270, in wrap_session',
    "INTERNALERROR> RuntimeError: boom",
    "",
    "no tests ran in 0.05s",
  ].join("\n");
  assert.equal(rtk.reducePytest(internal), null);
  const usage = "ERROR: usage: pytest [options] [file_or_dir] [file_or_dir] [...]\nno tests ran in 0.01s";
  assert.equal(rtk.reducePytest(usage), null);
});

test("reducePytest: pytest 証拠ゼロは null（虚偽の 'No tests collected' を作らない）", () => {
  assert.equal(rtk.reducePytest("1 file skipped\n"), null);
  assert.equal(rtk.reducePytest(""), null);
});

test("reducePytest: 全パスは 'Pytest: N passed' のみ", () => {
  assert.equal(rtk.reducePytest("... [100%]\n=== 5 passed in 0.10s ==="), "Pytest: 5 passed");
});

test("reduce: pytest 名を含む非 pytest 出力は generic フォールバックへ戻す", () => {
  assert.deepEqual(rtk.reduce("python run_not_pytest.py", "Processing 500 records...\ndone: 500 ok"), [null, null]);
});

test("reduce: quiet pytest 出力は引き続き pytest reducer を適用する", () => {
  const input = fs.readFileSync(path.join(FIX, "pytest", "allpass.input.txt"), "utf8");
  const expected = fs.readFileSync(path.join(FIX, "pytest", "allpass.expected.txt"), "utf8");
  const [got, name] = rtk.reduce("python -m pytest -q", input);
  assert.equal(name, "pytest");
  assert.equal(rstrip(got), rstrip(expected));
});

// 収集エラー（import 失敗等）を無害/緑に偽装しないこと（rtk 0.50.0 とは意図的に相違＝失敗マスキング禁止）。
// C1 修正前は "No tests collected" / "Pytest: 1 passed" に潰れ、AI が赤を無害/緑と誤読していた。
const COLLECT_ERROR_ONLY = [
  "============================= test session starts ==============================",
  "collected 0 items / 1 error",
  "",
  "==================================== ERRORS ====================================",
  "_______________ ERROR collecting test_broken.py ________________________________",
  "ImportError while importing test module '/proj/test_broken.py'.",
  "test_broken.py:3: in <module>",
  "    import nonexistent_module",
  "E   ModuleNotFoundError: No module named 'nonexistent_module'",
  "=========================== short test summary info ============================",
  "ERROR test_broken.py",
  "!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!!",
  "=============================== 1 error in 0.12s ===============================",
].join("\n");

const PASS_PLUS_ERROR = [
  "============================= test session starts ==============================",
  "collected 2 items / 1 error",
  "",
  "test_ok.py .                                                             [ 50%]",
  "",
  "==================================== ERRORS ====================================",
  "_______________ ERROR collecting test_broken.py ________________________________",
  "E   ModuleNotFoundError: No module named 'nonexistent_module'",
  "=========================== short test summary info ============================",
  "ERROR test_broken.py",
  "============================== 1 passed, 1 error in 0.34s ======================",
].join("\n");

test("reducePytest: 収集エラーのみを 'No tests collected' に潰さず error を表面化", () => {
  const got = rtk.reducePytest(COLLECT_ERROR_ONLY);
  assert.doesNotMatch(got, /No tests collected/, "収集エラーが無害誤読される");
  assert.match(got, /1 error/, "error 件数が表示されない");
  assert.match(got, /ERROR test_broken\.py/, "どのモジュールが error か表示されない");
});

test("reducePytest: passed と error 併存で緑偽装しない（'1 passed' に潰さない）", () => {
  const got = rtk.reducePytest(PASS_PLUS_ERROR);
  assert.match(got, /1 passed/, "passed 件数は保持");
  assert.match(got, /1 error/, "error が握り潰され緑偽装される");
  assert.match(got, /ERROR test_broken\.py/, "error モジュールが表示されない");
});

// ---------------------------------------------------------------- grep（rtk 0.50.0 と byte 一致）
const GREP_CASES = {
  small: "grep -rn foo small",
  perfile: "grep -rn needle perfile",
  total: "grep -rn hit total",
  context: "grep -rn -C1 MARK context",
  ja: "grep -rn 目印 ja",
};
for (const [c, cmd] of Object.entries(GREP_CASES)) {
  test(`reduce grep byte-exact vs rtk 0.50.0: ${c}`, () => {
    const input = fs.readFileSync(path.join(FIX, "grep", `${c}.input.txt`), "utf8");
    const expected = fs.readFileSync(path.join(FIX, "grep", `${c}.expected.txt`), "utf8");
    const [got, name] = rtk.reduce(cmd, input);
    assert.equal(name, "grep");
    assert.equal(rstrip(got), rstrip(expected));
  });
}

test("reduceGrep: 上限に届かなければ出力をそのまま返す（行を切らず見出しも付けない）", () => {
  const long = "x".repeat(300);
  const input = `b.py:5:foo = 1\na.py:1:${long}\n`;
  assert.equal(rtk.reduceGrep(input, "foo"), input.trimEnd());
});

test("reduceGrep: まとめた形が元より長ければ元の出力を返す", () => {
  // 26 行の短い一致。1 ファイル 25 行を超えるが、見出しと "+1 more" を足すと元より長くなる。
  const input = Array.from({ length: 26 }, (_, i) => `f:${i + 1}:a`).join("\n");
  assert.equal(rtk.reduceGrep(input, "a"), input);
});

test("grepPattern: フラグの値を検索語と取り違えない", () => {
  assert.equal(rtk.grepPattern("grep -rn foo src/"), "foo");
  assert.equal(rtk.grepPattern('grep -rn "foo bar" .'), "foo bar");
  assert.equal(rtk.grepPattern("grep -A 3 -rn x ."), "x");
  assert.equal(rtk.grepPattern("grep -rnA3 pat ."), "pat");
  assert.equal(rtk.grepPattern('grep --include "*.ts" -rn TODO .'), "TODO");
  assert.equal(rtk.grepPattern("grep -T -rn tab ."), "tab"); // grep の -T は値を取らない
  assert.equal(rtk.grepPattern("rg -t ts useState src"), "useState"); // rg の -t は値を取る
  assert.equal(rtk.grepPattern("rg -e a -e b"), "a|b");
  assert.equal(rtk.grepPattern("sudo grep -rn -- -x ."), "-x");
});

// ---------------------------------------------------------------- git log（件数と範囲）
const gitLog = (n) =>
  Array.from({ length: n }, (_, i) => {
    const sha = String(i).padStart(2, "0").repeat(20);
    return `commit ${sha}\nAuthor: A <a@example.com>\nDate:   Mon Jun 1 10:00:00 2026 +0900\n\n    subject ${i}\n`;
  }).join("\n");

test("reduceGitLog: 件数も範囲も無ければ 10 件に絞り、絞ったことを書く", () => {
  const [got] = rtk.reduce("git log", gitLog(12));
  assert.equal(got.split("\n").filter((l) => /subject/.test(l)).length, 10);
  assert.match(got, /\[\+2 more commits\]$/);
});

test("reduceGitLog: 利用者が件数や範囲を決めたら打ち切らない", () => {
  for (const cmd of ["git log -n 12", "git log -12", "git log --max-count=12", "git log HEAD~12..HEAD"]) {
    const [got] = rtk.reduce(cmd, gitLog(12));
    assert.equal(got.split("\n").filter((l) => /subject/.test(l)).length, 12, cmd);
    assert.doesNotMatch(got, /more commits/, cmd);
  }
});

test("reduceGitLog: 件数を決めた時は幅を 120 にする（rtk と同じ）", () => {
  const subject = "s".repeat(110);
  const input = `commit ${"a".repeat(40)}\nAuthor: A <a@example.com>\n\n    ${subject}\n`;
  assert.match(rtk.reduce("git log", input)[0], /\.\.\./);
  assert.doesNotMatch(rtk.reduce("git log -n 1", input)[0], /\.\.\./);
});

test("reduce: 縮めた結果が元より長ければ適用しない（never_worse）", () => {
  assert.deepEqual(rtk.reduce("pytest", "\nno tests ran in 0.00s\n"), [null, null]);
});

// ---------------------------------------------------------------- git/filters（期待値を凍結）
const reducers = JSON.parse(fs.readFileSync(path.join(FIX, "reducers.json"), "utf8"));
for (const e of reducers) {
  test(`reduce[${e.reducer ?? "fallback"}]: ${e.name}`, () => {
    const [reduced, rname] = rtk.reduce(e.cmd, e.input);
    assert.equal(rname, e.reducer, `reducer name for ${e.name}`);
    assert.equal(reduced, e.expected, `reduced output for ${e.name}`);
  });
}

// reduceGrep 単体: 無一致は null（→ 呼び出し側で汎用削減フォールバック）
test("reduceGrep: file:line:content でなければ null", () => {
  assert.equal(rtk.reduceGrep("no colon format here\njust prose"), null);
});

// reduceGitStatus / reduceGitLog 単体: 非該当は null
test("reduceGitStatus: 空入力は null", () => {
  assert.equal(rtk.reduceGitStatus("   \n  \n"), null);
});
test("reduceGitLog: 'commit ' を含まなければ null", () => {
  assert.equal(rtk.reduceGitLog("not a git log"), null);
});

// ---------------------------------------------------------------- classify ルーティング
test("classify: 接頭辞/別名/非該当", () => {
  assert.equal(rtk.classify("git status"), "git-status");
  assert.equal(rtk.classify("git status -sb"), "git-status");
  assert.equal(rtk.classify("git log --oneline"), "git-log");
  assert.equal(rtk.classify("git diff"), null); // git だが status/log 以外
  assert.equal(rtk.classify("grep -rn foo ."), "grep");
  assert.equal(rtk.classify("rg pattern"), "grep");
  assert.equal(rtk.classify("pytest tests/"), "pytest");
  assert.equal(rtk.classify("py.test"), "pytest");
  assert.equal(rtk.classify("python -m pytest tests/"), "pytest");
  // 接頭辞 sudo / env / VAR= をスキップして verb を見る
  assert.equal(rtk.classify("sudo pytest tests/"), "pytest");
  assert.equal(rtk.classify("env FOO=1 grep -rn x ."), "grep");
  assert.equal(rtk.classify("FOO=1 BAR=2 git status"), "git-status");
  assert.equal(rtk.classify("command git log"), "git-log");
  // パス付き verb の basename を見る
  assert.equal(rtk.classify("/usr/bin/git status"), "git-status");
  // FILTERS
  assert.equal(rtk.classify("df -h"), "df");
  assert.equal(rtk.classify("free -h"), "free");
  assert.equal(rtk.classify("make all"), "make");
  assert.equal(rtk.classify("systemctl status nginx"), "systemctl");
  // C4: バージョン付き python / ランナー / 前置フラグを拾う
  assert.equal(rtk.classify("python3 -m pytest"), "pytest");
  assert.equal(rtk.classify("python3.11 -m pytest tests/"), "pytest");
  assert.equal(rtk.classify("uv run pytest"), "pytest");
  assert.equal(rtk.classify("poetry run pytest tests/"), "pytest");
  assert.equal(rtk.classify("sudo -E pytest"), "pytest"); // 前置フラグ -E を読み飛ばす
  // C6: FILTERS も basename 経由で前置ラッパーを吸収
  assert.equal(rtk.classify("sudo df -h"), "df");
  assert.equal(rtk.classify("sudo make all"), "make");
  // 非該当は null（→ generic フォールバック）
  assert.equal(rtk.classify("ls -la"), null);
  assert.equal(rtk.classify("echo hi"), null);
  assert.equal(rtk.classify(""), null);
});

test("reduce: 非該当コマンドは [null,null]（generic フォールバック）", () => {
  assert.deepEqual(rtk.reduce("ls -la", "some output"), [null, null]);
});

// ---------------------------------------------------------------- truncate コードポイント境界（reduceGrep 経由）
test("truncate: astral 文字をサロゲート境界で割らない", () => {
  // 85 コードポイントの絵文字。上限を超えてまとめる時、GREP_MAX_LEN=80 → 77 個 + '...'
  // （UTF-16 単位ではなくコードポイントで切る）。30 行にして 1 ファイル 25 行の上限を超えさせる。
  const emoji = "🎉".repeat(85);
  const out = rtk.reduceGrep(Array.from({ length: 30 }, (_, i) => `f:${i + 1}:${emoji}`).join("\n"));
  const lines = out.split("\n");
  const matchLine = lines.find((l) => l.startsWith("f:1:"));
  assert.ok(matchLine, "grep 行がある");
  const content = matchLine.slice("f:1:".length);
  assert.equal([...content].length, 80, "コードポイント長は 80（77 emoji + '...'）");
  assert.equal(content, "🎉".repeat(77) + "...");
  assert.ok(!content.includes("�"), "置換文字(割れたサロゲート)が無い");
});

test("truncate: 上限以下はそのまま", () => {
  const out = rtk.reduceGrep("f:2:short");
  assert.ok(out.includes("f:2:short"));
});

// ---------------------------------------------------------------- stripShellFrame
test("stripShellFrame: echo 行と前後プロンプトを落とし本体だけ残す", () => {
  const text = "$ git status\n M src/core.ts\n?? new.txt\nuser@host:~/p$ ";
  assert.equal(rtk.stripShellFrame(text, "git status"), " M src/core.ts\n?? new.txt");
});
test("stripShellFrame: コマンド空なら末尾プロンプト除去のみ", () => {
  assert.equal(rtk.stripShellFrame("line1\nline2\n$ ", ""), "line1\nline2");
});
test("stripShellFrame: 出力本体に cmd 文字列が再出現しても本体を捨てない（C2）", () => {
  // 最後の一致まで start を進めると "TODO..." 以前が丸ごと消える。最初の一致（エコー）だけ落とす。
  const text = "$ cat notes.txt\nTODO: run cat notes.txt later\ndone\nuser@host:~$ ";
  assert.equal(rtk.stripShellFrame(text, "cat notes.txt"), "TODO: run cat notes.txt later\ndone");
});
test("stripShellFrame: 末尾記号で終わる本文行(</div> >>>)を誤除去しない（C3）", () => {
  assert.equal(rtk.stripShellFrame("$ curl x\n<html>\n</div>", "curl x"), "<html>\n</div>");
  assert.equal(rtk.stripShellFrame("$ run repl\nresult\n>>>", "run repl"), "result\n>>>");
});
