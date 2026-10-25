// 0.8.3 M6 c4: what `council tree resume` PRINTS at the end of a sitting, for the stops and the crash that c3a/c3b/F2 made reachable. The person's screen comes from resumeHandler, not from runTree, so every line is driven through it (the probe of the c3b
// report showed the generic line "resolve in place with --milestone <id>" under a stop that has no milestone). Real roots, real sittings; all-mock, $0.
import test from 'node:test';
import { describePhase, registeredChainOf } from '../src/tree-close.js';
import { budgetOf } from '../src/tree-budget.js';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { resumeHandler } from '../src/tree-resume.js';
import { decideHandler } from '../src/tree-decide.js';
import { openBundleInputStop } from '../src/tree-bundle-input.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren, pricedChildren } from './helpers/child-chains.js';
import { plan3 } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { PARTIAL_REPORT_FILE } from '../src/report-shape.js';
import { writeStoppedMarker } from '../src/stop-files.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID, claim, hostnameOf } from './helpers/tree-fixture.js';

const sink = () => { let t = ''; return { w: new Writable({ write(c, e, cb) { t += c; cb(); } }), get: () => t }; };
const resume = async (r, deps = {}) => { const o = sink(); const e = sink(); const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: o.w, stderr: e.w, deps }); return { code, out: o.get(), err: e.get() }; };
const FINDING = [{ file: 'context.md', line: 3, name: 'URL credentials (scheme://user:pass@)' }];
async function dirtyTree() {
  const sc = splitChildren(); const cfg = sc.extraChains['split-child'];
  const seat = { provider: 'mock', model: 'mock-plan-placeholder-url', maxTokens: 4000 };
  cfg.seats = { ...cfg.seats, builder: seat, reviser: seat };
  const r = await trackedRealRoot({ ...sc, plan: plan3() }); approvePending(r);
  for (let i = 0; i < 5; i += 1) await runTree(r.t.rootDir, { work: r.t.work });
  return r;
}
const decideClose = async (r, node) => { const io = terminal([node, 'y']); const timer = setTimeout(() => io.stdin.end(), 8000); const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { close: node }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)); assert.equal(code, 0, io.shown() + io.errors()); };

test('A bundle_input STOP on a child: the sitting line names the child that was not registered and BOTH ways on (regenerate, or close it unstarted) - never "resolve in place with --milestone"', async () => {
  const r = await dirtyTree();
  const { code, out } = await resume(r);
  assert.equal(code, 20, out);
  const stop = eventsOf(r).find(e => e.event === 'needs_decision_opened' && e.source === 'bundle_input');
  assert.match(out, new RegExp(`Input stop ${stop.id}: R/M2 was not registered \\(its input would be refused\\): answer it with \`council tree decide ${ROOT_ID} --stop ${stop.id}\` \\(regenerate\\), or close it without starting it with \`council tree decide ${ROOT_ID} --close R/M2\``));
  assert.doesNotMatch(out, /--milestone <id>/);
});

test('A bundle_input stop recorded ON THE ROOT: the line says a NEW ROOT plan answers it, and still offers the close of the child', async () => {
  const r = await trackedRealRoot({ ...splitChildren(), plan: plan3() }); approvePending(r);
  const o = openBundleInputStop(r.t.rootDir, { child: { node: 'R/M3', generation: 1 }, parent: { node: 'R', generation: 1 }, found: { findings: FINDING, carriers: [], parentOwned: true } });
  assert.equal(o.kind, 'stop_opened');
  const { code, out } = await resume(r, { startRun: draftStarter(r) });
  assert.equal(code, 20, out);
  assert.match(out, new RegExp(`Input stop ${o.stop.id}: R/M3 was not registered \\(its input would be refused\\): answer it with a NEW ROOT plan, \`council tree decide ${ROOT_ID} --stop ${o.stop.id}\`, or close it without starting it with \`council tree decide ${ROOT_ID} --close R/M3\``));
  assert.doesNotMatch(out, /--milestone <id>/);
});

test('A blocked stop of the ROOT (C&C, from C\'s whole-tree test): the sitting line says a NEW ROOT plan, not "Blocked-child stop ... a new generation of the child"', async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() });
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'blocked', blockedBy: [{ code: 'not_passed', text: 'R@g1: the run did not pass' }], affected: [{ node: 'R', generation: 1 }] });
  const { out } = await resume(r);
  assert.match(out, new RegExp(`Blocked-root stop ${stop.id}: answer it with a NEW ROOT plan: \`council tree decide ${ROOT_ID} --stop ${stop.id}\``));
  assert.doesNotMatch(out, /a new generation of the child/);
});

test('A CRASH before any run was made (no run.json): the line says it did not start and nothing was spent, names the exit - not "try it once more"; a crash AFTER a run began keeps its old line', async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() }); approvePending(r);
  const first = await resume(r, { startRun: async () => ({ exitCode: 7, outputTail: 'the member refused its input before a run was made' }) });
  assert.match(first.out, /R\/M1 \(run [^)]+\) did not start \(exit code 7, no run was made, nothing was spent\)/);
  assert.match(first.out, /the member refused its input before a run was made/);
  assert.match(first.out, new RegExp(`close it with \`council tree decide ${ROOT_ID} --close R/M1\``));
  assert.doesNotMatch(first.out, /try it once more/);
  // the same node, but its run folder now holds a run.json: a crash of a run that began keeps the old wording
  const n = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1');
  mkdirSync(join(r.t.runsDir, n.runId), { recursive: true }); writeFileSync(join(r.t.runsDir, n.runId, 'run.json'), '{}');
  const second = await resume(r, { startRun: async () => ({ exitCode: 7, outputTail: 'x' }), resumeRun: async () => ({ exitCode: 7, outputTail: 'x' }) });
  assert.match(second.out, /ended with exit code 7 and no result/); assert.match(second.out, /to try it once more/);
});

test('C4b: a member stopped by a PRICE REFUSAL (exit 24, STOPPED-price_refused.json) is described as that, with the way out - not as "ended with exit code 24 and no result"', async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() }); approvePending(r);
  await resume(r, { startRun: async () => ({ exitCode: 7, outputTail: 'x' }) });
  const n = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1');
  mkdirSync(join(r.t.runsDir, n.runId), { recursive: true }); writeFileSync(join(r.t.runsDir, n.runId, 'run.json'), '{}');
  writeFileSync(join(r.t.runsDir, n.runId, 'STOPPED-price_refused.json'), JSON.stringify({ schema: 'stopped/1', stoppedBy: 'price_refused', beforeFirstCall: false, spentUsd: 0.01, resumeAfterStop: true, at: '2026-10-19T00:00:00.000Z', reason: 'the seat openrouter/some-model has no price in this project' }));
  const { out } = await resume(r, { startRun: async () => ({ exitCode: 24, outputTail: 'x' }), resumeRun: async () => ({ exitCode: 24, outputTail: 'x' }) });
  // CHANGED (0.8.3 Astra item 38/39, C&C one rule for 31-39; OLD: the marker's reason ran on the first line after a colon, then 'Add the model's current price ...'; NEW: the head, then the reason on its own lines, then a way on that depends on whether the record says the refusal named the price (this fixture has no report-partial.json: the neutral wording); WHY: the old remedy told a person to add a price for a refusal whose cause may be unknown)
  assert.match(out, /was stopped by a price refusal \(exit code 24\)\.[\s\S]*the seat openrouter\/some-model has no price in this project/, out);
  assert.match(out, /pricing\.user\.json/); assert.match(out, /`--skip-seat` is not available for a tree member/);
  assert.doesNotMatch(out, /no result/);
  // ledger row (6d): recovery resumes such a member as interrupted, and it must refuse AGAIN with no paid call: the same words, and the tree's spend and holds do not move
  const spendOf = () => { const b = budgetOf(r.t.rootDir); return [b.treeSpentUsd, b.heldUsd]; };
  const before = spendOf();
  const again = await resume(r, { startRun: async () => ({ exitCode: 24, outputTail: 'x' }), resumeRun: async () => ({ exitCode: 24, outputTail: 'x' }) });
  assert.match(again.out, /was stopped by a price refusal \(exit code 24\)\.[\s\S]*the seat openrouter\/some-model has no price in this project/, again.out);
  assert.deepEqual(spendOf(), before, 'a second refusal spends nothing and moves no hold');
  assert.equal(describePhase({ ...stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1'), phase: 'running' }, r.t.runsDir), "stopped by a price refusal (see the provider's answer; if it names the price, raise the model's price in pricing.user.json, then resume)", 'status, handoff and the abandon screen say the same about a running node whose run folder holds the marker (the fixture\'s startRun never appends node_started, so the phase is set here; the member CLI\'s exit hook is what leaves a node running)');
});

// c4 FIX-UP (C&C, from the crash probe of 13 Oct): the tail a real member CLI leaves when it THROWS before run.json. REAL string, taken from the probe (Review/Build_0.8.3/s2/crash-probe-A-fulltail.log): the member's task.md made unreadable, node 22.23.1.
// The one-line outputTail of the test above is why "the last three lines" went green over a tail that ended in `}` and `Node.js v22.23.1`.
const REAL_THROW_TAIL = "node:fs:440\n    return binding.readFileUtf8(path, stringToFlags(options.flag));\n                   ^\n\nError: EACCES: permission denied, open '/tmp/thc-budget-dqBRRV/runs/2026-10-08T11-00-00-000Z/tree/inputs/R.M1@g1/task.md'\n    at readFileSync (node:fs:440:20)\n    at file:///home/user/Projects/THCMCP/src/cli.js:2113:15\n    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)\n    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:681:26)\n    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5) {\n  errno: -13,\n  code: 'EACCES',\n  syscall: 'open',\n  path: '/tmp/thc-budget-dqBRRV/runs/2026-10-08T11-00-00-000Z/tree/inputs/R.M1@g1/task.md'\n}\n\nNode.js v22.23.1\n";
const CLEAN_REFUSAL_TAIL = "--task: cannot read /tmp/x/task.md (EACCES: permission denied). Nothing was run and nothing was spent.\n";

test('A CRASH whose tail is a raw throw (the real tail of a member CLI that threw before run.json): the line names the cause (the Error: line) and shows no stack frame, no lone brace, no Node.js version; a clean one-line refusal is shown as it is', async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() }); approvePending(r);
  const first = await resume(r, { startRun: async () => ({ exitCode: 1, outputTail: REAL_THROW_TAIL }) });
  assert.match(first.out, /R\/M1 \(run [^)]+\) did not start \(exit code 1, no run was made, nothing was spent\)\.\n  Error: EACCES: permission denied, open '[^']*R\.M1@g1\/task\.md'\n/);
  assert.doesNotMatch(first.out, /^\s+at |Node\.js v|^\s*\}\s*$|\}\s+Node/m);
  assert.match(first.out, new RegExp(`Fix what the line above says and run \`council tree resume ${ROOT_ID}\` again, or close it with \`council tree decide ${ROOT_ID} --close R/M1\`\\.`));
  const second = await resume(r, { startRun: async () => ({ exitCode: 1, outputTail: CLEAN_REFUSAL_TAIL }) });
  assert.match(second.out, /did not start[^\n]*\n  --task: cannot read \/tmp\/x\/task\.md \(EACCES: permission denied\)\. Nothing was run and nothing was spent\.\n/);
  // several clean lines (no Error: line), the shape of the REAL key-scan refusal (exit 11) whose first line is log preamble: the last three lines that are not stack noise, and the plural wording; an empty / all-noise tail says it printed nothing that says why - never "the line above" over nothing
  const third = await resume(r, { startRun: async () => ({ exitCode: 11, outputTail: 'context: 1 document(s) appended (context.md)\n\nOUTBOUND KEY SCAN: refusing to run - 1 credential-shaped string(s) in the input.\n  context.md:53  URL credentials\nNothing was sent.\n' }) });
  assert.match(third.out, /did not start[^\n]*\n  OUTBOUND KEY SCAN: refusing to run - 1 credential-shaped string\(s\) in the input\.\n  context\.md:53  URL credentials\n  Nothing was sent\.\n  Fix what the lines above say/);
  assert.doesNotMatch(third.out, /document\(s\) appended/);
  const fourth = await resume(r, { startRun: async () => ({ exitCode: 1, outputTail: '    at readFileSync (node:fs:440:20)\n}\n\nNode.js v22.23.1\n' }) });
  // EDITED in the M7 apply (E75; old: /It printed nothing that says why\.\n  Fix the cause and run/; why: with no cause printed there is nothing to fix, so the line names the two moves that exist)
  assert.match(fourth.out, /did not start[^\n]*\n  It printed nothing that says why\.\n  Run `council tree resume \S+` to try it once more, or close it with `council tree decide \S+ --close \S+`\./);
  assert.doesNotMatch(fourth.out, /Fix the cause/);
  assert.doesNotMatch(fourth.out, /lines? above/);
});

test('C4c: a member stopped by a price refusal on its OWN price limit is told which chain to accept: the name comes from the node\'s registration, never a placeholder (C&C thcmcp-cd FIX 1, 23 Okt 2026; A-DRAFT)', async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() }); approvePending(r);
  await resume(r, { startRun: async () => ({ exitCode: 7, outputTail: 'x' }) });
  const n = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1');
  mkdirSync(join(r.t.runsDir, n.runId), { recursive: true }); writeFileSync(join(r.t.runsDir, n.runId, 'run.json'), '{}');
  writeFileSync(join(r.t.runsDir, n.runId, 'STOPPED-price_refused.json'), JSON.stringify({ schema: 'stopped/1', stoppedBy: 'price_refused', beforeFirstCall: false, spentUsd: 0.01, resumeAfterStop: true, at: '2026-10-19T00:00:00.000Z', reason: 'the seat openrouter/some-model was refused at the price limit' }));
  writeFileSync(join(r.t.runsDir, n.runId, PARTIAL_REPORT_FILE), JSON.stringify({ stop: { kind: 'price_refused', recognised: true, ownPin: true } }));
  const { out } = await resume(r, { startRun: async () => ({ exitCode: 24, outputTail: 'x' }), resumeRun: async () => ({ exitCode: 24, outputTail: 'x' }) });
  assert.ok(out.includes(`council tree decide ${ROOT_ID} --accept-chain-limits priced-debate\` at a terminal`), out);       // red with src/tree-run.js of 24da98f: the line ends "--accept-chain-limits <chain>"
  assert.doesNotMatch(out, /<chain>/);
  // the status line of the close and abandon screens (describePhase) names the same command, from the record: the node's registered chain and the root id
  const node = { ...stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1'), phase: 'running' };
  assert.equal(registeredChainOf(readTreeRecord(r.t.rootDir), node), 'priced-debate');
  const status = `stopped by a price refusal (change the numbers of the seat's own provider.max_price in the chain, accept them with \`council tree decide ${ROOT_ID} --accept-chain-limits priced-debate\`, then resume)`;
  assert.equal(describePhase(node, r.t.runsDir, { rootId: ROOT_ID, chain: 'priced-debate' }), status);
  assert.doesNotMatch(describePhase(node, r.t.runsDir), /--accept-chain-limits/, 'a caller that knows neither gets no half command');
  // the real screen: `tree decide --abandon` lists every node with its phase words, the caller of describePhase that has the record and the root id. The fixture's node never started (its start was faked), so it is given a start whose process is gone: phase `running`, the price-refused marker beside it
  appendTreeEvent(r.t.rootDir, { event: 'node_started', ...claim(node.node, node.runId, 2147483000, 1, hostnameOf()) });
  const io = terminal([]); const timer = setTimeout(() => io.stdin.end(), 8000);
  await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { abandon: true }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  assert.ok(io.shown().includes(`R/M1@g1 ${status}`), io.shown() + io.errors());       // red with src/tree-decide.js of c141901: the screen says `--accept-chain-limits` with no root and no chain
});

test('C-055 (BUG-C-055): `tree resume` of a member whose dead claim leaves it `running`, refused at its price limit AGAIN (exit 24), says the price-refusal words - not "ended with exit code 24 and no result" - and lists the stop file by name only', async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() }); approvePending(r);
  await resume(r, { startRun: async () => ({ exitCode: 7, outputTail: 'x' }) });           // registers R/M1; the fake start never claims it
  const reg = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1');
  const dir = join(r.t.runsDir, reg.runId); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'run.json'), '{}');
  writeStoppedMarker(dir, { stoppedBy: 'price_refused', beforeFirstCall: false, spentUsd: 0.01, resumeAfterStop: true, reason: 'the seat openrouter/some-model was refused at the price limit' });       // the real writer
  appendTreeEvent(r.t.rootDir, { event: 'node_started', ...claim('R/M1', reg.runId, 2147483000, 1, hostnameOf()) });       // the member's own claim, its process gone: the node reads `running` and this handler resumes it itself
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1').phase, 'running', 'premise: a running node with a dead claim');
  const { out } = await resume(r, { startRun: async () => ({ exitCode: 24, outputTail: 'x' }), resumeRun: async () => ({ exitCode: 24, outputTail: 'x' }) });
  assert.match(out, /Resuming R\/M1 /, 'premise: the handler resumed it itself\n' + out);
  assert.match(out, /was stopped by a price refusal \(exit code 24\)\.[\s\S]*the seat openrouter\/some-model was refused at the price limit/, out);
  assert.match(out, /`--skip-seat` is not available for a tree member/); assert.match(out, /pricing\.user\.json/);
  assert.doesNotMatch(out, /ended with exit code 24 and no result/);
  // after the resume line (the "earlier:" line printed BEFORE it is another reader of the marker's raw text, not this fix)
  const sitting = out.slice(out.indexOf('Resume number'));
  assert.match(sitting, /^  STOPPED-price_refused\.json$/m, 'the stop file is listed by name only');
  assert.doesNotMatch(sitting, /"stoppedBy"|"schema"/, 'its raw text is not printed again, as the start path does not print it');
});
