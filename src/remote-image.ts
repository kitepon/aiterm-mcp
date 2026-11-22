// Images to and from a terminal seat (remote-terminal.md R23/R24, a521). The terminal's own Aiterm stores an uploaded image
// (`image_put`) and reads one back (`image_read`); the caller's Aiterm moves the bytes over the existing relay.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AitermError } from "./errors.js";
import { IMAGE_EXTENSIONS } from "./core.js";

export const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const IMAGE_MAX_COUNT = 8;
const IMAGE_KEEP_MS = 24 * 60 * 60 * 1000;
/** One MCP message must stay under 10 MiB (SDK 1.32 refuses more), so images travel in pieces of this size (base64 adds a third). */
export const IMAGE_CHUNK_BYTES = 5 * 1024 * 1024;
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ImageKind { mime: string; ext: string }

/** The file's own first bytes decide; a name or extension never does. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const at = (offset: number, text: string) => text.split("").every((char, i) => bytes[offset + i] === char.charCodeAt(0));
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte)) return { mime: "image/png", ext: "png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 6 && (at(0, "GIF87a") || at(0, "GIF89a"))) return { mime: "image/gif", ext: "gif" };
  if (bytes.length >= 12 && at(0, "RIFF") && at(8, "WEBP")) return { mime: "image/webp", ext: "webp" };
  return null;
}

/** Where uploaded images live on this machine: its temp folder, in a folder only this user can enter. */
export function imageDirectory(): string {
  return path.join(os.tmpdir(), "aiterm-images");
}

function refuse(code: string, message: string): never {
  throw new AitermError(`${code}: ${message}`, 2);
}

export interface PutResult { path?: string; mime_type?: string; bytes?: number; upload_id?: string; received?: number }

function sweepImages(dir: string): void {
  for (const name of fs.readdirSync(dir)) {
    try { if (Date.now() - fs.statSync(path.join(dir, name)).mtimeMs > IMAGE_KEEP_MS) fs.rmSync(path.join(dir, name), { force: true }); } catch { /* gone already */ }
  }
}

function storeImage(dir: string, bytes: Buffer, name: string): { path: string; mime_type: string; bytes: number } {
  const kind = sniffImage(bytes);
  if (!kind) refuse("IMAGE_NOT_AN_IMAGE", "the bytes are not png, jpeg, gif or webp");
  const file = path.join(dir, `${name}.${kind!.ext}`);
  fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
  return { path: file, mime_type: kind!.mime, bytes: bytes.length };
}

/**
 * `image_put`: store one uploaded image under a name made here (shortcut: files older than 24 h are removed on each put, no timer).
 * Without `piece` the whole image is in `dataBase64`. With `piece` the image arrives in order, `offset` bytes already received (a piece at any other
 * offset is refused, so a repeated call cannot corrupt it); the last piece (`final`) is sniffed and gets its name.
 */
export function putImage(dataBase64: string, piece?: { upload_id: string; offset: number; final: boolean }): PutResult {
  if (dataBase64.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4 + 4) refuse("IMAGE_TOO_LARGE", `an image is at most ${IMAGE_MAX_BYTES} bytes`);
  const bytes = Buffer.from(dataBase64, "base64");
  if (bytes.length > IMAGE_MAX_BYTES) refuse("IMAGE_TOO_LARGE", `an image is at most ${IMAGE_MAX_BYTES} bytes`);
  const dir = imageDirectory();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  sweepImages(dir);
  if (!piece) return storeImage(dir, bytes, crypto.randomUUID());
  if (!UPLOAD_ID.test(piece.upload_id)) refuse("IMAGE_UPLOAD_INVALID", "upload_id must be a UUID");
  if (!Number.isInteger(piece.offset) || piece.offset < 0) refuse("IMAGE_UPLOAD_INVALID", "offset must be a whole number of bytes");
  const part = path.join(dir, `${piece.upload_id}.part`);
  const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (piece.offset !== have) refuse("IMAGE_UPLOAD_OFFSET", `the terminal has ${have} bytes of this upload, not ${piece.offset}`);
  if (have + bytes.length > IMAGE_MAX_BYTES) { fs.rmSync(part, { force: true }); refuse("IMAGE_TOO_LARGE", `an image is at most ${IMAGE_MAX_BYTES} bytes`); }
  fs.writeFileSync(part, bytes, { flag: have === 0 ? "wx" : "a", mode: 0o600 });
  if (!piece.final) return { upload_id: piece.upload_id, received: have + bytes.length };
  const whole = fs.readFileSync(part);
  fs.rmSync(part, { force: true });
  return { ...storeImage(dir, whole, piece.upload_id), upload_id: piece.upload_id, received: whole.length };
}

/** `image_read`'s folders: the session's own working folder, the temp folders and the uploaded-image folder. */
export function imageReadRoots(sessionCwd: string | null | undefined): string[] {
  return [sessionCwd, os.tmpdir(), process.platform === "win32" ? null : "/tmp", imageDirectory()].filter((root): root is string => !!root);
}

const real = (file: string): string => fs.realpathSync.native(file);

/** `image_read`'s checks: ONE file, by absolute path, inside the allowed folders after symlinks are resolved, a regular file of at most 25 MiB. */
function checkedImage(requested: unknown, roots: readonly string[]): { path: string; size: number } {
  if (typeof requested !== "string" || !path.isAbsolute(requested)) refuse("IMAGE_PATH_INVALID", "path must be an absolute path");
  let file: string;
  try { file = real(requested as string); }
  catch (error) { return refuse((error as NodeJS.ErrnoException).code === "EACCES" ? "IMAGE_PATH_NOT_ALLOWED" : "IMAGE_NOT_FOUND", `cannot open ${requested}`); }
  const inside = roots.some(root => {
    try { const relative = path.relative(real(root), file); return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative); } catch { return false; }
  });
  if (!inside) refuse("IMAGE_PATH_NOT_ALLOWED", "the file is outside the folders this seat can share (its working folder and the temp folders)");
  const stat = fs.statSync(file);
  if (!stat.isFile()) refuse("IMAGE_NOT_AN_IMAGE", "the path is not a file");
  if (stat.size > IMAGE_MAX_BYTES) refuse("IMAGE_TOO_LARGE", `an image is at most ${IMAGE_MAX_BYTES} bytes`);
  return { path: file, size: stat.size };
}

/** The whole image (`image_read` without `length`). */
export function readImage(requested: unknown, roots: readonly string[]): { path: string; bytes: Buffer; mime_type: string } {
  const checked = checkedImage(requested, roots);
  const bytes = fs.readFileSync(checked.path);
  const kind = sniffImage(bytes);
  if (!kind) refuse("IMAGE_NOT_AN_IMAGE", "the file is not png, jpeg, gif or webp");
  return { path: checked.path, bytes, mime_type: kind!.mime };
}

/** One piece of the image (`image_read` with `offset`/`length`): the same checks and the same sniff of the file's start, so the caller can build it from pieces under the message cap. */
export function readImagePiece(requested: unknown, roots: readonly string[], offset: number, length: number):
  { path: string; mime_type: string; total_bytes: number; offset: number; piece: Buffer; sha256: string } {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 1 || length > IMAGE_CHUNK_BYTES + 1024 * 1024)
    refuse("IMAGE_PATH_INVALID", `offset must be >= 0 and length 1..${IMAGE_CHUNK_BYTES + 1024 * 1024}`);
  const checked = checkedImage(requested, roots);
  const whole = fs.readFileSync(checked.path);
  const kind = sniffImage(whole);
  if (!kind) refuse("IMAGE_NOT_AN_IMAGE", "the file is not png, jpeg, gif or webp");
  return { path: checked.path, mime_type: kind!.mime, total_bytes: whole.length, offset, piece: whole.subarray(offset, offset + length), sha256: crypto.createHash("sha256").update(whole).digest("hex") };
}

/**
 * The caller side of `pty_send image` to a terminal: the same checks as a local attachment (absolute path, image extension, a file), then every
 * image goes to the terminal one at a time and its path there replaces the caller's. `call` is one `image_put` request to the terminal and returns
 * its structured answer. An image over one piece goes in pieces under one upload id; a terminal that does not answer with that id has the older
 * single-message `image_put` (0.70.96), which would store a cut image, so the upload stops there. Nothing is typed before all are stored.
 */
export async function uploadImages(images: readonly string[], call: (args: Record<string, unknown>) => Promise<PutResult>): Promise<string[]> {
  if (images.length > IMAGE_MAX_COUNT) refuse("IMAGE_TOO_MANY", `at most ${IMAGE_MAX_COUNT} images per message`);
  images.forEach((image, index) => {
    if (typeof image !== "string" || !path.isAbsolute(image)) refuse("IMAGE_PATH_INVALID", `image[${index}] must be an absolute path: ${String(image)}`);
    if (!IMAGE_EXTENSIONS.has(path.extname(image).toLowerCase())) refuse("IMAGE_NOT_AN_IMAGE", `image[${index}] is not png/jpg/jpeg/gif/webp: ${image}`);
    let stat: fs.Stats;
    try { stat = fs.statSync(image); } catch { return refuse("IMAGE_NOT_FOUND", `image[${index}] cannot be read: ${image}`); }
    if (!stat.isFile()) refuse("IMAGE_NOT_FOUND", `image[${index}] is not a file: ${image}`);
    if (stat.size > IMAGE_MAX_BYTES) refuse("IMAGE_TOO_LARGE", `image[${index}] is over ${IMAGE_MAX_BYTES} bytes: ${image}`);
  });
  const stored: string[] = [];
  for (const image of images) {
    const bytes = fs.readFileSync(image);
    if (bytes.length <= IMAGE_CHUNK_BYTES) { stored.push(requirePath(await call({ data_base64: bytes.toString("base64") }))); continue; }
    const uploadId = crypto.randomUUID();
    let answer: PutResult = {};
    for (let offset = 0; offset < bytes.length; offset += IMAGE_CHUNK_BYTES) {
      const end = Math.min(offset + IMAGE_CHUNK_BYTES, bytes.length);
      answer = await call({ data_base64: bytes.subarray(offset, end).toString("base64"), upload_id: uploadId, offset, final: end === bytes.length });
      if (answer.upload_id !== uploadId) refuse("REMOTE_IMAGE_UNSUPPORTED", "the terminal's Aiterm takes images over 5 MiB only from 0.70.97 on. Nothing was typed.");
    }
    stored.push(requirePath(answer));
  }
  return stored;
}

function requirePath(answer: PutResult): string {
  if (typeof answer.path !== "string") refuse("IMAGE_UPLOAD_FAILED", "the terminal did not store the image");
  return answer.path!;
}
