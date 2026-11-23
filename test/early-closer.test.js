// 3 Nov 2026 (owner's pick "Auto + handler tool"; C&C's ruling: the narrow rule; src/chain.js KEY_DIRECTLY_AFTER): a verdict object closed before a key the seat still wrote is never an answer.
// B3 run 5, pass 24, Haiku 5.5: a stray `}` after the criteria array closed the verdict before its "failures" key; the span reader kept the first object and the failures list was lost without a word. With
// `meets: true` the same slip turns a reply that, well formed, is contradictory (and refused) into a recorded SIGN-OFF. Every shape below is synthetic, built from that reply's structure (run output never
// enters the repo).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChain, exchangeRound, parseJson, isNearJsonReply, setBudget, setCache, setRepairPauses, ExternalPause, pendingPauses } from '../src/chain.js';
import { makeStageCache, writeSideStage } from '../src/stage-cache.js';

const E = { review_id: 'aaaaaaaaaaaa', draft_id: 'bbbbbbbbbbbb' };
const ROWS = [{ criterion: 'It exists.', verdict: 'MET', evidence: 'The draft is there.' }, { criterion: 'It states its assumptions.', verdict: 'MET', evidence: 'Section 2 lists them.' }];
const FAILURES = [{ criterion: 'It exists.', problem: 'The draft stops in the middle of a step.', fix: 'Finish the step.', severity: 6 }];
const head = meets => `{"review_id": "${E.review_id}", "draft_id": "${E.draft_id}", "meets": ${meets}, "criteria": ${JSON.stringify(ROWS)}`;
const tail = `"failures": ${JSON.stringify(FAILURES)}, "answers": [], "verdict_line": "Most criteria are met, but one is not."`;
// panel-24's shape: a `}` closes the object right after the criteria list, the rest follows outside it, and one `}` at the end matches nothing
const EARLY = meets => `${head(meets)}}, ${tail}}`;
const WELL_FORMED = meets => `${head(meets)}, ${tail}}`;
const FP = 'fingerprint-early-closer';
async function rejectionOf(p) { try { await p; } catch (e) { return e; } return null; }

test('D-0 premises: the well-formed sign-off variant is contradictory and refused; the well-formed objection reads with its failures (a failure here is a fixture to fix, not the feature)', () => {
  assert.equal(parseJson(WELL_FORMED(true), { verdict: true }), null);
  assert.equal(parseJson(WELL_FORMED(true), { verdict: true, expect: E }), null);
  assert.equal(parseJson(WELL_FORMED(false), { verdict: true, expect: E })?.failures?.length, 1);
});

test('D-1 the panel-24 shape is never a verdict on the guarded paths (verdict, envelope), with meets true or false, and it is near-JSON', () => {
  for (const meets of [true, false]) {
    assert.equal(parseJson(EARLY(meets), { verdict: true }), null, `meets ${meets}: the object closed before "failures" must not be read`);
    assert.equal(parseJson(EARLY(meets), { verdict: true, expect: E }), null, `meets ${meets}: not on the envelope path either`);
    assert.equal(isNearJsonReply(EARLY(meets)), true, `meets ${meets}: near-JSON, so a reader with the pause pauses`);
  }
});

test('D-2 a panel seat whose verdict closes early (mock-early-closer) pauses the run for a repair: no sign-off is recorded, the seat is not re-asked, the pause carries its reply', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'early-closer-panel-'));
  const config = { name: 'early-closer', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], seats: { critics: [{ provider: 'mock', model: 'mock-early-closer', lab: 'ec' }, { provider: 'mock', model: 'mock-critic-a', lab: 'ok' }] } };
  const real = [];
  setRepairPauses(true);
  try {
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const err = await rejectionOf(runChain({ request: 'Req.', config, draft: 'REVISED MOCK DELIVERABLE', log: () => {}, onStage: s => { if (!s.cached) real.push(s.label); writeSideStage(dir, s, { fingerprint: FP }); } }));
    assert.ok(err instanceof ExternalPause && err.repair, `the panel pauses for a repair (got ${err ? (err.stack || err) : 'a finished run'})`);
    assert.match(err.label, /^panel-1-/);
    assert.match(err.repair.original, /"criteria": \[\]\}, "failures": /, 'the pause carries the reply as the seat wrote it');
    assert.deepEqual(pendingPauses(err).map(p => p.label), [err.label], 'only that seat pauses');
    assert.equal(real.filter(l => l.startsWith(err.label)).length, 1, 'the seat was asked once: no re-ask');
  } finally { setCache(null); setRepairPauses(false); }
});

test('D-3 the tolerant path (a layer-exchange post): one object directly continued by a key reads null, is near-JSON, and the exchange pauses (ldebate)', async () => {
  const CUT_POSTS = '{"posts": [{"on": "O-00000000", "stance": "support", "text": "It holds."}]}, "new_objections": []';
  assert.equal(parseJson(CUT_POSTS), null, 'the object closed before "new_objections" is not read');
  assert.equal(isNearJsonReply(CUT_POSTS), true, 'and it is near-JSON');
  const dir = mkdtempSync(join(tmpdir(), 'early-closer-exch-'));
  const A = { provider: 'openrouter', model: 'openai/gpt-6.1-sol', maxTokens: 20000, lab: 'seat-a' };
  const B = { provider: 'openrouter', model: 'z-ai/glm-5.3', maxTokens: 20000, lab: 'seat-b' };
  const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-test-not-a-key';
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const user = (body.messages || []).filter(m => m.role === 'user').at(-1)?.content; const userText = typeof user === 'string' ? user : JSON.stringify(user);
    const shown = [...new Set([...userText.matchAll(/Objection (O-[0-9a-f]{8})/g)].map(m => m[1]))];
    const text = body.model === A.model ? CUT_POSTS : JSON.stringify({ posts: shown.map(id => ({ on: id, stance: 'support', text: 'It holds.' })), new_objections: [] });
    return { ok: true, json: async () => ({ model: body.model, choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20 } }) };
  };
  setRepairPauses(true);
  try {
    setCache(makeStageCache({ dir, fingerprint: FP })); setBudget(null);
    const judges = [A, B].map((seat, i) => ({ seat, key: seat.lab, failures: [{ criterion: `Criterion ${i + 1}`, problem: `Problem ${i + 1}: the plan does not say.` }] }));
    const err = await rejectionOf(exchangeRound({ judges, request: 'A bake sale.', criteria: ['It states its assumptions.'], draft: '# Plan\n\nBake a cake.', round: 1, record: s => { writeSideStage(dir, s, { fingerprint: FP }); return s; }, rounds: 1 }));
    assert.ok(err instanceof ExternalPause && err.repair, `the exchange pauses (${err && (err.stack || err)})`);
    assert.match(err.label, /^ldebate-1-/);
    assert.equal(err.repair.original, CUT_POSTS);
    assert.equal(readdirSync(dir).filter(f => /^ldebate-1-.*\.md$/.test(f)).length, 2, 'both judges posted and were recorded before the pause');
  } finally { globalThis.fetch = original; setCache(null); setRepairPauses(false); if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
});

test('D-4 pin (the narrow rule): a valid verdict followed by prose that holds a quoted word and a colon still reads', () => {
  const v = `{"meets": true, "criteria": ${JSON.stringify(ROWS)}, "failures": []}`;
  const withIds = `{"review_id": "${E.review_id}", "draft_id": "${E.draft_id}", "meets": true, "criteria": ${JSON.stringify(ROWS)}, "failures": []}`;
  for (const after of ['\n\nNote: the "failures": list is empty because nothing failed.', '\n\nI checked "criterion 2": it holds.']) {
    assert.equal(parseJson(v + after, { verdict: true })?.meets, true, `verdict path, prose ${JSON.stringify(after.slice(0, 20))}`);
    assert.equal(parseJson(v + after)?.meets, true, `tolerant path, prose ${JSON.stringify(after.slice(0, 20))}`);
    assert.equal(parseJson(withIds + after, { verdict: true, expect: E })?.meets, true, `envelope path, prose ${JSON.stringify(after.slice(0, 20))}`);
  }
});
