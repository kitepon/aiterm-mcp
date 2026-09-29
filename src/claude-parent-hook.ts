#!/usr/bin/env node
// Claude Codeが直接起動する公式hook。MCP stdioとは別processで本文をstderrへ返す。本体はaiterm-steer-delivery。
import { runClaudeHookMain } from "aiterm-steer-delivery";
import { AITERM_PROFILE } from "./steer-profile.js";
await runClaudeHookMain(AITERM_PROFILE);
