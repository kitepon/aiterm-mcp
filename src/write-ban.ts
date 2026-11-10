// Fork write-ban (ADR 0140): every write inside one folder is refused below the tools, for the whole CLI process tree.
// Everything else (reads, commands, network, MCP, writes elsewhere) is untouched.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { AitermError } from "./errors.js";

export type WriteBanMethod = "landlock" | "seatbelt";
export interface WriteBan { path: string; method: WriteBanMethod }

// Linux: Landlock, unprivileged (works in standard Docker, where bwrap cannot create a namespace).
// Handles only write-type rights and grants them on every sibling along / -> the folder, so only the folder
// (and new entries directly in its ancestors) is unwritable. Fails closed: exit 126 before the CLI starts.
const LANDLOCK_PY = `import ctypes,os,sys,struct
a=sys.argv[1:];probe=a[0]=='--probe'
if probe:a=a[1:]
P=os.path.realpath(a[0]);L=ctypes.CDLL(None,use_errno=True)
def c(r,w):
  if r<0:
    sys.stderr.write('aiterm write-ban: %s: %s\\n'%(w,os.strerror(ctypes.get_errno())));sys.exit(126)
  return r
abi=c(L.syscall(444,None,0,1),'landlock unavailable')
D=0
for b in (1,4,5,6,7,8,9,10,11,12,13,14):D|=1<<b
if abi<2:D&=~(1<<13)
if abi<3:D&=~(1<<14)
F=D&((1<<1)|(1<<14));A=struct.pack('QQQ',D,0,0)
fd=c(L.syscall(444,ctypes.c_char_p(A),ctypes.c_size_t(len(A)),0),'create_ruleset')
def g(p):
  try:q=os.open(p,os.O_PATH|os.O_CLOEXEC)
  except OSError:return
  try:c(L.syscall(445,fd,1,ctypes.c_char_p(struct.pack('=Qi',D if os.path.isdir(p) else F,q)),0),'add_rule '+p)
  finally:os.close(q)
cur='/'
for part in P.strip('/').split('/'):
  for e in os.listdir(cur):
    if e!=part:g(os.path.join(cur,e))
  cur=os.path.join(cur,part)
c(L.prctl(38,1,0,0,0),'no_new_privs')
c(L.syscall(446,fd,0),'restrict_self')
if probe:print('landlock',abi);sys.exit(0)
cmd=a[a.index('--')+1:];os.execvp(cmd[0],cmd)
`;
const LANDLOCK_LAUNCHER = `import base64;exec(base64.b64decode('${Buffer.from(LANDLOCK_PY).toString("base64")}'))`;

function seatbeltProfile(folder: string): string {
  return `(version 1)(allow default)(deny file-write* (subpath "${folder.replace(/[\\"]/g, "\\$&")}"))`;
}

/** argv placed before the CLI's own argv. The CLI is exec'd, so its PID and process name stay the seat's. */
export function writeBanPrefix(ban: WriteBan): string[] {
  return ban.method === "landlock"
    ? ["python3", "-c", LANDLOCK_LAUNCHER, ban.path, "--"]
    : ["/usr/bin/sandbox-exec", "-p", seatbeltProfile(ban.path)];
}

/**
 * Prove on this machine that the ban can be applied before any seat starts. Without proof the fork is refused:
 * starting it would let it write the project (the one thing the Owner forbade).
 */
export function probeWriteBan(folder: string, platform: NodeJS.Platform = process.platform): WriteBan {
  const unenforceable = (why: string) => new AitermError(`READONLY_UNENFORCEABLE: the project write-ban cannot be applied here: ${why}`, 2);
  if (platform === "win32") throw unenforceable("Windows has no same-user folder write-ban yet");
  if (!path.isAbsolute(folder) || !fs.existsSync(folder)) throw unenforceable(`folder ${folder} does not exist`);
  const real = fs.realpathSync(folder);
  if (real === path.parse(real).root) throw unenforceable("the folder is the filesystem root");
  const ban: WriteBan = { path: real, method: platform === "darwin" ? "seatbelt" : "landlock" };
  const [bin, ...args] = writeBanPrefix(ban);
  const probe = ban.method === "landlock" ? [args[0], args[1], "--probe", real] : [...args, "/usr/bin/true"];
  const r = spawnSync(bin, probe, { encoding: "utf8", timeout: 10_000 });
  if (r.status !== 0) throw unenforceable((r.stderr || r.error?.message || `exit ${r.status}`).trim().split("\n").pop() ?? "probe failed");
  return ban;
}
