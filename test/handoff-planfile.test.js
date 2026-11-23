// 0.8.4 D3 (plan A T2.6, T3.3 entry 8): the handoff prompt names the file the CLI actually writes. Today it says `PLAN.md` while the CLI writes `deliverable.md`. The proposed name is held (handoffPlanFileName in
// test/held-prompts/held-084-a.js) and recorded at the one re-record; until then every handoff prompt says `PLAN.md`, byte for byte. A chain's own `handoffPlanFile` always wins. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handoffPrompt, handoffPlanFileOf } from '../src/handoff-prompt.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as R from '../src/roles.js';
import { handoffPlanFileName } from './held-prompts/held-084-a.js';

afterEach(() => setHeldForTest(null));
const F = { request: 'Plan a CLI.', draft: '# Plan\n\n1. Step.\n', checks: '' };
const userOf = config => handoffPrompt({ config, ...F, planFile: handoffPlanFileOf(config), criteria: ['A'] }).user;
const SAVED = name => `It will be saved next to the handoff as \`${name}\`; refer to it by that name and its section numbers.`;

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: 'before the name is recorded: PLAN.md ... byte for byte what the shared prompts give'. NEW: that held row is removed (K7, SIBLING: 'with the name recorded', which asserts deliverable.md in both forms); its two equalities move to the recorded name (K5): the default is `deliverable.md` for {} and undefined, and the default user prompt is R.handoffUser with that name. WHY: handoffPlanFileName is recorded (recorded-084-a.js).
test('with the name recorded (injected as the re-record will export it): the prompt says deliverable.md in both forms and PLAN.md nowhere', () => {
  setHeldForTest({ handoffPlanFileName });
  assert.equal(handoffPlanFileOf({}), 'deliverable.md');
  assert.equal(handoffPlanFileOf(undefined), 'deliverable.md');
  assert.equal(userOf({}), R.handoffUser({ ...F, planFile: 'deliverable.md' }));
  for (const config of [{}, { handoff_contract: { milestones: true } }]) {
    const user = userOf(config);
    assert.ok(user.includes(SAVED('deliverable.md')), JSON.stringify(config));
    assert.equal(user.includes('PLAN.md'), false, JSON.stringify(config));
  }
});

test('a chain\'s own handoffPlanFile wins, recorded or not', () => {
  for (const held of [null, { handoffPlanFileName }]) {
    setHeldForTest(held);
    assert.equal(handoffPlanFileOf({ handoffPlanFile: 'THE-PLAN.md' }), 'THE-PLAN.md');
    assert.ok(userOf({ handoffPlanFile: 'THE-PLAN.md' }).includes(SAVED('THE-PLAN.md')));
  }
});

test('a broken draft changes nothing: an empty or non-string name from the held seam leaves PLAN.md', () => {
  for (const bad of [() => '', () => 42, () => undefined]) {
    setHeldForTest({ handoffPlanFileName: bad });
    assert.equal(handoffPlanFileOf({}), 'PLAN.md');
  }
});

test('the held name is the name the CLI writes: src/cli.js writes the delivered plan under it, and `council handoff --from-run` asks handoffPlanFileOf', () => {
  const cli = readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8');
  assert.match(cli, new RegExp(`writeFileSync\\(join\\(runDir, '${handoffPlanFileName().replace(/\./g, '\\.')}'\\),\\s*result\\.deliverable`), 'the CLI no longer writes the delivered plan under the held name');
  assert.ok(cli.includes('planFile: handoffPlanFileOf(hConfig)'));
});
