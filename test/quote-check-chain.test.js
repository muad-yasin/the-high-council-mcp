// 0.8.4 F2 (gap check S8-01), the wiring guard: test/quote-check.test.js pins the rule on markFailures
// itself; this file pins that runChain hands markFailures the draft the judges were shown, so the rule
// reaches the two readers of quote_status that matter: the run's quoteFindings (log, record, report.json)
// and the reviser prompt (src/prompts/core.js). The judge's reply is injected through the stage cache, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';

afterEach(() => { setPromptSpy(null); setCache(null); });

const QUOTED = 'the author may accept/withdraw each post before the round ends';
const DRAFT = `# Plan\n\nBody text.\n\nStep 3: ${QUOTED}.\nStep 4: publish.\n\nAssumptions: none.`;
const REQUEST = 'Review this plan.\n\n```text\n// notes.txt\nthe round has a fixed length\n```';
const CRITERION = 'It names who decides.';

const verdictWith = quote => JSON.stringify({
  meets: false,
  criteria: [{ criterion: CRITERION, verdict: 'NOT MET', evidence: 'Step 3 does not say.' }],
  failures: [{ criterion: CRITERION, problem: 'Step 3 lists accept/withdraw but never says who decides.', fix: 'Name the decider.', quote }],
  verdict_line: 'One criterion failed.',
});

// `replies`: stage label -> the quote the injected judge reply carries; `extra`: more chain config (patch mode).
async function runWith(replies, extra = {}) {
  setBudget(null);
  const prompts = [];
  const lines = [];
  setPromptSpy(p => prompts.push({ label: p.label, user: p.user }));
  setCache({ get: label => label in replies
    ? { text: verdictWith(replies[label]), usage: { input: 10, output: 10 }, usd: 0, provider: 'mock', model: 'mock-critic-a' } : null });
  const r = await runChain({ request: REQUEST, draft: DRAFT, log: l => lines.push(String(l)), config: {
    name: 'qc', signoff: 'unanimous', maxRounds: 2, criteria: [CRITERION], ...extra.config,
    seats: { reviser: { provider: 'mock', model: extra.reviser || 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'jx' }] },
  } });
  return { r, prompts, lines };
}

test('a real quote from the draft reaches neither quoteFindings nor the reviser prompt as invented', async () => {
  const { r, prompts } = await runWith({ 'panel-1-jx': QUOTED });
  const reviser = prompts.filter(p => p.user.includes('never says who decides'));
  assert.ok(reviser.length > 0, `the objection reached a prompt (labels: ${prompts.map(p => p.label).join(', ')})`);
  assert.deepEqual({
    invented: (r.quoteFindings || []).filter(w => /does NOT appear/.test(w)).length,
    shownUnverified: reviser.filter(p => p.user.includes('(unverified)')).length,
  }, { invented: 0, shownUnverified: 0 });
});

test('a quote found in neither the draft nor the fenced source is still marked in both places', async () => {
  const { r, prompts } = await runWith({ 'panel-1-jx': 'words that appear in neither place' });
  assert.deepEqual({
    invented: (r.quoteFindings || []).filter(w => /does NOT appear/.test(w)).length,
    shownUnverified: prompts.some(p => p.user.includes('never says who decides') && p.user.includes('(unverified)')),
  }, { invented: 1, shownUnverified: true });
});

// Patch mode (chains/mock-patch.json): from the second round the judges are shown the draft PLUS "Was: ... Now: ..." blocks
// (chain.js shownDraft), so a quote taken from the "Was" text is real but is no longer in the plain draft. The mark is checked
// against what the judge was shown, not against the plain draft.
test('patch mode: a quote from the "Was" block the judge was shown is not marked invented', async () => {
  const { r, lines } = await runWith({ 'panel-1-jx': QUOTED, 'panel-2-jx': 'Body text.' }, { config: { revise: { mode: 'patch' } }, reviser: 'mock-reviser-patch' });
  // preconditions, read from the run: the round-1 revise was a clean patch (so round 2 shows the "Was" block), not the full-rewrite fallback
  assert.ok(lines.some(l => /patch mode: applied 1 edit/.test(l)), `the patch applied: ${lines.filter(l => /patch mode/.test(l)).join(' | ')}`);
  assert.ok(!lines.some(l => /falling back to one full rewrite/.test(l)), 'no fallback to a full rewrite');
  assert.equal((r.quoteFindings || []).filter(w => /does NOT appear/.test(w)).length, 0, `quoteFindings: ${JSON.stringify(r.quoteFindings)}`);
});
