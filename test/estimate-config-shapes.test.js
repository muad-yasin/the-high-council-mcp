// BUG-D-033 (found by the 0.8.3 full run, 25 Okt 2026): BUG-D-018 made estimateChainRows loop over limits.passes (maxRounds ?? 2) instead of the raw config.maxRounds, so the digest stand-in
// (src/cli.js: { name: 'digest', seats: { handoff } }, no critics and no maxRounds, which the old loop priced at zero rows) reached config.seats.critics and threw a TypeError inside the policy gate
// (test/side-command-gate.test.js SG-12 and SG-15). The estimate must take every config shape that can reach it without throwing: a config with no critics has no panel, critique or revise rows to price.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { estimateChainRows } from '../src/cost.js';
import { dryRunReport } from '../src/dry-run.js';
import { resolveChainSeats } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW = /^(panel-|critique-|revise-|conflict-)/;
const seat = { provider: 'mock', model: 'mock-model', lab: 'x', maxTokens: 1000 };

test('CS-1 every shipped chain, every chain in chains/outdated and every mock chain goes through the estimate and the dry-run report without throwing (expected, maximum, cheapest end, with a task)', () => {
  let n = 0;
  for (const dir of ['chains', join('chains', 'outdated')]) {
    for (const f of readdirSync(join(root, dir)).filter(x => x.endsWith('.json')).sort()) {
      const config = resolveChainSeats(JSON.parse(readFileSync(join(root, dir, f), 'utf8')));
      assert.doesNotThrow(() => {
        estimateChainRows(config);
        estimateChainRows(config, { maximum: true });
        dryRunReport(config, { taskChars: 4000, now: 0 });
      }, `${dir}/${f}`);
      n++;
    }
  }
  assert.ok(n >= 40, `the sweep read ${n} chains`);
  // the one shape that is not a chain file: the digest stand-in, which src/cli.js hands to the policy gate (policy.js reaches the estimate with it, expected and maximum)
  const standIn = { name: 'digest', seats: { handoff: seat } };
  assert.doesNotThrow(() => { estimateChainRows(standIn); estimateChainRows(standIn, { maximum: true }); }, 'the digest stand-in');
});

test('CS-2 a config with no critics prices no panel, critique, revise or conflict row and throws nothing: the digest stand-in, a builder-only chain, one with maxRounds, one that asks for unanimous sign-off, an empty critics list', () => {
  const shapes = {
    'the digest stand-in (src/cli.js)': { name: 'digest', seats: { handoff: seat } },
    'builder only': { name: 'b', seats: { builder: seat } },
    'builder only, maxRounds 2': { name: 'b2', maxRounds: 2, seats: { builder: seat, handoff: seat } },
    'builder only, unanimous': { name: 'bu', signoff: 'unanimous', seats: { builder: seat } },
    'an empty critics list': { name: 'ec', seats: { builder: seat, critics: [] } },
  };
  for (const [what, config] of Object.entries(shapes)) {
    for (const maximum of [false, true]) {
      let rows;
      assert.doesNotThrow(() => { rows = estimateChainRows(config, { maximum }); }, `${what}, maximum=${maximum}`);
      const review = rows.map(r => r.label).filter(l => REVIEW.test(l));
      assert.deepEqual(review, [], `${what}, maximum=${maximum}: no review rows`);
    }
  }
});
