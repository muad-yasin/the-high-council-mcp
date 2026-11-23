// 0.8.4 T2.5 / D29 (plan A tests/handoff-status-clamp, UNIT 3): after a run that did not agree, a milestone handoff's Status may not read ready_for_build or partial; the harness writes needs_decision and a note, keeps the seat's word on the
// record (handoff_milestones.status stays the seat's, status_set_by_harness is the harness's), never touches the stage file, and lifts the clamp exactly (liftStatus) when an acceptance exists. Pure cases, then the real command.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { clampStatus, liftStatus, liftAnyClamp, statusNoteLine, statusWordOf, CLAMPED_STATUS } from '../src/handoff-status.js';
import { statusAllowedOf, agreedOf } from '../src/ending-matrix.js';
import { finishedState } from '../src/handoff-from-run.js';
import { closedFieldsOf } from '../src/tree-member.js';
import { parseMilestones } from '../src/milestones.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOT_AGREED = statusAllowedOf('round_cap', { agreed: false });
const AGREED = statusAllowedOf('signed_off', { agreed: true });
const body = status => `${status}\n\n## What this is\nA plan.\n\n## Milestones\n### M0 - walking skeleton\nEntry: the repo exists.\n`;

test('C1 ready_for_build and partial become needs_decision with the note under the Status line, and the seat\'s word is returned; every other Status is left alone', () => {
  for (const word of ['ready_for_build', 'partial']) {
    const out = clampStatus(body(`Status: ${word}`), NOT_AGREED);
    assert.equal(out.original, word);
    assert.equal(out.text, `Status: needs_decision\n${statusNoteLine(word)}\n\n## What this is\nA plan.\n\n## Milestones\n### M0 - walking skeleton\nEntry: the repo exists.\n`);
    assert.equal(parseMilestones(out.text).status, 'needs_decision', 'the lint\'s own reader sees the clamped word');
  }
  for (const word of ['needs_decision', 'needs_evidence', 'blocked']) assert.deepEqual(clampStatus(body(`Status: ${word}`), NOT_AGREED), { text: body(`Status: ${word}`), original: null }, word);
});

test('C2 an agreed run, or one with an acceptance, is not clamped; a handoff with no Status or an unknown one is left to the lint', () => {
  assert.equal(clampStatus(body('Status: ready_for_build'), AGREED).original, null);
  assert.equal(clampStatus(body('Status: partial'), statusAllowedOf('round_cap', { agreed: false, accepted: true })).original, null);
  assert.equal(clampStatus('## What this is\nNo status line.\n', NOT_AGREED).original, null);
  assert.equal(clampStatus(body('Status: nonsense'), NOT_AGREED).original, null);
  assert.equal(clampStatus('', NOT_AGREED).original, null);
});

test('C3 it reads the Status where parseMilestones reads it: emphasis and backticks around it, the top block only, never inside a code fence', () => {
  assert.equal(clampStatus(body('**Status:** ready_for_build'), NOT_AGREED).text.split('\n')[0], '**Status:** needs_decision');
  assert.equal(clampStatus(body('Status: `ready_for_build`'), NOT_AGREED).text.split('\n')[0], 'Status: `needs_decision`');
  assert.equal(clampStatus(body('Status: ready_for_build (the whole plan)'), NOT_AGREED).text.split('\n')[0], 'Status: needs_decision (the whole plan)');
  const later = '## What this is\nSomething.\n\nStatus: ready_for_build\n';
  assert.equal(clampStatus(later, NOT_AGREED).original, null, 'a Status below the first heading is not the Status');
  const fenced = '```\nStatus: ready_for_build\n```\nStatus: partial\n\n## Milestones\n';
  const out = clampStatus(fenced, NOT_AGREED);
  assert.equal(out.original, 'partial');
  assert.ok(out.text.startsWith('```\nStatus: ready_for_build\n```\nStatus: needs_decision\n'), 'the fenced line is untouched');
});

test('C4 liftStatus is the exact inverse: for every form, line ending and position, lift(clamp(x)) is x; a text that is not clamped comes back unchanged', () => {
  const forms = [body('Status: ready_for_build'), body('Status: partial'), body('**Status:** ready_for_build'), 'Status: partial', 'Status: partial\n', body('Status: ready_for_build').replace(/\n/g, '\r\n'), `\n\n${body('Status: partial')}`, '```\nx\n```\nStatus: ready_for_build\n\n## M\n'];
  for (const x of forms) {
    const c = clampStatus(x, NOT_AGREED);
    assert.notEqual(c.original, null, JSON.stringify(x));
    assert.equal(liftStatus(c.text, c.original), x, JSON.stringify(x));
  }
  const plain = body('Status: needs_decision');
  assert.equal(liftStatus(plain, 'ready_for_build'), plain, 'no note line for that word: unchanged');
  assert.equal(liftStatus(clampStatus(body('Status: partial'), NOT_AGREED).text, 'ready_for_build'), clampStatus(body('Status: partial'), NOT_AGREED).text, 'the wrong word: unchanged');
  assert.equal(liftStatus(plain, 'bogus'), plain);
  assert.equal(statusWordOf(body('Status: partial')), 'partial');
  assert.equal(CLAMPED_STATUS, 'needs_decision');
});

// ---- the real command: the envelope of test/overseer-choice.test.js C3b (a layered mock chain stopped at the overseer cap, then --finish), with a handoff seat that writes milestones and says ready_for_build
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const chainFor = (critics, over = {}) => ({
  name: 'ovc', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  handoff: true, handoff_contract: { milestones: true },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, handoff: { provider: 'mock', model: 'mock-handoff-milestones' }, critics }, ...over,
});
const project = (critics, over = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'hsc-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'ovc.json'), JSON.stringify(chainFor(critics, over)));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run, runDir, done: () => rmSync(dir, { recursive: true, force: true }) };
};
const validates = report => { const ajv = new Ajv2020({ strict: false, allErrors: true }); ajv.addFormat('date-time', true); const v = ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'))); return [v(report), v.errors]; };

test('C5 a run finished by the person at the overseer cap: HANDOFF.md says needs_decision with the note, the stage file keeps the seat\'s ready_for_build, report.json keeps the seat\'s word and records the harness\'s', () => {
  const p = project([judge('o', 'ca', 'l1', 1), judge('o', 'cb', 'l2', 2), judge('x', 'cc', 'l3', 3)], { dispute: { enabled: true, stall_rounds: 99 } });
  try {
    const first = p.run(['--chain', 'ovc', '--task', 'tasks/t.md']);
    assert.equal(first.status, 23, first.stdout + first.stderr);
    const done = p.run(['--resume', p.runDir(), '--finish']);
    assert.notEqual(done.status, 23, done.stdout + done.stderr);
    const dir = p.runDir();
    const handoff = readFileSync(join(dir, 'HANDOFF.md'), 'utf8');
    const at = handoff.indexOf('Status: ');
    assert.ok(at >= 0, handoff.slice(0, 300));
    assert.match(handoff.slice(at), /^Status: needs_decision\n> Status set to needs_decision by the harness: the handoff said ready_for_build, but the panel did not agree and nobody has accepted the plan as it stands\.\n/);
    assert.match(readFileSync(join(dir, 'handoff.md'), 'utf8'), /^Status: ready_for_build/m, 'the stage file is the seat\'s own text');
    const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
    assert.equal(report.handoff_milestones.status, 'ready_for_build', 'status is still the seat\'s word');
    assert.equal(report.handoff_milestones.status_set_by_harness, 'needs_decision');
    assert.equal(report.ending_word, 'finish_chosen');
    // the tree reads HANDOFF.md: this node now closes needs_decision and gives its unspent share back (red on a parent that kept ready_for_build: status ready_for_build, share released)
    const closed = closedFieldsOf(dir);
    assert.deepEqual([closed.status, closed.share, closed.passed], ['needs_decision', 'revoked', false]);
    const [ok, errors] = validates(report);
    assert.ok(ok, JSON.stringify(errors));
  } finally { p.done(); }
});

test('C6 a run that ended agreed keeps the seat\'s Status and records no clamp', () => {
  const p = project([judge('o', 'da', 'l1', 1), judge('o', 'db', 'l2', 2), judge('o', 'dc', 'l3', 3)]);
  try {
    const r = p.run(['--chain', 'ovc', '--task', 'tasks/t.md']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const dir = p.runDir();
    const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
    assert.equal(report.ending_word, 'signed_off');
    assert.equal(report.handoff_milestones.status_set_by_harness, undefined);
    const handoff = readFileSync(join(dir, 'HANDOFF.md'), 'utf8');
    assert.match(handoff, /^Status: ready_for_build$/m);
    assert.doesNotMatch(handoff, /Status set to needs_decision by the harness/);
  } finally { p.done(); }
});

// ---- `council handoff --from-run`: the envelope of test/handoff-from-run.test.js (a run stopped at the spend cap, then the handoff rebuilt from its latest draft), with a handoff seat that writes milestones
test('C7 council handoff --from-run on a run that stopped (no report, no word): the regenerated HANDOFF.md says needs_decision with the note, never the seat\'s ready_for_build', () => {
  const RUN = '2026-09-29T09-00-00-000Z';
  const dir = mkdtempSync(join(tmpdir(), 'hsc-fr-'));
  try {
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'runs', RUN), { recursive: true });
    writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
    writeFileSync(join(dir, 'chains', 'hand.json'), JSON.stringify({
      name: 'hand', description: 'test', maxRounds: 1, handoff: true, handoff_contract: { milestones: true },
      estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
      seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, handoff: { provider: 'mock', model: 'mock-handoff-milestones' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }] },
    }));
    writeFileSync(join(dir, 'runs', RUN, 'run.json'), JSON.stringify({ chain: 'hand', task: join(dir, 'tasks', 't.md'), cwd: dir, label: 't' }));
    writeFileSync(join(dir, 'runs', RUN, 'build.md'), '# Plan\n\n## Decisions\n\nWe use SQLite.\n\n## Routes\n\nGET /items\n');
    writeFileSync(join(dir, 'runs', RUN, 'criteria.md'), JSON.stringify({ criteria: ['The plan names a data store.', 'The plan lists the API routes.', 'No section contradicts another.'] }));
    writeFileSync(join(dir, 'runs', RUN, 'STOPPED-budget.json'), JSON.stringify({ stoppedAt: 'critique-1' }));
    const r = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), 'handoff', '--from-run', join('runs', RUN)], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const text = readFileSync(join(dir, 'runs', RUN, 'HANDOFF.md'), 'utf8');
    assert.match(text, /^Status: needs_decision\n> Status set to needs_decision by the harness: the handoff said ready_for_build, /m);
    assert.doesNotMatch(text, /^Status: ready_for_build/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('C8 a replay of the cached handoff (HANDOFF.md itself on a case-insensitive disk) reads the seat\'s own Status again: liftAnyClamp gives back the seat text for either word and leaves any other text alone', () => {
  for (const word of ['ready_for_build', 'partial']) {
    const seat = body(`Status: ${word}`);
    assert.equal(liftAnyClamp(clampStatus(seat, NOT_AGREED).text), seat, word);
  }
  const plain = body('Status: needs_decision');
  assert.equal(liftAnyClamp(plain), plain);
  assert.equal(liftAnyClamp(body('Status: ready_for_build')), body('Status: ready_for_build'));
});

test('C9 a degraded sign-off is agreed, so it is not clamped: the run path (statusAllowedOf over agreedOf) and the --from-run path (over finishedState) both leave ready_for_build', () => {
  const degraded = { ending_word: 'signed_off', passed: true, outcome: 'degraded' };
  assert.equal(agreedOf(degraded), true);
  assert.equal(clampStatus(body('Status: ready_for_build'), statusAllowedOf(degraded.ending_word, { agreed: agreedOf(degraded) })).original, null);
  const st = finishedState({ passed: agreedOf(degraded), outcome: 'degraded', delivered_text: null, ending_word: 'signed_off' });
  assert.equal(st.degraded, true);
  assert.equal(clampStatus(body('Status: partial'), statusAllowedOf(undefined, { agreed: st.signedOff === true || st.degraded === true })).original, null);
  // and a run that did not agree, in the same two readings, is clamped
  const notAgreed = finishedState({ passed: false, outcome: 'no_consensus', delivered_text: null });
  assert.equal(clampStatus(body('Status: partial'), statusAllowedOf(undefined, { agreed: notAgreed.signedOff === true || notAgreed.degraded === true })).original, 'partial');
});

test('C10 council handoff --from-run on a run with an acceptance on its report: the Status is the seat\'s own (the clamp is lifted) and the acceptance line sits under the banner', () => {
  const RUN = '2026-09-29T09-00-00-000Z';
  const dir = mkdtempSync(join(tmpdir(), 'hsc-fa-'));
  try {
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'runs', RUN), { recursive: true });
    writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
    writeFileSync(join(dir, 'chains', 'hand.json'), JSON.stringify({
      name: 'hand', description: 'test', maxRounds: 1, handoff: true, handoff_contract: { milestones: true },
      estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
      seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, handoff: { provider: 'mock', model: 'mock-handoff-milestones' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }] },
    }));
    writeFileSync(join(dir, 'runs', RUN, 'run.json'), JSON.stringify({ chain: 'hand', task: join(dir, 'tasks', 't.md'), cwd: dir, label: 't' }));
    writeFileSync(join(dir, 'runs', RUN, 'build.md'), '# Plan\n\n## Decisions\n\nWe use SQLite.\n\n## Routes\n\nGET /items\n');
    writeFileSync(join(dir, 'runs', RUN, 'criteria.md'), JSON.stringify({ criteria: ['The plan names a data store.', 'The plan lists the API routes.', 'No section contradicts another.'] }));
    writeFileSync(join(dir, 'runs', RUN, 'report.json'), JSON.stringify({ runId: RUN, ending_word: 'round_cap', passed: false, outcome: 'no_consensus', acceptance: { gate: 'g1', actor: 'maya', channel: 'cli', at: '2026-11-09T10:00:00.000Z', reason: 'I accept it.', objections: [{ id: 'O-aaaaaaaa' }] } }));
    const r = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), 'handoff', '--from-run', join('runs', RUN)], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const text = readFileSync(join(dir, 'runs', RUN, readdirSync(join(dir, 'runs', RUN)).find(n => /^HANDOFF.*\.md$/.test(n))), 'utf8');
    assert.match(text, /^Status: ready_for_build$/m, 'the seat\'s own Status: an acceptance exists');
    assert.doesNotMatch(text, /Status set to needs_decision by the harness/);
    assert.match(text, /^> \*\*Accepted as it stands\*\* by a choice typed at the terminal on 2026-11-09: I accept it\. Open objections left standing, accepted as they stand: O-aaaaaaaa\./m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

