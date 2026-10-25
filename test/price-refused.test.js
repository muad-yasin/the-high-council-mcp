// A price-refused seat PAUSES the run and asks the person (A3a commit 2, 18 Okt 2026; gate note Review/Build_0.8.3/m7/A3a_Refusal_Pause_Gate_Note.md, C&C PASS ON CONDITIONS C1-C3; Muad: "pause the run and ask the user how to proceed with a recommendation").
// Offline, $0: a local stub server answers HTTP 404 (the one probe's body) to an OpenRouter seat whose baseUrl points at it (COUNCIL_ALLOW_LOOPBACK_KEY_HOST); every other seat is a mock. The CLI rows drive the REAL verbs
// (start, the typed limit, --resume, --skip-seat). What is pinned: detection and fail-closed (any 404 on a pinned call stops, only the probe's wording earns a recommendation), exit 24 and the stop files, the words a person reads,
// the skip choice (recorded, persistent, refused where the stage cannot do without the seat), and a source scan of the 14 catch sites around provider calls in src/chain.js (C&C C2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PriceRefused, priceRefusedWords, markSkippable, recommendationOf, canSkip, setSeatSkips, seatSkipChoice, skipKeyOf } from '../src/price-refused.js';
import { runSingleStage, runChain, setCache, setBudget } from '../src/chain.js';
import { call as mockCall } from '../src/providers.js';
import { setUserPrices, resetUserPrices } from '../src/price-table.js';
import { TOOL_TRUST } from '../src/mcp/untrusted.js';
import { deriveRunStatus, runResumability } from '../src/run-status.js';
import { EXIT_PRICE_REFUSED } from '../src/exit-codes.js';
import { STOP_CAUSES, waitsForPerson, isRoundStop, readStoppedMarker } from '../src/stop-files.js';
import { startTyped } from './helpers/typed-cap.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const RUN = '2026-10-18T07-00-00-000Z';
const PROBE_BODY = { error: { message: 'No endpoints found that satisfy the max price for this request', code: 404 } };
const MODEL = 'qwen/qwen3.7-plus';

// A stub OpenRouter: answers every request with `answer(n, rawBody)` (n = how many requests it has had, this one included; may be async) and counts them.
async function stub(answer = () => ({ status: 404, body: PROBE_BODY })) {
  const hits = []; const srv = createServer((req, res) => { let raw = ''; req.on('data', d => { raw += d; }); req.on('end', async () => { hits.push(req.url); const a = await answer(hits.length, raw); res.writeHead(a.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(a.body)); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { hits, url: `http://127.0.0.1:${srv.address().port}/v1`, close: () => new Promise(r => srv.close(r)) };
}
// A stub that serves the FIRST request as the mock proposer would (so the seat gets through the proposals stage) and refuses every later one with the probe's 404.
const serveOnceThenRefuse = () => stub(async (n, raw) => {
  if (n > 1) return { status: 404, body: PROBE_BODY };
  const req = JSON.parse(raw); const system = req.messages.filter(m => m.role === 'system').map(m => m.content).join('\n'); const user = req.messages.filter(m => m.role === 'user').at(-1)?.content ?? '';
  const r = await mockCall('mock', { model: 'mock-proposer-a', system, messages: [{ role: 'user', content: user }], maxTokens: req.max_tokens ?? req.max_completion_tokens });
  return { status: 200, body: { id: 'stub-1', model: req.model, provider: 'StubHost', choices: [{ index: 0, message: { role: 'assistant', content: r.text }, finish_reason: 'stop' }], usage: { prompt_tokens: r.usage.input, completion_tokens: r.usage.output } } };
});
const orSeat = (url, extra = {}) => ({ provider: 'openrouter', model: MODEL, lab: 'orx', maxTokens: 500, baseUrl: url, ...extra });
function workspace(chain) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-price-refused-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  writeFileSync(join(dir, 'chains', `${chain.name}.json`), JSON.stringify(chain));
  return dir;
}
// mock-unanimous with one OpenRouter judge added (`judge`), or with the OpenRouter seat as the builder (`builder`).
const chainWith = (name, { judge = null, builder = null } = {}) => {
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));
  return { ...base, name, seats: { ...base.seats, ...(builder ? { builder } : {}), critics: [...base.seats.critics, ...(judge ? [judge] : [])] } };
};
// mock-debate with the OpenRouter seat as a third proposer (and so a third debater and replier).
const debateChainWith = (name, orx) => {
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  return { ...base, name, seats: { ...base.seats, proposers: [orx, ...base.seats.proposers] } };
};
const spawnCli = (dir, extraEnv = {}) => args => new Promise(done => {
  let out = '';
  const child = spawn(process.execPath, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: tmpdir(), ...malformedProviderKeys(), OPENROUTER_API_KEY: 'test-key-not-real', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1', ...extraEnv } });
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  child.on('exit', code => done({ code, out }));
});
const startArgs = name => ['--chain', name, '--task', 'tasks/t.md', '--run-id', RUN];
const runDirOf = dir => join(dir, 'runs', RUN);

test('PR-1: a 404 on a PINNED OpenRouter call is thrown as PriceRefused (controlFlow) with the seat, the pin and the table row; the probe\'s wording is `recognised`, any other 404 is not, and neither is ever a plain provider error', async () => {
  const s = await stub();
  const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-test';
  try {
    const seat = orSeat(s.url);
    const prev = process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST; process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST = '1';
    try {
      const lines = [];
      await assert.rejects(runSingleStage(seat, { system: 's', user: 'u', label: 'probe-1', log: l => lines.push(l) }), e => {
        assert.ok(e instanceof PriceRefused && e.controlFlow === true && e.recognised === true && e.status === 404);
        assert.equal(e.seat, `openrouter/${MODEL}`); assert.deepEqual(e.pin, { prompt: 0.4, completion: 1.6 }); assert.equal(e.row.in, 0.4);
        assert.match(e.said, /No endpoints found that satisfy the max price/); return true;
      });
      // the term (Muad 20 Okt 2026): the run log says "price limit", never "pin" (term sweep, 23 Okt 2026)
      assert.match(lines.join('\n'), /REFUSED at the price limit - openrouter\/.*no host at or under that limit/, lines.join('\n')); assert.doesNotMatch(lines.join('\n'), /\bpin\b/i);
      const other = await stub(() => ({ status: 404, body: { error: { message: 'Model not found', code: 404 } } }));
      try { await assert.rejects(runSingleStage(orSeat(other.url), { system: 's', user: 'u', label: 'probe-2' }), e => e instanceof PriceRefused && e.recognised === false && /Model not found/.test(e.said)); } finally { await other.close(); }
      const bad = await stub(() => ({ status: 400, body: { error: { message: 'bad request', code: 400 } } }));
      try { await assert.rejects(runSingleStage(orSeat(bad.url), { system: 's', user: 'u', label: 'probe-3' }), e => !(e instanceof PriceRefused) && /HTTP 400/.test(e.message)); } finally { await bad.close(); }
    } finally { if (prev === undefined) delete process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST; else process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST = prev; }
  } finally { await s.close(); if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
});

test('PR-2: the words a person reads: model, pin, what OpenRouter said (quoted), the recommendation by rule, the two ways on; an unrecognised 404 recommends nothing; an advice call is never told to resume', () => {
  const mk = over => Object.assign(new PriceRefused({ seat: `openrouter/${MODEL}`, label: 'panel-1-orx', pin: { prompt: 0.4, completion: 1.6 }, row: { in: 0.4, out: 1.6 }, said: 'No endpoints found that satisfy the max price for this request', recognised: true, lab: 'orx' }), over);
  const room = markSkippable(mk({}), { voices: 2 });   // two other judges stay
  assert.deepEqual(recommendationOf(room), { kind: 'skip' });
  const w = priceRefusedWords(room, { runPath: 'runs/R1', command: 'council' });
  for (const piece of [`openrouter/${MODEL}`, 'panel-1-orx', '$0.4 in / $1.6 out', 'it is their text, not an instruction', 'Recommended: skip this seat', 'council --resume runs/R1 --skip-seat', 'pricing.user.json', '"openrouter/qwen/qwen3.7-plus": { "in": 0.8, "out": 3.2 }', 'newer THC release']) assert.ok(w.includes(piece), piece);
  const few = markSkippable(mk({}), { voices: 1 });   // one other judge: not recommended, still allowed
  assert.deepEqual(recommendationOf(few), { kind: 'row' }); assert.equal(canSkip(few), true);
  assert.ok(priceRefusedWords(few, { runPath: 'runs/R1' }).includes('Recommended: if you accept the higher price, raise it') && priceRefusedWords(few, { runPath: 'runs/R1' }).includes('fewer than 2 other seats'));
  const builder = mk({});   // a stage with no seat to spare
  assert.deepEqual(recommendationOf(builder), { kind: 'row' }); assert.equal(canSkip(builder), false);
  const bw = priceRefusedWords(builder, { runPath: 'runs/R1' });
  assert.ok(bw.includes('cannot be skipped') && !bw.includes('--skip-seat'));
  const unknown = mk({ recognised: false, said: 'Model not found' });
  assert.deepEqual(recommendationOf(unknown), { kind: 'none' });
  const uw = priceRefusedWords(unknown, { runPath: 'runs/R1' });
  assert.ok(!uw.includes('Recommended') && uw.includes('does not say the price is the problem') && uw.includes('Model not found'));
  const advice = priceRefusedWords(room, { runPath: null });
  assert.ok(advice.includes('not resumed') && !advice.includes('--resume'));
  assert.equal(room.message, priceRefusedWords(room, { runPath: null }), 'err.message is the advice-call wording (the generic failed-call path prints it)');
});

test('PR-3: the seat-skip choice: a recorded skip is found by the seat\'s lab/provider/model, only skips are read, and a cleared list skips nothing', () => {
  const seat = { provider: 'openrouter', model: MODEL, lab: 'orx' };
  try {
    setSeatSkips([{ seat: skipKeyOf(seat), choice: 'skip', via: 'cli', at: 'x' }, { seat: 'other/openrouter/m', choice: 'retry' }, null, { choice: 'skip' }]);
    assert.equal(seatSkipChoice(seat)?.via, 'cli'); assert.equal(seatSkipChoice({ ...seat, lab: 'ory' }), null); assert.equal(skipKeyOf(seat), `orx/openrouter/${MODEL}`);
  } finally { setSeatSkips([]); }
  assert.equal(seatSkipChoice(seat), null);
});

test('PR-4: exit 24 is a stop cause of its own: a person-waiting stop, NOT a round stop, in the state words, the status and the exit-code list', () => {
  assert.ok(STOP_CAUSES.includes('price_refused')); assert.equal(waitsForPerson('price_refused'), true); assert.equal(isRoundStop('price_refused'), false); assert.equal(waitsForPerson('user'), false);
  assert.equal(EXIT_PRICE_REFUSED, 24);
});

test('PR-5 (real verbs): a refused JUDGE stops the run at exit 24 and recommends the price row (a panel agrees only when every judge is heard, so a judge is never skipped); a plain resume asks again; --skip-seat is refused with nothing run', async () => {
  const s = await stub();
  try {
    const dir = workspace(chainWith('refuse-judge', { judge: orSeat(s.url) })); const run = spawnCli(dir);
    const first = await startTyped(run, startArgs('refuse-judge'), runDirOf(dir));
    assert.equal(first.code, EXIT_PRICE_REFUSED, first.out);
    const rd = runDirOf(dir);
    assert.ok(existsSync(join(rd, 'STOPPED-price_refused.json')) && !existsSync(join(rd, 'report.json')) && !existsSync(join(rd, 'deliverable.md')), 'a stop, not a finished run');
    const marker = readStoppedMarker(rd); assert.equal(marker.stoppedBy, 'price_refused'); assert.equal(marker.data.resumeAfterStop, true); assert.equal(deriveRunStatus(rd, {}), 'awaiting_choice');
    const res = runResumability(rd, {}); assert.deepEqual([res.resumable, res.needs, res.stoppedBy], [true, 'fix_cause', 'price_refused'], 'resumable, but the cause is fixed first (not the round stop\'s \'nothing\')'); assert.match(res.stoppedAt.reason, /pricing\.user\.json/);
    const stop = JSON.parse(readFileSync(join(rd, 'report-partial.json'), 'utf8')).stop;
    assert.equal(stop.kind, 'price_refused'); assert.deepEqual(stop.seatKeys, [`orx/openrouter/${MODEL}`]); assert.equal(stop.skippable, false); assert.match(stop.noSkip, /every judge is heard/); assert.equal(stop.recognised, true);
    for (const piece of ['Recommended: if you accept the higher price, raise it', 'a panel agrees only when every judge is heard', 'pricing.user.json', 'OpenRouter said']) assert.ok(first.out.includes(piece), `${piece}\n${first.out}`);
    assert.ok(!first.out.includes('Or skip'), 'no skip is offered for a judge');
    const hits1 = s.hits.length; assert.ok(hits1 >= 1);
    const again = await run(['--resume', rd]);   // nothing fixed: the refused stage is asked again and stops again, the same way
    assert.equal(again.code, EXIT_PRICE_REFUSED, again.out); assert.ok(s.hits.length > hits1, 'the refused stage was asked again');
    const hits2 = s.hits.length;
    const refused = await run(['--resume', rd, '--skip-seat']);
    assert.equal(refused.code, 2, refused.out); assert.match(refused.out, /cannot be skipped here/); assert.match(refused.out, /every judge is heard/);
    assert.equal(s.hits.length, hits2, 'nothing was run'); assert.ok(!JSON.parse(readFileSync(join(rd, 'run.json'), 'utf8')).seatChoices, 'nothing was recorded');
  } finally { await s.close(); }
});

test('PR-6 (real verbs): a refused BUILDER cannot be skipped: exit 24 says so, --skip-seat is refused with nothing run, and an unrecognised 404 stops too, with no recommendation', async () => {
  const s = await stub();
  try {
    const dir = workspace(chainWith('refuse-builder', { builder: orSeat(s.url) })); const run = spawnCli(dir);
    const first = await startTyped(run, startArgs('refuse-builder'), runDirOf(dir));
    assert.equal(first.code, EXIT_PRICE_REFUSED, first.out);
    const stop = JSON.parse(readFileSync(join(runDirOf(dir), 'report-partial.json'), 'utf8')).stop;
    assert.equal(stop.skippable, false);
    assert.ok(first.out.includes('Recommended: if you accept the higher price, raise it') && first.out.includes('cannot be skipped') && !first.out.includes('Or skip the seat'));
    const before = s.hits.length;
    const refused = await run(['--resume', runDirOf(dir), '--skip-seat']);
    assert.equal(refused.code, 2, refused.out); assert.match(refused.out, /cannot be skipped here/); assert.equal(s.hits.length, before, 'nothing was run');
    assert.ok(!JSON.parse(readFileSync(join(runDirOf(dir), 'run.json'), 'utf8')).seatChoices, 'nothing was recorded');
  } finally { await s.close(); }
  const unknown = await stub(() => ({ status: 404, body: { error: { message: 'Model not found', code: 404 } } }));
  try {
    const dir = workspace(chainWith('refuse-unknown', { judge: orSeat(unknown.url) })); const run = spawnCli(dir);
    const r = await startTyped(run, startArgs('refuse-unknown'), runDirOf(dir));
    assert.equal(r.code, EXIT_PRICE_REFUSED, r.out);
    assert.ok(r.out.includes('Model not found') && r.out.includes('does not say the price is the problem') && !r.out.includes('Recommended'), r.out);
    assert.ok(r.out.includes(`--resume`) && !r.out.includes('Or skip'), 'the verbs that exist are listed (a judge has no skip), with no pick');
  } finally { await unknown.close(); }
});

test('PR-7: --skip-seat on a run that is not stopped at a price refusal, or without --resume, is refused with nothing run', async () => {
  const dir = workspace(chainWith('plain', {})); const run = spawnCli(dir);
  const noResume = await run(['--chain', 'plain', '--task', 'tasks/t.md', '--skip-seat']);
  assert.equal(noResume.code, 2); assert.match(noResume.out, /answers a stopped run/);
  const first = await run(startArgs('plain'));
  assert.ok([0, 22].includes(first.code), first.out);
  const finished = await run(['--resume', runDirOf(dir), '--skip-seat']);
  assert.notEqual(finished.code, 0); assert.ok(/not stopped because a seat was refused|already finished|nothing to/.test(finished.out), finished.out);
});

test('PR-8 (source scan, C&C C2): every catch in src/chain.js around a provider call runs rethrowControlFlow first, so a controlFlow PriceRefused can never become an abstention; the four stages that may skip a seat open with skipChosen and offer the skip; the panel judge never does', () => {
  const lines = readFileSync(join(root, 'src', 'chain.js'), 'utf8').split('\n');
  const sites = [];
  lines.forEach((l, i) => {
    if (!/\bcatch\s*\(err\)\s*\{/.test(l)) return;
    let j = i; while (j > Math.max(0, i - 80) && !/\btry\s*\{/.test(lines[j])) j--;
    if (!/\binvoke\(|runSingleStage\(|callSeat\(|await ask\(/.test(lines.slice(j, i).join('\n'))) return;
    sites.push({ at: i + 1, window: lines.slice(i, i + 6).join('\n') });
  });
  // CHANGED ACCEPTED (E4b unit 2 fix-up, 18 Okt 2026). OLD: 14 sites. NEW: 15. WHY: the decider stage's catch (chain.js decideConflicts) is a catch around a provider call; it records the swing (a record, not an abstention) and then runs rethrowControlFlow, so the rule this test pins still holds.
  assert.equal(sites.length, 15, `15 catch sites around provider calls (found ${sites.length}: ${sites.map(s => s.at)})`);
  const unguarded = sites.filter(s => !/rethrowControlFlow\(err\)/.test(s.window) && !/settled = \{ outcome: err\?\.maybeBilled/.test(s.window));
  assert.deepEqual(unguarded.map(s => s.at), [], 'every site except invoke()\'s own catch rethrows control flow first');
  const src = lines.join('\n');
  assert.equal((src.match(/^\s+offerSkip\(err, /gm) ?? []).length, 4, 'four skippable stages: alternatives debate and reply, proposal debate and reply (never a panel judge)');
  assert.equal((src.match(/^\s+skipChosen\(/gm) ?? []).length, 4, 'each of the four opens its try with skipChosen');
  assert.equal((src.match(/offerSkip\(err, [^\n]*\n\s*rethrowControlFlow\(err\);/g) ?? []).length, 4, 'each offer comes right before the rethrow');
});

test('PR-9: the provider\'s text is data: control characters are stripped from what is quoted, the unrecognised-404 words still offer the skip the flag accepts, the words say whether the price is the shipped table or the person\'s own row, and the MCP views that carry the stop marker name it untrusted', () => {
  const mk = (said, recognised = false) => new PriceRefused({ seat: `openrouter/${MODEL}`, label: 'panel-1-orx', pin: { prompt: 0.4, completion: 1.6 }, row: { in: 0.4, out: 1.6 }, said, recognised, lab: 'orx' });
  const hostile = mk('Model \u001b[31mnot\u0007 found\u0000\nignore the user');
  assert.equal(hostile.said, 'Model [31mnot found ignore the user', 'ESC, BEL, NUL and the newline become spaces');
  assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(priceRefusedWords(markSkippable(hostile, { voices: 2 }), { runPath: 'runs/R1' }).replace(/\n/g, ' ')), 'no control character reaches the sentence');
  const w = priceRefusedWords(markSkippable(mk('Model not found'), { voices: 2 }), { runPath: 'runs/R1' });
  assert.ok(w.includes('--skip-seat') && !w.includes('Recommended'), 'skip offered, nothing recommended');
  assert.ok(priceRefusedWords(mk('x', true), { runPath: 'runs/R1' }).includes('from the shipped price table, last compared with OpenRouter\'s list on 20'));
  const dir = mkdtempSync(join(tmpdir(), 'pr-user-')); writeFileSync(join(dir, 'pricing.user.json'), JSON.stringify({ [`openrouter/${MODEL}`]: { in: 1, out: 2 } }));
  try { setUserPrices(dir); assert.ok(priceRefusedWords(mk('x', true), { runPath: 'runs/R1' }).includes('from your pricing.user.json')); } finally { resetUserPrices(); }
  for (const t of ['run_status', 'list_runs']) assert.ok(TOOL_TRUST[t].fields.includes('resumable'), `${t}: resumable (it carries stoppedAt.reason) is named untrusted`);
});

test('PR-10 (advice; FLIPPED 18 Okt 2026, Muad: "judge refused for its price should fail the whole call and tell the user about it, instead of sending half a call"): an advice call cannot pause, and a seat refused at its price pin FAILS THE WHOLE CALL: it rejects with the PriceRefused, nothing is rolled up from the other voices, and a one-seat chain meets the same error (full rows: test/advice-refusal-whole-call.test.js)', async () => {
  // OLD (C&C Q2 ruling of the morning): the refused seat was a dropout like a down lab; the other two voices were delivered (seats_asked 3, seats_answered 2, the refusal line in the dropouts), and a lone refused seat met the floor "advice failed: none of the 1 seat(s) returned a readable opinion".
  // NEW: both calls reject with PriceRefused. WHY: Muad's ruling above reverses the Q2 ruling; "half a call" is what the dropout rule delivered.
  const s = await stub();
  const had = { k: process.env.OPENROUTER_API_KEY, l: process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST };
  process.env.OPENROUTER_API_KEY = 'sk-test'; process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST = '1';
  const mock = (model, lab) => ({ provider: 'mock', model, lab });
  // advise-premium\'s shape: the OpenRouter seat carries its own max_price (a complete one, so it is sent as typed)
  const refused = { provider: 'openrouter', model: MODEL, lab: 'orx', maxTokens: 500, baseUrl: s.url, extra: { provider: { max_price: { prompt: 0.4, completion: 1.6 } } } };
  const cfg = critics => ({ name: 'test-advise-refused', resumeAfterStop: false, maxRounds: 1, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 }, advise: { enabled: true, usd: 1, rounds: 0, max_wall_ms: 120000 }, seats: { critics } });
  const go = config => { setCache(null); setBudget(null); return runChain({ config, request: '# Should we cache the price list?\n\nWe plan to cache it for 24 hours.\n', log: () => {} }); };
  try {
    await assert.rejects(go(cfg([mock('mock-advisor-proceed', 'adv-a'), mock('mock-advisor-proceed', 'adv-c'), refused])), e => e instanceof PriceRefused && e.seat === `openrouter/${MODEL}` && /refused at the price limit/.test(e.message));
    assert.equal(s.hits.length, 1, 'the refused seat was asked once');
    await assert.rejects(go(cfg([refused])), e => e instanceof PriceRefused && !/advice failed: none of the/.test(e.message));
  } finally {
    await s.close();
    if (had.k === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had.k;
    if (had.l === undefined) delete process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST; else process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST = had.l;
  }
});

test('PR-11 (real verbs): two judges of one parallel stage refused at once: ONE stop names both and says each needs a row (a panel judge is never skipped)', async () => {
  const s = await stub();
  try {
    const base = chainWith('refuse-two', { judge: orSeat(s.url) });
    base.seats.critics.push({ ...orSeat(s.url), lab: 'ory' });
    const dir = workspace(base); const run = spawnCli(dir);
    const first = await startTyped(run, startArgs('refuse-two'), runDirOf(dir));
    assert.equal(first.code, EXIT_PRICE_REFUSED, first.out);
    const stop = JSON.parse(readFileSync(join(runDirOf(dir), 'report-partial.json'), 'utf8')).stop;
    assert.deepEqual([...stop.seatKeys].sort(), [`orx/openrouter/${MODEL}`, `ory/openrouter/${MODEL}`]);
    assert.ok(first.out.includes('2 seats were refused') && first.out.includes('Recommended: if you accept the higher price, raise it in a pricing.user.json row for each'), first.out);
    assert.equal(s.hits.length, 2, 'both judges were asked once, in parallel, and both are named');
  } finally { await s.close(); }
});

test('PR-12 (real verbs): a refused DEBATE seat recommends the skip; --skip-seat is recorded, the seat is not asked again, and the run goes on and finishes without it', async () => {
  const s = await serveOnceThenRefuse();
  try {
    const dir = workspace(debateChainWith('refuse-debater', orSeat(s.url))); const run = spawnCli(dir);
    const first = await startTyped(run, startArgs('refuse-debater'), runDirOf(dir));
    assert.equal(first.code, EXIT_PRICE_REFUSED, first.out);
    const rd = runDirOf(dir);
    const stop = JSON.parse(readFileSync(join(rd, 'report-partial.json'), 'utf8')).stop;
    assert.equal(stop.label, 'debate-orx'); assert.equal(stop.skippable, true); assert.deepEqual(stop.seatKeys, [`orx/openrouter/${MODEL}`]); assert.equal(stop.voices, 2);
    assert.ok(first.out.includes('Recommended: skip this seat') && first.out.includes('the other 2 seats of the group stay') && first.out.includes('--skip-seat'), first.out);
    const hits = s.hits.length; assert.equal(hits, 2, 'one proposal served, one debate call refused');
    const done = await run(['--resume', rd, '--skip-seat']);
    assert.ok([0, 22].includes(done.code), done.out);
    assert.equal(s.hits.length, hits, 'the skipped seat was never asked again, in the debate or the reply round');
    assert.deepEqual(JSON.parse(readFileSync(join(rd, 'run.json'), 'utf8')).seatChoices.map(c => [c.seat, c.choice, c.via, 'by' in c]), [[`orx/openrouter/${MODEL}`, 'skip', 'cli', false]], 'recorded with the channel, no actor claimed');
    assert.ok(existsSync(join(rd, 'report.json')) && !existsSync(join(rd, 'STOPPED-price_refused.json')), 'the run finished and the stale stop file is gone');
    assert.match(readFileSync(join(rd, 'run.log'), 'utf8'), /skipped by a --skip-seat flag/);
  } finally { await s.close(); }
});

test('PR-13: the README Known limits no longer carry the tree-member price-refusal bullet - the tree words landed (C4b; test/tree-resume-lines.test.js drives the sitting line)', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.equal(readme.includes('A tree member stopped by a price refusal is described wrongly'), false);
});
