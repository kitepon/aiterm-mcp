// readOutput のデータ経路（full / line_range / lines / offset / raw / rtk reducer）を tmux 非依存で検証。
// readOutput の読取経路は .log/.offset/.lastcmd を読むだけで tmux を呼ばないため、ファイルを捏造して決定的に試せる。
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as core from "../dist/core.js";

// core.ts と同じ解決順にする（Windows は TMPDIR→TEMP→os.tmpdir()）。
// ズレると捏造ログの置き場と core の読み先が食い違い、Windows でテストが落ちる。
const SOCKDIR = path.join(
  process.env.TMPDIR ?? (process.platform === "win32" ? process.env.TEMP ?? os.tmpdir() : "/tmp"),
  "claude-tmux-sockets",
);
const lp = (n) => path.join(SOCKDIR, n + ".log");
const op = (n) => path.join(SOCKDIR, n + ".offset");
const cp = (n) => path.join(SOCKDIR, n + ".lastcmd");
const made = new Set();
function fab(name, logText, offset = 0, lastcmd = null) {
  fs.mkdirSync(SOCKDIR, { recursive: true });
  fs.writeFileSync(lp(name), logText);
  fs.writeFileSync(op(name), String(offset));
  if (lastcmd !== null) fs.writeFileSync(cp(name), lastcmd);
  made.add(name);
}
afterEach(() => {
  for (const n of made) for (const p of [lp(n), op(n), cp(n)]) { try { fs.unlinkSync(p); } catch {} }
  made.clear();
});

const TEN = Array.from({ length: 10 }, (_, i) => `${i}`).join("\n") + "\n"; // "0\n..9\n"

test("readOutput full: 全文を返し offset を末尾へ進める", async () => {
  const n = "ro_full";
  fab(n, TEN, 0);
  const out = await core.readOutput(n, { full: true });
  const body = out.split("\n").slice(0, 10).join("\n");
  assert.equal(body, "0\n1\n2\n3\n4\n5\n6\n7\n8\n9");
  assert.equal(fs.readFileSync(op(n), "utf8"), String(Buffer.byteLength(TEN))); // 末尾へ
});

test("readOutput line_range: A:B は [A,B) スライス・offset 非前進・elide 無効", async () => {
  const n = "ro_range";
  fab(n, TEN, 0);
  const out = await core.readOutput(n, { range: [2, 5] });
  const body = out.split("\n").slice(0, 3).join("\n");
  assert.equal(body, "2\n3\n4");
  assert.equal(fs.readFileSync(op(n), "utf8"), "0"); // range は offset を進めない
});

test("readOutput line_range A: は A 以降すべて（上端 null）", async () => {
  const n = "ro_range_open";
  fab(n, TEN, 0);
  const out = await core.readOutput(n, { range: [7, null] });
  const body = out.split("\n").filter((l) => /^\d$/.test(l)).join("\n");
  assert.equal(body, "7\n8\n9");
});

test("readOutput lines=N: 増分の末尾 N 行（末尾改行なし）", async () => {
  const n = "ro_lines";
  fab(n, "L1\nL2\nL3\nL4\nL5", 0); // 末尾改行なし → 末尾空行が枠を食わない
  const out = await core.readOutput(n, { lines: 3 });
  const body = out.split("\n").filter((l) => /^L\d$/.test(l)).join("\n");
  assert.equal(body, "L3\nL4\nL5");
});

test("readOutput lines=N: 末尾改行ありは最終空行が1枠を消費（実ログ挙動）", async () => {
  const n = "ro_lines_nl";
  fab(n, TEN, 0); // "0\n..9\n" → split 末尾に "" → slice(-3)=["8","9",""] → collapseBlanks で "8\n9"
  const out = await core.readOutput(n, { lines: 3 });
  const body = out.split("\n").filter((l) => /^\d$/.test(l)).join("\n");
  assert.equal(body, "8\n9");
});

test("readOutput 増分: offset 以降のみ・読後は末尾へ前進", async () => {
  const n = "ro_incr";
  fab(n, TEN, 4); // "0\n1\n" = 4 bytes 既読
  const out1 = await core.readOutput(n, {});
  assert.ok(out1.startsWith("2\n3"), `増分は 2 から: ${JSON.stringify(out1.slice(0, 8))}`);
  const out2 = await core.readOutput(n, {}); // 二度読みで重複しない（増分は空、メタのみ）
  assert.ok(!/^[0-9]$/m.test(out2.replace(/\[aiterm[^\]]*\]/g, "")), "二度読みで数字行が再出現しない");
});

test("readOutput 増分: UTF-8 文字の途中 offset では継続バイトを捨て U+FFFD を出さない", async () => {
  const n = "ro_incr_utf8_midchar";
  const log = "A😀B\n";
  fab(n, log, 2); // 😀 の第2バイトから
  const out = await core.readOutput(n, {});
  assert.ok(out.startsWith("B"), `継続バイトを読み出さない: ${JSON.stringify(out.slice(0, 8))}`);
  assert.ok(!out.includes("\uFFFD"));
  assert.equal(fs.readFileSync(op(n), "utf8"), String(Buffer.byteLength(log)));
});

test("readOutput full: 8MB 切り詰めが UTF-8 文字の途中でも U+FFFD を出さない", async () => {
  const n = "ro_full_utf8_midchar";
  const maxFullBytes = 8 * 1024 * 1024;
  const log = Buffer.concat([Buffer.from("A😀"), Buffer.alloc(maxFullBytes - 3, "x")]); // 切断開始は 😀 の第2バイト
  fab(n, log, 0);
  const out = await core.readOutput(n, { full: true, raw: true });
  assert.match(out, /^\[… 先頭 2 バイトを省略/); // 既存のサイズ省略メタは raw でも付く
  assert.ok(out.includes("…]\nx"));
  assert.ok(!out.includes("\uFFFD"));
});

test("readOutput raw: 生テキスト・末尾改行付与・メタ無し", async () => {
  const n = "ro_raw";
  fab(n, "\x1b[31mred\x1b[0m\nplain", 0);
  const out = await core.readOutput(n, { full: true, raw: true });
  assert.equal(out, "\x1b[31mred\x1b[0m\nplain\n"); // 削減せず・末尾 \n 付与
  assert.ok(!out.includes("[aiterm"), "raw はメタを付けない");
});

test("readOutput rtk reducer: 直前コマンド別に縮約（git status 例）", async () => {
  const n = "ro_rtk";
  const log = "## main...origin/main\n M src/core.ts\n?? new.txt\n";
  fab(n, log, 0, "git status -sb");
  const out = await core.readOutput(n, { full: true, rtk: true });
  assert.ok(out.startsWith("* main...origin/main"), `git-status 縮約: ${JSON.stringify(out.slice(0, 40))}`);
  assert.ok(out.includes("rtk:git-status 適用"), "rtk reducer 名をメタに記す");
});

test("readOutput 増分: offset がログ長超過なら先頭から読み直す（WSL 再起動でログ再作成）", async () => {
  const n = "ro_overrun";
  fab(n, TEN, 9999); // 旧 offset がログ長(20B)を超過
  const out = await core.readOutput(n, {});
  const body = out.split("\n").filter((l) => /^\d$/.test(l)).join("\n");
  assert.equal(body, "0\n1\n2\n3\n4\n5\n6\n7\n8\n9"); // クランプで先頭から全文
  assert.equal(fs.readFileSync(op(n), "utf8"), String(Buffer.byteLength(TEN))); // 読後は真の末尾へ
});

test("readOutput full+lines: full でも末尾 N 行に絞る（従来は黙殺・B11）", async () => {
  const n = "ro_full_lines";
  const LINES = ["AAA0", "BBB1", "CCC2", "DDD3", "EEE4", "FFF5", "GGG6", "HHH7", "III8", "JJJ9"].join("\n");
  fab(n, LINES, 0);
  const out = await core.readOutput(n, { full: true, lines: 3 });
  assert.ok(out.includes("HHH7") && out.includes("III8") && out.includes("JJJ9"), `末尾3行: ${out}`);
  assert.ok(!out.includes("AAA0"), `full+lines が末尾に絞れていない（先頭を含む）: ${out}`);
});

test("readOutput: 存在しないセッション(ログ無し)はエラー", async () => {
  await assert.rejects(() => core.readOutput("no_such_session_xyz", {}), /無い/);
});

test("closeSession: ログ/offset/lastcmd を削除", () => {
  const n = "ro_close";
  fab(n, "x\n", 0, "git status");
  core.closeSession(n);
  assert.ok(!fs.existsSync(lp(n)));
  assert.ok(!fs.existsSync(op(n)));
  assert.ok(!fs.existsSync(cp(n)));
  made.delete(n);
});
