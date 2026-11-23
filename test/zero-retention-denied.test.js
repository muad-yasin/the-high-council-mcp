// 0.8.4 zero retention, the owner gate "no xAI/Grok, ever" (CLAUDE.md; src/denied-models.js DENIED_MODEL, the ONE list chain-lint's denied-model rule reads): no model id on that list is in the shipped table of zero-retention hosts, in a table the maker makes, or in a list `council refresh-zdr-list` writes.
// WHY: the first shipped table (10 Nov 2026) was made from OpenRouter's whole list and held seven x-ai/grok models; a seat can never name one, but the file shipped in the package and every error line and refreshed list drew on it. Kimi K3 rows stay (a user may seat it in their own chain: it is not on the denied list).
// ZD-1 the shipped table has no denied id (red on the table made from the whole list). ZD-2 the maker drops a denied id and keeps every other row, and a denied row still counts for a provider that keeps prompts (dropping it must never allow a host that was not allowed). ZD-3 a refresh fed a list that holds a denied id writes none, even when the list in use names one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DENIED_MODEL } from '../src/denied-models.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const row = (model_id, tag, safety = false, p = 1e-6, c = 2e-6) => ({ model_id, tag, safety_retention: safety, pricing: { prompt: String(p), completion: String(c) } });
const load = async name => { const m = await import(`../src/${name}.js`).catch(() => null); assert.ok(m, `src/${name}.js exists`); return m; };

test('ZD-1: no model id on the denied list is in the shipped table of zero-retention hosts (the Kimi K3 rows stay)', () => {
  const table = JSON.parse(readFileSync(join(root, 'src', 'zdr-hosts.json'), 'utf8'));
  const ids = Object.keys(table.models);
  assert.deepEqual(ids.filter(id => DENIED_MODEL.test(id)), [], 'no id on the denied list (chain-lint\'s one list)');
  assert.ok(ids.some(id => /kimi-k3/.test(id)), 'a Kimi K3 row stays: it is out of every shipped chain but a person may seat it in their own');
  assert.ok(ids.length > 100, 'the table is still the table');
});

test('ZD-2: the table maker drops a denied id and keeps every other row; a denied row still counts for a provider that keeps prompts', async () => {
  const { zdrTableOf } = await load('zdr-table');
  const rows = [row('x-ai/grok-9', 'xai/zdr'), row('x-ai/grok-9', 'pz/a', true), row('a/one', 'hx/us'), row('a/one', 'pz/b'), row('moonshotai/kimi-k3', 'hk')];
  const t = zdrTableOf(rows, '2026-11-10');
  assert.deepEqual(Object.keys(t.models).sort(), ['a/one', 'moonshotai/kimi-k3'], 'the denied id is not in the table');
  assert.deepEqual(Object.keys(t.models['a/one'].hosts), ['hx/us'], 'the provider pz keeps prompts on a denied model, so its host is still not allowed for another model: dropping the denied rows moved nothing else');
  assert.deepEqual(t.models['moonshotai/kimi-k3'].hosts, { hk: { in: 1, out: 2 } });
  for (const id of ['x-ai/grok-4.3', 'grok-build', 'xai/anything']) assert.equal(zdrTableOf([row(id, 'h')], '2026-11-10').models[id], undefined, `${id}: dropped`);
});

test('ZD-3: a refresh fed a list that holds a denied id writes none, even when the list in use names one', async () => {
  const { refreshZdrList } = await load('zdr-refresh');
  const w = mkdtempSync(join(tmpdir(), 'thc-zd-')); made.push(w);
  const shipped = { asOf: '2026-11-01', models: { 'a/one': { hosts: { 'hx/us': { in: 1, out: 2 } }, safety_retention: 0 }, 'x-ai/grok-9': { hosts: { 'xai/zdr': { in: 1, out: 2 } }, safety_retention: 0 } } };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ data: [row('a/one', 'hx/us'), row('x-ai/grok-9', 'xai/zdr')] }) });
  const r = await refreshZdrList({ work: w, fetchImpl, today: '2026-12-20', shipped });
  assert.equal(r.ok, true, r.lines.join(' '));
  const written = JSON.parse(readFileSync(join(w, 'zdr-hosts.user.json'), 'utf8'));
  assert.deepEqual(Object.keys(written.models), ['a/one'], 'the denied id is not in what the refresh wrote');
});
