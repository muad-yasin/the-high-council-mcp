// 0.8.4 the OpenRouter switch, first group (Builder B): every Claude model a shipped chain seats DIRECTLY at Anthropic also has its ROUTED rows, so a routed run prices it, knows its largest reply and keeps the final read's room check:
// a price row (src/pricing.json "openrouter/anthropic/claude-<name>-<n>.<m>"), a reasoning row (src/reasoning-table.json, same key) and a window row (src/context-windows.json models "anthropic/claude-<name>-<n>.<m>").
// Without a window row contextWindowOf returns null and the room rule is skipped silently (the fail-open C&C filed for the wiring group); the rows exist before the wiring does. The refresh script for the window table lists these models too
// (scripts/refresh-context-windows.mjs routedClaudeId), so a regeneration keeps them. The check is a function over (models, tables) and is shown able to fail on empty tables (known-bad input).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const Ids = await import('../scripts/routed-claude-ids.mjs').catch(() => ({}));      // dynamic: on a tree without the helper only RCR-4 fails

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(readFileSync(join(root, f), 'utf8'));
// OpenRouter writes a Claude version with a dot: claude-sonnet-5-5 -> anthropic/claude-sonnet-5.5. This is the test's own statement of the rule; RCR-4 ties it to the helper (scripts/routed-claude-ids.mjs) the window-table refresh script imports.
const routedClaudeId = m => { const v = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(m); return v ? `anthropic/claude-${v[1]}-${v[2]}.${v[3]}` : /^claude-[a-z]+-\d+$/.test(m) ? `anthropic/${m}` : null; };
const missingRows = (models, { pricing, reasoning, windows }) => models.flatMap(m => {
  const id = routedClaudeId(m); if (id === null) return [`${m}: no routed id`];
  return [[`openrouter/${id}`, pricing[`openrouter/${id}`], 'src/pricing.json'], [`openrouter/${id}`, reasoning.models?.[`openrouter/${id}`], 'src/reasoning-table.json'], [id, windows.models?.[id], 'src/context-windows.json']]
    .filter(([, row]) => row === undefined || row === null || (typeof row === 'number' && !(Number.isInteger(row) && row > 0))).map(([key, , file]) => `${m}: no row ${key} in ${file}`);
});
const shippedClaudeModels = () => {
  const out = new Set();
  const walk = x => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (x.provider === 'anthropic' && typeof x.model === 'string') out.add(x.model); Object.values(x).forEach(walk); } };
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) walk(read(`chains/${f}`).seats ?? {});
  return [...out].sort();
};

test('RCR-1 every Claude model a shipped chain seats directly has its routed price row, reasoning row and window row', () => {
  const models = shippedClaudeModels();
  assert.ok(models.length >= 4 && models.includes('claude-fable-5-2') && models.includes('claude-sonnet-5-5'), `the shipped Claude models were found: ${models.join(', ')}`);
  assert.deepEqual(missingRows(models, { pricing: read('src/pricing.json'), reasoning: read('src/reasoning-table.json'), windows: read('src/context-windows.json') }), []);
});

test('RCR-2 the routed Fable 5.2 rows say what the saved endpoint answer of 10 Nov 2026 says: 8 / 40 per million tokens, cache read 0.20, 5-minute write 10, a 128,000 largest reply, a window of 1,000,000, effort high by default', () => {
  const p = read('src/pricing.json')['openrouter/anthropic/claude-fable-5.2'], r = read('src/reasoning-table.json').models['openrouter/anthropic/claude-fable-5.2'], w = read('src/context-windows.json').models['anthropic/claude-fable-5.2'];
  assert.ok(p && r && w, 'the routed Fable 5.2 price, reasoning and window rows exist');
  assert.deepEqual([p.in, p.out, p.cache_read, p.cache_write, p.cache_basis_in], [8, 40, 0.2, 10, 8]);
  assert.match(p._source, /openrouter\.ai\/api\/v1\/models\/anthropic\/claude-fable-5\.2\/endpoints, read 2026-11-10/);
  // the host list's check date moves with every price refresh (8ad60738 wrote 2026-11-11): the row asks for a date, not for one day
  assert.match(p.hosts.checked, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(p.hosts.checked >= '2026-11-10', `the host list was checked on or after the saved endpoint answer of 2026-11-10, got ${p.hosts.checked}`);
  assert.deepEqual([p.hosts.count, p.hosts.in.high, p.hosts.out.high], [4, 8, 40]);
  assert.deepEqual([r.form, r.maxOutput, r.defaultEffort, r.source], ['openrouter-effort', 128000, 'high', 'openrouter-models']);
  assert.equal(w, 1000000);
});

test('RCR-3 the check can fail: empty tables name every missing row of a model, a model with no routed id is named, and a window of zero or a fraction counts as missing', () => {
  const empty = { pricing: {}, reasoning: { models: {} }, windows: { models: {} } };
  assert.deepEqual(missingRows(['claude-sonnet-5-5'], empty), ['claude-sonnet-5-5: no row openrouter/anthropic/claude-sonnet-5.5 in src/pricing.json', 'claude-sonnet-5-5: no row openrouter/anthropic/claude-sonnet-5.5 in src/reasoning-table.json', 'claude-sonnet-5-5: no row anthropic/claude-sonnet-5.5 in src/context-windows.json']);
  assert.deepEqual(missingRows(['gpt-5'], empty), ['gpt-5: no routed id']);
  const full = { pricing: { 'openrouter/anthropic/claude-sonnet-5.5': {} }, reasoning: { models: { 'openrouter/anthropic/claude-sonnet-5.5': {} } }, windows: { models: { 'anthropic/claude-sonnet-5.5': 0 } } };
  assert.deepEqual(missingRows(['claude-sonnet-5-5'], full), ['claude-sonnet-5-5: no row anthropic/claude-sonnet-5.5 in src/context-windows.json']);
  assert.deepEqual(missingRows(['claude-sonnet-5'], { pricing: { 'openrouter/anthropic/claude-sonnet-5': {} }, reasoning: { models: { 'openrouter/anthropic/claude-sonnet-5': {} } }, windows: { models: { 'anthropic/claude-sonnet-5': 200000 } } }), [], 'a one-number model keeps its id');
});

test('RCR-4 the shipped chains give EXACTLY these four routed Claude ids (the list the window-table refresh script keeps rows for; a model added to a chain moves this on purpose), the helper the script imports reads a version as OpenRouter writes it and agrees with this file\'s own statement of the rule', () => {
  const ids = new Set();
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) for (const id of Ids.routedClaudeIdsOf(read(`chains/${f}`).seats ?? {})) ids.add(id);
  assert.deepEqual([...ids].sort(), ['anthropic/claude-fable-5.2', 'anthropic/claude-haiku-5.5', 'anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5']);
  for (const m of ['claude-opus-5-5', 'claude-sonnet-5', 'claude-fable-5-2', 'gpt-5', 'claude-haiku-4-5-20251001']) assert.equal(Ids.routedClaudeId(m), routedClaudeId(m), m);
  assert.equal(Ids.routedClaudeId('claude-opus-5-5'), 'anthropic/claude-opus-5.5'); assert.equal(Ids.routedClaudeId('gpt-5'), null); assert.equal(Ids.routedClaudeId('claude-haiku-4-5-20251001'), null, 'a dated id is not a routed Claude version');
  assert.deepEqual(Ids.routedClaudeIdsOf({ critics: [{ provider: 'anthropic', model: 'claude-opus-5-5' }, { provider: 'openrouter', model: 'anthropic/claude-opus-5.5' }, { provider: 'mock', model: 'claude-fable-5-2' }] }), ['anthropic/claude-opus-5.5'], 'only direct Anthropic seats are listed');
});
