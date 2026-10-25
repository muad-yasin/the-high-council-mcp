// M5f (the maintainer, 10 Oct): a tree MEMBER's pause notice (NEEDS-<stage>.md, the PAUSED log line, RESUME.md) names the tree, node@generation, run and stage and gives `council tree resume <treeId>` as THE command; the
// direct `--resume runs/<id>` line is ABSENT for a member. A plain run's notice is unchanged. All-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apiStarter, runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { externalChildren } from './helpers/child-chains.js';
import { approvePending } from './helpers/sitting.js';
import { generateResumeBrief } from '../src/resume-brief.js';
import { memberResumeRedirect } from '../src/tree-redirect.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');

test('a paused tree MEMBER (real): NEEDS-build.md and RESUME.md name tree, node@g, run and stage and give the tree command; the direct --resume line is absent', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(externalChildren()); approvePending(r);
  const first = await runTree(r.t.rootDir, { work: r.t.work, startRun: apiStarter({ work: r.t.work }) });
  assert.equal(first.status, 'waiting');
  const dir = join(r.t.runsDir, first.runId); const treeId = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).tree.treeId;
  const need = readFileSync(join(dir, 'NEEDS-build.md'), 'utf8'); const brief = readFileSync(join(dir, 'RESUME.md'), 'utf8');
  for (const [name, text] of [['NEEDS-build.md', need], ['RESUME.md', brief]]) {
    assert.match(text, new RegExp(`tree ${treeId}, node R/M1@g1, run ${first.runId}`), `${name} names tree, node@generation and run`);
    assert.match(text, new RegExp(`tree resume ${treeId}`), `${name} gives the tree command`);
    assert.doesNotMatch(text, /--resume runs\//, `${name}: the direct --resume line is ABSENT for a member`);
    assert.doesNotMatch(text, /resume_run\(/, `${name} does not send a member to resume_run`);
  }
  const log = readFileSync(join(dir, 'run.log'), 'utf8');
  assert.match(log, new RegExp(`resume:  .*tree resume ${treeId}   \\(tree ${treeId}, node R/M1@g1, run ${first.runId}; a tree member is resumed only by its tree\\)`), 'the PAUSED line');
  assert.doesNotMatch(log, /--resume runs\//, 'and the log has no direct --resume line either');
  assert.match(need, /stage build\)/); assert.match(need, /The tree resumes this node and holds the answer to the prompt below/);
  assert.match(need, /## System prompt[^]*## User prompt/, 'the prompts are still there');
  assert.match(brief, /Tree member: tree .*, node R\/M1@g1, run .*\. Resumed only by its tree: `council tree resume /); assert.match(brief, /resume_run does not resume a tree member/);
});

test('a PLAIN run\'s notice is unchanged: NEEDS-build.md keeps the direct --resume line, RESUME.md keeps resume_run, and the log says so', () => {
  const base = mkdtempSync(join(tmpdir(), 'thc-notice-')); const work = join(base, 'work'); mkdirSync(join(work, 'tasks'), { recursive: true });
  try {
    writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
    const p = spawnSync(process.execPath, [cli, '--chain', 'mock-external', '--task', 'tasks/t.md', '--max-usd', 'none'], { cwd: work, env: { PATH: process.env.PATH, HOME: work }, encoding: 'utf8' });
    assert.equal(p.status, 3); const id = readdirSync(join(work, 'runs'))[0]; const dir = join(work, 'runs', id);
    assert.match(readFileSync(join(dir, 'NEEDS-build.md'), 'utf8'), new RegExp(`--resume runs/${id}\\n`)); assert.doesNotMatch(readFileSync(join(dir, 'NEEDS-build.md'), 'utf8'), /tree/i);
    assert.match(p.stdout + p.stderr, new RegExp(`resume:  .*--resume runs/${id}`)); assert.doesNotMatch(readFileSync(join(dir, 'RESUME.md'), 'utf8'), /Tree member|tree resume/);
    assert.match(readFileSync(join(dir, 'RESUME.md'), 'utf8'), /Call resume_run\(/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('generateResumeBrief: a member with no pending stage is sent to the tree command, not to resume_run; an unreadable tree id still avoids the direct command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-brief-'));
  try {
    const member = memberResumeRedirect({ tree: { treeId: '2026-10-09T10-00-00-000Z', node: 'R/M2', generation: 2 } }, 'run-9');
    const text = generateResumeBrief({ runId: 'run-9', dir, runMeta: { chain: 'x', task: 't' }, chainConfig: null, member });
    assert.match(text, /Tree member: tree 2026-10-09T10-00-00-000Z, node R\/M2@g2, run run-9\. Resumed only by its tree: `council tree resume 2026-10-09T10-00-00-000Z`/);
    assert.match(text, /resume_run does not resume a tree member/); assert.doesNotMatch(text, /Call resume_run\(/);
    const bad = generateResumeBrief({ runId: 'run-9', dir, runMeta: { chain: 'x', task: 't' }, chainConfig: null, member: memberResumeRedirect({ tree: { treeId: '$(x)', node: 'R' } }, 'run-9') });
    writeFileSync(join(dir, 'NEEDS-build.md'), '# External stage: build\n');                             // a pending external stage
    const pending = generateResumeBrief({ runId: 'run-9', dir, runMeta: { chain: 'x', task: 't' }, chainConfig: null, member });
    assert.match(pending, /Answer stage "build" \(prepare_stage_prompt\("run-9", "build"\) bundles it; submit_stage writes the answer and does NOT resume a tree member\), then run `council tree resume 2026-10-09T10-00-00-000Z` in a terminal \(tree 2026-10-09T10-00-00-000Z, node R\/M2@g2, run run-9, stage build\)/);
    assert.doesNotMatch(pending, /--resume runs\//);
    assert.match(bad, /council tree resume <the tree's root run id>/); assert.doesNotMatch(bad, /\$\(x\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
