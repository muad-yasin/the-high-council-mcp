// M5g (the maintainer, 10 Oct, "both YES"): no direct `--resume runs/<id>` string reaches a tree MEMBER on the paths that used to print one: the budget stop (STOPPED-budget.md + the log's resume line: the money way
// is `council tree decide <treeId> --top-up <node> --amount <usd>`), the secret-shaped refusal (STOPPED-secret.md) and the generic failure (STOPPED-error.md). A plain run still prints them. All-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as api from '../src/api.js';
import { registerNextChild } from '../src/tree-loop.js';
import { runTree, apiStarter } from '../src/tree-run.js';
import { apiResumer } from '../src/tree-resume.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { externalChildren, pricedChildren, pricedDebate } from './helpers/child-chains.js';
import { approvePending } from './helpers/sitting.js';

const startChild = (t, reg, extra = {}) => api.run({ chain: t.r.t.childChain, task: join(reg.bundleDir, 'task.md'), criteria: join(reg.bundleDir, 'criteria.json'), context: join(reg.bundleDir, 'context.md'), runId: reg.runId, treeNode: join(reg.bundleDir, 'node.json'), cwd: t.work, maxUsd: reg.grantUsd, ...extra });
/** Everything a person is shown by a stopped run: its log and every STOPPED-* / NEEDS-* file, plus what the process printed. */
const shown = (dir, res) => [res?.outputTail ?? '', readFileSync(join(dir, 'run.log'), 'utf8'), ...readdirSync(dir).filter(f => /^(STOPPED-.*\.md|NEEDS-.*\.md|RESUME\.md)$/.test(f)).map(f => readFileSync(join(dir, f), 'utf8'))].join('\n');
const deadChild = () => { const c = pricedDebate(); return { ...c, seats: { ...c.seats, builder: { provider: 'ollama', model: 'm', baseUrl: 'http://127.0.0.1:9/v1' } } }; };

test('a member\'s BUDGET stop (exit 4) points at `tree decide --top-up`, never at `--resume runs/<id>`; the tree resumes it afterwards', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(reg.kind, 'registered');
  const res = await startChild({ r, work: r.t.work }, reg, { maxUsd: 0.01 });
  assert.equal(res.exitCode, 4, res.outputTail);
  const dir = join(r.t.runsDir, reg.runId); const text = shown(dir, res); const treeId = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).tree.treeId;
  assert.doesNotMatch(text, /--resume runs\//, 'no direct resume line on a budget stop of a member');
  assert.ok(text.includes(`council tree decide ${treeId} --top-up R/M1 --amount <usd>`), 'the money way: a top-up by the tree');
  assert.ok(text.includes(`council tree resume ${treeId}`), 'and then the tree resumes it');
  assert.doesNotMatch(readFileSync(join(dir, 'STOPPED-budget.md'), 'utf8'), /--max-usd none/, 'a member cannot continue with no ceiling (--max-usd none is refused for a member)');
});

test('a member\'s GENERIC FAILURE (exit 16, STOPPED-error.md) names the tree command, not `--resume runs/<id>`', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot({ childChain: 'dead-child', extraChains: { 'dead-child': deadChild() } }); approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(reg.kind, 'registered', JSON.stringify(reg));
  const res = await startChild({ r, work: r.t.work }, reg);
  assert.equal(res.exitCode, 16, res.outputTail);
  const dir = join(r.t.runsDir, reg.runId); const text = shown(dir, res); const treeId = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).tree.treeId;
  assert.doesNotMatch(text, /--resume runs\//); assert.ok(readFileSync(join(dir, 'STOPPED-error.md'), 'utf8').includes(`council tree resume ${treeId}`));
});

test('a member\'s SECRET-SHAPED refusal (exit 11, STOPPED-secret.md) names the tree command, not `--resume runs/<id>`', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(externalChildren()); approvePending(r);
  const first = await runTree(r.t.rootDir, { work: r.t.work, startRun: apiStarter({ work: r.t.work }) });
  assert.equal(first.status, 'waiting'); const dir = join(r.t.runsDir, first.runId);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dir, 'build.md'), `# Plan\n\nUse ${['sk', '-ant-api03-', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0'].join('')} here.\n`);
  const res = await apiResumer({ work: r.t.work })({ runDir: dir, grantUsd: 5, node: 'R/M1', generation: 1, runId: first.runId });
  assert.equal(res.exitCode, 11, res.outputTail);
  const text = shown(dir, res); const treeId = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).tree.treeId;
  assert.doesNotMatch(text, /--resume runs\//); assert.ok(readFileSync(join(dir, 'STOPPED-secret.md'), 'utf8').includes(`council tree resume ${treeId}`));
});

// ONE spelling of the invocation (M5g (b); the maintainer, 10 Oct): a member's brief (RESUME.md, run_status brief) and the MCP reply print the same `<council> tree resume <treeId>` the pause notice prints. The
// spelling is councilCommand(): `npx the-high-council` when npm runs us through npx (npm_command=exec), `council` otherwise. All offline, $0.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memberResumeRedirect, memberResumeCommand, memberTopUpCommand } from '../src/tree-redirect.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';
import { generateResumeBrief } from '../src/resume-brief.js';

const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src/cli.js');
const LINEAGE = { treeId: '2026-10-09T10-00-00-000Z', node: 'R/M1', generation: 1, attempt: 1 };
const NPX = 'npx the-high-council';

test('the redirect, the resume command, the top-up command and the member brief all take ONE spelling from the redirect (default `council`; npx when given)', () => {
  const plain = memberResumeRedirect({ tree: LINEAGE }, 'run-1'); const npx = memberResumeRedirect({ tree: LINEAGE }, 'run-1', NPX);
  assert.equal(plain.command, `council tree resume ${LINEAGE.treeId}`); assert.equal(npx.command, `${NPX} tree resume ${LINEAGE.treeId}`);
  assert.equal(memberResumeCommand(npx), npx.command, 'memberResumeCommand follows the spelling the redirect carries'); assert.equal(memberResumeCommand(plain), plain.command);
  assert.equal(memberTopUpCommand(npx), `${NPX} tree decide ${LINEAGE.treeId} --top-up R/M1 --amount <usd>`);
  assert.ok(memberResumeRedirect({ tree: { treeId: '$(x)', node: 'R' } }, 'r1', NPX).text.includes(`${NPX} tree resume <the tree's root run id>`), 'the no-id sentence is spelled the same way');
  for (const [name, runMeta, extra] of [['paused at a stage', { chain: 'c', task: 't' }, 'NEEDS'], ['no stage waiting', { chain: 'c', task: 't' }, null]]) {
    const dir = mkdtempSync(join(tmpdir(), 'thc-member-brief-')); try {
      if (extra) writeFileSync(join(dir, 'NEEDS-build.md'), '# stage\n');
      const brief = generateResumeBrief({ runId: 'run-1', dir, runMeta, chainConfig: { seats: {} }, member: npx });
      assert.ok(brief.includes(`\`${npx.command}\``), `${name}: the brief names the npx spelling`);
      assert.doesNotMatch(brief, /`council tree resume/, `${name}: and not the bare one`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('over MCP under npx (npm_command=exec): the member redirect (resume_run, submit_stage) and the regenerated brief all spell `npx the-high-council tree resume <treeId>`', async () => {
  const base = mkdtempSync(join(tmpdir(), 'thc-member-mcp-')); try {
    const work = join(base, 'work'); mkdirSync(join(work, 'tasks'), { recursive: true }); writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
    const p = spawnSync(process.execPath, [cliPath, '--chain', 'mock-external', '--task', 'tasks/t.md', '--max-usd', 'none'], { cwd: work, env: { PATH: process.env.PATH, HOME: work }, encoding: 'utf8' });
    assert.equal(p.status, 3, `fixture: paused at its external stage: ${p.stdout}${p.stderr}`);
    const id = readdirSync(join(work, 'runs'))[0]; const dir = join(work, 'runs', id);
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')), tree: LINEAGE }));
    writeFileSync(join(dir, 'NEEDS-extra.md'), '# a second stage nobody answered\n');            // so submit_stage's reply is the member's "more stages left" reply (the branch that reads the redirect; an only-stage answer goes through resume())
    const replies = await new Promise((done, fail) => {
      const child = spawn(process.execPath, [cliPath, '--mcp'], { cwd: work, env: { PATH: process.env.PATH, HOME: work, ...malformedProviderKeys(), npm_command: 'exec' } });
      const timer = setTimeout(() => { child.kill(); fail(new Error('timed out')); }, 60_000); const byId = new Map(); let buf = '';
      child.stdout.on('data', d => { buf += d; let nl; while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not JSON-RPC */ } }
        if (byId.has(2) && byId.has(3) && byId.has(4)) { clearTimeout(timer); child.stdin.end(); child.kill(); done([byId.get(2), byId.get(3), byId.get(4)]); } });
      child.stdin.write([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'tree-member-texts', version: '0' } } }, { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'resume_run', arguments: { run: id } } }, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run_status', arguments: { run: id, brief: true } } }, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'submit_stage', arguments: { run: id, stage: 'build', content: '# Plan\n\nA short plan.\n' } } }].map(x => JSON.stringify(x)).join('\n') + '\n');
    });
    const reply = JSON.parse(replies[0].result.content[0].text); const brief = replies[1].result.content.map(c => c.text).join('\n');
    const sub = JSON.parse(replies[2].result.content[0].text); assert.deepEqual(sub.waiting, ['extra']); assert.equal(sub.command, `${NPX} tree resume ${LINEAGE.treeId}`, 'submit_stage: same spelling'); assert.ok(sub.note.includes(`\`${NPX} tree resume`), 'and its note');
    assert.equal(reply.command, `${NPX} tree resume ${LINEAGE.treeId}`); assert.ok(reply.error.includes(`\`${NPX} tree resume ${LINEAGE.treeId}\``));
    assert.ok(brief.includes(`\`${NPX} tree resume ${LINEAGE.treeId}\``), 'the brief: same spelling'); assert.doesNotMatch(brief + reply.error + sub.note, /`council tree resume/);
    assert.ok(readFileSync(join(dir, 'RESUME.md'), 'utf8').includes(`\`${NPX} tree resume`), 'and so does the RESUME.md it wrote');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('the CLI of a member started under npx (npm_command=exec): NEEDS-<stage>.md, the log line and RESUME.md all spell `npx the-high-council tree resume <treeId>`, and none the bare `council tree resume`', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(externalChildren()); approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(reg.kind, 'registered');
  const res = await startChild({ r, work: r.t.work }, reg, { env: { npm_command: 'exec' } });
  assert.equal(res.exitCode, 3, res.outputTail);
  const dir = join(r.t.runsDir, reg.runId); const text = shown(dir, res); const treeId = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).tree.treeId;
  for (const [name, body] of [['NEEDS', readdirSync(dir).filter(f => f.startsWith('NEEDS-')).map(f => readFileSync(join(dir, f), 'utf8')).join('\n')], ['RESUME.md', readFileSync(join(dir, 'RESUME.md'), 'utf8')], ['the log', readFileSync(join(dir, 'run.log'), 'utf8')]]) {
    assert.ok(body.includes(`${NPX} tree resume ${treeId}`), `${name} names the npx spelling`);
    assert.doesNotMatch(body, /(?<![\w-])council tree resume/, `${name} has no bare spelling`);
  }
  assert.doesNotMatch(text, /--resume runs\//);
});
