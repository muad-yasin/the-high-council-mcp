// 4 Nov 2026 (unit 8; owner's pick "Auto + handler tool": a one-letter id slip goes to the handler; C&C: exchange post ids only, the relation field stays B3's D18/RU-S2-04, ships in 0.8.4): an exchange post, or an
// answer to one, that names an objection id one character from exactly one id the judge was shown pauses for a repair (kind id_slip) instead of being dropped; the repair may only set those ids to the shown ones.
// The exchange is driven directly (exchangeRound) with stubbed OpenRouter seats and a fake key, as test/near-json-pause.test.js NJ-15 does; synthetic shapes (run output never enters the repo). The new functions are
// imported inside each test, so on a tree without them each test fails on its own. One assertion per test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exchangeRound, setBudget, setCache, setRepairPauses, ExternalPause } from '../src/chain.js';
import { makeStageCache, writeSideStage } from '../src/stage-cache.js';
import { setAsideOriginal } from '../src/near-json.js';

const FP = 'fingerprint-id-slip';
const A = { provider: 'openrouter', model: 'openai/gpt-6.1-sol', maxTokens: 20000, lab: 'seat-a' };
const B = { provider: 'openrouter', model: 'z-ai/glm-5.3', maxTokens: 20000, lab: 'seat-b' };
// One character off at the end (n = 1), or two (n = 2).
const flip = (id, n = 1) => id.slice(0, id.length - n) + [...id.slice(-n)].map(ch => (ch === '0' ? '1' : '0')).join('');

// One sitting of the exchange. `postA`: how seat A posts on the objection it is shown ('ok', 'slip' one character off, 'slip2' two off); `replyA`: how A answers its own objection ('ok' or 'slip').
// Seat B always supports what it is shown and keeps its own objection. -> { result: the return value or the thrown error, seen: { shownA, ownA } }.
async function sitting(dir, { postA = 'ok', replyA = 'ok', pauses = true } = {}) {
  const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-test-not-a-key';
  setRepairPauses(pauses);
  const seen = { shownA: [], ownA: [] };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const user = (body.messages || []).filter(m => m.role === 'user').at(-1)?.content; const text = typeof user === 'string' ? user : JSON.stringify(user);
    const own = [...new Set([...text.matchAll(/Your objection (O-[0-9a-f]{8})/g)].map(m => m[1]))];
    const shown = [...new Set([...text.matchAll(/^Objection (O-[0-9a-f]{8})/gm)].map(m => m[1]))];
    const isA = body.model === A.model;
    let reply;
    if (own.length) {
      if (isA) seen.ownA = own;
      reply = { replies: own.map(id => ({ id: isA && replyA === 'slip' ? flip(id) : id, action: 'keep', text: 'The posts do not change it.' })) };
    } else {
      if (isA) seen.shownA = shown;
      reply = { posts: shown.map(id => ({ on: isA && postA === 'slip' ? flip(id) : isA && postA === 'slip2' ? flip(id, 2) : id, stance: 'support', text: 'It holds.' })), new_objections: [] };
    }
    return { ok: true, json: async () => ({ model: body.model, choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20 } }) };
  };
  try {
    setCache(makeStageCache({ dir, fingerprint: FP })); setBudget(null);
    const judges = [A, B].map((seat, i) => ({ seat, key: seat.lab, failures: [{ criterion: `Criterion ${i + 1}`, problem: `Problem ${i + 1}: the plan does not say.` }] }));
    const result = await exchangeRound({ judges, request: 'A bake sale.', criteria: ['It states its assumptions.'], draft: '# Plan\n\nBake a cake.', round: 1, record: s => { writeSideStage(dir, s, { fingerprint: FP }); return s; }, rounds: 1 }).catch(e => e);
    return { result, seen };
  } finally { globalThis.fetch = original; setCache(null); setRepairPauses(false); if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
}
const pauseOf = r => (r instanceof ExternalPause && r.repair ? { pause: true, kind: r.repair.kind, slips: r.repair.slips } : { pause: false });
const tmp = name => mkdtempSync(join(tmpdir(), `id-slip-${name}-`));
// what the CLI does at a pause (src/cli.js)
const pauseOnDisk = (dir, err) => setAsideOriginal({ runDir: dir, label: err.label, promptHash: err.promptHash, fingerprint: FP, kind: err.repair.kind, slips: err.repair.slips, shown: err.repair.shown });
const postsOfAOn = (result, raisedBy) => (result?.rows || []).filter(r => r.raised_by === raisedBy).flatMap(r => r.posts).filter(p => p.by === A.lab);

test('I-1a an exchange post on an id one character from the id it was shown pauses for a repair (kind id_slip, the pair carried)', async () => {
  const { result, seen } = await sitting(tmp('a'), { postA: 'slip' });
  assert.deepEqual(pauseOf(result), { pause: true, kind: 'id_slip', slips: [{ from: flip(seen.shownA[0]), to: seen.shownA[0] }] });
});
test('I-1b a post on an id two characters off does not pause: it is dropped as before', async () => {
  const { result } = await sitting(tmp('b'), { postA: 'slip2' });
  assert.deepEqual({ paused: result instanceof ExternalPause, postsOfA: postsOfAOn(result, B.lab).length }, { paused: false, postsOfA: 0 });
});
test('I-1c an id one character from two shown ids is no slip', async () => {
  const N = await import('../src/near-json.js');
  assert.deepEqual(typeof N.idSlipsOf === 'function' ? N.idSlipsOf(['O-aaaaaaa0'], ['O-aaaaaaa1', 'O-aaaaaaa2']) : null, []);
});
test('I-1d an answer naming its own objection one character off pauses for a repair', async () => {
  const { result, seen } = await sitting(tmp('d'), { replyA: 'slip' });
  assert.deepEqual({ ...pauseOf(result), label: result?.label?.replace(/-seat-a$/, '') }, { pause: true, kind: 'id_slip', slips: [{ from: flip(seen.ownA[0]), to: seen.ownA[0] }], label: 'lreply-1' });
});
test('I-1e in a run that cannot pause, the slipped post is dropped as before', async () => {
  const { result } = await sitting(tmp('e'), { postA: 'slip', pauses: false });
  assert.deepEqual({ paused: result instanceof ExternalPause, postsOfA: postsOfAOn(result, B.lab).length }, { paused: false, postsOfA: 0 });
});
test('I-1f a slip whose shown id the reply already names is no slip (a repair would only make a second post)', async () => {
  const N = await import('../src/near-json.js');
  assert.deepEqual(typeof N.idSlipsOf === 'function' ? N.idSlipsOf(['O-aaaaaaa0', 'O-aaaaaaa1'], ['O-aaaaaaa1']) : null, []);
});
test('I-1g an id with a hidden character is no slip', async () => {
  const N = await import('../src/near-json.js');
  assert.deepEqual(typeof N.idSlipsOf === 'function' ? N.idSlipsOf(['O-aaaaaaa‮'], ['O-aaaaaaa1']) : null, []);
});
test('I-1h an id one character from exactly one shown id is a slip, paired with that id', async () => {
  const N = await import('../src/near-json.js');
  assert.deepEqual(typeof N.idSlipsOf === 'function' ? N.idSlipsOf(['O-aaaaaaa0', 'O-bbbbbbbb'], ['O-aaaaaaa1', 'O-cccccccc']) : null, [{ from: 'O-aaaaaaa0', to: 'O-aaaaaaa1' }]);
});

// The check (src/near-json.js idSlipAcceptance, through acceptanceFor), one case per test.
const ORIG = JSON.stringify({ posts: [{ on: 'O-aaaaaaa0', stance: 'support', text: 'It holds.' }, { on: 'O-bbbbbbbb', stance: 'contest', text: 'No.', quote: 'Bake a cake.' }], new_objections: [] });
const withPosts = posts => JSON.stringify({ ...JSON.parse(ORIG), posts });
const P = JSON.parse(ORIG).posts;
const MARKER = { kind: 'id_slip', slips: [{ from: 'O-aaaaaaa0', to: 'O-aaaaaaa1' }], shown: ['O-aaaaaaa1', 'O-bbbbbbbb'] };
const check = async (marker, repaired) => { const N = await import('../src/near-json.js'); return N.acceptanceFor(marker, ORIG, repaired); };
test('I-2a the check takes the pair the pause found', async () => {
  assert.deepEqual(await check(MARKER, withPosts([{ ...P[0], on: 'O-aaaaaaa1' }, P[1]])), { ok: true, changed: ['O-aaaaaaa1'] });
});
test('I-2b the check takes no change at all (a decline)', async () => {
  assert.deepEqual(await check(MARKER, ORIG), { ok: true, changed: [] });
});
test('I-2c the check refuses an id changed to one the pause did not pair with it', async () => {
  assert.deepEqual(await check(MARKER, withPosts([{ ...P[0], on: 'O-bbbbbbbb' }, P[1]])), { ok: false, why: "post 1's objection id may change only to the id the request names for it" });
});
test('I-2d the check refuses a changed stance', async () => {
  assert.deepEqual(await check(MARKER, withPosts([{ ...P[0], on: 'O-aaaaaaa1', stance: 'contest' }, P[1]])), { ok: false, why: "post 1 changed something other than its objection id (a stance, a reason or a quote is the judge's)" });
});
test('I-2e the check refuses every answer when the pause record has no slips list (fail closed)', async () => {
  assert.deepEqual(await check({ kind: 'id_slip' }, ORIG), { ok: false, why: 'the pause record names no id a repair may change' });
});
test('I-2f the check refuses every answer when the slips list is empty (fail closed)', async () => {
  assert.deepEqual(await check({ ...MARKER, slips: [] }, ORIG), { ok: false, why: 'the pause record names no id a repair may change' });
});
test('I-2g the check refuses a kind of repair it does not know (fail closed)', async () => {
  assert.equal((await check({ kind: 'made-up' }, ORIG)).ok, false);
});

test('I-3 after a repair written by hand, the resume reads the post on the shown id and counts it', async () => {
  const dir = tmp('resume');
  const first = (await sitting(dir, { postA: 'slip' })).result;
  const paused = first instanceof ExternalPause && first.repair?.kind === 'id_slip';
  if (paused) {
    pauseOnDisk(dir, first);
    const o = JSON.parse(first.repair.original);
    const { from, to } = first.repair.slips[0];
    writeFileSync(join(dir, `${first.label}.md`), JSON.stringify({ ...o, posts: o.posts.map(p => (p.on === from ? { ...p, on: to } : p)) }));
  }
  const second = paused ? (await sitting(dir, { postA: 'slip' })).result : null;
  assert.deepEqual({ paused, counted: postsOfAOn(second, B.lab).filter(p => p.counted !== false).length }, { paused: true, counted: 1 });
});
test('I-4 a decline (the original written back) is taken and read as before: no second pause, the post dropped', async () => {
  const dir = tmp('decline');
  const first = (await sitting(dir, { postA: 'slip' })).result;
  const paused = first instanceof ExternalPause && first.repair?.kind === 'id_slip';
  if (paused) { pauseOnDisk(dir, first); writeFileSync(join(dir, `${first.label}.md`), first.repair.original); }
  const second = paused ? (await sitting(dir, { postA: 'slip' })).result : null;
  assert.deepEqual({ firstPaused: paused, secondPaused: second instanceof ExternalPause, postsOfA: postsOfAOn(second, B.lab).length }, { firstPaused: true, secondPaused: false, postsOfA: 0 });
});
test('I-5 a resume before the repair pauses again as the same id-slip pause (invoke hands the pairs through)', async () => {
  const dir = tmp('again');
  const first = (await sitting(dir, { postA: 'slip' })).result;
  const paused = first instanceof ExternalPause && first.repair?.kind === 'id_slip';
  if (paused) pauseOnDisk(dir, first);
  const second = paused ? (await sitting(dir, { postA: 'slip' })).result : null;
  assert.deepEqual({ firstPaused: paused, again: pauseOf(second) }, { firstPaused: true, again: pauseOf(first) });
});

// C&C's review of unit 8 (4 Nov 2026): the `replies` side is a record path too (a repaired answer id decides which objection a keep, amend or withdraw lands on).
const ORIG_R = JSON.stringify({ replies: [{ id: 'O-aaaaaaa0', action: 'keep', text: 'The posts do not change it.' }] });
const R0 = JSON.parse(ORIG_R).replies[0];
test('I-2h the check takes the pair the pause found on an answer', async () => {
  const N = await import('../src/near-json.js');
  assert.deepEqual(N.acceptanceFor(MARKER, ORIG_R, JSON.stringify({ replies: [{ ...R0, id: 'O-aaaaaaa1' }] })), { ok: true, changed: ['O-aaaaaaa1'] });
});
test('I-2i the check refuses a repair that changes an answer\'s action along with its id', async () => {
  const N = await import('../src/near-json.js');
  assert.deepEqual(N.acceptanceFor(MARKER, ORIG_R, JSON.stringify({ replies: [{ ...R0, id: 'O-aaaaaaa1', action: 'withdraw' }] })), { ok: false, why: "answer 1 changed something other than its objection id (an action or its words are the judge's)" });
});
test('I-6 the repair tool, given ids on an answer\'s original, sets the answer\'s id', async () => {
  const { repairReply } = await import('../src/repair-reply.js');
  const dir = tmp('tool-replies');
  const stage = 'lreply-1-seat-a';
  writeFileSync(join(dir, `${stage}.md`), ORIG_R);
  setAsideOriginal({ runDir: dir, label: stage, promptHash: 'hash-1', fingerprint: FP, kind: 'id_slip', slips: MARKER.slips, shown: ['O-aaaaaaa1'] });
  writeFileSync(join(dir, `NEEDS-${stage}.md`), '# Repair needed\n');
  repairReply(dir, stage, { ids: MARKER.slips });
  let ids = null;
  try { ids = JSON.parse(readFileSync(join(dir, `${stage}.md`), 'utf8')).replies.map(r => r.id); } catch { /* not written */ }
  assert.deepEqual(ids, ['O-aaaaaaa1']);
});
