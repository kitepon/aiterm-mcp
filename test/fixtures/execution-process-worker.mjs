// Synthetic IPC worker: imports no core, PTY, provider, or live runtime adapter.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileExecutionStore, executionStoreDirectory } from '../../dist/execution-store.js';
import { ExecutionService } from '../../dist/execution-service.js';

const [root, scope] = process.argv.slice(2);
if (!process.send || !root || !scope) throw new Error('fixture arguments required');
const directory = executionStoreDirectory(root, { kind: 'socket', key: scope });
const store = new FileExecutionStore(directory);
const liveFile = join(root, 'synthetic-live.json');
const readLive = () => JSON.parse(readFileSync(liveFile, 'utf8'));
const gates = new Map();
const runtime = {
  async sourceEvidence(input) {
    const source = input.reservation.source;
    return { runtime_launch: source.launch ? readLive()[source.launch.session_id] ?? null : null,
      caller_bound: true, invocation_boundary: null };
  },
  async observe(session) {
    const launch = readLive()[session];
    return launch ? { state: 'present', launch } : { state: 'absent' };
  },
  async completion() { return { state: 'completed', fence: 'closed' }; },
  async close(expected) {
    const live = readLive();
    if (JSON.stringify(live[expected.session_id]) !== JSON.stringify(expected)) throw new Error('fixture generation mismatch');
    delete live[expected.session_id];
    writeFileSync(liveFile, JSON.stringify(live));
    process.send({ event: 'close', launch: expected });
  },
  async coverage() { return 'complete'; },
};
const service = new ExecutionService(store, runtime, 150);
async function gate(id) {
  const pending = new Promise(resolve => gates.set(id, resolve));
  process.send({ event: 'entered', id });
  await pending;
}
process.on('message', async message => {
  if (message.action === 'release') { gates.get(message.id)?.(); gates.delete(message.id); return; }
  const { id } = message;
  try {
    let value;
    if (message.action === 'execute') value = await service.execute(message.input);
    else if (message.action === 'invoke') value = await service.invoke(message.ref, message.stage ?? 'send', async () => {
      await gate(id);
      return { value: 'synthetic receipt', target: message.target };
    });
    else if (message.action === 'change') value = await service.changeSession(message.expected, 'configure', async () => {
      await gate(id);
      if (message.reject) throw new Error('synthetic lost response');
      return 'configured';
    });
    else if (message.action === 'stop') value = await service.stop(message.input);
    else if (message.action === 'roots') value = await service.roots(message.input);
    else throw new Error('unsupported fixture action');
    process.send({ event: 'result', id, value });
  } catch (error) {
    process.send({ event: 'result', id, error: { code: error.code ?? 'FIXTURE_ERROR', effect: error.effect ?? null } });
  }
});
process.send({ event: 'ready', directory });
