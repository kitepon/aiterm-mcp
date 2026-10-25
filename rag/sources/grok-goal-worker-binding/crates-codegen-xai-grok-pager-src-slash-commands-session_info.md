---
title: "crates/codegen/xai-grok-pager/src/slash/commands/session_info.rs"
source_url: "https://raw.githubusercontent.com/xai-org/grok-build/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-pager/src/slash/commands/session_info.rs"
source_type: official_source
fetched: 2026-10-25
topic: grok-goal-worker-binding
tags: ["grok", "goal", "worker"]
summary: "Grok公式元workerとsessionへの接続・goal操作の責務を確認する。"
relevance: "新workerを起こさず既sessionへ接続するadapterの根拠を調べる。"
chars: 749
---

//! `/session-info`: show current session info (instant, not queued).

use crate::app::actions::Action;
use crate::slash::command::{CommandExecCtx, CommandResult, SlashCommand, slash_meta};

/// Show session info (session ID, cwd, model, context usage).
pub struct SessionInfoCommand;

impl SlashCommand for SessionInfoCommand {
    slash_meta! {
        name: "session-info",
        description: "Show session info",
        usage: "/session-info",
        session_scoped: true,
    }

    fn run(&self, ctx: &mut CommandExecCtx, _args: &str) -> CommandResult {
        if ctx.session_id.is_none() {
            return CommandResult::Error("No active session".to_string());
        }

        CommandResult::Action(Action::ShowSessionInfo)
    }
}
