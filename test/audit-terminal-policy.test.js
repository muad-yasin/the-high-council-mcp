// 0.8.2 (owner via C&C, 7 Oct 2026: "Put the fix in 0.8.2, not 0.8.3"): `council gate answer` on an ADVICE gate re-checks policy.json the way the quote did, on the same figures the
// CLI's adopt gate compares (the chain's dry-run expected cost; the gate's recorded ceiling), shows the same "Policy warning:" lines before the question, and refuses an approval the
// policy refuses (nothing written). Declining is always allowed. $0: the shipped priced Sol chain, nothing is sent (the gate is answered or left pending).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerAtTerminal } from '../src/gate-cli.js';
import { readGateAnswer } from '../src/gate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BRIEF = () => ({
  schema_version: 'advice-brief/1', moment: 'before_commit',
  question: 'Should we drop the legacy invoices column before the release?',
  decision_at_stake: 'A dropped column cannot be restored once the migration has run in production.',
  options_considered: [{ name: 'Drop it now', summary: 'Run the migration before the release.' }, { name: 'Do less', summary: 'Keep the column and add a new one beside it.' }],
  tried: [{ what: 'Ran the migration on a copy of the data', result: 'It passed in 3 seconds.' }],
  sensitivity: 'internal', not_included: ['the conversation', 'environment variables'], excerpts: [],
});

// A pending advice gate made by the real MCP flow (a client that cannot elicit: the call returns "awaiting" and the terminal is the way to answer).
async function pendingGate(policy) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-term-policy-')); mkdirSync(join(dir, 'runs'));
  if (policy !== undefined) writeFileSync(join(dir, 'policy.json'), typeof policy === 'string' ? policy : JSON.stringify(policy));
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, COUNCIL_ADVISE_MOCK: '0', COUNCIL_ADVISE_COOLDOWN_MS: '0' } });
  const pending = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => { buf += d; let nl; while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); let m; try { m = JSON.parse(line); } catch { continue; } if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } });
  const rpc = (method, params) => new Promise(r => { const id = ++n; pending.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'terminal-policy', version: '0' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const q = (await rpc('tools/call', { name: 'council_quote', arguments: { brief: BRIEF(), mode: 'single' } })).result;
    if (q.isError) return { dir, refusedAtQuote: JSON.stringify(q) };
    await rpc('tools/call', { name: 'council_advise', arguments: { quote_id: q.structuredContent.quote_id, confirm_sha256: q.structuredContent.text.sha256 } });
    const run = readdirSync(join(dir, 'runs'))[0];
    return { dir, run: join(dir, 'runs', run) };
  } finally { child.stdin.end(); await Promise.race([new Promise(r => child.on('exit', r)), sleep(3000)]); child.kill(); }
}
function terminal(...typed) {
  const stdin = new PassThrough(); stdin.isTTY = true; stdin.setRawMode = () => {};
  const stdout = new PassThrough(); stdout.isTTY = true; const stderr = new PassThrough();
  let shown = '', errs = ''; stdout.on('data', d => { shown += d; }); stderr.on('data', d => { errs += d; });
  for (const t of typed) stdin.write(`${t}\n`);
  return { stdin, stdout, stderr, shown: () => shown, errs: () => errs };
}
const answer = async (run, typed, opts = {}) => { const t = terminal(...typed); const code = await answerAtTerminal(run, 'g1', { ...opts, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr }); return { code, shown: t.shown(), errs: t.errs() }; };

test('the terminal refuses an approval the policy refuses: a $0.25 limit lies between the preview\'s expected $0.057 and the CLI\'s $0.40, so it must read the CLI figure; nothing is written', async () => {
  const g = await pendingGate(undefined); // the quote is made with no policy; the policy is the person\'s own file and is read when the terminal answers
  assert.ok(g.run, g.refusedAtQuote);
  writeFileSync(join(g.dir, 'policy.json'), JSON.stringify({ max_usd_per_run: 0.25 }));
  assert.equal(readGateAnswer(g.run, 'g1').status, 'pending');
  const r = await answer(g.run, ['y']);
  assert.equal(r.code, 1, `${r.shown}${r.errs}`);
  assert.match(r.errs, /policy\.json refuses this call: max_usd_per_run: the expected cost of this call's chain \(the first figure --dry-run prints\) is \$0\.40\d\d/);
  assert.equal(/Approve sending/.test(r.shown), false, 'no question was asked');
  assert.equal(readGateAnswer(g.run, 'g1').status, 'pending', 'nothing was written');
});

test('the terminal shows the same "Policy warning:" line before the question when only the ceiling is over the limit, and the approval then goes through', async () => {
  const g = await pendingGate(undefined);
  writeFileSync(join(g.dir, 'policy.json'), JSON.stringify({ max_usd_per_run: 1 }));
  const r = await answer(g.run, ['y']);
  assert.equal(r.code, 0, `${r.shown}${r.errs}`);
  const line = r.shown.split('\n').find(l => l.startsWith('Policy warning: max_usd_per_run:'));
  assert.ok(line, r.shown.slice(0, 600));
  assert.match(line, /its ceiling\) is \$1\.3200, over it/);
  assert.ok(r.shown.indexOf('Policy warning:') < r.shown.indexOf('Approve sending'), 'the warning comes before the question');
  assert.equal(readGateAnswer(g.run, 'g1').status, 'approved');
});

test('declining is always allowed, even when the policy refuses the call; an unreadable policy.json refuses an approval (fail closed) and still allows a decline', async () => {
  const a = await pendingGate(undefined);
  writeFileSync(join(a.dir, 'policy.json'), JSON.stringify({ max_usd_per_run: 0.25 }));
  const d = await answer(a.run, ['y'], { decline: true });
  assert.equal(d.code, 0, `${d.shown}${d.errs}`);
  assert.equal(readGateAnswer(a.run, 'g1').status, 'declined');
  const b = await pendingGate(undefined);
  writeFileSync(join(b.dir, 'policy.json'), '{ broken');
  const refused = await answer(b.run, ['y']);
  assert.equal(refused.code, 1);
  assert.match(refused.errs, /policy\.json/);
  assert.equal(readGateAnswer(b.run, 'g1').status, 'pending');
  assert.equal((await answer(b.run, ['y'], { decline: true })).code, 0);
});

test('with no policy, or a policy that says nothing about the run\'s cost, the terminal prints exactly what it printed before (no policy line, same bytes)', async () => {
  const none = await pendingGate(undefined);
  const empty = await pendingGate({});
  const norm = (t, g) => t.split(g.run).join('RUN').replace(/expires: .*/g, 'expires: X').replace(/gate g1 .*\n/, 'gate g1\n').replace(/sha256 [0-9a-f]{64}/g, 'sha256 H').replace(/runs\/[^\s]+/g, 'runs/R');
  const a = await answer(none.run, ['n']); const b = await answer(empty.run, ['n']);
  assert.equal(/Policy/.test(a.shown + b.shown), false);
  assert.equal(norm(a.shown, none), norm(b.shown, empty), 'a policy with no max_usd_per_run adds nothing');
  assert.equal(a.code, 1); assert.equal(b.code, 1);
});

test('an advice run folder that is not inside a runs/ folder cannot be approved at the terminal (the project\'s policy.json cannot be located: fail closed); declining still works; no policy.json anywhere needed to trigger it', async () => {
  const { cpSync } = await import('node:fs');
  const g = await pendingGate(undefined);
  const outside = join(mkdtempSync(join(tmpdir(), 'thc-copied-')), 'run-copy'); // the parent has no policy.json and is not named runs
  cpSync(g.run, outside, { recursive: true });
  const refused = await answer(outside, ['y']);
  assert.equal(refused.code, 1, `${refused.shown}${refused.errs}`);
  assert.match(refused.errs, /this advice run is not inside a runs\/ folder, so its project's policy\.json cannot be located/);
  assert.equal(readGateAnswer(outside, 'g1').status, 'pending', 'nothing was written');
  assert.equal(/Approve sending/.test(refused.shown), false, 'no question was asked');
  assert.equal((await answer(outside, ['y'], { decline: true })).code, 0, 'declining is still allowed');
  assert.equal(readGateAnswer(outside, 'g1').status, 'declined');
  // the same gate in its own runs/ folder is unaffected
  assert.equal((await answer(g.run, ['y'])).code, 0);
});
