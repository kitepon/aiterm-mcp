// Loaded only by isolated stdio entry acceptance after seat-env. Any native
// command or network request is a fixture failure, never a host fallback.
import childProcess from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
const blocked = () => { process.stderr.write('SYNTHETIC_NATIVE_EFFECT_REFUSED\n'); throw Error('synthetic native/network boundary refused'); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = blocked;
net.connect = blocked; net.createConnection = blocked; tls.connect = blocked; globalThis.fetch = blocked;
syncBuiltinESMExports();
