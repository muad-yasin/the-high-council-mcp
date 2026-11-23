// 3 Nov 2026 (owner's pick "Auto + handler tool": "At a pause, the handler gets the MCP repair tool for cases that need judgment: ... a paraphrased row"; "Everything else is re-asked as today"): a sign-off whose table is
// complete but that row matching cannot read pauses for a repair (kind table_rows) instead of being re-asked. The repair may only set a row's criterion text to the exact text of the criterion at its position; writing the
// original back is a decline, read as before (the seat is re-asked). Stubbed OpenRouter seats with a fake key; synthetic shapes (run output never enters the repo). The new functions are imported inside each test, so on a
// tree without them each test fails on its own rather than the file failing to load.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChain, setBudget, setCache, setRepairPauses, ExternalPause } from '../src/chain.js';
import { makeStageCache } from '../src/stage-cache.js';
import { setAsideOriginal } from '../src/near-json.js';

const C = ['The plan states its assumptions about the venue.', 'Every step names who does it and by when.', 'The budget adds up and names its sources.'];
const retype = c => c.replace(/^\S+/, 'Restated');
const row = (criterion, verdict = 'MET') => ({ criterion, verdict, evidence: 'The draft covers it.' });
// complete, in order, but rows 2 and 3 carry each other's words: no position fits, so neither the text match nor position reads it
const SWAPPED = { meets: true, criteria: [row(retype(C[0])), row(retype(C[2])), row(retype(C[1]))], failures: [], verdict_line: 'All criteria met.' };
const EXACT = { meets: true, criteria: C.map(c => row(c)), failures: [], verdict_line: 'All criteria met.' };
const A = { provider: 'openrouter', model: 'openai/gpt-6.1-sol', maxTokens: 20000, lab: 'seat-a' };
const LABEL = 'panel-1-seat-a';
const FP = 'fingerprint-table-pause';
const config = { name: 'table-pause', signoff: 'unanimous', maxRounds: 1, criteria: C, signoff_table: { required: true }, seats: { critics: [A] } };

async function withStub(replyFor, fn) {
  const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-test-not-a-key';
  setRepairPauses(true);
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { const body = JSON.parse(opts.body); calls.push(body.model); return { ok: true, json: async () => ({ model: body.model, choices: [{ message: { content: replyFor(calls.length) }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20 } }) }; };
  try { return await fn(calls); } finally { globalThis.fetch = original; setCache(null); setBudget(null); setRepairPauses(false); if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
}
const onStageFor = dir => s => { if (s.cached) return; writeFileSync(join(dir, `${s.label}.usage.json`), JSON.stringify({ provider: s.provider, model: s.model, usage: s.usage, usd: s.usd, ms: s.ms, inputsFingerprint: FP, promptHash: s.promptHash })); writeFileSync(join(dir, `${s.label}.md`), s.text); };
async function sitting(dir) {
  setCache(makeStageCache({ dir, fingerprint: FP }));
  try { return await runChain({ request: 'Plan a bake sale.', config, draft: 'REVISED MOCK DELIVERABLE', log: () => {}, onStage: onStageFor(dir) }); } catch (e) { return e; }
}
const pauseOnDisk = (dir, err) => setAsideOriginal({ runDir: dir, label: err.label, promptHash: err.promptHash, fingerprint: FP, kind: err.repair.kind, criteria: err.repair.criteria, rows: err.repair.rows });   // what the CLI does

// One assertion per test (C&C, units 4 to 8): each fails on its own on the tree without the table pause (red tree 5); T-2's refusals also on the known-bad tree whose check accepts anything (KB-5).
const summary = (err, calls) => (err instanceof ExternalPause && err.repair ? { pause: true, label: err.label, kind: err.repair.kind, criteria: err.repair.criteria, rows: err.repair.rows, calls: calls.length } : { pause: false, passed: err?.passed ?? null, calls: calls.length });

// A complete table refused by each guard of src/criteria-ledger.js byPosition (C&C: one test per guard) pauses for a TABLE repair; the criteria and the unmatched rows are carried; the seat is not re-asked.
const GUARD_CASES = [
  ['G2 (rows 2 and 3 carry each other\'s words)', SWAPPED, [1, 2, 3]],
  ['G3 (row 1 says it is criterion 2)', { ...SWAPPED, criteria: [row(`2. ${retype(C[0])}`), row(retype(C[1])), row(retype(C[2]))] }, [1, 2, 3]],
  ['G4 (row 1 is the exact text of criterion 2)', { ...SWAPPED, criteria: [row(C[1]), row(retype(C[0])), row(retype(C[2]))] }, [1, 3]],
  ['G5 (row 2 is shorter than 12 characters)', { ...SWAPPED, criteria: [row(retype(C[0])), row('Owner, date'), row(retype(C[2]))] }, [1, 2, 3]],
];
for (const [i, [name, reply, rows]] of GUARD_CASES.entries()) {
  test(`T-1${'abcd'[i]} a complete table refused by ${name} pauses for a table repair (kind table_rows, the criteria and rows ${rows.join(', ')} carried), not a re-ask`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'table-pause-'));
    await withStub(() => JSON.stringify(reply), async calls => {
      const err = await sitting(dir);
      assert.deepEqual(summary(err, calls), { pause: true, label: LABEL, kind: 'table_rows', criteria: C, rows, calls: 1 });
    });
  });
}

// The table check (src/near-json.js tableRowsAcceptance), one case per test. SWAPPED's pause flags all three rows (T-1a), so every case below passes them (4 Nov 2026: the check takes the flagged rows).
const ORIG = JSON.stringify(SWAPPED);
const ALL_FLAGGED = [1, 2, 3];
const withRows = rows => JSON.stringify({ ...SWAPPED, criteria: rows });
const CHECK_CASES = [
  ['takes a row\'s criterion text set to the exact criterion at its position', withRows([row(C[0]), SWAPPED.criteria[1], SWAPPED.criteria[2]]), { ok: true, changed: [1] }],
  ['takes no change at all (a decline)', ORIG, { ok: true, changed: [] }],
  ['refuses a changed verdict', withRows([row(C[0], 'FAILED'), SWAPPED.criteria[1], SWAPPED.criteria[2]]), false],
  ['refuses changed evidence', withRows([{ ...row(C[0]), evidence: 'Other evidence.' }, SWAPPED.criteria[1], SWAPPED.criteria[2]]), false],
  ['refuses another criterion\'s text in a row', withRows([SWAPPED.criteria[0], row(C[2]), SWAPPED.criteria[2]]), false],
  ['refuses two rows swapped', withRows([SWAPPED.criteria[0], SWAPPED.criteria[2], SWAPPED.criteria[1]]), false],
  ['refuses a row removed', withRows([SWAPPED.criteria[0], SWAPPED.criteria[1]]), false],
  ['refuses a failure added', JSON.stringify({ ...SWAPPED, failures: [{ criterion: C[1], problem: 'p' }] }), false],
  ['refuses a changed verdict flag', JSON.stringify({ ...SWAPPED, meets: false }), false],
];
for (const [i, [name, repaired, expected]] of CHECK_CASES.entries()) {
  test(`T-2${'abcdefghi'[i]} the table check ${name}`, async () => {
    const N = await import('../src/near-json.js');
    const got = typeof N.tableRowsAcceptance === 'function' ? N.tableRowsAcceptance(ORIG, repaired, C, ALL_FLAGGED) : null;
    if (expected === false) assert.equal(got?.ok, false, `refused (got ${JSON.stringify(got)})`);
    else assert.deepEqual(got, expected);
  });
}
test('T-2j acceptanceFor picks the table check for a table pause', async () => {
  const N = await import('../src/near-json.js');
  // criterion 1's exact text restored in row 1: the table check takes it, the punctuation check would refuse it (words changed), so this tells the two apart
  assert.equal(typeof N.acceptanceFor === 'function' ? N.acceptanceFor({ kind: 'table_rows', criteria: C, rows: ALL_FLAGGED }, ORIG, withRows([row(C[0]), SWAPPED.criteria[1], SWAPPED.criteria[2]])).ok : null, true);
});
// 4 Nov 2026 (C&C's review of unit 6): a table pause record with no rows list, or an empty one, refuses every answer, a decline included (fail closed: the marker sits in a project-writable file).
test('T-2l a table pause record with no rows list refuses even a decline', async () => {
  const N = await import('../src/near-json.js');
  assert.equal(N.acceptanceFor({ kind: 'table_rows', criteria: C }, ORIG, ORIG).ok, false);
});
test('T-2m a table pause record with an empty rows list refuses even a decline', async () => {
  const N = await import('../src/near-json.js');
  assert.equal(N.acceptanceFor({ kind: 'table_rows', criteria: C, rows: [] }, ORIG, ORIG).ok, false);
});
test('T-2k acceptanceFor keeps the punctuation check for a near-JSON pause', async () => {
  const N = await import('../src/near-json.js');
  assert.equal(typeof N.acceptanceFor === 'function' ? N.acceptanceFor({ kind: 'near_json' }, '{"a": [1}', '{"a": [1]}').ok : null, true);
});

test('T-3 a decline (the original written back unchanged) is taken and read as before: no second pause, the seat is re-asked as today and its full table counts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'table-decline-'));
  await withStub(n => JSON.stringify(n === 1 ? SWAPPED : EXACT), async calls => {
    const first = await sitting(dir);
    const firstKind = first instanceof ExternalPause ? first.repair?.kind : null;
    if (firstKind === 'table_rows') { pauseOnDisk(dir, first); writeFileSync(join(dir, `${LABEL}.md`), first.repair.original); }
    const second = firstKind === 'table_rows' ? await sitting(dir) : null;
    assert.deepEqual({ firstKind, secondPaused: second instanceof ExternalPause, passed: second?.passed ?? null, calls: calls.length }, { firstKind: 'table_rows', secondPaused: false, passed: true, calls: 2 });
  });
});

test('T-4 a repair (a short paraphrase given its criterion\'s exact text) is taken: the sign-off counts with no re-ask and the run passes', async () => {
  // row 2 is too short to be placed by position ("Owner, date": under 12 characters) and still asks what criterion 2 asks; the handler restores criterion 2's exact text in that row and changes nothing else
  const PARAPHRASED = { meets: true, criteria: [row(retype(C[0])), row('Owner, date'), row(retype(C[2]))], failures: [], verdict_line: 'All criteria met.' };
  const dir = mkdtempSync(join(tmpdir(), 'table-repair-'));
  await withStub(() => JSON.stringify(PARAPHRASED), async calls => {
    const first = await sitting(dir);
    const firstKind = first instanceof ExternalPause ? first.repair?.kind : null;
    if (firstKind === 'table_rows') { pauseOnDisk(dir, first); writeFileSync(join(dir, `${LABEL}.md`), JSON.stringify({ ...PARAPHRASED, criteria: [PARAPHRASED.criteria[0], row(C[1]), PARAPHRASED.criteria[2]] })); }
    const second = firstKind === 'table_rows' ? await sitting(dir) : null;
    assert.deepEqual({ firstKind, passed: second?.passed ?? null, calls: calls.length }, { firstKind: 'table_rows', passed: true, calls: 1 });
  });
});

test('T-5 the real CLI says what a table pause is: the terminal line names a sign-off table (not "almost JSON") and the NEEDS file is the table request', () => {
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src/cli.js');
  const work = mkdtempSync(join(tmpdir(), 'table-pause-cli-'));
  mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small bake sale.\n');
  // two criteria that differ only in their first word: mock-retyped-table replaces first words, so its rows fit both and the complete table cannot be read
  writeFileSync(join(work, 'chains', 'table-pause-cli.json'), JSON.stringify({ name: 'table-pause-cli', description: 'Test: a complete table that cannot be read.', maxRounds: 2, signoff: 'unanimous', signoff_table: { required: true }, criteria: ['Alpha names the venue, the date and the stand layout.', 'Omega names the venue, the date and the stand layout.', 'The budget adds up and names its sources.'], seats: { builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-retyped-table', lab: 'rt' }] } }));
  const p = spawnSync(process.execPath, [cli, '--chain', 'table-pause-cli', '--task', 'tasks/t.md'], { cwd: work, env: { PATH: process.env.PATH, HOME: work }, encoding: 'utf8', timeout: 60_000 });
  const run = join(work, 'runs', readdirSync(join(work, 'runs'))[0]);
  const needs = (() => { try { return readFileSync(join(run, 'NEEDS-panel-1-rt.md'), 'utf8').split('\n')[0]; } catch { return null; } })();
  assert.deepEqual({ exit: p.status, line: /PAUSED: stage "panel-1-rt" got a sign-off table whose rows could not be matched to the criteria; it needs a repair \(only a row's criterion text may change\)\./.test(p.stdout), needs }, { exit: 3, line: true, needs: '# Repair needed: panel-1-rt (a sign-off table)' }, p.stdout.slice(-600));
});

// 4 Nov 2026 (C&C's review of unit 6): the hand path is as narrow as the MCP tool. G4's pause flags rows 1 and 3 (row 1 holds criterion 2's exact text, so criterion 2 has its row); a reply written by hand that sets row 2's
// criterion text to criterion 2 would give that criterion a second row. The stage cache checks it with the shared check, refuses it, keeps it in originals/ and writes the reason into the marker; the run pauses again.
test('T-6 a hand-written repair that changes a row the pause did not flag is refused by the stage cache (the reason is in the marker)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'table-pause-hand-'));
  const g4 = GUARD_CASES[2][1];
  const byHand = JSON.stringify({ ...g4, criteria: [g4.criteria[0], { ...g4.criteria[1], criterion: C[1] }, g4.criteria[2]] });
  await withStub(() => JSON.stringify(g4), async () => {
    pauseOnDisk(dir, await sitting(dir));
    writeFileSync(join(dir, `${LABEL}.md`), byHand);
    await sitting(dir);
  });
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: `...names only rows 1, 3, the criteria the table left without a row`. NEW: `...names only rows 1, 3, where the row's words did not fit the criterion at that position` (K5). WHY: the reviewed refusal of src/near-json.js:87.
  assert.equal(JSON.parse(readFileSync(join(dir, `${LABEL}.repair.json`), 'utf8')).refusal, "row 2's criterion text may not change: this pause names only rows 1, 3, where the row's words did not fit the criterion at that position");
});
