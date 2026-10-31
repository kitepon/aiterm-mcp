---
title: "Codex CLI reference: interactive resume and cwd"
source_url: "https://learn.chatgpt.com/docs/cli/reference.md"
source_type: docs
fetched: 2026-10-31
topic: completion-detection
tags: ["codex", "resume", "cli"]
summary: "公式Codex CLIのresumeとsession ID指定、model/sandbox上書きとcwd選択の契約。"
relevance: "同一会話のCLI再開で明示IDとcwdを使い、pickerや新規forkへ逃がさない根拠。"
chars: 54041
---

# Command line options

> For the complete documentation index, see [llms.txt](https://learn.chatgpt.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to the page URL.

export const globalFlagOptions = [
  {
    key: "PROMPT",
    type: "string",
    description:
      "Optional text instruction to start the session. Omit to launch the TUI without a pre-filled message.",
  },
  {
    key: "--image, -i",
    type: "path[,path...]",
    description:
      "Attach one or more image files to the initial prompt. Separate multiple paths with commas or repeat the flag.",
  },
  {
    key: "--model, -m",
    type: "string",
    description:
      "Override the model set in configuration (for example `gpt-6.1-sol`).",
  },
  {
    key: "--oss",
    type: "boolean",
    defaultValue: "false",
    description:
      "Use a local open source model provider. Codex uses `--local-provider`, your configured `oss_provider`, or prompts you to choose between LM Studio and Ollama.",
  },
  {
    key: "--local-provider",
    type: "lmstudio | ollama",
    description:
      "Choose the local provider used with `--oss`, overriding `oss_provider` for this run.",
  },
  {
    key: "--profile, -p",
    type: "string",
    description:
      "Layer `$CODEX_HOME/profile-name.config.toml` on top of the base user config.",
  },
  {
    key: "--sandbox, -s",
    type: "read-only | workspace-write | danger-full-access",
    description:
      "Select the sandbox policy for model-generated shell commands.",
  },
  {
    key: "--ask-for-approval, -a",
    type: "on-request | never",
    description:
      "Control when Codex pauses for human approval before running a command.",
  },
  {
    key: "--approve-for-me, --not-so-yolo",
    type: "boolean",
    defaultValue: "false",
    description:
      "Use automatic approval review with `on-request` approvals and the `workspace-write` sandbox. Conflicts with `--sandbox` and `--yolo`; the interactive CLI also rejects `--ask-for-approval`.",
  },
  {
    key: "--dangerously-bypass-approvals-and-sandbox, --yolo",
    type: "boolean",
    defaultValue: "false",
    description:
      "Run every command without approvals or sandboxing. Only use inside an externally hardened environment.",
  },
  {
    key: "--dangerously-bypass-hook-trust",
    type: "boolean",
    defaultValue: "false",
    description:
      "Run enabled hooks without requiring persisted hook trust for this invocation. Intended only for automation that already vets hook sources.",
  },
  {
    key: "--cd, -C",
    type: "path",
    description:
      "Set the working directory for the agent before it starts processing your request.",
  },
  {
    key: "--search",
    type: "boolean",
    defaultValue: "false",
    description:
      'Enable live web search (sets `web_search = "live"` instead of the default `"cached"`).',
  },
  {
    key: "--add-dir",
    type: "path",
    description:
      "Grant additional directories write access alongside the main workspace. Repeat for multiple paths.",
  },
  {
    key: "--no-alt-screen",
    type: "boolean",
    defaultValue: "false",
    description:
      "Disable alternate screen mode for the TUI (overrides `tui.alternate_screen` for this run).",
  },
  {
    key: "--no-daemon",
    type: "boolean",
    defaultValue: "false",
    description:
      "Run the interactive CLI without the shared background server. Can't be combined with `--remote` or `codex agents`.",
  },
  {
    key: "--worktree",
    type: "boolean",
    defaultValue: "false",
    description:
      "Start in a new managed Git worktree. Supports new interactive sessions, `codex fork <SESSION_ID>`, `codex exec`, and `codex exec fork`; requires local execution.",
  },
  {
    key: "--remote",
    type: "ws://host:port | wss://host:port | unix:// | unix://PATH",
    description:
      "Connect to a remote app-server endpoint over WebSocket or a Unix socket. Supported for `codex`, `codex agents`, `codex queue`, `codex resume`, `codex fork`, `codex archive`, `codex delete`, and `codex unarchive`; other subcommands reject remote mode.",
  },
  {
    key: "--remote-auth-token-env",
    type: "ENV_VAR",
    description:
      "Read a bearer token from this environment variable and send it when connecting with `--remote`. Requires `--remote`; tokens are only sent over `wss://` URLs or local-only `ws://` URLs.",
  },
  {
    key: "--strict-config",
    type: "boolean",
    defaultValue: "false",
    description:
      "Error when `config.toml` contains fields this Codex version does not recognize. Supported by runtime commands such as `codex`, `exec`, `review`, `resume`, `fork`, `app-server`, and `exec-server`.",
  },
  {
    key: "--enable",
    type: "feature",
    description:
      "Force-enable a feature flag (translates to `-c features.<name>=true`). Repeatable.",
  },
  {
    key: "--disable",
    type: "feature",
    description:
      "Force-disable a feature flag (translates to `-c features.<name>=false`). Repeatable.",
  },
  {
    key: "--config, -c",
    type: "key=value",
    description:
      "Override configuration values. Values parse as TOML if possible; otherwise the literal string is used.",
  },
];

export const commandOverview = [
  {
    key: "codex",
    href: "/codex/developer-commands?surface=cli#cli-codex-interactive",
    type: "stable",
    description:
      "Launch the terminal UI. Accepts the global flags above plus an optional prompt or image attachments.",
  },
  {
    key: "codex agents",
    href: "/codex/developer-commands?surface=cli#cli-codex-agents",
    type: "stable",
    description:
      "Open the agent command center on a shared local or remote server.",
  },
  {
    key: "codex queue",
    href: "/codex/developer-commands?surface=cli#cli-codex-queue",
    type: "stable",
    description:
      "Queue a text message for an existing session by UUID or exact name.",
  },
  {
    key: "codex app-server",
    href: "/codex/developer-commands?surface=cli#cli-codex-app-server",
    type: "experimental",
    description:
      "Launch the Codex app server for local development or debugging over stdio, WebSocket, or a Unix socket.",
  },
  {
    key: "codex remote-control",
    href: "/codex/developer-commands?surface=cli#cli-codex-remote-control",
    type: "experimental",
    description:
      "Run or manage remote control for the local app-server, or create a short-lived pairing code.",
  },
  {
    key: "codex app",
    href: "/codex/developer-commands?surface=cli#cli-codex-app",
    type: "stable",
    description:
      "Launch the ChatGPT desktop app on macOS or Windows. On macOS, Codex can open a workspace path; on Windows, Codex prints the path to open.",
  },
  {
    key: "codex debug app-server send-message-v2",
    href: "/codex/developer-commands?surface=cli#cli-codex-debug-app-server-send-message-v2",
    type: "experimental",
    description:
      "Debug app-server by sending a single V2 message through the built-in test client.",
  },
  {
    key: "codex debug models",
    href: "/codex/developer-commands?surface=cli#cli-codex-debug-models",
    type: "experimental",
    description:
      "Print the raw model catalog Codex sees, including an option to inspect only the bundled catalog.",
  },
  {
    key: "codex debug prompt-input",
    href: "/codex/developer-commands?surface=cli#cli-codex-debug-prompt-input",
    type: "experimental",
    description:
      "Render the model-visible prompt input list as JSON, optionally with a prompt and images.",
  },
  {
    key: "codex apply",
    href: "/codex/developer-commands?surface=cli#cli-codex-apply",
    type: "stable",
    description:
      "Apply the latest diff generated by a Codex cloud chat to your local working tree. Alias: `codex a`.",
  },
  {
    key: "codex review",
    href: "/codex/developer-commands?surface=cli#cli-codex-review",
    type: "stable",
    description:
      "Run a non-interactive review of uncommitted changes, a base branch diff, a commit, or custom review instructions.",
  },
  {
    key: "codex archive",
    href: "/codex/developer-commands?surface=cli#cli-codex-archive-and-codex-unarchive",
    type: "stable",
    description:
      "Archive a saved interactive session by session ID or session name.",
  },
  {
    key: "codex delete",
    href: "/codex/developer-commands?surface=cli#cli-codex-delete",
    type: "stable",
    description:
      "Permanently delete a saved interactive session by session ID or session name.",
  },
  {
    key: "codex cloud",
    href: "/codex/developer-commands?surface=cli#cli-codex-cloud",
    type: "experimental",
    description:
      "Browse or execute Codex cloud chats from the terminal without opening the TUI. Alias: `codex cloud-tasks`.",
  },
  {
    key: "codex completion",
    href: "/codex/developer-commands?surface=cli#cli-codex-completion",
    type: "stable",
    description:
      "Generate shell completion scripts for Bash, Zsh, Fish, or PowerShell.",
  },
  {
    key: "codex doctor",
    href: "/codex/developer-commands?surface=cli#cli-codex-doctor",
    type: "stable",
    description:
      "Generate a diagnostic report for local installation, config, auth, runtime, Git, terminal, app-server, and thread inventory issues.",
  },
  {
    key: "codex features",
    href: "/codex/developer-commands?surface=cli#cli-codex-features",
    type: "stable",
    description:
      "List feature flags and persistently enable or disable them in `config.toml`.",
  },
  {
    key: "codex exec",
    href: "/codex/developer-commands?surface=cli#cli-codex-exec",
    type: "stable",
    description:
      "Run Codex non-interactively. Alias: `codex e`. Stream results to stdout or JSONL, resume sessions, or fork them into new sessions.",
  },
  {
    key: "codex execpolicy",
    href: "/codex/developer-commands?surface=cli#cli-codex-execpolicy",
    type: "experimental",
    description:
      "Evaluate execpolicy rule files and see whether a command would be allowed, prompted, or blocked.",
  },
  {
    key: "codex login",
    href: "/codex/developer-commands?surface=cli#cli-codex-login",
    type: "stable",
    description:
      "Authenticate Codex using ChatGPT OAuth, device auth, an API key, or an access token piped over stdin.",
  },
  {
    key: "codex logout",
    href: "/codex/developer-commands?surface=cli#cli-codex-logout",
    type: "stable",
    description: "Remove stored authentication credentials.",
  },
  {
    key: "codex mcp",
    href: "/codex/developer-commands?surface=cli#cli-codex-mcp",
    type: "stable",
    description:
      "Manage Model Context Protocol servers (list, add, remove, authenticate).",
  },
  {
    key: "codex plugin marketplace",
    href: "/codex/developer-commands?surface=cli#cli-codex-plugin-marketplace",
    type: "stable",
    description:
      "Add, list, upgrade, or remove plugin marketplaces from Git or local sources.",
  },
  {
    key: "codex plugin",
    href: "/codex/developer-commands?surface=cli#cli-codex-plugin",
    type: "stable",
    description:
      "Install, list, and remove plugins from configured marketplace sources.",
  },
  {
    key: "codex resume",
    href: "/codex/developer-commands?surface=cli#cli-codex-resume",
    type: "stable",
    description:
      "Continue a previous interactive session by ID or resume the most recent chat.",
  },
  {
    key: "codex fork",
    href: "/codex/developer-commands?surface=cli#cli-codex-fork",
    type: "stable",
    description:
      "Fork a previous interactive session into a new chat, preserving the original transcript.",
  },
  {
    key: "codex sandbox",
    href: "/codex/developer-commands?surface=cli#cli-codex-sandbox",
    type: "stable",
    description:
      "Run arbitrary commands inside Codex-provided macOS, Linux, or Windows sandboxes.",
  },
  {
    key: "codex update",
    href: "/codex/developer-commands?surface=cli#cli-codex-update",
    type: "stable",
    description:
      "Check for and apply a Codex CLI update when the installed release supports self-update.",
  },
  {
    key: "codex unarchive",
    href: "/codex/developer-commands?surface=cli#cli-codex-archive-and-codex-unarchive",
    type: "stable",
    description:
      "Restore an archived interactive session by session ID or session name.",
  },
];

export const reviewOptions = [
  {
    key: "PROMPT",
    type: "string | - (read stdin)",
    description:
      "Custom review instructions. Use `-` to read the instructions from stdin.",
  },
  {
    key: "--uncommitted",
    type: "boolean",
    defaultValue: "false",
    description: "Review staged, unstaged, and untracked changes.",
  },
  {
    key: "--base",
    type: "branch",
    description: "Review changes against the specified base branch.",
  },
  {
    key: "--commit",
    type: "SHA",
    description: "Review the changes introduced by the specified commit.",
  },
  {
    key: "--title",
    type: "string",
    description:
      "Set the commit title shown in the review summary. Requires `--commit`.",
  },
  {
    key: "--strict-config",
    type: "boolean",
    defaultValue: "false",
    description:
      "Error when `config.toml` contains fields this Codex version does not recognize.",
  },
];

export const execOptions = [
  {
    key: "PROMPT",
    type: "string | - (read stdin)",
    description:
      "Initial instruction for the task. Use `-` to pipe the prompt from stdin.",
  },
  {
    key: "--image, -i",
    type: "path[,path...]",
    description:
      "Attach images to the first message. Repeatable; supports comma-separated lists.",
  },
  {
    key: "--model, -m",
    type: "string",
    description: "Override the configured model for this run.",
  },
  {
    key: "--oss",
    type: "boolean",
    defaultValue: "false",
    description:
      "Use a local open source provider. Codex uses `--local-provider` or your configured `oss_provider`, and exits with an error if neither is set.",
  },
  {
    key: "--local-provider",
    type: "lmstudio | ollama",
    description:
      "Choose the local provider used with `--oss`, overriding `oss_provider` for this run.",
  },
  {
    key: "--sandbox, -s",
    type: "read-only | workspace-write | danger-full-access",
    description:
      "Sandbox policy for model-generated commands. Defaults to configuration.",
  },
  {
    key: "--profile, -p",
    type: "string",
    description:
      "Layer `$CODEX_HOME/profile-name.config.toml` on top of the base user config.",
  },
  {
    key: "--approve-for-me, --not-so-yolo",
    type: "boolean",
    defaultValue: "false",
    description:
      "Use automatic approval review with `on-request` approvals and the `workspace-write` sandbox. Conflicts with `--sandbox` and `--yolo`; the interactive CLI also rejects `--ask-for-approval`.",
  },
  {
    key: "--dangerously-bypass-approvals-and-sandbox, --yolo",
    type: "boolean",
    defaultValue: "false",
    description:
      "Bypass approval prompts and sandboxing. Dangerous—only use inside an isolated runner.",
  },
  {
    key: "--dangerously-bypass-hook-trust",
    type: "boolean",
    defaultValue: "false",
    description:
      "Run enabled hooks without requiring persisted hook trust for this invocation. Intended only for automation that already vets hook sources.",
  },
  {
    key: "--cd, -C",
    type: "path",
    description: "Set the workspace root before executing the task.",
  },
  {
    key: "--worktree",
    type: "boolean",
    defaultValue: "false",
    description:
      "Run a new or forked session in a managed Git worktree. Requires local execution; can't be combined with `resume`, `review`, `--ephemeral`, or `--ignore-user-config`.",
  },
  {
    key: "--skip-git-repo-check",
    type: "boolean",
    defaultValue: "false",
    description:
      "Allow running outside a Git repository (useful for one-off directories).",
  },
  {
    key: "--ephemeral",
    type: "boolean",
    defaultValue: "false",
    description: "Run without persisting session rollout files to disk.",
  },
  {
    key: "--ignore-user-config",
    type: "boolean",
    defaultValue: "false",
    description:
      "Do not load `$CODEX_HOME/config.toml`. Authentication still uses `CODEX_HOME`.",
  },
  {
    key: "--ignore-rules",
    type: "boolean",
    defaultValue: "false",
    description:
      "Do not load user or project execpolicy `.rules` files for this run.",
  },
  {
    key: "--output-schema",
    type: "path",
    description:
      "JSON Schema file describing the expected final response shape. Codex validates tool output against it.",
  },
  {
    key: "--color",
    type: "always | never | auto",
    defaultValue: "auto",
    description: "Control ANSI color in stdout.",
  },
  {
    key: "--json, --experimental-json",
    type: "boolean",
    defaultValue: "false",
    description:
      "Print newline-delimited JSON events instead of formatted text.",
  },
  {
    key: "--output-last-message, -o",
    type: "path",
    description:
      "Write the assistant’s final message to a file. Useful for downstream scripting.",
  },
  {
    key: "Resume subcommand",
    type: "codex exec resume [SESSION_ID]",
    description:
      "Resume an exec session by ID or add `--last` to continue the most recent session from the current working directory. Add `--all` to consider sessions from any directory. Accepts an optional follow-up prompt.",
  },
  {
    key: "-c, --config",
    type: "key=value",
    description:
      "Inline configuration override for the non-interactive run (repeatable).",
  },
];

export const appServerOptions = [
  {
    key: "--stdio",
    type: "boolean",
    defaultValue: "false",
    description:
      "Use stdio transport. Equivalent to `--listen stdio://` and mutually exclusive with `--listen`.",
  },
  {
    key: "--listen",
    type: "stdio:// | ws://IP:PORT | unix:// | unix://PATH | off",
    defaultValue: "stdio://",
    description:
      "Transport listener URL. Use `stdio://` for JSONL, `ws://IP:PORT` for a TCP WebSocket endpoint, `unix://` for the default Unix socket, `unix://PATH` for a custom Unix socket, or `off` to disable the local transport.",
  },
  {
    key: "--code-mode-host",
    type: "ws://HOST/PATH | wss://HOST/PATH",
    description:
      "Connect to a remote Code Mode host instead of starting a local host. This outbound connection is shared across threads and is separate from `--listen`; use `wss://` for remote hosts.",
  },
  {
    key: "--ws-auth",
    type: "capability-token | signed-bearer-token",
    description:
      "Authentication mode for app-server WebSocket clients. If omitted, WebSocket auth is disabled; non-local listeners warn during startup.",
  },
  {
    key: "--ws-token-file",
    type: "absolute path",
    description:
      "File containing the shared capability token. Use with `--ws-auth capability-token` unless you provide `--ws-token-sha256` instead.",
  },
  {
    key: "--ws-token-sha256",
    type: "hexadecimal SHA-256 digest",
    description:
      "Expected SHA-256 digest for capability-token authentication. Use instead of `--ws-token-file` when the client token comes from another source.",
  },
  {
    key: "--ws-shared-secret-file",
    type: "absolute path",
    description:
      "File containing the HMAC shared secret used to validate signed JWT bearer tokens. Required with `--ws-auth signed-bearer-token`.",
  },
  {
    key: "--ws-issuer",
    type: "string",
    description:
      "Expected `iss` claim for signed bearer tokens. Requires `--ws-auth signed-bearer-token`.",
  },
  {
    key: "--ws-audience",
    type: "string",
    description:
      "Expected `aud` claim for signed bearer tokens. Requires `--ws-auth signed-bearer-token`.",
  },
  {
    key: "--ws-max-clock-skew-seconds",
    type: "number",
    defaultValue: "30",
    description:
      "Clock skew allowance when validating signed bearer token `exp` and `nbf` claims. Requires `--ws-auth signed-bearer-token`.",
  },
  {
    key: "--analytics-default-enabled",
    type: "boolean",
    defaultValue: "false",
    description:
      "Defaults analytics to enabled for first-party app-server clients unless the user opts out in config.",
  },
];

export const appOptions = [
  {
    key: "PATH",
    type: "path",
    defaultValue: ".",
    description:
      "Workspace path for the ChatGPT desktop app. On macOS, Codex opens this path; on Windows, Codex prints the path.",
  },
  {
    key: "--download-url",
    type: "url",
    description:
      "Advanced override for the ChatGPT desktop app installer URL used during install.",
  },
];

export const debugAppServerSendMessageV2Options = [
  {
    key: "USER_MESSAGE",
    type: "string",
    description:
      "Message text sent to app-server through the built-in V2 test-client flow.",
  },
];

export const debugModelsOptions = [
  {
    key: "--bundled",
    type: "boolean",
    defaultValue: "false",
    description:
      "Skip refresh and print only the model catalog bundled with the current Codex binary.",
  },
];

export const debugPromptInputOptions = [
  {
    key: "PROMPT",
    type: "string",
    description: "Optional user prompt appended after the session context.",
  },
  {
    key: "--image, -i",
    type: "path[,path...]",
    description:
      "Attach one or more images to the user prompt. Separate multiple paths with commas or repeat the flag.",
  },
];

export const doctorOptions = [
  {
    key: "--json",
    type: "boolean",
    defaultValue: "false",
    description: "Emit a redacted machine-readable support report.",
  },
  {
    key: "--summary",
    type: "boolean",
    defaultValue: "false",
    description: "Show grouped check rows and the final count summary only.",
  },
  {
    key: "--all",
    type: "boolean",
    defaultValue: "false",
    description: "Expand long lists in the detailed human-readable report.",
  },
  {
    key: "--no-color",
    type: "boolean",
    defaultValue: "false",
    description: "Disable ANSI color in human-readable output.",
  },
  {
    key: "--ascii",
    type: "boolean",
    defaultValue: "false",
    description:
      "Use ASCII status labels and separators in human-readable output.",
  },
];

export const resumeOptions = [
  {
    key: "SESSION_ID",
    type: "uuid | session name",
    description:
      "Resume the specified session. Omit and use `--last` to continue the most recent session.",
  },
  {
    key: "--last",
    type: "boolean",
    defaultValue: "false",
    description:
      "Skip the picker and resume the most recent chat from the current working directory.",
  },
  {
    key: "--all",
    type: "boolean",
    defaultValue: "false",
    description:
      "Include sessions outside the current working directory when selecting the most recent session.",
  },
  {
    key: "--include-non-interactive",
    type: "boolean",
    defaultValue: "false",
    description:
      "Include non-interactive sessions in the picker and `--last` selection.",
  },
];

export const featuresOptions = [
  {
    key: "List subcommand",
    type: "codex features list",
    description:
      "Show known feature flags, their maturity stage, and their effective state.",
  },
  {
    key: "Enable subcommand",
    type: "codex features enable <feature>",
    description:
      "Persistently enable a feature flag in `$CODEX_HOME/config.toml`.",
  },
  {
    key: "Disable subcommand",
    type: "codex features disable <feature>",
    description:
      "Persistently disable a feature flag in `$CODEX_HOME/config.toml`.",
  },
];

export const execResumeOptions = [
  {
    key: "SESSION_ID",
    type: "uuid | session name",
    description:
      "Resume the specified session. Omit and use `--last` to continue the most recent session.",
  },
  {
    key: "--last",
    type: "boolean",
    defaultValue: "false",
    description:
      "Resume the most recent chat from the current working directory.",
  },
  {
    key: "--all",
    type: "boolean",
    defaultValue: "false",
    description:
      "Include sessions outside the current working directory when selecting the most recent session.",
  },
  {
    key: "--image, -i",
    type: "path[,path...]",
    description:
      "Attach one or more images to the follow-up prompt. Separate multiple paths with commas or repeat the flag.",
  },
  {
    key: "PROMPT",
    type: "string | - (read stdin)",
    description:
      "Optional follow-up instruction sent immediately after resuming.",
  },
];

export const forkOptions = [
  {
    key: "SESSION_ID",
    type: "uuid",
    description:
      "Fork the specified session. Omit and use `--last` to fork the most recent session.",
  },
  {
    key: "--last",
    type: "boolean",
    defaultValue: "false",
    description: "Skip the picker and fork the most recent chat automatically.",
  },
  {
    key: "--all",
    type: "boolean",
    defaultValue: "false",
    description:
      "Show sessions beyond the current working directory in the picker.",
  },
];

export const execpolicyOptions = [
  {
    key: "--rules, -r",
    type: "path (repeatable)",
    description:
      "Path to an execpolicy rule file to evaluate. Provide multiple flags to combine rules across files.",
  },
  {
    key: "--pretty",
    type: "boolean",
    defaultValue: "false",
    description: "Pretty-print the JSON result.",
  },
  {
    key: "COMMAND...",
    type: "var-args",
    description: "Command to be checked against the specified policies.",
  },
];

export const loginOptions = [
  {
    key: "--with-api-key",
    type: "boolean",
    description:
      "Read an API key from stdin (for example `printenv OPENAI_API_KEY | codex login --with-api-key`).",
  },
  {
    key: "--with-access-token",
    type: "boolean",
    description:
      "Read an access token from stdin (for example `printenv CODEX_ACCESS_TOKEN | codex login --with-access-token`).",
  },
  {
    key: "--device-auth",
    type: "boolean",
    description:
      "Use OAuth device code flow instead of launching a browser window.",
  },
  {
    key: "status subcommand",
    type: "codex login status",
    description:
      "Print the active authentication mode and exit with 0 when logged in.",
  },
];

export const applyOptions = [
  {
    key: "TASK_ID",
    type: "string",
    description:
      "Identifier of the Codex cloud chat whose diff should be applied.",
  },
];

export const sandboxMacOptions = [
  {
    key: "--profile, -p",
    type: "NAME",
    description:
      "Layer `$CODEX_HOME/NAME.config.toml` on top of the base user config.",
  },
  {
    key: "--permission-profile, -P",
    type: "NAME",
    description:
      "Apply a named permissions profile from the active configuration stack.",
  },
  {
    key: "--cd, -C",
    type: "DIR",
    description:
      "Working directory used for profile resolution and command execution. Requires `--permission-profile`.",
  },
  {
    key: "--include-managed-config",
    type: "boolean",
    defaultValue: "false",
    description:
      "Include managed requirements while resolving an explicit permissions profile. Requires `--permission-profile`.",
  },
  {
    key: "--allow-unix-socket",
    type: "path",
    description:
      "Allow the sandboxed command to bind or connect Unix sockets rooted at this path. Repeat to allow multiple paths.",
  },
  {
    key: "--log-denials",
    type: "boolean",
    defaultValue: "false",
    description:
      "Capture macOS sandbox denials with `log stream` while the command runs and print them after exit.",
  },
  {
    key: "--config, -c",
    type: "key=value",
    description:
      "Pass configuration overrides into the sandboxed run (repeatable).",
  },
  {
    key: "COMMAND...",
    type: "var-args",
    description:
      "Shell command to execute under macOS Seatbelt. Everything after `--` is forwarded.",
  },
];

export const sandboxLinuxOptions = [
  {
    key: "--profile, -p",
    type: "NAME",
    description:
      "Layer `$CODEX_HOME/NAME.config.toml` on top of the base user config.",
  },
  {
    key: "--permission-profile, -P",
    type: "NAME",
    description:
      "Apply a named permissions profile from the active configuration stack.",
  },
  {
    key: "--cd, -C",
    type: "DIR",
    description:
      "Working directory used for profile resolution and command execution. Requires `--permission-profile`.",
  },
  {
    key: "--include-managed-config",
    type: "boolean",
    defaultValue: "false",
    description:
      "Include managed requirements while resolving an explicit permissions profile. Requires `--permission-profile`.",
  },
  {
    key: "--config, -c",
    type: "key=value",
    description:
      "Configuration overrides applied before launching the sandbox (repeatable).",
  },
  {
    key: "COMMAND...",
    type: "var-args",
    description:
      "Command to execute with bubblewrap filesystem isolation and seccomp filtering. Provide the executable after `--`.",
  },
];

export const sandboxWindowsOptions = [
  {
    key: "--profile, -p",
    type: "NAME",
    description:
      "Layer `$CODEX_HOME/NAME.config.toml` on top of the base user config.",
  },
  {
    key: "--permission-profile, -P",
    type: "NAME",
    description:
      "Apply a named permissions profile from the active configuration stack.",
  },
  {
    key: "--cd, -C",
    type: "DIR",
    description:
      "Working directory used for profile resolution and command execution. Requires `--permission-profile`.",
  },
  {
    key: "--include-managed-config",
    type: "boolean",
    defaultValue: "false",
    description:
      "Include managed requirements while resolving an explicit permissions profile. Requires `--permission-profile`.",
  },
  {
    key: "--config, -c",
    type: "key=value",
    description:
      "Configuration overrides applied before launching the sandbox (repeatable).",
  },
  {
    key: "COMMAND...",
    type: "var-args",
    description:
      "Command to execute under the native Windows sandbox. Provide the executable after `--`.",
  },
];

export const completionOptions = [
  {
    key: "SHELL",
    type: "bash | zsh | fish | power-shell | elvish",
    defaultValue: "bash",
    description: "Shell to generate completions for. Output prints to stdout.",
  },
];

export const cloudExecOptions = [
  {
    key: "QUERY",
    type: "string",
    description:
      "Task prompt. If omitted, Codex prompts interactively for details.",
  },
  {
    key: "--env",
    type: "ENV_ID",
    description:
      "Target Codex cloud environment identifier (required). Use `codex cloud` to list options.",
  },
  {
    key: "--attempts",
    type: "1-4",
    defaultValue: "1",
    description:
      "Number of assistant attempts (best-of-N) Codex cloud should run.",
  },
];

export const cloudListOptions = [
  {
    key: "--env",
    type: "ENV_ID",
    description: "Filter tasks by environment identifier.",
  },
  {
    key: "--limit",
    type: "1-20",
    defaultValue: "20",
    description: "Maximum number of tasks to return.",
  },
  {
    key: "--cursor",
    type: "string",
    description: "Pagination cursor returned by a previous request.",
  },
  {
    key: "--json",
    type: "boolean",
    defaultValue: "false",
    description: "Emit machine-readable JSON instead of plain text.",
  },
];

export const mcpCommands = [
  {
    key: "list",
    type: "--json",
    description:
      "List configured MCP servers. Add `--json` for machine-readable output.",
  },
  {
    key: "get <name>",
    type: "--json",
    description:
      "Show a specific server configuration. `--json` prints the raw config entry.",
  },
  {
    key: "add <name>",
    type: "-- <command...> | --url <value>",
    description:
      "Register a server using a stdio launcher command or a streamable HTTP URL. Supports `--env KEY=VALUE` for stdio transports.",
  },
  {
    key: "remove <name>",
    description: "Delete a stored MCP server definition.",
  },
  {
    key: "login <name>",
    type: "--scopes scope1,scope2",
    description:
      "Start an OAuth login for a streamable HTTP server (servers that support OAuth only).",
  },
  {
    key: "logout <name>",
    description:
      "Remove stored OAuth credentials for a streamable HTTP server.",
  },
];

export const mcpAddOptions = [
  {
    key: "COMMAND...",
    type: "stdio transport",
    description:
      "Executable plus arguments to launch the MCP server. Provide after `--`.",
  },
  {
    key: "--env KEY=VALUE",
    type: "repeatable",
    description:
      "Environment variable assignments applied when launching a stdio server.",
  },
  {
    key: "--url",
    type: "https://…",
    description:
      "Register a streamable HTTP server instead of stdio. Mutually exclusive with `COMMAND...`.",
  },
  {
    key: "--bearer-token-env-var",
    type: "ENV_VAR",
    description:
      "Environment variable whose value is sent as a bearer token when connecting to a streamable HTTP server.",
  },
  {
    key: "--oauth-client-id",
    type: "CLIENT_ID",
    description:
      "OAuth client identifier for a streamable HTTP MCP server. Requires `--url`.",
  },
  {
    key: "--oauth-resource",
    type: "RESOURCE",
    description:
      "OAuth resource parameter to include during login for a streamable HTTP MCP server. Requires `--url`.",
  },
];

export const marketplaceCommands = [
  {
    key: "add <source>",
    type: "[--ref REF] [--sparse PATH] [--json]",
    description:
      "Install a plugin marketplace from GitHub shorthand, a Git URL, an SSH URL, or a local marketplace root directory. `--sparse` is supported only for Git sources and can be repeated.",
  },
  {
    key: "list",
    type: "[--json]",
    description:
      "Show plugin marketplaces Codex is currently considering and the root path for each marketplace.",
  },
  {
    key: "upgrade [marketplace-name]",
    type: "[--json]",
    description:
      "Refresh one configured Git marketplace, or all configured Git marketplaces when no name is provided.",
  },
  {
    key: "remove <marketplace-name>",
    type: "[--json]",
    description: "Remove a configured plugin marketplace.",
  },
];

export const pluginCommands = [
  {
    key: "add <plugin[@marketplace]>",
    type: "[--marketplace, -m NAME] [--json]",
    description:
      "Install a plugin from a configured marketplace. Use `--marketplace` or `-m` when the plugin argument omits `@marketplace`.",
  },
  {
    key: "list",
    type: "[--marketplace, -m NAME] [--available --json] [--json]",
    description:
      "List installed plugins. With `--json`, output has `installed` and `available` arrays; `--available` includes uninstalled marketplace plugins and requires `--json`.",
  },
  {
    key: "remove <plugin[@marketplace]>",
    type: "[--marketplace, -m NAME] [--json]",
    description:
      "Remove an installed plugin from local config and cache. Use `--json` for automation-friendly output.",
  },
  {
    key: "marketplace",
    description:
      "Manage configured marketplace sources. See `codex plugin marketplace` below.",
  },
];

export const archiveOptions = [
  {
    key: "SESSION",
    type: "session ID | session name",
    description:
      "Saved session to archive or restore. Session IDs take precedence over session names.",
  },
  {
    key: "--remote",
    type: "ws://host:port | wss://host:port | unix:// | unix://PATH",
    description:
      "Connect to a remote app-server endpoint before changing archive state.",
  },
  {
    key: "--remote-auth-token-env",
    type: "ENV_VAR",
    description:
      "Read a bearer token from this environment variable when `--remote` requires authentication.",
  },
];

export const deleteOptions = [
  {
    key: "SESSION",
    type: "session ID | session name",
    description:
      "Saved session to delete. Session IDs take precedence over session names.",
  },
  {
    key: "--force",
    type: "boolean",
    defaultValue: "false",
    description:
      "Delete without prompting. The session argument must be a UUID; names still require interactive confirmation.",
  },
  {
    key: "--remote",
    type: "ws://host:port | wss://host:port | unix:// | unix://PATH",
    description:
      "Connect to a remote app-server endpoint before deleting the session.",
  },
  {
    key: "--remote-auth-token-env",
    type: "ENV_VAR",
    description:
      "Read a bearer token from this environment variable when `--remote` requires authentication.",
  },
];

## How to read this reference

This page catalogs every documented Codex CLI command and flag. Use the interactive tables to search by key or description. Each section shows the option's maturity and flags deprecated options and risky combinations.

The CLI inherits most defaults from `~/.codex/config.toml`. Any
  `-c key=value` overrides you pass at the command line take
  precedence for that invocation. See [Config
  basics](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence) for more
  information.

## Global flags

Choose a model available to your signed-in account or workspace. See
[GPT-6.1 Sol availability](https://learn.chatgpt.com/docs/models#gpt-6.1-sol) before using it with `--model`.

<ConfigTable client:load options={globalFlagOptions} />

These options apply to the base `codex` command. Most propagate to commands;
see the notes above or the relevant command help for exceptions. For propagated
flags, follow the relevant command help. For example, `codex exec --oss ...`
applies `--oss` to `exec`.

## Command overview

The Maturity column uses feature maturity labels such as Experimental, Beta,
  Stable, and Deprecated. See [Feature Maturity](https://learn.chatgpt.com/docs/feature-maturity) for
  how to interpret these labels.

<ConfigTable
  client:load
  options={commandOverview}
  secondColumnTitle="Maturity"
  secondColumnVariant="maturity"
/>

## Command details

### `codex` (interactive)

Running `codex` with no subcommand launches the interactive terminal UI (TUI). The agent accepts the global flags above plus image attachments. Web search defaults to cached mode; use `--search` to switch to live browsing. For low-friction local work, use `--sandbox workspace-write --ask-for-approval on-request`.

Use `--remote ws://host:port` or `--remote wss://host:port` to connect the TUI to an app server started with `codex app-server --listen ws://IP:PORT`. For a local Unix socket, use `--remote unix://` for the default socket or `--remote unix://PATH` for an explicit path. Add `--remote-auth-token-env <ENV_VAR>` when the server requires a bearer token for WebSocket authentication.

### `codex agents`

Open the command center to browse chats and switch between agents on a shared
server. Use `--remote <URL>` to connect to a remote server and `--cd <DIR>` to
set the directory for new remote tasks. `codex agents` doesn't support
`--no-daemon`.

### `codex queue`

Queue a text message for an existing session:

```bash
codex queue --thread <SESSION_ID> --message "Run the remaining checks"
```

`--thread` accepts a UUID or exact session name. Use a UUID when sessions
share the same name. The command also accepts `--remote` and
`--remote-auth-token-env`; image attachments aren't supported.

### `codex app-server`

Launch the Codex app server locally. This is primarily for development and debugging and may change without notice.

<ConfigTable client:load options={appServerOptions} />

`codex app-server --listen stdio://` keeps the default JSONL-over-stdio behavior, and `codex app-server --stdio` is an alias for that transport. `--listen ws://IP:PORT` enables WebSocket transport for app-server clients. The server accepts `ws://` listen URLs; use TLS termination or a secure proxy when clients connect with `wss://`. Use `--listen unix://` to accept WebSocket handshakes on Codex's default Unix socket, or `--listen unix:///absolute/path.sock` to choose a socket path. If you generate schemas for client bindings, add `--experimental` to include gated fields and methods.

Add `--code-mode-host wss://code-mode.example.com/host` to connect app-server to
a remote Code Mode host instead of starting a local host. This outbound
connection is separate from `--listen` and shared by every thread in the
app-server process. Use `ws://` only for a localhost or SSH-forwarded host.

### `codex remote-control`

Run `codex remote-control` to start remote control through the managed background
server when eligible, with a foreground fallback. Use
`codex remote-control --no-daemon` to run in the foreground explicitly. Use
`codex remote-control start` to start the local app-server daemon with remote
control enabled, and `codex remote-control stop` to stop it. Managed
remote-control clients and SSH remote workflows use these commands; they aren't
a replacement for `codex app-server --listen` when you're building a local
protocol client.

After the daemon is running, use `codex remote-control pair` to create and
print a short-lived manual pairing code. Add `--json` to any remote-control
command for machine-readable output. For `pair`, the JSON response includes
`pairingCode`, `manualPairingCode`, `environmentId`, and `expiresAt`.
`--no-daemon` applies only to the bare `remote-control` command; don't combine it
with `start`, `stop`, or `pair`.

### `codex app`

Launch the ChatGPT desktop app from the terminal on macOS or Windows. On macOS,
Codex can open a specific workspace path; on Windows, Codex prints the path to
open.

<ConfigTable client:load options={appOptions} />

`codex app` opens an installed ChatGPT desktop app, or starts the installer when
the app is missing. On macOS, Codex opens the provided workspace path; on
Windows, it prints the path to open after installation.

### `codex debug app-server send-message-v2`

Send one message through app-server's V2 thread/turn flow using the built-in app-server test client.

<ConfigTable client:load options={debugAppServerSendMessageV2Options} />

This debug flow initializes with `experimentalApi: true`, starts a thread, sends a turn, and streams server notifications. Use it to reproduce and inspect app-server protocol behavior locally.

### `codex debug models`

Print the raw model catalog Codex sees as JSON.

<ConfigTable client:load options={debugModelsOptions} />

Use `--bundled` when you want to inspect only the catalog bundled with the current binary, without refreshing from the remote models endpoint.

### `codex debug prompt-input`

Render the exact model-visible prompt input list as JSON. Use this when
debugging instruction discovery, session context, or prompt construction.

<ConfigTable client:load options={debugPromptInputOptions} />

### `codex apply`

Apply the most recent diff from a Codex cloud chat to your local repository. You must authenticate and have access to the chat.

<ConfigTable client:load options={applyOptions} />

Codex prints the patched files and exits non-zero if `git apply` fails (for example, due to conflicts).

### `codex review`

Run a code review non-interactively. Choose exactly one review target, or pass
custom review instructions as a prompt.

<ConfigTable client:load options={reviewOptions} />

`--uncommitted`, `--base`, `--commit`, and a custom `PROMPT` conflict with one
another. Use `--title` only with `--commit`.

### `codex archive` and `codex unarchive`

Archive or restore a saved interactive session by session ID or session name.
Use these commands when you want to clean up the session picker without deleting
the transcript. Session IDs take precedence over session names.

```bash
codex archive <SESSION>
codex unarchive <SESSION>
```

<ConfigTable client:load options={archiveOptions} />

### `codex delete`

Permanently delete a saved interactive session by session ID or session name.
Use this only when you want to remove the transcript instead of hiding it from
active session lists.

```bash
codex delete <SESSION>
codex delete <SESSION_UUID> --force
```

<ConfigTable client:load options={deleteOptions} />

Use `--force` only with a session UUID. Named sessions still require
confirmation so Codex doesn't delete a repeated or ambiguous name without a prompt.

### `codex cloud`

Interact with Codex cloud chats from the terminal. The default command opens an interactive picker; `codex cloud exec` submits a task directly, and `codex cloud list` returns recent chats for scripting or quick inspection.

<ConfigTable client:load options={cloudExecOptions} />

Authentication follows the same credentials as the main CLI. Codex exits non-zero if the task submission fails.

#### `codex cloud list`

List recent cloud chats with optional filtering and pagination.

<ConfigTable client:load options={cloudListOptions} />

Plain-text output prints a task URL followed by status details. Use `--json` for automation. The JSON payload contains a `tasks` array plus an optional `cursor` value. Each task includes `id`, `url`, `title`, `status`, `updated_at`, `environment_id`, `environment_label`, `summary`, `is_review`, and `attempt_total`.

### `codex completion`

Generate shell completion scripts and redirect the output to the appropriate location, for example `codex completion zsh > "${fpath[1]}/_codex"`.

<ConfigTable client:load options={completionOptions} />

### `codex doctor`

Generate a local diagnostic report before filing a support issue or
while investigating a broken Codex installation. The report checks installation,
configuration, authentication, runtime, Git, terminal, app-server, and thread
inventory health.

<ConfigTable client:load options={doctorOptions} />

### `codex features`

Manage feature flags stored in `$CODEX_HOME/config.toml`. The `enable` and
`disable` commands persist changes so they apply to future sessions. The
`features` subcommand doesn't accept `--profile`.

<ConfigTable client:load options={featuresOptions} />

### `codex exec`

Use `codex exec` (or the short form `codex e`) for scripted or CI-style runs that should finish without human interaction.

<ConfigTable client:load options={execOptions} />

Codex writes formatted output by default. Add `--json` to receive newline-delimited JSON events (one per state change). The optional `resume` subcommand lets you continue non-interactive tasks. Use `--last` to pick the most recent session from the current working directory, or add `--all` to search across all sessions:

<ConfigTable client:load options={execResumeOptions} />

Use `codex exec fork <SESSION_ID> [PROMPT]` to copy a saved session into a new
session. The session argument accepts a UUID or name. With no prompt, Codex
creates the fork without starting a turn. Pass `-` as the prompt to read it from
stdin, or add `--image` to attach images.

A prompt is required when using images, `--output-schema`,
`--output-last-message`, or `--ephemeral`.

Add `--worktree` to a new or forked run to create a managed Git worktree:

```bash
codex exec --worktree "implement the next step"
codex exec fork <SESSION_ID> --worktree "try an alternative approach"
```

`--worktree` requires local execution. Don't combine it with `resume`, `review`,
`--ephemeral`, or `--ignore-user-config`.

### `codex execpolicy`

Check `execpolicy` rule files before you save them. `codex execpolicy check` accepts one or more `--rules` flags (for example, files under `~/.codex/rules`) and emits JSON showing the strictest decision and any matching rules. Add `--pretty` to format the output. The `execpolicy` command is currently in preview.

<ConfigTable client:load options={execpolicyOptions} />

### `codex login`

Authenticate the CLI with a ChatGPT account, API key, or access token. With no flags, Codex opens a browser for the ChatGPT OAuth flow.

<ConfigTable client:load options={loginOptions} />

`codex login status` exits with `0` when credentials are present, which is helpful in automation scripts.

### `codex logout`

Remove saved credentials for both API key and ChatGPT authentication. This command has no flags.

### `codex mcp`

Manage Model Context Protocol server entries stored in `~/.codex/config.toml`.

<ConfigTable client:load options={mcpCommands} />

The `add` subcommand supports both stdio and streamable HTTP transports:

<ConfigTable client:load options={mcpAddOptions} />

OAuth actions (`login`, `logout`) only work with streamable HTTP servers (and only when the server supports OAuth).

### `codex plugin`

Install, list, and remove plugins from configured marketplaces.

<ConfigTable client:load options={pluginCommands} />

`codex plugin add --json` prints `pluginId`, `name`, `marketplaceName`,
`version`, `installedPath`, and `authPolicy`. `codex plugin list --json` prints
`installed` and `available` arrays. Entries include `pluginId`, `name`,
`marketplaceName`, `version`, `installed`, `enabled`, `source`, `installPolicy`,
`authPolicy`, and, when available, `marketplaceSource` with the configured
marketplace source type and value. `codex plugin remove --json` prints
`pluginId`, `name`, and `marketplaceName`.

### `codex plugin marketplace`

Manage plugin marketplace sources that Codex can browse and install from.

<ConfigTable client:load options={marketplaceCommands} />

`codex plugin marketplace add` accepts GitHub shorthand such as `owner/repo` or
`owner/repo@ref`, HTTP or HTTPS Git URLs, SSH Git URLs, and local marketplace
root directories. Use `--ref` to pin a Git ref, and repeat `--sparse PATH` to
use a sparse checkout for Git-backed marketplace repositories.

`codex plugin marketplace list` prints in-scope marketplace names and roots,
including implicitly discovered default marketplaces and configured marketplace
snapshots.

Add `--json` to marketplace add, list, upgrade, or remove commands for
automation-friendly output. Marketplace add JSON includes `marketplaceName`,
`installedRoot`, and `alreadyAdded`; list JSON includes a `marketplaces` array
with `name`, `root`, and optional `marketplaceSource`; upgrade JSON includes
`selectedMarketplaces`, `upgradedRoots`, and `errors`; remove JSON includes
`marketplaceName` and `installedRoot`.

### `codex mcp-server`

The `codex mcp-server` command and standalone `codex-mcp-server` binary have
  been removed. Use the [Codex app server](https://learn.chatgpt.com/docs/app-server) instead.

### `codex resume`

Continue an interactive session by ID or resume the most recent chat. `codex resume` scopes `--last` to the current working directory unless you pass `--all`. It accepts model and sandbox overrides, but not `--worktree`.

If the current working directory differs from the session's saved directory,
Codex asks which directory to use. Set
[`tui.resume_cwd`](https://learn.chatgpt.com/docs/config-file/config-reference) to `"current"` or
`"session"` to reuse that choice without a prompt. An explicit `--cd` (`-C`)
override takes precedence over `tui.resume_cwd`.

<ConfigTable client:load options={resumeOptions} />

### `codex fork`

Fork a previous interactive session into a new chat. By default, `codex fork` opens the session picker; add `--last` to fork your most recent session instead.

When the current and saved session directories differ, `codex fork` uses the
same working-directory prompt and `tui.resume_cwd` setting as `codex resume`.

<ConfigTable client:load options={forkOptions} />

To fork into a managed Git worktree, run `codex fork <SESSION_ID> --worktree`.
This requires an explicit session ID and local execution; it doesn't support
`--last` or the session picker.

### `codex sandbox`

Use the sandbox helper to run a command under the same policies Codex uses internally.

#### macOS seatbelt

<ConfigTable client:load options={sandboxMacOptions} />

<a id="linux-landlock"></a>

#### Linux sandbox

<ConfigTable client:load options={sandboxLinuxOptions} />

#### Windows

<ConfigTable client:load options={sandboxWindowsOptions} />

### `codex update`

Check for and apply a Codex CLI update when the installed release supports self-update. Debug builds print a message telling you to install a release build instead.

## Flag combinations and safety tips

- Use `--sandbox workspace-write` for unattended local work that can stay inside the workspace, and avoid `--dangerously-bypass-approvals-and-sandbox` unless you are inside a dedicated sandbox VM.
- When you need to grant Codex write access to more directories, prefer `--add-dir` rather than forcing `--sandbox danger-full-access`.
- Pair `--json` with `--output-last-message` in CI to capture machine-readable progress and a final natural-language summary.

## Interactive shortcuts

- Type `@` to search for a file in the workspace and add its path to the prompt.
- Press <kbd>Up</kbd> or <kbd>Down</kbd> to restore draft history.
- Press <kbd>Ctrl</kbd>+<kbd>R</kbd> to search prompt history, then press <kbd>Enter</kbd> to use a match or <kbd>Escape</kbd> to cancel.
- Press <kbd>Ctrl</kbd>+<kbd>O</kbd> or run `/copy` to copy the latest completed Codex output.
- Prefix a line with `!` to run a local shell command under the current approval and sandbox settings.
- Press <kbd>Tab</kbd> while Codex is working to queue a follow-up prompt, slash command, or shell command for the next turn.
- Press <kbd>Enter</kbd> while Codex is working to inject new instructions into the current turn.
- Press <kbd>Escape</kbd> twice with an empty composer to edit the previous user message and fork the chat from that point.
- Press <kbd>Ctrl</kbd>+<kbd>C</kbd> or run `/exit` to close the session.

## Related resources

- [Codex CLI overview](https://learn.chatgpt.com/docs/codex/cli): installation, upgrades, and quick tips.
- [Config basics](https://learn.chatgpt.com/docs/config-file/config-basic): persist defaults like the model and provider.
- [Advanced Config](https://learn.chatgpt.com/docs/config-file/config-advanced): profiles, providers, sandbox tuning, and integrations.
- [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md): conceptual overview of Codex agent capabilities and best practices.
