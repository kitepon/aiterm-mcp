import './seat-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

// Called only after a fixture fails, before its original close/cleanup.
export async function capturePtyFailure(core, session, details = {}) {
  const report = { schema: 'aiterm.test-pty-failure.v1', session, at: Date.now(), details };
  const directory = path.resolve('test-failure-snapshots', `${process.pid}-${randomUUID()}`);
  try {
    fs.mkdirSync(directory, { recursive: true });
    const runtime = await import('../dist/tmux-runtime.js');
    const shared = await import('../dist/agent-shared.js');
    const processes = await import('../dist/process-runtime.js');
    report.before = core.observeSessionGeneration(session);
    for (const suffix of ['log', 'lastcmd', 'mark']) {
      const file = path.join(runtime.SOCKDIR, `${session}.${suffix}`);
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(directory, `pane.${suffix}`));
    }
    if (report.before.launch_id) {
      const file = shared.agentMetadataPath(session, report.before.launch_id);
      if (fs.existsSync(file)) {
        const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
        report.metadata = Object.fromEntries(['kind', 'aiterm_session', 'launch_id', 'created_at', 'agent_executable',
          'vendor_session_id', 'initial_prompt', 'initial_prompt_delivery'].map(key => [key, meta[key]]));
      }
    }
    report.observation = core.observeSession(session);
    fs.writeFileSync(path.join(directory, 'screen.txt'), await core.readOutput(session, { screen: true, raw: true }));
    if (report.observation.pane_process) {
      const rows = processes.readRuntimeProcesses();
      fs.writeFileSync(path.join(directory, 'processes.json'), JSON.stringify({
        pane_subtree: processes.processSubtree(rows, report.observation.pane_process.pid),
        launch_correlated: report.before.launch_id ? rows.filter(row => row.command.includes(report.before.launch_id)) : [],
      }, null, 2));
    }
    report.after = core.observeSessionGeneration(session);
    report.same_generation = !report.before.exists || !report.after.exists ? false
      : typeof report.before.launch_id !== 'string' || typeof report.after.launch_id !== 'string' ? null
      : report.before.launch_id === report.after.launch_id;
  } catch (error) { report.capture_error = String(error?.message ?? error); }
  try {
    report.files = fs.readdirSync(directory).map(name => {
      const bytes = fs.readFileSync(path.join(directory, name));
      return { name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    });
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  } catch (error) { report.capture_error ??= String(error?.message ?? error); }
  return { schema: report.schema, directory, same_generation: report.same_generation ?? null, capture_error: report.capture_error ?? null };
}
