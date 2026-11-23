// test/persona-needs-file.test.js
//
// 0.8.4, lane C unit 5, plan C item P4 (the NEEDS file an external seat is shown): a persona in a seat's system text reaches the NEEDS file, in two legs.
// (a) IN PROCESS, with the drafted words injected (setHeldForTest does not cross a process boundary): a run that pauses at an external judge gives a pause whose
//     system text carries the seat's title.
// (b) SPAWNED, through the real CLI, with no held words (text recorded today): the "## System prompt" section of the NEEDS file the CLI wrote is exactly the
//     system text the same run pauses with in process without held words, and it is the text the run recorded (verifiedSystemOfNeeds, src/stage-instructions.js: that last assert fails by name on a tree without D8).
// THIS IS A PIN: both legs pass on the source as it is (src/cli.js already writes "## System prompt" + p.system). Limit: the title reaches a NEEDS file only
// after the held words are recorded in src/roles.js; today's NEEDS file carries no title. The MCP side (external_prompt returns this file whole, server.js) waits for plan A's #26.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setCache, setBudget, setPromptSpy, pendingPauses } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { seatTitleBlock } from './held-prompts/held-084-c.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
afterEach(() => { setHeldForTest(null); setCache(null); setBudget(null); setPromptSpy(null); });

// mock-debate with an external judge that carries a name, under a unanimous panel with the persona switch on (title form)
const chainConfig = () => {
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  return { ...base, name: 'persona-needs', maxRounds: 2, signoff: 'unanimous', seat_personas: { enabled: true, form: 'title' },
    seats: { ...base.seats, critics: [{ provider: 'external', model: 'claude-code-session', lab: 'e1', persona: 'Moses' }] } };
};
async function pauseOf(cfg) {
  try { await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-needs', config: cfg }); } catch (err) {
    const found = pendingPauses(err).find(p => p.label === 'panel-1-e1');
    if (found) return found;
    throw err;
  }
  assert.fail('the run did not pause at the external judge');
}

test('P4 leg (a), injected: the pause of an external judge carries the seat\'s title in its system text', async () => {
  setHeldForTest({ seatTitleBlock });
  const p = await pauseOf(chainConfig());
  assert.ok(p.system.includes(seatTitleBlock({ name: 'Moses', job: 'judge' })), 'the title is in the system text the NEEDS file will print');
});

test('P4 leg (b), spawned: the "## System prompt" section of the NEEDS file is the system text of the same pause in process, and the run recorded it', async () => {
  const inProcess = await pauseOf(chainConfig());
  const dir = mkdtempSync(join(tmpdir(), 'thc-needs-'));
  try {
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 'x.md'), 'A mock task.');
    writeFileSync(join(dir, 'chains', 'persona-needs.json'), JSON.stringify(chainConfig()));
    const r = spawnSync('node', [cli, '--chain', 'persona-needs', '--task', 'tasks/x.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    assert.ok(existsSync(join(runDir, 'NEEDS-panel-1-e1.md')), readdirSync(runDir).join(', '));
    const needs = readFileSync(join(runDir, 'NEEDS-panel-1-e1.md'), 'utf8');
    const at = needs.indexOf('\n## System prompt\n\n');
    const end = needs.indexOf('\n\n## User prompt\n\n', at);
    assert.ok(at >= 0 && end > at, 'the NEEDS file has both prompt sections');
    assert.equal(needs.slice(at + '\n## System prompt\n\n'.length, end), inProcess.system);
    const SI = await import('../src/stage-instructions.js').catch(() => null);
    assert.ok(SI, 'src/stage-instructions.js does not exist on this tree');
    const v = SI.verifiedSystemOfNeeds(needs, readFileSync(join(runDir, 'panel-1-e1.prompt.json'), 'utf8'));
    assert.equal(v.system, inProcess.system, `the run's own record accepts the NEEDS file's system text (refused: ${v.refused})`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
