// Dated price rows (0.8.1 plan M7 Work 2, persistence P13): a row whose price is known to change carries "expires": "YYYY-MM-DD". The
// real-clock assertion is the release test: it fails once a shipped row is past its date, so the row is re-read before a release
// ships with a price that no longer bills. priceOf keeps the row's price either way (src/cost.js expiredPriceRows explains why); the
// dry run and `council doctor` print a warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expiredPriceRows, priceTableLines, priceOf, estimateChainRows } from '../src/cost.js';
import { dryRunReport } from '../src/dry-run.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const table = JSON.parse(readFileSync(join(root, 'src', 'pricing.json'), 'utf8'));

test('no shipped price row is past its expires date today (the release test)', () => {
  assert.deepEqual(expiredPriceRows(), [], 'a price row has expired: re-read the lab\'s page and update src/pricing.json');
});

// CHANGED ACCEPTED TEST (11 Nov 2026, release chores). OLD: four rows expire by 2027-01-02, openrouter/openai/gpt-5.6-sol among them (2026-11-21, OpenAI's promotional 2 / 10). NEW: three; the Sol row carries no `expires` and no `_promotional` any more, so its price is set by the same refresh as every other OpenRouter row (scripts/refresh-openrouter-prices.mjs) instead of by a date; the figure stays 2 / 10 until that refresh runs. WHY: the promotion's date no longer decides the row; the set is pinned exactly, so the list here moves with it (2026-11-21 is now a day nothing expires).
// CHANGED ACCEPTED TEST (30 Okt 2026, the plan-the-high-council chain). OLD: three rows expire by 2027-01-02. NEW: four; openrouter/google/gemini-4-argon expires 2026-12-01 (Google prices it 2 / 10 through 2026-11-30 and 4 / 20 from 2026-12-01, ai.google.dev/gemini-api/docs/pricing, read 2026-10-30). WHY: the row is priced at the promotional figure like gpt-5.6-sol's; the set is pinned exactly, so the new dated row moves this list with it.
// Direct-price re-check (24 Okt 2026): google/gemini-3.6-flash (a direct row) joins the dated rows, because Google's page doubles it on 2027-01-01. Old bar: exactly two rows expire by
// 2027-01-02; new bar: three. The set is still pinned exactly, so a row that gains or loses an `expires` date turns this red until the list here moves with it.
test('the dated rows the research found: Gemini 4 Argon (4 / 20 from 2026-12-01), Gemini 3.8 Flash and Gemini 3.6 Flash (both double 2027-01-01)', () => {
  assert.equal(table['openrouter/google/gemini-4-argon'].expires, '2026-12-01');
  assert.match(table['openrouter/google/gemini-4-argon']._promotional, /4 \/ 20 from 2026-12-01/);
  assert.equal(table['openrouter/google/gemini-3.8-flash'].expires, '2027-01-01');
  assert.equal(table['google/gemini-3.6-flash'].expires, '2027-01-01');
  const at = d => expiredPriceRows(Date.parse(d)).map(r => r.key);
  assert.deepEqual(at('2026-11-21T00:00:00Z'), [], 'the Sol row (2026-11-21 until 11 Nov 2026) carries no date any more');
  assert.deepEqual(at('2026-11-30T23:59:59Z'), []);
  assert.deepEqual(at('2026-12-01T00:00:00Z'), ['openrouter/google/gemini-4-argon']);
  assert.deepEqual(at('2027-01-02T00:00:00Z').sort(), ['google/gemini-3.6-flash', 'openrouter/google/gemini-3.8-flash', 'openrouter/google/gemini-4-argon']);
});

test('an expired row warns in the dry run\'s price lines; the price itself does not change on the date', () => {
  const lines = priceTableLines(new Date('2027-01-02T00:00:00Z'));
  assert.ok(lines.some(l => /WARNING: price row openrouter\/google\/gemini-3\.8-flash expired on 2027-01-01/.test(l)), lines.join('\n'));
  assert.deepEqual(priceOf('openrouter', 'google/gemini-3.8-flash').in, 0.75, 'no silent switch on the date');
  assert.ok(!priceTableLines(new Date('2026-10-03T00:00:00Z')).some(l => /expired on/.test(l)));
});

test('a malformed expiry is reported, never skipped; a row with an expiry still prices (the extra key is tolerated)', () => {
  const fake = { asOf: '2026-09-06', 'x/a': { in: 1, out: 1, expires: 'next spring' }, 'x/b': { in: 1, out: 1, expires: '2026-13-45' }, 'x/d': { in: 1, out: 1, expires: '2026-02-30' }, 'x/c': { in: 1, out: 1 } };
  assert.deepEqual(expiredPriceRows(Date.parse('2026-10-03'), fake).map(r => [r.key, !!r.malformed]), [['x/a', true], ['x/b', true], ['x/d', true]], 'a date that does not exist (2026-02-30) is malformed, not rolled over');
  assert.ok(priceTableLines(new Date('2026-10-03'), fake).some(l => /x\/a has an expiry date that cannot be read \("next spring"\); its price is used as written/.test(l)));
  // a table with no as-of date still warns about its expired rows
  const { asOf, ...undated } = fake;
  assert.ok(priceTableLines(new Date('2026-10-03'), undated).some(l => /x\/d has an expiry date that cannot be read/.test(l)));
  const rows = estimateChainRows({ name: 'x', maxRounds: 1, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 }, seats: { builder: { provider: 'openrouter', model: 'google/gemini-3.8-flash', lab: 'g' }, critics: [{ provider: 'openrouter', model: 'openai/gpt-5.6-sol', lab: 'o' }] } });
  assert.ok(rows.length && rows.every(r => Number.isFinite(r.usd) && r.usd > 0), JSON.stringify(rows));
});

test('the JSON dry run (and MCP dry_run json) carries the expired rows too', () => {
  // 0.8.4 (36a): the one-seat Gemini advice chain left the package; the same config, written out, keeps the test about the expiry rows.
  const config = { name: 'gemini-one-seat', resumeAfterStop: false, maxRounds: 1, estimate: { promptTokens: 3000, draftTokens: 2000, critiqueTokens: 3000 }, advise: { enabled: true, usd: 0.1, rounds: 0, synthesis: 'none' },
    seats: { critics: [{ provider: 'openrouter', model: 'google/gemini-3.8-flash', maxTokens: 12000, lab: 'gemini3.8-flash', extra: { provider: { zdr: true, data_collection: 'deny', max_price: { prompt: 0.75, completion: 3.75 }, ignore: ['open-inference'] }, reasoning: { effort: 'high' } }, estimate: { critiqueTokens: 2500 } }] } };
  assert.deepEqual(dryRunReport(config, { now: Date.parse('2026-10-03T00:00:00Z') }).priceTable.expired, []);
  assert.deepEqual(dryRunReport(config, { now: Date.parse('2027-01-02T00:00:00Z') }).priceTable.expired.map(r => r.key).sort(), ['google/gemini-3.6-flash', 'openrouter/google/gemini-3.8-flash', 'openrouter/google/gemini-4-argon']);
});

test('Qwen3.7 Plus is priced at its list price, not the 20%-off promotion (M7 Work 1)', () => {
  assert.deepEqual([table['openrouter/qwen/qwen3.7-plus'].in, table['openrouter/qwen/qwen3.7-plus'].out], [0.4, 1.6]);
});
