// scripts/regen-derived-figures.mjs is the ONE entry point that keeps every public figure derived from the price table current (README Pricing table, the planning chains' descriptions, AI-README rows and sentences, the landing sentence,
// the sentences that compare a figure with the default cap, the advice pins and ceilings with their derivation sentences, the review-notes Known-limit bounds, MODEL-CAPS.md). PRICES lane, 1 Nov 2026: two misses (unit 2's NL-4b among them)
// showed that a per-commit set built from importers cannot see a README or a chain description that goes stale when a price moves. Offline, $0, nothing written: the derivation runs on the committed files and on files with one figure
// deliberately wrong (an in-memory overlay), and must put each back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveOnce } from '../scripts/regen-derived-figures.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const disk = rel => readFileSync(join(root, rel), 'utf8');

test('RD-1: on the committed tree every derived figure is current: nothing would change, nothing is a problem', () => {
  const r = deriveOnce(root);
  assert.deepEqual([...r.changes.keys()], [], r.notes.join('\n'));
  assert.deepEqual(r.problems, []);
});

test('RD-2: a README Pricing table figure that is off by a cent is put back (the table row of plan-mini-council)', () => {
  const readme = disk('README.md');
  const row = readme.split('\n').find(l => l.startsWith('| `plan-mini-council` |'));
  const m = /\| (\$[0-9.]+) \| (\$[0-9.]+) \|/.exec(row);
  const wrong = readme.replace(row, row.replace(m[2], `$${(Number(m[2].slice(1)) + 0.01).toFixed(2)}`));
  assert.notEqual(wrong, readme);
  const r = deriveOnce(root, new Map([['README.md', wrong]]));
  assert.equal(r.changes.get('README.md'), readme, 'the table is regenerated from the dry run');
});

test('RD-3: a chain description whose "expected" figure is off is put back, together with the AI-README row that prints it', () => {
  const rel = 'chains/plan-medium-council.json';
  const raw = disk(rel); const m = /(\$[0-9][0-9,.]*[0-9]) expected/.exec(raw);
  const wrong = raw.split(m[1]).join(`$${(Number(m[1].slice(1)) + 0.05).toFixed(2)}`);
  assert.notEqual(wrong, raw);
  const r = deriveOnce(root, new Map([[rel, wrong]]));
  assert.equal(r.changes.get(rel), raw, 'the description figure is the dry run\'s');
});

test('RD-4: the review-notes Known-limit bound that is off is put back (NL-4b\'s blind spot)', () => {
  const readme = disk('README.md'); const m = /(\$[0-9]+\.[0-9]{2}) for `plan-china-high-council`/.exec(readme);
  const wrong = readme.replace(m[0], `$${(Number(m[1].slice(1)) + 0.5).toFixed(2)} for \`plan-china-high-council\``);
  const r = deriveOnce(root, new Map([['README.md', wrong]]));
  assert.equal(r.changes.get('README.md'), readme);
});

test('RD-5: a sentence that compares a figure with the default cap is checked both ways: "fits under" is rewritten when the upper estimate crossed it, "above" with nothing above is a problem', () => {
  const rel = 'chains/plan-mini-council.json'; const raw = disk(rel);
  // plan-mini-council's upper estimate is under the $7 default cap today: a description claiming it is above must be flagged
  const claims = raw.replace('Every figure printed here fits under the $7 default cap', 'The upper estimate is above the default cap of $7. Every figure printed here fits under the $7 default cap');
  assert.notEqual(claims, raw, 'the fixture sentence is in the file');
  const r = deriveOnce(root, new Map([[rel, claims]]));
  assert.ok(r.problems.some(p => p.startsWith('plan-mini-council:') && /above the default cap/.test(p)), r.problems.join('\n'));
});

test('RD-6: an advice chain whose max_price pin drifted from its row is put back (RA-7), and the advice ceiling derivation is stable', () => {
  const rel = 'chains/advise-single-glm-flash.json'; const raw = disk(rel);
  const m = /"max_price":\s*\{\s*"prompt":\s*([0-9.]+),\s*"completion":\s*([0-9.]+)/.exec(raw);
  const wrong = raw.replace(m[0], m[0].replace(m[1], String(Number(m[1]) / 2)));
  assert.notEqual(wrong, raw);
  const r = deriveOnce(root, new Map([[rel, wrong]]));
  assert.equal(r.changes.get(rel), raw);
});

test('RD-7: the quick-start chain prints one value for its expected figure and its cheapest end; when both are off by the same amount they are regenerated together, with no problem', () => {
  const rel = 'chains/plan-default-opro-council.json'; const raw = disk(rel);
  const m = /(\$[0-9]+\.[0-9]{2}) expected/.exec(raw); const cheapest = /cheapest end,? \(?(\$[0-9]+\.[0-9]{2})/.exec(raw);
  assert.equal(m[1], cheapest[1], 'PREMISE: this chain prints the same value for both figures today');
  const wrong = raw.split(m[1]).join(`$${(Number(m[1].slice(1)) + 0.05).toFixed(2)}`);
  const r = deriveOnce(root, new Map([[rel, wrong]]));
  assert.deepEqual(r.problems, [], 'one printed value that must become one new value is not a clash');
  assert.equal(r.changes.get(rel), raw);
});

test('RD-8: a description that says the cheapest end is above the default cap, when it is not, is a problem (the reverse check can fire)', () => {
  const rel = 'chains/plan-medium-council.json'; const raw = disk(rel);
  const m = /and the cheapest end \((\$[0-9.]+), one overseer round, the dry run's floor\) are above the default cap/.exec(raw);
  assert.ok(m, 'PREMISE: medium\'s cheapest end is above the $7 cap today and its description says so');
  // the same sentence on a chain whose cheapest end is under the cap: mini
  const mini = disk('chains/plan-mini-council.json');
  const claims = mini.replace('Every figure printed here fits under the $7 default cap', "The upper estimate ($6.27) and the cheapest end ($1.85, one overseer round, the dry run's floor) are above the default cap of $7. Every figure printed here fits under the $7 default cap");
  assert.notEqual(claims, mini);
  const r = deriveOnce(root, new Map([['chains/plan-mini-council.json', claims]]));
  assert.ok(r.problems.some(p => /plan-mini-council: the description says the cheapest end is above the default cap/.test(p)), r.problems.join('\n'));
});

test('RD-9: a ceiling whose description prints its derivation floats BOTH ways with it (a raised advise-single-qwen ceiling goes back down); one with no printed derivation (advise-standard) is typed and left alone', () => {
  const qwen = 'chains/advise-single-qwen.json'; const std = 'chains/advise-standard.json';
  const rawQ = disk(qwen); const rawS = disk(std);
  const up = rawQ.replace(/("advise":\s*\{[^}]*?"usd":\s*)[0-9.]+/, (m, a) => `${a}9`);
  const typed = rawS.replace(/("advise":\s*\{[^}]*?"usd":\s*)[0-9.]+/, (m, a) => `${a}9`);
  assert.notEqual(up, rawQ); assert.notEqual(typed, rawS);
  const r = deriveOnce(root, new Map([[qwen, up], [std, typed]]));
  assert.equal(r.changes.get(qwen), rawQ, 'the derived ceiling comes back down to what the printed derivation gives');
  assert.equal(r.changes.has(std), false, 'a typed ceiling is not touched');
});

test('RD-10: the generator reaches the advice chains in chains/outdated (advise-premium, which tests read): a pin that drifted from its row there is put back', () => {
  const rel = 'chains/outdated/advise-premium.json'; const raw = disk(rel);
  const m = /"model":\s*"openai\/gpt-6-astra"[\s\S]*?"max_price":\s*\{\s*"prompt":\s*([0-9.]+)/.exec(raw);
  assert.ok(m, 'PREMISE: advise-premium seats gpt-6-astra with a max_price');
  const wrong = raw.replace(m[0], m[0].replace(new RegExp(`"prompt":\\s*${m[1]}$`), `"prompt": ${Number(m[1]) + 1}`));
  assert.notEqual(wrong, raw);
  const r = deriveOnce(root, new Map([[rel, wrong]]));
  assert.equal(r.changes.get(rel), raw);
});
