// test/demo.test.js
//
// `council demo` is the first thing a stranger runs. Before 0.7.7 it printed the tests' placeholder
// mock text ("MOCK DELIVERABLE ... Body text."), which showed the mechanism but not what a plan
// run is for. It now runs the scripted photo-renamer scenario in src/mock-demo.js. These tests pin
// that the output is that scenario end to end, that it is still $0 and offline, and that the
// scripted seats never leak into the generic mock the rest of the suite relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { call } from '../src/providers.js';
import { demoReply } from '../src/mock-demo.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = execFileSync('node', [join(root, 'src', 'cli.js'), 'demo'], { encoding: 'utf8', cwd: root, env: { ...process.env, OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '' } });

test('the demo prints no placeholder mock text', () => {
  for (const placeholder of ['MOCK DELIVERABLE', 'MOCK SKELETON', 'MOCK HANDOFF', 'Body text.', 'mock.js', 'Demo request.']) {
    assert.ok(!out.includes(placeholder), `demo output still contains "${placeholder}"`);
  }
});

test('the demo says its replies are scripted, and costs $0', () => {
  assert.match(out, /scripted in advance/);
  assert.match(out, /no model is judging anything/);
  assert.doesNotMatch(out, /\$0\.0*[1-9]/, 'no stage may report a non-zero cost');
});

test('the demo runs the whole mechanism: debate changes proposals, the panel splits, then signs off', () => {
  assert.match(out, /Plan a small command-line tool that renames my holiday photos/);
  assert.match(out, /board: 4 post\(s\), 4 replies, 1 proposal\(s\) withdrawn, 2 amended\./);
  assert.match(out, /lab-a\/mock-demo-critic-a: 1 failure\(s\)/);
  assert.match(out, /lab-b\/mock-demo-critic-b: SIGNED OFF/);
  assert.match(out, /every lab on the panel signed off; stopping\./);
  // The revision carries the round-1 fix into the deliverable.
  assert.match(out, /a new file per run, never overwritten/);
});

// CHANGED ACCEPTED TEST (0.8.4, the twelve unowned tip reds, row R03). OLD: the plan the demo prints carries a "## Scope ledger" section, read between that heading and "DEBATE BOARD", that names every proposal once with the debate outcome (LABA-1 - accepted - ..., LABA-2 - withdrawn - ..., LABB-1 and LABB-2 accepted as amended). NEW: the per-proposal outcome claim is DROPPED, not moved; the row pins what the demo prints of the ledger at work: the plan carries no "## Scope ledger" section, the two ledger checks of the writer stages (build and revise-1) read "clean - every proposal has one line", the note for the withdrawn proposal LABA-2 is printed, and the scoreboard tallies stay. WHY: the ledger is kept out of the plan since proposalsSectionLedgerOut was recorded (dc60423a); it lives in the run's result, `council demo` writes no file and prints no per-proposal ledger line. The demo printing the ledger is not part of this row.
test('the scope ledger is kept out of the plan and checked at each writer stage: the demo prints no Scope ledger section, two clean ledger checks, the withdrawn-proposal note and the scoreboard tallies', () => {
  assert.equal(out.indexOf('## Scope ledger'), -1, 'the plan carries no Scope ledger section');
  assert.deepEqual(out.match(/^ {2}ledger check \(.*\): .*$/gm), ['  ledger check (build): clean - every proposal has one line', '  ledger check (revise-1): clean - every proposal has one line'], 'the ledger is checked after the build and after the revision, and is clean');
  assert.match(out, /^ {2}note: 1 withdrawn proposal\(s\) with no surviving owner: LABA-2 - the builder is told to reassign each or drop it, with a reason, in the Scope ledger\.$/m);
  assert.match(out, /lab-a +proposed 2 +accepted 1 +cut 0 +withdrawn 1 +unaccounted 0/);
  assert.match(out, /lab-b +proposed 2 +accepted 2 +cut 0 +withdrawn 0 +unaccounted 0/);
});

test('the handoff points at the plan, not at placeholder text', () => {
  const handoff = out.slice(out.lastIndexOf('HANDOFF\n'));
  assert.match(handoff, /# HANDOFF - photodate/);
  assert.match(handoff, /Read HANDOFF\.md and PLAN\.md, then begin item 1\./);
});

test('only mock-demo-* seats get the script; the generic mock is unchanged', async () => {
  const system = 'You write the skeleton of a plan.';
  const generic = await call('mock', { model: 'mock-skeleton', system, messages: [{ role: 'user', content: 'x' }] });
  assert.equal(generic.text, 'MOCK SKELETON\n- system A\n- system B');
  const scripted = await call('mock', { model: 'mock-demo-skeleton', system, messages: [{ role: 'user', content: 'x' }] });
  assert.match(scripted.text, /capture_time\(\)/);
});

test('a stage the script does not cover falls through to the generic mock', () => {
  assert.equal(demoReply({ model: 'mock-demo-x', system: 'You are the judge.', user: '' }), null);
});
