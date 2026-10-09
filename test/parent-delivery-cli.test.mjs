// aiterm-parent-delivery（ほかの製品がAitermの親配送へ回答を頼む入口、ADR 0098）。
// 命令を別processとして起こし、返りの形と、公式Codexでの同じ番・止まっている会話への配送を確かめる。
// 公式Codexの試験は、実credentialや利用中の設定を使わず、一時HOMEとローカルのモデル応答だけを使う（codex-parent-hooks-official.test.mjsと同じ方式）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { configureCodexSteer } from '../dist/setup-codex-hooks.js';
import { codexInputDirectory } from '../dist/codex-hook-state.js';
import { pathWithNode } from '../dist/parent-delivery-cli.js';

const binary = process.env.AITERM_TEST_CODEX_BINARY;
const cli = fileURLToPath(new URL('../dist/parent-delivery-cli.js', import.meta.url));
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
// 製品側の入口（aiterm-steer-deliveryの…ViaAiterm）。公開前の版を確かめる時は、AITERM_TEST_STEER_CLIENTで組んだdist/index.jsを指す。
const client = await import(process.env.AITERM_TEST_STEER_CLIENT ? pathToFileURL(process.env.AITERM_TEST_STEER_CLIENT).href : 'aiterm-steer-delivery');
const hasClient = typeof client.submitCodexParentAnswerViaAiterm === 'function';
const THREAD = '11111111-2222-4333-8444-555555555555';
const DELIVERY = '22222222-3333-4444-8555-666666666666';

/** 命令を別processとして起こし、stdoutの1行のJSONと終了コードを返す。 */
function run(args, { env = process.env, input = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      const lines = stdout.split('\n').filter(Boolean);
      try { resolve({ code, lines: lines.length, result: JSON.parse(lines.at(-1) ?? 'null'), stderr }); }
      catch { reject(new Error(`JSONでない出力: ${stdout.slice(0, 300)} / ${stderr.slice(0, 300)}`)); }
    });
    child.stdin.end(input ?? '');
  });
}

test('provider: この命令の場所と版を返す', async () => {
  const { code, lines, result } = await run(['provider']);
  assert.equal(code, 0);
  assert.equal(lines, 1, 'stdoutは1行');
  assert.deepEqual(result, { ok: true, schema: 'aiterm.parent-delivery.v1', version, node: process.execPath, cli });
});

test('起こすCodexのPATHへ、nodeの場所が無い時だけ足す', () => {
  // npm版のCodexはnodeで動く起動役。呼ぶ側のPATHにnodeの場所が無いと起きない。
  assert.deepEqual(pathWithNode({ PATH: '/usr/bin:/bin' }, '/opt/node/bin/node', 'linux'), { key: 'PATH', value: '/opt/node/bin:/usr/bin:/bin' });
  assert.deepEqual(pathWithNode({ PATH: '/usr/bin:/opt/node/bin:/bin' }, '/opt/node/bin/node', 'linux'), { key: 'PATH', value: '/usr/bin:/opt/node/bin:/bin' }, '既にあれば並びを変えない');
  assert.deepEqual(pathWithNode({}, '/opt/node/bin/node', 'linux'), { key: 'PATH', value: '/opt/node/bin' });
  assert.deepEqual(pathWithNode({ PATH: '' }, '/opt/node/bin/node', 'darwin'), { key: 'PATH', value: '/opt/node/bin' });
  // Windowsは変数名も場所も大文字小文字を区別しない。
  assert.deepEqual(pathWithNode({ Path: 'C:\\Windows\\System32' }, 'C:\\Program Files\\nodejs\\node.exe', 'win32'),
    { key: 'Path', value: 'C:\\Program Files\\nodejs;C:\\Windows\\System32' });
  assert.deepEqual(pathWithNode({ Path: 'c:\\program files\\NODEJS;C:\\Windows' }, 'C:\\Program Files\\nodejs\\node.exe', 'win32'),
    { key: 'Path', value: 'c:\\program files\\NODEJS;C:\\Windows' });
});

test('使い方の誤りは、何も送らずに理由つきで断る', async () => {
  const cases = [
    [[], /対応する親は codex だけ/],
    [['claude', 'submit'], /対応する親は codex だけ/],
    [['codex', 'send', '--thread', THREAD], /未対応のcommand/],
    [['codex', 'verify'], /--thread は必須/],
    [['codex', 'verify', '--thread', 'not-a-uuid'], /--thread はUUID/],
    [['codex', 'verify', '--thread', THREAD, '--codex-home', 'relative/home'], /--codex-home は絶対path/],
    [['codex', 'submit', '--thread', THREAD, '--text-file', '-'], /--delivery は必須/],
    [['codex', 'submit', '--thread', THREAD, '--delivery', DELIVERY], /--text-file は必須/],
    [['codex', 'state', '--thread', THREAD], /--delivery は必須/],
  ];
  for (const [args, message] of cases) {
    const { code, result } = await run(args);
    assert.equal(code, 1, args.join(' '));
    assert.equal(result.ok, false);
    assert.equal(result.schema, 'aiterm.parent-delivery.v1');
    assert.equal(result.code, 'PARENT_DELIVERY_USAGE', args.join(' '));
    assert.match(result.message, message);
    assert.equal(result.outcome_unknown, false);
  }
});

test('空の本文は送らずに断る', async () => {
  const home = await mkdtemp(join(tmpdir(), 'aiterm-pd-empty-'));
  try {
    const { code, result } = await run(['codex', 'submit', '--thread', THREAD, '--delivery', DELIVERY, '--text-file', '-', '--codex-home', home], { input: '' });
    assert.equal(code, 1);
    assert.equal(result.code, 'PARENT_DELIVERY_USAGE');
    assert.match(result.message, /本文が空です。文字列は送っていません。/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('寝ている会話を起こした結果が残っていれば、届き方の事実と一緒に返す', async () => {
  const home = await mkdtemp(join(tmpdir(), 'aiterm-pd-wake-'));
  try {
    const wake = { delivery_id: DELIVERY, thread_id: THREAD, outcome: 'woken', turn: 'completed', checked_at: '2026-10-09T13:00:15.000Z', opened_at: '2026-10-09T13:00:15.500Z' };
    const directory = join(home, '.config', 'aiterm-mcp', 'codex-parent-hooks', 'wake');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${DELIVERY}.json`), JSON.stringify(wake));
    const env = { HOME: home, USERPROFILE: home, PATH: '' };
    const { code, result } = await run(['codex', 'state', '--thread', THREAD, '--delivery', DELIVERY, '--codex-home', home], { env });
    assert.equal(code, 0);
    assert.deepEqual(result, { ok: true, schema: 'aiterm.parent-delivery.v1', state: null, hook: null, turn_id: null, queued: null, queue_error: 'CODEX_RECEIVER_UNAVAILABLE', wake });
    // 結果の無い配送は、今までと同じ形（wakeを付けない）。
    const other = await run(['codex', 'state', '--thread', THREAD, '--delivery', '99999999-9999-4999-8999-999999999999', '--codex-home', home], { env });
    assert.equal('wake' in other.result, false);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('配送の記録が無く、公式キューも読めない時は、分からない所を分からないと返す', async () => {
  const home = await mkdtemp(join(tmpdir(), 'aiterm-pd-state-'));
  try {
    // Codexの実行ファイルが無い環境（PATHもCODEX_BINも外す）。
    const { code, result } = await run(['codex', 'state', '--thread', THREAD, '--delivery', DELIVERY, '--codex-home', home], { env: { HOME: home, PATH: '' } });
    assert.equal(code, 0);
    assert.deepEqual(result, { ok: true, schema: 'aiterm.parent-delivery.v1', state: null, hook: null, turn_id: null, queued: null, queue_error: 'CODEX_RECEIVER_UNAVAILABLE' });
  } finally { await rm(home, { recursive: true, force: true }); }
});

function connect(executable, root, env) {
  const child = spawn(executable, ['app-server', '-c', 'analytics.enabled=false'], { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'close');
  const pending = new Map();
  const events = [];
  const listeners = new Set();
  const stderr = [];
  child.stderr.on('data', data => stderr.push(data));
  child.on('exit', (code, signal) => { for (const entry of pending.values()) entry.reject(new Error(`公式process終了: ${code}/${signal}; ${Buffer.concat(stderr)}`)); });
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    if (!message.method && pending.has(message.id)) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(item.timer);
      message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
    } else { events.push(message); for (const listener of listeners) listener(); }
  });
  let id = 0;
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`応答timeout: ${method}`)); }, 10_000);
    pending.set(key, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id: key, method, params }) + '\n');
  });
  return {
    request, events,
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
      await exited;
      clearTimeout(kill);
      for (const item of pending.values()) clearTimeout(item.timer);
    },
  };
}

// running: 親の番が動いている間に頼む（hookが同じ番へ入れる）。idle: 番が終わってから頼む（公式キューが会話を起こす）。
// queue-only: Aitermのhookを入れていないCodex環境（steerはdisabledと返り、番が終わってから届く）。
// via cli: 命令を直に起こす。via package: 製品が使う入口（aiterm-steer-deliveryの…ViaAiterm）から頼む。
// via cli-bare: 呼ぶ側のPATHにnodeの場所が無い（製品の常駐processやアプリ配下のprocess）。nodeで動くCodexの起動役も起こせる事。
for (const [via, mode] of [['cli', 'running'], ['cli', 'idle'], ['cli', 'queue-only'], ['cli-bare', 'queue-only'], ['package', 'running'], ['package', 'idle']])
test(`公式Codexへ別processから頼む: ${mode}（${via}）`, { skip: !binary ? true : via === 'package' && !hasClient ? '入っているaiterm-steer-deliveryに製品側の入口が無い' : false, timeout: 45_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'aiterm pd product '));
  const home = join(root, 'home');
  await mkdir(home, { mode: 0o700 });
  const requests = [];
  let firstArrived;
  const arrived = new Promise(resolve => { firstArrived = resolve; });
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const http = createServer(async (request, response) => {
    if (request.url !== '/v1/responses') { response.writeHead(404).end(); return; }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    const number = requests.length;
    if (number === 1) { firstArrived(); await firstGate; }
    // 1回目だけ道具を呼ばせ、PostToolUseのhookを走らせる。
    const item = number === 1
      ? { type: 'function_call', call_id: 'probe_tool', namespace: 'mcp__aiterm_hook_probe', name: 'read', arguments: '{}' }
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
  const probe = join(root, 'mcp-probe.mjs');
  await writeFile(probe, `
    import {createInterface} from 'node:readline';
    createInterface({input:process.stdin}).on('line',line=>{
      const request=JSON.parse(line); if(request.id===undefined)return;
      const result=request.method==='initialize'
        ? {protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'aiterm_hook_probe',version:'1'}}
        : request.method==='tools/list'
          ? {tools:[{name:'read',description:'試験用の固定文字列を返す',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}]}
          : request.method==='tools/call' ? {content:[{type:'text',text:'fixture'}]} : {};
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
    });
  `);
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
[mcp_servers.aiterm_hook_probe]
command = ${JSON.stringify(process.execPath)}
args = [${JSON.stringify(probe)}]
`, { mode: 0o600 });
  // 命令は既定の置き場（HOMEの下の .config/aiterm-mcp/codex-parent-hooks）を読む。試験のHOMEの下へ、aiterm-setupと同じ登録を作る。
  const directory = join(home, '.config', 'aiterm-mcp', 'codex-parent-hooks');
  const hook = fileURLToPath(new URL('../dist/codex-parent-hook.js', import.meta.url));
  if (mode !== 'queue-only') {
    const setupRuntime = { platform: process.platform === 'win32' ? 'win32' : 'darwin', directory, codex_home: home,
      node: process.execPath, hook, findBinary: () => binary, processes: () => [], legacy: () => null };
    assert.equal((await configureCodexSteer('enable', setupRuntime)).status, 'ready');
  }
  const env = { ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT, LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: home, TEMP: root, TMP: root } : {}),
    PATH: process.env.PATH, HOME: home, CODEX_HOME: home, TMPDIR: root, RUST_LOG: 'error',
    // この環境は一から組む。見張りを止める印（test/seat-env.mjs）を、ここでも渡す。
    AITERM_STEER_CODEX_WAKE: '0' };
  // 頼む側のprocessの環境。Codexの実行ファイルは、hookの設定（binary）か、無ければPATHから探す。
  const barePath = process.platform === 'win32' ? `${process.env.SystemRoot}\\System32` : '/usr/bin:/bin';
  const callerEnv = { ...env, ...(mode === 'queue-only' ? { CODEX_BIN: binary } : {}), ...(via === 'cli-bare' ? { PATH: barePath } : {}) };
  const parent = connect(binary, root, env);
  t.after(async () => {
    releaseFirst();
    await parent.close();
    http.closeAllConnections();
    await new Promise(resolve => http.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  await parent.initialize();
  const { thread } = await parent.request('thread/start', { cwd: root });
  const target = ['--thread', thread.id, '--codex-home', home];
  const destination = { thread_id: thread.id, codex_home: home };
  const options = { cli, env: callerEnv };
  // どちらの道も、同じ形（確かめ・受け付け・届き方の事実・断りの理由）へ揃えて見る。
  const call = via !== 'package' ? {
    verify: async () => { const out = await run(['codex', 'verify', ...target], { env: callerEnv }); assert.equal(out.code, 0, JSON.stringify(out)); assert.equal(out.result.verified, true); return { thread: out.result.thread, steer: out.result.steer }; },
    submit: async text => { const out = await run(['codex', 'submit', ...target, '--delivery', DELIVERY, '--text-file', '-'], { env: callerEnv, input: text }); return out.code === 0 ? { queued_submission_id: out.result.queued_submission_id } : { refused: out.result.code, message: out.result.message, outcome_unknown: out.result.outcome_unknown }; },
    detail: async () => { const { ok, schema, ...rest } = (await run(['codex', 'state', ...target, '--delivery', DELIVERY], { env: callerEnv })).result; assert.deepEqual([ok, schema], [true, 'aiterm.parent-delivery.v1']); return rest; },
  } : {
    verify: () => client.verifyCodexParentViaAiterm(destination, options),
    submit: text => client.submitCodexParentAnswerViaAiterm(destination, DELIVERY, text, options)
      .catch(error => ({ refused: error.delivery_code, message: error.message, outcome_unknown: error.outcome_unknown })),
    detail: () => client.codexDeliveryDetailViaAiterm(destination, DELIVERY, options),
  };
  const first = await parent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: '初回の試験入力' }] });
  await arrived;

  const verified = await call.verify();
  assert.equal(verified.thread.thread_id, thread.id);
  assert.equal(verified.steer, mode === 'queue-only' ? 'disabled' : 'enabled');

  if (mode === 'idle') { releaseFirst(); await parent.event('turn/completed', p => p.turn.id === first.turn.id); }
  const marker = `AITERM_PARENT_DELIVERY_${mode.toUpperCase().replace('-', '_')}`;
  const submitted = await call.submit(marker);
  assert.equal(typeof submitted.queued_submission_id, 'string', JSON.stringify(submitted));
  if (mode !== 'idle') {
    // 受け付けた直後（親の番はまだ止めてある）: 公式キューに残っていて、hookはまだ入れていない。届いたとは言わない。
    assert.deepEqual(await call.detail(), { state: null, hook: mode === 'running' ? 'pending' : null, turn_id: null, queued: true });
  }
  if (mode !== 'queue-only') {
    // 同じ配送idをもう一度頼むと、送らずに断る（Aitermのhookの置き場に所有記録がある）。
    const again = await call.submit(`${marker}_AGAIN`);
    assert.equal(again.refused, 'PARENT_DELIVERY_DUPLICATE', JSON.stringify(again));
    assert.match(again.message, /文字列は送っていません/);
    assert.equal(again.outcome_unknown, false);
  }
  releaseFirst();
  if (mode !== 'idle') await parent.event('turn/completed', p => p.turn.id === first.turn.id);
  if (mode !== 'running') await parent.event('turn/completed', p => p.turn.id !== first.turn.id);

  if (mode === 'running') {
    // キューによる次の番の開始を、同じ番への配送と取り違えない。
    const claim = JSON.parse(await readFile(join(codexInputDirectory(directory, home, thread.id), 'claims', `${DELIVERY}.json`), 'utf8'));
    assert.equal(claim.state, 'emitted');
    assert.equal(claim.turn_id, first.turn.id, 'hookが最初の番へ回答を渡した');
  }
  const history = (await parent.request('thread/read', { threadId: thread.id, includeTurns: true })).thread;
  assert.equal(history.turns.length, mode === 'running' ? 1 : 2, '想定した番の数');
  assert.equal(requests.length, mode === 'running' ? 2 : 3, '投入した入力に対応したモデル呼出しだけ');
  assert.equal(JSON.stringify(requests.at(-1)).split(marker).length - 1, 1, '本文がモデルへ一度だけ到達する');
  const state = await call.detail();
  // running: hookが最初の番へ入れた事が残る。idle・queue-only: 公式キューが会話へ渡した（キューにもう無い。hookは入れていない）。
  assert.equal(state.state, null, '渡し終えた配送に、途中の状態は残らない');
  assert.equal(state.queued, false);
  if (mode === 'running') assert.deepEqual([state.hook, state.turn_id], ['emitted', first.turn.id]);
  else assert.notEqual(state.hook, 'emitted', 'キューが渡した配送を、同じ番へ入れたと言わない');
  t.diagnostic(JSON.stringify({ mode, via, separate_process: true, turns: history.turns.length, model_requests: requests.length, marker_once: true, credentials_used: false }));
});
