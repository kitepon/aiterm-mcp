import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const actual = cp.execFileSync;
cp.execFileSync = function(command, args, options) {
  if (command === 'tmux' && args?.includes('kill-server')) {
    console.log('CLEANUP_ALIAS_CALL=' + JSON.stringify({ command, args }));
  }
  return actual.call(this, command, args, options);
};
syncBuiltinESMExports();
