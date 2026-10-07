// The shipped advice chains against decided rule 1 and the data they need (0.8.1 plan M7 Work 4 and 5, persistence P12): every seat of
// every chains/advise-*.json (advise-premium included) has a price row and a retention row, the retention table is no older than 30
// days (the release test, MAN-7), and no seat names an xAI/Grok model, a router that could pick one, or Kimi K3 (a user may still seat
// Kimi K3 in a chain of their own; test/shipped-chains-no-kimi.test.js covers every shipped chain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { priceOf } from '../src/cost.js';
import { retentionRowOf, retentionAgeDays, retentionAsOf, RETENTION_STALE_DAYS } from '../src/advice-tier.js';
import { deniedReasonsOf, ROUTER_MODEL } from '../src/denied-models.js';
import { lintChain } from '../src/chain-lint.js';
import { everySeatOf } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADVICE = readdirSync(join(root, 'chains')).filter(f => /^advise-.*\.json$/.test(f)).sort();
const chain = f => JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
// Every seat the engine can call, by the engine's own walk (M7 review: a fixed list would miss a seat key added later).
const seatsOf = c => everySeatOf(c).filter(Boolean);
// Every id a seat can name: its model, and the model lists and routing order `extra` can carry.
const idsOf = s => [s.model, ...(s.extra?.models || []), ...(s.extra?.provider?.order || []), s.extra?.model].filter(x => typeof x === 'string');

// 0.8.2 (owner, 6 Oct 2026, "yes" to two new single seats): advise-single-glm-flash and advise-single-qwen join the seven of 0.8.1.
test('the shipped advice chains are the nine the release ships (a new one is checked here too)', () => {
  assert.deepEqual(ADVICE, ['advise-premium.json', 'advise-single-astra.json', 'advise-single-deepseek.json', 'advise-single-gemini.json', 'advise-single-glm-flash.json', 'advise-single-opus.json', 'advise-single-qwen.json', 'advise-single.json', 'advise-standard.json']);
});

test('every seat of every shipped advice chain has a price row and a retention row (no seat previews as "unknown")', () => {
  const missing = [];
  for (const f of ADVICE) for (const s of seatsOf(chain(f))) {
    if (!priceOf(s.provider, s.model)) missing.push(`${f}: ${s.provider}/${s.model} has no price row`);
    if (!retentionRowOf(s)) missing.push(`${f}: ${s.provider}/${s.model} has no retention row`);
  }
  assert.deepEqual(missing, []);
});

test('the retention table was read no more than 30 days ago (re-read it in the release week: MAN-7)', () => {
  assert.match(retentionAsOf(), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(retentionAgeDays() <= RETENTION_STALE_DAYS, `src/advice-retention.json is ${retentionAgeDays()} days old (as of ${retentionAsOf()})`);
  assert.equal(RETENTION_STALE_DAYS, 30);
});

test('decided rule 1, restated over the shipped advice chains: no xAI/Grok, no router id, no Kimi K3, and every chain lints clean', () => {
  const bad = [];
  for (const f of ADVICE) {
    const c = chain(f);
    for (const k of lintChain(c, f)) bad.push(`${f}: lint ${k.kind}`);
    for (const s of seatsOf(c)) {
      for (const r of deniedReasonsOf(s)) bad.push(`${f}: ${r}`);
      for (const id of idsOf(s)) {
        if (/x-ai|xai|grok/i.test(id)) bad.push(`${f}: ${id} is an xAI/Grok id`);
        if (ROUTER_MODEL.test(id)) bad.push(`${f}: ${id} is a router id`);
        if (/kimi/i.test(id)) bad.push(`${f}: ${id} is Kimi (out of every shipped chain)`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('the check can fail: a planted Grok seat, a router in extra.models and a Kimi seat are each caught', () => {
  const planted = [{ provider: 'openrouter', model: 'x-ai/grok-4.7', lab: 'g' }, { provider: 'openrouter', model: 'openai/gpt-6.1-sol', lab: 'o', extra: { models: ['openrouter/fusion'] } }, { provider: 'openrouter', model: 'moonshotai/kimi-k3', lab: 'k' }];
  const flagged = planted.map(s => deniedReasonsOf(s).length > 0 || idsOf(s).some(id => /x-ai|grok|kimi/i.test(id) || ROUTER_MODEL.test(id)));
  assert.deepEqual(flagged, [true, true, true]);
});
