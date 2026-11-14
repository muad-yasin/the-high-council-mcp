// CHANGED ACCEPTED (Pricing table layout, 26 Okt 2026, owner: "Yes, much better"): OLD run-costs.json held a flat `chains` list, the row order was the list's order, the columns were Chain | Tested cost | Expected | Upper estimate and an unrun chain said "not run yet"; NEW `groups` (label + chains) are flattened wherever the chains are read, the columns are Chain | Expected | Upper estimate | Tested, the tested cell is an en dash exactly when no real run is recorded, advise-single's Upper estimate is column index 3 (was 4, and the header is asserted before the index is used), and a new test pins the group order and the sort by expected cost inside each group.
// The README's Pricing table is generated (owner, 18 Okt 2026: the chains, their tested cost on real runs, the expected cost and the maximum; 13 Nov 2026, owner: "I want it removed before the PR. This is just about the readme": the maximum (the upper estimate) is no longer a column): this test regenerates it from the chains, the
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
const chains = data.groups.flatMap(g => g.chains);
const cells = line => line.split('|').map(c => c.trim());
const dollars = c => Number(/^\$(\d+\.\d\d)$/.exec(c)?.[1]);

test('the README pricing table equals what the script writes (edit the sources, run node scripts/pricing-table.mjs)', () => {
  assert.equal(readme, readmeWithTable(root), 'README.md pricing table is stale: run node scripts/pricing-table.mjs');
});

test('every listed chain exists, once; a tested entry belongs to a listed chain; the tested cell is \u2013 exactly when no real run is recorded', () => {
  assert.equal(new Set(chains).size, chains.length, 'a chain is listed twice');
  for (const name of chains) assert.ok(existsSync(join(root, 'chains', `${name}.json`)), `chains/${name}.json is listed but missing`);
  for (const name of Object.keys(data.tested || {})) assert.ok(chains.includes(name), `${name} has a tested entry but no row`);
  const table = generatePricingTable(root);
  for (const name of chains) {
    const row = table.split('\n').find(l => l.startsWith(`| \`${name}\` |`));
    assert.ok(row, `${name} has no row`);
    const tested = cells(row)[3];   // CHANGED (13 Nov 2026, owner: the upper estimate leaves the README's table): OLD cells(row)[4], with the Upper estimate cell before it; NEW the row is | name | Expected | Tested |
    const t = data.tested?.[name];
    if (!t) { assert.equal(tested, '\u2013', `${name}: no real run is recorded, so the tested cell is an en dash`); continue; }
    const up = n => `$${(Math.ceil(Math.round(n * 100) / 10) / 10).toFixed(1)}`;   // CHANGED (14 Nov 2026, owner: "I think we could round it up and display $3.6"): OLD the figures to the cent; NEW rounded up to the tenth of a dollar
    const figures = t.minUsd === t.maxUsd ? up(t.minUsd) : `${up(t.minUsd)}\u2013${up(t.maxUsd)}`;
    assert.equal(tested, `${figures} (${t.runs} run${t.runs === 1 ? '' : 's'})`, `${name}: the tested cell is the figures and the run count, no version or dates`);
  }
});

// 0.8.3 (lane B fix-up, C&C thcmcp-cd 23 Okt 2026): the quick-start chain plan-default-opro-council was in the README's "Which chain" table but had no Pricing row. The names come from that table (the rows between its
// header and the next blank line), so a chain added to it later without a price row fails here instead of being missing.
test('every chain the README\'s "Which chain" table lists has a row in the Pricing table', () => {
  const lines = readFileSync(join(root, 'AI-README.md'), 'utf8').split('\n');   // README split (owner, 26 Okt 2026: "one final commit"): the section moved word for word to AI-README.md (the Which-chain table); the Pricing table stays in the README
  const head = lines.findIndex(l => l.startsWith('| Chain | Who does what |'));
  assert.ok(head >= 0, 'the "Which chain" table header was not found');
  const names = [];
  for (let i = head + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const m = /^\| `([^`]+)` \|/.exec(lines[i]);
    assert.ok(m, `row ${i + 1} of the "Which chain" table has no chain name: ${lines[i].slice(0, 60)}`);
    names.push(m[1]);
  }
  assert.ok(names.length >= 6, `the "Which chain" table parsed to ${names.length} rows`);   // CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 01:10): OLD >= 8 rows; NEW >= 6, because the table lost the rows of the three retired chains it listed (verify was never in it); the check that matters is the next line, every listed chain has a Pricing row
  assert.deepEqual(names.filter(n => !chains.includes(n)), [], 'listed in "Which chain" but missing from maintainers/run-costs.json chains (the Pricing table)');
});

test('the top link row and the contents link to the section, and the section points to the CONTRIBUTING ask', () => {
  assert.ok(readme.indexOf(START) > readme.indexOf('\n## Pricing\n') && readme.indexOf(END) > readme.indexOf(START));
  const top = readme.slice(0, readme.indexOf('## Try it in 30 seconds'));
  assert.match(top, /\[Pricing\]\(#pricing\)/, 'the top link row names Pricing');
  assert.match(readme.slice(readme.indexOf('## Contents')), /\[Pricing\]\(#pricing\)/, 'the contents list names Pricing');
  assert.match(readme, /\(CONTRIBUTING\.md#send-a-run-cost\)/);
  assert.match(readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8'), /^## Send a run cost$/m, 'the anchor the README links to');
});

// CHANGED ACCEPTED (0.8.4 add-on removal). OLD: a test that the advise-standard row of the Pricing table showed the same upper estimate as the Known-limits ceiling sentence.
// NEW: the Pricing table has no advice row and the README names no advice chain's ceiling. WHY: advise-standard left chains/ and the Known limit sentence left with the add-on.
test('the Pricing table has no advice row', () => {
  const lines = generatePricingTable(root).split('\n');
  assert.equal(lines.filter(l => /advise-/.test(l)).length, 0, 'no row of the Pricing table names an advice chain');
  // CHANGED (0.8.4 apply, the README rework): the Known limits moved to KNOWN-LIMITS.md, where such a sentence would live; the absence reads both files (OLD: README.md alone).
  assert.doesNotMatch(`${readme}\n${readFileSync(join(root, 'KNOWN-LIMITS.md'), 'utf8')}`, /`advise-standard`'s ceiling/);
});

test('the table is grouped as run-costs.json lists the groups, and inside each group the rows are in ascending order of expected cost', () => {
  const lines = generatePricingTable(root).split('\n');
  const head = lines.findIndex(l => l.startsWith('| Chain |'));
  // CHANGED (13 Nov 2026, owner: the upper estimate leaves the README's table): OLD cells(lines[head]).slice(1, 5) equal to ['Chain', 'Expected', 'Upper estimate', 'Tested (real runs)'] and the group row `| **label** | | | |`; NEW slice(1, 4) equal to ['Chain', 'Expected', 'Tested (real runs)'] and the group row `| **label** | | |`.
  assert.deepEqual(cells(lines[head]).slice(1, 4), ['Chain', 'Expected', 'Tested (real runs)']);
  let at = head + 2;
  for (const g of data.groups) {
    assert.equal(lines[at], `| **${g.label}** | | |`, `the group row of ${g.label}`);
    const rows = [];
    for (at += 1; at < lines.length && lines[at].startsWith('| `'); at++) rows.push(cells(lines[at]));
    assert.deepEqual(rows.map(r => r[1].replace(/`/g, '')).sort(), [...g.chains].sort(), `${g.label}: the rows are the group's chains`);
    const expected = rows.map(r => dollars(r[2]));
    assert.ok(expected.every(Number.isFinite), `${g.label}: every expected cell is a dollar figure`);
    assert.deepEqual(expected, [...expected].sort((a, b) => a - b), `${g.label}: rows are not in ascending order of expected cost: ${expected.join(', ')}`);
  }
  assert.equal(lines[at], '', 'the table ends after the last group');
});
