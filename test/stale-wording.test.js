// 0.8.4 T14 (CA2/D17, amended by the owner 05 Nov 2026 03:52): a run resumed after an UPDATE of THC's wording continues on its saved replies; nothing extra is paid; a changed CONTENT stays a cache miss (pre-release audit 5).
// Real verbs, offline, $0: a mock plain unanimous chain whose second critic is an external seat. Sitting 1 pauses at that seat with its two siblings (same layer, same pass) already answered and saved; the test then makes the folder look like one
// written by an OLDER THC (every record's writtenBy.version -> 0.0.1, every stored prompt hash -> a hash no prompt has), the person answers, and the run resumes.
//   T14-b  the update case: the siblings and the external answer are kept as saved, no call is made for them (their reservation lines do not grow), no CACHE STALENESS WARNING, the mark is in WARNINGS.md, run.log and report.json, and the resume line names --draft
//   T14-c  the audit-5 pin: the SAME version with a different stored prompt is a cache miss (stale, asked again), exactly as before
//   T14-d  an edited reply (its hash no longer matches) is asked again; its group-mate is still kept
//   T14-e  the records: a live stage carries writtenBy {version, sitting, text}; the pause's prompt.json carries {version, sitting} and no text; the external answer's usage file is bound to the SHOWN prompt hash and the asking sitting
//   T14-h  the cache hooks: a kept direct read gets the WARNINGS line and its first use writes the hash
//   T14-g  the pause file of a stage read outside invoke() carries the asking sitting and survives the consumption
//   T14-f  an old record with no writtenBy (a run paused before this version) stays a cache miss: the first upgrade is not covered (README Known limits)
// OBSERVABLE: a mock call writes no spend reservation (projected $0), so "no paid call" is read from the run log instead: a replayed stage prints `<label>: ... from disk`, a stage asked again prints the staleness warning and no such line.
// RED BASE 61a36cc1: the stage records carry no writtenBy, so T14-b, T14-d, T14-e, T14-g and T14-h fail on it; T14-c and T14-f PASS there (PINs of today's behaviour). No import of src/stale-guard.js: the file loads on that tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { submitStageAnswer } from '../src/stage-submission.js';
const hash12 = text => createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 12);   // the format of writtenBy.text (pinned by P9 in stale-guard.test.js); local so these rows load on a tree that has no src/stale-guard.js

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seat = (lab) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000 });
const chain = () => ({
  name: 'wc', signoff: 'unanimous', maxRounds: 2, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
    critics: [seat('l1'), { provider: 'external', model: 'claude-code-session', lab: 'l2' }, seat('l3')] },
});
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'wc-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'wc.json'), JSON.stringify(chain()));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  return { dir, run, done: () => rmSync(dir, { recursive: true, force: true }) };
};
const readJson = f => JSON.parse(readFileSync(f, 'utf8'));
const fromDisk = (out, label) => new RegExp(`${label}: [^\\n]*from disk`).test(out);   // the replay line of invoke(): no call was made
const keyLines = out => out.split('\n').filter(l => /CACHE STALENESS|earlier wording|from disk|--draft/.test(l)).join(' | ').slice(0, 600);   // diagnostics only: the lines the T14 rows' regexes read
// A paused folder: sitting 1 asked critics l1 and l3 (answered, saved) and paused at the external critic l2.
function paused() {
  const p = project();
  const r = p.run(['--chain', 'wc', '--task', 'tasks/t.md']);
  assert.equal(r.status, 3, `fixture: sitting 1 paused at the external critic: ${r.stdout}${r.stderr}`);
  const runDir = join(p.dir, 'runs', readdirSync(join(p.dir, 'runs'))[0]);
  assert.ok(existsSync(join(runDir, 'panel-1-l1.md')) && existsSync(join(runDir, 'panel-1-l3.md')), 'fixture: the two siblings were answered and saved');
  assert.ok(existsSync(join(runDir, 'NEEDS-panel-1-l2.md')), 'fixture: the external critic is waiting');
  return { ...p, runDir };
}
// Make every record look like it was written by an older THC (and answered an older wording).
function ageRecords(runDir, { version = '0.0.1', keepStamp = true, except = null } = {}) {   // `except`: records NOT aged (T14-f: the external critic's own, see there)
  for (const f of readdirSync(runDir).filter(x => /\.(usage|prompt)\.json$/.test(x) && !(except && except.test(x)))) {
    const j = readJson(join(runDir, f));
    if (j.promptHash) j.promptHash = 'f'.repeat(16);
    if (keepStamp && j.writtenBy) { j.writtenBy = { ...j.writtenBy, version }; delete j.writtenBy.code_sha256; } else delete j.writtenBy;
    writeFileSync(join(runDir, f), JSON.stringify(j));
  }
}
// The person answers through the real door (it writes the usage record with no prompt hash, as a session's answer does), with a sign-off copied from a sibling.
const answerExternal = runDir => submitStageAnswer(runDir, 'panel-1-l2', readFileSync(join(runDir, 'panel-1-l1.md'), 'utf8'), {});

test('T14-b an update between the pause and the resume: the siblings and the external answer are kept as saved, with no new call and no staleness warning, and the mark is recorded and shown', async t => {
  const p = paused();
  try {
    ageRecords(p.runDir);
    answerExternal(p.runDir);
    const r = p.run(['--resume', p.runDir]);
    const out = r.stdout + r.stderr;
    t.diagnostic(`T14-b flags: status=${r.status} stalenessWarning=${/CACHE STALENESS WARNING/.test(out)} fromDisk(l1,l3)=${JSON.stringify(['panel-1-l1', 'panel-1-l3'].map(l => fromDisk(out, l)))} earlierWording(l1,l2,l3)=${JSON.stringify(['panel-1-l1', 'panel-1-l2', 'panel-1-l3'].map(l => new RegExp(`stage "${l}" was answered under THC's earlier wording`).test(out)))} draft=${/--draft/.test(out)}`.slice(0, 600));
    t.diagnostic(`T14-b keyLines: ${JSON.stringify(keyLines(out))}`.slice(0, 600));
    t.diagnostic(`T14-b out tail: ${JSON.stringify(out.slice(-400))}`.slice(0, 600));
    assert.doesNotMatch(out, /CACHE STALENESS WARNING/, out);
    for (const l of ['panel-1-l1', 'panel-1-l3']) assert.ok(fromDisk(out, l), `${l}: replayed from disk, no call (the sibling case)\n${out}`);
    for (const l of ['panel-1-l1', 'panel-1-l2', 'panel-1-l3']) assert.match(out, new RegExp(`stage "${l}" was answered under THC's earlier wording`), `${l}: the run.log line`);
    assert.match(out, /--draft/, 'the line names the other choice, a new run');
    // CHANGED (0.8.4 T14 fix-up, 08 Nov 2026; box diagnostics: the resume stops again at the round-2 external critic, exit 3, and a paused run writes no report). OLD: the test read report.json after the one resume. NEW: the further pause is answered through the real door (a sign-off copied from a sibling, as answerExternal does) and the run resumed until it ends; every assertion above reads the FIRST resume's output.
    let again = r;
    for (let i = 0; i < 4 && again.status === 3; i++) {
      const m = /PAUSED: stage "([^"]+)" is an external seat/.exec(again.stdout + again.stderr);
      if (!m) break;
      const sibling = join(p.runDir, `${m[1].replace(/-l2$/, '-l1')}.md`);   // the same pass's sibling sign-off, as answerExternal does for round 1
      submitStageAnswer(p.runDir, m[1], readFileSync(existsSync(sibling) ? sibling : join(p.runDir, 'panel-1-l1.md'), 'utf8'), {});
      again = p.run(['--resume', p.runDir]);
    }
    const warnings = readFileSync(join(p.runDir, 'WARNINGS.md'), 'utf8');
    t.diagnostic(`T14-b WARNINGS.md: ${JSON.stringify(warnings.slice(0, 500))}`.slice(0, 600));
    assert.match(warnings, /- answered_under_earlier_wording: stage "panel-1-l3" \(pass 1\) was answered under THC's earlier wording \(written by 0\.0\.1\) and was kept as it is in sitting 2/);
    const doc = existsSync(join(p.runDir, 'report.json')) ? readJson(join(p.runDir, 'report.json')) : readJson(join(p.runDir, 'report-partial.json'));
    t.diagnostic(`T14-b report answered_under_earlier_wording: ${String(JSON.stringify(doc.answered_under_earlier_wording))}`.slice(0, 600));
    assert.ok(Array.isArray(doc.answered_under_earlier_wording) && doc.answered_under_earlier_wording.some(k => k.stage === 'panel-1-l3' && k.pass === 1 && k.cause === 'prompt' && k.written_under === '0.0.1'), JSON.stringify(doc.answered_under_earlier_wording));
    // the external answer's record claims the prompt it was SHOWN, never today's, and is stamped with the sitting that ASKED and the hash of the answer on disk
    const u = readJson(join(p.runDir, 'panel-1-l2.usage.json'));
    t.diagnostic(`T14-b panel-1-l2.usage.json: ${JSON.stringify({ promptHash: u.promptHash, writtenBy: u.writtenBy, hashOfReplyOnDisk: hash12(readFileSync(join(p.runDir, 'panel-1-l2.md'), 'utf8')) })}`.slice(0, 600));
    assert.equal(u.promptHash, 'f'.repeat(16), 'bound to the shown hash, not the current prompt');
    assert.equal(u.writtenBy.sitting, 1, 'the asking sitting (the pause\'s prompt.json), not the resume');
    assert.equal(u.writtenBy.version, '0.0.1');
    assert.equal(u.writtenBy.text, hash12(readFileSync(join(p.runDir, 'panel-1-l2.md'), 'utf8')));
  } finally { p.done(); }
});

test('T14-c PIN (today\'s behaviour, audit 5): records written by the SAME version whose stored prompt differs are asked again; the staleness warning is printed and the sibling is a paid re-ask', async t => {
  const p = paused();
  try {
    // CHANGED (0.8.4 T14 fix-up, 08 Nov 2026; box diagnostics): the external critic's own records (panel-1-l2.*) are NOT aged: aged, its answer no longer matched the prompt shown and the resume paused at the critic again before the siblings were asked, so the sibling's warning never printed.
    for (const f of readdirSync(p.runDir).filter(x => /\.(usage|prompt)\.json$/.test(x) && !/^panel-1-l2\./.test(x))) { const j = readJson(join(p.runDir, f)); if (j.promptHash) j.promptHash = 'f'.repeat(16); writeFileSync(join(p.runDir, f), JSON.stringify(j)); }   // writtenBy untouched: same code
    answerExternal(p.runDir);
    const rc = p.run(['--resume', p.runDir]);
    const out = rc.stdout + rc.stderr;
    t.diagnostic(`T14-c flags: status=${rc.status} stalenessWarningL3=${/CACHE STALENESS WARNING: stage "panel-1-l3"/.test(out)} fromDisk(l3)=${fromDisk(out, 'panel-1-l3')} earlierWording=${/answered under THC's earlier wording/.test(out)}`.slice(0, 600));
    t.diagnostic(`T14-c keyLines: ${JSON.stringify(keyLines(out))}`.slice(0, 600));
    t.diagnostic(`T14-c out tail: ${JSON.stringify(out.slice(-400))}`.slice(0, 600));
    assert.match(out, /CACHE STALENESS WARNING: stage "panel-1-l3"/, out);
    assert.equal(fromDisk(out, 'panel-1-l3'), false, 'the sibling was asked again, not replayed');
    assert.doesNotMatch(out, /answered under THC's earlier wording/);
  } finally { p.done(); }
});

test('T14-d a reply edited after it was saved is asked again; its group-mate is still kept (a hand edit does not spread to a sibling that reads none of it)', () => {
  const p = paused();
  try {
    ageRecords(p.runDir);
    writeFileSync(join(p.runDir, 'panel-1-l1.md'), readFileSync(join(p.runDir, 'panel-1-l1.md'), 'utf8') + '\nEdited by hand.\n');
    answerExternal(p.runDir);
    const out = (r => r.stdout + r.stderr)(p.run(['--resume', p.runDir]));
    assert.match(out, /CACHE STALENESS WARNING: stage "panel-1-l1"/, 'the edited reply is a miss');
    assert.doesNotMatch(out, /CACHE STALENESS WARNING: stage "panel-1-l3"/, 'the sibling is kept');
    assert.ok(fromDisk(out, 'panel-1-l3'), 'the sibling was replayed, no call');
  } finally { p.done(); }
});

test('T14-e the records: a live stage carries writtenBy {version, sitting 1, text}; the pause\'s prompt.json carries {version, sitting} and no text; the hash is over the reply on disk', () => {
  const p = paused();
  try {
    const u = readJson(join(p.runDir, 'panel-1-l1.usage.json'));
    assert.equal(u.writtenBy.sitting, 1);
    assert.equal(typeof u.writtenBy.version, 'string');
    assert.equal(u.writtenBy.text, hash12(readFileSync(join(p.runDir, 'panel-1-l1.md'), 'utf8')));
    const pj = readJson(join(p.runDir, 'panel-1-l2.prompt.json'));
    assert.equal(pj.writtenBy.sitting, 1);
    assert.equal('text' in pj.writtenBy, false, 'the answer did not exist yet');
    assert.equal(readJson(join(p.runDir, 'run.json')).sittings.length, 1);
  } finally { p.done(); }
});

test('T14-f PIN (a named limit): a record with no writtenBy (a run paused before this version) is a cache miss when its prompt differs, update or not: the first upgrade is not covered', async t => {
  const p = paused();
  try {
    ageRecords(p.runDir, { keepStamp: false, except: /^panel-1-l2\./ });   // CHANGED (0.8.4 T14 fix-up, 08 Nov 2026; box diagnostics for T14-c and T14-f): the external critic's own pause and answer records are NOT aged. OLD: they were, so the answer no longer matched the prompt shown, the resume paused at the critic again before the siblings were asked and the sibling's warning never printed. The siblings are what these rows are about.
    answerExternal(p.runDir);
    const rf = p.run(['--resume', p.runDir]);
    const out = rf.stdout + rf.stderr;
    t.diagnostic(`T14-f flags: status=${rf.status} stalenessWarningL1=${/CACHE STALENESS WARNING: stage "panel-1-l1"/.test(out)} earlierWording=${/answered under THC's earlier wording/.test(out)} fromDisk(l1,l3)=${JSON.stringify(['panel-1-l1', 'panel-1-l3'].map(l => fromDisk(out, l)))}`.slice(0, 600));
    t.diagnostic(`T14-f keyLines: ${JSON.stringify(keyLines(out))}`.slice(0, 600));
    t.diagnostic(`T14-f out tail: ${JSON.stringify(out.slice(-400))}`.slice(0, 600));
    assert.match(out, /CACHE STALENESS WARNING: stage "panel-1-l1"/, out);
    assert.doesNotMatch(out, /answered under THC's earlier wording/);
  } finally { p.done(); }
});

test('T14-g the pause of a stage read outside invoke() (the handler\'s answers) leaves `answers.prompt.json` with writtenBy {version, sitting 1} and no text, and the file stays after the answer is consumed (the record test/stale-wording-direct.test.js rests on)', () => {
  const p = project();
  try {
    const r = p.run(['--chain', 'mock-questions-wait', '--task', 'tasks/t.md']);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    const runDir = join(p.dir, 'runs', readdirSync(join(p.dir, 'runs'))[0]);
    const pj = readJson(join(runDir, 'answers.prompt.json'));
    assert.equal(pj.writtenBy.sitting, 1);
    assert.equal('text' in pj.writtenBy, false, 'the answer did not exist yet');
    writeFileSync(join(runDir, 'answers.md'), '1. default\n');
    p.run(['--resume', runDir]);
    assert.ok(existsSync(join(runDir, 'answers.prompt.json')), 'consuming the answer does not move the pause file');
  } finally { p.done(); }
});

test('T14-h the cache hooks for a stage read outside invoke(): an answer kept under the earlier wording of its own prompt gets the WARNINGS line, and its first use writes the reply\'s hash into the pause record', () => {
  const p = project();
  try {
    const first = p.run(['--chain', 'mock-questions-wait', '--task', 'tasks/t.md']);
    assert.equal(first.status, 3, first.stdout + first.stderr);
    const runDir = join(p.dir, 'runs', readdirSync(join(p.dir, 'runs'))[0]);
    const f = join(runDir, 'answers.prompt.json');
    const pj = readJson(f);
    writeFileSync(f, JSON.stringify({ ...pj, promptHash: 'f'.repeat(16), writtenBy: { ...pj.writtenBy, version: '0.0.1' } }));   // asked under an older THC, a prompt no longer asked
    writeFileSync(join(runDir, 'answers.md'), '1. default\n');
    const r = p.run(['--resume', runDir]);
    const out = r.stdout + r.stderr;
    assert.doesNotMatch(out, /CACHE STALENESS WARNING: stage "answers"/, out);
    assert.match(out, /stage "answers" was answered under THC's earlier wording/);
    assert.match(readFileSync(join(runDir, 'WARNINGS.md'), 'utf8'), /- answered_under_earlier_wording: stage "answers" was answered under THC's earlier wording \(written by 0\.0\.1\) and was kept as it is in sitting 2/);
    assert.equal(readJson(f).writtenBy.text, hash12('1. default\n'), 'the first use bound the hash of the answer on disk');
  } finally { p.done(); }
});
