// test/dispute-stage.test.js
//
// Dispute stage + stall rule (2026-09-20). The round cap moved 3 -> 7 so a real disagreement
// has room to resolve; that only helps if a disagreement which ISN'T resolving stops early,
// or the extra rounds just buy more of the same argument at the reviser's price.
//
// The cheap-7 run is the incident behind both halves: it ended with open objections dropped
// into report.json where a reader had to go hunting, and a false claim survived into the
// deliverable because the objection to it first landed in the capped round.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';
import { computeOutcome } from '../src/outcome.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const run = (config, request = 'A mock task.') => runChain({ config, request, log: () => {} });

test('stall rule: a disagreement that stops moving ends the loop well before the cap', async () => {
  const config = chain('mock-dispute');
  assert.equal(config.maxRounds, 7, 'the cap must be high, or the cap and not the rule is what stopped it');
  const r = await run(config);

  assert.equal(r.dispute.reason, 'stalled');
  assert.ok(r.dispute.stopped_at_round < config.maxRounds,
    `stopped at ${r.dispute.stopped_at_round}, which is the cap - the stall rule did nothing`);
  // Round 1 has both critics objecting; rounds 2 and 3 are the holdout alone. So the stable
  // set only exists from round 2, and stopping at 3 is the rule waiting for real evidence
  // rather than firing on the first repeat of anything.
  assert.equal(r.dispute.stopped_at_round, 3);
});

test('a stalled run is still no consensus - the stage records disagreement, it never resolves it', async () => {
  const r = await run(chain('mock-dispute'));
  assert.equal(r.passed, false);
  assert.equal(r.dispute.panel_rereviewed, false, 'the panel must not vote again after the dispute stage');
  const outcome = computeOutcome(r);
  assert.ok(/no.?consensus/i.test(JSON.stringify(outcome)),
    `outcome must stay no-consensus, got ${JSON.stringify(outcome)}`);
});

test('the unresolved dissent reaches the deliverable verbatim, with lab and round', async () => {
  const r = await run(chain('mock-dispute'));
  const d = r.deliverable;
  assert.match(d, /^## Unresolved dissent/, 'it must be the first thing read, not an appendix');
  assert.match(d, /Raised by mock-holdout, round 1, never resolved/);
  assert.match(d, /No assumptions section\./, 'the objection text must be verbatim, not summarised');
  assert.match(d, /not a signed-off deliverable/);
});

test('the dissent block survives the final edit, whose job is stripping chain artifacts', async () => {
  const config = chain('mock-dispute');
  assert.ok(config.seats.finalist, 'precondition: this chain runs a final edit');
  const r = await run(config);
  // Caught for real while building this: the block was prepended before the final edit and
  // was silently gone from the deliverable.
  assert.match(r.deliverable, /## Unresolved dissent/);
});

test('the dispute stage does not run when the panel actually agrees', async () => {
  const config = { ...chain('mock-unanimous'), dispute: { enabled: true, stall_rounds: 2 } };
  const r = await run(config);
  assert.equal(r.passed, true);
  assert.equal(r.dispute.ran, false);
  assert.equal(r.dispute.reason, 'panel_signed_off');
  assert.ok(!/Unresolved dissent/.test(r.deliverable), 'a signed-off plan carries no dissent block');
});

test('a chain that does not opt in behaves exactly as before - no stage, no field', async () => {
  const r = await run(chain('mock-unanimous'));
  assert.equal(r.dispute, undefined, 'report.json gains no field on a chain that never asked for one');
});

test('the dissent block is built from the recorded objections, never from the reviser reply', async () => {
  // A seat asked to summarise the objections against its own draft is the last thing that
  // should author the record of them. The mock reviser returns canned text with none of this
  // in it, so if the block is present and correct it cannot have come from the reply.
  const r = await run(chain('mock-dispute'));
  const stage = r.stages.find(s => s.label === 'dispute');
  assert.ok(stage, 'the dispute stage ran as its own recorded, budgeted stage');
  assert.ok(!/Raised by mock-holdout/.test(stage.text ?? ''), 'precondition: the reply does not contain the block');
  assert.match(r.deliverable, /Raised by mock-holdout/);
});

test('chain-lint: dispute accepts only its two keys, and only under unanimous signoff', () => {
  const base = chain('mock-dispute');
  assert.deepEqual(lintChain(base, 'chains/mock-dispute.json'), []);

  const badKey = lintChain({ ...base, dispute: { enabled: true, max_disputes: 3 } }, 'x.json');
  assert.ok(badKey.some(f => f.kind === 'invalid-dispute-config' && /max_disputes/.test(f.message)));

  const roundRobin = lintChain({ ...base, signoff: undefined }, 'x.json');
  assert.ok(roundRobin.some(f => f.kind === 'invalid-dispute-config' && /unanimous/.test(f.message)));

  for (const bad of [1, 0, -1, 'two', 2.5]) {
    const f = lintChain({ ...base, dispute: { enabled: true, stall_rounds: bad } }, 'x.json');
    assert.ok(f.some(x => x.kind === 'invalid-dispute-config' && /stall_rounds/.test(x.message)),
      `stall_rounds ${JSON.stringify(bad)} must be rejected - below 2 there is no evidence a disagreement is stuck`);
  }
  assert.deepEqual(lintChain({ ...base, dispute: { enabled: true, stall_rounds: 3 } }, 'x.json'), []);
});
