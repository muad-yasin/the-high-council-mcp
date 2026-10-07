// The public price figures are claims about this repo (the landing-page test's reasoning): every expected and maximum figure the README and the landing page print for a chain is derived here from
// the dry run itself, so a price change, a chain edit or a change to the maximum's definition turns this red until the text is updated (0.8.2 item 8c; owner 7 Oct 2026; C&C: "every new public number
// must come from a dry run the tests can re-derive"). Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dryRunReport } from '../src/dry-run.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const page = readFileSync(join(root, 'docs', 'index.html'), 'utf8');
const figures = name => { const r = dryRunReport(JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8')), { defaultCapUsd: 7 }); return { exp: `$${r.estimate.expectedUsd.toFixed(2)}`, max: `$${r.estimate.maximumUsd.toFixed(2)}`, e: r.estimate.expectedUsd, m: r.estimate.maximumUsd }; };
const CHAINS = ['cheap-7-v2', 'plan-premium-7', 'plan-highest-7', 'plan-daily-7'];

test('README: the table of recommended chains prints each chain\'s expected and maximum figure exactly as the dry run gives them', () => {
  for (const name of CHAINS) {
    const f = figures(name);
    const row = readme.split('\n').find(l => l.startsWith(`| \`${name}\` |`));
    assert.ok(row, name);
    assert.ok(row.trimEnd().endsWith(`| ${f.exp} / ${f.max} |`), `${name}: the row should end with "${f.exp} / ${f.max}", it is: ...${row.slice(-40)}`);
  }
  assert.match(readme, /\| Chain \| Who does what \| Needs \| Expected \/ at most \|/);
  assert.ok(readme.split('\n').find(l => l.startsWith('| `local-ollama` |')).trimEnd().endsWith('| $0 / $0 |'));
});

test('README: the first-ten-minutes example names the expected and the maximum figure of cheap-7-v2 and a cap just above the maximum', () => {
  const f = figures('cheap-7-v2');
  assert.ok(readme.includes(`\`cheap-7-v2\` expects ${f.exp} and could cost up to ${f.max}`), 'the sentence under step 4');
  const cap = (Math.ceil(f.m * 100) / 100 + 0.01).toFixed(2);
  assert.ok(readme.includes(`--chain cheap-7-v2 --max-usd ${cap}`), `the command carries a cap just above the maximum (${cap})`);
});

test('README: plan-daily-7 and plan-lanes-4 bullets quote their dry-run figures', () => {
  const d = figures('plan-daily-7'), l = figures('plan-lanes-4');
  assert.ok(readme.includes(`${d.exp} expected, ${d.max} at most`), 'plan-daily-7');
  assert.ok(readme.includes(`Dry run: ${l.exp} expected at the chain's own task-size estimate, ${l.max} at most`), 'plan-lanes-4');
});

test('landing page: the chain cards print each chain\'s expected and maximum figure, and say which side of the default cap the expected one is', () => {
  for (const [name, text] of [['cheap-7-v2', 'above the default cap'], ['plan-premium-7', 'above the default cap'], ['plan-highest-7', 'above the default cap']]) {
    const f = figures(name);
    assert.ok(page.includes(`${f.exp} expected and ${f.max} at most, ${text}`), name);
  }
  // Owner's redesign of 7 Oct 2026 (every seat votes): plan-daily-7 now expects more than the default cap, like plan-highest-7, so its card says "above".
  const d = figures('plan-daily-7');
  assert.ok(page.includes(`${d.exp} expected, above the default cap; ${d.max} at most`), 'plan-daily-7');
  assert.ok(d.e > 7 && figures('plan-highest-7').e > 7, 'the "above" words still hold');
  const c = figures('cheap-7-v2');
  assert.ok(page.includes(`it is expected to cost ${c.exp} and could cost up to ${c.max}`));
});

test('no public text calls the expected figure a worst case any more', () => {
  assert.doesNotMatch(readme, /\$11\.22 worst case|worst-case price for your task|Worst case \|/);
  assert.doesNotMatch(page, /\$\d+\.\d\d worst case|worst-case price/);
});
