// Notes lane 2b-2 (money; gate note Notes_Lane_2b_Gate_Note.md section 5, C&C 2b-1c PASS 16 Okt 2026): the estimator rows for the fold's input growth and the standalone notes-answer call, gated on the same predicate chain.js uses
// (reviewNotesActive: the chain key AND all four held sentences); the clause that says what the printed maximum leaves out (the memory block every judge CALL reads); the harness record `handoff-notes` is never an unpriced call.
// Offline, $0, no run: the estimator and the screens only. The chain side of the same truth table is test/review-notes-handoff.test.js (HF-1, HF-3).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateChainRows, summarise, DEFAULT_ESTIMATE, estimateTokens } from '../src/cost.js';
import { systemTextsFor } from '../src/stage-system.js';
import { roundLimitsOf } from '../src/overseer-rounds.js';
import { setHeldForTest } from '../src/held-roles.js';
import { notesMemoryClause, capScreenMemoryClause, notesConfigOf, LANE_HELD_NAMES } from '../src/review-notes-lane.js';
import { MEMORY_MAX_TOKENS_EST } from '../src/review-notes.js';
import { buildCapScreen } from '../src/cap-screen.js';
import * as H from './held-prompts/held-083.js';
import { createAuditWriter, parseAuditLog } from '../src/audit.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORDS = { reviewNotesAsk: H.reviewNotesAsk, reviewNotesRevise: H.reviewNotesRevise, reviewNotesMemory: H.reviewNotesMemory, reviewNotesAnswer: H.reviewNotesAnswer };
afterEach(() => setHeldForTest(null));

const base = JSON.parse(readFileSync(join(ROOT, 'chains', 'plan-high-council.json'), 'utf8'));
const api = { ...base.seats.critics[0] };                               // a priced API seat of the shipped chain
const shape = (which, extra = {}) => {
  const c = JSON.parse(JSON.stringify(base));
  c.seats.builder = { ...api }; c.seats.reviser = { ...api };
  if (which === 'same') c.seats.handoff = { ...api };
  else if (which === 'other') c.seats.handoff = { ...base.seats.critics[1] };
  else { delete c.seats.handoff; c.handoff = false; }
  return { ...c, ...extra };
};
const rowOf = (rows, label) => rows.find(r => r.label === label);
const withWords = held => setHeldForTest(held);
const MASK_LANE = Object.fromEntries(['reviewNotesAsk', 'reviewNotesRevise', 'reviewNotesMemory', 'reviewNotesAnswer'].map(n => [n, undefined]));   // A2: the lane sentences are in the real roles.js; an 'off' test masks them

test('NM-1 (gate = the chain\'s own predicate): notes-answer exists only when the lane is active AND the handoff is not folded; the fold grows the handoff row\'s input instead; off, or one held sentence missing, changes nothing', () => {
  // A2 (18 Okt 2026), CHANGED ACCEPTED TEST: old bar = the first estimate used the real roles (lane off); new bar = it masks the lane sentences (MASK_LANE) to get the off figure; why = src/roles.js now records the four lane sentences (Muad 18 Okt, E195), so 'the real roles.js records none of them' no longer holds; a partial or missing set must be MASKED explicitly (setHeldForTest with the names set to undefined).
  withWords(MASK_LANE);
  const off = estimateChainRows(shape('same'));
  withWords(WORDS);
  const fold = estimateChainRows(shape('same')); const other = estimateChainRows(shape('other')); const none = estimateChainRows(shape('none'));
  assert.ok(!rowOf(fold, 'notes-answer'), 'fold: no notes-answer row');
  assert.ok(rowOf(fold, 'handoff').input > rowOf(off, 'handoff').input, 'the fold grows the handoff input');
  assert.ok(rowOf(other, 'notes-answer') && rowOf(none, 'notes-answer'), 'a different handoff seat, or none: one notes-answer row');
  assert.ok(rowOf(other, 'notes-answer').input > 0 && rowOf(other, 'notes-answer').usd > 0, 'an API writer is priced');
  const keyOff = estimateChainRows(shape('none', { reviewNotes: undefined }));
  assert.ok(!rowOf(keyOff, 'notes-answer'), 'no chain key: no row');
  for (const missing of LANE_HELD_NAMES) {
    withWords({ ...WORDS, [missing]: undefined });
    const part = estimateChainRows(shape('none'));
    assert.ok(!rowOf(part, 'notes-answer'), `${missing} missing: the lane is off, no row`);
  }
  withWords(WORDS);
  assert.ok(!rowOf(estimateChainRows(shape('none'), { fromRun: true }), 'notes-answer'), 'council handoff --from-run prices no lane row');
});

test('NM-2 (a session writer is $0; the expected figure uses the typical key, the maximum the cap)', () => {
  withWords(WORDS);
  const ext = shape('none'); ext.seats.reviser = { provider: 'external', model: 'subscription:opus-5.5', maxTokens: 20000 };
  assert.equal(rowOf(estimateChainRows(ext), 'notes-answer').usd, 0);
  const keyed = shape('none', { estimate: { ...base.estimate, notesAnswerOutTokens: 700 } });
  assert.equal(rowOf(estimateChainRows(keyed), 'notes-answer').output, 700);
  assert.ok(Number.isInteger(api.maxTokens) && api.maxTokens > 700, 'the fixture seat has a cap above the typical key');
  assert.equal(rowOf(estimateChainRows(shape('none')), 'notes-answer').output, api.maxTokens, 'key absent: the seat cap');
  assert.equal(rowOf(estimateChainRows(keyed, { maximum: true }), 'notes-answer').output, api.maxTokens, 'the maximum ignores the key and uses the cap');
});

test('NM-3 (a harness record is not a call): handoff-notes (provider harness, usd 0) is never listed unpriced in the totals', () => {
  const stages = [{ label: 'handoff', provider: 'external', model: 'subscription:opus-5.5', usage: { input: 1, output: 1 }, usd: 0 }, { label: 'handoff-notes', provider: 'harness', model: 'none', usage: { input: 0, output: 0 }, usd: 0 }];
  assert.deepEqual(summarise(stages).unpriced.filter(u => u.startsWith('harness')), []);
});

test('NM-4 (what the maximum leaves out): the memory clause names MEMORY_MAX_TOKENS_EST and exists only on an active lane; the cap screen carries it as one extra line and is byte-identical without it', () => {
  // A2 (18 Okt 2026), CHANGED ACCEPTED TEST: old bar = notesMemoryClause was '' on the real roles and named 'every judge call'; new bar = it is '' with the lane masked, and the E194 clause says 'judge calls read ... paid input that neither figure prices'; why = src/roles.js now records the four lane sentences (Muad 18 Okt, E195), so 'the real roles.js records none of them' no longer holds; a partial or missing set must be MASKED explicitly (setHeldForTest with the names set to undefined).
  withWords(MASK_LANE);
  assert.equal(notesMemoryClause(shape('same')), '');
  withWords(WORDS);
  const clause = notesMemoryClause(shape('same'));
  assert.ok(clause.includes(`${MEMORY_MAX_TOKENS_EST} tokens per call`) && clause.includes('judge calls read') && clause.includes('paid input that neither figure prices'));
  withWords({ ...WORDS, reviewNotesMemory: undefined });
  assert.equal(notesMemoryClause(shape('same')), '');
  const plain = buildCapScreen({ kind: 'run', subject: {}, estimate: { usd: 1 }, maximum: { usd: 2 } }).text;
  assert.equal(buildCapScreen({ kind: 'run', subject: {}, estimate: { usd: 1 }, maximum: { usd: 2 }, notesMemory: '' }).text, plain);
  assert.ok(!plain.includes('Not counted in either figure'), 'no clause: the screen has no such line');
  const withClause = buildCapScreen({ kind: 'run', subject: {}, estimate: { usd: 1 }, maximum: { usd: 2 }, notesMemory: clause }).text;
  assert.ok(withClause.includes(`Not counted in either figure: ${clause}.`) && withClause !== plain);
});

test('NM-5 (the key is on the four planning-tier chains, the two Chinese chains, plan-claude-council, and on no other shipped chain): High, Medium, Mini, the Mini Sol-session copy, the two Chinese chains and plan-claude-council carry reviewNotes; nothing else does', () => {
  // R1 (18 Okt 2026), CHANGED ACCEPTED TEST: old bar = exactly the four planning-tier chains; new bar = those four plus plan-china-mini-council and plan-china-medium-council (both carry reviewNotes {enabled:true, perKind:3} like their siblings); why = picks 59-62 added plan-china-mini-council and plan-china-medium-council as 'the same machinery' as their tier siblings (m6-closing/China_Chains_Gate_Note.md lines 8, 12; Muad 15 Okt 22:34 'additional and advertised', 23:09 '4: all three'); each carries exactly the sibling's value, so the typed list names them; the lists stay hand-typed. The two Chinese chains are listed as their siblings are (China_Chains_Gate_Note, picks 59-62, 16 Okt 2026); Muad's yes on the chain at M7.
  // CHANGED ACCEPTED TEST (notes lane per-tier key commit, 16 Okt 2026): it pinned 'exactly one chain, plan-high-council' while the tiers' keys were a later commit (Muad 15 Okt 23:09: "4: all three" tiers).
  // R2 (18 Okt 2026), CHANGED ACCEPTED TEST: old bar = six carriers; new bar = those six plus plan-claude-council (76's file carries reviewNotes; every seat is external, so the lane costs $0 there). WHY: a new shipped chain.
  // OLD (23 Okt 2026, lane B commit 2): eight carriers; NEW: nine, plus plan-default-opro-council (a new shipped chain; its writer is a paid OpenRouter seat, see NM-8).
  // OLD (20 Okt 2026): seven carriers; NEW: those plus plan-china-high-council (paid seats: it is a lane chain with a memory block). WHY: a new shipped chain.
  const carrying = readdirSync(join(ROOT, 'chains')).filter(f => f.endsWith('.json')).filter(f => JSON.parse(readFileSync(join(ROOT, 'chains', f), 'utf8')).reviewNotes !== undefined);
  assert.deepEqual(carrying, ['plan-china-high-council.json', 'plan-china-medium-council.json', 'plan-china-mini-council.json', 'plan-claude-council.json', 'plan-default-opro-council.json', 'plan-high-council.json', 'plan-medium-council.json', 'plan-mini-council-sol-session.json', 'plan-mini-council.json']);
});

test('NM-6 (the cap screen line is for a FULL run only): a one-call screen (handoff --from-run, draft, digest, any side verb) and a chain with no overseer rounds get no clause', () => {
  withWords(WORDS);
  const cfg = shape('same');
  assert.ok(capScreenMemoryClause(cfg, { fullRun: true }).includes('judge calls read'));   // A2: E194 wording
  assert.equal(capScreenMemoryClause(cfg, { fullRun: false }), '');
  const noRounds = { ...cfg }; delete noRounds.maxOverseerRounds; delete noRounds.layerRevisions;
  assert.equal(capScreenMemoryClause(noRounds, { fullRun: true }), '');
});

test('NM-7 (the audit log is one line per provider call): a harness record is not written to it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nm7-'));
  const w = createAuditWriter({ runDir: dir, run: 'r', chain: 'c', hmacKey: null });
  w.recordStage({ label: 'handoff', provider: 'external', model: 'subscription:x', lab: 'writer', usage: { input: 1, output: 1 }, usd: 0 });
  w.recordStage({ label: 'handoff-notes', provider: 'harness', model: 'none', lab: 'writer', usage: { input: 0, output: 0 }, usd: 0 });
  w.close();
  const lines = parseAuditLog(readFileSync(w.path, 'utf8'));
  assert.deepEqual(lines.filter(l => l.stage).map(l => l.stage), ['handoff']);
});

test('NM-8 (review fix F9, 18 Okt 2026): the MAXIMUM prices the notes input at the lane\'s read caps for every planned overseer round; the expected figure keeps the asked lengths and one round; the shipped chains\' notes rows stay $0 (external writers)', () => {
  withWords(WORDS);
  const c = shape('none');
  const k = notesConfigOf(c); const judges = c.seats.critics.length; const rounds = roundLimitsOf(c).overseer;
  assert.ok(Number.isInteger(rounds) && rounds > 1, 'the fixture chain plans several overseer rounds');
  const a = { ...DEFAULT_ESTIMATE, ...(c.estimate || {}) };
  const expected = rowOf(estimateChainRows(c), 'notes-answer'); const maximum = rowOf(estimateChainRows(c, { maximum: true }), 'notes-answer');
  // CHANGED (0.8.3 estimator unit; fixture-delta-trace.txt): OLD base = promptTokens + draftTokens; NEW adds the notes-answer call's own system text (the row now counts it: src/stage-system.js), 18 tokens here. The item arithmetic below is unchanged.
  const base = a.promptTokens + a.draftTokens + Math.max(0, ...systemTextsFor('notes-answer', c, null).map(estimateTokens));
  const askedItems = Math.ceil(((k.itemChars + k.aboutChars) * k.perKind * 2 * judges) / 4);
  const readItems = Math.ceil(((k.textMax + k.aboutMax) * k.perKind * 2 * judges * rounds) / 4);
  assert.equal(expected.input - base, askedItems, 'expected: asked lengths, one round (unchanged)');
  assert.equal(maximum.input - base, readItems, 'maximum: read caps, every planned round');
  assert.ok(maximum.input > expected.input && maximum.usd > expected.usd, 'the printed maximum rose');
  for (const f of readdirSync(join(ROOT, 'chains')).filter(n => n.endsWith('.json'))) {
    const chain = JSON.parse(readFileSync(join(ROOT, 'chains', f), 'utf8'));
    if (chain.reviewNotes === undefined) continue;
    // 0.8.3 (lane B, commit 2), CHANGED ACCEPTED TEST: OLD = every lane chain has an external writer, so its notes-answer and handoff rows are $0; NEW = the same for every chain whose handoff seat is external, and for plan-default-opro-council, whose handoff writer is a paid OpenRouter seat (DeepSeek V4.1 Flash), the handoff row must be PRICED (> 0) in both figures: a paid writer's notes are not free.
    const paidWriter = chain.seats.handoff?.provider !== 'external';
    for (const opts of [{}, { maximum: true }]) for (const r of estimateChainRows(chain, opts).filter(x => x.label === 'notes-answer' || x.label === 'handoff')) {
      if (!paidWriter) assert.equal(r.usd, 0, `${f} ${r.label}: an external writer is $0, so the shipped dry-run line does not move`);
      else if (r.label === 'handoff') assert.ok(r.usd > 0, `${f} handoff: a paid writer's row is priced`);
    }
  }
});

test('NM-9 (review fix F9, revise rows, 18 Okt 2026): a revise call\'s prompt carries the unseen notes, so the MAXIMUM revise-all input grows by one overseer round of items at the read caps; the expected figure and a lane-off chain do not move', () => {
  const c = shape('none');
  const k = notesConfigOf(c); const judges = c.seats.critics.length;
  withWords(MASK_LANE);
  const offMax = rowOf(estimateChainRows(c, { maximum: true }), 'revise-all'); const offExp = rowOf(estimateChainRows(c), 'revise-all');
  withWords(WORDS);
  const onMax = rowOf(estimateChainRows(c, { maximum: true }), 'revise-all'); const onExp = rowOf(estimateChainRows(c), 'revise-all');
  assert.ok((onMax.times ?? 1) > 1, 'the layered fixture plans several revise calls');
  assert.equal((onMax.input - offMax.input) / (onMax.times ?? 1), Math.ceil(((k.textMax + k.aboutMax) * k.perKind * 2 * judges) / 4), 'maximum: one round of items at the read caps, per revise call (a row input is the total of its repeats)');
  assert.ok(onMax.usd > offMax.usd, 'the printed maximum rose on a paid reviser');
  assert.equal(onExp.input, offExp.input, 'the expected figure does not move');
  assert.equal(onExp.usd, offExp.usd);
});
