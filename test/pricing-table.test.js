// The README's Pricing table is generated (owner, 18 Okt 2026: the chains, their tested cost on real runs, the expected cost and the maximum): this test regenerates it from the chains, the
// price table and maintainers/run-costs.json and fails on ANY difference (the MODEL-CAPS.md pattern), so a figure cannot drift from the code that prints it. Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePricingTable, readmeWithTable, START, END } from '../scripts/pricing-table.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const data = JSON.parse(readFileSync(join(root, 'maintainers', 'run-costs.json'), 'utf8'));

test('the README pricing table equals what the script writes (edit the sources, run node scripts/pricing-table.mjs)', () => {
  assert.equal(readme, readmeWithTable(root), 'README.md pricing table is stale: run node scripts/pricing-table.mjs');
});

test('every listed chain exists, once; a tested entry belongs to a listed chain; a chain with no real run says "not run yet"', () => {
  assert.equal(new Set(data.chains).size, data.chains.length, 'a chain is listed twice');
  for (const name of data.chains) assert.ok(existsSync(join(root, 'chains', `${name}.json`)), `chains/${name}.json is listed but missing`);
  for (const name of Object.keys(data.tested || {})) assert.ok(data.chains.includes(name), `${name} has a tested entry but no row`);
  const table = generatePricingTable(root);
  for (const name of data.chains) {
    const row = table.split('\n').find(l => l.startsWith(`| \`${name}\` |`));
    assert.ok(row, `${name} has no row`);
    assert.equal(row.includes('not run yet'), !data.tested?.[name], `${name}: "not run yet" must match whether a real run is recorded`);
  }
});

// 0.8.3 (lane B fix-up, C&C thcmcp-cd 23 Okt 2026): the quick-start chain plan-default-opro-council was in the README's "Which chain" table but had no Pricing row. The names come from that table (the rows between its
// header and the next blank line), so a chain added to it later without a price row fails here instead of being missing.
test('every chain the README\'s "Which chain" table lists has a row in the Pricing table', () => {
  const lines = readme.split('\n');
  const head = lines.findIndex(l => l.startsWith('| Chain | Who does what |'));
  assert.ok(head >= 0, 'the "Which chain" table header was not found');
  const names = [];
  for (let i = head + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const m = /^\| `([^`]+)` \|/.exec(lines[i]);
    assert.ok(m, `row ${i + 1} of the "Which chain" table has no chain name: ${lines[i].slice(0, 60)}`);
    names.push(m[1]);
  }
  assert.ok(names.length >= 8, `the "Which chain" table parsed to ${names.length} rows`);
  assert.deepEqual(names.filter(n => !data.chains.includes(n)), [], 'listed in "Which chain" but missing from maintainers/run-costs.json chains (the Pricing table)');
});

test('the top link row and the contents link to the section, and the section points to the CONTRIBUTING ask', () => {
  assert.ok(readme.indexOf(START) > readme.indexOf('\n## Pricing\n') && readme.indexOf(END) > readme.indexOf(START));
  const top = readme.slice(0, readme.indexOf('## Try it in 30 seconds'));
  assert.match(top, /\[Pricing\]\(#pricing\)/, 'the top link row names Pricing');
  assert.match(readme.slice(readme.indexOf('## Contents')), /\[Pricing\]\(#pricing\)/, 'the contents list names Pricing');
  assert.match(readme, /\(CONTRIBUTING\.md#send-a-run-cost\)/);
  assert.match(readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8'), /^## Send a run cost$/m, 'the anchor the README links to');
});

test('an advice row shows the add-on\'s own figures: the same "at most" as the Known-limits ceiling sentence', () => {
  const row = generatePricingTable(root).split('\n').find(l => l.startsWith('| `advise-single` |'));
  const most = row.split('|').map(c => c.trim())[4];
  const limit = readme.match(/`advise-single`'s ceiling is (\$[0-9.]+)/);
  assert.ok(limit, 'the Known-limits sentence names advise-single\'s ceiling');
  assert.equal(most, limit[1], 'the Pricing table and the Known-limits sentence must show one figure for advise-single');
});
