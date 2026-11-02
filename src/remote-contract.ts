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
}).strict();
export type RemoteTarget = z.infer<typeof remoteTargetSchema>;

export const remoteInputSchema = remoteTargetSchema.extend({
  passphrase: z.string().min(1).optional(),
}).strict().refine((value) => !(value.passphrase && value.passphrase_env), {
  message: "passphraseとpassphrase_envは同時に指定できません",
});
export type RemoteInput = z.infer<typeof remoteInputSchema>;

export const remoteInputDescription =
  "別端末のAitermで実行する時のSSH接続情報。hostだけならssh_configの接続名として使う。" +
  "Aitermは接続情報を保存・管理しない。passphraseは会話記録に残るため、ssh-agentかpassphrase_env（環境変数名）を推奨する。";

