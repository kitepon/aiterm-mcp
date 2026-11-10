// A stdio MCP server that relays every message to one streamable-HTTP MCP server.
// Codex merges `-c mcp_servers.NAME={...}` key by key into the user's table of that name, so a seat's http server
// cannot replace a user stdio server (`command` + `url` is refused). The seat instead takes over that stdio entry
// with this relay (codex.ts codexMcpOverrides), leaving ~/.codex/config.toml untouched.
// argv: <url> then pairs: --header NAME=VALUE (literal) | --env-header NAME=ENV | --bearer-env ENV
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isJSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";

const fail = (message: string): never => { process.stderr.write(`aiterm mcp bridge: ${message}\n`); process.exit(1); };

function bridgeHeaders(args: string[], env: NodeJS.ProcessEnv): Record<string, string> {
  const headers: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = [args[i], args[i + 1] ?? ""];
    const eq = value.indexOf("=");
    const envValue = (name: string) => env[name] ?? fail(`${name} has no value`);
    if (flag === "--bearer-env") headers.Authorization = `Bearer ${envValue(value)}`;
    else if (flag === "--header" && eq > 0) headers[value.slice(0, eq)] = value.slice(eq + 1);
    else if (flag === "--env-header" && eq > 0) headers[value.slice(0, eq)] = envValue(value.slice(eq + 1));
    else fail(`unknown argument ${flag}`);
  }
  return headers;
}

const [url, ...rest] = process.argv.slice(2);
const remote = new StreamableHTTPClientTransport(new URL(url ?? fail("no url")), { requestInit: { headers: bridgeHeaders(rest, process.env) } });
const local = new StdioServerTransport();
local.onmessage = message => void remote.send(message).catch((error: Error) => {
  // A request the server never answered would hang the Codex tool call; answer it with the transport error.
  if (isJSONRPCRequest(message)) void local.send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: `aiterm mcp bridge: ${error.message}` } });
});
remote.onmessage = message => {
  const version = (message as { result?: { protocolVersion?: unknown } }).result?.protocolVersion;
  if (typeof version === "string") remote.setProtocolVersion(version);
  void local.send(message);
};
remote.onerror = error => process.stderr.write(`aiterm mcp bridge: ${error.message}\n`);
// Codex closing our stdin ends the seat's use of the server; an open SSE stream must not keep this process alive.
const stop = () => void remote.close().finally(() => process.exit(0));
local.onclose = stop;
process.stdin.on("end", stop);
await remote.start();
await local.start();
