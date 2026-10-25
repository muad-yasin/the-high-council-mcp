// M5g 4b (the maintainer's ruling, 11 Oct; the bug class "a tree MEMBER is told to resume itself" shipped three times: the pause notice, the three stops of tree-member-texts, and these): EVERY stop file a member can write names
// the tree's commands, never `--resume`, `--max-usd none` or `--allow-secret-shaped`, and the commands the text names are ACCEPTED by the real tree (a text that names a command the tree refuses is a hard lock).
// Part 1 drives a real member (api.run with a tree node, all-mock, $0) into every stop reachable with a mock and scans everything a person is shown. Part 2 runs the commands the text names through the real gate/handler.
// Part 3 scans src/cli.js: every STOPPED-*.md writer routes a member through memberStopContinue.
// NOT reachable with a mock (named, not skipped silently): STOPPED-user/client_cancel/wall_clock.json (advice runs only; an advice call is never a tree member), the denied-model variant of STOPPED-error.md (chain-lint refuses a denied
// model before a run exists; the template is the same one the error row drives), and the pre-run input refusals on stderr (exit 11 before any run folder: a member's task.md is written by the tree).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/api.js';
import { registerNextChild } from '../src/tree-loop.js';
import { decideHandler } from '../src/tree-decide.js';
import { resumeHandler } from '../src/tree-resume.js';
import { apiResumer } from '../src/tree-resume.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { externalChildren, pricedChildren, pricedDebate } from './helpers/child-chains.js';
import { approvePending, phases } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const FORBIDDEN = [/--resume/, /--max-usd none/, /--allow-secret-shaped/];
const startChild = (r, reg, extra = {}) => api.run({ chain: r.t.childChain, task: join(reg.bundleDir, 'task.md'), criteria: join(reg.bundleDir, 'criteria.json'), context: join(reg.bundleDir, 'context.md'), runId: reg.runId, treeNode: join(reg.bundleDir, 'node.json'), cwd: r.t.work, maxUsd: reg.grantUsd, ...extra });
/** Everything a person is shown by a stopped run: what the process printed, run.log and every STOPPED-*.md / NEEDS-*.md / RESUME.md in its folder. */
const shownOf = (dir, res) => [res?.outputTail ?? '', readFileSync(join(dir, 'run.log'), 'utf8'), ...readdirSync(dir).filter(f => /^(STOPPED-.*\.md|NEEDS-.*\.md|RESUME\.md)$/.test(f)).map(f => readFileSync(join(dir, f), 'utf8'))].join('\n');
const childWith = ({ seats = {}, top = {} } = {}) => { const c = pricedDebate(); return { ...c, ...top, seats: { ...c.seats, ...seats } }; };
const mockSeat = model => ({ provider: 'mock', model });
const KEY = ['sk', '-ant-api03-', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0'].join('');

// Each stop: how to build the tree, how to drive the member into it, the exit code, and the STOPPED file that must carry the tree commands.
const STOPS = [
  { name: 'budget (exit 4)', file: 'STOPPED-budget.md', exit: 4, root: () => pricedChildren(), run: (r, reg) => startChild(r, reg, { maxUsd: 0.01 }), commands: ['decide-topup', 'resume', 'close'] },
  { name: 'generic failure (exit 16)', file: 'STOPPED-error.md', exit: 16, root: () => ({ childChain: 'dead-child', extraChains: { 'dead-child': childWith({ seats: { builder: { provider: 'ollama', model: 'm', baseUrl: 'http://127.0.0.1:9/v1' } } }) } }), run: (r, reg) => startChild(r, reg), commands: ['resume', 'close'] },
  { name: 'secret-shaped prompt (exit 11)', file: 'STOPPED-secret.md', exit: 11, root: () => externalChildren(), run: async (r, reg) => {
    const first = await startChild(r, reg); assert.equal(first.exitCode, 3, first.outputTail);
    const dir = join(r.t.runsDir, reg.runId); writeFileSync(join(dir, 'build.md'), `# Plan\n\nUse ${KEY} here.\n`);
    return apiResumer({ work: r.t.work })({ runDir: dir, grantUsd: reg.grantUsd, node: 'R/M1', generation: 1, runId: reg.runId });
  }, commands: ['resume', 'close'] },
  { name: 'truncated: cut off at the token cap (exit 17)', file: 'STOPPED-truncated.md', exit: 17, root: () => ({ childChain: 'cut-child', extraChains: { 'cut-child': childWith({ seats: { builder: mockSeat('mock-draft-cut') } }) } }), run: (r, reg) => startChild(r, reg), commands: ['resume', 'close'] },
  { name: 'truncated: the provider ended the draft with stop "error" (exit 17)', file: 'STOPPED-truncated.md', exit: 17, root: () => ({ childChain: 'err-child', extraChains: { 'err-child': childWith({ seats: { builder: mockSeat('mock-draft-error') } }) } }), run: (r, reg) => startChild(r, reg), commands: ['resume', 'close'] },
  { name: 'truncated: a reply of only DECLINED lines (exit 17)', file: 'STOPPED-truncated.md', exit: 17, root: () => externalChildren(), run: async (r, reg) => {
    const first = await startChild(r, reg); assert.equal(first.exitCode, 3, first.outputTail);
    const dir = join(r.t.runsDir, reg.runId); writeFileSync(join(dir, 'build.md'), 'DECLINED: nothing here is a defect\nDECLINED: so I wrote nothing\n');
    return apiResumer({ work: r.t.work })({ runDir: dir, grantUsd: reg.grantUsd, node: 'R/M1', generation: 1, runId: reg.runId });
  }, commands: ['resume', 'close'] },
  { name: 'preflight objected to the task description (exit 10)', file: 'STOPPED-preflight.md', exit: 10, root: () => ({ childChain: 'pre-child', extraChains: { 'pre-child': childWith({ top: { preflight: { seats: [{ provider: 'mock', model: 'mock-preflight-object', lab: 'pre1' }] } } }) } }), run: (r, reg) => startChild(r, reg), commands: ['close'] },
];

async function driveStop(stop) {
  const r = await trackedRealRoot(stop.root()); approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(reg.kind, 'registered', JSON.stringify(reg));
  const res = await stop.run(r, reg);
  assert.equal(res.exitCode, stop.exit, `${stop.name}: ${res.outputTail}`);
  const dir = join(r.t.runsDir, reg.runId); const treeId = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).tree.treeId;
  return { r, reg, res, dir, treeId };
}

for (const stop of STOPS) {
  test(`a member's ${stop.name}: nothing a person is shown says --resume, --max-usd none or --allow-secret-shaped; ${stop.file} names the tree's commands`, { timeout: 300_000 }, async () => {
    const { reg, res, dir, treeId } = await driveStop(stop);
    const text = shownOf(dir, res);
    for (const re of FORBIDDEN) assert.doesNotMatch(text, re, `${stop.name}: no ${re} anywhere a person looks (stdout, run.log, STOPPED-*.md, NEEDS, RESUME.md)`);
    const md = readFileSync(join(dir, stop.file), 'utf8');
    if (stop.commands.includes('resume')) assert.ok(md.includes(`council tree resume ${treeId}`), `${stop.file} names the tree's resume`);
    else assert.doesNotMatch(md, /tree resume/, `${stop.file}: a command that only repeats the same stop is not offered`);
    assert.ok(md.includes(`council tree decide ${treeId} --close R/M1`), `${stop.file} names the exit: close the node`);
    if (stop.commands.includes('decide-topup')) assert.ok(md.includes(`council tree decide ${treeId} --top-up R/M1 --amount <usd>`), 'and the money way');
    assert.ok(reg.runId.length > 0);
  });
}

// Part 2: the commands the text names are ACCEPTED by the real tree. Typed step answers as the gate asks.
const decide = (r, flags, answers) => { const io = terminal(answers); return { io, run: () => decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }) }; };
const resumeIo = () => { let out = ''; let err = ''; return { stdout: { write: s => { out += s; return true; }, isTTY: false }, stderr: { write: s => { err += s; return true; } }, out: () => out, err: () => err }; };

for (const stop of STOPS) {
  test(`a member's ${stop.name}: \`tree decide --close\` (the exit the text names) is accepted and the node is closed`, { timeout: 300_000 }, async () => {
    const { r } = await driveStop(stop);
    const before = phases(r)['R/M1'];
    const d = decide(r, { close: 'R/M1' }, ['R/M1', 'y']);
    assert.equal(await d.run(), 0, `${stop.name} (node was ${before}): ${d.io.shown()}${d.io.errors()}`);
    assert.equal(phases(r)['R/M1'], 'closed', `${stop.name}: closed after the close`);
  });
}

test('budget stop: the top-up the text names is ACCEPTED for a member that really stopped at exit 4 (node_stopped in the record), and then `tree resume` resumes that node (a refused top-up would make the text wrong)', { timeout: 300_000 }, async () => {
  const stop = STOPS[0]; const { r } = await driveStop(stop);
  assert.equal(phases(r)['R/M1'], 'stopped', 'the member CLI wrote node_stopped at exit 4');
  const d = decide(r, { 'top-up': 'R/M1', amount: '5' }, ['5', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  let resumed = []; const io = resumeIo();
  const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), deps: { startRun: async () => ({ exitCode: 0 }), resumeRun: async a => { resumed.push(a.node); return { exitCode: 0 }; } } });
  assert.deepEqual(resumed, ['R/M1'], `tree resume resumed the topped-up node (code ${code}): ${io.out()}${io.err()}`);
});

test('error stop: `tree resume` (the first command the text names) resumes the interrupted node once, i.e. it is not refused', { timeout: 300_000 }, async () => {
  const stop = STOPS[1]; const { r } = await driveStop(stop);
  let resumed = []; const io = resumeIo();
  const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), deps: { startRun: async () => ({ exitCode: 0 }), resumeRun: async a => { resumed.push(a.node); return { exitCode: 16 }; } } });
  assert.deepEqual(resumed, ['R/M1'], `code ${code}: ${io.out()}${io.err()}`);
});

// Part 3: the mechanism. Every STOPPED-*.md writer in src/cli.js routes a tree member through memberStopContinue, so the next stop file cannot ship a direct --resume again.
test('src/cli.js: every STOPPED-*.md template calls memberStopContinue for a member (the writers are listed by name, so a new one fails here)', () => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js'), 'utf8');
  const writers = [...src.matchAll(/writeFileSync\(join\(runDir, 'STOPPED-([a-z]+)\.md'\)/g)];
  assert.deepEqual(writers.map(m => m[1]).sort(), ['budget', 'error', 'preflight', 'secret', 'truncated'], 'the STOPPED-*.md writers cli.js has: a new one must be listed here AND call memberStopContinue');
  for (const m of writers) {
    const rest = src.slice(m.index + m[0].length); const end = rest.search(/\n\s*(log\(|writeFileSync\(join\(runDir, 'STOPPED-|appendFileSync\(logPath)/);
    const body = rest.slice(0, end === -1 ? rest.length : end);
    assert.match(body, /memberStopContinue\(memberNotice, '(budget|secret|error|truncated|preflight)'\)/, `STOPPED-${m[1]}.md: a member gets its continue text from memberStopContinue`);
    assert.ok(/memberNotice \?/.test(body), `STOPPED-${m[1]}.md: the member branch is conditional on memberNotice (a plain run is unchanged)`);
  }
  assert.equal([...src.matchAll(/memberStopContinue\(memberNotice, 'truncated'\)/g)].length, 3, 'all three STOPPED-truncated.md variants');
});

// Part 2b: what the text SUGGESTS as a fix must be a fix the tree accepts. The tree pins the chain file (continuation check `chain`) and the input bundle (`bundle`), so "raise maxTokens" or "edit the task" would be refused; replacing a reply
// that lies in the run folder is not pinned. So the texts name the reply as the only fix, and close as the exit when the cause is the chain or the task. Driven with the REAL resumer (all-mock, $0).
const realResume = async r => { const codes = []; const inner = apiResumer({ work: r.t.work }); const io = resumeIo();
  const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), deps: { resumeRun: async a => { const res = await inner(a); codes.push(res.exitCode); return res; }, startRun: async () => ({ exitCode: 0 }) } });
  return { code, codes, text: io.out() + io.err() }; };

test('DECLINED-only stop: replacing the reply on disk with a complete plan and running `tree resume` is ACCEPTED (the member resumes, no exit 19)', { timeout: 300_000 }, async () => {
  const stop = STOPS.find(s => s.name.includes('DECLINED')); const { r, dir } = await driveStop(stop);
  writeFileSync(join(dir, 'build.md'), '# The provider plan\n\n## Overview\nThe store keeps every record.\n\nREVISED MOCK DELIVERABLE\n');
  const out = await realResume(r);
  assert.equal(out.codes.length, 1, out.text); assert.notEqual(out.codes[0], 19, `the tree refused the fix: ${out.text}`); assert.notEqual(out.codes[0], 17, `still the same stop: ${out.text}`);
});

test('cut-off and preflight stops: `tree resume` WITHOUT a fix runs the member again and stops at the same place (so the texts say the cause must be fixed first, and name close as the exit)', { timeout: 300_000 }, async () => {
  for (const [name, again] of [['truncated: cut off at the token cap (exit 17)', 17], ['preflight objected to the task description (exit 10)', 10]]) {
    const { r } = await driveStop(STOPS.find(s => s.name === name));
    const out = await realResume(r);
    assert.deepEqual(out.codes, [again], `${name}: ${out.text}`);
  }
});
