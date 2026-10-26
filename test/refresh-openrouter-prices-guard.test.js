// RFP-1 (lane E, 24 Okt 2026; C&C thcmcp-cd's ruling on the stale-price re-check): scripts/refresh-openrouter-prices.mjs stamps `_openrouterCheckedAt`, and test/price-table-date.test.js bounds the
// table's `asOf` by that stamp for every openrouter/ row. The stamp means "every openrouter/ row without an `expires` date was compared with the list on that date", so a row the list no longer
// names (never compared) must stop the script: exit 2, nothing written, stamp unmoved. The script derives its root from its own path, so the test runs a COPY of it in a temp tree (the script,
// src/pricing.json and chains/), with a fixture model list made from the table's own rows, and never touches the repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join('scripts', 'refresh-openrouter-prices.mjs');
const table = JSON.parse(readFileSync(join(root, 'src', 'pricing.json'), 'utf8'));
const rows = Object.entries(table).filter(([k, v]) => k.startsWith('openrouter/') && v && typeof v === 'object');

function tree() {
  const dir = mkdtempSync(join(tmpdir(), 'rfp-guard-'));
  mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'src'));
  copyFileSync(join(root, SCRIPT), join(dir, SCRIPT));
  copyFileSync(join(root, 'src', 'pricing.json'), join(dir, 'src', 'pricing.json'));
  cpSync(join(root, 'chains'), join(dir, 'chains'), { recursive: true });
  return dir;
}
// a model list that names every openrouter/ row at its own price (per token, as OpenRouter writes it), except `left` ids
const listWithout = left => ({ data: rows.filter(([k]) => !left.includes(k.slice('openrouter/'.length))).map(([k, v]) => ({ id: k.slice('openrouter/'.length), pricing: { prompt: String(v.in / 1e6), completion: String(v.out / 1e6) } })) });
function run(dir, list) {
  const file = join(dir, 'models.json'); writeFileSync(file, JSON.stringify(list));
  return spawnSync(process.execPath, [SCRIPT, file, '--write'], { cwd: dir, env: { ...process.env, PRICING_CHECKED_AT: '2099-01-01' }, encoding: 'utf8' });
}

test('RFP-1: a full list moves the stamp; a list missing a row refuses (exit 2), writes nothing and leaves the stamp alone', () => {
  assert.ok(rows.length >= 40, `the table has ${rows.length} openrouter rows`);
  const victim = rows.find(([, v]) => !v.expires)[0].slice('openrouter/'.length);   // a row the script compares (a row with `expires` that is off the list is refused too; this test removes a compared one)

  const ok = tree();
  const full = run(ok, listWithout([]));
  assert.equal(full.status, 0, `a full list: ${full.stderr}`);
  assert.equal(JSON.parse(readFileSync(join(ok, 'src', 'pricing.json'), 'utf8'))._openrouterCheckedAt, '2099-01-01', 'a full list moves the stamp (the control: the refusal below is not a script that never writes)');

  const bad = tree();
  const before = readFileSync(join(bad, 'src', 'pricing.json'));
  const out = run(bad, listWithout([victim]));
  assert.equal(out.status, 2, `a list missing ${victim}: exit ${out.status}, stderr ${out.stderr}`);
  assert.ok(out.stderr.includes(victim) && /not on OpenRouter's list any more/.test(out.stderr), `the refusal names the row: ${out.stderr}`);
  assert.ok(readFileSync(join(bad, 'src', 'pricing.json')).equals(before), 'src/pricing.json is byte-identical after the refusal');
  assert.equal(JSON.parse(readFileSync(join(bad, 'src', 'pricing.json'), 'utf8'))._openrouterCheckedAt, table._openrouterCheckedAt, 'the stamp is the one the table had');
});
