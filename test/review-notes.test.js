// 0.8.3 notes lane UNIT 1 (src/review-notes.js; gate page Notes_Lane_Gate_Page.md section 9, short note Notes_Lane_Unit1_Note.md, C&C rulings 15 Okt 2026): the PURE module. Every row is its own test with its own assertion, so a stand-in
// module (the same exports with neutral behaviour: laptop-notes-u1-staged-red.txt) fails each on ITS OWN assertion. Optional chaining below is deliberate: a stand-in must fail an assertion, not crash the row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDisputes } from '../src/draft-disputes.js';

const RN = await import('../src/review-notes.js').catch(() => ({}));
const CAPS = { left: { proposal: 3, idea: 3 }, textMax: 8000, aboutMax: 300 };
const clone = v => JSON.parse(JSON.stringify(v));
const it = (over = {}) => ({ kind: 'proposal', id: RN.noteId?.('proposal', over.text ?? 'add a rollback section'), text: 'add a rollback section', lab: 'a', layer: 1, overseer_round: 1, pass: 1, ...over });
const IDS = ['N-0123abcd', 'N-89abcdef', 'N-00000001', 'N-00000002'];

test('noteId: kind + exact text only (NFC, trim, whitespace collapsed, case kept); N- prefix, 8 hex, never an objection id; the LAB is not in it', () => {
  const a = RN.noteId?.('proposal', 'Add  a rollback\n section ');
  assert.match(a ?? '', /^N-[0-9a-f]{8}$/);
  assert.equal(a, RN.noteId?.('proposal', 'Add a rollback section'), 'whitespace and edges do not make a new item');
  assert.notEqual(a, RN.noteId?.('proposal', 'add a rollback section'), 'case is kept: a different text');
  assert.notEqual(a, RN.noteId?.('idea', 'Add a rollback section'), 'the kind is in the hash');
  assert.equal(RN.noteId?.('idea', 'café'), RN.noteId?.('idea', 'café'), 'NFC');
  assert.equal(RN.noteId?.length, 2, 'two arguments: kind and text, no lab');
});

test('readNotes: notes beside a clean verdict are read apart from it: the reply is never mutated and the output carries no verdict field', () => {
  const reply = { meets: true, failures: [], criteria: [{ id: 'C1', verdict: 'pass' }], proposals: [{ text: 'add a rollback section' }], ideas: [{ text: 'name the owner', about: 'the Scope section' }] };
  const before = clone(reply);
  const r = RN.readNotes?.(reply, CAPS);
  assert.deepEqual(reply, before, 'the reply is untouched');
  assert.equal(r?.items?.length, 2);
  assert.deepEqual(r?.items?.map(x => x.kind), ['proposal', 'idea']);
  assert.equal(r?.items?.[1]?.about, 'the Scope section', 'about is kept for an idea');
  for (const k of ['meets', 'failures', 'verdict']) assert.equal(r && k in r, false, `no ${k} in the result`);
});

test('readNotes: no JSON shape throws (null, strings, numbers, arrays, wrong types, __proto__ keys, a huge array); malformed parts are dropped with a reason', () => {
  const huge = { ideas: Array.from({ length: 5000 }, (_, i) => ({ text: `q${i}` })) };
  const protoReply = JSON.parse('{"__proto__":{"proposals":[{"text":"z"}]}}');
  for (const reply of [null, undefined, 'x', 5, true, [], ['a'], {}, { proposals: 'x' }, { proposals: [1, null, 'a', [], {}, { text: 7 }, { text: '  ' }] }, { ideas: { text: 'q' } }, protoReply, huge]) {
    assert.doesNotThrow(() => RN.readNotes?.(reply, CAPS), JSON.stringify(reply)?.slice(0, 60));
  }
  const bad = RN.readNotes?.({ proposals: [1, null, 'a', [], {}, { text: 7 }, { text: '  ' }], ideas: 'no' }, CAPS);
  assert.equal(bad?.items?.length, 0);
  assert.equal(bad?.dropped?.filter(d => d.why === 'bad_item').length, 7);
  assert.equal(bad?.dropped?.some(d => d.why === 'not_an_array' && d.kind === 'idea'), true);
  assert.equal(RN.readNotes?.(protoReply, CAPS)?.items?.length, 0, 'an own "__proto__" key is not a proposals array');
  assert.equal(RN.readNotes?.(huge, CAPS)?.items?.length, 3, 'a huge array is capped by the budget, the rest counted');
  assert.equal(RN.readNotes?.(huge, CAPS)?.cut?.idea, 4997);
});

test('readNotes: a 4th item is cut and counted (budget left = 3); an over-long text is cut with capField\'s mark; the id comes from the FULL text', () => {
  const r = RN.readNotes?.({ proposals: [{ text: 'one' }, { text: 'two' }, { text: 'three' }, { text: 'four' }] }, CAPS);
  assert.equal(r?.items?.length, 3);
  assert.equal(r?.cut?.proposal, 1);
  const long = 'x'.repeat(50);
  const c = RN.readNotes?.({ ideas: [{ text: long }, { text: `${long}y` }] }, { left: { proposal: 3, idea: 3 }, textMax: 20, aboutMax: 5 });
  assert.equal(c?.items?.[0]?.text, `${'x'.repeat(20)}… [truncated, 50 chars total]`);
  assert.notEqual(c?.items?.[0]?.id, c?.items?.[1]?.id, 'two texts that differ only past the cap keep two ids');
});

test('readNotes: a duplicate inside one reply is dropped and spends NO budget; a carried verdict\'s notes are not read', () => {
  const r = RN.readNotes?.({ proposals: [{ text: 'same' }, { text: 'same' }, { text: 'same' }, { text: 'b' }, { text: 'c' }] }, CAPS);
  assert.deepEqual(r?.items?.map(x => x.text), ['same', 'b', 'c']);
  assert.equal(r?.cut?.proposal, 0);
  assert.equal(r?.dropped?.filter(d => d.why === 'duplicate_in_reply').length, 2);
  const cutThenRepeat = RN.readNotes?.({ proposals: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }, { text: 'd' }] }, CAPS);
  assert.equal(cutThenRepeat?.cut?.proposal, 1, 'the 4th item is cut once');
  assert.equal(cutThenRepeat?.dropped?.filter(d => d.why === 'duplicate_in_reply').length, 1, 'its repeat is a duplicate, not a second cut');
  const carried = RN.readNotes?.({ carried: true, proposals: [{ text: 'a' }] }, CAPS);
  assert.equal(carried?.items?.length, 0);
  assert.equal(carried?.carried, true);
});

test('readNotes: caps are required arguments (no default)', () => {
  assert.throws(() => RN.readNotes?.({}, { left: CAPS.left, aboutMax: 5 }), TypeError);
  assert.throws(() => RN.readNotes?.({}, { left: { proposal: -1, idea: 1 }, textMax: 5, aboutMax: 5 }), TypeError);
  assert.throws(() => RN.readNotes?.({}), TypeError);
});

test('budgetLeft: perKind per seat per kind per OVERSEER round across all passes; resets at the next round; perKind is REQUIRED (no literal in the module)', () => {
  const items = [it({ pass: 1, text: 'one' }), it({ pass: 2, text: 'two' }), it({ kind: 'idea', text: 'idea', pass: 1 }), it({ lab: 'b', text: 'b-one' })];
  assert.equal(RN.budgetLeft?.(items, 'a', 'proposal', 1, 3), 1, 'two used across two passes of the same overseer round');
  assert.equal(RN.budgetLeft?.(items, 'a', 'idea', 1, 3), 2, 'the other kind has its own budget');
  assert.equal(RN.budgetLeft?.(items, 'b', 'proposal', 1, 3), 2, 'the other judge has its own budget');
  assert.equal(RN.budgetLeft?.(items, 'a', 'proposal', 2, 3), 3, 'a new overseer round resets it');
  assert.equal(RN.budgetLeft?.(items, 'a', 'proposal', 1, 2), 0, 'never negative');
  for (const bad of [undefined, 0, 2.5, '3', null]) assert.throws(() => RN.budgetLeft?.(items, 'a', 'proposal', 1, bad), TypeError, String(bad));
});

test('notesView: the same exact text from two judges shares one id and raised_by is 2; a reworded item is a new item; the lab is on the record', () => {
  const same = [it({ lab: 'a' }), it({ lab: 'b' })];
  const { rows } = RN.notesView?.(same, new Map(), { chainLabs: ['a', 'b'] }) ?? {};
  assert.equal(rows?.length, 1);
  assert.deepEqual(rows?.[0]?.raised_by, ['a', 'b']);
  assert.equal(rows?.[0]?.raised_count, 2);
  const reworded = RN.notesView?.([it({ lab: 'a' }), it({ lab: 'b', text: 'add a rollback section.', id: RN.noteId?.('proposal', 'add a rollback section.') })], new Map(), { chainLabs: ['a', 'b'] });
  assert.equal(reworded?.rows?.length, 2, 'a reworded item is a new item (exact ids only, no similarity)');
});

test('notesView: the same id with DIFFERENT text is kept as TWO items and counted, never merged', () => {
  const one = it({ id: 'N-aaaaaaaa', text: 'first text' }); const two = it({ id: 'N-aaaaaaaa', text: 'quite another text', lab: 'b' });
  const { rows, exclusion } = RN.notesView?.([one, two], new Map(), { chainLabs: ['a', 'b'] }) ?? {};
  assert.equal(rows?.length, 2);
  assert.equal(exclusion?.id_collisions, 1);
  assert.equal(rows?.every(r => r.id_collision === true), true);
});

test('notesView: notes of a lab that is not on the chain are dropped and COUNTED; chainLabs is required', () => {
  const { rows, exclusion } = RN.notesView?.([it({ lab: 'a' }), it({ lab: 'ghost', text: 'x', id: RN.noteId?.('proposal', 'x') })], new Map(), { chainLabs: new Set(['a']) }) ?? {};
  assert.equal(rows?.length, 1);
  assert.equal(exclusion?.off_chain, 1);
  assert.throws(() => RN.notesView?.([it()], new Map(), {}), TypeError);
});

test('notesView: an id already answered in an earlier round is not shown again and is counted (already_answered)', () => {
  const x = it();
  const { rows, exclusion } = RN.notesView?.([x, it({ text: 'other', id: RN.noteId?.('proposal', 'other') })], new Map(), { chainLabs: ['a'], alreadyAnswered: new Set([x.id]) }) ?? {};
  assert.equal(rows?.length, 1);
  assert.equal(exclusion?.already_answered, 1);
});

test('parseNoteAnswers: the three answer lines; a NOTE-TAKEN for an UNKNOWN id answers nothing (counted); an unanswered item reads unanswered, never "taken"', () => {
  const p = RN.parseNoteAnswers?.(`The plan.\nNOTE-TAKEN: ${IDS[0]}\nNOTE-DECLINED: ${IDS[1]}: out of scope\nNOTE-TAKEN: ${IDS[3]}\n`);
  assert.equal(p?.answers?.get(IDS[0])?.status, 'taken');
  assert.deepEqual(p?.answers?.get(IDS[1]), { status: 'declined', reason: 'out of scope' });
  const items = [it({ id: IDS[0], text: 'a' }), it({ id: IDS[1], text: 'b' }), it({ id: IDS[2], text: 'c' })];
  const v = RN.notesView?.(items, p, { chainLabs: ['a'] });
  assert.deepEqual(v?.rows?.map(r => `${r.id}:${r.answer.status}`), [`${IDS[2]}:unanswered`, `${IDS[0]}:taken`, `${IDS[1]}:declined`], 'rows in id order');
  assert.equal(v?.exclusion?.unknown_answer_ids, 1, 'IDS[3] was never raised');
  assert.equal(v?.exclusion?.unanswered, 1);
});

test('parseNoteAnswers: TAKEN then DECLINED for one id is CONFLICTING, never silently resolved; an identical repeat is counted; a DECLINED without a reason is reason null (nothing invented)', () => {
  const p = RN.parseNoteAnswers?.(`NOTE-TAKEN: ${IDS[0]}\nNOTE-DECLINED: ${IDS[0]}: no\nNOTE-TAKEN: ${IDS[1]}\nNOTE-TAKEN: ${IDS[1]}\nNOTE-DECLINED: ${IDS[2]}`);
  assert.deepEqual(p?.conflicts, [IDS[0]]);
  assert.equal(p?.repeated, 1);
  assert.deepEqual(p?.answers?.get(IDS[2]), { status: 'declined', reason: null });
  assert.equal(p?.reasonless, 1);
  const v = RN.notesView?.([it({ id: IDS[0], text: 'a' })], p, { chainLabs: ['a'] });
  assert.equal(v?.rows?.[0]?.answer?.status, 'conflicting');
});

test('NOTE-SAME: pointing at itself or malformed is not an answer (counted); an unknown target or a cycle reads unanswered (counted); a valid reference is "same"', () => {
  const p = RN.parseNoteAnswers?.(`NOTE-SAME: ${IDS[0]}: ${IDS[0]}\nNOTE-SAME: ${IDS[1]}: not-an-id\nNOTE-SAME: ${IDS[2]}: N-ffffffff\nNOTE-SAME: ${IDS[3]}: ${IDS[0]}\nNOTE-TAKEN: ${IDS[0]} trailing words`);
  assert.equal(p?.malformed, 3, 'self, not-an-id, and TAKEN with extra words');
  const items = [IDS[0], IDS[1], IDS[2], IDS[3]].map((id, i) => it({ id, text: `t${i}` }));
  const v = RN.notesView?.(items, p, { chainLabs: ['a'] });
  const by = Object.fromEntries((v?.rows ?? []).map(r => [r.id, r.answer]));
  assert.equal(by[IDS[2]]?.status, 'unanswered', 'a target nobody raised');
  assert.equal(by[IDS[3]]?.status, 'unanswered', 'IDS[0] has no recorded answer, so the reference ends nowhere');
  const ok = RN.notesView?.(items, RN.parseNoteAnswers?.(`NOTE-DECLINED: ${IDS[0]}: later\nNOTE-SAME: ${IDS[3]}: ${IDS[0]}`), { chainLabs: ['a'] });
  assert.deepEqual(ok?.rows?.find(r => r.id === IDS[3])?.answer, { status: 'same', same_as: IDS[0] });
  const cyc = RN.notesView?.(items, RN.parseNoteAnswers?.(`NOTE-SAME: ${IDS[0]}: ${IDS[1]}\nNOTE-SAME: ${IDS[1]}: ${IDS[0]}`), { chainLabs: ['a'] });
  assert.deepEqual([cyc?.rows?.find(r => r.id === IDS[0])?.answer?.status, cyc?.rows?.find(r => r.id === IDS[1])?.answer?.status], ['unanswered', 'unanswered']);
  assert.equal(cyc?.exclusion?.bad_same, 2);
});

test('sign-off pass: a taken note becomes a builder task (the plan is not changed); declined and same stay as the writer gave them', () => {
  const p = RN.parseNoteAnswers?.(`NOTE-TAKEN: ${IDS[0]}\nNOTE-DECLINED: ${IDS[1]}: no`);
  const items = [it({ id: IDS[0], text: 'a' }), it({ id: IDS[1], text: 'b' })];
  assert.deepEqual(RN.notesView?.(items, p, { chainLabs: ['a'], afterSignoff: true })?.rows?.map(r => r.answer.status), ['builder_task', 'declined']);
  assert.deepEqual(RN.notesView?.(items, p, { chainLabs: ['a'] })?.rows?.map(r => r.answer.status), ['taken', 'declined']);
});

test('the trailer: the answers are read in EVERY order of NOTE / DECLINED / Disputed lines and chatter (parse only: the strip is unit 2)', () => {
  const parts = [`NOTE-TAKEN: ${IDS[0]}`, 'DECLINED: O-12345678: a reason', 'Disputed: the owner disagreed', `NOTE-DECLINED: ${IDS[1]}: later`, 'Thanks, done.'];
  const perms = a => (a.length < 2 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(r => [x, ...r])));
  let n = 0;
  for (const order of perms(parts)) {
    const p = RN.parseNoteAnswers?.(`The plan.\n\n${order.join('\n')}\n`);
    assert.equal(p?.answers?.size, 2, order.join(' | '));
    assert.equal(p?.malformed, 0);
    n += 1;
  }
  assert.equal(n, 120);
});

test('the answer-line grammar never reads as a dispute: it does not start with DECLINED:, carries no O- id, and parseDisputes finds no dispute in a reply that ends in answer lines', () => {
  const lines = [`NOTE-TAKEN: ${IDS[0]}`, `NOTE-DECLINED: ${IDS[1]}: a reason that quotes DECLINED: O-12345678: and more`, `NOTE-SAME: ${IDS[2]}: ${IDS[3]}`];
  for (const l of lines) { assert.equal(/^\s*DECLINED:/.test(l), false); assert.notEqual(RN.noteLineOf?.(l), null, l); assert.equal(RN.isNoteLine?.(l), true); }
  assert.equal(RN.noteLineOf?.('DECLINED: O-12345678: x'), null, 'a dispute line is not an answer line');
  assert.equal(RN.noteLineOf?.('NOTE-TAKEN: n-0123abcd')?.malformed, true, 'case-exact');
  for (const withIds of [false, true]) {
    const r = parseDisputes(`The plan.\n\n${lines.join('\n')}\n`, { withIds });
    assert.deepEqual(r.disputes, [], `withIds ${withIds}`);
  }
});

test('lastRoundOf and sinceLastRevise: the newest overseer round before the current one; items across an unheard pass since the last revise', () => {
  const items = [it({ overseer_round: 1, pass: 1 }), it({ overseer_round: 2, pass: 2, text: 'b', id: RN.noteId?.('proposal', 'b') }), it({ overseer_round: 2, pass: 3, text: 'c', id: RN.noteId?.('proposal', 'c') })];
  assert.equal(RN.lastRoundOf?.(items, 3), 2);
  assert.equal(RN.lastRoundOf?.(items, 2), 1);
  assert.equal(RN.lastRoundOf?.(items, 1), null);
  const passes = [{ pass: 1, revised: true }, { pass: 2, revised: false }, { pass: 3, revised: false }];
  assert.deepEqual(RN.sinceLastRevise?.(items, passes)?.map(x => x.pass), [2, 3], 'pass 2 (an unheard re-ask pass has no revise) and pass 3 both reach the next writer');
  assert.equal(RN.sinceLastRevise?.(items, [])?.length, 3);
});

test('fitNotes: as is; then texts shortened longest first; then rows collapsed to id + answer; then UNANSWERED rows omitted, named and counted; an answered row is never dropped; overflow only when answered rows alone do not fit', () => {
  const row = (i, text, status) => ({ kind: 'proposal', id: `N-${String(i).padStart(8, '0')}`, text, raised_by: ['a'], raised_count: 1, overseer_rounds: [1], answer: { status } });
  const render = ({ rows, omitted }) => `${rows.map(r => `${r.id} ${r.text} => ${r.answer.status}`).join('\n')}${omitted ? `\nOMITTED ${omitted.count}: ${omitted.ids.join(',')}` : ''}`;
  const rows = [row(1, 'a'.repeat(1000), 'taken'), row(2, 'b'.repeat(900), 'unanswered'), row(3, 'c'.repeat(50), 'declined')];
  const as = RN.fitNotes?.(rows, render, { maxChars: 5000, maxTokens: 5000, floor: 100 });
  assert.equal(as?.counts?.shortened, 0, 'fits as is');
  const short = RN.fitNotes?.(rows, render, { maxChars: 700, maxTokens: 5000, floor: 100 });
  assert.equal(short?.counts?.shortened >= 1 && short?.counts?.collapsed === 0, true, 'shortened first');
  assert.match(short?.rows?.[0]?.text ?? '', /\[cut\]$/, 'the cut is visible');
  const collapsed = RN.fitNotes?.(rows, render, { maxChars: 150, maxTokens: 5000, floor: 100 });
  assert.equal(collapsed?.counts?.collapsed >= 1, true);
  assert.equal(collapsed?.text?.includes('=> taken') && collapsed?.text?.includes('=> declined'), true, 'the writer\'s answers are kept');
  const tight = RN.fitNotes?.(rows, render, { maxChars: 66, maxTokens: 5000, floor: 100 });
  assert.equal(tight?.omitted?.count, 1, 'the unanswered row is omitted');
  assert.deepEqual(tight?.omitted?.ids, ['N-00000002'], 'named, not silent');
  assert.equal(tight?.rows?.some(r => r.answer.status === 'taken') && tight?.rows?.some(r => r.answer.status === 'declined'), true, 'answered rows stay');
  const over = RN.fitNotes?.(rows, render, { maxChars: 20, maxTokens: 5000, floor: 100 });
  assert.equal(over?.overflow, true);
  assert.equal(over?.text, null);
});

test('the module: imports only node:crypto and the ledger leaf; the ledger\'s budget is imported, not retyped; no literal perKind; it never touches failures or meets', () => {
  const src = readFileSync(new URL('../src/review-notes.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.deepEqual([...code.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1]).sort(), ['./objection-ledger.js', 'node:crypto']);
  assert.equal(/40_?000/.test(code), false, 'the 40,000-character budget is imported');
  assert.equal(/perKind\s*[:=]\s*\d/.test(code), false, 'perKind is a chain number, never a literal here');
  assert.equal(/\.(failures|meets)\b|\[['"](failures|meets)['"]\]/.test(code), false, 'notes never read or write a verdict');
  assert.equal(code.includes('openrouter') || /\bfetch\(|Date\.now|Math\.random|process\.env/.test(code), false, 'pure: no network, clock, randomness or env');
});
