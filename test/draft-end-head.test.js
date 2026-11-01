// B3 prep, JUDGE lane, unit H: the head of a judge's user prompt (everything up to the end of the draft) is returned by the code that builds the prompt (roles.js `criticUserHead`, `layerDebateUserHead`, `layerReplyUserHead`), so the
// prompt cache (CACHE lane) takes its breakpoint from an INDEX, never from a text search. The end marker (`draft_end_marker`, A-DRAFT placeholder) is behind its own chain switch AND the notes lane; with the switch off every
// string is byte-identical to today's. The contract in words: Review/084/cnc/Boundary_DraftEnd.md (maintainer-local).
// (Pass 1 shows the judge the draft itself: chain.js builds `shown` as the draft plus the changes since the last patch, and there is none in pass 1.)
// The functions are read off the module namespace on purpose: a missing export fails each test by name, not the whole file at import.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../src/roles.js';
import { lintChain } from '../src/chain-lint.js';
import { createHash } from 'node:crypto';
import { runChain, setPromptSpy, setCache } from '../src/chain.js';
import { reviewNotesActive } from '../src/review-notes-lane.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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

// PINS, green before and after: sha256 (first 16 hex) of today's strings, computed on 07f959b4 with a scratch script before roles.js was touched. These, not prompt-pin (red on the base), are the switch-off proof for the three builders.
const sha = t => createHash('sha256').update(t).digest('hex').slice(0, 16);
const objections = [{ id: 'O-aaaaaaaa', criterion: criteria[0], problem: 'None stated.', quote: 'Steep.' }, { id: 'O-bbbbbbbb', criterion: criteria[1], problem: 'No pour step.', earlier: { posts: [{ round: 1, mine: false, stance: 'contest', text: 'It lists them.', quote: '1. Boil.' }], replies: [{ round: 1, action: 'keep', text: 'No pour.' }] } }];
const replyItems = [{ id: 'O-aaaaaaaa', criterion: criteria[0], problem: 'None stated.', quote: 'Steep.', posts: [{ stance: 'support', text: 'Agreed.' }], earlier: { posts: [], replies: [] } }];
test('PIN: every user-prompt builder this unit touches still returns today\'s bytes when called as today (digests taken on the base)', () => {
  const want = { plain: 'f40dc9d76cd242bd', checks: '53131837871a7593', prior: 'e2d61348758a6459', answered: 'cec78c41e2c79e49', all: '2a99de2c77afee50' };
  for (const [name, args] of Object.entries(variants)) assert.equal(sha(R.criticUser(args)), want[name], `criticUser ${name}`);
  assert.equal(sha(R.layerDebateUser({ request, criteria, draft, objections })), '701eead921c6c2cc');
  assert.equal(sha(R.layerReplyUser({ request, criteria, draft, items: replyItems })), 'b7a2acb1d68ffbc3');
  const laterItems = [{ id: 'O-aaaaaaaa', criterion: criteria[0], problem: 'None stated.', quote: 'Steep.', posts: [{ stance: 'contest', text: 'It says black tea.', quote: 'Assumptions: black tea.' }], earlier: { posts: [{ round: 1, mine: false, stance: 'support', text: 'Agreed.' }], replies: [{ round: 1, action: 'keep', text: 'Still missing.' }] } }];
  assert.equal(sha(R.layerReplyUser({ request, criteria, draft, items: laterItems })), '9f72c2b0190beac7', 'a later round of the reply prompt (real earlier posts and replies)');
});

test('criticUserHead: the string criticUser starts with, ending at the last character of the draft; criticUser is head + tail and byte-identical to its old shape when the marker is off', () => {
  assert.equal(typeof R.criticUserHead, 'function', 'roles.js exports criticUserHead');
  for (const [name, args] of Object.entries(variants)) {
    const head = R.criticUserHead(args);
    const full = R.criticUser(args);
    assert.ok(head.endsWith(draft), `${name}: the head ends at the draft's last character`);
    assert.ok(full.startsWith(head), `${name}: criticUser starts with its head`);
    const tail = full.slice(head.length);
    // The tail is exactly what differs per call: nothing, or the blocking-question block, the prior-review notes and the verdict line, each opening with a blank line.
    assert.ok(tail === '' || tail.startsWith('\n\n# '), `${name}: the tail opens with a section (${JSON.stringify(tail.slice(0, 30))})`);
  }
  // The old shape, written out: the plain variant is exactly this string.
  assert.equal(R.criticUser(variants.plain), `# Original request\n\n${request}\n\n# Acceptance criteria\n\n1. ${criteria[0]}\n2. ${criteria[1]}\n\n# Draft under review\n\n${draft}`);
});

test('the end marker: with endMarker the head ends at the marker line, the marker sits directly after the draft and before every tail section, and a draft that QUOTES the marker cannot move the boundary', () => {
  assert.equal(typeof R.DRAFT_END_MARKER, 'string');
  assert.ok(R.DRAFT_END_MARKER.length > 0);
  for (const [name, args] of Object.entries(variants)) {
    const head = R.criticUserHead({ ...args, endMarker: true });
    assert.equal(head, `${R.criticUserHead(args)}\n\n${R.DRAFT_END_MARKER}`, `${name}: marker head = plain head + blank line + marker`);
    const full = R.criticUser({ ...args, endMarker: true });
    assert.ok(full.startsWith(head), `${name}: criticUser starts with the marker head`);
    assert.equal(full.slice(head.length), R.criticUser(args).slice(R.criticUserHead(args).length), `${name}: the tail is the same with and without the marker`);
  }
  const quoting = { ...variants.plain, draft: `${draft}\n\n${R.DRAFT_END_MARKER}\n\nMore plan text after a quoted marker.` };
  const head = R.criticUserHead({ ...quoting, endMarker: true });
  assert.ok(head.indexOf(R.DRAFT_END_MARKER) < head.lastIndexOf(R.DRAFT_END_MARKER), 'the quoted marker is inside the draft; the real one is the last in the head');
  assert.ok(R.criticUser({ ...quoting, endMarker: true }).startsWith(head));
  assert.ok(head.endsWith(R.DRAFT_END_MARKER), 'the head ends exactly at the real marker, by construction and not by search');
});

test('the layer prompts: head = everything through the draft; the next text is their own header, so they take no marker', () => {
  const objections = [{ id: 'O-aaaaaaaa', criterion: criteria[0], problem: 'None stated.' }];
  assert.equal(typeof R.layerDebateUserHead, 'function'); assert.equal(typeof R.layerReplyUserHead, 'function');
  const dHead = R.layerDebateUserHead({ request, criteria, draft });
  assert.ok(dHead.endsWith(draft));
  assert.ok(R.layerDebateUser({ request, criteria, draft, objections }).startsWith(`${dHead}\n\n# Objections raised by the other reviewers`));
  const rHead = R.layerReplyUserHead({ request, criteria, draft });
  assert.ok(rHead.endsWith(draft));
  assert.ok(R.layerReplyUser({ request, criteria, draft, items: [{ id: 'O-aaaaaaaa', criterion: criteria[0], problem: 'None stated.', posts: [] }] }).startsWith(`${rHead}\n\n# Your objections`));
});

test('the head does not change when the caller appends text after the builder\'s string (rulings, notes ask, re-ask note, reply-identity)', () => {
  const head = R.criticUserHead(variants.all);
  for (const extra of ['\n\n# Rulings by the person who owns this request\n\nRuling 1.', '\n\nAsk for notes.', '\n\n# Reply identity\n\nreview_id: abc']) {
    assert.ok((R.criticUser(variants.all) + extra).startsWith(head));
  }
});

test('PIN: criticUser\'s own span names no "role" and no applySeatRole (the same words test/stage-isolation.test.js scans for); the heads sit outside it', () => {
  const src = readFileSync(join(root, 'src', 'roles.js'), 'utf8');
  const start = src.indexOf('export function criticUser(');
  const span = src.slice(start, src.indexOf('\nexport ', start + 10));
  assert.doesNotMatch(span, /\brole\b/i); assert.doesNotMatch(span, /\bapplySeatRole\b/);
  assert.doesNotMatch(src.slice(src.indexOf('export function criticUserHead('), start), /\brole\b/i);
});

test('the switch: draft_end_marker { enabled } needs the notes lane, a typo is caught, and an absent or false switch changes nothing', () => {
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));
  const kinds = c => lintChain(c, 'chains/fixture.json').map(f => f.kind);
  assert.deepEqual(kinds({ ...base, reviewNotes: { enabled: true, perKind: 3 }, draft_end_marker: { enabled: true } }).filter(k => /marker|notes/.test(k)), []);
  assert.ok(kinds({ ...base, draft_end_marker: { enabled: true } }).includes('draft-end-marker-needs-notes'), 'without the notes lane the marker would be silently inert');
  assert.deepEqual(kinds({ ...base, draft_end_marker: { enabled: false } }).filter(k => /marker/.test(k)), []);
  assert.ok(kinds({ ...base, reviewNotes: { enabled: true, perKind: 3 }, draft_end_marker: { enable: true } }).includes('invalid-draft-end-marker-config'));
});

const SIGNED = 'REVISED MOCK DELIVERABLE\n\nBody.\n\nAssumptions: none.';   // the mock critics sign off on a draft that carries this line, so a run is ONE pass on exactly this draft
const mockChain = extra => ({ ...JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8')), ...extra });
async function panelPrompts(extra) {
  const seen = [];
  setPromptSpy(({ label, user }) => { if (/^panel-/.test(label)) seen.push({ label, user }); });
  try { await runChain({ request, config: mockChain(extra), draft: SIGNED, log: () => {} }); } finally { setPromptSpy(null); setCache(null); }
  return seen;
}
test('through the real call sites: the marker appears only with BOTH the switch and the notes lane; each of the other three combinations leaves every judge prompt without it', async () => {
  const lane = { reviewNotes: { enabled: true, perKind: 3 } };
  assert.equal(reviewNotesActive(mockChain(lane)), true, 'the notes lane is active in this repo state (else the "on" run below would fail for the wrong reason)');
  for (const [name, extra] of [['neither', {}], ['notes lane only (how the nine shipped chains are configured)', lane], ['switch only, no notes lane', { draft_end_marker: { enabled: true } }]]) {
    assert.equal(reviewNotesActive(mockChain(extra)), extra.reviewNotes ? true : false, `${name}: the lane is ${extra.reviewNotes ? 'on' : 'off'} as the case says`);
    const seen = await panelPrompts(extra);
    assert.ok(seen.length > 0, name);
    for (const s of seen) assert.equal(s.user.includes(R.DRAFT_END_MARKER), false, `${name}: ${s.label} carries no marker`);
  }
  const on = await panelPrompts({ ...lane, draft_end_marker: { enabled: true } });
  assert.deepEqual([...new Set(on.map(s => s.label.split('-')[1]))], ['1'], 'one pass only, on exactly the signed draft');
  for (const s of on) {
    assert.equal(s.user.split(R.DRAFT_END_MARKER).length, 2, `${s.label}: the marker appears once`);
    const at = s.user.indexOf(R.DRAFT_END_MARKER);
    assert.ok(s.user.indexOf('# Draft under review') < at, `${s.label}: after the draft header`);
    assert.ok(s.user.slice(0, at).endsWith(`${SIGNED}\n\n`), `${s.label}: directly after the draft`);
  }
});

test('source scan: every unanimous-loop R.criticUser( call in chain.js passes the same endMarker, the bigger-cap retry included; the first-mode calls pass none', () => {
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  const calls = [...src.matchAll(/R\.criticUser\(\{[^}]*\}\)/g)].map(m => m[0]);
  const unanimous = calls.filter(c => /answeredQuestion/.test(c));
  assert.equal(unanimous.length, 2, 'the two unanimous-loop call sites (first ask and the bigger-cap retry)');
  for (const c of unanimous) assert.match(c, /endMarker/, c);
  for (const c of calls.filter(c => !/answeredQuestion/.test(c))) assert.doesNotMatch(c, /endMarker/, `first mode never carries the marker: ${c}`);
});
