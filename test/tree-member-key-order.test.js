// 0.8.3 M6, the cli.js tree-member unit (gate 1 passed 13 Oct 2026; Review/Build_0.8.3/m6-closing/Member_Unit_Quarter_Page_2026-10-13.md). Two defects and one order:
//   1. A tree takes no override (Muad, 12 Oct, answer 2), but a member started by hand with `--allow-secret-shaped` ran with the key scan off (probe p15: exit 0, claimed, completed; `handoff --from-run` on a member the same,
//      probe p16). Refused before run.json exists (typed: exit 2, no tree record; SAVED in run.json by an older run: exit 19 naming `--close`); `memberStart` takes the effective value as a REQUIRED argument (the backstop).
//   2. A tampered member bundle that also held a key-shaped string was named as a secret (exit 11, "remove the key") instead of as tampered (exit 19). Order now: tampering, then secrets, then personal data. The early check
//      (`memberPreflight`) never claims and writes its refusal through the same writer as `memberStart`; a genuine bundle with a key still exits 11 with no claim and no folder.
//   3. The member's closing lines state the fact and name no remedy (the sitting is the one place a remedy lives); `tree start`'s texts are byte-identical.
// Every state is made by the real CLI on the all-mock chain (`mock-budget`) over a registered node with a REAL input bundle; the only hand edits are named where they happen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as api from '../src/api.js';
import { readTreeRecord } from '../src/tree-record.js';
import { registerRoot, registerChildUnchecked } from '../src/tree-register.js';
import { bundleDirOf, bundleIdentityRefusal, bundleSha256Of } from '../src/tree-continuation.js';
import { memberFlagRefusal, memberPreflight, memberStart } from '../src/tree-member.js';
import { piiGateReport, secretScanRefusalLines } from '../src/run-preflight.js';
import { IDS, ROOT_ID, approveFrontier, chainSha, cli, lineageFile, newTree, rootOpts } from './helpers/tree-fixture.js';

const KEY = `sk-or-v1-${'a'.repeat(40)}`;
const ENV = work => ({ PATH: process.env.PATH, HOME: work });
const records = t => readTreeRecord(t.rootDir).events;
const claimsOf = t => records(t).filter(e => (e.event === 'node_started' || e.event === 'node_resumed') && e.node === 'R/M1');       // the member's own claims (the root has its own node_started)

/** A tree whose root ran, and the node R/M1 registered with a REAL bundle (task.md = `taskText`). Returns { t, bdir, args(extra), run(extra), runDir }. */
async function memberWithBundle({ taskText = 'Plan a tiny change.\n', piiGate, chainSha256 } = {}) {
  const t = newTree({ cap: 200, ...(piiGate ? { piiGate } : {}) });
  registerRoot(t.rootDir);
  assert.equal((await api.run({ ...rootOpts(t), ...(piiGate ? { piiGate } : {}) })).exitCode, 0);
  const key = approveFrontier(t.rootDir, ['R/M1']);
  const bdir = bundleDirOf(t.rootDir, 'R/M1', 1); mkdirSync(bdir, { recursive: true });
  writeFileSync(join(bdir, 'task.md'), taskText);
  registerChildUnchecked(t.rootDir, { frontierKey: key, node: 'R/M1', generation: 1, runId: IDS[0], parentRunId: ROOT_ID, chain: { name: t.childChain, sha256: chainSha256 ?? (t.shaIn ?? chainSha)(t.childChain) }, grant: { amount: 60, unit: 'usd' }, bundleSha256: bundleSha256Of(bdir) });
  const runDir = join(t.runsDir, IDS[0]);
  const args = extra => [cli, '--chain', t.childChain, '--task', join(bdir, 'task.md'), '--run-id', IDS[0], '--max-usd', '30', '--tree-node', lineageFile(t.work, 'R/M1'), ...extra];
  const run = extra => spawnSync(process.execPath, args(extra), { cwd: t.work, encoding: 'utf8', env: ENV(t.work), timeout: 60_000 });
  return { t, bdir, runDir, args, run };
}
const tail3 = r => (r.stderr + r.stdout).trim().split('\n').slice(-3).join(' ').slice(0, 400);       // what the sitting shows of a refused member (src/tree-resume.js)

test('KO-1 a GENUINE bundle that holds a key-shaped string: exit 11, no tree record, no run.json, no claim; the closing line states the fact and offers no remedy', async () => {
  const m = await memberWithBundle({ taskText: `Plan a tiny change.\nnote: ${KEY}\n` });
  const n = records(m.t).length;
  const r = m.run([]);
  assert.equal(r.status, 11, r.stderr);
  assert.equal(records(m.t).length, n, 'nothing was written to the tree record');
  assert.equal(existsSync(join(m.runDir, 'run.json')), false); assert.equal(existsSync(m.runDir), false, 'no folder');
  assert.match(r.stderr, /OUTBOUND KEY SCAN: refusing to run - 1 credential-shaped string/);
  assert.ok(r.stderr.trimEnd().endsWith('Nothing was sent. A tree takes no override.'), r.stderr);
  assert.ok(!/--allow-secret-shaped|Remove the key|normal `council --task`/.test(r.stderr.split('Nothing was sent.')[1]), 'no remedy after the fact');
});

test('KO-2a a typed --allow-secret-shaped or --allow-pii on a member is a usage error before anything is written: exit 2, no tree record, no run.json (the override worked on a member before: exit 0, claimed, completed)', async () => {
  const m = await memberWithBundle({ taskText: `Plan a tiny change.\nnote: ${KEY}\n` });
  const n = records(m.t).length;
  const a = m.run(['--allow-secret-shaped']);
  assert.equal(a.status, 2, a.stdout + a.stderr);
  assert.match(a.stderr, /--allow-secret-shaped: a tree member takes no override of the outbound key scan \(a member's text is written by models, not chosen by you\)\. Nothing was run and nothing was spent\./);   // EDITED in the M7 apply (E79a; old: .../key scan/ only; why: the new tail is the wording a person reads)
  const b = m.run(['--allow-pii', 'email']);
  assert.equal(b.status, 2, b.stdout + b.stderr);
  assert.match(b.stderr, /--allow-pii: a tree member takes no --allow-pii of its own \(its text is written by models, not chosen by you\)\. To send personal data in one sub-plan you answer its stop after seeing where it sits: council tree decide <root> --allow-pii-node <node>@g<N>; for the root task, council tree start --allow-pii <types>\. Nothing was run and nothing was spent\./   /* CHANGED ACCEPTED (T-b, 19 Okt 2026): OLD '--allow-pii: a tree has no allow-list (a member\'s text is written by models, not chosen by you). Nothing was run and nothing was spent.' WHY: a tree now has a recorded, after-seeing way on; the old sentence became false. A-DRAFT */);
  assert.equal(records(m.t).length, n, 'a typed flag appends nothing to the record'); assert.equal(existsSync(m.runDir), false);
});

test('KO-2b a run.json that SAVED the override (an older run): a resume is refused with exit 19, names `council tree decide <tree> --close <node>`, claims nothing, writes nothing', async () => {
  // the older run's state: a member whose claim was refused AFTER run.json was written. A real start on a chain file that is not the registered one gets exactly there (the chain check is memberStart's, after run.json).
  const m = await memberWithBundle({ chainSha256: 'f'.repeat(64) });
  const first = m.run([]);
  assert.equal(first.status, 19, first.stdout + first.stderr);
  assert.ok(existsSync(join(m.runDir, 'run.json')), 'the refused start left run.json (the shape of the trap)');
  const rj = join(m.runDir, 'run.json');
  writeFileSync(rj, JSON.stringify({ ...JSON.parse(readFileSync(rj, 'utf8')), allowSecretShaped: true }));            // THE ONE HAND EDIT: the field an older run saved
  const n = records(m.t).length;
  const resumed = spawnSync(process.execPath, [cli, '--resume', m.runDir, '--max-usd', '30'], { cwd: m.t.work, encoding: 'utf8', env: ENV(m.t.work), timeout: 60_000 });
  assert.equal(resumed.status, 19, resumed.stdout + resumed.stderr);
  assert.match(resumed.stderr, /run\.json saved --allow-secret-shaped, which a tree member does not take \(this run\.json was saved without that check\)\. This start was refused: nothing was run and nothing was spent by it\./);   // EDITED in the M7 apply (E79b)
  assert.ok(resumed.stderr.includes(`council tree decide ${ROOT_ID} --close R/M1@g1`), resumed.stderr);
  assert.equal(records(m.t).length, n, 'nothing written'); assert.deepEqual(claimsOf(m.t), [], 'no claim');
});

test('KO-3 a TAMPERED bundle that also holds a key: exit 19 (tampering is named, not the secret), one `blocked` record from the one writer, no claim, no run.json; the refusal names the way out', async () => {
  const m = await memberWithBundle();
  appendFileSync(join(m.bdir, 'task.md'), `note: ${KEY}\n`);                                                           // THE TAMPER: the bundle's task now differs from the registered one AND holds a key
  const n = records(m.t).length;
  const r = m.run([]);
  assert.equal(r.status, 19, r.stdout + r.stderr);
  const added = records(m.t).slice(n);
  assert.deepEqual(added.map(e => [e.event, e.reason, e.check]), [['blocked', 'continuation_refused', 'bundle']]);
  assert.equal(existsSync(join(m.runDir, 'run.json')), false); assert.deepEqual(claimsOf(m.t), []);
  assert.match(r.stderr, /its input bundle \(.*\) is not the one recorded for it\./);   // EDITED in the M7 apply (E82; old: "is not the one registered")
  assert.ok(tail3(r).includes(`council tree decide ${ROOT_ID} --close R/M1@g1`), `the remedy fits the sitting's 400-character tail: ${tail3(r)}`);
  assert.ok(!r.stderr.includes('OUTBOUND KEY SCAN'), 'the scan did not run first');
});

test('KO-3b the backstop: a bundle changed AFTER the early check passed is refused by memberStart with the same check, and the claim is never written (the early call is not the only guard)', async () => {
  const m = await memberWithBundle();
  const lineage = JSON.parse(readFileSync(lineageFile(m.t.work, 'R/M1'), 'utf8'));
  const inputs = { task: join(m.bdir, 'task.md'), criteria: null, context: null };
  memberPreflight({ rootDir: m.t.rootDir, lineage, inputs, piiGate: null });                                                           // genuine: returns, writes nothing
  appendFileSync(join(m.bdir, 'task.md'), 'edited between the early check and the claim\n');
  const n = records(m.t).length;
  // CHANGED ACCEPTED (already-false unit, Q3; C&C thcmcp-cd 24 Okt 2026): memberStart now REFUSES a node that registered a chain hash when it is given no chain file, and that check comes BEFORE the bundle check this test is about. OLD: no `chainPath`. NEW: the registered chain's own file (the package's chains/<name>.json, the file chainSha hashes), so the chain check runs and passes and the bundle refusal is still the one reached. WHY: a null path is now a chain refusal.
  assert.throws(() => memberStart({ runDir: m.runDir, runId: IDS[0], lineage, capAskedUsd: 30, chainPath: join(dirname(cli), '..', 'chains', `${m.t.childChain}.json`), inputs, piiGate: null, piiAllow: [], allowSecretShaped: false, ceiling: null, work: m.t.work }), e => e.message.includes('is not the one recorded for it'));
  assert.deepEqual(records(m.t).slice(n).map(e => [e.event, e.check]), [['blocked', 'bundle']]);
  assert.deepEqual(claimsOf(m.t), []);
});

test('KO-3c (E79c, M7) the backstop for the key-scan override: memberStart with allowSecretShaped refuses with `secret_override` before any claim, and the `blocked` record\'s detail is the new sentence (its text is written by models, not chosen by a person), not the old "I read this text" one', async () => {
  const m = await memberWithBundle();
  const lineage = JSON.parse(readFileSync(lineageFile(m.t.work, 'R/M1'), 'utf8'));
  const inputs = { task: join(m.bdir, 'task.md'), criteria: null, context: null };
  const n = records(m.t).length;
  assert.throws(() => memberStart({ runDir: m.runDir, runId: IDS[0], lineage, capAskedUsd: 30, inputs, piiGate: null, piiAllow: [], allowSecretShaped: true, ceiling: null, work: m.t.work }), e => e.message.includes('takes no override (--allow-secret-shaped)'));
  const added = records(m.t).slice(n);
  assert.deepEqual(added.map(e => [e.event, e.check]), [['blocked', 'secret_override']], 'one blocked record, and it is the override check that spoke (no earlier refusal)');
  assert.equal(added[0].detail, 'R/M1@g1: a tree member runs with the outbound key scan on, and takes no override (--allow-secret-shaped): its text is written by models, not chosen by a person');
  assert.equal(added[0].detail.includes('I read this text'), false);
  assert.deepEqual(claimsOf(m.t), []);
});

test('KO-4 every bundle refusal ends with the way out: node.json naming another bundle, inputs that are not the bundle\'s files, and the bundle itself; the remedy fits the sitting\'s 400-character tail', async () => {
  const lineageOf = m => JSON.parse(readFileSync(lineageFile(m.t.work, 'R/M1'), 'utf8'));
  // (a) node.json names another bundle
  const a = await memberWithBundle();
  const nodeJson = lineageFile(a.t.work, 'R/M1');                                                                          // (lineageFile rewrites the file on every call, so it is taken once and edited)
  writeFileSync(nodeJson, JSON.stringify({ ...lineageOf(a), bundleSha256: 'b'.repeat(64) }));                            // HAND EDIT: node.json points at another bundle
  const ra = spawnSync(process.execPath, [cli, '--chain', a.t.childChain, '--task', join(a.bdir, 'task.md'), '--run-id', IDS[0], '--max-usd', '30', '--tree-node', nodeJson], { cwd: a.t.work, encoding: 'utf8', env: ENV(a.t.work), timeout: 60_000 });
  assert.equal(ra.status, 19, ra.stdout + ra.stderr);
  assert.match(ra.stderr, /its node\.json names the bundle bbbbbbbbbbbb, the registration holds/);
  assert.ok(tail3(ra).includes(`--close R/M1@g1`), tail3(ra));
  // (b) the run was started with a task that is not the bundle's (the bundle itself is whole)
  const b = await memberWithBundle();
  const other = join(b.t.work, 'other-task.md'); writeFileSync(other, 'a different task\n');
  const rb = spawnSync(process.execPath, [cli, '--chain', b.t.childChain, '--task', other, '--run-id', IDS[0], '--max-usd', '30', '--tree-node', lineageFile(b.t.work, 'R/M1')], { cwd: b.t.work, encoding: 'utf8', env: ENV(b.t.work), timeout: 60_000 });
  assert.equal(rb.status, 19, rb.stdout + rb.stderr);
  assert.match(rb.stderr, /the task the run was started with is not the bundle's task\.md\./);
  assert.ok(tail3(rb).includes(`--close R/M1@g1`), tail3(rb));
});

test('KO-4b a re-planned ROOT (R@g2 has a bundle) that fails the identity check is not told to close itself: the root cannot be closed, so the way out is restoring the files, or a new tree', () => {
  const why = bundleIdentityRefusal({ rootDir: join('/tmp', ROOT_ID), node: { node: 'R', generation: 2 }, registered: { bundleSha256: 'c'.repeat(64) }, lineage: null, inputs: null });
  assert.equal(why.check, 'bundle');
  assert.match(why.detail, /R@g2: its input bundle \(.*\) is not the one recorded for it\. Restore the bundle's files to what was recorded for it\. The root cannot be closed: start a new tree with `council tree start`\.$/);   // EDITED in the M7 apply (E82; old: "...is not the one registered. Restore the bundle's files to what was registered. The root cannot be closed; a tree that cannot be repaired is replaced by a new one: `council tree start`."; B-DRAFT: the restore branch keeps its restore route for the root, C&C 18 Okt)
  assert.ok(!why.detail.includes('--close'), why.detail);
});

test('KO-5 the member\'s closing lines state the fact and name no remedy; the `tree start` texts are byte-identical, and every caller that passes `true` today still passes it', async () => {
  const found = [{ where: 'task.md', line: 2, part: 'task', label: 'OpenRouter', pattern: 'sk-or-v1-' }];
  const start = secretScanRefusalLines(found, { forTree: true }).at(-1);
  assert.equal(start, 'Nothing was sent. A tree takes no override: change the task, or use a normal `council --task` run with --allow-secret-shaped.');
  assert.equal(secretScanRefusalLines(found, { forTree: 'member' }).at(-1), 'Nothing was sent. A tree takes no override.');
  assert.equal(secretScanRefusalLines(found).at(-1), 'Nothing was sent. Remove the key from the input, or rerun with --allow-secret-shaped to send it deliberately.');
  const sources = [['task.md', 'mail me: someone@acme-corp.com']];
  const lastOf = forTree => piiGateReport({ mode: 'hard-stop', sources, forTree }).lines.at(-1);
  // CHANGED ACCEPTED (PII stop unit, owner 18/19 Okt 2026). OLD closing lines: tree start 'A tree takes no allow-list: change the task, or start the tree without --pii-gate, or use a normal `council --task` run with --allow-pii.'; member 'Nothing was sent. A tree takes no allow-list.'; normal run 'Fix the input, or rerun with --pii-gate warn / --allow-pii <type,...> to proceed deliberately.'. NEW: the stop screen names the way on (the types found; for a tree the root-only allowance and the typed warn as the blind choice; for a member the per-sub-plan verb). WHY: the default stops and T-b gives a tree a recorded, after-seeing way on; the old sentences became false.
  assert.match(lastOf(true), /^Or change the task, or start the tree with --pii-gate warn \(a choice made before seeing anything/);
  assert.equal(lastOf('member'), 'Nothing was sent. A tree member takes no --allow-pii of its own; a person allows personal data for one sub-plan after seeing it: council tree decide <root> --allow-pii-node <node>@g<N>.');
  assert.equal(lastOf(false), 'That allows every email-shaped string in these files, also when this run is resumed.');
  // callers: the three `tree` modules keep the start variant; only cli.js asks for the member variant, and only when it has a lineage
  for (const f of ['tree-start.js', 'tree-decide.js', 'tree-bundle-input.js']) assert.match(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), /forTree: true/, f);
  const cliText = readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8');
  assert.equal([...cliText.matchAll(/forTree: 'member'/g)].length, 2, 'the scan and the PII gate, nowhere else');
  assert.ok(!/forTree: true/.test(cliText), 'cli.js never asks for the `tree start` variant');
});

test('KO-5b a member under --pii-gate hard-stop whose bundle holds personal data: exit 11, the closing line is the fact', async () => {
  const m = await memberWithBundle({ taskText: 'Plan a tiny change. Contact someone@acme-corp.com please.\n', piiGate: 'hard-stop' });
  const r = m.run(['--pii-gate', 'hard-stop']);
  assert.equal(r.status, 11, r.stdout + r.stderr);
  assert.ok(r.stderr.trimEnd().endsWith('Nothing was sent. A tree member takes no --allow-pii of its own; a person allows personal data for one sub-plan after seeing it: council tree decide <root> --allow-pii-node <node>@g<N>.'), r.stderr);   // CHANGED ACCEPTED: OLD 'Nothing was sent. A tree takes no allow-list.' (see KO-5 above)
  assert.deepEqual(claimsOf(m.t), []);
});

test('KO-6 `handoff --from-run` on a member: a typed --allow-secret-shaped is refused (exit 2, no tree record) where it used to skip the scan and write a post-run claim', async () => {
  const m = await memberWithBundle();
  const done = m.run([]);
  assert.equal(done.status, 0, done.stdout + done.stderr);
  const n = records(m.t).length;
  const r = spawnSync(process.execPath, [cli, 'handoff', '--from-run', m.runDir, '--max-usd', '5', '--allow-secret-shaped'], { cwd: m.t.work, encoding: 'utf8', env: ENV(m.t.work), timeout: 60_000 });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /a tree member takes no override of the outbound key scan/);
  assert.equal(records(m.t).length, n, 'no post-run claim, nothing written');
});

// the external branch of `handoff --from-run` wrote handoff-from-run.prompt.md and exited 3 BEFORE the member refusal and the key scan ran (13 Oct 2026, order re-read): KO-6 drove the internal branch only
function externalHandoffChain(work) {
  mkdirSync(join(work, 'chains'), { recursive: true });
  writeFileSync(join(work, 'chains', 'ext-handoff.json'), JSON.stringify({ name: 'ext-handoff', maxRounds: 1, estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, handoff: { provider: 'external', model: 'claude-code-session' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }] } }));
}
test('KO-10 `handoff --from-run` on a member with an EXTERNAL handoff seat: a typed --allow-secret-shaped is refused (exit 2) and NO prompt file is written; without the flag the prompt file is still written and the verb exits 3', async () => {
  const m = await memberWithBundle();
  const done = m.run([]);
  assert.equal(done.status, 0, done.stdout + done.stderr);
  externalHandoffChain(m.t.work);
  const n = records(m.t).length;
  const prompt = join(m.runDir, 'handoff-from-run.prompt.md');
  const r = spawnSync(process.execPath, [cli, 'handoff', '--from-run', m.runDir, '--chain', 'ext-handoff', '--max-usd', '5', '--allow-secret-shaped'], { cwd: m.t.work, encoding: 'utf8', env: ENV(m.t.work), timeout: 60_000 });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /a tree member takes no override of the outbound key scan/);
  assert.equal(existsSync(prompt), false, 'no prompt file was written');
  assert.equal(records(m.t).length, n, 'nothing recorded');
  const plain = spawnSync(process.execPath, [cli, 'handoff', '--from-run', m.runDir, '--chain', 'ext-handoff', '--max-usd', '5'], { cwd: m.t.work, encoding: 'utf8', env: ENV(m.t.work), timeout: 60_000 });
  assert.equal(plain.status, 3, plain.stdout + plain.stderr);
  assert.equal(existsSync(prompt), true, 'the control: a clean request still gets its prompt file');
});

async function memberKeyRefusal(where) {
  const m = await memberWithBundle();
  assert.equal(m.run([]).status, 0);
  externalHandoffChain(m.t.work);
  if (where === 'task') appendFileSync(join(m.bdir, 'task.md'), `note: ${KEY}\n`); else appendFileSync(join(m.runDir, 'deliverable.md'), `\nAPI key: ${KEY}\n`);
  const r = spawnSync(process.execPath, [cli, 'handoff', '--from-run', m.runDir, '--chain', 'ext-handoff', '--max-usd', '5'], { cwd: m.t.work, encoding: 'utf8', env: ENV(m.t.work), timeout: 60_000 });
  assert.equal(r.status, 11, `${where}: ${r.stdout}${r.stderr}`);
  assert.ok(r.stderr.trimEnd().endsWith('Nothing was sent. A tree takes no override.'), `${where}: ${r.stderr}`);
  assert.ok(!/--allow-secret-shaped|Remove the key/.test(r.stderr.split('\n').slice(-3).join('\n')), `${where}: no remedy in the closing lines`);
  assert.equal(existsSync(join(m.runDir, 'handoff-from-run.prompt.md')), false);
}
// the member's key-scan refusals on the handoff path end with the member sentence, never an offer of the flag a member is refused for (the non-member control is ES-2 / ES-3 in test/handoff-external-scan.test.js)
test('KO-11a `handoff --from-run` on a member (external seat): a key in the TASK is refused (exit 11) and the closing line is the member sentence', () => memberKeyRefusal('task'));
test('KO-11b `handoff --from-run` on a member (external seat): a key in the DRAFT is refused (exit 11) and the closing line is the member sentence', () => memberKeyRefusal('draft'));

// the INTERNAL seat: the key in the draft is caught by the call's own scan AFTER the member's post-run claim was written; the refusal must end with the member sentence AND the claim must be released on that exit
test('KO-11c `handoff --from-run` on a member (internal seat): a key in the DRAFT is refused (exit 11), the closing line is the member sentence, and the post-run claim is released', async () => {
  const m = await memberWithBundle();
  assert.equal(m.run([]).status, 0);
  appendFileSync(join(m.runDir, 'deliverable.md'), `\nAPI key: ${KEY}\n`);
  const n = records(m.t).length;
  const r = spawnSync(process.execPath, [cli, 'handoff', '--from-run', m.runDir, '--max-usd', '5'], { cwd: m.t.work, encoding: 'utf8', env: ENV(m.t.work), timeout: 60_000 });
  assert.equal(r.status, 11, r.stdout + r.stderr);
  assert.ok(r.stderr.trimEnd().endsWith('Nothing was sent. A tree takes no override.'), r.stderr);
  const added = records(m.t).slice(n);
  assert.deepEqual(added.map(e => e.event).filter(e => e === 'node_resumed'), ['node_resumed'], 'the post-run claim was written (the scan of the draft runs inside the call)');
  assert.deepEqual(added.map(e => [e.event, e.purpose ?? e.reason]), [['node_resumed', 'post_run'], ['node_released', 'ended']], 'the post-run claim was written and released on the refusal exit');
});

test('KO-7 the backstop argument: memberStart REQUIRES allowSecretShaped (a missing value throws), and `true` is refused with a `blocked` record and no claim', async () => {
  const m = await memberWithBundle();
  const lineage = JSON.parse(readFileSync(lineageFile(m.t.work, 'R/M1'), 'utf8'));
  const base = { runDir: m.runDir, runId: IDS[0], lineage, capAskedUsd: 30, inputs: { task: join(m.bdir, 'task.md'), criteria: null, context: null }, piiGate: null, piiAllow: [], ceiling: null, work: m.t.work };
  assert.throws(() => memberStart({ ...base }), e => e instanceof TypeError && /allowSecretShaped must be true or false/.test(e.message));
  const n = records(m.t).length;
  assert.throws(() => memberStart({ ...base, allowSecretShaped: true }), e => /takes no override \(--allow-secret-shaped\)/.test(e.message));
  assert.deepEqual(records(m.t).slice(n).map(e => [e.event, e.reason, e.check]), [['blocked', 'continuation_refused', 'secret_override']]);
  assert.deepEqual(claimsOf(m.t), []);
  // the flag refusal is a pure function of the lineage and the two sources of the value
  const lin = { treeId: ROOT_ID, node: 'R/M1', generation: 1 };
  assert.equal(memberFlagRefusal({ lineage: lin, typed: {}, saved: {} }), null);
  assert.equal(memberFlagRefusal({ lineage: lin, typed: { allowPii: true } }).code, 2);
  assert.equal(memberFlagRefusal({ lineage: lin, typed: { allowSecretShaped: true }, saved: { allowPii: ['email'] } }).code, 19, 'a saved value wins: removing a typed flag cannot help');
  // the ROOT cannot be closed (src/tree-close.js closeRefusal, kind 'root'): its way out is not `--close`
  const rootSaved = memberFlagRefusal({ lineage: { treeId: ROOT_ID, node: 'R', generation: 2 }, saved: { allowSecretShaped: true } }).text;
  assert.match(rootSaved, /The root cannot be closed: start a new tree with `council tree start`\./); assert.ok(!rootSaved.includes('--close'), rootSaved);
  assert.ok(memberFlagRefusal({ lineage: lin, saved: { allowSecretShaped: true } }).text.includes(`--close R/M1@g1`));
});

test('KO-8 one copy of the bundle comparison (a mechanical guard): the registered-hash comparisons live only in bundleIdentityRefusal, which continuationRefusal and memberPreflight both reach', async () => {
  const src = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  // 14 Okt 2026, REBUILD unit (old -> new): OLD expected {'tree-continuation.js': 2} for `=== registered.bundleSha256`; the node's CURRENT hash (its registration, or its newest rebuild) is now read as `currentBundleSha256` in bundleIdentityRefusal, so NEW expects no comparison against the registration's hash anywhere
  // and exactly the same two comparisons against `currentBundleSha256`, in the same one file. The guard is not loosened: both operators are covered, and a second copy of either pattern, in any file, still fails it on the count assertion below (red: a planted `!== currentBundleSha256` in another src file). LIMIT: `currentBundleSha256` is a bare local identifier, so the guard pins a NAME, not a concept: an unrelated `=== currentBundleSha256` added elsewhere later trips it, and a comparison written under another name would not.
  const cmp = /(?:!==|===)\s*registered\.bundleSha256/g; const cmpWant = /(?:!==|===)\s*currentBundleSha256\b/g;
  const hits = {}; const hitsWant = {};
  for (const f of readdirSync(new URL('../src/', import.meta.url)).filter(x => x.endsWith('.js'))) { const c = [...src(f).matchAll(cmp)].length; if (c) hits[f] = c; const w = [...src(f).matchAll(cmpWant)].length; if (w) hitsWant[f] = w; }
  assert.deepEqual(hits, {}, 'nobody compares the registration\'s hash directly any more');
  assert.deepEqual(hitsWant, { 'tree-continuation.js': 2 }, 'exactly the two comparisons of bundleIdentityRefusal (the bundle folder and node.json), in one file');
  const cont = src('tree-continuation.js');
  const body = cont.slice(cont.indexOf('export function continuationRefusal'));
  assert.ok(!/bundleSha256Of\(|inputsAreBundle\(/.test(body), 'continuationRefusal calls bundleIdentityRefusal and compares nothing itself');
  assert.match(src('tree-member.js'), /bundleIdentityRefusal\(\{ rootDir, node: n, registered, lineage, inputs \}\)/, 'memberPreflight calls the same function');
  assert.ok(!/inputsAreBundle|bundleSha256Of/.test(src('tree-member.js')), 'tree-member.js holds no copy');
});

test('KO-9 a member started by hand under the WRONG personal-data mode is refused BEFORE run.json is written, so the next start under the right mode is not refused on a saved value (the trap: run.json saved the mode first, and every later sitting took the resume path and was refused again)', async () => {
  const m = await memberWithBundle({ piiGate: 'hard-stop' });                                  // the tree carries --pii-gate hard-stop
  const n = records(m.t).length;
  const wrong = m.run([]);                                                                       // started WITHOUT the mode
  assert.equal(wrong.status, 19, wrong.stdout + wrong.stderr);
  // the trap first (it is what the old code got wrong): nothing saved the wrong mode, and the sitting's rule (src/tree-run.js: a node with a run.json is RESUMED from what run.json saved, otherwise started) lets the right mode through
  assert.equal(existsSync(join(m.runDir, 'run.json')), false, 'nothing saved the wrong mode');
  const next = existsSync(join(m.runDir, 'run.json'))
    ? spawnSync(process.execPath, [cli, '--resume', m.runDir, '--max-usd', '30'], { cwd: m.t.work, encoding: 'utf8', env: ENV(m.t.work), timeout: 60_000 })
    : m.run(['--pii-gate', 'hard-stop']);
  assert.equal(next.status, 0, next.stdout + next.stderr);
  assert.equal(claimsOf(m.t).length > 0, true, 'the right mode started it');
  // then the refusal itself
  assert.match(wrong.stderr, /started without --pii-gate, but this tree's personal-data mode is hard-stop/);
  assert.match(wrong.stderr, /Start it under the tree's mode \(`council tree resume .*` does\), or close the node: `council tree decide .* --close R\/M1@g1`\./, 'the real fix first, then the way out');
  assert.deepEqual(records(m.t).slice(n).filter(e => e.event === 'blocked').map(e => [e.reason, e.check]), [['pii_mode_mismatch', 'pii_mode']], 'one record, from the one writer');
});

test('KO-9c the ROOT is covered too: a hard-stop tree whose root is run by hand without --pii-gate exits 19 and leaves no run.json (the root cannot be closed, so a saved wrong mode would have no way out but a new tree)', async () => {
  const t = newTree({ cap: 200, piiGate: 'hard-stop' });
  registerRoot(t.rootDir);
  const r = await api.run(rootOpts(t));                                                         // no piiGate: the wrong mode for this tree
  assert.equal(r.exitCode, 19, r.outputTail);
  assert.equal(existsSync(join(t.rootDir, 'run.json')), false, 'the wrong mode was not saved in the root folder');
  assert.match(r.outputTail, /Start it under the tree's mode; the root cannot be closed, so if that is not possible start a new tree with `council tree start`\./);
});

test('KO-9b the early call REQUIRES the piiGate argument (a missing value throws: the fail-open shape closed, as memberStart does)', async () => {
  const m = await memberWithBundle();
  const lineage = JSON.parse(readFileSync(lineageFile(m.t.work, 'R/M1'), 'utf8'));
  assert.throws(() => memberPreflight({ rootDir: m.t.rootDir, lineage, inputs: { task: join(m.bdir, 'task.md'), criteria: null, context: null } }), e => e instanceof TypeError && /piiGate must be/.test(e.message));
});
