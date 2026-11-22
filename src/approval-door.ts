// The Approval Box door on a terminal (remote-terminal.md R22, T5). One detached process per host user serves a stable
// address while a registered seat's native session lives, and forwards each connector line to the body's seat endpoint
// over the seat route (127.0.0.1:P, R12) with that seat's bearer. Bearers live in this process's memory only.
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { liveNodeExecutable } from "./live-node.js";
import { tmuxCommand } from "./tmux-runtime.js";

const SEAT_PATH = /^\/api\/seat-mcp(\/|$)/;
const ENDPOINT = "/api/seat-mcp/approval-box/local";
/** The body accepts exactly `Bearer ` + 43 of these; anything else is refused there, so it is never registered here. */
export const DOOR_BEARER = /^Bearer [A-Za-z0-9_-]{43}$/;
// The daemon's own line cap is 32 MiB (a516m); this process must never cap below it.
const LINE_MAX = 64 * 1024 * 1024;
const SWEEP_MS = 30_000;
const CONTROL_PREFIX = '{"aiterm_door":';

export function doorAddress(platform: NodeJS.Platform = process.platform, home = os.homedir(), user = os.userInfo().username): string {
  return platform === "win32" ? `\\\\.\\pipe\\aiterm-approval-box-door-${user.replace(/[^A-Za-z0-9_.-]/g, "_")}` : path.join(home, ".aiterm", "approval-box-door.sock");
}

export interface SeatRegistration { port: number; bearer: string }

/** The seat route's port and bearer from the launch's mcp_config (already rewritten to http://127.0.0.1:P); null = this seat has no door. */
export function seatRegistration(config: Record<string, unknown> | null | undefined, valueOf: (name: string) => string | undefined): SeatRegistration | null {
  for (const server of Object.values((config?.mcpServers ?? {}) as Record<string, { url?: unknown; headers?: unknown }>)) {
    let url: URL;
    try { if (typeof server?.url !== "string") continue; url = new URL(server.url); } catch { continue; }
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !SEAT_PATH.test(url.pathname)) continue;
    const headers = (server.headers ?? {}) as Record<string, unknown>;
    const key = Object.keys(headers).find(name => name.toLowerCase() === "authorization");
    const raw = key === undefined ? undefined : headers[key];
    if (typeof raw !== "string") continue;
    const bearer = raw.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => valueOf(name) ?? "\0");
    if (DOOR_BEARER.test(bearer)) return { port: Number(url.port || 80), bearer };
  }
  return null;
}

const errorLine = (status: number, code: string, message: string): string => JSON.stringify({ ok: false, status, code, message });
const bodyCode = (text: string): string | null => { try { const code = (JSON.parse(text) as { error?: unknown }).error; return typeof code === "string" ? code : null; } catch { return null; } };

export class Door {
  private readonly seats = new Map<string, SeatRegistration & { misses: number }>();
  constructor(private readonly alive: (session: string) => boolean, private readonly send: typeof fetch = fetch) {}

  /** A new issue replaces the session's old bearer at once (one token per session name, RS02); the newest registration is tried first. */
  register(session: string, port: number, bearer: string): void {
    this.seats.delete(session);
    this.seats.set(session, { port, bearer, misses: 0 });
  }
  get size(): number { return this.seats.size; }

  /** Drops a seat whose native session was gone in two sweeps in a row (one failed check is not proof). Returns what is left. */
  sweep(): number {
    for (const [session, seat] of [...this.seats]) {
      if (this.alive(session)) { seat.misses = 0; continue; }
      if (++seat.misses >= 2) this.seats.delete(session);
    }
    return this.seats.size;
  }

  /** One connector line -> one reply line (no newline). Never throws: the connector always gets a typed answer. */
  async forward(line: string): Promise<string> {
    let unreachable = false;
    for (const [session, seat] of [...this.seats].reverse()) {
      let response: Response, text: string;
      try {
        response = await this.send(`http://127.0.0.1:${seat.port}${ENDPOINT}`, { method: "POST", headers: { authorization: seat.bearer, "content-type": "application/json" }, body: line });
        text = await response.text();
      } catch { unreachable = true; continue; }
      if (response.status === 200) return text.replace(/\r?\n$/, ""); // the daemon's own reply, a down daemon included
      const code = bodyCode(text);
      if (response.status === 400 && code === "BELLTEAM_SEAT_UNRESOLVED") { this.seats.delete(session); continue; } // replaced or revoked: dead
      if (response.status === 403 && code === "APPROVAL_BOX_DOOR_NOT_ALLOWED") continue; // a fork seat's bearer
      return errorLine(response.status, code ?? "APPROVAL_DOOR_HTTP_ERROR", `the body answered HTTP ${response.status}`);
    }
    return unreachable
      ? errorLine(503, "APPROVAL_DOOR_ROUTE_UNAVAILABLE", "the seat route to the body is not reachable")
      : errorLine(503, "APPROVAL_DOOR_NO_SEAT", "no live seat on this computer can reach the body");
  }

  /** The first-line control message of a launch or resume; any other line is the connector's. */
  async handle(line: string): Promise<string> {
    if (!line.startsWith(CONTROL_PREFIX)) return this.forward(line);
    try {
      const message = JSON.parse(line) as { aiterm_door?: unknown; session?: unknown; port?: unknown; authorization?: unknown };
      if (message.aiterm_door !== "register" || typeof message.session !== "string" || !message.session || message.session.length > 128
        || !Number.isInteger(message.port) || (message.port as number) < 1 || (message.port as number) > 65535
        || typeof message.authorization !== "string" || !DOOR_BEARER.test(message.authorization)) return errorLine(400, "APPROVAL_DOOR_REGISTER_INVALID", "not a valid registration");
      this.register(message.session, message.port as number, message.authorization);
      return JSON.stringify({ ok: true });
    } catch { return errorLine(400, "APPROVAL_DOOR_REGISTER_INVALID", "not a valid registration"); }
  }
}

/** Newline-framed lines on one connection, answered in order. */
function serveConnection(door: Door, socket: net.Socket): void {
  let buffer = "";
  let chain: Promise<void> = Promise.resolve();
  socket.setEncoding("utf8");
  socket.on("error", () => socket.destroy());
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const line = buffer.slice(0, at).replace(/\r$/, "");
      buffer = buffer.slice(at + 1);
      if (line) chain = chain.then(async () => { const reply = await door.handle(line); if (!socket.destroyed) socket.write(`${reply}\n`); });
    }
    if (buffer.length > LINE_MAX) { socket.write(`${errorLine(413, "APPROVAL_DOOR_TOO_LARGE", "the line is larger than the door accepts")}\n`); socket.destroy(); }
  });
}

function listen(server: net.Server, address: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    const before = process.platform === "win32" ? null : process.umask(0o177); // the socket is created 0600
    try { server.listen(address, () => { server.off("error", reject); resolve(); }); }
    finally { if (before !== null) process.umask(before); }
  });
}

/** Whether something already answers at the address (another door, or a stale file when it does not). */
function answers(address: string): Promise<boolean> {
  return new Promise(resolve => {
    const probe = net.connect(address);
    probe.once("connect", () => { probe.destroy(); resolve(true); });
    probe.once("error", () => resolve(false));
  });
}

/** Starts serving; resolves to null when another door already holds the address. */
export async function serveDoor(door: Door, address = doorAddress(), onEmpty: () => void = () => {}, sweepMs = SWEEP_MS): Promise<net.Server | null> {
  if (process.platform !== "win32") fs.mkdirSync(path.dirname(address), { recursive: true, mode: 0o700 });
  const server = net.createServer(socket => serveConnection(door, socket));
  try { await listen(server, address); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    if (await answers(address)) return null;
    if (process.platform !== "win32") fs.rmSync(address, { force: true }); // a stale file from a door that died
    await listen(server, address);
  }
  const timer = setInterval(() => { if (door.sweep() === 0) { clearInterval(timer); server.close(); if (process.platform !== "win32") fs.rmSync(address, { force: true }); onEmpty(); } }, sweepMs);
  return server;
}

function startDoor(): void {
  const child = spawn(liveNodeExecutable(), [fileURLToPath(import.meta.url), "serve"], { detached: true, stdio: "ignore", env: process.env, windowsHide: true });
  child.on("error", () => { /* the next attempt of the registration loop reports it */ });
  child.unref();
}

function sendControl(address: string, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(address);
    let reply = "";
    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.once("connect", () => socket.write(`${line}\n`));
    socket.on("data", (chunk: string) => {
      reply += chunk;
      if (!reply.includes("\n")) return;
      socket.destroy();
      (() => { try { return (JSON.parse(reply) as { ok?: unknown }).ok === true; } catch { return false; } })() ? resolve() : reject(new Error(`door refused: ${reply.trim()}`));
    });
  });
}

/** Registers a launched or resumed seat; starts the door when none answers. A seat without a door still works, so this reports and never throws. */
export async function registerApprovalDoor(session: string, registration: SeatRegistration, address = doorAddress()): Promise<boolean> {
  const line = JSON.stringify({ aiterm_door: "register", session, port: registration.port, authorization: registration.bearer });
  let started = false, last: unknown = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    try { await sendControl(address, line); return true; }
    catch (error) {
      last = error;
      if (!started) { startDoor(); started = true; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  process.stderr.write(`aiterm approval door: registration failed: ${last instanceof Error ? last.message : String(last)}\n`);
  return false;
}

if (process.argv[2] === "serve" && fs.realpathSync(process.argv[1] ?? "") === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const door = new Door(session => tmuxCommand(false, "has-session", "-t", session).code === 0);
  serveDoor(door, doorAddress(), () => process.exit(0)).then(server => { if (!server) process.exit(0); }, error => {
    process.stderr.write(`aiterm approval door: ${error instanceof Error ? error.message : String(error)}\n`); process.exit(1);
  });
}
