// Kept dependency-free: the Claude Stop hook imports it on every turn end.
import * as fs from "node:fs";

/** End of the last complete line (exclusive byte offset); a partly written last line is left for the next turn. */
export function completedTranscriptOffset(file: string): { path: string; offset: number } | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    let end = fs.fstatSync(fd).size;
    const chunk = Buffer.alloc(64 * 1024);
    while (end > 0) {
      const start = Math.max(0, end - chunk.length);
      const read = fs.readSync(fd, chunk, 0, end - start, start);
      const at = chunk.subarray(0, read).lastIndexOf(0x0a);
      if (at >= 0) return { path: file, offset: start + at + 1 };
      end = start;
    }
    return { path: file, offset: 0 };
  } catch { return null; }
  finally { if (fd !== null) fs.closeSync(fd); }
}
