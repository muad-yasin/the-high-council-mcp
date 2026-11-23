// 0.8.4 D18 (plan A T5.1; C&C 09 Nov 2026): a judge asks for project text inside its verdict, the handling session sees the numbered list at the revise pause, answers it with excerpt_answers (paste or decline), and the
// harness records one line per request and shows the pasted text to every later seat. Proved through the REAL command, spawned, with every word of lane A recorded by a preload: the list in NEEDS and prompt.json, the
// refusals of a bad answer, a paste, a decline, a request left out; and, with the words held, no list and no field. Offline, $0 (a scripted mock judge, src/providers.js mock-critic-requests).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setHeldForTest } from '../src/held-roles.js';
import { submitStageAnswer } from '../src/stage-submission.js';
import * as RS from '../src/run-status.js';   // a namespace import: excerptSwitchForSubmit is absent at the older commits this file is run against, and the option is then undefined there
import * as H from './held-prompts/held-084-a.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const preload = join(root, 'test', 'helpers', 'held-excerpt-preload.js');
const CHAIN = {
  name: 'reqs', maxRounds: 3, signoff: 'unanimous', criteria: ['It states the assumptions it was written under.'],
  estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
  seats: { builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'external', model: 'claude-code-session' }, critics: [{ provider: 'mock', model: 'mock-critic-requests', lab: 'rq' }] },
};
const chainFor = model => JSON.stringify({ ...CHAIN, seats: { ...CHAIN.seats, critics: [{ provider: 'mock', model, lab: 'rq' }] } }, null, 2);
function project(model = 'mock-critic-requests') {
  const dir = mkdtempSync(join(tmpdir(), 'thc-reqs-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tea service for twelve guests.\n');
  writeFileSync(join(dir, 'src', 'b.js'), 'bravo one\nbravo two\nbravo three\n');
  writeFileSync(join(dir, 'chains', 'reqs.json'), model === 'mock-critic-requests' ? JSON.stringify(CHAIN, null, 2) : chainFor(model));
  return dir;
}
const run = (dir, args, env = {}) => spawnSync(process.execPath, ['--import', preload, cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: dir, ...env }, timeout: 120_000 });
const onlyRun = dir => join(dir, 'runs', readdirSync(join(dir, 'runs')).filter(d => !d.includes('.'))[0]);
const waiting = runDir => readdirSync(runDir).filter(f => /^NEEDS-.*\.md$/.test(f) && !existsSync(join(runDir, f.slice('NEEDS-'.length)))).map(f => f.slice('NEEDS-'.length, -'.md'.length));
const lines = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const ALL = { ...H };

function paused(all = true) {
  const dir = project(); const log = join(dir, 'prompts.jsonl');
  const first = run(dir, ['--chain', 'reqs', '--task', 'tasks/x.md'], { THC_PROMPT_LOG: log, ...(all ? { THC_HELD_ALL: '1' } : {}) });
  assert.equal(first.status, 3, `expected the revise pause: ${first.stdout.slice(-400)}${first.stderr.slice(-300)}`);
  const runDir = onlyRun(dir);
  return { dir, runDir, log, stage: waiting(runDir)[0] };
}
const answer = (runDir, stage, excerptAnswers) => { setHeldForTest(ALL); try { return submitStageAnswer(runDir, stage, '# Plan\n\nREVISED MOCK DELIVERABLE\n\nBody.\n\nAssumptions: none.\n', { excerptSwitch: RS.excerptSwitchForSubmit, excerptAnswers }); } finally { setHeldForTest(null); } };

test('the pause: NEEDS-revise-1.md and revise-1.prompt.json carry the numbered request list; the judge\'s system text carries the field sentence from its first call; the list sits before "## System prompt"', () => {
  const { dir, runDir, log, stage } = paused();
  try {
    assert.equal(stage, 'revise-1');
    const needs = readFileSync(join(runDir, 'NEEDS-revise-1.md'), 'utf8');
    assert.match(needs, /# Text requests from the panel\n\nThe seats below asked for text of the project\./);
    assert.match(needs, /\n1\. rq asks for src\/b\.js, lines 1-2: To see what the second file already says\.\n/);
    assert.ok(needs.indexOf('# Text requests from the panel') < needs.indexOf('## System prompt'), 'the list is before the system prompt');
    const rec = JSON.parse(readFileSync(join(runDir, 'revise-1.prompt.json'), 'utf8'));
    assert.deepEqual(rec.text_requests, [{ n: 1, requested_by: 'rq', origin: 'panel-1-rq', objection_id: null, path: 'src/b.js', lines: '1-2', why: 'To see what the second file already says.' }]);
    const judgeSystems = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(p => /^panel-/.test(p.label));
    assert.ok(judgeSystems.length > 0 && judgeSystems.every(p => p.system.includes(H.textRequestsJudgeField())), 'every judge call carries the sentence');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// REMOVED (0.8.4 apply, recorded state; K7): 'with the words HELD: the judge's reply is not asked for requests, ... the pause is today's (no list in NEEDS, no field in prompt.json)'. A held-state row: textRequestsJudgeField, textRequestsProposerField and textRequestsList are recorded in every shipped run. Sibling: the row above (the words recorded: the list in NEEDS-revise-1.md before the system prompt, `text_requests` in revise-1.prompt.json, the sentence in every judge call).

test('submit: excerpt_answers is checked against the listed numbers and refused whole (nothing written) when it is not whole; the held case is refused whole too', () => {
  const { dir, runDir, stage } = paused();
  try {
    const bad = [
      [[{ request: 2 }], 'names request 2, which this stage did not list'],
      [[{ request: 1 }, { request: 1 }], 'answers request 1 that an earlier entry answered'],
      [[{ request: 1, path: 'a.js', decline: 'no' }], 'both pastes and declines'],
      [[{ request: 1, decline: ' ' }], 'neither pastes nor declines'],
      [[{ path: 'a.js' }], 'has no request number'],
      [[{ request: 1, text: 'x' }], 'names the field "text"'],
      [[{ request: 1, lines: '5-3' }], 'has lines that are not "a-b" or "n"'],
      [{ request: 1 }, 'the value is not a list'],
    ];
    for (const [value, problem] of bad) {
      assert.throws(() => answer(runDir, stage, value), err => err.message.startsWith(`The answer for "${stage}" was not written: excerpt_answers is not a list of { request, path, lines } or { request, decline }: `) && err.message.includes(problem), problem);
      assert.equal(existsSync(join(runDir, `${stage}.md`)), false, `${problem}: nothing written`);
    }
    setHeldForTest({ excerptsBlock: undefined, sessionReadsField: undefined, excerptAnswersField: undefined });
    try { assert.throws(() => submitStageAnswer(runDir, stage, 'The plan.', { excerptSwitch: RS.excerptSwitchForSubmit, excerptAnswers: [{ request: 1 }] }), /excerpt_answers is not available in this version, so nothing was recorded\. Send the answer again without excerpt_answers\./); } finally { setHeldForTest(null); }
    assert.equal(existsSync(join(runDir, `${stage}.md`)), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('PASTE (the end-to-end path): the answer { request: 1 } is cut by the harness at the resume, recorded as a seat_request line with the seat, the lines and the text, and the NEXT seats\' prompts carry the block', () => {
  const { dir, runDir, log, stage } = paused();
  try {
    answer(runDir, stage, [{ request: 1 }]);
    const r = run(dir, ['--resume', runDir], { THC_PROMPT_LOG: log, THC_HELD_ALL: '1' });
    assert.ok([0, 3].includes(r.status), `${r.status} ${r.stdout.slice(-300)}${r.stderr.slice(-300)}`);
    const rows = lines(join(runDir, 'excerpts.jsonl'));
    assert.equal(rows.length, 1);
    const [e] = rows;
    assert.deepEqual([e.id, e.request_kind, e.requested_by, e.path, e.lines, e.text, e.answered_stage, e.approval.status, e.pasted_by], ['E-1', 'seat_request', 'rq', 'src/b.js', '1-2', 'bravo one\nbravo two', stage, 'not_required', 'main-session']);
    assert.equal(e.why, 'To see what the second file already says.');
    const prompts = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const after = prompts.filter(p => /^panel-2-/.test(p.label));
    assert.ok(after.length > 0 && after.every(p => p.user.includes('bravo one\nbravo two')), 'the next round\'s judge was shown the pasted text');
    assert.ok(prompts.filter(p => /^panel-1-/.test(p.label)).every(p => !p.user.includes('bravo one')), 'and the round that asked was not');
    assert.deepEqual(readdirSync(runDir).filter(f => f === 'STOPPED-secret.md'), []);
    assert.equal(r.status, 0, 'the second round\'s judge signs off, so the run finishes');
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    assert.deepEqual(report.excerpts, { count: 1, file_sha256: createHash('sha256').update(readFileSync(join(runDir, 'excerpts.jsonl'))).digest('hex') }, 'the report carries the record\'s count and hash');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DECLINE and LEFT OUT: a decline is recorded refused with the session\'s own reason and no text; a request the answer leaves out (here: no excerpt_answers at all) is recorded unanswered with the harness\'s reason; neither shows any text', () => {
  const a = paused();
  try {
    answer(a.runDir, a.stage, [{ request: 1, decline: 'Not needed for this plan.' }]);
    assert.ok([0, 3].includes(run(a.dir, ['--resume', a.runDir], { THC_PROMPT_LOG: a.log, THC_HELD_ALL: '1' }).status));
    const [d] = lines(join(a.runDir, 'excerpts.jsonl'));
    assert.deepEqual([d.request_kind, d.text, d.approval.status, d.approval.actor, d.approval.channel, d.approval.reason, d.requested_by], ['seat_request', null, 'refused', 'main-session', 'session', 'Not needed for this plan.', 'rq']);
    const promptsA = readFileSync(a.log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.ok(promptsA.every(p => !p.user.includes('bravo one')));
    const notice = 'Your request for src/b.js, lines 1-2 was declined by the handling session: Not needed for this plan.';
    const p2 = promptsA.filter(p => /^panel-2-/.test(p.label));
    assert.ok(p2.length > 0 && p2.every(p => p.user.split(notice).length === 2), 'the requesting seat reads the notice once in its next round\'s prompt');
    const p1 = promptsA.filter(p => /^panel-1-/.test(p.label));
    assert.ok(p1.length > 0 && p1.every(p => !p.user.includes('declined by the handling session')), 'and not before');
    assert.ok(promptsA.filter(p => /^panel-3-/.test(p.label)).every(p => !p.user.includes(notice)), 'and not in a later round (vacuous if the judge signed off in round 2: the lines above carry the proof)');
  } finally { rmSync(a.dir, { recursive: true, force: true }); }
  const b = paused();
  try {
    writeFileSync(join(b.runDir, `${b.stage}.md`), '# Plan\n\nREVISED MOCK DELIVERABLE\n\nBody.\n\nAssumptions: none.\n');   // answered with no excerpt_answers
    assert.ok([0, 3].includes(run(b.dir, ['--resume', b.runDir], { THC_PROMPT_LOG: b.log, THC_HELD_ALL: '1' }).status));
    const [u] = lines(join(b.runDir, 'excerpts.jsonl'));
    assert.deepEqual([u.request_kind, u.text, u.approval.status, u.approval.reason, u.approval.actor], ['seat_request', null, 'unanswered', 'The handling session did not answer this request.', null]);
    const promptsB = readFileSync(b.log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const q2 = promptsB.filter(p => /^panel-2-/.test(p.label));
    assert.ok(q2.length > 0 && q2.every(p => p.user.includes('Your request for src/b.js, lines 1-2 was not answered by the handling session.')), 'the unanswered notice');
  } finally { rmSync(b.dir, { recursive: true, force: true }); }
});

test('NOT CUT (C&C 09 Nov 2026): a paste the harness cannot cut (a path outside the project) is recorded with status not_cut, no text, the refusal in words, at the answering stage; the requesting judge reads the not_cut notice in its next prompt', () => {
  const { dir, runDir, log, stage } = paused();
  try {
    answer(runDir, stage, [{ request: 1, path: '../outside.txt' }]);
    const r = run(dir, ['--resume', runDir], { THC_PROMPT_LOG: log, THC_HELD_ALL: '1' });
    assert.ok([0, 3].includes(r.status), `${r.status} ${r.stdout.slice(-300)}${r.stderr.slice(-300)}`);
    const [e] = lines(join(runDir, 'excerpts.jsonl'));
    assert.deepEqual([e.approval.status, e.approval.reason, e.text, e.answered_stage, e.approval.actor, e.approval.channel], ['not_cut', 'The text could not be cut: it is outside the project folder.', null, stage, null, null]);
    const notice = H.excerptNotCutNotice({ path: e.path, lines: e.lines, reason: e.approval.reason });
    const later = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(p => /^panel-2-rq/.test(p.label));
    assert.ok(later.length > 0 && later.every(p => p.user.includes(notice)), 'the judge that asked read the notice');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the list the chain rebuilds on a resume equals the one the pause stored (the numbers the answers cite are stable): a second pause for the same stage writes the same text_requests', () => {
  const { dir, runDir } = paused();
  try {
    const stored = JSON.parse(readFileSync(join(runDir, 'revise-1.prompt.json'), 'utf8')).text_requests;
    rmSync(join(runDir, 'NEEDS-revise-1.md'), { force: true });
    const again = run(dir, ['--resume', runDir], { THC_HELD_ALL: '1' });
    assert.equal(again.status, 3);
    assert.deepEqual(JSON.parse(readFileSync(join(runDir, 'revise-1.prompt.json'), 'utf8')).text_requests, stored);
    assert.match(readFileSync(join(runDir, 'NEEDS-revise-1.md'), 'utf8'), /1\. rq asks for src\/b\.js, lines 1-2/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a request the harness cannot read is dropped AND recorded: a log line and a WARNINGS.md line per dropped request (the record shows that a seat asked), and the pause has no list', () => {
  const dir = project('mock-critic-requests-bad');
  try {
    const first = run(dir, ['--chain', 'reqs', '--task', 'tasks/x.md'], { THC_HELD_ALL: '1' });
    assert.equal(first.status, 3, first.stderr.slice(-300));
    const runDir = onlyRun(dir);
    const warnings = readFileSync(join(runDir, 'WARNINGS.md'), 'utf8');
    assert.match(warnings, /text_request_dropped: rq asked for text of the project and the request was ignored: request 1 has no path/);
    assert.match(warnings, /text_request_dropped: rq asked for text of the project and the request was ignored: request 2 is not an object/);
    assert.match(first.stdout, /text request of rq ignored: request 1 has no path\./);
    assert.equal('text_requests' in JSON.parse(readFileSync(join(runDir, 'revise-1.prompt.json'), 'utf8')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the first-mode critic (a chain without signoff "unanimous": one critic per round) ----------------------------------------------------------------------------------------------------------------------
test('FIRST-MODE critic: its system text carries the sentence, its request is listed at the revise pause, a decline reaches the same critic in its next round, and the paste is shown to it', () => {
  const dir = project();
  try {
    const fm = { ...CHAIN, name: 'reqs-fm' }; delete fm.signoff;
    writeFileSync(join(dir, 'chains', 'reqs-fm.json'), JSON.stringify(fm, null, 2));
    const log = join(dir, 'prompts.jsonl');
    const first = run(dir, ['--chain', 'reqs-fm', '--task', 'tasks/x.md'], { THC_PROMPT_LOG: log, THC_HELD_ALL: '1' });
    assert.equal(first.status, 3, `${first.stdout.slice(-300)}${first.stderr.slice(-300)}`);
    const runDir = onlyRun(dir); const [stage] = waiting(runDir);
    assert.equal(stage, 'revise-1');
    assert.match(readFileSync(join(runDir, 'NEEDS-revise-1.md'), 'utf8'), /\n1\. rq asks for src\/b\.js, lines 1-2: /);
    const crit1 = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(p => /^critique-1/.test(p.label));
    assert.ok(crit1.length > 0 && crit1.every(p => p.system.includes(H.textRequestsJudgeField())), 'the first-mode critic is asked the sentence');
    answer(runDir, stage, [{ request: 1, decline: 'Not needed here.' }]);
    const r = run(dir, ['--resume', runDir], { THC_PROMPT_LOG: log, THC_HELD_ALL: '1' });
    assert.ok([0, 3].includes(r.status), `${r.status} ${r.stdout.slice(-300)}${r.stderr.slice(-300)}`);
    const crit2 = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(p => /^critique-2/.test(p.label));
    assert.ok(crit2.length > 0 && crit2.every(p => p.user.includes('Your request for src/b.js, lines 1-2 was declined by the handling session: Not needed here.')), 'the notice reaches the critic that asked, in its next round');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- proposers' requests (the debate-stage reply) and requests no later pause answered ---------------------------------------------------------------------------------------------------------------------------
const extChain = (mut) => { const c = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8')); c.name = 'reqs-prop'; delete c.draft_end_marker; c.seats.proposers[0].model = 'mock-proposer-requests'; mut?.(c); return c; };
function propProject(mut) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-reqs-prop-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tea service for twelve guests.\n');
  writeFileSync(join(dir, 'src', 'b.js'), 'bravo one\nbravo two\nbravo three\n');
  writeFileSync(join(dir, 'chains', 'reqs-prop.json'), JSON.stringify(extChain(mut), null, 2));
  return dir;
}

test('PROPOSER requests, builder external: the debate reply\'s request is listed at the BUILD pause, pasted by the answer, and shown to the seats after it; the proposer\'s system text carried the sentence', () => {
  const dir = propProject(); const log = join(dir, 'prompts.jsonl');
  try {
    const first = run(dir, ['--chain', 'reqs-prop', '--task', 'tasks/x.md'], { THC_PROMPT_LOG: log, THC_HELD_ALL: '1' });
    assert.equal(first.status, 3, `${first.stdout.slice(-300)}${first.stderr.slice(-300)}`);
    const runDir = onlyRun(dir);
    assert.deepEqual(waiting(runDir), ['build']);
    assert.match(readFileSync(join(runDir, 'NEEDS-build.md'), 'utf8'), /\n1\. mock-a asks for src\/b\.js, lines 1-2: To see what the second file already says\.\n/);
    const debate = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(p => /^debate-/.test(p.label));
    assert.ok(debate.length > 0 && debate.every(p => p.system.includes(H.textRequestsProposerField())), 'every proposer\'s debate prompt carries the sentence');
    setHeldForTest(ALL);
    try { submitStageAnswer(runDir, 'build', '# Plan\n\nREVISED MOCK DELIVERABLE\n\nBody.\n\nAssumptions: none.\n', { excerptSwitch: RS.excerptSwitchForSubmit, excerptAnswers: [{ request: 1 }] }); } finally { setHeldForTest(null); }
    const r = run(dir, ['--resume', runDir], { THC_PROMPT_LOG: log, THC_HELD_ALL: '1' });
    assert.ok([0, 3].includes(r.status), `${r.status} ${r.stdout.slice(-300)}${r.stderr.slice(-300)}`);
    const [e] = lines(join(runDir, 'excerpts.jsonl'));
    assert.deepEqual([e.request_kind, e.requested_by, e.objection_id, e.origin, e.path, e.text, e.answered_stage], ['seat_request', 'mock-a', null, 'debate-mock-a', 'src/b.js', 'bravo one\nbravo two', 'build']);
    const panel = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(p => /^panel-/.test(p.label));
    assert.ok(panel.length > 0 && panel.every(p => p.user.includes('bravo one\nbravo two')), 'the judges after the build were shown the pasted text');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A chain whose critic of lab mock-a (the proposer's own lab key) is the requesting mock judge: a proposer and a judge SHARE a seat key and ask for the same text for the same reason.
const sharedKey = (c, over = {}) => { c.seats.builder = { provider: 'mock', model: 'mock-builder' }; c.seats.critics[0].model = 'mock-critic-requests'; Object.assign(c, over); };
const ANSWER_TEXT = '# Plan\n\nREVISED MOCK DELIVERABLE\n\nBody.\n\nAssumptions: none.\n';
const answerAt = (runDir, stage, excerptAnswers) => { setHeldForTest(ALL); try { return submitStageAnswer(runDir, stage, ANSWER_TEXT, { excerptSwitch: RS.excerptSwitchForSubmit, excerptAnswers }); } finally { setHeldForTest(null); } };
const promptsOf = (log, re) => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(p => re.test(p.label));

test('ONE GATE: with a model builder and an external reviser the proposer\'s request rides the FIRST revise pause, on the same numbered list as the judge\'s: proposers first, then the judges; both kinds are answered there and recorded with their origin', () => {
  const dir = propProject(c => sharedKey(c)); const log = join(dir, 'prompts.jsonl');
  try {
    const first = run(dir, ['--chain', 'reqs-prop', '--task', 'tasks/x.md'], { THC_PROMPT_LOG: log, THC_HELD_ALL: '1' });
    assert.equal(first.status, 3, `${first.status} ${first.stdout.slice(-300)}${first.stderr.slice(-300)}`);
    const runDir = onlyRun(dir);
    assert.deepEqual(waiting(runDir), ['revise-1']);
    const listed = JSON.parse(readFileSync(join(runDir, 'revise-1.prompt.json'), 'utf8')).text_requests;
    assert.deepEqual(listed.map(r => [r.n, r.requested_by, r.origin]), [[1, 'mock-a', 'debate-mock-a'], [2, 'mock-a', 'panel-1-mock-a']]);
    const rebuilt = run(dir, ['--resume', runDir], { THC_HELD_ALL: '1' });
    assert.equal(rebuilt.status, 3);
    assert.deepEqual(JSON.parse(readFileSync(join(runDir, 'revise-1.prompt.json'), 'utf8')).text_requests, listed, 'the numbers the answers cite are stable across a resume');
    answerAt(runDir, 'revise-1', [{ request: 1 }, { request: 2 }]);
    const r = run(dir, ['--resume', runDir], { THC_PROMPT_LOG: log, THC_HELD_ALL: '1' });
    assert.ok([0, 3].includes(r.status), `${r.status} ${r.stdout.slice(-300)}${r.stderr.slice(-300)}`);
    const rows = lines(join(runDir, 'excerpts.jsonl'));
    assert.deepEqual(rows.map(e => [e.id, e.origin, e.requested_by, e.answered_stage, e.approval.status, e.text]), [['E-1', 'debate-mock-a', 'mock-a', 'revise-1', 'not_required', 'bravo one\nbravo two'], ['E-2', 'panel-1-mock-a', 'mock-a', 'revise-1', 'not_required', 'bravo one\nbravo two']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CARRY IDENTITY: a paste that overrides the lines of a proposer\'s request does not make it \"not carried\": the run finishes with exactly the two lines (no second listing, no false unanswered line)', () => {
  const dir = propProject(c => sharedKey(c));
  try {
    const first = run(dir, ['--chain', 'reqs-prop', '--task', 'tasks/x.md'], { THC_HELD_ALL: '1' });
    assert.equal(first.status, 3);
    const runDir = onlyRun(dir);
    answerAt(runDir, 'revise-1', [{ request: 1, lines: '2-3' }, { request: 2 }]);
    const r = run(dir, ['--resume', runDir], { THC_HELD_ALL: '1' });
    assert.ok([0, 3].includes(r.status), `${r.status} ${r.stdout.slice(-300)}${r.stderr.slice(-300)}`);
    if (r.status === 3) assert.ok(!JSON.parse(readFileSync(join(runDir, `${waiting(runDir)[0]}.prompt.json`), 'utf8')).text_requests?.some(q => q.origin === 'debate-mock-a'), 'the proposer\'s request is not listed again at the next pause');
    const rows = lines(join(runDir, 'excerpts.jsonl'));
    assert.deepEqual(rows.map(e => [e.origin, e.lines, e.approval.status]), [['debate-mock-a', '2-3', 'not_required'], ['panel-1-mock-a', '1-2', 'not_required']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ORIGIN ROUTES THE NOTICE: a proposer\'s declined request is NOT read by the same-key judge, and the judge\'s own declined request IS (the control)', () => {
  const dir = propProject(c => sharedKey(c)); const log = join(dir, 'prompts.jsonl');
  try {
    const first = run(dir, ['--chain', 'reqs-prop', '--task', 'tasks/x.md'], { THC_PROMPT_LOG: log, THC_HELD_ALL: '1' });
    assert.equal(first.status, 3);
    const runDir = onlyRun(dir);
    const notice = H.excerptDeclinedNotice({ path: 'src/b.js', lines: '1-2', reason: 'Not now.' });
    assert.ok(typeof notice === 'string' && notice.length > 0);
    answerAt(runDir, 'revise-1', [{ request: 1, decline: 'Not now.' }, { request: 2 }]);   // the proposer's is declined, the judge's pasted
    run(dir, ['--resume', runDir], { THC_PROMPT_LOG: log, THC_HELD_ALL: '1' });
    const later = promptsOf(log, /^panel-2-mock-a/);
    assert.ok(later.length > 0, 'the judge was asked again');
    assert.ok(later.every(p => !p.user.includes(notice)), 'a request the judge did not make is not told to it');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const dir2 = propProject(c => sharedKey(c)); const log2 = join(dir2, 'prompts.jsonl');
  try {
    run(dir2, ['--chain', 'reqs-prop', '--task', 'tasks/x.md'], { THC_PROMPT_LOG: log2, THC_HELD_ALL: '1' });
    const runDir = onlyRun(dir2);
    const notice = H.excerptDeclinedNotice({ path: 'src/b.js', lines: '1-2', reason: 'Not now.' });
    answerAt(runDir, 'revise-1', [{ request: 1 }, { request: 2, decline: 'Not now.' }]);   // control: the judge's own request declined
    run(dir2, ['--resume', runDir], { THC_PROMPT_LOG: log2, THC_HELD_ALL: '1' });
    assert.ok(promptsOf(log2, /^panel-2-mock-a/).some(p => p.user.includes(notice)), 'the judge reads the notice of its own declined request');
  } finally { rmSync(dir2, { recursive: true, force: true }); }
});

test('NO LATER PAUSE, both kinds: with the round cap at 1 no revise stage follows, so the proposer\'s and the judge\'s identical requests are TWO unanswered lines (answered_stage null, origin tells them apart); a second finish adds nothing', () => {
  const dir = propProject(c => sharedKey(c, { maxRounds: 1 }));
  try {
    const first = run(dir, ['--chain', 'reqs-prop', '--task', 'tasks/x.md'], { THC_HELD_ALL: '1' });
    assert.ok([0, 22].includes(first.status), `${first.status} ${first.stdout.slice(-300)}${first.stderr.slice(-300)}`);
    const runDir = onlyRun(dir);
    const rows = lines(join(runDir, 'excerpts.jsonl'));
    assert.deepEqual(rows.map(e => [e.origin, e.requested_by, e.path, e.lines, e.approval.status, e.answered_stage, e.approval.reason]), [
      ['debate-mock-a', 'mock-a', 'src/b.js', '1-2', 'unanswered', null, 'No handling session pause came after this request.'],
      ['panel-1-mock-a', 'mock-a', 'src/b.js', '1-2', 'unanswered', null, 'No handling session pause came after this request.'],
    ]);
    assert.equal(JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')).excerpts.count, 2);
    run(dir, ['--resume', runDir], { THC_HELD_ALL: '1' });
    assert.equal(lines(join(runDir, 'excerpts.jsonl')).length, 2, 'a second finish adds nothing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GATE CLOSED: a chain with a model builder and a model reviser asks its proposers for nothing (no sentence, no request, no line)', () => {
  const dir = propProject(c => { c.seats.builder = { provider: 'mock', model: 'mock-builder' }; c.seats.reviser = { provider: 'mock', model: 'mock-reviser' }; c.seats.critics[0].model = 'mock-critic-a'; }); const log = join(dir, 'prompts.jsonl');
  try {
    const first = run(dir, ['--chain', 'reqs-prop', '--task', 'tasks/x.md'], { THC_PROMPT_LOG: log, THC_HELD_ALL: '1' });
    assert.ok([0, 22].includes(first.status), `${first.status} ${first.stdout.slice(-300)}${first.stderr.slice(-300)}`);
    const debate = promptsOf(log, /^debate-/);
    assert.ok(debate.length > 0 && debate.every(p => !p.system.includes(H.textRequestsProposerField())), 'no proposer is told it may ask');
    assert.deepEqual(lines(join(onlyRun(dir), 'excerpts.jsonl')), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('NO LATER PAUSE, a judge: a request made in the last round (no revise stage followed) is recorded unanswered with answered_stage null', () => {
  const dir = project();
  try {
    const c = { ...CHAIN, maxRounds: 1 };
    writeFileSync(join(dir, 'chains', 'reqs.json'), JSON.stringify(c, null, 2));
    const first = run(dir, ['--chain', 'reqs', '--task', 'tasks/x.md'], { THC_HELD_ALL: '1' });
    assert.ok([0, 22].includes(first.status), `${first.status} ${first.stdout.slice(-300)}${first.stderr.slice(-300)}`);
    const rows = lines(join(onlyRun(dir), 'excerpts.jsonl'));
    assert.deepEqual(rows.map(e => [e.requested_by, e.path, e.approval.status, e.answered_stage]), [['rq', 'src/b.js', 'unanswered', null]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('PROPOSER list at the BUILD pause: stored in a fixed order and rebuilt the same at a resume', () => {
  const dir = propProject();
  try {
    const first = run(dir, ['--chain', 'reqs-prop', '--task', 'tasks/x.md'], { THC_HELD_ALL: '1' });
    assert.equal(first.status, 3);
    const runDir = onlyRun(dir);
    const stored = JSON.parse(readFileSync(join(runDir, 'build.prompt.json'), 'utf8')).text_requests;
    assert.ok(Array.isArray(stored) && stored.length === 1 && stored[0].origin === 'debate-mock-a');
    const again = run(dir, ['--resume', runDir], { THC_HELD_ALL: '1' });
    assert.equal(again.status, 3);
    assert.deepEqual(JSON.parse(readFileSync(join(runDir, 'build.prompt.json'), 'utf8')).text_requests, stored, 'the numbers the answers cite are stable across a resume');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
