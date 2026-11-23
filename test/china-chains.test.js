// 0.8.3 Chinese chains unit (gate note China_Chains_Gate_Note.md, C&C GO 16 Okt 2026; Muad 15 Okt 23:21): the Chinese chains next to the three tiers (0.8.4: plan-china-medium-council here, plan-china-high-council in its own test). Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dryRunReport } from '../src/dry-run.js';
import { DEFAULT_MAX_USD } from '../src/default-cap.js';
import { lintChain } from '../src/chain-lint.js';
import { layerProblems } from '../src/layers.js';
import { PROMOTED_CHAINS } from '../src/chain-name.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const pricing = JSON.parse(read('src/pricing.json'));
const reasoning = JSON.parse(read('src/reasoning-table.json')).models;
const CHINA = ['chains/plan-china-medium-council.json'];
// CHANGED ACCEPTED DATA (0.8.4 seats unit, Muad 10 Nov 2026 01:10 and 01:56: plan-china-mini-council retires, the China medium roster is typed in his heading, no alternatives and no deep dive at 02:47). OLD: Mini and Medium as the 18 Okt roster apply left them (six judges in layers 2/2/2 from six Chinese labs, StepFun and HY4 seats, MiMo, Medium's four proposers and three alternatives). NEW: China medium = proposers DeepSeek V4.1 Flash 1017, GLM 5.3 Flash, MiniMax M3.1 Flash; L1 GLM 5.3 Flash, MiniMax M3.1 Flash, Qwen 3.8 Flash; L2 DeepSeek V4.1 Flash 1017, MiMo V2.6 Pro, Qwen 3.8 27B; L3 GLM 5.3, Qwen 3.8 Max; three overseer rounds, bounds {1:7,2:3}; zero data retention off. WHY: the owner's picks, typed here from his heading, not read from the file.
const SPEC = {
  'plan-china-medium-council': { proposers: ['deepseek-v4.1-flash', 'glm5.3-flash', 'minimax-m3.1-flash'], layerSizes: [3, 3, 2], judges: 8 },
};
const LABS = ['deepseek', 'minimax', 'qwen', 'xiaomi', 'z-ai'];   // typed: the OpenRouter vendor prefix of every seat, Chinese labs only
const allSeats = c => [...c.seats.proposers, ...(c.seats.alternatives || []), ...c.seats.critics, ...(c.seats.deep_dive ? [c.seats.deep_dive].flat() : [])];

for (const file of CHINA) {
  const c = JSON.parse(read(file));
  test(`${c.name} C1: eight judges in layers 3/3/2 (at least two per layer), eight models each with its own lab value, Chinese labs only, no Kimi/Grok/Mistral anywhere in the file`, () => {
    const spec = SPEC[c.name];
    const by = {}; for (const s of c.seats.critics) (by[s.layer] ??= []).push(s);
    assert.deepEqual(Object.values(by).map(l => l.length), spec.layerSizes);
    assert.equal(c.seats.critics.length, spec.judges);
    assert.equal(new Set(c.seats.critics.map(s => s.lab)).size, spec.judges);
    assert.deepEqual([...new Set(c.seats.critics.map(s => s.model.split('/')[0]))].sort(), LABS);
    for (const s of allSeats(c).filter(x => x.provider !== 'external')) assert.ok(LABS.includes(s.model.split('/')[0]), s.model);
    assert.doesNotMatch(readFileSync(join(root, file), 'utf8').replace(/"description":.*/, ''), /kimi|moonshot|mistral|grok|x-ai/i);
    assert.deepEqual(layerProblems(c, file), []);
    assert.deepEqual(lintChain(c, file).map(f => f.kind), []);
    assert.deepEqual(c.seats.proposers.map(s => s.lab).sort(), spec.proposers);
    assert.equal('alternatives' in c, false); assert.equal('deep_dive' in c, false); assert.equal('alternatives' in c.seats, false); assert.equal('deep_dive' in c.seats, false);   // CHANGED (0.8.4 seats unit, Muad 10 Nov 2026 02:47): the China chains run the same stages as the others
    assert.ok(c.description.includes('a layered review panel of eight named judges'), 'the description counts the judges');
    assert.equal(c.judging, 'all-roles');
    // CHANGED ACCEPTED (0.8.4 ladder unit, owed list: 'rows that read the shipped chains\' old round fields'; 10 Nov 2026). OLD: maxOverseerRounds 3 and layerRevisions {1: 7, 2: 3}. NEW: every shipped planning chain is a ladder chain: no overseer-round or revision keys, and `ladder` {block: 3, visits: 3}.
    assert.equal('maxOverseerRounds' in c, false); assert.equal('layerRevisions' in c, false); assert.deepEqual(c.ladder, { block: 3, visits: 3 });
  });
  test(`${c.name} C2: every API seat has a price row and a reasoning row and reasons at high or above (xhigh on Qwen 3.8 27B, capped at 128,000)`, () => {
    const ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    for (const s of allSeats(c).filter(x => x.provider !== 'external')) {
      const key = `${s.provider}/${s.model}`;
      assert.ok(pricing[key] && pricing[key].in > 0 && pricing[key].out > 0, `price row for ${key}`);
      assert.ok(reasoning[key], `reasoning row for ${key}`);
      const eff = s.extra?.reasoning?.effort;
      // CHANGED ACCEPTED TEST (2 Nov 2026, owner: "High for THC's chains, default to High on all chains, users can change it if they want to"). OLD (23 Okt): a seat on a model whose own default is above high may state no effort (skipped here). NEW: every API seat states high in its file, the same bar for every model.
      assert.ok(ORDER.indexOf(eff) >= ORDER.indexOf('high'), `${key} reasons at ${eff}`);
    }
    const q = c.seats.critics.find(x => x.model === 'qwen/qwen3.8-27b');   // CHANGED (0.8.4 seats unit): was the StepFun and HY4 caps; those seats are gone
    assert.equal(q.maxTokens, 128000); assert.equal(q.extra.reasoning.effort, 'xhigh');
  });
  test(`${c.name} C3: the notes key is on and inert, it is not a promoted chain, the description prints the dry run's figures and names the previews and the Claude session`, () => {
    assert.deepEqual(c.reviewNotes, { enabled: true, perKind: 3 });
    assert.equal(PROMOTED_CHAINS.includes(c.name), false);
    const r = dryRunReport(c, { defaultCapUsd: DEFAULT_MAX_USD });
    assert.ok(c.description.includes(`$${r.estimate.expectedUsd.toFixed(2)} expected`) && c.description.includes(`an upper estimate of $${r.estimate.maximumUsd.toFixed(2)}`));   // CHANGED ACCEPTED (label rename part 2, 20 Okt 2026; Muad 18 Okt: "upper estimate" replaces "at most" and "maximum"): OLD "$Y at most"; NEW "an upper estimate of $Y"
    assert.ok(c.description.includes(`about $${r.estimate.expectedUsd.toFixed(2)} plus a Claude subscription`));
    const over = r.estimate.maximumUsd > DEFAULT_MAX_USD;   // the Desktop-ceiling passage is true only for a maximum above the default (10 Nov 2026: $12, derived; it was a typed $7) (C&C 16 Okt: the stale passage on a $5.95 maximum)
    assert.equal(c.description.includes(`is above the default cap of $${DEFAULT_MAX_USD}`), over, `the "above the default cap" sentence appears only when the printed maximum is above $${DEFAULT_MAX_USD}`);
    assert.equal(c.description.includes(`fits under the $${DEFAULT_MAX_USD} default cap`), !over, 'the "fits under" line appears only when it is not');
    assert.match(c.description, /zero-data-retention setting of your OpenRouter account switched off/, 'the description says zero data retention must be off');   // CHANGED (0.8.4 seats unit): was the HY4 and StepFun preview sentence; those seats are gone
    assert.match(c.description, /your Claude Code session/);
    assert.doesNotMatch(`${c.summary} ${c.description}`, /\b(better|best|more accurate|outperform)\b/i);
  });
}

// NEW TEST (0.8.4 release chores, 11 Nov 2026: Muad, "blacklist PrimaLabs for Mimo ... definetly not worth PrimaLabs pricing"). The ban is made by NAME on the MiMo seat of the shipped chain (the one list that both the request and the price table read: scripts/refresh-openrouter-prices.mjs
// leaves a host out of a model's row only when every shipped seat of that model bans it). The slug must be the tag prefix OpenRouter gives the host (the endpoint tag reads primalabs/fp8); the dated zero-retention table src/zdr-hosts.json lists that tag for the model, so a wrong slug ("prima-labs") fails here.
// Anchor caveat: that table is dated; a zero-retention refresh that drops PrimaLabs from it turns THIS row red for that reason, not because the ban broke.
test('PL-1: the MiMo seat of plan-china-medium-council bans PrimaLabs by the exact tag prefix of the host the zero-retention table lists for the model, and still bans Open Inference', () => {
  const chain = JSON.parse(read('chains/plan-china-medium-council.json'));
  const mimo = Object.values(chain.seats).flatMap(v => (Array.isArray(v) ? v : [v])).filter(s => s?.provider === 'openrouter' && s.model === 'xiaomi/mimo-v2.6-pro');
  assert.equal(mimo.length, 1, 'one MiMo seat in the shipped chain');
  const tags = Object.keys(JSON.parse(read('src/zdr-hosts.json')).models['xiaomi/mimo-v2.6-pro'].hosts).filter(t => /^primalabs(\/|$)/.test(t));
  assert.ok(tags.length >= 1, 'the table names a PrimaLabs host for the model (the anchor of the slug)');
  const ignore = mimo[0].extra.provider.ignore;
  assert.ok(ignore.includes(tags[0].split('/')[0]), `ignore ${JSON.stringify(ignore)} holds the slug "${tags[0].split('/')[0]}"`);
  assert.ok(ignore.includes('open-inference'), 'the Open Inference block stays');
});
