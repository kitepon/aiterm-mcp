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

/** `image_put`: store one uploaded image under a name made here (shortcut: files older than 24 h are removed on each put, no timer). */
export function putImage(dataBase64: string): { path: string; mime_type: string; bytes: number } {
  if (dataBase64.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4 + 4) refuse("IMAGE_TOO_LARGE", `an image is at most ${IMAGE_MAX_BYTES} bytes`);
  const bytes = Buffer.from(dataBase64, "base64");
  if (bytes.length > IMAGE_MAX_BYTES) refuse("IMAGE_TOO_LARGE", `an image is at most ${IMAGE_MAX_BYTES} bytes`);
  const kind = sniffImage(bytes);
  if (!kind) refuse("IMAGE_NOT_AN_IMAGE", "the bytes are not png, jpeg, gif or webp");
  const dir = imageDirectory();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const name of fs.readdirSync(dir)) {
    try { if (Date.now() - fs.statSync(path.join(dir, name)).mtimeMs > IMAGE_KEEP_MS) fs.rmSync(path.join(dir, name), { force: true }); } catch { /* gone already */ }
  }
  const file = path.join(dir, `${crypto.randomUUID()}.${kind!.ext}`);
  fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
  return { path: file, mime_type: kind!.mime, bytes: bytes.length };
}

/** `image_read`'s folders: the session's own working folder, the temp folders and the uploaded-image folder. */
export function imageReadRoots(sessionCwd: string | null | undefined): string[] {
  return [sessionCwd, os.tmpdir(), process.platform === "win32" ? null : "/tmp", imageDirectory()].filter((root): root is string => !!root);
}

const real = (file: string): string => fs.realpathSync.native(file);

/** `image_read`: ONE file, by absolute path, inside the allowed folders after symlinks are resolved. */
export function readImage(requested: unknown, roots: readonly string[]): { path: string; bytes: Buffer; mime_type: string } {
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
  const bytes = fs.readFileSync(file);
  const kind = sniffImage(bytes);
  if (!kind) refuse("IMAGE_NOT_AN_IMAGE", "the file is not png, jpeg, gif or webp");
  return { path: file, bytes, mime_type: kind!.mime };
}

/**
 * The caller side of `pty_send image` to a terminal: the same checks as a local attachment (absolute path, image extension, a file), then every
 * image goes to the terminal one at a time (`put` = the terminal's `image_put`) and its path there replaces the caller's. Nothing is typed before all are stored.
 */
export async function uploadImages(images: readonly string[], put: (dataBase64: string) => Promise<string>): Promise<string[]> {
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
  for (const image of images) stored.push(await put(fs.readFileSync(image).toString("base64")));
  return stored;
}
