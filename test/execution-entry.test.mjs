import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// The only child is this isolated Node MCP, with all native/network effects
// blocked at preload. No PTY, harness CLI, live MCP or runtime default factory.
for (const symlink of [false, true]) test(`isolated stdio entry initializes the legacy 18-tool surface through ${symlink ? 'a canonicalized bin symlink' : 'its direct path'}`,
  { skip: symlink && process.platform === 'win32' ? 'POSIX bin symlink fixture' : false, timeout: 10000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'execution-entry-'));
    const direct = fileURLToPath(new URL('../dist/index.js', import.meta.url)), entry = symlink ? join(directory, 'synthetic-bin') : direct;
    if (symlink) symlinkSync(direct, entry);
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ['--import', fileURLToPath(new URL('./seat-env.mjs', import.meta.url)),
        '--import', fileURLToPath(new URL('./fixtures/execution-block-native.mjs', import.meta.url)), entry],
      cwd: directory, env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)), stderr: 'pipe' });
    const client = new Client({ name: 'synthetic-entry-client', version: 'synthetic' });
    let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      assert.equal(tools.length, 18); assert.equal(tools.some(tool => tool.name === 'agent_stop'), false);
      assert.ok(tools.some(tool => tool.name === 'agent_launch')); assert.ok(tools.some(tool => tool.name === 'pty_observe'));
    } finally {
      await client.close(); await transport.close(); rmSync(directory, { recursive: true, force: true });
    }
    assert.equal(stderr, '', 'entry acceptance must not run a native command, reporter or network request');
  });
