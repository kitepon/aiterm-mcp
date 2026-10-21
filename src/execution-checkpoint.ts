// Existing execution metadata only. Completion means the OS acknowledged the
// file and directory sync operations, not native interruption/fence evidence.
import * as fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ExecutionError } from "./execution-wire.js";

export const executionCheckpoint = "file_and_directory_sync.v1" as const;

/** A native operation must not run if any checkpoint step fails, including a
 * directory flush after rename. The renamed state may then already be visible:
 * do not roll it back, erase an issued slot or replay the native operation.
 * Flush ancestors too: a newly-created scope directory must not depend on an
 * unflushed parent entry. Unsupported filesystems/platforms fail closed.
 */
export function writeExecutionCheckpoint(file: string, value: unknown): void {
  if (process.platform === "win32") throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  let descriptor: number | undefined, renamed = false;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2) + "\n");
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    fs.renameSync(temporary, file); renamed = true;
    let directory = path.dirname(path.resolve(file));
    for (;;) {
      descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor); descriptor = undefined;
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  } catch {
    throw new ExecutionError("EXECUTION_STATE_UNAVAILABLE", "possible");
  } finally {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* unavailable, never a native receipt */ } }
    if (!renamed) { try { fs.unlinkSync(temporary); } catch { /* no rollback of the committed state */ } }
  }
}
