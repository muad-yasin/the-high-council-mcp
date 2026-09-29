// Bug audit 2026-09-28, area 2 (plan-daily-7's first real run): (#1) a proposal cut off at its cap was
// retried at the same cap, so a reasoning seat filled it again and dropped out; (#2) a debate post or
// reply round the provider ended with stop "error" was recorded as "did not parse" and never retried.
// Now a cut-off proposal is retried with a bigger cap, and an incomplete debate/reply is retried once
// at the same cap and, if it fails again, recorded as provider_error. Mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setCache, setBudget } from '../src/chain.js';
import { renderDroppedBoard } from '../src/report-shape.js';

const here = dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(resolve(here, '../chains/mock-debate.json'), 'utf8'));
const withProposers = (...models) => ({ ...base, seats: { ...base.seats, proposers: models.map((model, i) => ({ provider: 'mock', model, lab: `mock-${'abc'[i]}` })) } });
async function run(config) {
  setCache(null); setBudget(null);
  const stages = [], logs = [];
  const result = await runChain({ request: 'Do the thing.', config, log: m => logs.push(m), onStage: s => stages.push(s) });
  return { result, stages, logs };
}

test('a proposal cut off at its cap is retried with a bigger cap, and the lab stays in', async () => {
  const { result, stages } = await run(withProposers('mock-proposer-cut-then-fits', 'mock-proposer-b'));
  const first = stages.find(s => s.label === 'propose-mock-a');
  const retry = stages.find(s => s.label === 'propose-mock-a-retry');
  assert.ok(first && retry, stages.map(s => s.label).join(', '));
  assert.ok(retry.usage.output < 2000 || retry.usage.stop !== 'length', 'the retry was not cut off');
  assert.ok(result.proposals.some(p => p.lab === 'mock-a'), 'the lab kept its proposals');
  assert.ok(!(result.dropouts || []).some(d => d.lab === 'mock-a'));
});

test('a debate post and a reply round ending with stop "error" once are retried and count', async () => {
  const { result, stages } = await run(withProposers('mock-proposer-error-once', 'mock-proposer-b'));
  const labels = stages.map(s => s.label);
  assert.ok(labels.includes('debate-mock-a-retry'), labels.join(', '));
  assert.ok(result.debate.posts.some(p => p.by === 'mock-a'), 'the retried debate reply counted');
  assert.ok(!result.debate.dropped.some(d => d.by === 'mock-a'), JSON.stringify(result.debate.dropped));
});

test('a debate post and reply round ending with stop "error" twice are recorded as provider_error, not unreadable', async () => {
  const { result, logs } = await run(withProposers('mock-proposer-error', 'mock-proposer-b'));
  const mine = result.debate.dropped.filter(d => d.by === 'mock-a');
  assert.ok(mine.length >= 1, JSON.stringify(result.debate.dropped));
  assert.ok(mine.every(d => d.reason === 'provider_error'), JSON.stringify(mine));
  assert.ok(logs.some(l => /ended the debate reply with stop "error" \(after a retry\)/.test(l)));
  assert.match(renderDroppedBoard(mine), /the whole debate reply - the provider ended the reply with an error/);
});

test('validateDeliverable names a provider stop instead of "not readable as JSON"', async () => {
  const { validateDeliverable } = await import('../src/partial-deliverable.js');
  for (const stop of ['error', 'content_filter', 'refusal']) {
    assert.match(validateDeliverable('propose', '', { input: 0, output: 0, stop }).reason, new RegExp(`the provider ended the reply \\(stop: ${stop}\\)`));
  }
  assert.match(validateDeliverable('propose', 'no json', { input: 1, output: 2, stop: 'stop' }).reason, /not readable as JSON/);
});
