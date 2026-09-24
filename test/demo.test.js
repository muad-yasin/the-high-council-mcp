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

test('the scope ledger names every proposal once, with the debate outcome', () => {
  const ledger = out.slice(out.indexOf('## Scope ledger'), out.indexOf('DEBATE BOARD'));
  assert.match(ledger, /^LABA-1 - accepted - /m);
  assert.match(ledger, /^LABA-2 - withdrawn - /m);
  assert.match(ledger, /^LABB-1 - accepted - .*as amended/m);
  assert.match(ledger, /^LABB-2 - accepted - .*as amended/m);
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
