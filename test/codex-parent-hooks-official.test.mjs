// 公式Codexの通常stdio起動で、queueとhookによる同一ターン配送を検証する。
// 実credentialや利用中の設定は使わず、一時HOMEとローカルのモデル応答だけを使う。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureCodexSteer } from '../dist/setup-codex-hooks.js';
import { verifyCodexParent, submitCodexParentAnswer } from '../dist/codex-parent-receiver.js';
const binary = process.env.AITERM_TEST_CODEX_BINARY;

function connect(executable, root, env) {
  const child = spawn(executable, ['app-server', '-c', 'analytics.enabled=false'], {
    cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  const pending = new Map();
  const events = [];
  const listeners = new Set();
  const stderr = [];
  child.stderr.on('data', data => stderr.push(data));
  child.on('exit', (code, signal) => {
    for (const entry of pending.values()) entry.reject(new Error(`公式process終了: ${code}/${signal}; ${Buffer.concat(stderr)}`));
  });
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    if (!message.method && pending.has(message.id)) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(item.timer);
      message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
    } else {
      events.push(message);
      for (const listener of listeners) listener();
    }
  });
  let id = 0;
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`応答timeout: ${method}`)); }, 10_000);
    pending.set(key, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id: key, method, params }) + '\n');
  });
  return {
    child, request, events,
    async initialize() {
      await request('initialize', { clientInfo: { name: 'aiterm_hook_probe', version: '1' }, capabilities: { experimentalApi: true } });
      child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    },
    event(method, predicate = () => true) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(find); reject(new Error(`通知timeout: ${method}; ${Buffer.concat(stderr)}`)); }, 20_000);
        const find = () => {
          const index = events.findIndex(event => event.method === method && predicate(event.params));
          if (index < 0) return;
          clearTimeout(timer); listeners.delete(find); resolve(events.splice(index, 1)[0].params);
        };
        listeners.add(find); find();
      });
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.stdin.end();
      const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
      const result = await exited;
      clearTimeout(kill);
      for (const item of pending.values()) clearTimeout(item.timer);
      return result;
    },
  };
}

for (const mode of ['tool', 'stop', 'late', 'missing', 'transition', 'other', 'untrusted-other']) test(`公式queue＋hook: ${mode}`, { skip: !binary, timeout: 35_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'aiterm hook product '));
  const home = join(root, 'home');
  await mkdir(home, { mode: 0o700 });
  const requests = [];
  let firstArrived;
  const arrived = new Promise(resolve => { firstArrived = resolve; });
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  let hookArrived;
  const hookReady = new Promise(resolve => { hookArrived = resolve; });
  let releaseHook;
  const hookGate = new Promise(resolve => { releaseHook = resolve; });
  const http = createServer(async (request, response) => {
    if (request.url === '/hook-release') {
      hookArrived(); await hookGate; response.writeHead(200).end(); return;
    }
    if (request.url !== '/v1/responses') { response.writeHead(404).end(); return; }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    const number = requests.length;
    if (number === 1) { firstArrived(); await firstGate; }
    const item = number === 1 && (mode === 'tool' || mode === 'other')
      ? { type: 'function_call', call_id: 'probe_tool', name: 'exec_command', arguments: JSON.stringify({ cmd: process.platform === 'win32' ? 'Write-Output fixture' : 'true', yield_time_ms: 1000 }) }
      : { type: 'message', role: 'assistant', id: `message-${number}`, content: [{ type: 'output_text', text: `試験応答${number}` }] };
    const id = `response-${number}`;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end([
      { type: 'response.created', response: { id } },
      { type: 'response.output_item.done', item },
      { type: 'response.completed', response: { id, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } },
    ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const url = `http://127.0.0.1:${http.address().port}`;
  await writeFile(join(home, 'config.toml'), `model = "mock-model"
model_provider = "mock_provider"
approval_policy = "never"
sandbox_mode = "read-only"
cli_auth_credentials_store = "file"
mcp_oauth_credentials_store = "file"
chatgpt_base_url = "${url}"
[model_providers.mock_provider]
name = "配送試験専用モデル"
base_url = "${url}/v1"
wire_api = "responses"
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
`, { mode: 0o600 });
  const directory = join(root, 'aiterm');
  const hook = join(root, 'product-hook.mjs');
  const hookModule = new URL('../dist/codex-parent-hook.js', import.meta.url).href;
  const receiverModule = new URL('../dist/codex-parent-hooks.js', import.meta.url).href;
  await writeFile(hook, mode === 'transition' ? `
    import { runCodexResultHook } from ${JSON.stringify(receiverModule)};
    let input=''; for await (const chunk of process.stdin) input+=chunk;
    await runCodexResultHook(JSON.parse(input), async value => {
      if (Object.keys(value).length===0) await fetch(process.env.AITERM_HOOK_PROBE_BARRIER, {method:'POST'});
      await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(value)+'\\n', error=>error?reject(error):resolve()));
    }, {directory:process.argv[2]});
  ` : `import ${JSON.stringify(hookModule)};`);
  const setupRuntime = { platform: process.platform === 'win32' ? 'win32' : 'darwin', directory, codex_home: home,
    node: process.execPath, hook, findBinary: () => binary, processes: () => [], legacy: () => null };
  if (mode === 'untrusted-other') await writeFile(join(home, 'hooks.json'), JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command:'foreign-untrusted-command'}]}]}}));
  assert.equal((await configureCodexSteer('enable', setupRuntime)).status, 'ready');
  assert.equal((await configureCodexSteer('status', setupRuntime)).status, 'ready');
  assert(!((await readFile(join(home,'config.toml'),'utf8')).includes('bypass_hook_trust')), '通常のhook承認を使う');
  const env = { ...(process.platform === 'win32' ? {SystemRoot:process.env.SystemRoot, LOCALAPPDATA:process.env.LOCALAPPDATA, USERPROFILE:home, TEMP:root, TMP:root} : {}), PATH: process.env.PATH, HOME: home, CODEX_HOME: home, TMPDIR: root, RUST_LOG: 'error' };
  if (mode === 'transition') env.AITERM_HOOK_PROBE_BARRIER = `${url}/hook-release`;
  const parent = connect(binary, root, env);
  let sender;
  t.after(async () => {
    releaseFirst();
    releaseHook();
    await Promise.all([parent.close(), sender?.close()]);
    http.closeAllConnections();
    await new Promise(resolve => http.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  // 空のHOMEの公式DB初期化を終えてから、独立した配送processを接続する。
  await parent.initialize();
  sender = connect(binary, root, env);
  await sender.initialize();
  if (mode === 'untrusted-other') {
    const listed = await sender.request('hooks/list', {cwds:[home]});
    assert.equal(listed.data[0].hooks.find(hook=>hook.command==='foreign-untrusted-command').trustStatus,'untrusted');
  }
  const { thread } = await parent.request('thread/start', { cwd: root });
  const destination = { thread_id: thread.id, codex_home: home };
  const runtime = { executable: binary, hook_directory: directory };
  const first = await parent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: '初回の試験入力' }] });
  await arrived;
  await verifyCodexParent(destination, runtime);
  if (mode === 'missing') await rm(hook);
  if (mode === 'late') { releaseFirst(); await parent.event('turn/completed', p => p.turn.id === first.turn.id); }
  if (mode === 'transition') { releaseFirst(); await hookReady; }
  const marker = `AITERM_HOOK_${mode.toUpperCase()}`;
  if (mode === 'other') await sender.request('thread/queue/add', { threadId: thread.id, clientUserMessageId: 'human-input-probe', input: [{ type: 'text', text: 'HUMAN_QUEUED_INPUT' }] });
  await submitCodexParentAnswer(destination, '11111111-2222-4333-8444-555555555555', marker, runtime);
  releaseFirst();
  releaseHook();
  if (mode !== 'late') await parent.event('turn/completed', p => p.turn.id === first.turn.id);
  if (['late', 'missing', 'transition', 'other'].includes(mode)) await parent.event('turn/completed', p => p.turn.id !== first.turn.id);
  const history = (await parent.request('thread/read', { threadId: thread.id, includeTurns: true })).thread;
  assert.equal(history.turns.length, ['tool','stop','untrusted-other'].includes(mode) ? 1 : 2, '想定したターン数');
  assert.equal(requests.length, mode === 'other' ? 3 : 2, '投入した入力に対応したモデル呼出しだけ');
  assert.equal(JSON.stringify(requests[1]).split(marker).length - 1, 1, '本文がモデルへ一度だけ到達する');
  assert.equal((await sender.request('thread/queue/list', { threadId: thread.id })).data.length, 0);
  if (mode === 'other') {
    assert(!JSON.stringify(requests[1]).includes('HUMAN_QUEUED_INPUT'), '利用者のキュー入力をhookへ取り込まない');
    assert.equal(JSON.stringify(requests[2]).split('HUMAN_QUEUED_INPUT').length - 1, 1, '利用者の入力は通常キューで一度だけ届く');
  }
  t.diagnostic(JSON.stringify({ mode, normal_stdio: true, turns: history.turns.length, model_requests: requests.length, marker_once: true, hook_trust_bypass: false, credentials_used: false, desktop_tested: false }));
});
