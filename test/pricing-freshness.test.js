// Pre-release audit (MAN-4, A2/A6, 0.8.1): the OpenRouter rows of src/pricing.json had drifted from OpenRouter's live list (the spend cap projected HALF the real price of
// DeepSeek V4.1 Flash, a third less than the list's output price of GLM-5.3, a third of GLM-5.2's). The rows are re-read by scripts/refresh-openrouter-prices.mjs, which records
// the date; this test turns red a fixed number of days after it, so the next release cannot ship a table nobody compared with the list.
// Red on the date printed in the failure message: run the script (it needs the network), commit the changed rows, and the test is green for another 45 days.
// The date is also in the README's Known limits and in MAN-7 (the release checklist). The retention table has its own, later date (2026-11-23).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const table = JSON.parse(readFileSync(join(root, 'src', 'pricing.json'), 'utf8'));

const redDate = () => new Date(Date.parse(`${table._openrouterCheckedAt}T00:00:00Z`) + (table._openrouterStaleDays + 1) * 86_400_000).toISOString().slice(0, 10);

test('the OpenRouter rows carry the date they were last compared with the live list, and it is recent', () => {
  assert.match(table._openrouterCheckedAt, /^\d{4}-\d{2}-\d{2}$/, 'src/pricing.json has no _openrouterCheckedAt: run node scripts/refresh-openrouter-prices.mjs --fetch <a folder outside the repository> --write');
  assert.ok(Number.isInteger(table._openrouterStaleDays) && table._openrouterStaleDays > 0);
  const age = Math.floor((Date.now() - Date.parse(`${table._openrouterCheckedAt}T00:00:00Z`)) / 86_400_000);
  assert.ok(age <= table._openrouterStaleDays, `the OpenRouter price rows were last compared with the live list ${age} days ago (limit ${table._openrouterStaleDays}; this test went red on ${redDate()}): run node scripts/refresh-openrouter-prices.mjs --fetch <a folder outside the repository> --write (needs the network; the plain command writes no host pictures) and commit its changes`);
});

test('every OpenRouter seat of every shipped chain has a priced row (an unpriced seat projects $0 and is uncapped)', () => {
  const missing = [];
  for (const f of readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
    for (const v of Object.values(c.seats || {})) for (const s of (Array.isArray(v) ? v : [v])) {
      if (s?.provider === 'openrouter' && !table[`openrouter/${s.model}`]) missing.push(`${f}: ${s.model}`);
    }
  }
  assert.deepEqual(missing, []);
});

// CHANGED ACCEPTED TEST (price refresh, 1 Nov 2026; C&C ruling). OLD bar (0.8.1 audit): fixed floors, DeepSeek V4.1 Flash 0.30/1.20, Llama 3.3 70B 0.22/0.50, GLM-5.3 output 7.0 and GLM-5.2 output 12.0, there to stop a row sitting BELOW the list.
// NEW bar: the same four rows are never below the dearest eligible host the refresh recorded for them (hosts.in.high / hosts.out.high, dated on the row), which is what the floors stood for. WHY: with the refresh ruled in both directions and the dearest eligible host as the evidence,
// a fixed floor above that evidence only forces an over-count (GLM-5.3 output 5.28 and GLM-5.2 output 8 on 1 Nov 2026, against the floors 7.0 and 12.0); the reason for the floors is kept, the figures are not.
test('the rows the audit found understated are never below the dearest eligible host recorded on the row: DeepSeek V4.1 Flash, Llama 3.3 70B, GLM-5.3, GLM-5.2', () => {
  for (const id of ['deepseek/deepseek-v4.1-flash', 'meta-llama/llama-3.3-70b-instruct', 'z-ai/glm-5.3', 'z-ai/glm-5.2']) {
    const r = table[`openrouter/${id}`];
    assert.ok(r.hosts, `${id} carries a host picture`);
    if (r.hosts.tier_driven) { const top = r.tiers?.at(-1) ?? r; assert.ok(Math.max(r.in, top.in) >= r.hosts.in.high && Math.max(r.out, top.out) >= r.hosts.out.high, `${id}: the row's tiers do not reach the dearest eligible host ${r.hosts.in.high}/${r.hosts.out.high}`); continue; }   // 2b: the base counts the base-price dearest host, the TIERS carry the rest; rateFor reaches the dearest at the top tier
    assert.ok(r.in >= r.hosts.in.high && r.out >= r.hosts.out.high, `${id}: ${r.in}/${r.out} is below the dearest eligible host ${r.hosts.in.high}/${r.hosts.out.high}`);
  }
});

test('every OpenRouter row with a host picture counts at least the dearest eligible host on both sides, except a tier-driven row, whose tier part is held until per-call tier pricing (it counts the base-price dearest host)', () => {
  const below = Object.entries(table).filter(([k, v]) => k.startsWith('openrouter/') && v?.hosts && !v.hosts.tier_driven && !(v.in >= v.hosts.in.high && v.out >= v.hosts.out.high)).map(([k]) => k);
  const tierShort = Object.entries(table).filter(([k, v]) => k.startsWith('openrouter/') && v?.hosts?.tier_driven && !(Math.max(v.in, v.tiers?.at(-1)?.in ?? 0) >= v.hosts.in.high && Math.max(v.out, v.tiers?.at(-1)?.out ?? 0) >= v.hosts.out.high)).map(([k]) => k);
  assert.deepEqual(tierShort, [], 'a tier-driven row\'s top tier reaches the dearest eligible host');
  assert.deepEqual(below, []);
});

// PRICES lane unit 1 (1 Nov 2026): the host picture each OpenRouter row carries (`hosts`, written by scripts/refresh-openrouter-prices.mjs) is dated by the SAME clock: its `checked` date is bound by `_openrouterStaleDays`, like
// `_openrouterCheckedAt`. A row with `expires` is covered by test/pricing-expiry.test.js and carries none. The problems are listed by a pure function so the test can also be fed a known-bad row.
export function hostsProblems(key, row, today, staleDays) {
  const h = row.hosts; const out = [];
  if (row.expires) return h === undefined ? out : [`${key}: a row with \`expires\` carries no hosts block`];
  if (h === undefined) return out;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(h.checked ?? '')) return [`${key}: hosts.checked is not a date`];
  const age = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${h.checked}T00:00:00Z`)) / 86_400_000);
  if (age > staleDays) out.push(`${key}: hosts were read ${age} days ago (limit ${staleDays})`);
  if (!(Number.isInteger(h.count) && h.count >= 1 && Number.isInteger(h.providers) && h.providers >= 1 && h.providers <= h.count)) out.push(`${key}: hosts.count / hosts.providers are not whole numbers with 1 <= providers <= count`);
  for (const side of ['in', 'out']) {
    const s = h[side];
    if (!s || !(Number.isFinite(s.low) && Number.isFinite(s.median) && Number.isFinite(s.high) && s.low > 0 && s.low <= s.median && s.median <= s.high)) out.push(`${key}: hosts.${side} is not low <= median <= high above 0`);
  }
  if (h.tier_driven !== undefined && h.tier_driven !== true) out.push(`${key}: hosts.tier_driven is true or absent`);
  if (!(Array.isArray(h.filters) && h.filters.length >= 1 && h.filters.every(f => typeof f === 'string' && f.length))) out.push(`${key}: hosts.filters must name the filters used`);
  return out;
}

test('every OpenRouter row that carries a host picture dates it within the stale limit, with low <= median <= high on both sides', () => {
  const today = new Date().toISOString().slice(0, 10);
  const problems = Object.entries(table).filter(([k, v]) => k.startsWith('openrouter/') && v && typeof v === 'object').flatMap(([k, v]) => hostsProblems(k, v, today, table._openrouterStaleDays));
  assert.deepEqual(problems, []);
});

test('hostsProblems can fail: a stale date, an inverted side, no filters and a hosts block on an `expires` row are each named', () => {
  const good = { in: 1, out: 2, hosts: { checked: '2026-11-01', count: 3, providers: 3, in: { low: 0.1, median: 0.2, high: 0.3 }, out: { low: 1, median: 2, high: 3 }, filters: ['x'] } };
  assert.deepEqual(hostsProblems('k', good, '2026-11-02', 45), []);
  assert.match(hostsProblems('k', good, '2026-12-30', 45)[0], /hosts were read 59 days ago/);
  assert.match(hostsProblems('k', { ...good, hosts: { ...good.hosts, out: { low: 3, median: 2, high: 1 } } }, '2026-11-02', 45)[0], /hosts\.out is not low <= median <= high/);
  assert.match(hostsProblems('k', { ...good, hosts: { ...good.hosts, filters: [] } }, '2026-11-02', 45)[0], /hosts\.filters/);
  assert.match(hostsProblems('k', { ...good, expires: '2027-01-01' }, '2026-11-02', 45)[0], /carries no hosts block/);
});
