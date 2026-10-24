import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
const productRoot = process.env.GITHUB_WORKSPACE || process.cwd();
export const logDirectory = fileURLToPath(new URL('./.diagnostic-workers/', import.meta.url));
function prepare(worker) {
  let source = fs.readFileSync(path.join(productRoot, 'dist/psmux-send-worker.js'), 'utf8');
  const final = 'await sendCommand(port, key, `display-message -p ${completionMarker}`, completionMarker);';
  assert.ok(source.includes(final));
  source = source.replace(final, "await sendCommand(port, key, `display-message -p '${completionMarker}|#{pid}|#{session_name}|#{pane_pid}|#{pane_dead}|#{pane_in_mode}|#{pane_current_command}'`, completionMarker);");
  const signature = 'socket.on("end", () => {';
  assert.ok(source.includes(signature));
  source = source.replace(signature, signature + `
      if (expectedResponse) {
        const identity = response.split(/\\r?\\n/).find(line => line.startsWith(expectedResponse + '|'))?.split('|');
        fs.appendFileSync(path.join(process.cwd(), 'transport-worker-' + process.pid + '.jsonl'), JSON.stringify({
          operation: 'endpoint-response', expectedMarker: response.includes(expectedResponse),
          serverPid: identity?.[1] ?? null, serverSession: identity?.[2] ?? null,
          panePid: identity?.[3] ?? null, paneDead: identity?.[4] ?? null,
          paneMode: identity?.[5] ?? null, paneCommand: identity?.[6] ?? null
        }) + '\\n');
      }
  `);
  const readPort = 'const portText = fs.readFileSync(path.join(dir, `${sessionBase}.port`), "utf8").trim();';
  assert.ok(source.includes(readPort));
  source = source.replace(readPort, readPort + `
    const anchor = fs.readFileSync(path.join(dir, sessionBase + '.pid'), 'utf8').trim();
    const match = /AITERM_AGENT_LAUNCH_ID=['"]?([0-9a-f]{32})/.exec(payload.toString('utf8'));
    fs.appendFileSync(path.join(process.cwd(), 'transport-worker-' + process.pid + '.jsonl'), JSON.stringify({
      operation: 'endpoint-registry', sessionBase, port: Number(portText), anchor,
      launchId: match?.[1] ?? null, inputBytes: payload.length
    }) + '\\n');
  `);

  source = source.replaceAll("path.join(process.cwd(), 'transport-worker-' + process.pid + '.jsonl')", `path.join(${JSON.stringify(logDirectory)}, 'transport-worker-' + process.pid + '.jsonl')`);
  fs.writeFileSync(worker, source);
}
export function installTransportTrace() {
  const actual = cp.spawnSync;
  const worker = path.join(logDirectory, 'instrumented-worker-' + process.pid + '.mjs');
  let prepared = false;
  cp.spawnSync = function(command, args, options) {
    if (args?.[0]?.endsWith('psmux-send-worker.js') && options?.input && Buffer.from(options.input).includes(Buffer.from('AITERM_AGENT_LAUNCH_ID='))) {
      if (!prepared) { fs.mkdirSync(logDirectory, { recursive: true }); prepare(worker); prepared = true; }
      return actual.call(this, command, [worker, ...args.slice(1)], options);
    }
    return actual.call(this, command, args, options);
  };
  syncBuiltinESMExports();
  return () => { cp.spawnSync = actual; syncBuiltinESMExports(); };
}
