// 0.8.4 L3, REAL VERBS ($0, mock chains, the product's own CLI and the tree handlers): (V1) `--resume <run> --finish` at an overseer cap: the terminal verdict line, deliverable.md's dispute block, BOARD.md and report.json
// say that layer 3 did not sign off, and the exit stays 22; (V2) a run that is NOT a person's finish keeps the old verdict line (control); (V3) a tree member stopped at its overseer limit: the sitting line, and the
// decide screen's second line when `tree decide --finish-node` records the choice (before anything is applied); (V4) the decide line is silent when the member's partial report holds no layers[].
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { resumeHandler } from '../src/tree-resume.js';
import { decideHandler } from '../src/tree-decide.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { realRoot } from './helpers/real-root.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { pricedDebate } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const PHRASE = 'layer 3 did not sign off on this plan';

// ---- the CLI rows (the project of test/overseer-choice.test.js: the top layer always objects, the cap is 2 overseer rounds) ----
const chainOf = (critics, over = {}) => ({
  name: 'ovc', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...over,
});
const project = (over = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'l3-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'ovc.json'), JSON.stringify(chainOf([judge('o', 'la', 'l1', 1), judge('o', 'lb', 'l2', 2), judge('x', 'lc', 'l3', 3)], over)));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  return { dir, run, done: () => rmSync(dir, { recursive: true, force: true }) };
};

test('L3-V1 --finish at the overseer cap: the verdict line, the dissent block, BOARD.md and report.json say layer 3 did not sign off; passed false, dispute.reason finish_chosen and exit 22 are unchanged', () => {
  const p = project({ dispute: { enabled: true, stall_rounds: 99 } });
  try {
    const first = p.run(['--chain', 'ovc', '--task', 'tasks/t.md']);
    assert.equal(first.status, 23, first.stdout + first.stderr);
    const runDir = join(p.dir, 'runs', readdirSync(join(p.dir, 'runs'))[0]);
    const r = p.run(['--resume', runDir, '--finish']);
    assert.equal(r.status, 22, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`verdict: +stopped with open failures; ${PHRASE} \\(see report\\.json\\)`));
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    assert.equal(report.passed, false); assert.equal(report.stop.chosen, 'finish'); assert.equal(report.dispute.reason, 'finish_chosen');
    assert.ok(readFileSync(join(runDir, 'deliverable.md'), 'utf8').includes(`the person chose to finish at this stop: the overseer-round limit was reached; the panel did not agree, and ${PHRASE})`));
    assert.ok(readFileSync(join(runDir, 'BOARD.md'), 'utf8').includes('## Not agreed: finished at the person\'s choice\n\nLayer 3 did not sign off on this plan.\n'));
  } finally { p.done(); }
});

test('L3-V2 control: a run whose panel did not agree and that nobody finished keeps the old verdict line and BOARD (no layer-3 sentence)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'l3-ctl-'));   // a folder with only the task, as test/exit-not-agreed.test.js: a local chains/ folder could shadow the shipped mock-dispute
  try {
    mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a small reading list app.');
    const r = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), '--chain', 'mock-dispute', '--task', 'tasks/x.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    assert.equal(r.status, 22, r.stdout + r.stderr);
    assert.match(r.stdout, /verdict: +stopped with open failures \(see report\.json\)/);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    // CHANGED (box run of 08 Nov 2026): an unlayered mock-dispute run writes no BOARD.md (renderBoardMd returns '' for a run with no board section), so the row read a file that was never there (ENOENT); every file the run did write is checked for the layer-3 sentence.
    for (const f of ['BOARD.md', 'deliverable.md', 'report.json']) if (existsSync(join(runDir, f))) assert.doesNotMatch(readFileSync(join(runDir, f), 'utf8'), /finished at the person's choice|did not sign off on this plan/, f);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the tree member rows (the fixture of test/tree-member-verb-rows.test.js) ----
const layered = (base, id) => { const { maxRounds, ...rest } = base; return ({ ...rest, signoff: 'unanimous', maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 }, estimate: { promptTokens: 1500, draftTokens: 1500, critiqueTokens: 300 },
  seats: { ...base.seats, critics: [judge('o', `${id}a`, 'l1a', 1), judge('o', `${id}b`, 'l1b', 1), judge('o', `${id}c`, 'l2a', 2), judge('o', `${id}d`, 'l2b', 2), judge('x', `${id}e`, 'l3a', 3), judge('x', `${id}f`, 'l3b', 3)] } }); };
const quiet = () => { const stdout = new PassThrough(); const stderr = new PassThrough(); const buf = []; stdout.on('data', d => buf.push(String(d))); stderr.on('data', d => buf.push(String(d))); return { stdout, stderr, text: () => buf.join('') }; };
const sit = async (r, deps = {}) => { const o = quiet(); const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: o.stdout, stderr: o.stderr, deps }); return { code, text: o.text() }; };
const choose = async (r, flag, node) => { const t = terminal([]); const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { [flag]: node }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }); return { code, text: t.shown() + t.errors() }; };
const state = r => stateOf(readTreeRecord(r.t.rootDir));
const runDirOf = (r, node) => join(r.t.work, 'runs', state(r).nodes.get(`${node}@g1`).runId);
async function stoppedTree() {
  const r = await realRoot({ childChain: 'lay-child', extraChains: { 'lay-child': layered(pricedDebate(), 'm') } });
  approvePending(r);
  const first = await sit(r, { startRun: draftStarter(r) });
  return { r, first };
}

test('L3-V3 a member stopped at its overseer limit: the sitting line says the top layer did not sign off in the finish parenthesis; `tree decide --finish-node` prints its word unchanged and then a second line naming layer 3', async () => {
  const { r, first } = await stoppedTree();
  assert.match(first.text, /overseer-round limit/i, first.text);
  assert.ok(first.text.includes('the result stays not agreed, and the top layer did not sign off on this plan); then'), first.text);
  const c = await choose(r, 'finish-node', 'R/M1');
  assert.equal(c.code, 0, c.text);
  const lines = c.text.split('\n');
  const at = lines.findIndex(l => l.startsWith('Recorded: R/M1@g1 will finish: the dispute stage and the handoff run, and the result stays "not agreed" when it is resumed'));
  assert.ok(at >= 0, c.text);
  assert.equal(lines[at + 1], 'Layer 3 did not sign off on this plan.', 'the second line follows the Recorded line');
  assert.match(lines[at + 2], /^Money: /, 'and comes before the Money line');
});

test('L3-V4 the decide line is silent, never a claim, when the member\'s partial report holds no layers[]', async () => {
  const { r } = await stoppedTree();
  const dir = runDirOf(r, 'R/M1');
  const partial = JSON.parse(readFileSync(join(dir, 'report-partial.json'), 'utf8'));
  assert.ok(Array.isArray(partial.layers) && partial.layers.length, 'the premise: the partial report carries layers[]');
  delete partial.layers;
  writeFileSync(join(dir, 'report-partial.json'), JSON.stringify(partial));
  const c = await choose(r, 'finish-node', 'R/M1');
  assert.equal(c.code, 0, c.text);
  assert.match(c.text, /^Recorded: R\/M1@g1 will finish:/m);
  assert.doesNotMatch(c.text, /did not sign off/i);
});
