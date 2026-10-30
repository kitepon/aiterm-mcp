---
title: "Antigravity CLI reference"
source_url: "https://antigravity.google/docs/cli/reference/"
source_type: official_docs
fetched: 2026-10-30
topic: agent-launchers
tags: ["antigravity", "cli"]
summary: "公式CLI引数とqueuedMessages設定"
relevance: "実行中送信を次turn queueへ誤配送しない"
chars: 29392
---

[Skip to content](#_top)

[![](/_astro/antigravity_product_lockup_dark.YcYY_PSr.svg)![](/_astro/antigravity_product_lockup_full_color.cUD_Se6a.svg)Google Antigravity Docs](/)

Search docs...`⌘K`

?ESCCancel

AllApp×CLI×IDE×Extensions×SDK×Blog×Releases×

Explore Antigravity

[Getting StartedInstall & launch your first agent→](/docs/getting-started/)[Remote ControlDrive desktop & CLI sessions from any browser→](/docs/remote-control/)[Agent Skills & RulesReusable workflows & workspace instructions→](/docs/skills/)[Subagents & TeamworkParallel multi-agent orchestration→](/docs/subagents/)[Antigravity SDKBuild custom Python agents & hooks→](/docs/sdk/overview/)[Permissions & SandboxFile access controls & safe execution→](/docs/permissions/)

Try searching

Remote ControlAgent skillsCustom subagentsIDE extensionsSandbox permissions

`↑``↓`Navigate`↵` Open`esc` Close

[🚀 Remote Control](https://antigravity.google.com "Launch Remote Control")[Download](/download)

Select themeDarkLightAuto

ENEnglish (United States)Bahasa Indonesia (Indonesia)Deutsch (Deutschland)English (Canada)English (United Kingdom)Español (España)Español (México)Français (France)Italiano (Italia)Polski (Polska)Português (Brasil)हिन्दी (भारत)ไทย (ประเทศไทย)日本語 (日本)简体中文 (中国)繁體中文 (台灣)한국어 (대한민국)

[Get Started](/docs/overview/)[Features](/docs/features/)[SDK](/docs/sdk/overview/)

[Changelog](/docs/changelog/)[Blog ↗](/blog/)

[NewIntroducing the Plugin Marketplace in Google AntigravityRead post](/blog/plugin-marketplace-in-antigravity)

## Get Started

* [Overview](/docs/overview/)
* [Quickstart](/docs/getting-started/)
* [Authenticate](/docs/install/)
* [Choose a model](/docs/models/)
* [Build with Google](/docs/build-with-google/)

## IDE Extensions

* [Overview](/docs/ide/extensions/)
* [Visual Studio Code](/docs/ide/extensions/vscode/)
* [Visual Studio](/docs/ide/extensions/visual-studio/)
* [JetBrains IDEs](/docs/ide/extensions/jetbrains/)
* [Zed](/docs/ide/extensions/zed/)
* [Xcode](/docs/ide/extensions/xcode/)
* [Eclipse](/docs/ide/extensions/eclipse/)

## CLI reference

* [CLI commands](/docs/cli/reference/)
* [CLI features](/docs/features?tab=cli#antigravity-cli-features)
* [CLI settings and tips](/docs/cli/using/)
* [CLI troubleshooting](/docs/cli/troubleshooting/)
* [CLI best practices](/docs/cli/best-practices/)
* [CLI AI credits](/docs/cli/credits/)

## Migrations

* [Gemini CLI](/docs/cli/gcli-migration/)
* [Firebase Studio](/docs/firebase-studio-migration/)
* [Workflows to Skills](/docs/migration/workflows-to-skills/)

## Resources

* [Plans](/docs/plans/)
* [Enterprise Overview](/docs/enterprise/)
* [FAQ](/docs/faq/)

## LEARN

* [Overview](/docs/features/)
* [Mentions and quoting](/docs/at-mentions/)
* [Remote Control](/docs/remote-control/)
* [Search and command palette](/docs/search/)
* [Marketplace](/docs/marketplace/)
* [Terminal sandbox](/docs/sandbox/)
* [Review changes](/docs/review-changes/)
* Terminal
  + [Execution modes](/docs/cli/modes/)
  + [Headless mode](/docs/cli/headless/)
  + [Status line customization](/docs/cli/statusline/)
  + [Terminal title customization](/docs/cli/title/)
* Browser
  + [Overview](/docs/ide/browser/)
  + [Browser recordings](/docs/ide/browser-recordings/)
  + [Allowlist and denylist](/docs/ide/allowlist-denylist/)
  + [Separate Chrome profile](/docs/ide/separate-chrome-profile/)
* Artifacts
  + [Overview](/docs/artifacts/)
  + [Implementation plan](/docs/implementation-plan/)
  + [Walkthrough](/docs/walkthrough/)
  + [Visual screenshots](/docs/screenshots/)
  + [Reviewing artifacts (CLI)](/docs/cli/artifacts/)
* Projects
  + [Overview](/docs/projects/)
  + [Prompting and interaction](/docs/cli/prompting/)
  + [Managing conversations](/docs/cli/conversations/)
* Permissions
  + [Overview](/docs/permissions/)
* Editor features
  + [Tab completion](/docs/ide/tab/)
  + [Agent side panel](/docs/ide/agent-side-panel/)
  + [Agent overview](/docs/agent/)
  + [Task groups](/docs/tools/)
  + [Review changes in the editor](/docs/ide/review-changes-editor/)
* Settings
  + [Overview](/docs/settings/)
  + [Agent settings](/docs/agent-settings/)
  + [Artifact review](/docs/artifact-review/)
  + [Vim editor mode](/docs/cli/vim-editor-mode/)

## SLASH COMMANDS

* [Overview](/docs/slash-commands/)
* [/agents](/docs/cli/commands/agents/)
* [/boost](/docs/boost/)
* [/browser](/docs/commands/browser/)
* [/btw](/docs/cli/commands/btw/)
* [/changelog](/docs/cli/commands/changelog/)
* [/codesearch](/docs/cli/commands/codesearch/)
* [/context](/docs/cli/commands/context/)
* [/credits](/docs/cli/commands/credits/)
* [/diff](/docs/cli/commands/diff/)
* [/effort](/docs/cli/commands/effort/)
* [/generative\_ui](/docs/commands/generative-ui/)
* [/goal](/docs/commands/goal/)
* [/grill-me](/docs/commands/grill-me/)
* [/learn](/docs/commands/learn/)
* [/permissions](/docs/cli/commands/permissions/)
* [/plan](/docs/plan/)
* [/resume](/docs/cli/commands/resume/)
* [/schedule](/docs/commands/schedule/)
* [/statusline](/docs/cli/commands/statusline/)
* [/teamwork](/docs/teamwork/)
* [/title](/docs/cli/commands/title/)
* [/usage](/docs/cli/commands/usage/)
* [/voice](/docs/cli/commands/voice/)

## EXTEND

* [Custom subagents](/docs/subagents/)
* [Lifecycle hooks](/docs/hooks/)
* [MCP](/docs/mcp/)
* [Plugins](/docs/plugins/)
* [Sidecars](/docs/sidecars/)
* Skills
  + [Agent skills](/docs/skills/)
  + [IDE workflows](/docs/ide/workflows/)
  + [Rules](/docs/rules/)
* [Build plugins](/docs/build-plugins/)

## ANTIGRAVITY SDK

* [Overview and quickstart](/docs/sdk/overview/)
* [Local models](/docs/sdk/local-models/)
* [Personas](/docs/sdk/personas/)
* [Tools and skills](/docs/sdk/tools/)
* [MCP](/docs/sdk/mcp/)
* [Policies](/docs/sdk/policies/)
* [Subagents](/docs/sdk/subagents/)
* [Structured output](/docs/sdk/structured-output/)
* [Lifecycle and hooks](/docs/sdk/lifecycle/)

Select themeDarkLightAuto

On this page

* [Overview](#_top)
* [Core slash commands](#core-slash-commands)
* [Default keybindings](#default-keybindings)
  + [Global controls](#global-controls)
  + [Prompt focus keys](#prompt-focus-keys)
  + [Navigation and scrolling](#navigation-and-scrolling)
  + [Tool confirmations](#tool-confirmations)
* [Command-line flags](#command-line-flags)
* [Configuration keys (settings.json)](#configuration-keys-settingsjson)
  + [Example settings.json](#example-settingsjson)
* [Next steps](#next-steps)

## On this page

* [Overview](#_top)
* [Core slash commands](#core-slash-commands)
* [Default keybindings](#default-keybindings)
  + [Global controls](#global-controls)
  + [Prompt focus keys](#prompt-focus-keys)
  + [Navigation and scrolling](#navigation-and-scrolling)
  + [Tool confirmations](#tool-confirmations)
* [Command-line flags](#command-line-flags)
* [Configuration keys (settings.json)](#configuration-keys-settingsjson)
  + [Example settings.json](#example-settingsjson)
* [Next steps](#next-steps)

CLI commands - Antigravity CLIcliAntigravity CLIGet StartedCLI commands - Antigravity CLI Antigravity CLI Get StartedAntigravity CLI

Get StartedCLI referenceCLI commands

Markdown

Copy MarkdownView Markdown

# CLI commands

[Section titled “CLI commands”](#cli-commands)

Review tables listing all TUI slash commands, default keyboard shortcuts, command-line flags, and JSON configuration parameters.

## Core slash commands

[Section titled “Core slash commands”](#core-slash-commands)

Type `/` inside the prompt box to open the typeahead command selection menu.

| Command | Category | Alias | Execution Purpose |
| --- | --- | --- | --- |
| **`/add-dir <path>`** | Utilities | — | Add a directory path to the active workspace. |
| **[`/agents`](/docs/cli/commands/agents)** | Tools & Tasks | — | Open the [Agent Manager panel](/docs/cli/commands/agents) to switch custom agents and monitor background subagents. |
| **`/artifact`** | Tools & Tasks | — | Open the Artifact Review panel. |
| **[`/boost`](/docs/boost)** `<task>` | Reasoning | — | Run on-demand multi-agent deep reasoning loops. |
| **[`/browser`](/docs/commands/browser)** `<task>` | Tools & Tasks | — | Delegate web browsing, UI verification, and in-browser debugging to the [browser subagent](/docs/commands/browser). |
| **[`/btw`](/docs/cli/commands/btw) `<query>`** | Utilities | — | Ask a [side question in the background](/docs/cli/commands/btw) without interrupting the main conversation. |
| **[`/changelog`](/docs/cli/commands/changelog)** | Utilities | — | Open the [interactive release notes viewer](/docs/cli/commands/changelog) or print CLI changes in headless mode. |
| **`/clear`** | Utilities | `/new` | Clear the terminal and reset active conversation contexts. |
| **[`/codesearch`](/docs/cli/commands/codesearch) `<query>`** | Utilities | `/cs`, `/search` | Open the [interactive Code Search panel](/docs/cli/commands/codesearch) to search code across the workspace. |
| **`/config`** | Configurations | `/settings` | Open the interactive Settings Editor overlay. |
| **[`/context`](/docs/cli/commands/context)** | Utilities | — | Open the [context usage visualization panel](/docs/cli/commands/context). |
| **`/copy [n|btw]`** | Utilities | — | Copy the last agent response, the n-th most recent response, or the latest [`/btw`](/docs/cli/commands/btw) answer. |
| **[`/credits`](/docs/cli/commands/credits)** | Account | — | View remaining G1 credits and purchase links. |
| **[`/diff`](/docs/cli/commands/diff)** | Utilities | — | Open the [interactive diff viewer](/docs/cli/commands/diff) to view changes, turns, and commits. |
| **[`/effort`](/docs/cli/commands/effort) `[level]`** | Configurations | — | Set or inspect the active model’s [reasoning effort level](/docs/cli/commands/effort) (`low` through `max`, depending on the model). |
| **`/exit`** | Core | `/quit` | Close the TUI session and restore your host shell. |
| **`/feedback`** | Utilities | — | Open the feedback submission panel. |
| **`/fork`** | Conversations | `/branch` | Clone the current conversation thread into a new parallel session. |
| **[`/goal`](/docs/commands/goal)** `<objective>` | Reasoning | — | Run autonomously until the [goal is verified complete](/docs/commands/goal), without intermediate pauses. |
| **[`/grill-me`](/docs/commands/grill-me)** `[task]` | Planning | — | Have the agent [interview you](/docs/commands/grill-me) one question at a time, with a recommended answer for each, before it starts work. |
| **`/help`** | Utilities | — | Open the help panel showing commands and shortcuts. |
| **`/hooks`** | Tools & Tasks | — | Browse active pre-flight/post-format script hooks. |
| **`/keybindings`** | Configurations | — | Open the interactive Keyboard Shortcut Editor. |
| **[`/learn`](/docs/commands/learn)** `[instruction]` | Tools & Tasks | — | Capture session corrections as persistent [rules or skills](/docs/commands/learn) through a reviewable proposal. |
| **`/logout`** | Account | — | Disconnect your profile and purge authentication tokens from the secure keyring. |
| **`/mcp`** | Tools & Tasks | — | Open the Model Context Protocol (MCP) server manager. |
| **`/model`** | Configurations | — | Choose your preferred reasoning model (persists across sessions). To run a single prompt on another model without changing your default, use `/model <model> <prompt>`. |
| **`/open <path>`** | Utilities | — | Force the path to open inside your default system editor. |
| **[`/permissions`](/docs/cli/commands/permissions)** | Configurations | — | Open the interactive tool permissions manager panel. |
| **[`/plan`](/docs/plan)** `[task]` | Planning | — | Explore the codebase, clarify requirements, and draft a reviewable [Implementation Plan](/docs/implementation-plan). |
| **[`/plugin`](/docs/plugins?tab=cli)** | Tools & Tasks | `/plugins` | Open the interactive [Plugins Manager](/docs/marketplace?tab=cli) or run inline `install`, `uninstall`, `enable`, `disable`, and `list` commands. |
| **`/rename <name>`** | Conversations | — | Rename the current session thread. |
| **[`/remote-control`](/docs/remote-control?tab=cli#interactive-mode) [on/off]** | Utilities | — | Toggle Remote Control for the active terminal session. |
| **[`/resume`](/docs/cli/commands/resume)** | Conversations | `/switch`, `/conversation` | Open the [conversation picker overlay](/docs/cli/commands/resume) to select and load previous threads. |
| **`/rewind`** | Conversations | `/undo` | Roll back your conversation history to a previous message. |
| **[`/schedule`](/docs/commands/schedule)** `<when> <task>` | Tools & Tasks | — | Set a [one-shot timer or recurring cron schedule](/docs/commands/schedule) that wakes the agent with an instruction. |
| **`/skills`** | Tools & Tasks | — | Browse loaded local and global Agent Skills. Run `/skills reload` to reload skills from disk. |
| **[`/statusline`](/docs/cli/commands/statusline)** | Configurations | — | Open the Status Bar customization overlay. |
| **`/tasks`** | Tools & Tasks | — | Open the Task Manager panel to monitor background shell execution logs. |
| **[`/teamwork`](/docs/teamwork)** `<task>` | Reasoning | — | Launch [collaborative multi-agent teams](/docs/teamwork) for long-horizon projects (paid plans). |
| **[`/title`](/docs/cli/commands/title) [on/off]** | Configurations | — | Toggle or set terminal window title updates. |
| **[`/usage`](/docs/cli/commands/usage)** | Utilities | `/quota` | Display model quota usage. |
| **[`/voice`](/docs/cli/commands/voice)** | Utilities | `/record` | Dictate a prompt using your microphone. |

## Default keybindings

[Section titled “Default keybindings”](#default-keybindings)

The following tables list the keyboard shortcut commands mapping global, prompt, navigation, and approval operations.

### Global controls

[Section titled “Global controls”](#global-controls)

These hotkeys are always active regardless of which panel, overlay, or prompt is currently focused.

| Key | TUI Command | Action Behavior |
| --- | --- | --- |
| **`Esc`** | `cli.escape` | Closes active panels, halts active streams, or clears empty prompts. |
| **`Ctrl+C`** | `cli.exit` | Terminates the CLI session (prompts for confirmation if agent is working). |
| **`Ctrl+D`** | `cli.exit` | Exits the CLI session (only when the prompt box is empty). |
| **`Ctrl+L`** | `cli.clear_screen` | Refreshes and clears the visual terminal buffer. |

### Prompt focus keys

[Section titled “Prompt focus keys”](#prompt-focus-keys)

These keys are active when writing instructions inside the prompt box.

| Key | TUI Command | Action Behavior |
| --- | --- | --- |
| **`Enter`** | `cli.enter` | Submits your prompt or active menu selection to the agent. |
| **`Shift+Enter`** / **`Ctrl+J`** | `prompt.insert_newline` | Inserts a clean newline without submitting. |
| **`Shift+Tab`** | `cli.cycle_mode` | Cycles between execution modes (`default` > `accept-edits` > `auto` > `plan`; `auto` only where available). |
| **`Ctrl+V`** | `edit.paste` | Pastes graphic media files or clipboard blocks into the prompt. |
| **`Ctrl+O`** | `view.toggle_trajectory` | Expands or collapses detailed tool reasoning outputs. |
| **`Ctrl+R`** | `view.review_artifact` | Opens the Artifact Review panel. |
| **`Ctrl+G`** | `edit.open_editor` | Launches your default `$EDITOR` shell to compose your prompt. |
| **`Alt+J`** | `subagent.jump_to_waiting` | Instantly switches focus to the next subagent awaiting confirmation. |
| **`Ctrl+K`** | `subagent.approve_fast` | Instantly approves the pending subagent action listed in the status alert. |
| **`Ctrl+A`** | `—` | Moves the prompt insertion cursor to the beginning of the line. |
| **`Ctrl+E`** | `—` | Moves the prompt insertion cursor to the end of the line. |
| **`Ctrl+_`** / **`Ctrl+Shift+-`** | `edit.undo` | Reverts the last edit. |
| **`Ctrl+Shift+Z`** | `edit.redo` | Redoes the last undone text operation. |
| **`Ctrl+D`** | `—` | Forward delete (only when the prompt box is non-empty). |
| **`F5`** | `voice.start_dictation` | Starts or stops [voice dictation](/docs/cli/commands/voice). |

### Navigation and scrolling

[Section titled “Navigation and scrolling”](#navigation-and-scrolling)

These keys are active inside select panels, menus, and scrollable text boxes.

| Key | TUI Command | Action Behavior |
| --- | --- | --- |
| **`↑`** / **`↓`** | `navigation.up` / `navigation.down` | Scrolls highlighted selections up or down by one item. |
| **`PgUp`** / **`Shift+↑`** | `navigation.page_up` / `navigation.half_page_up` | Scrolls the active text viewport up by one page block. |
| **`PgDn`** / **`Shift+↓`** | `navigation.page_down` / `navigation.half_page_down` | Scrolls the active text viewport down by one page block. |
| **`←`** / **`→`** | `navigation.left` / `navigation.right` | Swaps pages inside multipage structures (like the Session Picker). |
| **`Tab`** | `navigation.tab` | Confirms the highlighted slash-command autofill option. |

### Tool confirmations

[Section titled “Tool confirmations”](#tool-confirmations)

These keys are active during confirmation prompts.

| Key | TUI Command | Action Behavior |
| --- | --- | --- |
| **`y`** | `confirm.yes` | Authorizes the proposed tool, command, or active artifact. |
| **`n`** | `confirm.no` | Rejects the proposed tool, command, or active artifact. |
| **`A`** | `—` | (Inside Review panel) Approves all generated artifacts in one action (built-in shortcut). |

## Command-line flags

[Section titled “Command-line flags”](#command-line-flags)

Pass startup flags when launching `agy` to configure the session or run non-interactively:

| Flag | Default | Description |
| --- | --- | --- |
| **`--mode`** | `""` | Set the agent [execution mode](/docs/cli/modes) for this session: `accept-edits`, `auto` (Preview; `v1.3.5+` on macOS and Linux, `v1.4.4+` on Windows; requires the terminal sandbox; not available for business or enterprise accounts), or `plan`. |
| **`--model`** | — | Select the model for the current CLI session (refer to `agy models`). |
| **`--effort`** | — | Set the [reasoning effort](/docs/cli/commands/effort) for the current CLI session (`low` through `max`, depending on the model). |
| **`--agent`** | — | Select the agent for the current CLI session (refer to `agy agents`). |
| **`--add-dir`** | `[]` | Add a directory to the workspace (repeatable). |
| **`-c`**, **`--continue`** | `false` | Continue the most recent conversation. |
| **`--conversation`** | — | Resume a previous conversation by ID. |
| **`-i`**, **`--prompt-interactive`** | — | Run an initial prompt interactively and continue the session. |
| **`-p`**, **`--print`**, **`--prompt`** | — | Run a single prompt non-interactively in [headless mode](/docs/cli/headless) and print the response. |
| **`--output-format`** | `text` | Output format for print mode (`text`, `json`, `stream-json`). |
| **`--input-format`** | `text` | Input format for print mode (`text`, `stream-json`). |
| **`--json-schema`** | — | JSON schema string or path to a schema file to enforce structured output in print mode. |
| **`--print-timeout`** | `0s` | Optional time limit for print mode (`0` waits until the turn completes). |
| **`--disable-slash-commands`** | `false` | Disable slash command and skill expansion in print mode. |
| **`--sandbox`** | `false` | Run in a terminal sandbox with OS containment restrictions enabled (in `v1.4.4+`, no effect if the sandbox isn’t available on your machine). |
| **`--dangerously-skip-permissions`** | `false` | Auto-approve all tool permission requests without prompting. |
| **`--remote-control`** | `false` | Create a [Remote Control](/docs/remote-control?tab=cli) connection for the CLI session on startup. |
| **`--project`** | — | Project ID or project name for the current CLI session. |
| **`--new-project`** | `false` | Create a new project for this session. |
| **`--log-file`** | — | Override the CLI log file path. |

## Configuration keys (`settings.json`)

[Section titled “Configuration keys (settings.json)”](#configuration-keys-settingsjson)

This section lists every key you can set in `~/.gemini/antigravity-cli/settings.json`, with its type and default. A key you leave out uses its default. For how the CLI reads and saves the file, and for the keys that take an object, refer to [CLI settings](/docs/settings?tab=cli).

### Example `settings.json`

[Section titled “Example settings.json”](#example-settingsjson)

```
{
    "agentMode": "auto",
    "colorScheme": "tokyo night",
    "altScreenMode": "always",
    "toolPermission": "proceed-in-sandbox",
    "notifications": true,
    "enableTerminalSandbox": true
}
```

To get autocomplete and validation in editors such as VS Code, add `"$schema": "https://antigravity.google/schemas/v1/settings.json"` at the top of the file. For details, refer to [Editor autocomplete and validation](/docs/settings?tab=cli#editor-autocomplete-and-validation).

| Option Key Name | Value Type | System Default | Parameter Characteristics & Options |
| --- | --- | --- | --- |
| **`agentMode`** | string | `""` (default mode) | Default startup [execution mode](/docs/cli/modes): `""` (standard `default` mode), `"accept-edits"` (auto-approve workspace file edits), `"auto"` (Preview; `v1.3.5+` on macOS and Linux, `v1.4.4+` on Windows; requires the terminal sandbox; auto-approves edits, runs commands in the terminal sandbox by default, and automatically checks any command that needs to run outside the sandbox so safe, reversible commands run without prompting while irreversible actions still prompt; not available for business or enterprise accounts), or `"plan"` (research and outline steps before writing code). Can be overridden per session with `--mode`. |
| **`colorScheme`** | string | `"terminal"` | Color theme: `"light"`, `"solarized light"`, `"colorblind-friendly light"`, `"dark"`, `"solarized dark"`, `"colorblind-friendly dark"`, `"tokyo night"`, or `"terminal"` (inherits native shell colors). |
| **`altScreenMode`** | string | `"default"` | Screen buffer usage: `"default"` (renders the conversation inline and opens full-screen views in the alternate screen), `"always"` (runs the whole TUI in the alternate screen), or `"never"` (never uses the alternate screen; available only in `settings.json`). |
| **`toolPermission`** | string | `"request-review"` | Global safety presets: `"request-review"` (prompts for write, bash, web, and MCP tools unless an allow rule covers them), `"proceed-in-sandbox"` (runs terminal commands without prompting when the sandbox is on and the command runs inside it; in `v1.4.4+`, behaves like `"request-review"` if the sandbox isn’t available), `"always-proceed"` (runs commands, web requests, and MCP tools without prompting unless an ask or deny rule matches), or `"strict"` (prompts before every tool action, including file reads, even if an allow rule matches). Deny rules apply in every mode. |
| **`artifactReviewPolicy`** | string | `"asks-for-review"` | Whether the agent waits for your review when it asks for feedback on an artifact, such as an implementation plan: `"asks-for-review"` (always waits), `"agent-decides"` (currently the same as `"asks-for-review"`), or `"always-proceed"` (never waits). Doesn’t affect file edits. |
| **`notifications`** | boolean | `false` | Rings the terminal bell and shows a desktop notification when the agent needs your approval or an answer, or finishes its turn. |
| **`showTips`** | boolean | `true` | Displays helpful usage tips while the agent is generating responses. |
| **`showFeedbackSurvey`** | boolean | `true` | Displays periodic quality feedback surveys upon active task completions. |
| **`editor`** | string | `"auto"` | External editor for opening artifacts and files and for composing prompts (`Ctrl+G`): `"auto"` (uses `$EDITOR`, then falls back to `vim`, or to `edit` and `notepad` on Windows), `"vim"`, `"emacs"`, or any other editor command. |
| **`editorMode`** | string | `"default"` | Prompt editing model: `"default"` (flat text editing) or `"vim"` (modal editing). Distinct from `editor`, which selects an external program. Refer to [Vim editor mode](/docs/cli/vim-editor-mode). |
| **`vimInsertFirst`** | boolean | `false` | Starts Vim editing in Insert mode and makes a bare `Enter` submit. Requires `editorMode` set to `"vim"`. |
| **`allowNonWorkspaceAccess`** | boolean | `false` | Lets the agent read and edit files outside your workspace folders, subject to `toolPermission`, `agentMode`, and your permission rules. |
| **`enableTerminalSandbox`** | boolean | `false` | Restricts all local execution commands launched by agents to OS containment rings (in `v1.4.4+`, no effect if the sandbox isn’t available on your machine). |
| **`useG1Credits`** | boolean | `false` | Uses your AI credits for model requests after your plan’s quota runs out. Not available for business accounts. |
| **`verbosity`** | string | `"medium"` | Visual verbosity level: `"high"` (renders every tool call, command, and thought in full), `"medium"` (groups related tool calls and thoughts into summaries while keeping commands and responses visible), or `"low"` (renders only responses and collapses tool activity into a token usage summary). |
| **`runningLightSpeed`** | string | `"medium"` | Visual running light progress animation speed: `"fast"`, `"medium"`, `"slow"`, or `"off"`. |
| **`copyOnSelect`** | boolean | `true` | In alt-screen mode, copies text to the clipboard when you release a mouse selection. When `false`, the artifact viewer uses your terminal’s own text selection. |
| **`hideActiveItems`** | boolean | `false` | Hides the list of active subagents and background tasks below the prompt box (**Show Active Tasks** in `/config`). |
| **`pickerGrouping`** | string | `"none"` | How the [`/resume`](/docs/cli/commands/resume) picker lists conversations: `"none"` (one list, most recent first) or `"grouped"` (grouped by workspace). |
| **`queuedMessages`** | string | `"queue"` | What happens to a message you send while the agent is working: `"queue"` (held until the current turn ends) or `"send-immediately"` (interrupts the agent and sends it right away). |
| **`clearScrollbackOnResize`** | boolean | `true` | In inline rendering, clears your terminal’s scrollback when the CLI redraws the conversation, such as after you resize the window. |
| **`disableSlashCommands`** | boolean | `false` | In [headless mode](/docs/cli/headless) (`-p`), sends prompts that start with `/` as typed instead of running slash commands or skills. Same as `--disable-slash-commands`. |
| **`historySize`** | integer | `2000` | Prompt history entries kept on disk, trimmed when the CLI exits: `-1` keeps every entry, and `0` clears the history. |
| **`model`** | string | `""` | The model you chose with `/model`, saved by its label. |
| **`modelProvider`** | string | `""` | `"gemini"` sends model requests directly to the Gemini API with the key in `GEMINI_API_KEY` ([Using a Gemini API key](/docs/install#using-a-gemini-api-key)). |
| **`trustedWorkspaces`** | string[] | `[]` | Folders you chose to trust when the CLI asked. The CLI adds entries for you. |
| **`useTerminalCursor`** | boolean | `false` | Uses your terminal’s own cursor shape instead of a block cursor. |
| **`permissions`** | object | — | Allow, ask, and deny rules for the agent’s tools. Refer to [`permissions`](/docs/settings?tab=cli#permissions). |
| **`statusLine`** | object | — | Custom status line script. Refer to [`statusLine` and `title`](/docs/settings?tab=cli#statusline-and-title). |
| **`title`** | object | — | Custom terminal title script. Refer to [`statusLine` and `title`](/docs/settings?tab=cli#statusline-and-title). |
| **`sandboxProxy`** | object | — | HTTP proxy for sandboxed terminal commands. Refer to [`sandboxProxy`](/docs/settings?tab=cli#sandboxproxy). |
| **`customModelsConfig`** | object | — | Extra models for the Gemini API key setup. Refer to [`customModelsConfig` and `gcp`](/docs/settings?tab=cli#custommodelsconfig-and-gcp). |
| **`gcp`** | object | — | Saved by the **Use a Google Cloud project** sign-in. Refer to [`customModelsConfig` and `gcp`](/docs/settings?tab=cli#custommodelsconfig-and-gcp). |

**Enable Telemetry** in `/config` has no `settings.json` key: the CLI saves that choice with your account.

## Next steps

[Section titled “Next steps”](#next-steps)

Learn how to safely deploy permission policies, sandboxes, and customize plugins:

* **[CLI settings](/docs/settings?tab=cli)**: Use the interactive `/config` panel, choose a rendering mode, and see how the CLI reads and saves `settings.json`.
* **[Permissions and sandbox](/docs/sandbox?tab=cli)**: Enforce command-line containment rules.
* **[Plugins and skills](/docs/plugins?tab=cli)**: Create your own custom skills slash commands.
* **[Installation and auth](/docs/install)**: Update your CLI installation.

[Previous
Eclipse](/docs/ide/extensions/eclipse/)[Next
CLI features](/docs/features?tab=cli#antigravity-cli-features)

[About Google](https://about.google/)[Google Products](https://about.google/products/)[Privacy](https://policies.google.com/privacy?hl=en-US)[Terms](/terms)Manage cookies

Your download has started

## How did you hear about us?

Pick one. It helps us reach more people like you.

Search engineAI assistantYouTubeX (Twitter)LinkedInRedditHacker NewsFriend or colleagueNews or blogEvent or conferenceAnother Google productOther

Skip

Thanks for letting us know!
