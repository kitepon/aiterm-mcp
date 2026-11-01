export interface NativeSessionReceipt {
  native_id: string; session_id: string; server_pid: number; pane_id: string; pane_pid: number;
}

export function parseNativeSessionReceipt(receipt: string, platform: NodeJS.Platform = process.platform): NativeSessionReceipt {
  const separator = platform === "win32" ? "[ \\t]" : "\\t";
  const match = new RegExp(`^(\\$\\d+)${separator}([A-Za-z0-9_-]{1,64})${separator}([1-9][0-9]*)${separator}(%\\d+)${separator}([1-9][0-9]*)\\r?\\n?$`).exec(receipt);
  if (!match || !Number.isSafeInteger(Number(match[3])) || !Number.isSafeInteger(Number(match[5])))
    throw new Error("native_session_receipt_unconfirmed");
  return { native_id: match[1], session_id: match[2], server_pid: Number(match[3]), pane_id: match[4], pane_pid: Number(match[5]) };
}

export function nativePaneTarget(target: NativeSessionReceipt, platform: NodeJS.Platform = process.platform): string {
  // Qualify psmux panes by session; $ID routing under -L duplicates the namespace prefix.
  return platform === "win32" ? `${target.session_id}:.${target.pane_id}` : target.pane_id;
}

export function nativeSessionTarget(target: NativeSessionReceipt, platform: NodeJS.Platform = process.platform): string {
  // psmux kill-session compares the raw name; a trailing colon silently misses.
  return platform === "win32" ? `=${target.session_id}` : target.native_id;
}

export function nativeSessionCondition(target: NativeSessionReceipt, allowExitedPane = false): string {
  const pane = `#{==:#{pane_pid},${target.pane_pid}}`;
  return [...[["pid", target.server_pid], ["session_id", target.native_id], ["session_name", target.session_id],
    ["pane_id", target.pane_id]].map(([key, value]) => `#{==:#{${key}},${value}}`),
    allowExitedPane ? `#{||:${pane},#{&&:#{==:#{pane_dead},1},#{==:#{pane_pid},}}}` : pane]
    .reduce((left, right) => `#{&&:${left},${right}}`);
}
