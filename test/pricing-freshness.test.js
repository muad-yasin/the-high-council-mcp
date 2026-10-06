// Pre-release audit (MAN-4, A2/A6, 0.8.1): the OpenRouter rows of src/pricing.json had drifted from OpenRouter's live list (the spend cap projected HALF the real price of
// DeepSeek V4.1 Flash, a third less than the list's output price of GLM-5.3, a third of GLM-5.2's). The rows are re-read by scripts/refresh-openrouter-prices.mjs, which records
// the date; this test turns red a fixed number of days after it, so the next release cannot ship a table nobody compared with the list.
// Red on the date printed in the failure message: run the script (it needs the network), commit the changed rows, and the test is green for another 45 days.
// The date is also in the README's Known limits and in MAN-7 (the release checklist). The retention table has its own, earlier date (2026-10-31).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const table = JSON.parse(readFileSync(join(root, 'src', 'pricing.json'), 'utf8'));

const redDate = () => new Date(Date.parse(`${table._openrouterCheckedAt}T00:00:00Z`) + (table._openrouterStaleDays + 1) * 86_400_000).toISOString().slice(0, 10);

test('the OpenRouter rows carry the date they were last compared with the live list, and it is recent', () => {
  assert.match(table._openrouterCheckedAt, /^\d{4}-\d{2}-\d{2}$/, 'src/pricing.json has no _openrouterCheckedAt: run scripts/refresh-openrouter-prices.mjs');
  assert.ok(Number.isInteger(table._openrouterStaleDays) && table._openrouterStaleDays > 0);
  const age = Math.floor((Date.now() - Date.parse(`${table._openrouterCheckedAt}T00:00:00Z`)) / 86_400_000);
  assert.ok(age <= table._openrouterStaleDays, `the OpenRouter price rows were last compared with the live list ${age} days ago (limit ${table._openrouterStaleDays}; this test went red on ${redDate()}): run scripts/refresh-openrouter-prices.mjs and commit its changes`);
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

test('the rows the audit found understated are at the live list or above it (never below): DeepSeek V4.1 Flash 0.30/1.20, Llama 3.3 70B 0.22/0.50, GLM-5.3 output 7.0, GLM-5.2 output 12.0', () => {
  const row = id => table[`openrouter/${id}`];
  assert.ok(row('deepseek/deepseek-v4.1-flash').in >= 0.3 && row('deepseek/deepseek-v4.1-flash').out >= 1.2);
  assert.ok(row('meta-llama/llama-3.3-70b-instruct').in >= 0.22 && row('meta-llama/llama-3.3-70b-instruct').out >= 0.5);
  assert.ok(row('z-ai/glm-5.3').out >= 7.0);
  assert.ok(row('z-ai/glm-5.2').out >= 12.0);
});
