// The server itself (src/mcp/server.js, 13 Oct 2026, audit item 1): a set but unreadable COUNCIL_MAX_USD_LIMIT stops it at start, before any tool exists, with the sentence on stderr and exit 2.
// With the old reading it started with NO limit, and a client's start_run max_usd 25 (or "none") ran at 25. The server is started with its stdin closed: a healthy one starts and ends at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const server = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp', 'server.js');
function start(limit) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-usdlimit-'));
  const env = { PATH: process.env.PATH, HOME: dir, COUNCIL_WORKDIR: dir, ...malformedProviderKeys(), ...(limit === undefined ? {} : { COUNCIL_MAX_USD_LIMIT: limit }) };
  const r = spawnSync(process.execPath, args(), { cwd: dir, env, input: '', encoding: 'utf8', timeout: 30_000 });
  return { status: r.status, signal: r.signal, stderr: r.stderr };
}
const cliPath = join(dirname(server), '..', 'cli.js');
let args = () => [server];

test('a set but unreadable limit stops the server at start (exit 2, the sentence on stderr): "$2", "1,50", "abc", "0", "-3"', () => {
  for (const raw of ['$2', '1,50', 'abc', '0', '-3']) {
    const r = start(raw);
    assert.equal(r.status, 2, `${JSON.stringify(raw)}: ${r.stderr}`);
    assert.ok(r.stderr.includes('COUNCIL_MAX_USD_LIMIT') && r.stderr.includes(`"${raw}"`) && /did not start/.test(r.stderr), r.stderr);
  }
});

test('the unexpanded ${user_config.max_usd} placeholder stops the server too, by default', () => {
  const r = start('${user_config.max_usd}');
  assert.equal(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('Spend ceiling per run (USD)'), r.stderr);
});

test('an empty limit, no limit, and a readable limit all start the server', () => {
  for (const raw of [undefined, '', '5', '2.50']) {
    const r = start(raw);
    assert.equal(r.status, 0, `${JSON.stringify(raw)} started and ended with the closed stdin: ${r.stderr}`);
    assert.equal(r.signal, null, 'it exited by itself (a hang would have been killed at 30 s)');
    assert.ok(!/did not start/.test(r.stderr), r.stderr);
  }
});

test('the same refusal through the npm entry point (`cli.js --mcp`), and a bad limit in the environment does not stop any other council command', () => {
  args = () => [cliPath, '--mcp'];
  try {
    const r = start('$2');
    assert.equal(r.status, 2, r.stderr);
    assert.ok(/did not start/.test(r.stderr), r.stderr);
    args = () => [cliPath, '--version'];
    const v = start('$2');
    assert.equal(v.status, 0, `--version with a bad limit in the environment: ${v.stderr}`);
  } finally { args = () => [server]; }
});
