import "../test/seat-env.mjs"; // 最初のimportに置く（ADR 0121）。gitを、動かした利用者の設定とhookで呼ばない。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyReleaseCommit } from "./verify-release-commit.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function createReleaseFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "aiterm-release-gate-"));
  const remote = path.join(root, "origin.git");
  const work = path.join(root, "work");
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(work);
  git(root, "init", "--bare", remote);
  git(work, "init", "--initial-branch=main");
  git(work, "config", "user.name", "aiterm release gate test");
  git(work, "config", "user.email", "aiterm-release-gate@example.invalid");
  await writeFile(path.join(work, ".gitignore"), "ignored.tmp\n", "utf8");
  await writeFile(path.join(work, "tracked.txt"), "tracked\n", "utf8");
  git(work, "add", ".gitignore", "tracked.txt");
  git(work, "commit", "-m", "fixture");
  git(work, "remote", "add", "origin", remote);
  git(work, "push", "--set-upstream", "origin", "main");
  return work;
}

test("release gate passes for a commit landed on main", async (t) => {
  const work = await createReleaseFixture(t);
  assert.match(verifyReleaseCommit({ projectDirectory: work }), /landed on origin\/main/);
});

test("release gate rejects an untracked publish payload", async (t) => {
  const work = await createReleaseFixture(t);
  await writeFile(path.join(work, "untracked.txt"), "must block publish\n", "utf8");
  assert.throws(() => verifyReleaseCommit({ projectDirectory: work }), /working treeに未commitの変更があります/);
});

test("release gate permits ignored generated output", async (t) => {
  const work = await createReleaseFixture(t);
  await writeFile(path.join(work, "ignored.tmp"), "generated\n", "utf8");
  assert.match(verifyReleaseCommit({ projectDirectory: work }), /landed on origin\/main/);
});
