#!/usr/bin/env node
// Codexが起動する同期hook（PostToolUse／Stop）。stdoutはCodexの公式hook出力だけに使う。本体はaiterm-steer-delivery。
import { runCodexHookMain } from "aiterm-steer-delivery";
import { AITERM_PROFILE } from "./steer-profile.js";
await runCodexHookMain(AITERM_PROFILE, process.argv[2]);
