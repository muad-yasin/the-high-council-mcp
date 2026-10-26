// E3b UNIT TWO (gate page Review/Build_0.8.3/m6-closing/E3b_Gate_Page.md section 11, approved by C&C 14 Oct 2026): the first shipped call sites that pass `expect`. Every critic call gets its own recorded
// pair BEFORE the user string exists, the held "Reply identity" section is appended last, and the reply is read with the pair. The two sentences are HELD (test/held-prompts/held-083.js): these tests inject
// them with setHeldForTest and the real file store. Scripted seats: `mock-critic-envelope-<pattern>-<suffix>` (e echo, m missing, w wrong id, q quote + echo, c cut off, p previous pair). $0, offline.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setCache, setPromptSpy, setBudget, ExternalPause } from '../src/chain.js';
import { makeStageCache, writeSideStage } from '../src/stage-cache.js';
import { setHeldForTest } from '../src/held-roles.js';
import { HELD_OFF, withHeldOff } from './helpers/held-off.js';
import * as VE from '../src/verdict-envelope.js'; // namespace access, so the file still loads against a module without setEnvelopeInForce (a staged red)
const { setEnvelopeStore, fileEnvelopeStore } = VE;
const setEnvelopeInForce = on => VE.setEnvelopeInForce?.(on);
import { reportJsonShape } from '../src/report-shape.js';
import { promptHashOf } from '../src/cache-integrity.js';
import * as H from './held-prompts/held-083.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setEnvelopeStore(null); setEnvelopeInForce(false); });

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORDS = { verdictEnvelopeSection: H.verdictEnvelopeSection, criticEnvelopeReaskNote: H.criticEnvelopeReaskNote };
let counter = 0;
const rec = (dir, label) => JSON.parse(readFileSync(join(dir, `${label}.envelope.json`), 'utf8'));
const live = dir => readdirSync(dir).filter(f => f.endsWith('.envelope.json')).sort();
const aside = dir => (existsSync(join(dir, 'superseded')) ? readdirSync(join(dir, 'superseded')).filter(f => f.endsWith('.envelope.json')).sort() : []);

/** One sitting in `dir` (the run folder): the real stage cache and file store, scripted envelope seats. Returns what ran for real (onStage with !cached), the prompts and the result. */
async function sitting(dir, { la = 'e', lb = 'e', inForce = true, words = true, maxRounds = 1, criteria = ['The plan states its assumptions.'], maxTokens = 3000, laProvider = 'mock', first = false, freedoms = null, diagnosis = false, laModel = null } = {}) {
// CHANGED ACCEPTED TEST (decider-readiness unit, 24 Okt 2026; X16' scope run on the box). OLD: the helper's `words: false` case set NO override, which meant "the held words are not recorded". NEW: it sets the explicit off map (test/helpers/held-off.js), so the door test still proves the off path once src/roles.js records the words; the map behaves the same today.
// CHANGED ACCEPTED TEST (decider-readiness part (i) fix-up, 24 Okt 2026; the X16'' scope run read 23 failures, not the predicted 19). OLD: the helper's `words: true` case injected the PARTIAL map, so every other held name fell through to src/roles.js once it records them. NEW: the map is merged over the explicit off state (withHeldOff), so only the names the test injects are on. WHY: setHeldForTest replaces the whole map; a door test must say which words are on and keep the rest off. This changed test was failing (d2, d4) in the X16'' run. The map behaves the same today.
  setHeldForTest(words ? withHeldOff(diagnosis ? { ...WORDS, criticEnvelopeUnreadableWhy: H.criticEnvelopeUnreadableWhy, criticEnvelopeUnreadableLabel: H.criticEnvelopeUnreadableLabel } : WORDS) : HELD_OFF);
  setEnvelopeStore(fileEnvelopeStore(dir)); setEnvelopeInForce(inForce);
  setCache(makeStageCache({ dir, fingerprint: 'f' }));
  const prompts = new Map(); const real = []; const logs = [];
  setPromptSpy(p => prompts.set(p.label, p.user));
  const tag = `${process.pid}-${++counter}`;
  const seat = (lab, pat, provider = 'mock') => ({ provider, model: lab === 'la' && laModel ? laModel : provider === 'mock' ? `mock-critic-envelope-${pat}-${tag}-${lab}` : 'external-model', lab, maxTokens });
  const config = {
    name: 'fixture-e3b', criteria, maxRounds, ...(first ? {} : { signoff: 'unanimous' }), ...(freedoms ? { freedoms } : {}), estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'writer' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'writer' },
      critics: [seat('la', la, laProvider), seat('lb', lb)] },
  };
  const result = await runChain({ request: 'Write a one-paragraph plan for a bake sale.', runId: 'r-e3b', log: l => logs.push(l), config, onStage: s => { if (!s.cached) real.push(s.label); writeSideStage(dir, s, { fingerprint: 'f' }); } });
  return { result, prompts, real, config, logs };
}
const fresh = () => mkdtempSync(join(tmpdir(), 'e3b-calls-'));
const rows = r => r.panelVerdicts || [];

test('E3b c1: each critic call records its own pair BEFORE the prompt exists, the held section is the LAST thing in the prompt, and the echoed reply is read', async () => {
  const dir = fresh();
  const { result, prompts } = await sitting(dir);
  assert.equal(result.passed, true);
  assert.deepEqual(live(dir), ['panel-1-la.envelope.json', 'panel-1-lb.envelope.json']);
  const a = rec(dir, 'panel-1-la'); const b = rec(dir, 'panel-1-lb');
  assert.notEqual(a.review_id, b.review_id, 'a pair per call, never shared');
  for (const [label, r] of [['panel-1-la', a], ['panel-1-lb', b]]) {
    assert.ok(prompts.get(label).endsWith(H.verdictEnvelopeSection({ review_id: r.review_id, draft_id: r.draft_id })), `${label}: the section is last`);
    assert.equal(prompts.get(label).split(r.review_id).length - 1, 1, `${label}: the id appears once, in the appended section`);
  }
  assert.ok(rows(result).every(v => v.envelope === undefined));
});

test('E3b c2: a run NOT using the envelope issues nothing, shows nothing and reads as before (the flag is the authority) [PIN: passes on the old code]', async () => {
  const dir = fresh();
  const { result, prompts } = await sitting(dir, { la: 'm', inForce: false });
  assert.equal(result.passed, true, 'a reply with no ids is a verdict when the envelope is off');
  assert.deepEqual(live(dir), []);
  assert.ok(![...prompts.values()].some(u => u.includes('Reply identity')));
});

test('E3b c3: a reply without the ids is unheard with envelope "missing" (the reason code stays), the seat is re-asked ONCE with the held note and its OWN new pair', async () => {
  const dir = fresh();
  const { result, prompts } = await sitting(dir, { la: 'mm' });
  assert.equal(result.passed, false);
  const row = rows(result).find(v => v.lab === 'la');
  assert.equal(row.verdict, 'unheard');
  assert.equal(row.envelope, 'missing');
  assert.equal(row.reasked, true);
  assert.ok(prompts.get('panel-1-la-reask1').includes(H.criticEnvelopeReaskNote({ kind: 'missing' })), 'the re-ask says what was missing');
  assert.notEqual(rec(dir, 'panel-1-la').review_id, rec(dir, 'panel-1-la-reask1').review_id);
  assert.equal(rows(result).find(v => v.lab === 'lb').envelope, undefined);
});

test('E3b c4: ids that are not this call\'s are "wrong_id", and the re-ask names that kind', async () => {
  const dir = fresh();
  const { result, prompts } = await sitting(dir, { la: 'ww' });
  assert.equal(rows(result).find(v => v.lab === 'la').envelope, 'wrong_id');
  assert.ok(prompts.get('panel-1-la-reask1').includes(H.criticEnvelopeReaskNote({ kind: 'wrong_id' })));
});

test('E3b c5: a clean sign-off QUOTED without ids beside the seat\'s own reply is an example, and the run passes', async () => {
  const { result } = await sitting(fresh(), { la: 'q' });
  assert.equal(result.passed, true);
});

test('E3b c6: RESUME = ZERO NEW CALLS: a second sitting over the same folder replays every stage with the recorded pairs; removing the records (a known-bad input) makes it pay again', async () => {
  const dir = fresh();
  const first = await sitting(dir);
  assert.ok(first.real.includes('panel-1-la'), 'fixture: the first sitting really called');
  const snap = () => Object.fromEntries(readdirSync(dir).filter(f => !f.endsWith('.tmp')).sort().map(f => [f, readFileSync(join(dir, f), 'utf8')]));
  const before = snap();
  const second = await sitting(dir);
  assert.deepEqual(second.real, [], 'zero new calls on a resume');
  assert.deepEqual(snap(), before, 'every stage file and every recorded pair byte-identical');
  assert.equal(existsSync(join(dir, 'superseded')), false);
  assert.equal(second.result.passed, true);
  // known-bad input on the NEW code: the same folder with its records removed resumes with fresh pairs, the prompts differ, the stages are paid again
  const gone = mkdtempSync(join(tmpdir(), 'e3b-gone-'));
  for (const f of live(dir)) renameSync(join(dir, f), join(gone, f));
  const third = await sitting(dir);
  assert.ok(third.real.includes('panel-1-la') && third.real.includes('panel-1-lb'), 'without its records a resume re-pays');
  assert.ok(existsSync(join(dir, 'superseded')), 'the old stages were set aside, not overwritten');
});

test('E3b c7: the order trap: after a re-run through path B (prompt changed, draft the same) a SECOND resume is zero new calls, the pair is reused, and the rebuilt prompt holds nothing of the archived reply', async () => {
  const dir = fresh();
  await sitting(dir);
  const pairBefore = rec(dir, 'panel-1-la');
  const oldReply = readFileSync(join(dir, 'panel-1-la.md'), 'utf8');
  const second = await sitting(dir, { criteria: ['The plan states its assumptions.', 'The plan names an owner.'] });
  assert.ok(second.real.includes('panel-1-la'), 'the criteria changed, so the prompt hash changed and the stage re-ran');
  assert.deepEqual(rec(dir, 'panel-1-la'), pairBefore, 'B: the pair is keyed to (label, draft_id), so it is reused');
  assert.deepEqual(aside(dir), [], 'no record was moved aside');
  assert.ok(existsSync(join(dir, 'superseded', 'panel-1-la.1.md')), 'the old stage text was archived by the existing cache');
  const prompt = second.prompts.get('panel-1-la');
  assert.equal(prompt.includes(oldReply), false, 'nothing of the archived reply is in the rebuilt prompt');
  assert.equal(prompt.split(pairBefore.review_id).length - 1, 1, 'the pair appears once, in the appended section');
  const third = await sitting(dir, { criteria: ['The plan states its assumptions.', 'The plan names an owner.'] });
  assert.deepEqual(third.real, [], 'resume again: zero new calls');
});

test('E3b c8: path A, the shown draft changed: the old pair is MOVED ASIDE (superseded/<label>.<n>.envelope.json), never deleted, and a fresh pair is live', async () => {
  const dir = fresh();
  const old = { review_id: '111111111111', draft_id: '222222222222', label: 'panel-1-la' };
  writeFileSync(join(dir, 'panel-1-la.envelope.json'), JSON.stringify(old));
  const { result } = await sitting(dir);
  assert.equal(result.passed, true);
  assert.deepEqual(aside(dir), ['panel-1-la.1.envelope.json']);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'superseded', 'panel-1-la.1.envelope.json'), 'utf8')), old);
  assert.notEqual(rec(dir, 'panel-1-la').review_id, old.review_id);
});

test('E3b c9: path F, a corrupt record is moved aside too (never deleted), and a fresh pair is drawn', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'panel-1-la.envelope.json'), '{not json');
  await sitting(dir);
  assert.equal(readFileSync(join(dir, 'superseded', 'panel-1-la.1.envelope.json'), 'utf8'), '{not json');
  assert.match(rec(dir, 'panel-1-la').review_id, /^[0-9a-f]{12}$/);
});

test('E3b c10: path C, a crash between the write and the reply: the recorded pair is reused (nothing overwritten, no second draw) and the stage runs once', async () => {
  const dir = fresh();
  await sitting(dir);
  const pair = rec(dir, 'panel-1-la');
  for (const ext of ['md', 'usage.json']) renameSync(join(dir, `panel-1-la.${ext}`), join(dir, `lost-la.${ext}`)); // the process died after the record, before the reply landed
  const second = await sitting(dir);
  assert.deepEqual(second.real.filter(l => l.startsWith('panel-')), ['panel-1-la']);
  assert.deepEqual(rec(dir, 'panel-1-la'), pair);
  assert.deepEqual(aside(dir), []);
});

test('E3b c11: the bigger-cap RETRY has its OWN pair (C2): a retry reply echoing the first attempt\'s pair is not read, and the cut-off first reply stands', async () => {
  const ok = fresh();
  const good = await sitting(ok, { la: 'ce', maxTokens: 800 });
  assert.equal(good.result.passed, true, 'the retry echoes ITS pair and is read');
  assert.notEqual(rec(ok, 'panel-1-la').review_id, rec(ok, 'panel-1-la-retry').review_id);
  const bad = fresh();
  const stale = await sitting(bad, { la: 'cp', maxTokens: 800 });
  assert.equal(stale.result.passed, false, 'the first attempt\'s pair on the retry reply is unreadable; the cut-off first sign-off is not a pass');
  assert.equal(rows(stale.result).find(v => v.lab === 'la').verdict, 'unheard');
});

test('E3b c12: an EXTERNAL critic: the pair is recorded before the pause and shown in the prompt; the pasted reply is read with the recorded pair on the resume', async () => {
  const dir = fresh();
  let pause;
  try { await sitting(dir, { laProvider: 'external' }); } catch (e) { pause = e; }
  assert.ok(pause instanceof ExternalPause, 'the run pauses at the external critic');
  const r = rec(dir, pause.label);
  assert.ok(pause.user.endsWith(H.verdictEnvelopeSection({ review_id: r.review_id, draft_id: r.draft_id })));
  writeFileSync(join(dir, `${pause.label}.prompt.json`), JSON.stringify({ provider: 'external', promptHash: promptHashOf(pause.system, pause.user) })); // the shape cli.js:3474 writes when the run pauses (plus its inputsFingerprint, absent here), so the pasted reply replays only for THIS prompt
  writeFileSync(join(dir, `${pause.label}.md`), JSON.stringify({ review_id: r.review_id, draft_id: r.draft_id, meets: true, criteria: [], failures: [], verdict_line: 'ok' }));
  const second = await sitting(dir, { laProvider: 'external' });
  assert.equal(second.result.passed, true);
  const bare = fresh();
  let again;
  try { await sitting(bare, { laProvider: 'external' }); } catch (e) { again = e; }
  writeFileSync(join(bare, `${again.label}.prompt.json`), JSON.stringify({ promptHash: promptHashOf(again.system, again.user) }));
  writeFileSync(join(bare, `${again.label}.md`), JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'ok' }));
  let paused;
  try { await sitting(bare, { laProvider: 'external' }); } catch (e) { paused = e; }
  assert.ok(paused instanceof ExternalPause, 'an external reply without the ids is unreadable, so the run pauses AGAIN at the re-ask');
  assert.equal(paused.label, 'panel-1-la-reask1');
  assert.ok(paused.user.includes(H.criticEnvelopeReaskNote({ kind: 'missing' })), 'the re-ask says what was missing');
  assert.notEqual(rec(bare, 'panel-1-la').review_id, rec(bare, 'panel-1-la-reask1').review_id);
});

test('E3b c13: a run recorded as using the envelope whose sentence is missing fails loud (never silently unprotected)', async () => {
  await assert.rejects(sitting(fresh(), { words: false }), /verdictEnvelopeSection/);
});

test('E3b c14: the run.json flag: a fresh run without the sentence records no flag; a run recorded as using it refuses a resume without the sentence', () => {
  const work = mkdtempSync(join(tmpdir(), 'e3b-cli-'));
  writeFileSync(join(work, 'task.md'), 'Write a one-paragraph plan for a bake sale.\n');
  // CHANGED ACCEPTED TEST (decider-readiness apply patch, 24 Okt 2026; C&C ruling (b)). OLD: a fresh run in the shipped state (words held) recorded no flag, and a run recorded as using the envelope refused a resume without the sentence. NEW: a fresh run with the words RECORDED records verdict_envelope: true in run.json and report.json; the resume refusal is shown in a child with the explicit off preload (test/helpers/held-off-preload.js), the only way left to resume "without the sentence". WHY: roles.js records verdictEnvelopeSection.
  const run = (...a) => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...a], { cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH } });
  const runOff = (...a) => spawnSync(process.execPath, ['--import', join(root, 'test', 'helpers', 'held-off-preload.js'), join(root, 'src', 'cli.js'), ...a], { cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH } });
  const first = run('--task', 'task.md', '--chain', 'mock-open');
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const runDir = join(work, 'runs', readdirSync(join(work, 'runs'))[0]);
  assert.equal(JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).verdict_envelope, true, 'with the sentence recorded, a fresh run records the flag');
  assert.equal(JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')).verdict_envelope, true);
  const meta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...meta, verdict_envelope: true }));
  mkdirSync(join(work, 'aside')); renameSync(join(runDir, 'report.json'), join(work, 'aside', 'report.json'));
  const resumed = runOff('--resume', runDir);
  assert.notEqual(resumed.status, 0);
  assert.match(resumed.stdout + resumed.stderr, /verdictEnvelopeSection/);
});

test('E3b c15: report.json carries verdict_envelope: true only for a run that used it, and the new fields validate against schemas/report-v1.json', async () => {
  const dir = fresh();
  const { result, config } = await sitting(dir, { la: 'mm' });
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addFormat('date-time', true);
  const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')));
  const used = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-e3b', chain: 'fixture-e3b', task: 't.md', result, config, verdictEnvelope: true })));
  assert.equal(used.verdict_envelope, true);
  assert.equal(used.panelVerdicts.find(v => v.lab === 'la').envelope, 'missing');
  assert.ok(validate(used), JSON.stringify(validate.errors, null, 2));
  const plain = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-e3b', chain: 'fixture-e3b', task: 't.md', result, config })));
  assert.equal('verdict_envelope' in plain, false);
});

test('E3b c16: FIRST mode (round-robin, no re-ask): the envelope is issued at its call site and read; a seat that forgets the ids ends the run without a verdict, recorded "missing"', async () => {
  const dir = fresh();
  const ok = await sitting(dir, { la: 'e', first: true, maxRounds: 2 });
  assert.equal(ok.result.passed, true);
  const r = rec(dir, 'critique-1');
  assert.ok(ok.prompts.get('critique-1').endsWith(H.verdictEnvelopeSection({ review_id: r.review_id, draft_id: r.draft_id })));
  const bare = fresh();
  const lost = await sitting(bare, { la: 'm', first: true, maxRounds: 2 });
  assert.equal(lost.result.passed, false, 'first mode has no re-ask: an unreadable reply stops the run');
  const row = rows(lost.result)[0];
  assert.equal(row.verdict, 'unheard');
  assert.equal(row.envelope, 'missing');
});

test('E3b c17: an EXTERNAL seat\'s re-ask after a missing-ids reply keeps the external instruction as well as the envelope note', async () => {
  const bare = fresh();
  let again;
  try { await sitting(bare, { laProvider: 'external' }); } catch (e) { again = e; }
  writeFileSync(join(bare, `${again.label}.prompt.json`), JSON.stringify({ provider: 'external', promptHash: promptHashOf(again.system, again.user) }));
  writeFileSync(join(bare, `${again.label}.md`), JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'ok' }));
  let paused;
  try { await sitting(bare, { laProvider: 'external' }); } catch (e) { paused = e; }
  assert.ok(paused.user.includes(H.criticEnvelopeReaskNote({ kind: 'missing' })));
  assert.ok(paused.user.includes('# Your previous reply could not be read'), 'the external seat is still told how to answer');
});

test('E3b c18: the bigger-cap retry OF A RE-ASK keeps the envelope note and has its own pair', async () => {
  const dir = fresh();
  const { prompts } = await sitting(dir, { la: 'mce', maxTokens: 800 });
  assert.ok(prompts.get('panel-1-la-reask1').includes(H.criticEnvelopeReaskNote({ kind: 'missing' })));
  assert.ok(prompts.get('panel-1-la-reask1-retry').includes(H.criticEnvelopeReaskNote({ kind: 'missing' })), 'the retry of the re-ask says what was missing too');
  assert.notEqual(rec(dir, 'panel-1-la-reask1').review_id, rec(dir, 'panel-1-la-reask1-retry').review_id);
});

test('E3b c19: a blocking question: the seat\'s second ask (-answered) has its OWN pair, and the proposer\'s -question call gets no envelope (it is not a critic call)', async () => {
  const dir = fresh();
  const { result, prompts } = await sitting(dir, { la: 'be', freedoms: { blocking_questions: true } });
  assert.equal(result.passed, true);
  assert.ok(prompts.has('panel-1-la-question'), 'fixture: the proposer was asked');
  assert.notEqual(rec(dir, 'panel-1-la').review_id, rec(dir, 'panel-1-la-answered').review_id);
  assert.equal(existsSync(join(dir, 'panel-1-la-question.envelope.json')), false);
  assert.equal(prompts.get('panel-1-la-question').includes('Reply identity'), false);
  assert.ok(prompts.get('panel-1-la-answered').endsWith(H.verdictEnvelopeSection(rec(dir, 'panel-1-la-answered'))));
});

// ---- E3b unit three: the diagnosis (gate note section 3, C&C's classification order: provider error -> truncation -> malformed JSON -> missing ids -> wrong ids)
test('E3b d1: a TRUNCATED reply under a live envelope records the truncation reason, never envelope "missing" (the C&C red)', async () => {
  const { result } = await sitting(fresh(), { la: 't', maxTokens: 800, diagnosis: true });
  const row = rows(result).find(v => v.lab === 'la');
  assert.equal(row.verdict, 'unheard');
  assert.equal(row.reason_code, 'REPLY_TRUNCATED');
  assert.equal(row.envelope, undefined, 'a cut-off reply keeps its own reason');
});

test('E3b d2: a well-formed reply that only lacks the ids is NOT called "malformed JSON" in the log once the held sentence exists; without it the text is the old one (PIN)', async () => {
  const withSentence = await sitting(fresh(), { la: 'mm', diagnosis: true });
  const line = withSentence.logs.find(l => l.includes('[COUNCIL-E004]') && l.includes('la/'));
  assert.ok(line.includes(H.criticEnvelopeUnreadableWhy({ kind: 'missing' })), line);
  assert.equal(line.includes('malformed JSON'), false);
  const without = await sitting(fresh(), { la: 'mm' });
  assert.ok(without.logs.find(l => l.includes('[COUNCIL-E004]') && l.includes('la/')).includes('malformed JSON'), 'PIN: no held sentence, the old text');
  const wrong = await sitting(fresh(), { la: 'ww', diagnosis: true });
  assert.ok(wrong.logs.find(l => l.includes('[COUNCIL-E004]') && l.includes('la/')).includes(H.criticEnvelopeUnreadableWhy({ kind: 'wrong_id' })));
});

test('E3b d3: prose with no JSON object is "malformed", never envelope "missing" (envelopeReason needs a complete parseable object)', async () => {
  const { result } = await sitting(fresh(), { laModel: 'mock-unreadable', diagnosis: true });
  const row = rows(result).find(v => v.lab === 'la');
  assert.equal(row.verdict, 'unheard');
  assert.equal(row.envelope, undefined);
});

test('E3b d4: FIRST mode: the report\'s lastCritique (so BOARD.md) names the missing identity instead of "unparseable" once the held sentences exist; without them it is today\'s text (PIN)', async () => {
  const withSentence = await sitting(fresh(), { la: 'm', first: true, maxRounds: 2, diagnosis: true });
  const f = withSentence.result.lastCritique.failures[0];
  assert.equal(f.criterion, H.criticEnvelopeUnreadableLabel());
  assert.ok(f.problem.includes(H.criticEnvelopeUnreadableWhy({ kind: 'missing' })));
  assert.equal(rows(withSentence.result)[0].envelope, 'missing');
  const without = await sitting(fresh(), { la: 'm', first: true, maxRounds: 2 });
  assert.equal(without.result.lastCritique.failures[0].criterion, '(critic reply unparseable)', 'PIN');
});
