// The Scope ledger out of the plan (ROADMAP 138, 0.8.4). $0, offline. The switch is `held('proposalsSectionLedgerOut')` (src/scope-ledger.js): these tests turn it on through the
// test seam (setHeldForTest) with a stand-in for the drafted wording, because the real words are not recorded in src/roles.js until the owner approves them.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runChain, setCache, setBudget, setPromptSpy, scoreProposals, parseDisputes, criteriaUserPrompt } from '../src/chain.js';
import { stripDeclined } from '../src/draft-disputes.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as R from '../src/roles.js';
import { ledgerOutOn, ledgerLineSource, parseLedgerLine, takeLedgerBlock, ledgerIdFindings, swapProposalsSection, scopeLedgerFile, LEDGER_PROSE_MAX } from '../src/scope-ledger.js';
import { checkScopeLedger, runLints } from '../src/lints.js';
import { requiredDeliverableSections } from '../src/preflight.js';
import { parseLedger } from '../src/ui/parse.js';
import * as HLED from './held-prompts/held-084-ledger-out.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = () => JSON.parse(readFileSync(join(root, 'chains', 'mock-proposals.json'), 'utf8'));
afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

// The DRAFTED wording (A-DRAFT, test/held-prompts/held-084-ledger-out.js): the test drives the switch with it through setHeldForTest.
const OLD_SENTENCE = 'The plan must end with a section titled "Scope ledger"';
const on = (extra = {}) => setHeldForTest({ proposalsSectionLedgerOut: HLED.proposalsSectionLedgerOut, priorLedgerSection: HLED.priorLedgerSection, ...extra });

// Shapes of the real ledgers (pilot run folders, 183 build/revise files); ids and text invented.
const SHAPES = [
  'LABID-1 - accepted - section 2',
  '- LABID-1 - accepted - merged into "Changes" item 1',
  '* **LABID-1** - **withdrawn** - by its author',
  '`LABID-1` - cut - out of scope',
  'LABID-1: accepted: section 2',
  'LABID-1 – accepted – section 2',
  'LABID-1 — cut — no',
  'LABID-1 - accepted',
];

test('the strip and the scorer share ONE line pattern: every real shape is read by both', () => {
  for (const line of SHAPES) {
    const e = parseLedgerLine(line);
    assert.ok(e && e.id === 'LABID-1', `strip: ${line}`);
    const row = scoreProposals([{ id: 'LABID-1', lab: 'a' }], `plan\n\n## Scope ledger\n${line}\n`).rows[0];
    assert.equal(row.status, e.status, `scorer: ${line}`);
  }
  assert.equal(parseLedgerLine('Some prose - and more'), null);
  assert.equal(new RegExp(ledgerLineSource('LABID-1'), 'im').exec('x\n- LABID-1 - cut - r')[2], 'cut');
});

const PLAN = '# Plan\n\nBody text.\n\n## 1. Part\nWork.';
const LEDGER = '## Scope ledger\nLABID-1 - accepted - 1\nLABID-2 - cut - no';

test('takeLedgerBlock: the trailing block is taken whole, an introductory sentence goes with it, the plan is never cut', () => {
  const t = takeLedgerBlock(`${PLAN}\n\n${LEDGER}\n`.split('\n'));
  assert.equal(t.taken, true);
  assert.equal(t.rest.join('\n').trimEnd(), PLAN);
  assert.deepEqual(t.block, LEDGER.split('\n'));
  const intro = takeLedgerBlock(`${PLAN}\n\n## 9. Scope ledger\nThe ids below are the candidate proposals.\nLABID-1 - accepted - 1`.split('\n'));
  assert.equal(intro.taken, true);
  assert.equal(intro.block.length, 3);
  // not taken, each with its reason (a named finding, never silence)
  assert.match(takeLedgerBlock(`${PLAN}\n\n## Scope ledger\n\n## Appendix\ntext`.split('\n')).notTaken, /another heading/);
  assert.match(takeLedgerBlock(`${PLAN}\n\n## Scope ledger\nsee the plan`.split('\n')).notTaken, /no line under it/);
  const prose = Array.from({ length: LEDGER_PROSE_MAX + 1 }, (_, i) => `sentence ${i}`);
  assert.match(takeLedgerBlock([...PLAN.split('\n'), '## Scope ledger', 'LABID-1 - accepted - 1', ...prose]).notTaken, /not ledger lines/);
  assert.deepEqual(takeLedgerBlock(PLAN.split('\n')), { taken: false });
  // a plan section that merely talks about the ledger is not the heading
  assert.deepEqual(takeLedgerBlock(['The Scope ledger is explained below.', 'text']), { taken: false });
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: five rows here (parseDisputes, stripDeclined, swapProposalsSection, the criteria prompt and 'runChain, switch off') also ran the ledger-out words UNRECORDED ('the switch off') and read today's behaviour. NEW: those held halves are REMOVED (K7): proposalsSectionLedgerOut and priorLedgerSection are recorded, so ledgerOutOn() (src/scope-ledger.js:13) is true in every shipped run (a one-way door). Sibling at each: the 'on' half of the same test, and 'runChain, switch on' for the removed whole row. WHY: the ledger-out words recorded (src/prompts/recorded-084-ledger-out.js).
test('parseDisputes: the block leaves the draft beside the trailers', () => {
  const reply = `${PLAN}\n\n${LEDGER}\nNOTE-TAKEN: N-aaaaaaaa\nDECLINED: O-bbbbbbbb: not a defect`;
  on();
  const got = parseDisputes(reply);
  assert.equal(got.draft, PLAN);
  assert.deepEqual(got.ledger.block, LEDGER.split('\n'));
  assert.equal(got.disputes.length, 1);
  assert.equal(got.noteLines.length, 1);
  // trailers ABOVE the block are found by the second pass, and the order of the record is kept
  const above = parseDisputes(`${PLAN}\nDECLINED: O-cccccccc: first\n\n${LEDGER}\nDECLINED: O-dddddddd: second`);
  assert.equal(above.draft, PLAN);
  assert.deepEqual(above.disputes, ['O-cccccccc: first', 'O-dddddddd: second']);
  // a ledger heading left in the plan is reported, not hidden
  assert.match(parseDisputes(`${PLAN}\n\n## Scope ledger\n\n## Appendix\nx`).ledger.notTaken, /another heading/);
  assert.equal(parseDisputes(PLAN).ledger, null);
  // a reviser's Disputed block, above or below the ledger, and a "Scope additions" section kept in the plan (the drafted wording puts the ledger after it)
  const WITH_ADDITIONS = `${PLAN}\n\n## Scope additions\n- a rate limit - the request needs one - added by reviser round 1`;
  for (const [where, text] of [['below', `${WITH_ADDITIONS}\n\n${LEDGER}\n\n## Disputed\nO-eeeeeeee: not a defect`], ['above', `${WITH_ADDITIONS}\n\n## Disputed\nO-eeeeeeee: not a defect\n\n${LEDGER}`]]) {
    const r = parseDisputes(text);
    assert.equal(r.draft, WITH_ADDITIONS, `Disputed block ${where} the ledger: the plan and its additions are left whole`);
    assert.deepEqual(r.disputes, ['O-eeeeeeee: not a defect'], `Disputed block ${where} the ledger is read`);
    assert.ok(r.ledger.block, `the ledger is taken with a Disputed block ${where} it`);
  }
});

test('stripDeclined (every reader of a builder\'s raw text) takes the block off', () => {
  on();
  assert.equal(stripDeclined(`${PLAN}\n\n${LEDGER}`), PLAN);
});

test('swapProposalsSection: slices (no $-expansion), skips an empty section, refuses a prompt without it', () => {
  const proposals = [{ id: 'A-1', lab: 'a', title: 't', serves: 's', what: 'w', why: 'y', how: 'h', acceptance_test: 'x' }];
  const board = 'board with $& and $\' and $$ and $` in model text';
  const prompt = R.builderUser({ request: 'r', criteria: ['c'], proposals, board });
  on();
  const swapped = swapProposalsSection(prompt, proposals, board);
  assert.notEqual(swapped, prompt);
  assert.ok(swapped.includes('The ledger is kept in its own file'));
  assert.ok(swapped.includes(board), 'the board text stays literal');
  assert.equal(swapped.includes(OLD_SENTENCE), false);
  const noSection = R.reviserUser({ request: 'r', criteria: ['c'], draft: 'D', critique: { failures: [] } });
  assert.equal(swapProposalsSection(noSection, undefined, null), noSection, 'an empty section prepends nothing');
  assert.equal(swapProposalsSection(noSection, [], null), noSection);
  assert.throws(() => swapProposalsSection('a prompt with no section', proposals, board), /does not carry the proposals section/);
});

test('ledgerIdFindings: one finding per missing, repeated and unknown id; ids compare without case; the lint returns the same objects', () => {
  const proposals = [{ id: 'A-1' }, { id: 'A-2' }, { id: 'A-3' }];
  const lines = ['a-1 - accepted - x', 'A-2 - cut - y', 'A-2 - cut - again', 'Z-9 - cut - ?'];
  const f = ledgerIdFindings(lines, proposals);
  assert.deepEqual(f.map(x => x.message), ['proposal "A-2" has more than one line in the scope ledger', 'proposal "A-3" has no line in the scope ledger', 'the scope ledger has a line for "Z-9", which is not a proposal of this run']);
  assert.ok(f.every(x => x.id === 'ledger_id'));
  assert.deepEqual(checkScopeLedger('', proposals, lines.join('\n')), f);
  assert.deepEqual(runLints({ proposals, scopeLedger: lines.join('\n') }).filter(x => x.id === 'ledger_id'), f);
  assert.deepEqual(ledgerIdFindings(['A-1 - cut - r', 'A-2 - cut - r', 'A-3 - accepted - r'], proposals), []);
});

test('the criteria prompt stops announcing the ledger and the preflight section list drops it', () => {
  const c = cfg();
  on();
  assert.deepEqual(requiredDeliverableSections(c), []);
  assert.equal(criteriaUserPrompt('Do it.', c), '# Request\n\nDo it.');
  assert.equal(ledgerOutOn(), true);
});

// ---- runChain with the mock proposals chain ------------------------------------------------------------------------------------------------------------------------------------
const stage = text => ({ text, usage: { input: 1, output: 1 }, usd: 0 });
const cacheOf = map => ({ get: l => (Object.hasOwn(map, l) ? stage(map[l]) : null) });
const run = async (log = () => {}) => runChain({ request: 'Plan a photo renamer.', config: cfg(), log });

test('runChain, switch on: the plan the judges grade has no ledger, scope-ledger text names the writer, the scoreboard reads the ledger, lints stay clean', async () => {
  on();
  const prompts = [];
  setPromptSpy(p => prompts.push({ label: p.label, user: p.user }));
  setBudget(null);
  const r = await run();
  assert.doesNotMatch(r.deliverable, /Scope ledger/);
  assert.match(r.scopeLedger, /^Written by stage: revise-1 \(earlier writers: build\)\n\n## Scope ledger\nMOCKPA-1 - accepted/);
  assert.deepEqual(r.scoreboard.labs.map(l => [l.lab, l.proposed, l.accepted, l.unaccounted]), [['mock-pa', 1, 1, 0]]);
  assert.equal(r.lints, undefined, 'clean: the field stays absent');
  // the swapped wording reached the writers; the criteria prompt has no announcement
  assert.ok(prompts.find(p => p.label === 'build').user.includes('The ledger is kept in its own file'));
  assert.doesNotMatch(prompts.find(p => p.label === 'criteria').user, /Sections this chain always adds/);
});

// REMOVED (K7): 'runChain, switch off: the run is what it was (ledger in the plan, no scope-ledger text, no new lints)'. A held-state row. Sibling: 'runChain, switch on' above (the recorded run: no ledger in the plan, scope-ledger text names the writer, lints clean).

const BUILD = (ledger) => `# Plan\n\nBody.\n\n## Assumptions\n- x\n${ledger}`;

test('runChain: a writer asked for a ledger that wrote none, a block left in the plan, and a dropped id are findings that name the stage (last writer replaces, never merges)', async () => {
  on();
  // build writes a ledger for MOCKPA-1; the reviser returns a ledger that names another id (drops MOCKPA-1) and has a stray one
  setCache(cacheOf({
    build: BUILD('\n## Scope ledger\nMOCKPA-1 - accepted - section 1\n'),
    'revise-1': BUILD('\n## Scope ledger\nOTHER-7 - cut - not ours\n'),
  }));
  const r = await run();
  const msgs = r.lints.map(l => l.message);
  assert.ok(msgs.includes('stage "revise-1" returned a scope ledger with no line for proposal "MOCKPA-1"'), msgs.join('\n'));
  assert.ok(msgs.includes('the scope ledger has a line for "OTHER-7", which is not a proposal of this run'));
  assert.equal(msgs.includes('proposal "MOCKPA-1" has no line in the scope ledger'), false, 'one id, one entry: the stage finding says it');
  assert.match(r.scopeLedger, /^Written by stage: revise-1 \(earlier writers: build\)\n/);
  assert.equal(r.scoreboard.labs[0].unaccounted, 1);
  assert.equal(new Set(msgs).size, msgs.length);
  // a reviser that returns no ledger leaves the prior one in place and is named
  setCache(cacheOf({ build: BUILD('\n## Scope ledger\nMOCKPA-1 - accepted - section 1\n'), 'revise-1': BUILD('') }));
  const r2 = await run();
  assert.deepEqual(r2.lints.map(l => l.message), ['stage "revise-1" was asked for a scope ledger and wrote none; the ledger stays the one written by "build"']);
  assert.match(r2.scopeLedger, /^Written by stage: build\n/);
  assert.equal(r2.scoreboard.labs[0].accepted, 1);
  // no writer wrote one: the scoreboard says unaccounted (the plan is NOT read as a fallback), and both stages are named
  setCache(cacheOf({ build: BUILD(''), 'revise-1': BUILD('') }));
  const r3 = await run();
  assert.equal(r3.scoreboard.labs[0].unaccounted, 1);
  assert.ok(r3.lints.some(l => /stage "build" was asked for a scope ledger and wrote none; there is no scope ledger/.test(l.message)));
  assert.equal(r3.scopeLedger, undefined);
  // a heading that holds no ledger line stays in the plan: a named finding, and the scorer does not read the plan's lines
  // (the stage DID write a heading, so no 'wrote none' finding is added beside it)
  setCache(cacheOf({ build: BUILD('\n## Scope ledger\nsee the proposals\n'), 'revise-1': BUILD('\n## Scope ledger\nsee the proposals\n') }));
  const r4 = await run();
  assert.ok(r4.lints.some(l => /stage "build" ended with a "Scope ledger" heading that was left in the plan: no line under it is a ledger line/.test(l.message)));
  assert.equal(r4.lints.some(l => /stage "build" was asked for a scope ledger and wrote none/.test(l.message)), false);
});

test('runChain: the flag-gated lint and the default check never report one id twice', async () => {
  on();
  const c = cfg(); c.lints = { enabled: true };
  setCache(cacheOf({ build: BUILD('\n## Scope ledger\nOTHER-7 - cut - not ours\n'), 'revise-1': BUILD('') }));
  const r = await runChain({ request: 'Plan a photo renamer.', config: c, log: () => {} });
  const keys = r.lints.map(l => `${l.id}|${l.message}`);
  assert.equal(new Set(keys).size, keys.length, keys.join('\n'));
  assert.ok(r.lints.some(l => l.message === 'proposal "MOCKPA-1" has no line in the scope ledger'));
});

// The tiered mock chain has proposals, a deep dive, a panel and (added here) a finalist, so every prompt family the ruling names is present.
const tieredCfg = () => { const c = JSON.parse(readFileSync(join(root, 'chains', 'mock-tiered.json'), 'utf8')); c.seats.finalist = { provider: 'mock', model: 'mock-finalist', lab: 'fin' }; return c; };
const WRITERS = /^(build|revise-\d+(-full)?|deep-dive-revise)$/;
const LEAK = /MASSA-1 - accepted|# Prior scope ledger/;

async function tieredPrompts() {
  const seen = [];
  setPromptSpy(p => seen.push({ label: p.label, user: p.user }));
  setBudget(null); setCache(null);
  const r = await runChain({ request: 'Plan a photo renamer.', config: tieredCfg(), log: () => {} });
  return { seen, r };
}

test('the reviser is shown the prior ledger as data, outside the draft; no judge, panel, deep-dive-critique, finalist or handoff prompt carries it', async () => {
  on();
  const { seen, r } = await tieredPrompts();
  assert.match(r.scopeLedger, /^Written by stage: deep-dive-revise \(earlier writers: build\)\n/);
  const reviser = seen.find(p => p.label === 'deep-dive-revise');
  assert.match(reviser.user, /# Prior scope ledger \(data, written by the stage "build"\)[\s\S]*<prior-ledger>\n## Scope ledger\nMASSA-1 - accepted/);
  assert.ok(reviser.user.indexOf('# Prior scope ledger') > reviser.user.indexOf('# Current draft'), 'after the draft section, not inside it');
  assert.doesNotMatch(reviser.user.slice(reviser.user.indexOf('# Current draft'), reviser.user.indexOf('# Failures')), /Scope ledger|MASSA-1 - accepted/);
  assert.doesNotMatch(seen.find(p => p.label === 'build').user, /# Prior scope ledger/, 'absent for the first writer');
  // every family the ruling names ran, and none of them carries the ledger
  const others = seen.filter(p => !WRITERS.test(p.label));
  for (const [family, re] of [['panel', /^panel-/], ['deep-dive critique', /^deep-dive-deep-a/], ['finalist', /^final$/], ['handoff', /^handoff$/]]) {
    const ps = others.filter(p => re.test(p.label));
    assert.ok(ps.length > 0, `${family} prompts ran`);
    for (const p of ps) assert.doesNotMatch(p.user, LEAK, `${p.label} must not carry the ledger`);
  }
  for (const p of others) assert.doesNotMatch(p.user, LEAK, `${p.label} must not carry the ledger`);
});

test('scopeLedgerFile: provenance first, then the block as written', () => {
  assert.equal(scopeLedgerFile({ by: 'build', lines: ['## Scope ledger', 'A-1 - cut - r'] }), 'Written by stage: build\n\n## Scope ledger\nA-1 - cut - r\n');
  assert.match(scopeLedgerFile({ by: 'revise-2', earlier: ['build', 'revise-1'], lines: ['x'] }), /^Written by stage: revise-2 \(earlier writers: build, revise-1\)\n/);
});

test('the run viewer and plan_outline read the ledger from scope-ledger.md first and the plan\'s own section second, with the same line pattern', () => {
  const file = scopeLedgerFile({ by: 'build', lines: ['## Scope ledger', '- LABID-1 - accepted - s1', '**LABID-2** - cut - no'] });
  assert.deepEqual(parseLedger('# Plan only\n', file).map(r => [r.id, r.status]), [['LABID-1', 'accepted'], ['LABID-2', 'cut']]);
  assert.deepEqual(parseLedger('# Plan\n\n## Scope ledger\nLABID-3 - withdrawn - by its author\n').map(r => [r.id, r.status]), [['LABID-3', 'withdrawn']]);
  assert.deepEqual(parseLedger('# Plan\n', 'Written by stage: build\n\n'), []);
});
