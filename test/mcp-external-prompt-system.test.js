// test/mcp-external-prompt-system.test.js
//
// 0.8.4, lane C unit 5, plan C item P5: `external_prompt` returns the NEEDS file of a paused stage whole, so the SYSTEM text of
// that stage reaches the MCP client exactly as the CLI wrote it (the same text `verifiedSystemOfNeeds` reads for the dispatch bundle).
// THIS IS A PIN, NOT A RED: it passes on the source as it is, and it adds no server.js change. Limit: it shows what the tool
// RETURNS for a mock-external pause; it says nothing about how a client shows or truncates a long tool result (the tool's own
// paging, max_chars / part, is pinned elsewhere).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcpCalls } from './helpers/mcp-calls.js';

const cli = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'src', 'cli.js');
const SYS = '\n## System prompt\n\n';
const USR = '\n\n## User prompt\n\n';

test('P5 PIN: external_prompt returns the NEEDS file of a paused stage whole, its system section included byte for byte', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-p5-'));
  try {
    mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
    const r = spawnSync(process.execPath, [cli, '--chain', 'mock-external', '--task', 'tasks/x.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    assert.equal(r.status, 3, `the mock-external run did not pause: ${r.stdout}${r.stderr}`.slice(0, 500));
    const run = readdirSync(join(dir, 'runs'))[0];
    const byId = await mcpCalls(dir, [{ name: 'external_prompt', arguments: { run } }]);
    const reply = JSON.parse(byId.get(2).result.content[0].text);
    assert.ok(reply.stage, `external_prompt named no stage: ${Object.keys(reply)}`);
    // the NEEDS file of the stage the tool answered for (a run can wait on several stages; the tool answers for the first it lists)
    const needs = readFileSync(join(dir, 'runs', run, `NEEDS-${reply.stage}.md`), 'utf8');
    assert.ok(needs.includes(SYS) && needs.includes(USR), 'the NEEDS file has no system and user section');
    const system = needs.slice(needs.indexOf(SYS) + SYS.length, needs.indexOf(USR));
    assert.ok(system.trim().length > 0, 'the NEEDS file has an empty system section');
    assert.equal(reply.prompt, needs, 'the prompt field is the NEEDS file, whole');
    assert.ok(reply.prompt.includes(SYS + system + USR), 'the system section is in the reply, byte for byte');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
