// A start_run child is recorded like every other child the server spawns (14 Oct 2026; the ENOTEMPTY of test/mcp-tool-latency.test.js, seen again after f17f7b7). The server writes `.spawn.json` ({ pid }) into the run folder
// at every spawn it makes (src/run-status.js SPAWN_FILE) so a reader can tell a live child from a gone one and a teardown can WAIT for it. On start_run the child makes its own run folder after the spawn, so the record at the
// spawn was skipped and nothing could wait for that child: a client (or a test) that saw the run pause removed or reused the folder while the child was still writing its last files.
// $0, offline: the mock-external chain pauses at its external builder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mcpCalls } from './helpers/mcp-calls.js';

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('start_run records its detached child in the run folder (.spawn.json holds the pid the child ran as), so a teardown can wait for it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spawn-record-')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  const answers = await mcpCalls(dir, [{ name: 'start_run', arguments: { chain: 'mock-external', task: 'tasks/t.md', max_usd: 5 } }]);
  const started = JSON.parse(answers.get(2).result.content[0].text);
  assert.equal(started.started, true, JSON.stringify(started));
  const file = join(dir, 'runs', started.run, '.spawn.json');
  assert.ok(existsSync(file), 'the start_run child was not recorded: nothing can wait for it');
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(Number.isInteger(rec.pid) && rec.pid > 0, JSON.stringify(rec));
  // the recorded child is waitable: it exits on its own (the mock-external run pauses and ends with exit 3)
  for (let i = 0; i < 200 && alive(rec.pid); i++) await sleep(50);
  assert.equal(alive(rec.pid), false, `the recorded child (pid ${rec.pid}) is still running`);
});
