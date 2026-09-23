// Bug-audit regression tests, 2026-09-23 (Review/BugAudit_MoneyPath_2026-09-23.md #2, the same
// swallow found independently as BugAudit_ChainParsers_2026-09-23.md #4).
//
// BudgetExceeded and ExternalPause are control flow. Every catch that wraps invoke() and degrades a
// failure into an abstention / "no reply" / default used to swallow them too - so a panel seat over
// the cap was logged SEAT_UNREACHABLE, the panel re-ran on the same draft up to maxRounds, runChain
// returned normally, and the CLI wrote report.json instead of STOPPED-budget.json (not resumable).
// Each test below reaches one of those catches and asserts the error now escapes runChain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, runPreflightStage, setBudget, setCache, budgetState, BudgetExceeded, ExternalPause } from '../src/chain.js';
import { injectCanary } from '../src/canary.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRAFT = 'REVISED MOCK DELIVERABLE\n\nBody text.\n\nAssumptions: none.';
// mock/mock-priced is $1000/Mtok; 50000 max tokens projects ~$50 for one call.
const pricey = lab => ({ provider: 'mock', model: 'mock-priced', maxTokens: 50000, lab });
const cheap = lab => ({ provider: 'mock', model: 'mock-priced', maxTokens: 10, lab });

test('unanimous panel: a critic over the cap stops the run with BudgetExceeded, not SEAT_UNREACHABLE', async () => {
  setCache(null); setBudget(5);
  const logs = [];
  const config = { name: 'swallow', signoff: 'unanimous', maxRounds: 7, criteria: ['It exists.'],
    seats: { critics: [cheap('cheapA'), cheap('cheapB'), pricey('pricey')] } };
  await assert.rejects(
    () => runChain({ request: 'Req.', config, draft: DRAFT, log: l => logs.push(l) }),
    err => err instanceof BudgetExceeded && err.label === 'panel-1-pricey');
  assert.ok(!logs.some(l => /pricey.*counted as an abstention/.test(l)), 'the capped seat must not be logged as an abstention');
  assert.ok(budgetState().spent <= 5);
  setBudget(null);
});

test('non-unanimous critique with degrade_on_provider_error: a capped critic still stops the run', async () => {
  setCache(null); setBudget(5);
  const config = { name: 'degrade', maxRounds: 3, degrade_on_provider_error: true, criteria: ['It exists.'],
    seats: { reviser: cheap('r'), critics: [pricey('pricey')] } };
  await assert.rejects(
    () => runChain({ request: 'Req.', config, draft: DRAFT, log: () => {} }),
    err => err instanceof BudgetExceeded && err.label === 'critique-1');
  setBudget(null);
});

test('ambiguity union: a capped ambiguity seat stops the run instead of being logged as "no ambiguity reply"', async () => {
  setCache(null); setBudget(5);
  const config = { name: 'amb', maxRounds: 1, ambiguity_union: { enabled: true },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' },
      critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }], ambiguity: [pricey('pricey')] } };
  await assert.rejects(
    () => runChain({ request: 'Req.', config, log: () => {} }),
    err => err instanceof BudgetExceeded && err.label === 'ambiguity-pricey');
  setBudget(null);
});

test('preflight: a capped seat propagates instead of becoming verdict "error"', async () => {
  const invoke = async () => { throw new BudgetExceeded({ label: 'preflight-x', seat: 'mock/x', spent: 1, cap: 1, projected: 5 }); };
  await assert.rejects(
    () => runPreflightStage({ preflight: { seats: [cheap('x')] }, seats: {} }, { request: 'R', invoke, record: s => s }),
    BudgetExceeded);
});

test('canary: a capped or paused decision propagates instead of degrading to "keep"', async () => {
  const proposals = [{ id: 'A-1', lab: 'a', title: 't', how: 'h' }];
  await assert.rejects(() => injectCanary(proposals, async () => { throw new BudgetExceeded({ label: 'canary-reply-a', seat: 'm', spent: 0, cap: 1, projected: 2 }); }), BudgetExceeded);
  await assert.rejects(() => injectCanary(proposals, async () => { throw new ExternalPause('canary-reply-a', 's', 'u'); }), ExternalPause);
  // An ordinary failure still degrades to "keep", as before.
  const held = await injectCanary(proposals, async () => { throw new Error('boom'); });
  assert.equal(held.reply.action, 'keep');
});

// Debate and reply stages: record a real mock-debate run, then replay everything up to the stage
// under test from a cache and make the proposer seats external, so the first un-cached call of
// that stage throws ExternalPause. Before the fix it was logged "no debate reply" and swallowed.
async function recordMockDebate() {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  setCache(null); setBudget(null);
  const stages = {};
  await runChain({ request: 'Write a plan.', config, log: () => {}, onStage: s => { stages[s.label] = s; } });
  return { config, stages };
}

for (const [stageName, keep] of [['debate', l => !/^(debate|reply|canary)-/.test(l)], ['reply', l => !/^(reply|canary)-/.test(l)]]) {
  test(`${stageName} stage: an external seat pauses the run instead of being logged as a missing reply`, async () => {
    const { config, stages } = await recordMockDebate();
    assert.ok(Object.keys(stages).some(l => l.startsWith(`${stageName}-`)), `fixture run must have a ${stageName} stage`);
    setCache({ get: label => (stages[label] && keep(label)) ? { ...stages[label], usd: 0 } : null });
    const ext = { ...config, seats: { ...config.seats, proposers: config.seats.proposers.map(s => ({ ...s, provider: 'external' })) } };
    await assert.rejects(
      () => runChain({ request: 'Write a plan.', config: ext, log: () => {} }),
      err => err instanceof ExternalPause && err.label.startsWith(`${stageName}-`));
    setCache(null);
  });
}

// The guard the audit asked for: a new catch around invoke() that forgets to rethrow is the same
// bug again. Source-level, because the swallow only shows under a cap or an external seat.
test('source guard: every catch whose try block calls invoke() rethrows control flow first', () => {
  for (const file of ['src/chain.js', 'src/canary.js']) {
    const src = readFileSync(join(root, file), 'utf8');
    const re = /\}\s*catch\s*(\([^)]*\))?\s*\{/g;
    let m, checked = 0;
    while ((m = re.exec(src))) {
      const tryAt = src.lastIndexOf('try {', m.index);
      if (tryAt < 0 || !/(invoke|decide)\(/.test(src.slice(tryAt, m.index))) continue;
      const head = src.slice(m.index + m[0].length).split('\n').slice(0, 6).join('\n');
      checked++;
      assert.match(head, /rethrowControlFlow\(err\)|controlFlow\) throw err/,
        `${file}:${src.slice(0, m.index).split('\n').length} catches around invoke() without rethrowing BudgetExceeded/ExternalPause`);
    }
    assert.ok(checked > 0, `${file}: the guard found no catch to check - its pattern is stale`);
  }
});
