// ROADMAP 77, the OFFER side of the paid repair recommendation (src/tree-advice.js; gate note m7/A_Paid_Repair_Recommendation_Gate_Note.md 3.3, 3.6, 3.7; C&C PASS 18 Okt 2026). Pure functions: no record, no model, $0.
// The wording is A-DRAFT (texts E22, E25): the tests pin the figures and the choices, and the sentences as they stand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adviceChainNamed, adviceOfferFacts, adviceOfferLines, adviceGateText, adviceBriefRefusal, RECOMMENDATION_IS } from '../src/tree-advice.js';
import { budgetOf, capFactsOf } from '../src/tree-budget.js';
import { readTreeRecord } from '../src/tree-record.js';
import { closedRootTree, approveFrontier, registerKid, syntheticRun, IDS } from './helpers/tree-fixture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAMED = { named: true, name: 'advise-single-opus' };
const setAside = (grant, free) => `This sets aside ${grant} of the ${free} that is free under this tree's cap right now; what it does not spend is given back.`;
const base = over => ({ chain: NAMED, cap: { exhausted: false }, availableNowUsd: 10, freeUsd: 10, cheapestUsd: 1, ceilingUsd: 0.4, reaskAvailable: true, ...over });

test('AO-1: the advisor chain is the one the person NAMED (option beats the variable); blank, whitespace or nothing is no chain; never a default', () => {
  assert.deepEqual(adviceChainNamed({ env: { COUNCIL_ADVISE_CHAIN_SINGLE: ' advise-single-opus ' } }), { named: true, name: 'advise-single-opus', source: 'env' });
  assert.deepEqual(adviceChainNamed({ env: { COUNCIL_ADVISE_CHAIN_SINGLE: 'a' }, option: 'b' }), { named: true, name: 'b', source: 'option' });
  for (const env of [{}, { COUNCIL_ADVISE_CHAIN_SINGLE: '' }, { COUNCIL_ADVISE_CHAIN_SINGLE: '   ' }]) assert.deepEqual(adviceChainNamed({ env }), { named: false });
  assert.deepEqual(adviceChainNamed({ env: {}, option: '  ' }), { named: false });
});

test('AO-2: with the re-ask, case A (two calls fit) grants 2X; case C (one fits) grants what is free and says a re-ask may not fit; case D (not even one) is the cap\'s arithmetic, nothing asked', () => {
  const a = adviceOfferFacts(base({}));
  assert.deepEqual([a.offer, a.case, a.reask, a.xUsd, a.grantUsd, a.yUsd, a.zUsd], [true, 'A', 'yes', 0.4, 0.8, 9.2, 1]);
  assert.deepEqual(adviceOfferLines(a), [RECOMMENDATION_IS, setAside('$0.8000', '$10.00'), 'Ask for a recommendation? about $0.4000 (up to $0.8000 if the answer cannot be read and is asked for once more); free after it $9.20; the new main plan needs at least $1.00 [y/N]']);
  const c = adviceOfferFacts(base({ availableNowUsd: 0.6, freeUsd: 0.6 }));
  assert.deepEqual([c.offer, c.case, c.reask, c.grantUsd], [true, 'C', 'conditional', 0.6]);
  assert.deepEqual(adviceOfferLines(c), [RECOMMENDATION_IS, setAside('$0.6000', '$0.6000'), "Only $0.6000 is free under this tree's cap: if the answer cannot be read, there may not be enough left to ask once more.", "If you ask for it, the new plan may not fit under this tree's cap. You can then raise the cap (council tree decide <root> --amend-cap <total>) or start a new tree.", 'Ask for a recommendation? about $0.4000 (up to $0.6000 if the answer cannot be read and is asked for once more); free after it $0.0000; the new main plan needs at least $1.00 [y/N]']);
  const d = adviceOfferFacts(base({ availableNowUsd: 0.3, freeUsd: 0.3 }));
  assert.deepEqual([d.offer, d.why], [false, 'cap_short']);
  assert.deepEqual(adviceOfferLines(d), ["Only $0.3000 is free under this tree's cap, less than one request costs ($0.4000): a recommendation cannot be asked for."]);
});

test('AO-3: while the re-ask phrases are held there is ONE call: the grant is X, the line has no "up to" clause, and no figure is printed that the run cannot spend', () => {
  const a = adviceOfferFacts(base({ reaskAvailable: false }));
  assert.deepEqual([a.offer, a.case, a.reask, a.grantUsd, a.yUsd], [true, 'A', 'none', 0.4, 9.6]);
  const lines = adviceOfferLines(a);
  assert.equal(lines[1], setAside('$0.4000', '$10.00'), 'the grant and the available figure are on the screen in every offered case');
  assert.equal(lines.at(-1), 'Ask for a recommendation? about $0.4000; free after it $9.60; the new main plan needs at least $1.00 [y/N]');
  assert.ok(!lines.join('\n').includes('up to') && !lines.join('\n').includes('once more'));
  const short = adviceOfferFacts(base({ reaskAvailable: false, availableNowUsd: 0.39, freeUsd: 0.39 }));
  assert.deepEqual([short.offer, short.why], [false, 'cap_short']);
  assert.equal(adviceOfferFacts(base({ reaskAvailable: false, availableNowUsd: 0.4, freeUsd: 0.4 })).offer, true, 'exactly one call fits');
});

test('AO-4: no chain, an exhausted cap and a missing price each withhold the offer, in that order, with their own sentence; the exhausted cap names the amend command', () => {
  assert.deepEqual(adviceOfferFacts(base({ chain: { named: false }, cap: { exhausted: true } })), { offer: false, why: 'no_chain' });
  assert.deepEqual(adviceOfferLines({ offer: false, why: 'no_chain' }), ['No advisor chain is named, so no recommendation is offered.']);
  const ex = adviceOfferFacts(base({ cap: { exhausted: true }, ceilingUsd: null }));
  assert.deepEqual(ex, { offer: false, why: 'exhausted' });
  assert.deepEqual(adviceOfferLines(ex, { rootId: 'R1' }), ["This tree's cap is used up, so no recommendation is offered. You can stop, wait, or raise the cap: council tree decide R1 --amend-cap <total>."]);
  for (const ceilingUsd of [null, 0, -1, NaN, '0.4']) assert.deepEqual(adviceOfferFacts(base({ ceilingUsd })), { offer: false, why: 'no_ceiling' });
  assert.deepEqual(adviceOfferLines({ offer: false, why: 'no_ceiling' }), ['The price of a recommendation could not be worked out, so none is offered.']);
});

test('AO-5: the "may not fit" sentence appears exactly when free-after (Y) is below the new plan\'s cheapest end (Z); money held for other nodes is named and never drawn on', () => {
  const ok = adviceOfferFacts(base({ availableNowUsd: 5, freeUsd: 5, cheapestUsd: 4 }));        // grant 0.8, Y = 4.2 >= 4
  assert.ok(!adviceOfferLines(ok).join('\n').includes('may not fit'));
  const tight = adviceOfferFacts(base({ availableNowUsd: 5, freeUsd: 5, cheapestUsd: 4.5 }));   // Y = 4.2 < 4.5
  assert.ok(adviceOfferLines(tight).join('\n').includes('may not fit under this tree\'s cap'));
  const held = adviceOfferFacts(base({ availableNowUsd: 7, freeUsd: 10 }));
  assert.equal(held.heldElsewhereUsd, 3);
  assert.equal(held.grantUsd, 0.8, 'sized from what is available today, not from the free amount');
  assert.ok(adviceOfferLines(held).includes('$3.00 of the free money is held for nodes this decision will release; a recommendation cannot use it.'));
  assert.ok(!adviceOfferLines(ok).join('\n').includes('is held for nodes'));
  const hole = adviceOfferFacts(base({ availableNowUsd: -2, freeUsd: 1, ceilingUsd: 0.4 }));
  assert.deepEqual([hole.offer, hole.why, hole.availableNowUsd], [false, 'cap_short', 0], 'a negative available is zero, never a grant');
});

test('AO-6 (real budget): a stopped-free tree with a child holding a grant: the offer is sized from budgetOf\'s available, and the held money is the difference to the free amount', () => {
  const t = closedRootTree({ cap: 10 });
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 3); syntheticRun(t, IDS[0], {});
  const record = readTreeRecord(t.rootDir); const budget = budgetOf(t.rootDir, { record });
  const freeUsd = budget.rootCapUsd - budget.treeSpentUsd - budget.unknownSpendHeldUsd;
  assert.deepEqual([budget.availableUsd, freeUsd], [7, 10]);
  const facts = adviceOfferFacts({ chain: NAMED, cap: capFactsOf(record, budget), availableNowUsd: budget.availableUsd, freeUsd, cheapestUsd: 1, ceilingUsd: 0.5, reaskAvailable: true });
  assert.deepEqual([facts.offer, facts.case, facts.grantUsd, facts.heldElsewhereUsd, facts.yUsd], [true, 'A', 1, 3, 9]);
  const text = adviceGateText(facts, { rootId: 'R1' });
  assert.equal(text, adviceOfferLines(facts, { rootId: 'R1' }).join('\n'), 'the gate text IS the screen lines, one per line: what is hashed is what is tested');
  assert.ok(text.includes(setAside('$1.00', '$7.00')) && text.includes('$3.00 of the free money is held for nodes'), 'grant and available figure are in the text the gate would hash');
});

test('AO-7 (source scan, F3): this file never reaches for the default chain, a file, the clock, a model or the transition table', () => {
  const src = readFileSync(join(root, 'src', 'tree-advice.js'), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/send-profiles|chainNameFor|SEAT_CHAINS|DEFAULT_SEAT/.test(code), 'no default chain');
  assert.ok(!/from 'node:fs'|from 'node:child_process'|Date\.now|new Date|invoke\(|tree-transitions/.test(code), 'pure');
});

test('AO-8: the brief check: a key-shaped string, personal data under hard-stop, and an unusable mode each withhold the recommendation (never the value in the sentence); clean text and warn pass', () => {
  const KEY = ['sk-ant-', 'api03-', 'A'.repeat(40)].join('');
  const EMAIL = ['jane.doe', '@', 'mail-corp', '.de'].join('');
  const clean = adviceBriefRefusal({ tree: {}, briefText: 'The plan failed its split. Please recommend one instruction.' });
  assert.equal(clean, null);
  const keyed = adviceBriefRefusal({ tree: {}, briefText: `Stop text\nthe store key is ${KEY}\n` });
  assert.match(keyed.text, /^No recommendation is offered: the brief it would send holds 1 credential-shaped string\(s\):\n  the recommendation brief:2  Anthropic/);
  assert.ok(!keyed.text.includes(KEY) && keyed.text.endsWith('You can still type your own decision.'));
  const brief = `Ask ${EMAIL} about the store.`;
  const hard = adviceBriefRefusal({ tree: { piiGate: 'hard-stop' }, briefText: brief });
  assert.match(hard.text, /personal data under --pii-gate hard-stop:\n  the recommendation brief, line 1, col \d+: email/);
  assert.ok(!hard.text.includes(EMAIL) && !hard.text.includes('mail-corp'));
  assert.equal(adviceBriefRefusal({ tree: { piiGate: 'warn' }, briefText: brief }), null, 'warn never refuses');
  const bad = adviceBriefRefusal({ tree: { piiGate: 'bogus' }, briefText: 'x' });
  assert.match(bad.text, /personal-data mode in tree\.json is unusable/);
});
