// 3 Nov 2026 (owner: "THE REPAIR TOOL LEAVES NO TRACE IN THC'S RECORD ..."; C&C's ruling 4 on the money): a repaired stage is counted once, at its label, under its real provider, at every point of pause ->
// resume while the repair is pending -> repair -> resume, and nothing in the record tells it from an ordinary stage. The seats are OpenRouter seats behind a stubbed fetch with a fake key: shipped price rows, so every
// call costs something and bills through the openrouter cap, and the stub's usage is the same for every reply, so a repaired reply and a direct one cost the same. The CLI's own steps at a pause and at a resume are
// done here by the same functions it calls (setAsideOriginal; setCapBudgets, then the superseded records seeded into their caps).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChain, setBudget, setCapBudgets, countEarlierSpend, budgetState, setCache, setRepairPauses, ExternalPause } from '../src/chain.js';
import { makeStageCache } from '../src/stage-cache.js';
import { setAsideOriginal } from '../src/near-json.js';
import { supersededStagesOf } from '../src/superseded.js';
import { spendReport, capSpentOf } from '../src/spend.js';
import { listRunFiles } from '../src/run-files.js';
import { waitingStages } from '../src/run-status.js';

const A = { provider: 'openrouter', model: 'openai/gpt-6.1-sol', maxTokens: 20000, lab: 'seat-a' };
const B = { provider: 'openrouter', model: 'z-ai/glm-5.3', maxTokens: 20000, lab: 'seat-b' };
const LABEL_A = 'panel-1-seat-a';
const PANEL_NEAR = '{"meets": true, "criteria": [{"criterion": "It exists.", "verdict": "MET", "evidence": "REVISED MOCK DELIVERABLE"}, "failures": []}';
const PANEL_FIXED = '{"meets": true, "criteria": [{"criterion": "It exists.", "verdict": "MET", "evidence": "REVISED MOCK DELIVERABLE"}], "failures": []}';
const GOOD_VERDICT = '{"meets": true, "criteria": [{"criterion": "It exists.", "verdict": "MET", "evidence": "REVISED MOCK DELIVERABLE"}]}';
const FP = 'fingerprint-repair-money';
const config = { name: 'repair-money', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], seats: { critics: [A, B] } };
const near = (a, b) => Math.abs(a - b) < 1e-9;

function runFolder() {
  const runsDir = mkdtempSync(join(tmpdir(), 'repair-money-runs-'));
  const dir = join(runsDir, '2026-11-03T10-00-00-000Z');
  mkdirSync(dir);
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'repair-money' }));
  return { runsDir, dir };
}
// The CLI's onStage for a stage that ran (src/cli.js): cost first, text last, with the cap the call billed through.
const onStageFor = dir => s => {
  if (s.cached) return;
  writeFileSync(join(dir, `${s.label}.usage.json`), JSON.stringify({ provider: s.provider, model: s.model, usage: s.usage, usd: s.usd, ms: s.ms, inputsFingerprint: FP, promptHash: s.promptHash, ...(s.capName ? { capName: s.capName } : {}) }));
  writeFileSync(join(dir, `${s.label}.md`), s.text);
};
// One sitting, started the way the CLI starts a run or a resume with the caps armed: no run ceiling, the openrouter cap armed, the superseded records seeded into the cap they billed through, then the run.
async function sitting(dir, draft = 'REVISED MOCK DELIVERABLE') {
  setBudget(null);
  setCapBudgets({ openrouter: 100 });
  for (const r of supersededStagesOf(dir)) countEarlierSpend(r.usd, r.capName);
  setCache(makeStageCache({ dir, fingerprint: FP }));
  let out;
  try { out = await runChain({ request: 'Req.', config, draft, log: () => {}, onStage: onStageFor(dir) }); } catch (e) { out = e; }
  const st = budgetState();
  return { out, spent: st.spent, cap: st.caps.openrouter.spent, assumed: st.assumed };
}
async function withStub(replyFor, fn) {
  const had = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-or-test-not-a-key';
  setRepairPauses(true);
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.model);
    const asked = calls.filter(m => m === body.model).length;
    return { ok: true, json: async () => ({ model: body.model, choices: [{ message: { content: replyFor(body.model, asked) }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20 } }) };
  };
  try { return await fn(calls); } finally { globalThis.fetch = original; setCache(null); setBudget(null); setRepairPauses(false); if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
}
const usdOf = (dir, label) => JSON.parse(readFileSync(join(dir, `${label}.usage.json`), 'utf8')).usd;
const spendOf = runsDir => spendReport(runsDir, { days: 3650, now: Date.parse('2026-11-03T12:00:00Z') }).totalUsd;
const rowOf = (result, label) => { const s = (result.stages || []).find(x => x.label === label); return s && { provider: s.provider, model: s.model, usd: s.usd, capName: s.capName ?? null, cached: !!s.cached }; };

test('M-1 a repaired stage leaves nothing that tells it from a direct answer: its replayed row, the spend report and the cap figure equal those of a run where the seat answered the repaired text at once', async () => {
  const X = runFolder();
  const Y = runFolder();
  await withStub(m => (m === A.model ? PANEL_FIXED : GOOD_VERDICT), async () => {
    const first = await sitting(X.dir);
    assert.equal(first.out?.passed, true, `premise: X passes at once (${first.out?.stack || ''})`);
  });
  await withStub(m => (m === A.model ? PANEL_NEAR : GOOD_VERDICT), async () => {
    const first = await sitting(Y.dir);
    assert.ok(first.out instanceof ExternalPause && first.out.repair, 'premise: Y pauses for a repair');
    setAsideOriginal({ runDir: Y.dir, label: first.out.label, promptHash: first.out.promptHash, fingerprint: FP });   // what the CLI does at the pause
    writeFileSync(join(Y.dir, `${first.out.label}.md`), PANEL_FIXED);   // the repair: the same words, the bracket moved
  });
  const rx = await withStub(() => GOOD_VERDICT, () => sitting(X.dir));
  const ry = await withStub(() => GOOD_VERDICT, () => sitting(Y.dir));
  assert.equal(ry.out?.passed, true, 'Y reads the repaired verdict and passes');
  assert.deepEqual(rowOf(ry.out, LABEL_A), rowOf(rx.out, LABEL_A), 'the repaired stage replays as the paid call, exactly like the direct answer (provider, model, usd, cap)');
  assert.equal(rowOf(ry.out, LABEL_A).provider, 'openrouter', 'never external');
  assert.ok(rowOf(ry.out, LABEL_A).usd > 0, 'premise: the call cost something');
  assert.ok(near(spendOf(Y.runsDir), spendOf(X.runsDir)), `the spend report: ${spendOf(Y.runsDir)} vs ${spendOf(X.runsDir)}`);
  assert.ok(near(capSpentOf(Y.dir, 'openrouter'), capSpentOf(X.dir, 'openrouter')), 'the openrouter cap figure');
  assert.ok(near(ry.spent, rx.spent) && near(ry.cap, rx.cap), 'the replay sitting counts the same in the run budget and the cap');
  assert.equal(existsSync(join(Y.dir, 'superseded')), false, 'no superseded/ record, so no superseded[] row in a report');
  assert.equal(readdirSync(Y.dir).filter(f => f.endsWith('.usage.json')).some(f => JSON.parse(readFileSync(join(Y.dir, f), 'utf8')).provider === 'external'), false, 'no external usage record');
  assert.equal(readFileSync(join(Y.dir, 'originals', `${LABEL_A}.1.md`), 'utf8'), PANEL_NEAR, 'the original is kept for the maintainers');
});

test('M-2 money across pause -> resume while the repair is pending -> repair -> resume: at every point the run budget, the openrouter cap (seeded as the CLI seeds it) and the spend report count the paid call exactly once', async () => {
  const { runsDir, dir } = runFolder();
  await withStub(m => (m === A.model ? PANEL_NEAR : GOOD_VERDICT), async calls => {
    const s1 = await sitting(dir);
    assert.ok(s1.out instanceof ExternalPause && s1.out.repair, '1: the pause');
    const expected = usdOf(dir, LABEL_A) + usdOf(dir, 'panel-1-seat-b');   // the two paid calls, read before anything moves
    assert.ok(expected > 0, 'premise: the calls cost something');
    setAsideOriginal({ runDir: dir, label: s1.out.label, promptHash: s1.out.promptHash, fingerprint: FP });
    const check = (point, s) => {
      assert.ok(near(s.spent, expected), `${point}: the run budget counts ${s.spent}, expected ${expected}`);
      assert.ok(near(s.cap, expected), `${point}: the openrouter cap counts ${s.cap}, expected ${expected}`);
      assert.ok(near(spendOf(runsDir), expected), `${point}: the spend report counts ${spendOf(runsDir)}, expected ${expected}`);
      assert.ok(near(capSpentOf(dir, 'openrouter'), expected), `${point}: the cap figure on disk is ${capSpentOf(dir, 'openrouter')}, expected ${expected}`);
    };
    check('1, the pause', s1);
    const s2 = await sitting(dir);
    assert.ok(s2.out instanceof ExternalPause && s2.out.repair, '2: a resume before the repair pauses again');
    assert.equal(calls.filter(m => m === A.model).length, 1, '2: without calling the seat again');
    check('2, the resume while the repair is pending', s2);
    writeFileSync(join(dir, `${LABEL_A}.md`), PANEL_FIXED);
    const s3 = await sitting(dir);
    assert.equal(s3.out?.passed, true, `3: the repaired verdict is read and the run passes (${s3.out?.stack || ''})`);
    check('3, the resume after the repair', s3);
  });
});

test('M-3 once the repair is taken, the top level is an ordinary stage: no marker, no NEEDS file, nothing waiting; the original, the marker and the request are kept in originals/', async () => {
  const { dir } = runFolder();
  await withStub(m => (m === A.model ? PANEL_NEAR : GOOD_VERDICT), async () => {
    const s1 = await sitting(dir);
    assert.ok(s1.out instanceof ExternalPause && s1.out.repair);
    setAsideOriginal({ runDir: dir, label: s1.out.label, promptHash: s1.out.promptHash, fingerprint: FP });
    writeFileSync(join(dir, `NEEDS-${s1.out.label}.md`), '# Repair needed\n');   // the request file the CLI writes at the pause
    assert.deepEqual(waitingStages(dir), [LABEL_A], 'premise: the stage waits');
    writeFileSync(join(dir, `${LABEL_A}.md`), PANEL_FIXED);
    const s2 = await sitting(dir);
    assert.equal(s2.out?.passed, true);
  });
  const top = listRunFiles(dir);   // what MCP run_status lists as the run's files (src/mcp/server.js, `files:`)
  assert.equal(top.some(f => f.endsWith('.repair.json')), false, `no marker at the top level (${top})`);
  assert.equal(top.some(f => f.startsWith('NEEDS-')), false, `no request file at the top level (${top})`);
  assert.deepEqual(waitingStages(dir), [], 'nothing waits');
  assert.deepEqual(readdirSync(dir).filter(f => f.endsWith('.md')).sort(), ['panel-1-seat-a.md', 'panel-1-seat-b.md'], 'the top-level .md files are the two stages and nothing else (resume-brief, shape-rounds and verdict-stats read every one)');
  assert.deepEqual(readdirSync(join(dir, 'originals')).sort(), [`${LABEL_A}.1.md`, `${LABEL_A}.1.needs.md`, `${LABEL_A}.1.repair.json`].sort(), 'kept for the maintainers');
  assert.equal(JSON.parse(readFileSync(join(dir, 'originals', `${LABEL_A}.1.repair.json`), 'utf8')).accepted, true);
});

test('M-4 a repaired stage never pauses a second time: a repair that still reads null (the original sent back unchanged) is an abstention, and the panel re-asks the seat as today', async () => {
  const { dir } = runFolder();
  await withStub((m, asked) => (m === A.model && asked === 1 ? PANEL_NEAR : GOOD_VERDICT), async calls => {
    const s1 = await sitting(dir);
    assert.ok(s1.out instanceof ExternalPause && s1.out.repair);
    setAsideOriginal({ runDir: dir, label: s1.out.label, promptHash: s1.out.promptHash, fingerprint: FP });
    writeFileSync(join(dir, `${LABEL_A}.md`), PANEL_NEAR);   // the same words: taken, and still unreadable
    const s2 = await sitting(dir);
    assert.ok(!(s2.out instanceof ExternalPause), `no second pause for the repaired stage (${s2.out instanceof ExternalPause ? s2.out.label : ''})`);
    assert.equal(s2.out?.passed, true, 'the re-ask was answered and the panel signed off');
    assert.deepEqual(calls.filter(m => m === A.model).length, 2, 'the seat was asked twice in all: the paid first reply and the re-ask');
    assert.equal(existsSync(join(dir, `${LABEL_A}-reask1.md`)), true, 'the re-ask is its own stage');
  });
});

test('M-6 a paid record that is gone or unreadable while the repair is pending is charged at one attempt\'s worst case, never at nothing (C&C\'s FIX on unit 2)', async () => {
  for (const spoil of ['unreadable', 'gone']) {
    const { dir } = runFolder();
    await withStub(m => (m === A.model ? PANEL_NEAR : GOOD_VERDICT), async () => {
      const s1 = await sitting(dir);
      assert.ok(s1.out instanceof ExternalPause && s1.out.repair, `${spoil}: premise, the pause`);
      setAsideOriginal({ runDir: dir, label: s1.out.label, promptHash: s1.out.promptHash, fingerprint: FP });
      const usdB = usdOf(dir, 'panel-1-seat-b');
      const usage = join(dir, `${LABEL_A}.usage.json`);
      if (spoil === 'unreadable') writeFileSync(usage, '{ not json'); else renameSync(usage, `${usage}.aside`);
      const s2 = await sitting(dir);
      assert.ok(s2.out instanceof ExternalPause && s2.out.repair, `${spoil}: still a pause, never a new call`);
      assert.equal(s2.assumed.stages, 1, `${spoil}: the pending stage is charged at its worst case`);
      assert.ok(s2.assumed.usd > 0, `${spoil}: a worst case above zero`);
      assert.ok(near(s2.spent, usdB + s2.assumed.usd), `${spoil}: the run budget counts the other seat's call plus the worst case (${s2.spent})`);
      assert.ok(near(s2.cap, usdB + s2.assumed.usd), `${spoil}: and so does the openrouter cap (${s2.cap})`);
    });
  }
});

test('M-7 a pause whose prompt changed is released, and the paid reply is kept as a stale answer WITH its record even when the original text is missing: after the re-run the run budget, the cap, the spend report and the cap figure count all four calls once (the review of the money unit)', async () => {
  const { runsDir, dir } = runFolder();
  await withStub((m, asked) => (m === A.model && asked === 1 ? PANEL_NEAR : GOOD_VERDICT), async calls => {
    const s1 = await sitting(dir);
    assert.ok(s1.out instanceof ExternalPause && s1.out.repair, 'premise: the pause');
    setAsideOriginal({ runDir: dir, label: s1.out.label, promptHash: s1.out.promptHash, fingerprint: FP });
    const oldA = usdOf(dir, LABEL_A);
    const oldB = usdOf(dir, 'panel-1-seat-b');
    renameSync(join(dir, 'originals', `${LABEL_A}.1.md`), join(dir, 'originals', `${LABEL_A}.1.md.gone`));   // the known-bad state: the marker is there, the original is not
    const s2 = await sitting(dir, 'A DIFFERENT DELIVERABLE');
    assert.equal(s2.out?.passed, true, `the stage ran again, live, and the run passed (${s2.out?.stack || ''})`);
    assert.equal(calls.filter(m => m === A.model).length, 2, 'the seat was asked again: the old request was moot');
    const newA = usdOf(dir, LABEL_A);
    const newB = usdOf(dir, 'panel-1-seat-b');
    const expected = oldA + oldB + newA + newB;
    assert.equal(JSON.parse(readFileSync(join(dir, 'superseded', `${LABEL_A}.1.usage.json`), 'utf8')).usd, oldA, 'the paid record of the moot reply is kept in superseded/');
    assert.equal(existsSync(join(dir, 'superseded', `${LABEL_A}.1.md`)), false, 'with no text beside it: the original was missing');
    assert.equal(existsSync(join(dir, 'originals', `${LABEL_A}.1.released.json`)), true, 'the marker was released into originals/');
    assert.ok(near(s2.spent, expected), `the run budget counts ${s2.spent}, expected ${expected}`);
    assert.ok(near(s2.cap, expected), `the openrouter cap counts ${s2.cap}, expected ${expected}`);
    assert.ok(near(spendOf(runsDir), expected), `the spend report counts ${spendOf(runsDir)}, expected ${expected}`);
    assert.ok(near(capSpentOf(dir, 'openrouter'), expected), `the cap figure on disk is ${capSpentOf(dir, 'openrouter')}, expected ${expected}`);
  });
});
