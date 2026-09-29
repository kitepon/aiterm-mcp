#!/usr/bin/env node
// Cursorが起動する公式hook。MCP stdioとは別processで、差し込み文をstdoutのJSONへ返す。本体はaiterm-steer-delivery。
import { isDirectExecution, runCursorHookMain } from "aiterm-steer-delivery";
import { AITERM_PROFILE } from "./steer-profile.js";
import { cursorHookRoots } from "./cursor-parent-receiver.js";

// Cursor CLIではMCPとhookの環境が違い、state rootが割れる。候補の置き場すべてで結び付けと差し込みを行う。
if (isDirectExecution(import.meta.url)) await runCursorHookMain(AITERM_PROFILE, cursorHookRoots());
