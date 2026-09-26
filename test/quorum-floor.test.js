// Quorum floor for unanimous sign-off (0.7.8, thc-research brief 11): chain flag
// `quorum: { minHeard: N }`, off unless a chain sets it; no shipped chain does. A sign-off counts
// only when at least N reviewers gave a verdict (signed off or objected). Short of that the round is
// recorded as not quorate and the loop stops, the way a round with no heard reviewer does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';
import { reportJsonShape } from '../src/report-shape.js';
import { computeOutcome } from '../src/outcome.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seat = (model, lab) => ({ provider: 'mock', model, lab });
const config = (critics, extra = {}) => ({
  name: 'test-quorum', maxRounds: 3, signoff: 'unanimous', freedoms: { pass: true },
  seats: { criteria: seat('mock-criteria'), builder: seat('mock-builder'), reviser: seat('mock-builder'), critics },
  ...extra,
});
const run = cfg => runChain({ request: 'A test request.', config: cfg, log: () => {} });
const PASSER_AND_ONE = [seat('mock-critic-passer', 'mock-a'), seat('mock-critic-a', 'mock-b')];

test('without a quorum: one sign-off and one stated pass is unanimous (unchanged behaviour)', async () => {
  const r = await run(config(PASSER_AND_ONE));
  assert.equal(r.passed, true);
  assert.equal(r.notQuorate, undefined);
});

test('quorum.minHeard 2: one sign-off and one stated pass is not quorate - the loop stops, not agreement', async () => {
  const r = await run(config(PASSER_AND_ONE, { quorum: { minHeard: 2 } }));
  assert.equal(r.passed, false);
  assert.ok(r.notQuorate, 'the round is recorded');
  assert.deepEqual({ ...r.notQuorate, round: 0 }, { round: 0, heard: 1, minHeard: 2, passedOnly: 1 });
  const lastRound = Math.max(...r.panelVerdicts.map(v => v.round));
  assert.equal(r.notQuorate.round, lastRound, 'the loop stopped at the not-quorate round');
  assert.ok(lastRound < 3, 'it did not run on to the round cap');
  assert.equal(computeOutcome(r), 'degraded');
});

test('quorum.minHeard 2: two real sign-offs are quorate and pass', async () => {
  const r = await run(config([seat('mock-critic-a', 'mock-a'), seat('mock-critic-b', 'mock-b')], { quorum: { minHeard: 2 } }));
  assert.equal(r.passed, true);
  assert.equal(r.notQuorate, undefined);
});

test('with the dispute stage on, a not-quorate stop is its own reason', async () => {
  const r = await run(config(PASSER_AND_ONE, { quorum: { minHeard: 2 }, dispute: { enabled: true } }));
  assert.equal(r.dispute.ran, false);
  assert.equal(r.dispute.reason, 'not_quorate');
  assert.equal(r.dispute.stopped_at_round, r.notQuorate.round);
});

test('report.json carries notQuorate, and it validates against schemas/report-v1.json', async () => {
  const r = await run(config(PASSER_AND_ONE, { quorum: { minHeard: 2 }, dispute: { enabled: true } }));
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(schema);
  const report = reportJsonShape({ runId: 'x', chain: 'test-quorum', task: 'tasks/x.md', result: r, maxUsd: null });
  assert.deepEqual(report.notQuorate, r.notQuorate);
  assert.equal(report.outcome, 'degraded');
  assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
});

test('chain-lint: quorum must be { minHeard: N >= 1 }, on a unanimous chain, within the panel size', () => {
  const kinds = cfg => lintChain(cfg).filter(f => f.kind === 'invalid-quorum-config').length;
  const base = config(PASSER_AND_ONE);
  assert.equal(kinds({ ...base, quorum: { minHeard: 2 } }), 0);
  assert.equal(kinds({ ...base, quorum: { minHeard: 0 } }), 1);
  assert.equal(kinds({ ...base, quorum: { minHeard: '2' } }), 1);
  assert.equal(kinds({ ...base, quorum: { minHeard: 2, min: 1 } }), 1);
  assert.equal(kinds({ ...base, quorum: 2 }), 1);
  assert.equal(kinds({ ...base, quorum: { minHeard: 3 } }), 1, 'more than the two critics');
  assert.equal(kinds({ ...base, signoff: 'first', quorum: { minHeard: 1 } }), 1);
});

test('no shipped chain sets a quorum (off by default everywhere)', () => {
  const dir = join(root, 'chains');
  const withQuorum = readdirSync(dir).filter(f => f.endsWith('.json'))
    .filter(f => 'quorum' in JSON.parse(readFileSync(join(dir, f), 'utf8')));
  assert.deepEqual(withQuorum, []);
});
