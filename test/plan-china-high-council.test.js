// CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 01:56 and 02:47). OLD: the High shape (twelve judges on nine models from seven companies, six proposers, three alternatives, a deep-dive seat, the DeepSeek V4 Pro 0813 seat with a price pin). NEW: the typed roster of his heading: proposers Kimi K3.1 Pro, GLM 5.3, DeepSeek V4.1 Flash 1017; L1 GLM 5.3 Flash, MiniMax M3.1 Flash, Qwen 3.8 Flash; L2 DeepSeek V4.1 Flash 1017, GLM 5.3, Qwen 3.8 27B; L3 Kimi K3.1 Pro, Qwen 3.8 Max; no alternatives and no deep dive; zero data retention off. WHY: the owner's heading; the old rows PCH-1 to PCH-4 are rewritten, not loosened.
// plan-china-high-council (0.8.3; Muad 18 Okt 2026: "Yes to the suggested chinese High", ONE LAB PER MODEL).
// What is true of the file itself, offline and for $0: the roster, the labs (a model that sits in two layers is one lab), lint, and the two figures the dry run prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';
import { panelLabCount } from '../src/chain.js';
import { dryRunReport } from '../src/dry-run.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chain = JSON.parse(readFileSync(join(root, 'chains', 'plan-china-high-council.json'), 'utf8'));
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const critics = chain.seats.critics;

test('PCH-1: eight judges on eight models from five companies in layers 3/3/2, three proposers, no alternatives and no deep dive, lint clean, and the panel counts eight labs (one per model, no -lN suffix)', () => {
  assert.equal(chain.seats.proposers.length, 3);
  assert.equal('alternatives' in chain, false); assert.equal('alternatives' in chain.seats, false); assert.equal('deep_dive' in chain, false); assert.equal('deep_dive' in chain.seats, false);
  // MOVED BAR (commit 8): OLD maxOverseerRounds 7 and layerRevisions { 1: 7, 2: 3 }; NEW the ladder key (block 3, visits 3)
  assert.deepEqual(chain.ladder, { block: 3, visits: 3 }); assert.equal('maxOverseerRounds' in chain, false);   // CHANGED ACCEPTED (0.8.4 HS / N4, Muad 05 Nov 2026 22:15): OLD { 1: 5, 2: 3 }; NEW { 1: 7, 2: 3 }
  assert.deepEqual([1, 2, 3].map(l => critics.filter(s => s.layer === l).length), [3, 3, 2]);
  assert.equal(new Set(critics.map(s => s.model)).size, 8); assert.equal(new Set(critics.map(s => s.model.split('/')[0])).size, 5);
  const labOf = new Map();
  for (const s of [...chain.seats.proposers, ...critics]) { assert.ok(!/-(l[123]|p)$/.test(s.lab), s.lab); assert.equal(labOf.get(s.model) ?? s.lab, s.lab, `${s.model} has two labs`); labOf.set(s.model, s.lab); }
  assert.equal(panelLabCount(chain), 8);
  assert.deepEqual(chain.seats.proposers.map(s => s.lab).sort(), ['deepseek-v4.1-flash', 'glm5.3', 'kimi-k3.1-pro']);
  assert.equal(chain.judging, 'all-roles');
  assert.deepEqual(lintChain(chain, 'chains/plan-china-high-council.json'), []);
});

test('PCH-2: Kimi K3.1 Pro is a proposer and the layer-3 judge at high with 128,000 output, Qwen 3.8 27B runs at xhigh with 128,000, and the DeepSeek V4 Pro builds are not used', () => {
  const kimi = [...chain.seats.proposers, ...critics].filter(x => x.model === 'moonshotai/kimi-k3.1-pro');
  assert.deepEqual(kimi.map(s => s.layer ?? 'proposer').sort(), [3, 'proposer']);
  for (const s of kimi) { assert.equal(s.maxTokens, 128000); assert.equal(s.extra.reasoning.effort, 'high'); }
  const q = critics.find(x => x.model === 'qwen/qwen3.8-27b');
  assert.equal(q.maxTokens, 128000); assert.equal(q.extra.reasoning.effort, 'xhigh');
  assert.equal([...chain.seats.proposers, ...critics].some(x => /deepseek-v4-pro/.test(x.model)), false, 'neither build of DeepSeek V4 Pro');
});

test('PCH-3: the dry run prints the two figures the description and the Pricing table carry, and the five-host Known limit is gone', () => {
  const est = dryRunReport(chain).estimate;
  const usd = n => `$${n.toFixed(2)}`;
  assert.ok(chain.description.includes(`${usd(est.expectedUsd)} expected`) && chain.description.includes(`${usd(est.maximumUsd)}`), 'the description carries the dry run');
  // CHANGED ACCEPTED (Pricing table layout, 26 Okt 2026): OLD the row read `| name | not run yet | expected | upper estimate |`; NEW the columns are Chain | Expected | Upper estimate | Tested, and an unrun chain's tested cell is an en dash.
  // CHANGED (13 Nov 2026, owner: "I want it removed before the PR. This is just about the readme"): OLD the row carried the upper estimate (`| name | expected | upper estimate | – |`); NEW the README's table has no Upper estimate column, the row is `| name | expected | – |`; the upper estimate stays in the chain's description (the check above).
  assert.ok(readme.includes(`| \`plan-china-high-council\` | ${usd(est.expectedUsd)} | – |`), 'the Pricing table row');
  // CHANGED (0.8.4 apply, the README rework): the Known limits moved to KNOWN-LIMITS.md, so the absence is read in both files (OLD: README.md alone).
  assert.equal(`${readme}\n${readFileSync(join(root, 'KNOWN-LIMITS.md'), 'utf8')}`.includes('has five hosts at its price'), false, 'the Known limit is gone');
  // CHANGED (0.8.4 seats unit): OLD the description said "nine models from seven companies" and the 0813 seat's host picture was checked; that seat is gone.
  assert.ok(chain.description.includes('eight models from five companies'), 'the description says what it counts');
});

test('PCH-4: Chinese labs only on every API seat (no Grok or Mistral outside the description; Kimi only as the one exempt model), a price row and a reasoning row for every API seat, every seat reasons at high or above, and the file makes no compliance claim (like its siblings)', () => {
  const pricing = JSON.parse(readFileSync(join(root, 'src', 'pricing.json'), 'utf8'));
  const reasoning = JSON.parse(readFileSync(join(root, 'src', 'reasoning-table.json'), 'utf8')).models;
  const LABS = ['deepseek', 'minimax', 'moonshotai', 'qwen', 'z-ai'];
  const seats = [...chain.seats.proposers, ...critics].filter(s => s.provider !== 'external');
  const ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  for (const s of seats) {
    assert.ok(LABS.includes(s.model.split('/')[0]), s.model);
    const key = `${s.provider}/${s.model}`;
    assert.ok(pricing[key]?.in > 0 && pricing[key]?.out > 0, `price row for ${key}`); assert.ok(reasoning[key], `reasoning row for ${key}`);
    // CHANGED ACCEPTED TEST (2 Nov 2026, owner: "High for THC's chains, default to High on all chains, users can change it if they want to"). Every API seat states high or above in its file.
    assert.ok(ORDER.indexOf(s.extra?.reasoning?.effort) >= ORDER.indexOf('high'), `${key} reasons at ${s.extra?.reasoning?.effort}`);
  }
  assert.doesNotMatch(JSON.stringify({ ...chain, description: '' }), /mistral|grok|x-ai/i);
  assert.equal('compliance' in chain, false);
});
