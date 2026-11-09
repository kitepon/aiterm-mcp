import { z } from "zod";

// ssh_configの接続名、DNS名、IPv4/IPv6。先頭の`-`はsshのoptionとして解釈されるため受け付けない。
const hostPattern = /^(?!-)[A-Za-z0-9._%:\[\]-]{1,255}$/;
const sshOptionPattern = /^[A-Za-z][A-Za-z0-9]*=[^\r\n]*$/;
const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 記録に残してよい接続情報。パスフレーズ本文は含めない。 */
export const remoteTargetSchema = z.object({
  host: z.string().regex(hostPattern),
  user: z.string().regex(/^(?!-)[A-Za-z0-9._@\\-]{1,128}$/).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  identity_file: z.string().min(1).optional(),
  passphrase_env: z.string().regex(envNamePattern).optional(),
  ssh_options: z.array(z.string().regex(sshOptionPattern)).max(32).optional(),
  // Set only by Aiterm from a terminal binding (remote-terminal.md); never accepted from tool input.
  trusted_ref: z.string().uuid().optional(),
}).strict();
export type RemoteTarget = z.infer<typeof remoteTargetSchema>;

export const remoteInputSchema = remoteTargetSchema.omit({ trusted_ref: true }).extend({
  passphrase: z.string().min(1).optional(),
}).strict().refine((value) => !(value.passphrase && value.passphrase_env), {
  message: "passphraseとpassphrase_envは同時に指定できません",
});
export type RemoteInput = z.infer<typeof remoteInputSchema>;

export const remoteInputDescription =
  "別端末のAitermで実行する時のSSH接続情報。hostだけならssh_configの接続名として使う。" +
  "Aitermは接続情報を保存・管理しない。passphraseは会話記録に残るため、ssh-agentかpassphrase_env（環境変数名）を推奨する。";


const revision = (field: string) => z.string().regex(/^sha256:[0-9a-f]{64}$/,
  `terminal.${field} must be the sha256:<hex> revision the terminal registry returned with this binding; pass it unchanged`);

/** The launch tools' terminal target (remote-terminal.md "One launch path"). Copied unchanged from BellTeam terminals. */
export const terminalArgumentSchema = z.object({
  ref: z.string().uuid("terminal.ref must be the binding ref (UUID) the terminal registry gave for this terminal"),
  target: z.object({
    host: z.string().min(1, "terminal.target.host is required"),
    user: z.string().min(1, "terminal.target.user is required"),
    port: z.number().int().min(1).max(65535),
  }).strict(),
  trustRevision: revision("trustRevision"),
  credentialRevision: revision("credentialRevision"),
}).strict();
export type TerminalArgument = z.infer<typeof terminalArgumentSchema>;

export const terminalArgumentDescription =
  "Run this seat on another computer (a registered terminal) over SSH. Value: exactly the terminal value your host system's terminal registry hands over, " +
  "{ref, target:{host,user,port}, trustRevision, credentialRevision}; copy it unchanged, never invent or edit it, never use a host name or ssh command instead. " +
  "Omit it to launch on this computer. Give cwd in the same call: the absolute project folder on that terminal. Never launch locally and then cd or ssh. " +
  "Never put tokens, passwords or other secrets in any argument, prompt or typed text; pass secret values only by name in env_vars. " +
  "After launch, use session_id alone for pty_send, pty_observe, pty_read, pty_key, claude_turn, agent_stop and pty_close; Aiterm routes them to the terminal. " +
  "Errors and next step: TERMINAL_INVALID = malformed value, missing/relative cwd, or combined with remote: pass the registry's value unchanged with cwd. " +
  "TARGET_MISMATCH / BINDING_UNKNOWN = the value is not this terminal's binding: ask the terminal registry again. " +
  "HOST_TRUST_STALE / CREDENTIAL_REVISION_STALE = the binding changed: get the current value from the terminal registry and launch again. " +
  "HOST_KEY_MISMATCH / HOST_TRUST_MISSING = the terminal's host key is not the trusted one: the Owner must confirm the new host key; do not retry. " +
  "AUTH_FAILED = the terminal refused the key. UNREACHABLE = the terminal is offline; try later. " +
  "REMOTE_AITERM_TOO_OLD = update Aiterm on the terminal. CWD_UNAVAILABLE = the folder does not exist there; do not pick another folder. " +
  "SEAT_FORWARD_UNAVAILABLE = the seat's MCP route back to this computer is not ready; launch again later. TERMINAL_HARNESS_UNSUPPORTED = use harness claude-code.";
