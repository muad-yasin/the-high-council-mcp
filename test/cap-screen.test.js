// The screen before the typed limit (typed-cap gate page T2, 14 Oct 2026; Astra #4). Pure text builder: four figures, one BLANK field, no promise the code cannot keep. $0, no file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const screen = await import('../src/cap-screen.js').catch(() => ({}));
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUN = { kind: 'run', subject: { chain: 'plan-premium-7', task: 'tasks/x.md' }, estimate: { usd: 2.5, scope: 'this run' }, maximum: { usd: 6.2 }, ceilings: [{ usd: 10, source: 'COUNCIL_MAX_USD_LIMIT' }], suggestion: { usd: 7, source: 'MAX_USD_PER_RUN' }, priceAsOf: '2026-10-13' };

test('CS-1 the five fields of a run, word for word: estimate with its scope and price date, the bounded maximum, the BLANK limit (no number but the example), the ceiling, the suggestion that is not the limit', () => {
  const s = screen.buildCapScreen(RUN);
  assert.equal(s.fields.estimate, 'Estimate: about $2.50 for this run, at the prices of 2026-10-13.');
  assert.equal(s.fields.maximum, 'Most it could cost to finish, by the dry run\'s count: $6.20 (not a ceiling: see below).');
  assert.equal(s.fields.limit, 'Your limit: type the total, in US dollars, that this run may spend (for example 5). THC refuses any call whose projected cost would take the total past it.');
  assert.deepEqual(s.fields.ceilings, ['Ceiling in force: $10.00 (set by COUNCIL_MAX_USD_LIMIT). You cannot type more.']);
  assert.equal(s.fields.suggestion, 'Configured suggestion: $7.00 (from MAX_USD_PER_RUN). It is shown only; it is not your limit until you type it.');
  assert.ok(s.text.startsWith('Start this run? Chain: plan-premium-7. Task: tasks/x.md.\n\n') && s.text.includes(s.fields.limit) && s.text.includes(s.fields.completion));
  assert.ok(!s.fields.limit.includes('7') && !s.fields.limit.includes('$'), 'the suggestion never reaches the limit field: it is blank by construction');
});

test('CS-2 a TREE says its estimate covers the root run only and its maximum is unknown, with the reason; an unknown maximum is the word "unknown", never a number', () => {
  const s = screen.buildCapScreen({ ...RUN, kind: 'tree', estimate: { usd: 1.1, scope: 'the root run only' }, maximum: { unknown: 'the sub-plans are not known before the plan is split' }, suggestion: null });
  assert.equal(s.fields.estimate, 'Estimate: about $1.10 for the root run only, at the prices of 2026-10-13.');
  assert.equal(s.fields.maximum, 'Most it could cost to finish, by the dry run\'s count: unknown (the sub-plans are not known before the plan is split).');
  assert.ok(s.text.startsWith('Start this tree?') && s.fields.limit.includes('this tree may spend') && s.fields.suggestion === null && !s.text.includes('Configured suggestion'));
});

test('CS-3 a missing or non-finite figure is said so (never "$NaN"), and several ceilings are all listed', () => {
  const s = screen.buildCapScreen({ ...RUN, estimate: { usd: NaN, scope: 'x' }, maximum: undefined, ceilings: [{ usd: 10, source: 'COUNCIL_MAX_USD_LIMIT' }, { usd: 4, source: "the extension's max_usd" }, { usd: NaN, source: 'broken' }] });
  assert.equal(s.fields.estimate, 'Estimate: not available.');
  assert.equal(s.fields.maximum, 'Most it could cost to finish, by the dry run\'s count: unknown (it was not computed).');
  assert.equal(s.fields.ceilings.length, 2); assert.ok(!s.text.includes('NaN'), s.text);
  assert.equal(screen.buildCapScreen({}).fields.estimate, 'Estimate: not available.');
});

test('CS-4 the ENFORCEMENT sentence is one switch on the cost-unit state: the weaker sentence today (known-bad: it must not claim the stronger one), the stronger only when every one of U2, U3, U5, U6, U7, U9 has landed', () => {
  const weak = screen.buildCapScreen(RUN);
  assert.equal(weak.enforcement, 'weak'); assert.match(weak.fields.enforcement, /so a provider that charges more can take a call past your limit by that difference\. This is a guardrail, not a guarantee\.$/);
  assert.equal(screen.enforcementState(), 'weak'); assert.deepEqual([...screen.COST_UNIT_LANDED], []);
  const five = ['U2', 'U3', 'U5', 'U6', 'U7'];
  assert.equal(screen.enforcementState(five), 'weak', 'five of six is still the weaker sentence');
  const all = [...five, 'U9'];
  assert.equal(screen.enforcementState(all), 'strong');
  const strong = screen.buildCapScreen({ ...RUN, landed: all });
  assert.match(strong.fields.enforcement, /^Every request THC makes is refused before it is sent when its worst case would pass your limit, retried requests included\./);
  assert.match(strong.fields.enforcement, /This does not cover a key used outside THC\.$/);
  assert.notEqual(strong.fields.enforcement, weak.fields.enforcement);
});

test('CS-5 the builder is pure: no file, clock, environment or randomness in src/cap-screen.js (a source scan)', () => {
  const src = readFileSync(join(root, 'src', 'cap-screen.js'), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(src, /\bfrom 'node:|\bprocess\.|\bDate\b|Math\.random|\bimport\(/);
});

test('user-priced seats: the screen shows their FIGURES and the file name (a $0.01 row is visible before typing); no sentence when no seat rests on the project file', () => {
  const none = screen.buildCapScreen(RUN);
  assert.equal(none.fields.userPrices, null); assert.doesNotMatch(none.text, /pricing\.user\.json/);
  const some = screen.buildCapScreen({ ...RUN, userPrices: [{ key: 'openrouter/vendor/m', in: 0.01, out: 0.04 }, { key: 'openrouter/vendor/n', in: 2, out: 8 }] });
  assert.match(some.text, /Priced from pricing\.user\.json in your project folder: openrouter\/vendor\/m in 0\.01 \/ out 0\.04 per million tokens; openrouter\/vendor\/n in 2 \/ out 8 per million tokens\./);
  assert.doesNotMatch(some.text, /your own/, 'if an agent wrote the row, "your own" would be false: the file name is the truth');
});

test('user-priced seats: a row the merge ignored is not listed here (doctor says so); a MIXED row names the field that is the package\'s', () => {
  const mixed = screen.buildCapScreen({ ...RUN, userPrices: [{ key: 'openrouter/vendor/m', in: 3, out: 8, src: { in: 'user', out: 'shipped' } }] });
  assert.match(mixed.text, /openrouter\/vendor\/m in 3 \/ out 8 per million tokens \(the out figure is the package's, the higher one\)/);
  const mixed2 = screen.buildCapScreen({ ...RUN, userPrices: [{ key: 'openrouter/vendor/m', in: 3, out: 8, src: { in: 'shipped', out: 'user' } }] });
  assert.match(mixed2.text, /\(the in figure is the package's, the higher one\)/);
  const full = screen.buildCapScreen({ ...RUN, userPrices: [{ key: 'openrouter/vendor/m', in: 3, out: 8, src: { in: 'user', out: 'user' } }] });
  assert.doesNotMatch(full.text, /the package's\)/);
});

// ---- T4b2: the screens of a run's limit after the first one ----------------------------------------------------------------------------------------------------------------------------------------------------------
test('legacy / raise / amend screens: the history block states what the run has already counted; the limit is a TOTAL for the whole run above the floor; no estimate lines', async () => {
  const { formatUsd: $ } = await import('../src/cost.js');   // the screen prints money the way the rest of THC does
  const legacy = screen.buildCapScreen({ ...RUN, kind: 'legacy', history: { spentUsd: 4.2, unsettledUsd: 0.7, floorUsd: 4.2 } });
  assert.match(legacy.text, /^Continue this run\?/);
  assert.ok(legacy.text.includes(`This run was started before a typed limit existed.\nAlready counted: ${$(4.2)}, of which ${$(0.7)} is for calls that were still running when the run stopped and may or may not have been billed.`), legacy.text);
  assert.ok(legacy.text.includes(`Your new limit: type the TOTAL, in US dollars, for the whole run (not extra). It must be above ${$(4.2)}, what the run has already counted.`), legacy.text);
  assert.doesNotMatch(legacy.text, /Estimate:|Most it could cost/);
  const raise = screen.buildCapScreen({ ...RUN, kind: 'raise', history: { previousCapUsd: 5, spentUsd: 5.5, projectedStageUsd: 0.6, suggestedUsd: 6.1, floorUsd: 5.5 } });
  assert.ok(raise.text.includes(`This run stopped at its limit of ${$(5)}: ${$(5.5)} counted, and the next stage could cost up to ${$(0.6)}.`), raise.text);
  assert.ok(raise.text.includes(`The smallest total that gets past this stop: ${$(6.1)}.`), raise.text);
  const amend = screen.buildCapScreen({ ...RUN, kind: 'amend', history: { previousCapUsd: 5, spentUsd: 3, floorUsd: 3, changed: ['the chain file', 'the policy file'] } });
  assert.ok(amend.text.includes('Changed since the limit for this run was typed: the chain file; the policy file.'), amend.text);
  assert.ok(amend.text.includes(`Previous limit: ${$(5)}. Already counted: ${$(3)}.`), amend.text);
  const unknown = screen.buildCapScreen({ ...RUN, kind: 'amend', history: { previousCapUsd: 5, spentUsd: 3, floorUsd: 3, changed: null } });
  assert.match(unknown.text, /the earlier state of this run cannot be shown/);
});
