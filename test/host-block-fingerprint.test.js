// 0.8.4 (Open Inference block; Mini-C&C's FIX of 04 Nov 2026 on the stage cache): the slug "open-inference" in a seat's extra.provider.ignore is sent on every OpenRouter call whatever the config says (src/price-pin.js), so the
// chain file's own entry changes nothing a finished stage said. It is not part of the stage-cache fingerprint (src/cache-integrity.js, src/host-block.js), like the two numbers of a seat's own price limit: a run paused on a chain
// file without the entry resumes on one with it and keeps its finished stages. Every other edit of an ignore list still invalidates. Offline, $0.
// Rows: HB-1 only the entry leaves the fingerprint (single seat, nested seats, with a price limit beside it); HB-2 each other ignore edit still changes it (control: passes on a tree without the exclusion);
// HB-3 a config with no entry hashes exactly as before (control); HB-4 every shipped chain file hashes as it did without the entries; HB-5 the helper's contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintInputs } from '../src/cache-integrity.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'open-inference';   // the literal, pinned here on purpose
const seat = (extra, more = {}) => ({ provider: 'openrouter', model: 'a/b', maxTokens: 100, ...(extra === undefined ? {} : { extra }), ...more });
const chain = (s, other = { provider: 'mock', model: 'm' }) => ({ name: 'x', maxRounds: 2, seats: { critics: [s, other], builder: { provider: 'external', model: 'e' } } });
const fp = c => fingerprintInputs('the task', c);

// one test per row, so a tree that excludes nothing shows each of them failing
const HB1 = [
  ['a seat whose only extra is the entry', chain(seat({ provider: { ignore: [SLUG] } })), chain(seat())],
  ['beside reasoning', chain(seat({ reasoning: { effort: 'high' }, provider: { ignore: [SLUG] } })), chain(seat({ reasoning: { effort: 'high' } }))],
  ['beside another provider key', chain(seat({ provider: { zdr: true, ignore: [SLUG] } })), chain(seat({ provider: { zdr: true } }))],
  ['beside another ignore entry', chain(seat({ provider: { ignore: ['azure', SLUG] } })), chain(seat({ provider: { ignore: ['azure'] } }))],
  ['with a price limit beside it: both leave', chain(seat({ provider: { max_price: { prompt: 1, completion: 2 }, ignore: [SLUG] } })), chain(seat())],
  ['two seats', chain(seat({ provider: { ignore: [SLUG] } }), seat({ provider: { ignore: [SLUG] } }, { model: 'c/d' })), chain(seat(), seat(undefined, { model: 'c/d' }))],
];
for (const [what, withEntry, without] of HB1) test(`HB-1 only the entry leaves the fingerprint: ${what}`, () => assert.equal(fp(withEntry), fp(without)));

test('HB-2 (controls: each passes on a tree that excludes nothing) any other edit of an ignore list still changes the fingerprint; the entry on a seat of another provider counts; so does the slug in only/order', () => {
  const base = fp(chain(seat({ provider: { ignore: [SLUG] } })));
  const differs = (c, why) => assert.notEqual(fp(c), base, why);
  differs(chain(seat({ provider: { ignore: [SLUG, 'azure'] } })), 'another entry added beside it');
  differs(chain(seat({ provider: { ignore: ['azure'] } })), 'another entry instead of it');
  assert.notEqual(fp(chain(seat({ provider: { ignore: ['azure'] } }))), fp(chain(seat())), 'an own ignore entry against none');
  assert.notEqual(fp(chain(seat({ provider: { ignore: ['azure', 'wafer'] } }))), fp(chain(seat({ provider: { ignore: ['wafer', 'azure'] } }))), 'the order of the user\'s own entries');
  assert.notEqual(fp(chain(seat({ provider: { only: [SLUG] } }))), fp(chain(seat())), 'the slug in only is a routing edit');
  assert.notEqual(fp(chain(seat({ provider: { order: [SLUG] } }))), fp(chain(seat())), 'the slug in order is a routing edit');
  assert.notEqual(fp(chain({ provider: 'openai', model: 'gpt-5', extra: { provider: { ignore: [SLUG] } } })), fp(chain({ provider: 'openai', model: 'gpt-5' })), 'a seat of another provider keeps its entry in the fingerprint');
  assert.notEqual(fp(chain(seat({ provider: { ignore: [] } }))), fp(chain(seat())), 'an empty list the user wrote is not the entry');
});

// 0.8.4, Mini-C&C's FIX of 04 Nov 2026 (C&C's condition 2 for the exclusion): beside the slug, ANY other edit of the seat still changes the fingerprint. Two subtests, so each assertion can show its own red from a known-bad input
// (a fixture pair made equal, test data only): (a) a different ignore entry beside the slug; (b) another extra.provider field beside the slug (data_collection, a field the shipped chains carry).
const HB6 = {
  entry: [chain(seat({ provider: { ignore: [SLUG, 'azure'] } })), chain(seat({ provider: { ignore: [SLUG] } }))],
  field: [chain(seat({ provider: { data_collection: 'deny', ignore: [SLUG] } })), chain(seat({ provider: { ignore: [SLUG] } }))],
};
test('HB-6 beside the slug, any other edit of the seat still changes the fingerprint', async t => {
  await t.test('(a) a different ignore entry beside the slug', () => assert.notEqual(fp(HB6.entry[0]), fp(HB6.entry[1])));
  await t.test('(b) another extra.provider field beside the slug (data_collection)', () => assert.notEqual(fp(HB6.field[0]), fp(HB6.field[1])));
});

test('HB-3 (control) a config with no entry hashes exactly as before: the same 12 characters as a direct hash of the task and the config', () => {
  const c = chain(seat({ reasoning: { effort: 'high' }, provider: { zdr: true, ignore: ['azure'] } }));
  assert.equal(fp(c), createHash('sha256').update(JSON.stringify({ taskText: 'the task', config: c })).digest('hex').slice(0, 12));
});

test('HB-4 every shipped chain file hashes as it did before the entries: the fingerprint of the file equals the fingerprint of the same config with every open-inference entry removed by hand', () => {
  const unblock = node => {
    if (Array.isArray(node)) return node.map(unblock);
    if (!node || typeof node !== 'object') return node;
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = unblock(v);
    if (out.provider === 'openrouter' && out.extra?.provider?.ignore) {
      out.extra = { ...out.extra, provider: { ...out.extra.provider, ignore: out.extra.provider.ignore.filter(x => x !== SLUG) } };
      if (!out.extra.provider.ignore.length) delete out.extra.provider.ignore;
      if (!Object.keys(out.extra.provider).length) delete out.extra.provider;
      if (!Object.keys(out.extra).length) delete out.extra;
    }
    return out;
  };
  let withEntry = 0;
  for (const f of readdirSync(join(ROOT, 'chains')).filter(f => f.endsWith('.json'))) {
    const text = readFileSync(join(ROOT, 'chains', f), 'utf8');
    const cfg = JSON.parse(text);
    if (!text.includes(`"${SLUG}"`)) continue;
    withEntry++;
    assert.equal(fp(cfg), fp(unblock(cfg)), f);
  }
  assert.ok(withEntry >= 6, `${withEntry} shipped chains carry the entry`);   // CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD bar 7. NEW bar: 6 (counted with grep over chains/*.json: 6 files carry "open-inference"). WHY: chains/advise-standard.json, which carried the entry on its three seats, left chains/ with the advice add-on (it is a fixture now, test/fixtures/advice-chains/); the count moves with the thing it counts. (older note follows)   // CHANGED ACCEPTED TEST (0.8.4 seats and retirements unit): OLD bar 10. NEW bar: 7 (the seven planning chains; the retirements and the re-seated rosters left 7 files that carry the entry). WHY: the count moves with the thing it counts; missed by the retirement commit's set. (older note follows)   // CHANGED ACCEPTED TEST (0.8.4, 36a: the eight one-model chains left chains/): OLD bar 15. NEW bar: 10. WHY: the advise-single chains that carried the entry left chains/ (10 chains still carry it)
});

test('HB-5 the helper: the same object when there is no entry; the entry removed from each OpenRouter seat only; what the removal emptied is pruned and nothing else', async () => {
  const { withoutHostBlock, OPEN_INFERENCE } = await import('../src/host-block.js');
  assert.equal(OPEN_INFERENCE, SLUG);
  const none = chain(seat({ provider: { ignore: ['azure'] } }));
  assert.equal(withoutHostBlock(none), none, 'no entry: the very same object');
  const c = chain(seat({ reasoning: { effort: 'high' }, provider: { zdr: true, ignore: ['azure', SLUG] } }));
  const before = JSON.stringify(c);
  assert.deepEqual(withoutHostBlock(c).seats.critics[0].extra, { reasoning: { effort: 'high' }, provider: { zdr: true, ignore: ['azure'] } });
  assert.equal(JSON.stringify(c), before, 'the input is not written');
  assert.deepEqual(withoutHostBlock(chain(seat({ provider: { ignore: [SLUG] } }))).seats.critics[0], seat(), 'a seat whose only extra was the entry loses extra');
  assert.deepEqual(withoutHostBlock(chain(seat({ provider: { ignore: [] } }))).seats.critics[0].extra, { provider: { ignore: [] } }, 'an empty list is not pruned');
});
