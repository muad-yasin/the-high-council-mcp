// 0.8.4 D27: the draft boundary around the plan in every judge call and the final read. The gate is the chain's switch `draft_end_marker { enabled }` AND both held words recorded (src/draft-bounds.js);
// the notes lane is no part of it. Four things are proved here: (1) the gate, in its four combinations; (2) the bounded draft goes INTO the same prompt builder as its `draft` argument, so criticUserHead
// is still the head and criticUser === head + tail with the lines on and off (Review/084/cnc/Boundary_DraftEnd.md); (3) with the gate off every string is byte-identical; (4) the real call sites (the unanimous
// panel, the first-mode critic, the final read) send the lines once, in order, and ONLY when the gate is on. The drafted words are injected through setHeldForTest, the way the held door tests do. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as R from '../src/roles.js';
import { draftBoundaryOn, draftBoundaryWordsOn, boundedDraft, DRAFT_BOUNDARY_WORDS } from '../src/draft-bounds.js';
import { draftStartLine, draftBoundarySentence } from './held-prompts/held-084-d27.js';
import { readChainFile } from './helpers/chain-file.js';
import { neverHeardChain } from './helpers/final-read-chain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setPromptSpy(null); setCache(null); setBudget(null); setHeldForTest(null); });
const WORDS = { draftStartLine, draftBoundarySentence };
const HELD = { draftStartLine: undefined, draftBoundarySentence: undefined };   // hides the names whether or not src/roles.js records them, so these tests survive the release apply
const S = draftBoundarySentence(); const L = draftStartLine(); const END = R.DRAFT_END_MARKER;
const times = (s, sub) => String(s).split(sub).length - 1;

const request = 'Plan a tea service.';
const criteria = ['It states its assumptions.', 'It lists the steps.'];
const draft = '# Plan\n\n1. Boil.\n2. Steep.\n\nAssumptions: black tea.';
const checks = '\n\n# How the checkable criteria are settled\n\nCriterion 2 is settled by counting.';
const prior = [{ lab: 'la', verdict_line: 'One criterion failed.', failures: [{ criterion: 'It lists the steps.', problem: 'No pour step.' }] }];
const answeredQuestion = { question: 'Which tea?', answer: 'Black.' };
const variants = {
  plain: { request, criteria, draft },
  checks: { request, criteria, draft, checks },
  prior: { request, criteria, draft, prior },
  answered: { request, criteria, draft, answeredQuestion },
  all: { request, criteria, draft, checks, prior, answeredQuestion },
};

test('the gate: the switch AND both words recorded; the switch off, in every setting a person can make, adds nothing', () => {
  const on = { draft_end_marker: { enabled: true } };
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the gate row first proved that with both words hidden, or only one of them recorded, the gate stayed off. NEW: those three assertions are removed; the recorded cases below (words on, switch on and the five switch-off settings a person can still make) stay, and the call-site rows 'switch on, words recorded' and the switch-off combinations pin the same gate at the real call sites. WHY: draftStartLine and draftBoundarySentence are both recorded (src/prompts/recorded-084-d27.js, rows NS-0267 and D27-w2), so no shipped run has a half-recorded boundary.
  setHeldForTest(WORDS);
  assert.equal(draftBoundaryWordsOn(), true);
  assert.equal(draftBoundaryOn(on), true, 'switch on, both recorded: the notes lane is no part of the gate');
  for (const off of [{}, { draft_end_marker: {} }, { draft_end_marker: { enabled: false } }, { draft_end_marker: { enabled: 'true' } }, null, undefined]) assert.equal(draftBoundaryOn(off), false, `switch ${JSON.stringify(off)}, both recorded`);
  assert.deepEqual(DRAFT_BOUNDARY_WORDS, ['draftStartLine', 'draftBoundarySentence']);
});

test('boundedDraft: gate off returns the very same string; gate on puts the sentence and the start line in front', () => {
  for (const d of [draft, '', 'one line', '   leading space\n\n\n']) assert.equal(boundedDraft(d, false), d);
  setHeldForTest(WORDS);
  assert.equal(boundedDraft(draft, true), `${S}\n\n${L}\n\n${draft}`);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: two assertions proved that gate on with a word missing (only the start line, or both hidden) throws 'not both recorded'. NEW: removed; the call-site rows pin the recorded boundary. WHY: both words are recorded (recorded-084-d27.js, D27).
  assert.equal(boundedDraft(draft, false), draft, 'off is off whatever is recorded');
});

test('the head contract with the lines ON: the bounded draft goes in as the builder\'s own `draft` argument, criticUserHead is the head, criticUser is head + tail, and the tail is the same as without the lines', () => {
  setHeldForTest(WORDS);
  for (const [name, args] of Object.entries(variants)) {
    const bounded = { ...args, draft: boundedDraft(args.draft, true), endMarker: true };
    const head = R.criticUserHead(bounded); const full = R.criticUser(bounded);
    assert.ok(full.startsWith(head), `${name}: criticUser starts with its head`);
    assert.ok(head.endsWith(`# Draft under review\n\n${S}\n\n${L}\n\n${args.draft}\n\n${END}`), `${name}: the head ends sentence, start line, draft, end line`);
    for (const piece of [S, L, END]) assert.equal(times(full, piece), 1, `${name}: each of the three pieces appears once`);
    const plain = { ...args, endMarker: true };
    assert.equal(full.slice(head.length), R.criticUser(plain).slice(R.criticUserHead(plain).length), `${name}: the tail is the tail of the unbounded prompt`);
  }
});

test('byte-identical with the lines OFF, for every variant, with the end line off and on', () => {
  for (const [name, args] of Object.entries(variants)) for (const endMarker of [false, true]) {
    assert.equal(R.criticUser({ ...args, draft: boundedDraft(args.draft, false), endMarker }), R.criticUser({ ...args, endMarker }), `${name} endMarker ${endMarker}`);
    assert.equal(R.criticUserHead({ ...args, draft: boundedDraft(args.draft, false), endMarker }), R.criticUserHead({ ...args, endMarker }), `${name} head endMarker ${endMarker}`);
  }
});

// ---- through the real call sites ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const SIGNED = 'REVISED MOCK DELIVERABLE\n\nBody.\n\nAssumptions: none.';   // the mock critics sign off on a draft that carries this line: one pass on exactly this draft
const COMBOS = [
  ['switch on, words recorded', { draft_end_marker: { enabled: true } }, WORDS, true],
  ['switch on, words held', { draft_end_marker: { enabled: true } }, HELD, false],
  ['switch off, words recorded', { draft_end_marker: { enabled: false } }, WORDS, false],
  ['switch absent, words recorded', { draft_end_marker: undefined }, WORDS, false],
];
const layout = d => `# Draft under review\n\n${S}\n\n${L}\n\n${d}\n\n${END}`;
async function prompts(config, labelRe, draftArg) {
  const seen = [];
  setPromptSpy(({ label, user }) => { if (labelRe.test(label)) seen.push({ label, user }); });
  await runChain({ request, config, ...(draftArg ? { draft: draftArg } : {}), log: () => {}, runId: 'r-d27-gate' });
  return seen;
}
const checkCombos = async (make, labelRe, draftArg, endWithDraft) => {
  for (const [name, config, words, expectLines] of COMBOS) {
    setHeldForTest(words);
    const cfg = make(config); if (cfg.draft_end_marker === undefined) delete cfg.draft_end_marker;   // the absent arm has no key at all, not a key holding undefined
    assert.equal(Object.hasOwn(cfg, 'draft_end_marker'), config.draft_end_marker !== undefined, name);
    const seen = await prompts(cfg, labelRe, draftArg);
    assert.ok(seen.length > 0, `${name}: the calls ran (else this passes vacuously)`);
    for (const s of seen) {
      if (expectLines) {
        assert.equal(times(s.user, S), 1, `${name}: ${s.label} sentence once`); assert.equal(times(s.user, L), 1, `${name}: ${s.label} start line once`); assert.equal(times(s.user, END), 1, `${name}: ${s.label} end line once`);
        if (endWithDraft) assert.ok(s.user.includes(layout(draftArg)), `${name}: ${s.label} carries the exact layout around the draft`);
        else assert.ok(s.user.indexOf(`# Draft under review\n\n${S}\n\n${L}\n\n`) !== -1 && s.user.indexOf(L) < s.user.indexOf(END), `${name}: ${s.label} sentence, start line, then the end line`);
      } else for (const piece of [S, L, END]) assert.equal(s.user.includes(piece), false, `${name}: ${s.label} carries none of the three pieces (no half boundary)`);
    }
    setHeldForTest(null);
  }
};

test('the unanimous panel (first ask): the lines appear once, around exactly the signed draft, with NO notes lane; in the three other combinations nothing is added, not even the end line', async () => {
  const make = extra => ({ ...readChainFile(root, 'mock-unanimous'), ...extra });
  assert.equal(make({}).reviewNotes, undefined, 'the chain has no notes lane');
  await checkCombos(make, /^panel-/, SIGNED, true);
});

test('the first-mode critic (chains/mock.json): the same lines, from the same builder', async () => {
  const make = extra => ({ ...readChainFile(root, 'mock'), criteria: ['It names who decides.'], ...extra });
  assert.equal(make({}).signoff, undefined, 'a first-mode chain');
  await checkCombos(make, /^critique-\d+$/, SIGNED, true);
});

test('the final read: the lines are in every final-read prompt, once, and the end line comes after the start line', async () => {
  const make = extra => neverHeardChain('d27gate', { final_read: { enabled: true }, ...extra });
  await checkCombos(make, /^final-read-/, null, false);
});

test('source scan: every R.criticUser( call in chain.js builds its draft with boundedDraft( and the stage envelope keeps the raw draft', () => {
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  // CHANGED ACCEPTED (0.8.4 D38 option I, 09 Nov 2026): seven of the eight call sites now build their arguments ONCE as `const cu = { ... }` (the same object feeds R.criticUser(cu) and the head the excerpt block follows,
  // R.criticUserHead(cu)); only the final read's size estimate still names its arguments inline. The scan reads both forms and wraps each argument object as the call it stands for, so every later row reads as before.
  const calls = [...src.matchAll(/(?:const cu = |R\.criticUser\()(\{[^}]*\})/g)].map(m => `R.criticUser(${m[1]})`);
  assert.equal(calls.length, 8, 'the eight call sites: runFinalRead 3, the unanimous loop 2, the first-mode loop 3');
  for (const c of calls) assert.match(c, /draft: boundedDraft\(/, c);
  assert.doesNotMatch(src, /withEnvelope\([^,()]+,\s*boundedDraft\(/, 'the envelope is given the raw draft, never the bounded one');
});
