// scripts/regen-derived-figures.mjs is the ONE entry point that keeps every public figure derived from the price table current (README Pricing table, the planning chains' descriptions, AI-README rows and sentences, the landing sentence,
// the sentences that compare a figure with the default cap, the review-notes Known-limit bounds, MODEL-CAPS.md). PRICES lane, 1 Nov 2026: two misses (unit 2's NL-4b among them)
// showed that a per-commit set built from importers cannot see a README or a chain description that goes stale when a price moves. Offline, $0, nothing written: the derivation runs on the committed files and on files with one figure
// deliberately wrong (an in-memory overlay), and must put each back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveOnce } from '../scripts/regen-derived-figures.mjs';
import { dryRunReport } from '../src/dry-run.js';
import { DEFAULT_MAX_USD } from '../src/default-cap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const disk = rel => readFileSync(join(root, rel), 'utf8');
// PREMISE of RD-5 and RD-8 (added at #10, Mini-C&C R363; the tip's helper asserted the same of its one-judge Mini fixture, which the re-asks in the upper estimate pushed over the cap): they inject a sentence that says "above the default cap" into a chain that is NOT above it, so the fixture chain's
// upper estimate must be under the default cap. It does not track the pricing units: all fifteen seats of plan-claude-council are `external` (answered by a session), and an external seat is exempt from pricing in code (`needsPrice`, src/cost.js), so the dry run's upper estimate is 0 whatever the price table says
// and a change to how re-asks, retries or steps are priced cannot move it. The assertion fails loudly only if that chain ever gets a paid seat, instead of letting the two tests pass for the wrong reason. No price rows of its own are needed in the fixture.
// CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 00:00-02:47: plan-claude-council gets API seats, so it is no longer free). OLD: the fixture was the shipped plan-claude-council, whose fifteen seats were all `external`. NEW: the fixture is plan-mini-council with every proposer and judge made `external` (the session seat; priced $0) and a description that prints $0 figures, built in memory by this helper; the premise assertion is unchanged. WHY: no shipped planning chain is free any more, and the generator reads chains from disk, so the fixture replaces a real chain's text in the overlay.
const FREE_NAME = 'plan-mini-council';
const FREE_CHAIN = `chains/${FREE_NAME}.json`;
const freeChainRaw = () => {
  const c = JSON.parse(disk(FREE_CHAIN));
  const external = s => ({ provider: 'external', model: 'claude-code-session', ...(s.lab ? { lab: s.lab } : {}), ...(s.layer !== undefined ? { layer: s.layer } : {}) });
  c.seats.proposers = c.seats.proposers.map(external); c.seats.critics = c.seats.critics.map(external);
  c.description = 'The free fixture: $0.00 expected and an upper estimate of $0.00. ';
  const raw = `${JSON.stringify(c, null, 2)}\n`;
  const est = dryRunReport(JSON.parse(raw), { defaultCapUsd: DEFAULT_MAX_USD }).estimate;
  assert.ok(est.maximumUsd < DEFAULT_MAX_USD, `PREMISE: the fixture chain's upper estimate (${est.maximumUsd}) is under the default cap (${DEFAULT_MAX_USD})`);
  return raw;
};

test('RD-1: on the committed tree every derived figure is current: nothing would change, nothing is a problem', () => {
  const r = deriveOnce(root);
  assert.deepEqual([...r.changes.keys()], [], r.notes.join('\n'));
  assert.deepEqual(r.problems, []);
});

test('RD-2: a README Pricing table figure that is off by a cent is put back (the table row of plan-mini-council)', () => {
  const readme = disk('README.md');
  const row = readme.split('\n').find(l => l.startsWith('| `plan-mini-council` |'));
  // CHANGED (13 Nov 2026, owner: the upper estimate leaves the README's table): OLD the pattern took the two figure cells (expected, upper estimate) and moved the second; NEW the row has one figure cell, the Expected figure, and that one is moved (it must still be put back: the Expected figures are checked, never skipped).
  const m = /\| (\$[0-9.]+) \|/.exec(row);
  assert.ok(m, 'the row of plan-mini-council has an Expected figure cell');
  const wrong = readme.replace(row, row.replace(m[1], `$${(Number(m[1].slice(1)) + 0.01).toFixed(2)}`));
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
  // CHANGED (0.8.4 apply, the README rework): the Known limits moved word for word to KNOWN-LIMITS.md, where step 6 of the script now reads and writes the bound (OLD: README.md; `readme` below is now the limits file). The figure must be found there: before, a missing figure failed on `m[0]` with no message.
  const readme = disk('KNOWN-LIMITS.md'); const m = /(\$[0-9]+\.[0-9]{2}) for `plan-china-high-council`/.exec(readme);
  assert.ok(m, 'the bound of plan-china-high-council is in KNOWN-LIMITS.md');
  const wrong = readme.replace(m[0], `$${(Number(m[1].slice(1)) + 0.5).toFixed(2)} for \`plan-china-high-council\``);
  const r = deriveOnce(root, new Map([['KNOWN-LIMITS.md', wrong]]));
  assert.equal(r.changes.get('KNOWN-LIMITS.md'), readme);
});

test('RD-5: a sentence that compares a figure with the default cap is checked both ways: "fits under" is rewritten when the upper estimate crossed it, "above" with nothing above is a problem', () => {
  // CHANGED ACCEPTED TEST (0.8.4 unit 4, 04 Nov 2026; his picks OWNER 5 and 6). OLD at the tip: the fixture was plan-mini-council cut to one judge on its lowest layer (a helper that asserted its upper estimate under the $7 default cap). NEW: plan-claude-council (a $0 chain, under the cap whatever the table says); the tip's helper and sentence constant are replaced by `freeChainRaw`, which asserts the same premise (the fixture chain's upper estimate is under the default cap) on the new fixture. WHY: the upper estimate now includes re-asks and network retries, and the one-judge Mini's rose past $7 ($8.19, derived), so it can no longer stand for "a chain under the cap"; the check under test is unchanged. The new fixture does not track the pricing units either: its seats are all `external`, which is exempt from pricing (`needsPrice`), so its upper estimate is 0 and no price-table change can move it (see the helper's comment).
  const rel = FREE_CHAIN; const raw = freeChainRaw();
  const claims = raw.replace('"description": "', `"description": "The upper estimate is above the default cap of $${DEFAULT_MAX_USD}. `);   // 10 Nov 2026: the cap is derived (it was a typed $7)
  assert.notEqual(claims, raw, 'the fixture sentence is in the file');
  const r = deriveOnce(root, new Map([[rel, claims]]));
  assert.ok(r.problems.some(p => p.startsWith(`${FREE_NAME}:`) && /above the default cap/.test(p)), r.problems.join('\n'));
});

// 0.8.4 (the add-on removal): RD-6 (an advice chain's max_price pin put back), RD-9 (the advise-standard ceiling and its README sentence) and RD-10 (the generator reaching chains/outdated's advice chains) are removed: the generator's advice steps are gone (scripts/regen-derived-figures.mjs) and so are the chains they read.
// CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 01:10: plan-default-opro-council, the quick-start chain whose description printed one value for its expected figure and its cheapest end, retires). OLD: the fixture was that chain's own text. NEW: the fixture is plan-mini-council, whose floor equals its expected figure (one overseer round), with one sentence added that prints the cheapest end with the same value; the premise (floor = expected in the dry run) is asserted. WHY: the quick-start chain is now the default chain, and no shipped description prints the cheapest end beside an equal expected figure.
test('RD-7: a chain that prints one value for its expected figure and its cheapest end (the default chain, one overseer round); when both are off by the same amount they are regenerated together, with no problem', () => {
  // CHANGED ACCEPTED TEST (0.8.4 ladder unit, found by the box set, 10 Nov 2026; FINDING, not on the owed list). OLD: the fixture was plan-mini-council, whose floor equalled its expected figure (one overseer round). NEW: the free fixture chain (all seats external, $0.00 in every figure, the same fixture RD-5 and RD-8 use). WHY: plan-mini-council is a ladder chain now: its floor is one pass ($3.71) and its expected figure three top-layer reads ($7.14), so no shipped chain prints one value for both any more; the clash this row guards (one printed value that must become one new value) needs the two to be equal, which the free chain's zeros are.
  const rel = FREE_CHAIN; const base = freeChainRaw();
  const est = dryRunReport(JSON.parse(base), { defaultCapUsd: DEFAULT_MAX_USD }).estimate;
  assert.equal(est.floorUsd.toFixed(2), est.expectedUsd.toFixed(2), 'PREMISE: the dry run\'s floor is the expected figure (both $0.00)');
  const m = /(\$[0-9]+\.[0-9]{2}) expected/.exec(base);
  const raw = base.replace('The free fixture:', `The free fixture: The cheapest end, ${m[1]}, is the same figure.`);
  assert.notEqual(raw, base, 'the fixture sentence is in the file');
  const cheapest = /cheapest end,? \(?(\$[0-9]+\.[0-9]{2})/.exec(raw);
  assert.equal(m[1], cheapest[1], 'PREMISE: this text prints the same value for both figures');
  const wrong = raw.split(m[1]).join(`$${(Number(m[1].slice(1)) + 0.05).toFixed(2)}`);
  const r = deriveOnce(root, new Map([[rel, wrong]]));
  assert.deepEqual(r.problems, [], 'one printed value that must become one new value is not a clash');
  assert.equal(r.changes.get(rel), raw);
});

test('RD-8: a description that says the cheapest end is above the default cap, when it is not, is a problem (the reverse check can fire)', () => {
  // CHANGED (0.8.4 seats unit, Muad 10 Nov 2026 00:59): the premise chain is plan-high-council now; plan-medium-council's cheapest end ($6.47 on the new roster) fits under the cap, so its description no longer says it is above.
  const rel = 'chains/plan-high-council.json'; const raw = disk(rel);
  const m = /and the cheapest end \((\$[0-9.]+), one overseer round, the dry run's floor\) are above the default cap/.exec(raw);
  assert.ok(m, 'PREMISE: high\'s cheapest end is above the default cap today and its description says so');
  // the same sentence on a chain whose cheapest end is under the cap. CHANGED ACCEPTED TEST (0.8.4 unit 4, 04 Nov 2026): OLD at the tip: the one-judge Mini; NEW: plan-claude-council ($0, under the cap whatever the table says). WHY: see RD-5 (the one-judge Mini's upper estimate rose past $7; its cheapest end still fits, but the fixture sentence is built for a chain that is under the cap in every figure).
  const free = freeChainRaw();
  const claims = free.replace('"description": "', `"description": "The upper estimate ($6.27) and the cheapest end ($1.85, one overseer round, the dry run's floor) are above the default cap of $${DEFAULT_MAX_USD}. `);
  assert.notEqual(claims, free);
  const r = deriveOnce(root, new Map([[FREE_CHAIN, claims]]));
  assert.ok(r.problems.some(p => p.startsWith(`${FREE_NAME}: the description says the cheapest end is above the default cap`)), r.problems.join('\n'));
});
