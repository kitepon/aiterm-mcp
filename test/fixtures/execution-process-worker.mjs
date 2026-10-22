// Synthetic IPC worker: imports no core, PTY, provider, or live runtime adapter.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileExecutionStore, executionStoreDirectory } from '../../dist/execution-store.js';
import { ExecutionService } from '../../dist/execution-service.js';
import { createExecutionParentAdapter } from '../../dist/execution-parent.js';
import { createParentNativeAdmission } from '../../dist/execution-parent-native.js';

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
  observeSync(session) {
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
const service = new ExecutionService(store, runtime, 2000);
const observeNative = session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id,
  exists: !!readLive()[session_id], launch_id: readLive()[session_id]?.launch_id ?? null });
const verifyEndpoint = (_, endpoint) => endpoint.thread_id === 'synthetic-existing-parent-thread';
const parent = createExecutionParentAdapter({ store, service, observeSessionGeneration: observeNative, verifyParentEndpoint: verifyEndpoint });
const native = createParentNativeAdmission({ store, actor: { pid: process.pid, started_identity: 'synthetic-worker-start' },
  observeSessionGenerationSync: observeNative, verifyParentEndpoint: verifyEndpoint });
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
    else if (message.action === 'invokeDeferred') value = await service.invokeDeferred(message.ref, message.stage ?? 'send', async issue => {
      if (!message.issueBeforeGate) await gate(id);
      issue(); process.send({ event: 'native-effect', id });
      if (message.issueBeforeGate) await gate(id);
      return { value: 'synthetic receipt', target: message.target };
    }, message.target.launch.session_id);
    else if (message.action === 'change') value = await service.changeSession(message.expected, 'configure', async () => {
      await gate(id);
      if (message.reject) throw new Error('synthetic lost response');
      return 'configured';
    });
    // Historical destructive admission fixture, not the stop control v2.
    else if (message.action === 'stop') value = await service.closeCascade(message.input);
    else if (message.action === 'roots') value = await service.roots(message.input);
    else if (message.action === 'seedParent') {
      const record = await service.execute(message.input);
      const ref = { schema: 'aiterm.execution-ref.v1', request: record.reservation.request };
      await service.invoke(ref, 'send', async () => ({ value: null, target: message.child }));
      await parent.bind(message.delivery, record.reservation.request, message.child, message.endpoint);
      value = await parent.submit(message.delivery, message.endpoint, async (_, __, issue) => { issue(); return { queued_submission_id: 'synthetic-queue-receipt' }; });
    } else if (message.action === 'parentNative') value = await native.run(message.delivery, message.stage, message.endpoint, async (_, issue) => {
      if (!message.issueBeforeGate) await gate(id);
      issue(); process.send({ event: 'native-effect', id });
      if (message.issueBeforeGate) await gate(id);
      return 'synthetic-parent-native-receipt';
    });
    else throw new Error('unsupported fixture action');
    process.send({ event: 'result', id, value });
  } catch (error) {
    process.send({ event: 'result', id, error: { code: error.code ?? 'FIXTURE_ERROR', effect: error.effect ?? null } });
  }
});
process.send({ event: 'ready', directory });
