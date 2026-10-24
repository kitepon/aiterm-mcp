// Diagnostic checkout only: no calls before the original argv miss/read/pane check.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const helper = path.join(process.cwd(), 'diagnostic-harness/scripts/windows-console-input-observe.ps1');
const script = fs.readFileSync(helper, 'utf8').replaceAll('\r\n', '\n');
const begin = script.indexOf("Add-Type -TypeDefinition @'\n"), end = script.indexOf("\n'@", begin);
assert.ok(begin > 0 && end > begin);
fs.mkdirSync('.ci-tools', { recursive: true });
fs.writeFileSync('.ci-tools/console-input-type.cs', script.slice(begin + "Add-Type -TypeDefinition @'\n".length, end));
const file = 'test/core-agent-support.mjs';
let source = fs.readFileSync(file, 'utf8');
const marker = '  t.diagnostic(JSON.stringify(diagnostic));';
assert.equal(source.split(marker).length, 2);
source = source.replace(marker, `
  if (diagnostic.same_generation === true && expectedAnchor === anchor() && sameLaunch()) {
    const pane = runtime.tmuxCommand(false, 'display-message', '-p', '-t', sid, '#{pane_pid}');
    const pid = Number(pane.stdout.trim());
    const [serverPid, creation] = expectedAnchor.split(':');
    if (pane.code === 0 && Number.isInteger(pid) && pid > 0 && expectedAnchor === anchor() && sameLaunch()) {
      const began = performance.now();
      const probe = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', ${JSON.stringify(helper)},
        '-PaneProcessId', String(pid), '-ServerProcessId', serverPid, '-ServerCreation', creation],
        { encoding: 'utf8', timeout: 5000, windowsHide: true });
      diagnostic.console_probe = { milliseconds: Math.round(performance.now() - began), status: probe.status,
        error_code: probe.error?.code ?? null, stderr_present: !!probe.stderr,
        same_generation_after: expectedAnchor === anchor() && sameLaunch() };
      try { diagnostic.console_probe.observation = JSON.parse(probe.stdout.trim()); } catch {}
      try {
        const phases = fs.readFileSync(argvInvocationFile, 'utf8').split(/\\r?\\n/);
        diagnostic.console_probe.later_cli_started = phases.includes('START ' + sid + ' ' + launchId);
        diagnostic.console_probe.later_cli_ended = phases.includes('END ' + sid + ' ' + launchId);
        diagnostic.console_probe.later_log = stats(fs.readFileSync(sessionLogPath(sid), 'utf8'));
      } catch {}
    }
  }
` + marker);
fs.writeFileSync(file, source);
console.log('console_miss_observer=read-only-count-and-mode-after-original5s-miss-only');
