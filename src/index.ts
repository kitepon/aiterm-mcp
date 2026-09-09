#!/usr/bin/env node
/**
 * aiterm-mcp — AI が握るローカル永続端末を stdio MCP サーバとして公開する（Node/TS 版）。
 *
 * Linux/WSL2/mac/Windows native のローカルで動かし、握るのはローカル端末1個。リモートは
 * pty_send "ssh ..." で中に入る（ネスト）。バックエンドは tmux（Windows native は tmux CLI
 * 互換の psmux）。ロジックは core.ts に集約。
 *
 * 重要: stdio MCP は stdout が JSON-RPC 専用。診断は stderr/console.error のみ（console.log 禁止）。
 * 起動: npx -y aiterm-mcp（または mcp 登録のコマンドに同じ）。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as core from "./core.js";
import { runtimeErrorStoreDiagnostic } from "./runtime-error-store.js";
import { createRequire } from "node:module";

// package.json の version を実行時に読み、MCP initialize で配るサーバ版と一致させる。
// createRequire を使うのは、import 属性 `with { type: "json" }` が Node 18.20+ 限定で
// engines "node >=18"（18.0〜18.19）を SyntaxError で壊し、旧 `assert` 構文は逆に Node 22 で
// 除去済み＝どちらの静的構文も 18〜22 全域を満たせないため（実行時 require が唯一全域で動く）。
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

const server = new McpServer({ name: "aiterm", version: pkg.version });

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/**
 * dispatch 系の説明で共有する非ブロック規範。tool description は registerTool 時＝initialize 前に
 * 固定されるため親ホストを名指しできない（ホスト別の具体形は receipt 側が core.agentWaitLaunchForm で出す）。
 * ここでは「待つな」を断定形で先に置き、foreground 実行の禁止までを説明の側に含める。
 */
const NON_BLOCKING_RULE =
  "dispatch した子は投げっぱなしでよい＝親はここで待たない。" +
  "完了通知はreceiptの `wait_process.executable` と `wait_process.args` をそのまま親のターンを塞がない別プロセスAPIへ渡して受け、" +
  "PowerShell 7のStart-Processだけは `windows_start_process_argument_list` を単一文字列として渡す。" +
  `exit を完了通知として扱う（${core.AITERM_WAIT_OUTCOME_NOTE}。ポーリング不要）。` +
  "`wait_command` は人間向け互換表示でありprocess境界へ使わない。foreground実行で親のターンを塞がない。";

const waitProcessOutputSchema = z
  .object({
    executable: z.string(),
    args: z.array(z.string()),
    windows_start_process_argument_list: z.string().nullable(),
  })
  .nullable();

function ok(s: string): ToolResult {
  return { content: [{ type: "text", text: s }] };
}
function fail(e: unknown): ToolResult {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: "aiterm: " + msg }], isError: true };
}

/**
 * Factory 向けの read-only 診断。JSON の field は意図的に allowlist 制で、絶対 path、環境変数、
 * token、コマンド本文、PTY 出力、raw log、認証状態を公開しない。
 */
async function factoryDiagnostics(): Promise<string> {
  const ptyList = core.readOnlyPtyListDiagnostic();
  const claude = core.harnessLauncherDiagnostic("claude");
  const codex = core.harnessLauncherDiagnostic("codex");
  const grok = core.harnessLauncherDiagnostic("grok");
  const cursor = core.harnessLauncherDiagnostic("cursor");
  const runtimeErrors = await runtimeErrorStoreDiagnostic();
  const overall = ptyList.status === "unverified" || runtimeErrors.status === "unverified" ? "unverified" : "ready";
  return JSON.stringify({
    diagnostic_schema: "aiterm-mcp.factory-diagnostics.v1",
    version: pkg.version,
    overall,
    mcp: { transport: "stdio", initialize: "ready", tool_call: "ready" },
    pty_list: { access: "read_only", ...ptyList },
    runtime_error_store: runtimeErrors,
    vendor_dependencies: {
      claude: {
        status: claude,
        optional: true,
        required_for: ["claude_agent"],
      },
      codex: {
        status: codex,
        optional: true,
        required_for: ["codex_agent"],
      },
      grok: {
        status: grok,
        optional: true,
        required_for: ["grok_agent", "composer_agent"],
      },
      cursor: {
        status: cursor,
        optional: true,
        required_for: ["agent_launch"],
      },
    },
  });
}

server.registerTool(
  "diagnostics",
  {
    description:
      "Factory 向け read-only 診断。安全な状態語彙だけを機械可読 JSON で返す（PTY 内容・認証情報・path・環境値は返さない）。",
    inputSchema: {},
  },
  async () => ok(await factoryDiagnostics()),
);

const DEFAULT_PTY_SHELL = process.platform === "win32" ? "pwsh" : "bash";

server.registerTool(
  "pty_open",
  {
    description:
      "ローカル永続端末（POSIXはtmux、Windows nativeはpsmux 3.3.8以上）を1個開き、session_id を返す。backend server常駐ゆえ本サーバや " +
      "クライアントが再起動してもセッションは生存する。リモート操作は専用ツールにせず、開いた端末の中で " +
      'pty_send(session_id, "ssh host") と打って入る。',
    inputSchema: {
      name: z.string().nullish().describe("セッション名（省略時は t1, t2... を自動採番）"),
      shell: z.string().default(DEFAULT_PTY_SHELL).describe(`起動シェル（既定 ${DEFAULT_PTY_SHELL}）`),
      env_vars: z.array(z.string()).optional().describe("現在のMCP processからsessionへ継承する環境変数名"),
    },
  },
  async ({ name, shell, env_vars }) => {
    try {
      const [sid, hint] = core.openSession(name ?? null, shell, env_vars);
      return ok(`session_id: ${sid}\n${hint}`);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "pty_send",
  {
    description:
      "セッションへテキストを送る。通常PTYへは送信のみ（出力は pty_read で取得）。" +
      "agent session（launcher起動）への send は自動で dispatch になる: TUI の ready gate と submit 分離を通して即返り、" +
      "receipt の event_cursor を返す。" +
      NON_BLOCKING_RULE +
      "結果回収は pty_read(agent_transcript:true)、Claude の durable turn は claude_turn を使う。" +
      "force:true は非Claude agent sessionへの手動介入用の素送信。aiterm相関付きClaudeの承認UIはclaude_approvalを使う。",
    inputSchema: {
      session_id: z.string(),
      text: z
        .string()
        .describe("送る文字列（コマンド／prompt）。UTF-8で最大64KiB"),
      enter: z.boolean().default(true).describe("末尾で Enter を送る（agent dispatch では常に submit）"),
      mark: z
        .boolean()
        .default(false)
        .describe(
          "完了 sentinel(終了コード付き)で包む。pty_read(wait:true) が until 無しでも自動検出して" +
            "完了確定する（POSIX shell と PowerShell に対応。SSH先の現在の標準PS promptも自動判定。PowerShell の rc は成功0／失敗1。" +
            "fish/csh/tcsh は未対応として送信前に拒否）。" +
            " enter:false と併用すると sentinel が実行されず完了検出が発火しない（送信後に pty_key(\"Enter\") で実行される）。",
        ),
      force: z
        .boolean()
        .default(false)
        .describe("非Claude agent sessionでは自動dispatchせず素送信する。aiterm相関付きClaudeのactive turnには使えない"),
      rtk: z.boolean().default(false).describe("既知コマンドを rtk 形へ委譲して送る（rtk 不在なら素通し）"),
      raw: z.boolean().default(false).describe("送信前サニタイズを無効化"),
      image: z
        .array(z.string())
        .optional()
        .describe(
          "添付する画像ファイルの絶対パス（png/jpg/jpeg/gif/webp）。agent session への dispatch だけで使え、" +
            "harness別の添付手順はaitermが吸収する。通常PTY送信やforce送信では指定できない",
        ),
    },
    outputSchema: {
      schema: z.literal("aiterm.pty-send-result.v1"),
      mode: z.enum(["sent", "agent_dispatch"]),
      session_id: z.string(),
      event_cursor: z.number().int().nullable(),
      wait_process: waitProcessOutputSchema,
      launch_id: z.string().nullable(),
      vendor: z.enum(["claude", "codex", "grok", "composer", "cursor"]).nullable(),
      harness: z.enum(["claude-code", "codex-cli", "grok-cli", "cursor-cli"]).nullable(),
      // dispatch後のsubmit座礁観測（additive）。true=composerに送信textの残存を確認（submit未成立の疑い）/
      // false=残存を観測せず（成立の保証ではない）/ null=通常送信・判定不能。
      submit_residue: z.boolean().nullable(),
      // dispatch前に行った pane 入力の回復（"fg" / "fg_stopped" / "stty_raw"）。通常送信では省略（additive）。
      pane_input_recovery: z.array(z.string()).optional(),
    },
  },
  async ({ session_id, text, enter, mark, force, rtk, raw, image }) => {
    try {
      if (!force && core.isAgentSession(session_id)) {
        if (enter === false) throw new Error("agent session への dispatch は enter:false と併用できません（手動介入は force:true）");
        if (mark) throw new Error("agent session への dispatch は mark:true と併用できません");
        if (rtk) throw new Error("agent session への dispatch は rtk:true と併用できません");
        const receipt = await core.dispatchAgentTurn(session_id, core.attachImages(text, image), { raw });
        const waitProcess = core.agentWaitProcess(receipt.session_id, receipt.event_cursor);
        return {
          content: [
            {
              type: "text" as const,
              text:
                `dispatchした（harness=${receipt.harness}, vendor=${receipt.vendor}）。\n` +
                core.agentDispatchGuide(receipt.session_id, receipt.event_cursor) +
                core.agentSubmitResidueWarning(receipt.session_id, receipt.submit_residue),
            },
          ],
          structuredContent: {
            schema: "aiterm.pty-send-result.v1" as const,
            mode: "agent_dispatch" as const,
            session_id: receipt.session_id,
            event_cursor: receipt.event_cursor,
            wait_process: waitProcess,
            launch_id: receipt.launch_id,
            vendor: receipt.vendor,
            harness: receipt.harness,
            submit_residue: receipt.submit_residue,
            pane_input_recovery: receipt.pane_input_recovery,
          },
        };
      }
      if (image && image.length > 0) {
        throw new Error("image は agent session への dispatch（forceなし）だけで使えます。通常PTY送信では本文にpathを書いてください");
      }
      const out = core.send(session_id, text, { enter, mark, force, rtk, raw });
      return {
        content: [{ type: "text" as const, text: out }],
        structuredContent: {
          schema: "aiterm.pty-send-result.v1" as const,
          mode: "sent" as const,
          session_id,
          event_cursor: null,
          wait_process: null,
          launch_id: null,
          vendor: null,
          harness: null,
          submit_residue: null,
        },
      };
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "agent_steer",
  {
    description:
      "実行中のCodex/Grok agentへ追加メッセージを差し込み、現在のターンを誘導する。" +
      "独立した次ターンを始める用途ではなく、idle時は文字を送らずdelivery=idleを返す。",
    inputSchema: {
      session_id: z.string(),
      text: z.string().describe("現在のターンへ追加する文字列。UTF-8で最大64KiB"),
      image: z.array(z.string()).optional().describe("添付する画像ファイルの絶対パス（png/jpg/jpeg/gif/webp）"),
    },
    outputSchema: {
      schema: z.literal("aiterm.agent-steer.v1"),
      session_id: z.string(),
      launch_id: z.string(),
      vendor: z.enum(["codex", "grok", "composer"]),
      harness: z.enum(["codex-cli", "grok-cli"]),
      delivery: z.enum(["steered", "idle"]),
    },
  },
  async ({ session_id, text, image }) => {
    try {
      const receipt = await core.steerAgentTurn(session_id, core.attachImages(text, image));
      return {
        content: [{ type: "text" as const, text: `${receipt.delivery} ${receipt.session_id}` }],
        structuredContent: receipt,
      };
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "pty_read",
  {
    description:
      "セッションの出力をトークン削減して読む（既定は前回読取位置からの増分）。" +
      "削減: 制御文字除去 / 反復圧縮 / head+tail 折りたたみ＋復元ヒント＋メタ併記。" +
      "agent_transcript:true は agent session の直近完了ターンの最終 assistant メッセージを公開されたharness記録から平文で返す。" +
      "長い回答が screen tail で切れた時の回収用。",
    inputSchema: {
      session_id: z.string(),
      wait: z
        .boolean()
        .default(false)
        .describe("完了まで待つ（dead / mark sentinel 自動検出 / until / 出力静止∧シェル復帰 / timeout）"),
      until: z
        .string()
        .nullish()
        .describe("この文字列が出たら完了とみなす（既定はリテラル部分一致。`$ ` や `[..]` もそのまま探せる）"),
      until_regex: z
        .boolean()
        .default(false)
        .describe("until を正規表現として扱う（既定 false＝リテラル部分一致。メタ文字を使いたい時のみ true）"),
      timeout: z.number().default(10).describe("wait の最大待ち秒数"),
      screen: z.boolean().default(false).describe("描画済みスクリーン(TUI 向け)"),
      full: z.boolean().default(false).describe("増分でなく全文"),
      lines: z.number().int().nullish().describe("末尾 N 行のみ"),
      line_range: z.string().nullish().describe('全文からの行範囲 "A:B"'),
      raw: z.boolean().default(false).describe("削減せず生テキスト"),
      rtk: z.boolean().default(false).describe("直前コマンド別の自前 reducer(git/grep/pytest 等)で縮約"),
      agent_transcript: z
        .boolean()
        .default(false)
        .describe("agent session の直近完了ターンの最終 assistant メッセージを返す。Claudeはlaunch相関付きStop hook result、他harnessは通常transcript／session historyを使う。長い回答がscreen tailで切れた時の回収用"),
      operation_id: z
        .string()
        .regex(/^sha256:[0-9a-f]{64}$/)
        .nullish()
        .describe("Claude operationの期待ID。agent_transcript:true時だけ指定し、古い別operationの結果を拒否する"),
    },
    outputSchema: {
      schema: z.literal("aiterm.pty-read-result.v1"),
      mode: z.enum(["terminal", "agent_transcript"]),
      session_id: z.string(),
      text: z.string(),
      vendor: z.enum(["claude", "codex", "grok", "composer", "cursor"]).nullable(),
      turn_id: z.string().nullable(),
      harness: z.enum(["claude-code", "codex-cli", "grok-cli", "cursor-cli"]).nullable(),
      raw_chars: z.number().int().nonnegative().nullable(),
    },
  },
  async ({ session_id, wait, until, until_regex, timeout, screen, full, lines, line_range, raw, rtk, agent_transcript, operation_id }) => {
    try {
      if (agent_transcript) {
        if (screen || full || rtk || wait || line_range != null) {
          throw new Error("agent_transcript:true は screen / full / rtk / line_range / wait と併用できません。lines のみ指定できます。");
        }
        const result = await core.readAgentTranscriptResult(session_id, {
          lines: lines ?? null,
          operation_id: operation_id ?? null,
        });
        return {
          content: [{ type: "text" as const, text: result.display }],
          structuredContent: {
            schema: "aiterm.pty-read-result.v1" as const,
            mode: "agent_transcript" as const,
            session_id,
            text: result.text,
            vendor: result.vendor,
            turn_id: result.turn_id,
            harness: result.harness,
            raw_chars: result.raw_chars,
          },
        };
      }
      if (operation_id != null) throw new Error("operation_idはagent_transcript:true時だけ指定できます");
      let range: [number, number | null] | null = null;
      if (line_range) {
        const idx = line_range.indexOf(":");
        const lo = idx < 0 ? line_range : line_range.slice(0, idx);
        const hi = idx < 0 ? "" : line_range.slice(idx + 1);
        // 不正/空/負の上端は「末尾まで」(null) に倒す。"5:abc" を空に潰さず "5:" と同じく 5 行目以降に。
        // 下端は負値を 0 にクランプする（"-3:5" が負 slice にならないように・C12）。
        const loN = Math.max(0, parseInt(lo, 10) || 0);
        const hiN = hi ? parseInt(hi, 10) : NaN;
        const upper = Number.isNaN(hiN) || hiN < 0 ? null : hiN;
        if (upper !== null && upper < loN) {
          throw new Error(`line_range ${JSON.stringify(line_range)} が不正です: 上端が下端より小さい`);
        }
        range = [loN, upper];
      }
      const out = await core.readOutput(session_id, {
        wait,
        until: until ?? null,
        untilRegex: until_regex,
        timeout,
        screen,
        full,
        lines: lines ?? null,
        range,
        raw,
        rtk,
      });
      return {
        content: [{ type: "text" as const, text: out }],
        structuredContent: {
          schema: "aiterm.pty-read-result.v1" as const,
          mode: "terminal" as const,
          session_id,
          text: out,
          vendor: null,
          turn_id: null,
          harness: null,
          raw_chars: null,
        },
      };
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "pty_key",
  {
    description: "制御キーを送る（C-c, C-d, Enter, Tab, Up, Down... の別名に対応）。aiterm相関付きClaude sessionではturn相関を守るためC-cだけを許可し、承認UIはclaude_approvalで操作する。",
    inputSchema: {
      session_id: z.string(),
      key: z.string().describe('キー名（例 "C-c", "Enter", "Up"）'),
    },
  },
  async ({ session_id, key }) => {
    try {
      return ok(core.sendKey(session_id, key));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "pty_close",
  {
    description:
      "セッションを閉じ、ログ／読取位置を破棄する。同じsession_idへの再試行は安全で、" +
      "closed／already_closedのstructured receiptを返す。",
    inputSchema: { session_id: z.string() },
    outputSchema: {
      schema: z.literal("aiterm.pty-close-result.v1"),
      session_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      outcome: z.enum(["closed", "already_closed"]),
    },
  },
  async ({ session_id }) => {
    try {
      const result = core.closeSessionResult(session_id);
      return {
        content: [{ type: "text" as const, text: `closed ${session_id}` }],
        structuredContent: { ...result },
      };
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "pty_list",
  {
    description: "握っているセッション一覧（名前 / 現在の前面コマンド / attach 状態 / サイズ / agent 情報）。",
    inputSchema: {
      env_keys: z.array(z.string()).optional().describe("帰属確認用の非秘密環境変数名。指定したキーだけを返す"),
    },
    outputSchema: {
      schema: z.literal("aiterm.pty-list-result.v1"),
      observed_at: z.string(),
      sessions: z.array(z.object({
        session_id: z.string(), current_command: z.string(), attached: z.boolean(),
        width: z.number(), height: z.number(),
        harness: z.enum(["claude-code", "codex-cli", "grok-cli", "cursor-cli"]).nullable(),
        environment: z.record(z.string(), z.string().nullable()),
      })),
    },
  },
  async ({ env_keys }) => {
    try {
      const result = core.listSessionsResult(env_keys);
      return { ...ok(core.listSessions(result)), structuredContent: { ...result } };
    } catch (e) {
      return fail(e);
    }
  },
);

const nativeProcessIdentitySchema = z.object({
  pid: z.number().int(), process_group_id: z.number().int().nullable(),
  started_identity: z.string(), argv_digest: z.string(),
});

server.registerTool(
  "pty_observe",
  {
    description: "指定sessionの存在、paneとharnessの生存、状態と理由、native process identity、画面変化とCPU活動を構造化して観測する。画面本文と生argvは返さない。",
    inputSchema: {
      session_id: z.string(),
      cursor: z.string().optional().describe("前回のactivity.cursor。省略・session再作成時は活動差分をnullで返す"),
    },
    outputSchema: {
      schema: z.literal("aiterm.pty-observe-result.v1"), session_id: z.string(), observed_at: z.string(),
      exists: z.boolean(), harness: z.enum(["claude-code", "codex-cli", "grok-cli", "cursor-cli"]).nullable(),
      launch_id: z.string().nullable(), state: z.enum(["busy", "idle", "blocked", "dead", "missing", "unknown"]),
      reason: z.string(), pane_alive: z.boolean().nullable(), harness_alive: z.boolean().nullable(),
      pane_process: nativeProcessIdentitySchema.nullable(), harness_process: nativeProcessIdentitySchema.nullable(),
      process_identity: nativeProcessIdentitySchema.nullable(),
      token_hint: z.number().nullable(),
      activity: z.object({ cursor: z.string().nullable(), output_changed: z.boolean().nullable(),
        cpu_seconds: z.number().nullable(), cpu_delta_seconds: z.number().nullable(), cpu_delta_complete: z.boolean().nullable(),
        background_cpu_seconds: z.number().nullable(), background_cpu_delta_seconds: z.number().nullable(), background_cpu_delta_complete: z.boolean().nullable() }),
    },
  },
  async ({ session_id, cursor }) => {
    try {
      const result = core.observeSession(session_id, cursor);
      return { ...ok(JSON.stringify(result)), structuredContent: { ...result } };
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  "agent_approval",
  {
    description: "Codexの現在の承認をinspectし、digestへ束縛した単発許可または拒否をrespondする。恒久許可は選ばない。Claudeは既存claude_approvalを使う。未知dialogはblockedのtyped errorで返す。",
    inputSchema: {
      action: z.enum(["inspect", "respond"]), session_id: z.string(),
      approval_choice: z.enum(["approve_once", "deny"]).optional(), observed_prompt_digest: z.string().optional(),
    },
    outputSchema: {
      schema: z.literal("aiterm.agent-approval-result.v1"), action: z.enum(["inspect", "respond"]),
      status: z.enum(["none", "approval_required", "submitted", "blocked"]), session_id: z.string(),
      harness: z.enum(["claude-code", "codex-cli", "grok-cli", "cursor-cli"]), launch_id: z.string(),
      reason: z.string(), kind: z.string().nullable(), prompt: z.string().nullable(), prompt_digest: z.string().nullable(),
      choices: z.array(z.object({ decision: z.enum(["approve_once", "deny"]), label: z.string() })),
      selected_choice: z.enum(["approve_once", "deny"]).nullable(), at: z.string(),
    },
  },
  async (options) => {
    try {
      const result = core.runAgentApproval(options);
      return { ...ok(JSON.stringify(result)), structuredContent: { ...result }, ...(result.status === "blocked" ? { isError: true } : {}) };
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  "claude_turn",
  {
    description:
      "aiterm相関付きClaude sessionのdurable operationを構造化issue／recoverするmachine-caller専用面。" +
      "pending／unknown／completedを人間向けerror文字列の解析なしで返し、Observer固有ロジックは持たない。",
    inputSchema: {
      action: z.enum(["issue", "recover"]),
      session_id: z.string(),
      operation_id: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      text: z.string().optional().describe("issueだけに指定するbounded turn本文"),
    },
    outputSchema: {
      schema: z.literal("aiterm.claude-operation-result.v1"),
      action: z.enum(["issue", "recover"]),
      status: z.enum(["accepted", "pending", "completed", "unknown"]),
      session_id: z.string(),
      operation_id: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      raw_output: z.string().nullable(),
      reason: z.enum(["operation_not_found", "result_unknown"]).nullable(),
      // issue時のみdispatch由来のsubmit座礁観測（additive）。true=composerに残存を確認（submit未成立の疑い）/
      // false=残存を観測せず（成立の保証ではない）/ recover等はnull。
      submit_residue: z.boolean().nullable(),
    },
  },
  async ({ action, session_id, operation_id, text }) => {
    try {
      const result = await core.runClaudeOperation({
        action,
        session_id,
        operation_id,
        text: text ?? undefined,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: { ...result },
      };
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "claude_approval",
  {
    description:
      "aiterm相関付きClaudeのactive turn中に表示された権限確認UIを、turn相関を保ったまま検査・応答する専用面。" +
      "inspectで画面digestと安全な単発Yes/Noだけを取得し、respondは同じoperation・同じdigestが現在も表示中の場合だけ送信する。",
    inputSchema: {
      action: z.enum(["inspect", "respond"]),
      session_id: z.string(),
      operation_id: z
        .string()
        .regex(/^sha256:[0-9a-f]{64}$/)
        .nullish()
        .describe("durable operationのID。通常pty_send由来の匿名turnでは省略する"),
      approval_choice: z.enum(["approve_once", "deny"]).optional().describe("respondだけに指定する"),
      observed_prompt_digest: z
        .string()
        .regex(/^sha256:[0-9a-f]{64}$/)
        .optional()
        .describe("直前のinspectが返したdigest。respondだけに指定する"),
    },
    outputSchema: {
      schema: z.literal("aiterm.claude-approval-result.v1"),
      action: z.enum(["inspect", "respond"]),
      status: z.enum(["approval_required", "submitted"]),
      session_id: z.string(),
      operation_id: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
      prompt_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      choices: z.array(z.object({
        decision: z.enum(["approve_once", "deny"]),
        index: z.number().int().positive(),
        label: z.string(),
      })),
      selected_choice: z.enum(["approve_once", "deny"]).nullable(),
      at: z.string(),
    },
  },
  async ({ action, session_id, operation_id, approval_choice, observed_prompt_digest }) => {
    try {
      const result = core.runClaudeApproval({
        action,
        session_id,
        operation_id: operation_id ?? null,
        approval_choice,
        observed_prompt_digest,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: { ...result },
      };
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "agent_configure",
  {
    description:
      "起動済みのClaude／Codex／Grok／Composer／Cursor agent sessionを再起動せず、会話contextを保ったままmodel／reasoning effortを変更する。" +
      "各harnessのCLI標準model操作を使う。Cursorのreasoning_effort変更はmodelと同時指定する。",
    inputSchema: {
      session_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      model: z.string().min(1).nullish().describe("変更後のmodel。省略時はmodelを変更しない"),
      reasoning_effort: z.string().min(1).nullish().describe("変更後のreasoning effort。省略時はeffortを変更しない"),
    },
    outputSchema: {
      schema: z.literal("aiterm.agent-configure-result.v1"),
      session_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      provider: z.enum(["claude", "codex", "grok", "composer", "cursor"]),
      harness: z.enum(["claude-code", "codex-cli", "grok-cli", "cursor-cli"]),
      model: z.string().nullable(),
      reasoning_effort: z.string().nullable(),
    },
  },
  async ({ session_id, model, reasoning_effort }) => {
    try {
      const result = await core.configureAgent(session_id, { model, reasoning_effort });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: { ...result },
      };
    } catch (e) {
      return fail(e);
    }
  },
);

// 新規APIの選択軸はharness。旧4 launcher名は移行期間中の薄いaliasとして同じ実装へ流す。
const kindForHarness = (harness: core.AgentHarness): core.AgentKind =>
  harness === "claude-code" ? "claude" : harness === "codex-cli" ? "codex" : harness === "cursor-cli" ? "cursor" : "grok";
const agentModelDesc = (kind: core.AgentKind) =>
  kind === "claude"
    ? "起動モデル（例: claude-sonnet-4-6）。省略時はClaude CLI既定"
    : kind === "codex"
    ? "起動モデル（例: gpt-5.6-sol / gpt-5.6-terra / gpt-5.6-luna）。省略時は端末 config／CLI 既定を継承" +
      "（端末側のピンがそのまま効く。実効値は起動応答に明示される）"
    : kind === "cursor"
      ? "Cursor Agent CLIで選ぶbase model（例: gpt-5.6-luna）。GPT／Claude／Grok等を選べ、effortは別指定。省略時はCursor既定"
    : `起動モデル。省略時は ${kind === "grok" ? "grok-4.6" : "grok-composer-2.5-fast"}。` +
      (kind === "composer"
        ? "既定／explicit modelを起動前にlive catalogへ照合し、不在ならfallbackせずエラー"
        : "explicit modelを起動前にlive catalogへ照合し、不在ならfallbackせずエラー");
const agentEffortDesc = (kind: core.AgentKind) =>
  kind === "claude"
    ? "Claude Code reasoning effort。low/medium/high/xhigh/max。省略時はCLI既定"
    : kind === "codex"
      ? "reasoning effort（思考レベル）。low/medium/high/xhigh/max/ultra（CLI／model 版依存）。" +
        "ultra は max 推論＋proactive 自動委譲 ON＝使用量急増注意（明示要求時のみ）。省略時は端末 config／CLI 既定。"
      : kind === "cursor"
        ? "Cursor catalogのeffort。指定時はmodel必須で、adapterが model-effort の正規IDへ変換してlive catalogに照合する。"
        : "Grok Build reasoning effort。利用可能値はCLI／modelのlive catalogに従う。省略時はCLI／model既定。";
// 全launcher共通の完了受信ガイド。machine callerはreceiptのwait_processをそのまま別process APIへ渡す。
// wait_commandは人間向け互換表示。文型は NON_BLOCKING_RULE と同じく「待たない」が先。
const agentCompletionDesc =
  `起動して投げたら投げっぱなしでよい＝親はここで待たない。` +
  `完了通知は起動応答またはpty_send dispatch receiptの wait_processを、親のターンを塞がない` +
  `別プロセスAPIへexecutable／argsの境界を保ったまま渡して受ける` +
  `（PowerShell 7のStart-Processはwindows_start_process_argument_listを使う）` +
  `（${core.AITERM_WAIT_OUTCOME_NOTE}。ポーリング不要・foreground実行はしない）。` +
  `wait_commandは人間向け互換表示。結果回収は pty_read(agent_transcript:true)。`;
const agentEnvironmentDesc =
  `通常CLIと同じHOME・cwd・project/user/local設定・MCP・plugin・skill・permission/trustを共有する。` +
  `aitermは完了相関stateだけをlaunch単位で所有する。起動されたagentにはsub-agent自己認識、親session、` +
  `delegation depth/lineage、delegation_allowed=trueを注入し、必要な追加委譲は許可する。`;

const initialPromptDeliverySchema = z.object({
  status: z.enum(["not_requested", "not_sent", "submitted_unconfirmed", "started"]),
  reason: z.string(), turn_started: z.boolean().nullable(),
});
const agentStartupSchema = z.object({ status: z.enum(["ready", "not_checked", "blocked"]), reason: z.string() });

async function launchAgent(kind: core.AgentKind, args: any): Promise<any> {
  const supportsWriteScope = kind !== "claude";
  const { prompt, image, throughline_source_session, throughline_supplement_file, model, reasoning_effort, env_vars, cwd, session_name, launch_operation_id, write_scope, trust_project } = args;
  try {
    if (!supportsWriteScope && write_scope !== undefined) {
      throw new core.AitermError("claude-code harnessはwrite_scopeに対応していません。指定を外してください", 2);
    }
    const initialPrompt = image && image.length > 0 ? core.attachImages(prompt ?? "", image) : prompt ?? undefined;
    const [sid, hint, eventCursor, submitResidue, initialDelivery, startup] = await core.openAgentWithInitialPrompt(kind, {
      prompt: initialPrompt,
      throughline_source_session,
      throughline_supplement_file,
      model: model ?? undefined,
      reasoning_effort: reasoning_effort ?? undefined,
      env_vars,
      trust_project,
      cwd: cwd ?? undefined,
      session_name: session_name ?? undefined,
      launch_operation_id: launch_operation_id ?? undefined,
      ...(supportsWriteScope ? { write_scope } : {}),
    });
    const structured = {
      schema: "aiterm.agent-launch-result.v1" as const,
      provider: kind,
      harness: core.agentHarness(kind),
      session_id: sid,
      managed_completion: true,
      event_cursor: eventCursor,
      wait_process: eventCursor === null ? null : core.agentWaitProcess(sid, eventCursor),
      wait_command: eventCursor === null ? null : `aiterm-wait --session ${sid} --cursor ${eventCursor}`,
      submit_residue: submitResidue,
      initial_prompt: initialDelivery,
      startup,
      ...(supportsWriteScope && write_scope !== undefined
        ? {
            write_scope,
            write_scope_enforcement:
              write_scope === "read-only"
                ? "enforced_read_only" as const
                : "declaration_only_unsupported" as const,
          }
        : {}),
    };
    return {
      content: [{ type: "text" as const, text: `session_id: ${sid}\n${hint}` }],
      structuredContent: structured,
      ...(initialDelivery.status === "submitted_unconfirmed" ? { isError: true } : {}),
    };
  } catch (e) {
    if (e instanceof core.AgentLaunchPromptError) {
      return {
        ...fail(e),
        structuredContent: {
          schema: "aiterm.agent-launch-result.v1", provider: kind, harness: core.agentHarness(kind),
          session_id: e.session_id, managed_completion: true, event_cursor: e.event_cursor,
          wait_process: e.event_cursor === null ? null : core.agentWaitProcess(e.session_id, e.event_cursor),
          wait_command: e.event_cursor === null ? null : `aiterm-wait --session ${e.session_id} --cursor ${e.event_cursor}`,
          submit_residue: null, initial_prompt: e.initial_prompt, startup: e.startup,
        },
      };
    }
    return fail(e);
  }
}

function registerAgentTool(
  toolName: string,
  kind: core.AgentKind,
  desc: string,
): void {
  const correlatedLaunchSchema: Record<string, z.ZodTypeAny> = {};
  const supportsWriteScope = kind !== "claude";
  const writeScopeInputSchema: Record<string, z.ZodTypeAny> = supportsWriteScope
    ? {
        write_scope: z.string().min(1).optional().describe("能力宣言。read-only、または書込みを許可するパスの説明文字列。対応harnessのread-onlyはCLI標準のread-only面で実効禁止する"),
      }
    : {};
  const writeScopeOutputSchema: Record<string, z.ZodTypeAny> = supportsWriteScope
    ? {
        // write_scope省略時は既存launch receiptを完全に保つため両fieldを出さない。
        write_scope: z.string().optional(),
        write_scope_enforcement: z.enum(["enforced_read_only", "declaration_only_unsupported"]).optional(),
      }
    : {};
  if (kind === "claude") {
    correlatedLaunchSchema.launch_operation_id = z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/)
      .optional()
      .describe("promptなしClaude launchのexact replay相関ID。session_name必須");
  }
  server.registerTool(
    toolName,
    {
      description: desc,
      inputSchema: {
        prompt: z.string().nullish().describe("起動時に渡す初手プロンプト（任意）。送信後は待たずに即返る"),
        throughline_source_session: z
          .string()
          .min(1)
          .optional()
          .describe("同一端末のThroughline sessionから所有権を変えずに記憶を読み、promptのmissionより前へ注入する"),
        throughline_supplement_file: z
          .string()
          .min(1)
          .optional()
          .describe("Throughline 0.10.8以降へそのまま渡すproject束縛済み長期記憶・知識の補足JSON path"),
        model: z.string().nullish().describe(agentModelDesc(kind)),
        // CLI／model側の値集合が版で変わるため公開enumでは縛らない（core側も同方針）。
        reasoning_effort: z.string().nullish().describe(agentEffortDesc(kind)),
        env_vars: z.array(z.string()).optional().describe("起動したagentへ現在のMCP processから継承する環境変数名。値はtool引数へ渡さない"),
        trust_project: z.boolean().optional().describe("対象projectを信頼し、既知のworkspace・project hooks・MCP初期同意を起動中に進める"),
        cwd: z.string().nullish().describe("作業ディレクトリ（対象リポのルート等・任意）"),
        session_name: z.string().nullish().describe("セッション名（省略で自動採番）"),
        ...writeScopeInputSchema,
        ...correlatedLaunchSchema,
      },
      outputSchema: {
        schema: z.literal("aiterm.agent-launch-result.v1"),
        initial_prompt: initialPromptDeliverySchema,
        startup: agentStartupSchema,
        provider: z.literal(kind),
        harness: z.literal(core.agentHarness(kind)),
        session_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        managed_completion: z.boolean().describe("後方互換field。trueはaiterm完了相関が有効という意味で、project/user環境の隔離を意味しない"),
        // 起動時promptでturnが走っている時だけ非null。wait_processがmachine向けprocess境界、
        // wait_commandは人間向け互換表示。
        event_cursor: z.number().int().nullable(),
        wait_process: waitProcessOutputSchema,
        wait_command: z.string().nullable(),
        // 初回prompt dispatch後のsubmit座礁観測（additive）。true=composerに残存を確認（submit未成立の疑い）/
        // false=残存を観測せず（submit成立の保証ではない）/ null=promptなし・判定不能。
        submit_residue: z.boolean().nullable(),
        ...writeScopeOutputSchema,
      },
    },
    async (args: any) => launchAgent(kind, args),
  );
}

server.registerTool(
  "agent_launch",
  {
    description:
      "エージェントを単一の標準入口から永続sessionへ起動する。harnessはagent loop・認証・hook・transcriptを所有する実行基盤、" +
      "modelはそのharnessが選ぶ推論モデルであり別軸。Cursor harnessからGPT／Claude／Grok等を選んでも完了相関はCursor方式のまま。" +
      "Grok Composerは別harnessではなく harness=grok-cli と model=grok-composer-2.5-fast で指定する。" +
      agentEnvironmentDesc + agentCompletionDesc,
    inputSchema: {
      harness: z.enum(["claude-code", "codex-cli", "grok-cli", "cursor-cli"]).describe("agent loop・session・hook・transcript・認証を所有する実行基盤"),
      prompt: z.string().nullish().describe("起動時に渡す初手プロンプト（任意）。送信後は待たずに即返る"),
      image: z.array(z.string()).optional().describe("初手プロンプトへ添付する画像ファイルの絶対パス（png/jpg/jpeg/gif/webp）"),
      throughline_source_session: z.string().min(1).optional().describe("同一端末のThroughline sessionから読み取り専用contextを初手へ注入する"),
      throughline_supplement_file: z.string().min(1).optional().describe("Throughline 0.10.8以降へそのまま渡すproject束縛済み長期記憶・知識の補足JSON path"),
      model: z.string().nullish().describe("harnessが選ぶモデル。provider名ではなくlive catalog上のmodel ID"),
      reasoning_effort: z.string().nullish().describe("harness adapterが標準CLI表現へ変換する思考レベル。Cursorではmodel同時指定が必要"),
      env_vars: z.array(z.string()).optional().describe("現在のMCP processから継承する環境変数名"),
      trust_project: z.boolean().optional().describe("対象projectを信頼し、既知のworkspace・project hooks・MCP初期同意を起動中に進める"),
      cwd: z.string().nullish().describe("作業ディレクトリ（絶対パス・任意）"),
      session_name: z.string().nullish().describe("Aiterm session名（省略で自動採番）"),
      write_scope: z.string().min(1).optional().describe("能力宣言。read-onlyは対応harnessの標準read-only面で実効禁止する"),
      launch_operation_id: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional().describe("Claude Codeのpromptなしexact replay相関だけで使用"),
    },
    outputSchema: {
      schema: z.literal("aiterm.agent-launch-result.v1"),
      initial_prompt: initialPromptDeliverySchema,
      startup: agentStartupSchema,
      harness: z.enum(["claude-code", "codex-cli", "grok-cli", "cursor-cli"]),
      provider: z.enum(["claude", "codex", "grok", "composer", "cursor"]).describe("旧互換field。新規連携はharnessを使う"),
      session_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      managed_completion: z.boolean(),
      event_cursor: z.number().int().nullable(),
      wait_process: waitProcessOutputSchema,
      wait_command: z.string().nullable(),
      submit_residue: z.boolean().nullable(),
      write_scope: z.string().optional(),
      write_scope_enforcement: z.enum(["enforced_read_only", "declaration_only_unsupported"]).optional(),
    },
  },
  async ({ harness, ...args }: any) => launchAgent(kindForHarness(harness), args),
);

registerAgentTool(
  "claude_agent",
  "claude",
  "【旧互換alias。新規連携は agent_launch(harness=claude-code)】Claude Codeの対話エージェントTUIを永続端末に起動する。`claude -p`ではなく、" +
    "同じ利用者可視sessionへpty_sendで継続入力する。" +
    agentEnvironmentDesc +
    "通常settingsへlaunch固有Stop hook settingsを加算する。起動前に共有認証を構造化確認し、未認証ならsessionを作らない。" +
    agentCompletionDesc +
    "Claude の durable turn は claude_turn でも回収できる。",
);

registerAgentTool(
  "codex_agent",
  "codex",
  "【旧互換alias。新規連携は agent_launch(harness=codex-cli)】Codexの対話エージェント TUI を永続端末に起動する。実装・レビュー・調査を対話で回す。" +
    agentEnvironmentDesc +
    "委譲契約を使う完全な呼び出し例: " +
    '`codex_agent({"prompt":"<依頼>","model":"gpt-5.6-sol","reasoning_effort":"high",' +
    '"cwd":"/absolute/path/to/repo","write_scope":"read-only"})`。' +
    "turn は pty_send で送る（自動で非ブロック dispatch になる）。" +
    agentCompletionDesc +
    "model / reasoning_effort を引数で指定可" +
    "（省略時は端末 config／CLI 既定を継承。実効値は起動応答に明示）。",
);
registerAgentTool(
  "grok_agent",
  "grok",
  "【旧互換alias。新規連携は agent_launch(harness=grok-cli)】Grok BuildのGrokモデル（既定 grok-4.6）の対話エージェント TUIを永続端末に起動する。" +
    agentEnvironmentDesc +
    "turn は pty_send で送る（自動で非ブロック dispatch になる）。" +
    agentCompletionDesc +
    "model／reasoning_effortを引数で指定可。read-only sandboxとagent_configureに対応。",
);
registerAgentTool(
  "composer_agent",
  "composer",
  "【旧互換alias。新規連携は agent_launch(harness=grok-cli, model=grok-composer-2.5-fast)】Grok BuildのComposerモデルを永続端末に起動する。" +
    agentEnvironmentDesc +
    "turn は pty_send で送る（自動で非ブロック dispatch になる）。" +
    agentCompletionDesc +
    "model／reasoning_effortを引数で指定可。live catalogにComposer modelがなければGrokへfallbackせず明示エラー。" +
    "read-only sandboxとagent_configureに対応。",
);

async function main(): Promise<void> {
  // 親ホストを initialize の clientInfo.name から確定させ、receipt の完了待ちコマンドを
  // そのホストの実際の起動形で名指しする（実測: claude-code は initialize → notifications/initialized
  // → tools/list の順で送るため、どの tool 呼び出しより先に確定する）。取れない時は汎用文へ落ちるだけ。
  server.server.oninitialized = () => {
    core.setParentClient(server.server.getClientVersion()?.name ?? null);
  };
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("aiterm-mcp fatal:", e);
  process.exit(1);
});
