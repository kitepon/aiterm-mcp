import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const binary = process.env.AITERM_TEST_CODEX_BINARY ?? '/Applications/ChatGPT.app/Contents/Resources/codex';
const python = process.env.AITERM_TEST_PYTHON ?? '/usr/bin/python3';

class Rpc {
  constructor(send) { this.send = send; this.pending = new Map(); this.events = []; this.listeners = []; }
  receive(message) {
    if (!message.method && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
    } else {
      this.events.push(message);
      for (const listener of [...this.listeners]) listener();
    }
  }
  request(id, method, params = {}) {
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.send({ id, method, params });
    return result;
  }
  event(method, predicate = () => true, full = false) {
    return new Promise(resolve => {
      const find = () => {
        const index = this.events.findIndex(event => event.method === method && predicate(event.params));
        if (index < 0) return;
        this.listeners = this.listeners.filter(listener => listener !== find);
        const message = this.events.splice(index, 1)[0];
        resolve(full ? message : message.params);
      };
      this.listeners.push(find);
      find();
    });
  }
  async initialize() {
    await this.request(1, 'initialize', { clientInfo: { name: 'aiterm_relay_test', version: '1' } });
    this.send({ method: 'initialized' });
  }
}

function responseEvents(number, item) {
  const id = `response-${number}`;
  return [
    { type: 'response.created', response: { id } },
    { type: 'response.output_item.done', item },
    { type: 'response.completed', response: { id, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } },
  ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

for (const mode of ['delivery', 'active-disconnect']) test(mode === 'delivery'
  ? '公式署名版で中継・接続分離・Steer・終了後再開・終了処理を確認する'
  : '実行中のstdio終了は追加接続が残っていても公式サーバーを終了する', { timeout: 45_000 }, async t => {
  const root = await mkdtemp('/tmp/aiterm-relay-test-');
  const home = join(root, 'home');
  const sockets = join(root, 's');
  await mkdir(home, { mode: 0o700 });
  const binaryHashBefore = createHash('sha256').update(await readFile(binary)).digest('hex');
  const requests = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  let firstArrived;
  const firstRequest = new Promise(resolve => { firstArrived = resolve; });
  const http = createServer(async (request, response) => {
    if (request.url !== '/v1/responses') { response.writeHead(404).end(); return; }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(Buffer.concat(chunks));
    const number = requests.length;
    if (number === 1) { firstArrived(); await firstGate; }
    const item = number === 1
      ? { type: 'function_call', call_id: 'pause_once', name: 'exec_command', arguments: JSON.stringify({ cmd: 'sleep 0.1', yield_time_ms: 1000 }) }
      : number === 4
      ? { type: 'function_call', call_id: 'approval_once', name: 'exec_command', arguments: JSON.stringify({ cmd: 'touch ./must-not-exist', sandbox_permissions: 'require_escalated', justification: '試験専用の書込み要求を拒否して中継を確認する' }) }
      : { type: 'message', role: 'assistant', id: `message-${number}`, content: [{ type: 'output_text', text: number === 2 ? '実行中の回答を受信' : '終了後の回答を受信' }] };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(responseEvents(number, item));
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const baseUrl = `http://127.0.0.1:${http.address().port}`;
  await writeFile(join(home, 'config.toml'), `model = "mock-model"
model_provider = "mock_provider"
approval_policy = "never"
sandbox_mode = "read-only"
cli_auth_credentials_store = "file"
mcp_oauth_credentials_store = "file"
chatgpt_base_url = "${baseUrl}"
[model_providers.mock_provider]
name = "中継試験専用モデル"
base_url = "${baseUrl}/v1"
wire_api = "responses"
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
`, { mode: 0o600 });
  const child = spawn(python, [join(here, 'codex-relay-launch.py'), '--binary', binary, '--node', process.execPath, '--socket-root', sockets, '--', 'app-server', '--listen', 'stdio://'], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, TMPDIR: root, RUST_LOG: 'error' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stderr = [];
  child.stderr.on('data', chunk => stderr.push(chunk));
  const exited = once(child, 'exit');
  let secondary;
  t.after(async () => {
    releaseFirst();
    secondary?.terminate();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    http.closeAllConnections();
    await new Promise(resolve => http.close(resolve));
    if (t.signal.aborted || child.exitCode !== 0) process.stderr.write(Buffer.concat(stderr).toString());
    await rm(root, { recursive: true, force: true });
  });
  const parent = new Rpc(message => child.stdin.write(`${JSON.stringify(message)}\n`));
  createInterface({ input: child.stdout }).on('line', line => parent.receive(JSON.parse(line)));
  await parent.initialize();
  const socketPath = join(sockets, `${child.pid}.sock`);
  assert.equal((await stat(sockets)).mode & 0o777, 0o700);
  assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
  assert.equal(Number(execFileSync('ps', ['-p', String(child.pid), '-o', 'ppid='], { encoding: 'utf8' }).trim()), process.pid);
  assert.equal(execFileSync('ps', ['-p', String(child.pid), '-o', 'comm='], { encoding: 'utf8' }).trim(), binary);
  const thread = (await parent.request(2, 'thread/start', { cwd: root })).thread;
  secondary = new WebSocket('ws://localhost/rpc', { createConnection: () => createConnection(socketPath), perMessageDeflate: false });
  const extra = new Rpc(message => secondary.send(JSON.stringify(message)));
  secondary.on('message', data => extra.receive(JSON.parse(data.toString())));
  await once(secondary, 'open');
  await extra.initialize();
  const [listed, read] = await Promise.all([
    parent.request(42, 'thread/loaded/list'),
    extra.request(42, 'thread/read', { threadId: thread.id }),
  ]);
  assert(listed.data.includes(thread.id));
  assert.equal(read.thread.id, thread.id);
  const first = await parent.request(3, 'turn/start', { threadId: thread.id, input: [{ type: 'text', text: '試験の待機を実行' }] });
  await firstRequest;
  if (mode === 'active-disconnect') {
    child.stdin.end();
    const result = await Promise.race([
      exited.then(value => ({ exited: true, value })),
      new Promise(resolve => setTimeout(() => resolve({ exited: false }), 1500)),
    ]);
    assert.equal(result.exited, true, 'モデル応答がなくてもstdio EOFで終了する');
    assert.equal(result.value[0], 0);
    await assert.rejects(stat(socketPath), { code: 'ENOENT' });
    return;
  }
  const steered = await extra.request(3, 'turn/steer', { threadId: thread.id, expectedTurnId: first.turn.id, input: [{ type: 'text', text: 'AITERM_RELAY_ACTIVE' }] });
  assert.equal(steered.turnId, first.turn.id);
  releaseFirst();
  const firstDone = await parent.event('turn/completed', params => params.turn.id === first.turn.id);
  assert.equal(firstDone.turn.status, 'completed');
  const late = await extra.request(4, 'turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'AITERM_RELAY_LATE' }] });
  assert.notEqual(late.turn.id, first.turn.id);
  const lateDone = await parent.event('turn/completed', params => params.turn.id === late.turn.id);
  assert.equal(lateDone.turn.status, 'completed');
  const history = await extra.request(5, 'thread/read', { threadId: thread.id, includeTurns: true });
  assert.equal(history.thread.turns.length, 2);
  for (const [index, marker] of ['AITERM_RELAY_ACTIVE', 'AITERM_RELAY_LATE'].entries()) {
    const matches = history.thread.turns[index].items.filter(item => item.type === 'userMessage' && item.content.some(part => part.text === marker));
    assert.equal(matches.length, 1);
  }
  assert(JSON.stringify(JSON.parse(requests[1])).includes('AITERM_RELAY_ACTIVE'), 'Steer本文が次のモデル要求に含まれる');
  assert(JSON.stringify(JSON.parse(requests[2])).includes('AITERM_RELAY_LATE'), '終了後の本文が次のモデル要求に含まれる');
  const approvalTurn = await parent.request(7, 'turn/start', {
    threadId: thread.id, approvalPolicy: 'on-request',
    input: [{ type: 'text', text: '承認の中継を確認する' }],
  });
  const approval = await parent.event('item/commandExecution/requestApproval', () => true, true);
  parent.send({ id: approval.id, result: { decision: 'decline' } });
  const approvalDone = await parent.event('turn/completed', params => params.turn.id === approvalTurn.turn.id);
  assert.equal(approvalDone.turn.status, 'completed');
  await assert.rejects(stat(join(root, 'must-not-exist')), { code: 'ENOENT' });
  secondary.close();
  await once(secondary, 'close');
  assert((await parent.request(6, 'thread/loaded/list')).data.includes(thread.id));
  child.stdin.end();
  const [exitCode, signal] = await exited;
  assert.equal(exitCode, 0, `公式サーバーの終了: signal=${signal}`);
  await assert.rejects(stat(socketPath), { code: 'ENOENT' });
  const binaryHashAfter = createHash('sha256').update(await readFile(binary)).digest('hex');
  assert.equal(binaryHashAfter, binaryHashBefore);
  const receipt = { schema: 'aiterm.official-relay-test.v1', binary, binary_sha256: binaryHashAfter, pid_preserved: true, parent_preserved: true, rpc_id_isolation: true, steer_same_turn: true, wake_same_thread: true, markers_once: true, model_received_markers: true, approval_decline_forwarded: true, secondary_disconnect_preserves_parent: true, stdio_shutdown: true, socket_removed: true, model_requests: requests.length, actual_credentials_used: false, desktop_integration_tested: false };
  if (process.env.AITERM_RELAY_TEST_RECEIPT) await writeFile(resolve(process.env.AITERM_RELAY_TEST_RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  t.diagnostic(JSON.stringify(receipt));
});
