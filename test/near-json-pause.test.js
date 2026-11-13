// 2 Nov 2026 (owner, to C&C: "pause"; heading "HIS FOUR MORNING ANSWERS ..."): a panel reply that is almost JSON (it starts with a quoted key and still reads null after every repair) pauses the run for a repair instead of
// counting as an abstention. src/near-json.js (the acceptance check, the file move, the request text), src/stage-cache.js (the repair arrives; a resume before it), src/chain.js (isNearJsonReply, the pause in the panel
// read, the check in invoke), src/cli.js (writes the request: not driven here, its file effect is src/near-json.js setAsideOriginal, driven below). Fixtures are synthetic; run output never enters the repo. $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChain, exchangeRound, parseJson, isNearJsonReply, setBudget, setCache, setRepairPauses, ExternalPause, pendingPauses } from '../src/chain.js';
import { makeStageCache, writeSideStage } from '../src/stage-cache.js';
import { repairAcceptance, setAsideOriginal, repairMarkerOf, repairNeedsBody, finishMove } from '../src/near-json.js';
import { spendReport, capSpentOf } from '../src/spend.js';
import { setHeldForTest } from '../src/held-roles.js';
import { withHeldOff } from './helpers/held-off.js';
import * as VE from '../src/verdict-envelope.js';
import * as H from './held-prompts/held-083.js';
import { critic, chainOf } from './helpers/final-read-chain.js';

// A verdict whose criteria array is never closed: the `}` at the end arrives while a `[` is still open deeper, so the stray-closer repair leaves it alone (ambiguous), and nothing else repairs it.
const AMBIGUOUS = '{"meets": false, "criteria": [{"criterion": "C1", "verdict": "FAILED", "evidence": "no owner"}, "failures": [{"criterion": "C1", "problem": "no owner"}]}';
// What a person writes: the same words, the missing `]` put where it belongs.
const REPAIRED = '{"meets": false, "criteria": [{"criterion": "C1", "verdict": "FAILED", "evidence": "no owner"}], "failures": [{"criterion": "C1", "problem": "no owner"}]}';
const BARE_WORD = '{"meets": maybe, "criteria": [}';
const ALL_MET_BESIDE_FALSE = '{"meets": false, "criteria": [{"criterion": "C1", "verdict": "MET", "evidence": "x"}], "failures": []}';
const GOOD_VERDICT = '{"meets": true, "criteria": [{"criterion": "It exists.", "verdict": "MET", "evidence": "REVISED MOCK DELIVERABLE"}]}';
// The same shapes as AMBIGUOUS / REPAIRED, as a SIGN-OFF, so a round that reads the repaired reply needs no reviser.
const PANEL_NEAR = '{"meets": true, "criteria": [{"criterion": "It exists.", "verdict": "MET", "evidence": "REVISED MOCK DELIVERABLE"}, "failures": []}';
const NEVER_CLOSED = '{"meets": true, "criteria": [{"criterion": "It exists.", "verdict": "MET", "evidence": "REVISED MOCK DELIVERABLE"}';
const CUT_OFF_TAIL = '{"meets": true, "criteria": [{"criterion": "It exists.", "verdict": "MET", "evidence": "REVISED MOCK DELIVERABLE"}], "failures": []} then {"meets": false, "failures": [';
const PANEL_FIXED = '{"meets": true, "criteria": [{"criterion": "It exists.", "verdict": "MET", "evidence": "REVISED MOCK DELIVERABLE"}], "failures": []}';

test('NJ-0 premises: the fixtures read the way the tests below assume (a failure here is a fixture to fix, not the feature)', () => {
  assert.equal(parseJson(AMBIGUOUS, { verdict: true }), null, 'AMBIGUOUS reads null');
  assert.equal(parseJson(AMBIGUOUS), null, 'AMBIGUOUS reads null even the tolerant way');
  assert.notEqual(parseJson(REPAIRED), null, 'REPAIRED parses');
  assert.equal(parseJson(BARE_WORD), null);
  assert.notEqual(parseJson(ALL_MET_BESIDE_FALSE), null, 'the all-MET table parses tolerantly (a guard refuses it as a verdict)');
  assert.equal(parseJson(PANEL_NEAR, { verdict: true }), null, 'PANEL_NEAR reads null');
  assert.equal(parseJson(PANEL_NEAR), null);
  assert.notEqual(parseJson(PANEL_FIXED, { verdict: true }), null, 'PANEL_FIXED is a readable sign-off');
  assert.deepEqual(repairAcceptance(PANEL_NEAR, PANEL_FIXED), { ok: true });
  assert.notEqual(parseJson(GOOD_VERDICT, { verdict: true }), null, 'GOOD_VERDICT is a readable sign-off');
  // the exact predicate the pause uses (isNearJsonReply): the main case must pass it, the cut-off shapes must not (scanBraceSpans counts braces only, so an array left open is NOT "unclosed")
  assert.equal(isNearJsonReply(PANEL_NEAR), true, 'PANEL_NEAR is near-JSON by the predicate');
  assert.equal(isNearJsonReply(AMBIGUOUS), true, 'AMBIGUOUS is near-JSON by the predicate');
  assert.equal(isNearJsonReply(CUT_OFF_TAIL), false, 'a verdict cut off in its tail is not');
  assert.equal(isNearJsonReply(NEVER_CLOSED), false, 'a reply whose brace never closes is not');
});

test('NJ-1 isNearJsonReply: a reply that starts with a quoted key and reads null is near-JSON; prose, a refused-but-parsing reply and quoted examples are not', () => {
  assert.equal(isNearJsonReply(AMBIGUOUS), true);
  assert.equal(isNearJsonReply(BARE_WORD), true);
  assert.equal(isNearJsonReply('```json\n' + BARE_WORD + '\n```'), true, 'inside its first fence');
  assert.equal(isNearJsonReply('Here is my verdict:\n```json\n' + AMBIGUOUS + '\n```'), true, 'prose before a fence that holds the attempt');
  assert.equal(isNearJsonReply('I cannot decide this one {quick} and {slow}.'), false, 'prose with braces of its own');
  assert.equal(isNearJsonReply('My verdict is no. The draft says {"meets": true}, which is wrong.'), false, 'prose that quotes a JSON example');
  assert.equal(isNearJsonReply(ALL_MET_BESIDE_FALSE), false, 'parses; a guard refuses it as a verdict, so there is nothing to repair');
  assert.equal(isNearJsonReply(REPAIRED), false);
  assert.equal(isNearJsonReply(''), false);
  assert.equal(isNearJsonReply(null), false);
});

test('NJ-2 repairAcceptance: punctuation and white space may move, nothing else may', () => {
  assert.deepEqual(repairAcceptance(AMBIGUOUS, REPAIRED), { ok: true }, 'the missing bracket put where it belongs');
  assert.deepEqual(repairAcceptance(AMBIGUOUS, '```json\n' + REPAIRED + '\n```'), { ok: true }, 'a code fence is formatting');
  assert.deepEqual(repairAcceptance('```json\n' + AMBIGUOUS + '\n```', REPAIRED), { ok: true }, 'the original carried the fence');
  assert.deepEqual(repairAcceptance('{"a": "one\ntwo"}', '{"a": "one\\ntwo"}'), { ok: true }, 'a raw newline escaped is the same white space');
  assert.deepEqual(repairAcceptance('{"a": "say "hi" now"}', '{"a": "say \\"hi\\" now"}'), { ok: true }, 'quotes escaped');
  assert.deepEqual(repairAcceptance('{"a": "café"}', '{"a": "caf\\u00e9"}'), { ok: true }, 'a unicode escape is its character');
  assert.deepEqual(repairAcceptance('{"p": "C:\\dir"}', '{"p": "C:\\\\dir"}'), { ok: true }, 'a lone backslash the repair escapes: the backslash is JSON punctuation too');
  for (const [name, changed] of [
    ['a word changed', REPAIRED.replace('FAILED', 'MET')],
    ['a word added', REPAIRED.replace('no owner"}], "failures"', 'no owner at all"}], "failures"')],
    ['a word dropped', REPAIRED.replace('"evidence": "no owner"', '"evidence": ""')],
    ['words reordered', REPAIRED.replace('"C1", "verdict": "FAILED"', '"verdict": "FAILED", "C1"')],
    ['a digit changed', REPAIRED.replace('C1', 'C2')],
    ['the word json added', 'json ' + REPAIRED],
  ]) {
    const r = repairAcceptance(AMBIGUOUS, changed);
    assert.equal(r.ok, false, name);
    assert.match(r.why, /word for word/, name);
  }
  assert.equal(repairAcceptance(AMBIGUOUS, '').ok, false);
  assert.equal(repairAcceptance(AMBIGUOUS, '   \n').ok, false);
  assert.equal(repairAcceptance(AMBIGUOUS, undefined).ok, false);
});

test('NJ-2b the check admits moved punctuation by design: a bracket in a different place is accepted (the verdict guards read the result)', () => {
  const moved = '{"meets": false, "criteria": [{"criterion": "C1", "verdict": "FAILED", "evidence": "no owner"}, "failures": [{"criterion": "C1", "problem": "no owner"}]]}';
  assert.deepEqual(repairAcceptance(AMBIGUOUS, moved), { ok: true });
});

// ---- the files --------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const FP = 'fingerprint-1';
function runDirWithPaidReply(label, text, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'near-json-'));
  writeFileSync(join(dir, `${label}.usage.json`), JSON.stringify({ provider: 'openrouter', model: 'vendor/model', usage: { input: 100, output: 50 }, usd: 0.5, ms: 10, inputsFingerprint: FP, promptHash: 'hash-1', ...extra }));
  writeFileSync(join(dir, `${label}.md`), text);
  return dir;
}

test('NJ-3 the pause on disk: only the paid reply\'s TEXT moves, into originals/; its usage record stays at its label; the marker is written; no other .md is left beside the stages; a second pause moves nothing', () => {
  const label = 'panel-1-a';
  const dir = runDirWithPaidReply(label, AMBIGUOUS);
  const { keptAs } = setAsideOriginal({ runDir: dir, label, promptHash: 'hash-1', fingerprint: FP });
  assert.equal(keptAs, 'originals/panel-1-a.1.md');
  assert.equal(readFileSync(join(dir, keptAs), 'utf8'), AMBIGUOUS, 'the original, whole');
  assert.equal(JSON.parse(readFileSync(join(dir, `${label}.usage.json`), 'utf8')).usd, 0.5, 'the payment stays at its label, where every spend reader counts it once (3 Nov 2026: no superseded[] trace)');
  assert.equal(existsSync(join(dir, `${label}.md`)), false);
  assert.equal(existsSync(join(dir, 'superseded')), false, 'nothing goes to superseded/');
  const marker = JSON.parse(readFileSync(join(dir, `${label}.repair.json`), 'utf8'));
  assert.deepEqual(marker, { repairOf: 'originals/panel-1-a.1.md', promptHash: 'hash-1', inputsFingerprint: FP, kind: 'near_json' }, 'the marker is its own file: no archive moves it');
  assert.equal(existsSync(join(dir, `${label}.prompt.json`)), false);
  assert.deepEqual(readdirSync(dir).filter(f => f.endsWith('.md')), [], 'no original beside the live stages: resume-brief, shape-rounds and verdict-stats read every *.md there as a stage');
  const before = readdirSync(join(dir, 'originals')).sort();
  setAsideOriginal({ runDir: dir, label, promptHash: 'hash-1', fingerprint: FP });
  assert.deepEqual(readdirSync(join(dir, 'originals')).sort(), before, 'a second pause (a resume before the repair) moves nothing');
});

test('NJ-4 the cache: awaiting a repair is not an orphan (nothing is archived or re-run); an accepted repair is replayed; a refused one is set aside with its reason and the request stays', () => {
  const label = 'panel-1-a';
  const dir = runDirWithPaidReply(label, AMBIGUOUS);
  setAsideOriginal({ runDir: dir, label, promptHash: 'hash-1', fingerprint: FP });
  const cache = makeStageCache({ dir, fingerprint: FP });
  const originalsBefore = readdirSync(join(dir, 'originals')).sort();
  assert.equal(cache.get(label), null);
  const waiting = cache.awaitingRepair(label);
  assert.deepEqual({ original: waiting.original, refusal: waiting.refusal, kind: waiting.kind }, { original: AMBIGUOUS, refusal: null, kind: 'near_json' });
  assert.equal(waiting.paid?.usd, 0.5, 'the paid record is handed back, for invoke() to count once');
  assert.equal(existsSync(join(dir, `${label}.usage.json`)), true, 'and it stays at its label');
  assert.deepEqual(readdirSync(join(dir, 'originals')).sort(), originalsBefore, 'nothing else moved');
  assert.equal(existsSync(join(dir, 'superseded')), false, 'the cache getter archived nothing (the orphan path did not fire)');
  assert.equal(existsSync(join(dir, 'WARNINGS.md')), false);

  // a refused repair: a word changed
  writeFileSync(join(dir, `${label}.md`), REPAIRED.replace('FAILED', 'MET'));
  assert.equal(cache.get(label), null, 'refused: nothing is replayed');
  const awaiting = cache.awaitingRepair(label);
  assert.equal(awaiting.original, AMBIGUOUS, 'the original is still THE original');
  assert.match(awaiting.refusal, /word for word/);
  assert.equal(readFileSync(join(dir, 'originals/panel-1-a.1.refused-1.md'), 'utf8'), REPAIRED.replace('FAILED', 'MET'), 'the refused repair is kept in originals/, numbered, not deleted');
  assert.equal(repairMarkerOf(dir, label).repairOf, 'originals/panel-1-a.1.md');
  assert.match(repairNeedsBody({ label, original: awaiting.original, refusal: awaiting.refusal }), /The last repair was not taken: .*word for word/s);

  // an accepted repair
  writeFileSync(join(dir, `${label}.md`), REPAIRED);
  const hit = cache.get(label);
  assert.equal(hit.text, REPAIRED);
  assert.equal(hit.promptHash, 'hash-1', 'the answer is held to the prompt of the paid call');
  assert.deepEqual({ provider: hit.provider, model: hit.model, usd: hit.usd }, { provider: 'openrouter', model: 'vendor/model', usd: 0.5 }, 'an ordinary stage: the paid call, under its real provider (no external, no usd 0)');
  assert.equal(cache.awaitingRepair(label), null, 'answered');
  assert.equal(existsSync(join(dir, `${label}.repair.json`)), false, 'the marker left the top level');
  assert.equal(JSON.parse(readFileSync(join(dir, 'originals/panel-1-a.1.repair.json'), 'utf8')).accepted, true, 'it is kept, accepted, beside the original');
  assert.equal(cache.repaired(label, 'hash-1'), true, 'the stage is known as repaired for this prompt');
  assert.equal(cache.repaired(label, 'hash-2'), false, 'not for another prompt');
});

// ---- the panel round --------------------------------------------------------------------------------------------------------------------------------------------------------------------
const stubFetch = handler => { const original = globalThis.fetch; globalThis.fetch = handler; return () => { globalThis.fetch = original; }; };
const A = { provider: 'openrouter', model: 'openai/gpt-6.1-sol', maxTokens: 20000, lab: 'seat-a' };
const B = { provider: 'openrouter', model: 'z-ai/glm-5.3', maxTokens: 20000, lab: 'seat-b' };
async function withStub(replyFor, fn, { pauses = true, finish = () => 'stop' } = {}) {
  const had = process.env.OPENROUTER_API_KEY;
  setRepairPauses(pauses);
  process.env.OPENROUTER_API_KEY = 'sk-or-test-not-a-key';
  const calls = [];
  const restore = stubFetch(async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.model);
    return { ok: true, json: async () => ({ model: body.model, choices: [{ message: { content: replyFor(body.model) }, finish_reason: finish(body.model) }], usage: { prompt_tokens: 30, completion_tokens: 20 } }) };
  });
  try { return await fn(calls); } finally { restore(); setCache(null); setBudget(null); setRepairPauses(false); if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
}
const config = (...critics) => ({ name: 'near-json', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], seats: { critics } });
const runPanel = (cfg, onStage) => runChain({ request: 'Req.', config: cfg, draft: 'REVISED MOCK DELIVERABLE', log: () => {}, onStage });
async function rejectionOf(p) { try { await p; } catch (e) { return e; } return null; }

test('NJ-5 a panel round: the seat with an almost-JSON reply pauses the run AFTER the other seat finished and was recorded; the pause carries the original; nothing else pauses', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'near-json-round-'));
  await withStub(model => (model === A.model ? PANEL_NEAR : GOOD_VERDICT), async calls => {
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const err = await rejectionOf(runPanel(config(A, B), s => writeSideStage(dir, s, { fingerprint: FP })));
    assert.ok(err instanceof ExternalPause, `expected a pause, got ${err && (err.stack || err)}`);
    assert.ok(err.repair, 'it is a request to repair, not an external seat');
    assert.equal(err.repair.original, PANEL_NEAR);
    assert.match(err.label, /^panel-1-/);
    assert.deepEqual(pendingPauses(err).map(p => p.label), [err.label], 'only the near-JSON seat pauses');
    assert.deepEqual([...calls].sort(), [A.model, B.model].sort(), 'both seats were asked before the pause was thrown');
    // C-004: the other seat's paid reply is on disk before the process would exit 3
    const stages = readdirSync(dir).filter(f => /^panel-1-.*\.md$/.test(f)).map(f => f.slice(0, -3));
    const other = stages.filter(l => l !== err.label);
    assert.equal(other.length, 1, `the other seat's stage is on disk (${stages})`);
    assert.equal(existsSync(join(dir, `${other[0]}.usage.json`)), true, 'with its payment record');
    assert.equal(readFileSync(join(dir, `${err.label}.md`), 'utf8'), PANEL_NEAR, 'the paid reply was written before the pause');
  });
});

test('NJ-6 resume: before the repair it pauses again without calling the model; an accepted repair is read and the round goes on; a refused one pauses again with the reason', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'near-json-resume-'));
  await withStub(model => (model === A.model ? PANEL_NEAR : GOOD_VERDICT), async calls => {
    const onStage = s => writeSideStage(dir, s, { fingerprint: FP });
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const first = await rejectionOf(runPanel(config(A, B), onStage));
    assert.ok(first instanceof ExternalPause && first.repair);
    setAsideOriginal({ runDir: dir, label: first.label, promptHash: first.promptHash, fingerprint: FP });   // what the CLI does at the pause
    const askedA = () => calls.filter(m => m === A.model).length;
    assert.equal(askedA(), 1);

    // resume before anyone repaired it
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const again = await rejectionOf(runPanel(config(A, B), onStage));
    assert.ok(again instanceof ExternalPause && again.repair, 'pauses again');
    assert.equal(again.repair.original, PANEL_NEAR, 'with the original, read back from originals/');
    assert.equal(askedA(), 1, 'the paid stage is not paid for a second time');

    // a repair that changed a word
    writeFileSync(join(dir, `${first.label}.md`), PANEL_FIXED.replace('"MET"', '"FAILED"'));
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const refused = await rejectionOf(runPanel(config(A, B), onStage));
    assert.ok(refused instanceof ExternalPause && refused.repair);
    assert.match(refused.repair.refusal, /word for word/);
    assert.equal(askedA(), 1);

    // a good repair
    writeFileSync(join(dir, `${first.label}.md`), PANEL_FIXED);
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const done = await rejectionOf(runPanel(config(A, B), onStage));
    assert.equal(done instanceof ExternalPause, false, `the round goes on after the repair (${done && (done.stack || done)})`);
    assert.equal(askedA(), 1, 'still one call for the seat: the repaired reply was replayed from disk');
  });
});

test('NJ-7 what stays an abstention: prose with braces, a reply that parses but is refused by a guard, and an external seat\'s own text never pause', async () => {
  for (const reply of ['I cannot decide this one {quick} and {slow}.', ALL_MET_BESIDE_FALSE]) {
    await withStub(model => (model === A.model ? reply : GOOD_VERDICT), async () => {
      setCache(null);
      const err = await rejectionOf(runPanel(config(A, B)));
      assert.equal(err instanceof ExternalPause, false, `no pause for: ${reply.slice(0, 40)} (${err && (err.stack || err)})`);
    });
  }
});

test('NJ-8 a run that cannot be resumed in its own folder (--rematch, --replay, a direct runChain caller: the flag is off) keeps the old abstention for a near-JSON reply', async () => {
  await withStub(model => (model === A.model ? PANEL_NEAR : GOOD_VERDICT), async () => {
    setCache(null);
    const err = await rejectionOf(runPanel(config(A, B)));
    assert.equal(err instanceof ExternalPause, false, `no pause with the flag off (${err && (err.stack || err)})`);
  }, { pauses: false });
});

test('NJ-9 the request names the reply format: the seat\'s system prompt is in it, the long user prompt is not', () => {
  const body = repairNeedsBody({ label: 'panel-1-a', askedFor: 'vendor/model', original: AMBIGUOUS, system: 'SYSTEM TEXT: reply with one JSON object', how: 'HOW TO SAVE\n\n' });
  assert.match(body, /HOW TO SAVE/);
  assert.match(body, /Answer this request BEFORE you add or change a ruling, a criterion or the draft/, 'the trap is named: answer the repair first, rulings after the resume');
  assert.match(body, /## The original reply\n\n\{"meets": false/);
  assert.match(body, /## The reply format the seat was given[^\n]*\n\nSYSTEM TEXT: reply with one JSON object/);
  assert.doesNotMatch(body, /^## User prompt/im, 'the long user prompt (the draft) is not copied into the request');
  assert.doesNotMatch(repairNeedsBody({ label: 'x', original: AMBIGUOUS }), /The reply format the seat was given/, 'no system prompt, no section');
});

// ---- C&C's ruling of 2 Nov 2026: the carve-out, the money, the two closes, the three more readers -----------------------------------------------------------------------------------------

test('NJ-10 a reply cut off at the cap (stop "length") or whose brace never closes pauses NOTHING: it keeps the bigger-cap re-ask path / the abstention', async () => {
  // stop "length": a near-JSON text that the provider cut off. Two calls for the seat (the first and the bigger-cap re-ask), no pause.
  const cut = mkdtempSync(join(tmpdir(), 'near-json-cut-'));
  await withStub(model => (model === A.model ? PANEL_NEAR : GOOD_VERDICT), async calls => {
    setCache(makeStageCache({ dir: cut, fingerprint: FP }));
    const err = await rejectionOf(runPanel(config(A, B), s => writeSideStage(cut, s, { fingerprint: FP })));
    assert.equal(err instanceof ExternalPause, false, `a cut-off verdict pauses nothing (${err && (err.stack || err)})`);
    assert.ok(calls.filter(m => m === A.model).length >= 2, 'at least the first call and the bigger-cap re-ask (the round then re-asks the unheard seat as before)');
  }, { finish: model => (model === A.model ? 'length' : 'stop') });
  // a normal stop but the last brace never closes: not near-JSON, so no pause
  await withStub(model => (model === A.model ? NEVER_CLOSED : GOOD_VERDICT), async () => {
    setCache(null);
    const err = await rejectionOf(runPanel(config(A, B)));
    assert.equal(err instanceof ExternalPause, false, `an unclosed brace pauses nothing (${err && (err.stack || err)})`);
  });
});

function spendOf(runsDir) { return { total: spendReport(runsDir, { days: 3650, now: Date.parse('2026-11-02T12:00:00Z') }).totalUsd }; }

test('NJ-11 money: the run\'s spend and the openrouter cap\'s figure are equal before the pause, in the half-done state, after the pause, after the repair and after it is taken (the payment is counted once, at its label)', () => {
  const runsDir = mkdtempSync(join(tmpdir(), 'near-json-runs-'));
  const dir = join(runsDir, '2026-11-02T10-00-00-000Z');
  mkdirSync(dir);
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'x' }));
  const label = 'panel-1-a';
  writeFileSync(join(dir, `${label}.usage.json`), JSON.stringify({ provider: 'openrouter', model: 'vendor/model', usage: { input: 100, output: 50 }, usd: 0.5, ms: 10, inputsFingerprint: FP, promptHash: 'hash-1', capName: 'openrouter' }));
  writeFileSync(join(dir, `${label}.md`), AMBIGUOUS);
  const before = { total: spendOf(runsDir).total, cap: capSpentOf(dir, 'openrouter') };
  assert.equal(before.total, 0.5, 'premise: the fixture is counted once');
  assert.equal(before.cap, 0.5, 'premise: and in the cap it names');
  // half-done: the marker is written, nothing has moved yet
  writeFileSync(join(dir, `${label}.repair.json`), JSON.stringify({ repairOf: `originals/${label}.1.md`, promptHash: 'hash-1', inputsFingerprint: FP, kind: 'near_json' }));
  assert.deepEqual({ total: spendOf(runsDir).total, cap: capSpentOf(dir, 'openrouter') }, before, 'half-done');
  // the move finishes: only the text moves
  assert.equal(finishMove(dir, label), true);
  assert.equal(existsSync(join(dir, `${label}.usage.json`)), true, 'the usage record stays at the top level');
  assert.deepEqual({ total: spendOf(runsDir).total, cap: capSpentOf(dir, 'openrouter') }, before, 'after the pause');
  // the repair arrives (the hand path: a file at the label); the paid record is untouched
  writeFileSync(join(dir, `${label}.md`), REPAIRED);
  assert.deepEqual({ total: spendOf(runsDir).total, cap: capSpentOf(dir, 'openrouter') }, before, 'after the repair');
  // it is taken (the cache reads it): the marker moves into originals/, the money does not move
  assert.equal(makeStageCache({ dir, fingerprint: FP }).get(label)?.text, REPAIRED);
  assert.deepEqual({ total: spendOf(runsDir).total, cap: capSpentOf(dir, 'openrouter') }, before, 'after it is taken');
  assert.equal(existsSync(join(dir, 'superseded')), false, 'no superseded/ record, so no superseded[] row in report.json');
});

test('NJ-12 the half-done state (marker written, reply still in place): the cache finishes the move, the seat is not called again, and the run pauses again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'near-json-half-'));
  await withStub(model => (model === A.model ? PANEL_NEAR : GOOD_VERDICT), async calls => {
    const onStage = s => writeSideStage(dir, s, { fingerprint: FP });
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const first = await rejectionOf(runPanel(config(A, B), onStage));
    assert.ok(first instanceof ExternalPause && first.repair);
    const askedA = () => calls.filter(m => m === A.model).length;
    // the crash: the marker is on disk, the move never happened
    writeFileSync(join(dir, `${first.label}.repair.json`), JSON.stringify({ repairOf: `originals/${first.label}.1.md`, promptHash: first.promptHash, inputsFingerprint: FP, kind: 'near_json' }));
    assert.equal(existsSync(join(dir, `${first.label}.md`)), true);
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const again = await rejectionOf(runPanel(config(A, B), onStage));
    assert.ok(again instanceof ExternalPause && again.repair, 'pauses again');
    assert.equal(again.repair.original, PANEL_NEAR);
    assert.equal(again.repair.refusal, null, 'a crash is never reported to the handler as a refused repair');
    assert.equal(askedA(), 1, 'no second call');
    assert.equal(existsSync(join(dir, `${first.label}.md`)), false, 'the move was finished');
    assert.equal(readFileSync(join(dir, `originals/${first.label}.1.md`), 'utf8'), PANEL_NEAR);
    assert.equal(existsSync(join(dir, `${first.label}.usage.json`)), true, 'the payment stays at its label');
  });
});

test('NJ-13 a pause whose prompt is no longer the one asked (the draft changed) does not trap the stage: the marker moves aside, the paid reply is kept as a stale answer WITH its payment, and the seat is called once, then pauses afresh', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'near-json-stale-'));
  await withStub(model => (model === A.model ? PANEL_NEAR : GOOD_VERDICT), async calls => {
    const onStage = s => writeSideStage(dir, s, { fingerprint: FP });
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const first = await rejectionOf(runPanel(config(A, B), onStage));
    setAsideOriginal({ runDir: dir, label: first.label, promptHash: first.promptHash, fingerprint: FP });
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const changed = await rejectionOf(runChain({ request: 'Req.', config: config(A, B), draft: 'A DIFFERENT DELIVERABLE', log: () => {}, onStage }));
    assert.ok(changed instanceof ExternalPause && changed.repair, 'a fresh pause for the new reply');
    assert.equal(calls.filter(m => m === A.model).length, 2, 'the seat was asked once more: the old request was moot');
    assert.equal(existsSync(join(dir, `originals/${first.label}.1.released.json`)), true, 'the old marker moved aside');
    assert.equal(readFileSync(join(dir, `superseded/${first.label}.1.md`), 'utf8'), PANEL_NEAR, 'the old reply is kept as a stale answer, untouched');
    assert.equal(existsSync(join(dir, `superseded/${first.label}.1.usage.json`)), true, 'with its payment, so the new call cannot overwrite it');
  });
});

test('NJ-14 the envelope path (the B3 case): the panel read WITH expect pauses, the repair is read on resume against the SAME pair, and the verdict is read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'near-json-env-'));
  setHeldForTest(withHeldOff({ verdictEnvelopeSection: H.verdictEnvelopeSection, criticEnvelopeReaskNote: H.criticEnvelopeReaskNote }));
  VE.setEnvelopeStore(VE.fileEnvelopeStore(dir)); VE.setEnvelopeInForce(true);
  const rowOf = (label) => JSON.parse(readFileSync(join(dir, `${label}.envelope.json`), 'utf8'));
  const withIds = (label, body) => `{"review_id": "${rowOf(label).review_id}", "draft_id": "${rowOf(label).draft_id}", ${body}`;
  const rows = { 'seat-a': '"meets": true, "criteria": [{"criterion": "It exists.", "verdict": "MET", "evidence": "REVISED MOCK DELIVERABLE"}, "failures": []}', 'seat-b': '"meets": true, "criteria": [{"criterion": "It exists.", "verdict": "MET", "evidence": "REVISED MOCK DELIVERABLE"}], "failures": []}' };
  const labFor = model => (model === A.model ? 'seat-a' : 'seat-b');
  try {
    await withStub(model => withIds(`panel-1-${labFor(model)}`, rows[labFor(model)]), async calls => {
      const onStage = s => writeSideStage(dir, s, { fingerprint: FP });
      const run = () => runChain({ request: 'Req.', runId: 'r-near-json', config: config(A, B), draft: 'REVISED MOCK DELIVERABLE', log: () => {}, onStage });
      setCache(makeStageCache({ dir, fingerprint: FP }));
      const first = await rejectionOf(run());
      assert.ok(first instanceof ExternalPause && first.repair, `the envelope read pauses (${first && (first.stack || first)})`);
      const pairBefore = readFileSync(join(dir, `${first.label}.envelope.json`), 'utf8');
      assert.match(first.repair.original, new RegExp(rowOf(first.label).review_id), 'the original carries the pair it was asked under');
      setAsideOriginal({ runDir: dir, label: first.label, promptHash: first.promptHash, fingerprint: FP });
      // the person's repair: the missing bracket, the same words, the same ids
      writeFileSync(join(dir, `${first.label}.md`), first.repair.original.replace('REVISED MOCK DELIVERABLE"}, "failures": []}', 'REVISED MOCK DELIVERABLE"}], "failures": []}'));
      setCache(makeStageCache({ dir, fingerprint: FP }));
      const result = await run();
      assert.equal(readFileSync(join(dir, `${first.label}.envelope.json`), 'utf8'), pairBefore, 'the pair the resume expects is the one in the file: byte for byte');
      assert.equal(existsSync(join(dir, 'superseded')) ? readdirSync(join(dir, 'superseded')).filter(f => f.endsWith('.envelope.json')).length : 0, 0, 'no envelope record was moved aside (a re-minted pair would supersede it)');
      const row = (result.panelVerdicts || []).find(v => v.lab === 'seat-a');
      assert.equal(row?.verdict, 'signed_off', `seat-a's repaired verdict is read, not unheard / wrong_id (${JSON.stringify(row)})`);
      assert.equal(row?.envelope, undefined);
      assert.equal(calls.filter(m => m === A.model).length, 1, 'one call for the seat in both sittings');
    });
  } finally { setHeldForTest(null); VE.setEnvelopeStore(null); VE.setEnvelopeInForce(false); }
});

test('NJ-15 the layer exchange: a judge whose post is almost JSON pauses the run (ldebate), after the other judge finished and was recorded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'near-json-exch-'));
  const NEAR_POSTS = '{"posts": [{"on": "O-00000000", "stance": "support", "text": "It holds."}, "new_objections": []}';
  assert.equal(parseJson(NEAR_POSTS), null, 'premise: NEAR_POSTS reads null');
  assert.equal(isNearJsonReply(NEAR_POSTS), true, 'premise: and is near-JSON');
  const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-test-not-a-key';
  setRepairPauses(true);
  const calls = [];
  const restore = stubFetch(async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push(body.model);
    const user = (body.messages || []).filter(m => m.role === 'user').at(-1)?.content; const userText = typeof user === 'string' ? user : JSON.stringify(user);
    const shown = [...new Set([...userText.matchAll(/Objection (O-[0-9a-f]{8})/g)].map(m => m[1]))];
    const text = body.model === A.model ? NEAR_POSTS : JSON.stringify({ posts: shown.map(id => ({ on: id, stance: 'support', text: 'It holds.' })), new_objections: [] });
    return { ok: true, json: async () => ({ model: body.model, choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20 } }) };
  });
  try {
    setCache(makeStageCache({ dir, fingerprint: FP })); setBudget(null);
    const judges = [A, B].map((seat, i) => ({ seat, key: seat.lab, failures: [{ criterion: `Criterion ${i + 1}`, problem: `Problem ${i + 1}: the plan does not say.` }] }));
    const err = await rejectionOf(exchangeRound({ judges, request: 'A bake sale.', criteria: ['It states its assumptions.'], draft: '# Plan\n\nBake a cake.', round: 1, record: s => { writeSideStage(dir, s, { fingerprint: FP }); return s; }, rounds: 1 }));
    assert.ok(err instanceof ExternalPause && err.repair, `the exchange pauses (${err && (err.stack || err)})`);
    assert.match(err.label, /^ldebate-1-/);
    assert.equal(err.repair.original, NEAR_POSTS);
    assert.deepEqual([...calls].sort(), [A.model, B.model].sort(), 'both judges posted before the pause was thrown');
    const stages = readdirSync(dir).filter(f => /^ldebate-1-.*\.md$/.test(f)).map(f => f.slice(0, -3));
    assert.equal(stages.length, 2, `both judges' stages are on disk (${stages})`);
  } finally { restore(); setCache(null); setRepairPauses(false); if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
});

test('NJ-16 the first-mode critic: an almost-JSON verdict pauses the run instead of stopping the round without a verdict', async () => {
  await withStub(model => PANEL_NEAR, async () => {
    setCache(null);
    const err = await rejectionOf(runChain({ request: 'Req.', config: { name: 'near-json-first', maxRounds: 1, criteria: ['It exists.'], seats: { critics: [A] } }, draft: 'REVISED MOCK DELIVERABLE', log: () => {} }));
    assert.ok(err instanceof ExternalPause && err.repair, `the first-mode critic pauses (${err && (err.stack || err)})`);
    assert.match(err.label, /^critique-1/);
    assert.equal(err.repair.original, PANEL_NEAR);
  });
});

// ---- the codebase's own pattern: a named mock model (src/providers.js `mock-near-json`), driven through the real stage cache -----------------------------------------------------------------------------
const MOCK_NEAR = '{"meets": true, "criteria": [], "failures": [ "verdict_line": "All criteria met."}';
const MOCK_FIXED = '{"meets": true, "criteria": [], "failures": [], "verdict_line": "All criteria met."}';

test('NJ-17 mock-near-json: its reply is near-JSON, reads null, and the repair keeps its words (premise for the two tests below)', () => {
  assert.equal(parseJson(MOCK_NEAR), null);
  assert.equal(isNearJsonReply(MOCK_NEAR), true);
  assert.deepEqual(repairAcceptance(MOCK_NEAR, MOCK_FIXED), { ok: true });
  assert.notEqual(parseJson(MOCK_FIXED, { verdict: true }), null);
});

test('NJ-18 the FINAL READ: a layer-3 seat whose closing statement is almost JSON pauses the run; the repair is read on resume, the closing statement is recorded, and the seat was called once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'near-json-final-'));
  const config = chainOf([critic('mock-unreadable', 'l1a', 1), critic('mock-unreadable', 'l1b', 1), critic('mock-critic-script-o-nj18-l2', 'l2a', 2), critic('mock-near-json', 'l3n', 3)], { final_read: { enabled: true } });
  const real = [];
  const onStage = s => { if (!s.cached) real.push(s.label); writeSideStage(dir, s, { fingerprint: FP }); };
  const sitting = () => runChain({ request: 'A mock task.', log: () => {}, runId: 'r-near-json-final', config, onStage });
  setRepairPauses(true);
  try {
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const first = await rejectionOf(sitting());
    assert.ok(first instanceof ExternalPause && first.repair, `the final read pauses (${first && (first.stack || first)})`);
    assert.match(first.label, /^final-read-/);
    assert.equal(first.repair.original, MOCK_NEAR);
    setAsideOriginal({ runDir: dir, label: first.label, promptHash: first.promptHash, fingerprint: FP });
    writeFileSync(join(dir, `${first.label}.md`), MOCK_FIXED);
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const result = await sitting();
    const seat = result.finalRead.seats.find(x => x.lab === 'l3n');
    assert.equal(seat.read, true, `the closing statement is recorded (${JSON.stringify(seat)})`);
    assert.equal(real.filter(l => l === first.label).length, 1, 'one call for the seat across both sittings');
  } finally { setCache(null); setRepairPauses(false); }
});

test('NJ-19 the FIRST-MODE critic with the mock model: pause, repair, resume, the verdict is read and the seat was called once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'near-json-first-'));
  const config = { name: 'near-json-first', maxRounds: 1, criteria: ['It exists.'], seats: { critics: [{ provider: 'mock', model: 'mock-near-json', lab: 'nj' }] } };
  const real = [];
  const onStage = s => { if (!s.cached) real.push(s.label); writeSideStage(dir, s, { fingerprint: FP }); };
  const sitting = () => runChain({ request: 'Req.', config, draft: 'REVISED MOCK DELIVERABLE', log: () => {}, onStage });
  setRepairPauses(true);
  try {
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const first = await rejectionOf(sitting());
    assert.ok(first instanceof ExternalPause && first.repair, `the first-mode critic pauses (${first && (first.stack || first)})`);
    assert.match(first.label, /^critique-1/);
    setAsideOriginal({ runDir: dir, label: first.label, promptHash: first.promptHash, fingerprint: FP });
    writeFileSync(join(dir, `${first.label}.md`), MOCK_FIXED);
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const result = await sitting();
    assert.equal(result.passed, true, 'the repaired sign-off is the verdict');
    assert.equal(real.filter(l => l === first.label).length, 1, 'one call for the seat across both sittings');
  } finally { setCache(null); setRepairPauses(false); }
});
