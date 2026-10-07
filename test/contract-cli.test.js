// `council contract lock | show | check | amend --decide` (0.8.2 item 6d, plan M8): the person's side of the contract record. The terminal answer is driven through streams that say they are a terminal
// (the way a person's terminal does), the rest through the real CLI as a child process. Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { contractCommand } from '../src/contract-cli.js';
import { answerGate, readGateAnswer, textSha256 } from '../src/gate.js';
import { readLedger } from '../src/gate-ledger.js';
import { contractState, requestAmendment } from '../src/contract-record.js';
import { FIXTURE_DRAFT } from '../scripts/contract-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const cli = join(repo, 'src', 'cli.js');
const FIX = join(here, 'fixtures', 'contract');
const tmp = () => mkdtempSync(join(tmpdir(), 'contract-cli-'));
const read = (d, rel) => readFileSync(join(d, rel), 'utf8');
const council = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd } });

// A workspace with runs/run-x holding a finished plan's report.json and a draft.
function workspace({ draft = FIXTURE_DRAFT } = {}) {
  const work = tmp(); const run = join(work, 'runs', 'run-x'); mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'report.json'), JSON.stringify({ passed: true, criteria: ['one', 'two'] }));
  mkdirSync(join(run, 'contract'));
  if (draft) writeFileSync(join(run, 'contract', 'draft.json'), JSON.stringify(draft));
  return { work, run };
}
// Streams that say they are a terminal, with what the person types.
function terminal(...typed) {
  const stdin = new PassThrough(); stdin.isTTY = true; stdin.setRawMode = () => {};
  const stdout = new PassThrough(); stdout.isTTY = true;
  const stderr = new PassThrough();
  let shown = '', errs = '';
  stdout.on('data', d => { shown += d; }); stderr.on('data', d => { errs += d; });
  for (const t of typed) stdin.write(`${t}\n`);
  return { stdin, stdout, stderr, shown: () => shown, errs: () => errs };
}
const plain = () => { const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough(); let shown = '', errs = ''; stdout.on('data', d => { shown += d; }); stderr.on('data', d => { errs += d; }); return { stdin, stdout, stderr, shown: () => shown, errs: () => errs }; };

test('lock without a terminal: the gate is requested, nothing is written, exit 3; after a person answers the gate, the same command locks (exit 0) and check, show agree', () => {
  const { work, run } = workspace();
  const r1 = council(work, 'contract', 'lock', 'runs/run-x');
  assert.equal(r1.status, 3, r1.stderr);
  assert.match(r1.stdout, /waiting for a person.*council gate answer runs\/run-x g1/s);
  assert.equal(existsSync(join(run, 'contract', 'v1.json')), false);
  // gate show says what the gate IS: nothing is sent, no price
  const shown = council(work, 'gate', 'show', 'runs/run-x', 'g1');
  assert.equal(shown.status, 0); assert.match(shown.stdout, /nothing is sent to any model and nothing is spent/); assert.doesNotMatch(shown.stdout, /price:/);
  assert.ok(shown.stdout.includes(FIXTURE_DRAFT.obligations[0].text), 'the exact words are on the screen');
  // the person answers through the terminal channel (here the same call the terminal command makes)
  const g = readGateAnswer(run, 'g1');
  assert.equal(answerGate(run, 'g1', { channel: 'cli', shownSha256: g.gate.sha256, decision: 'approved', actor: 'test', tty: true }).ok, true);
  const r2 = council(work, 'contract', 'lock', 'runs/run-x');
  assert.equal(r2.status, 0, r2.stderr); assert.match(r2.stdout, /locked version 1/);
  assert.equal(JSON.parse(read(run, 'contract/v1.json')).approval.gate, 'g1');
  const chk = council(work, 'contract', 'check', 'runs/run-x'); assert.equal(chk.status, 0, chk.stderr + chk.stdout); assert.match(chk.stdout, /contract v1: record, approval and ledger agree/);
  const show = council(work, 'contract', 'show', 'runs/run-x'); assert.equal(show.status, 0); assert.match(show.stdout, /O1 {2}in force/);
  const md = council(work, 'contract', 'show', 'runs/run-x', '--md'); assert.equal(md.status, 0); assert.equal(md.stdout, read(run, 'contract/CONTRACT.md'));
  assert.equal(council(work, 'contract', 'lock', 'runs/run-x').status, 1, 'a second lock is refused');
});

test('lock at a terminal: the person is shown the exact text and answers y; the lock follows in the same command', async () => {
  const { work, run } = workspace();
  const t = terminal('y');
  const code = await contractCommand(['lock', 'runs/run-x'], { work, ...t });
  assert.equal(code, 0, t.errs());
  assert.ok(t.shown().includes(FIXTURE_DRAFT.obligations[1].text), 'the whole text was printed');
  assert.match(t.shown(), /Approve recording exactly this text\? \[y\/N\]/);
  assert.match(t.shown(), /nothing is sent to any model and nothing is spent/);
  assert.equal(JSON.parse(read(run, 'contract/v1.json')).version, 1);
  assert.equal(readLedger(run).lines.filter(l => l.event === 'gate_answered')[0].channel, 'cli');
});

test('lock at a terminal: anything but y writes nothing and leaves the gate pending', async () => {
  const { work, run } = workspace();
  const t = terminal('n');
  assert.equal(await contractCommand(['lock', 'runs/run-x'], { work, ...t }), 1);
  assert.equal(existsSync(join(run, 'contract', 'v1.json')), false);
  assert.equal(readGateAnswer(run, 'g1').status, 'pending');
  // asking again reuses the same gate (no clutter) and a y then locks
  const t2 = terminal('y');
  assert.equal(await contractCommand(['lock', 'runs/run-x'], { work, ...t2 }), 0);
  assert.equal(readLedger(run).lines.filter(l => l.event === 'gate_requested').length, 1);
});

test('lock refuses what it should, each time with nothing written: a bad draft, no draft, an advice call, a run that is not a folder, an unknown option', async () => {
  const bad = workspace({ draft: { obligations: [{ id: 'O1', text: 'x', sha256: 'f'.repeat(64) }] } });
  const r = council(bad.work, 'contract', 'lock', 'runs/run-x');
  assert.equal(r.status, 1); assert.match(r.stderr, /refused by the lint/); assert.match(r.stderr, /identity field/);
  assert.equal(existsSync(join(bad.run, 'gates')), false); assert.equal(existsSync(join(bad.run, 'gate-ledger.jsonl')), false);
  const none = workspace({ draft: null });
  assert.equal(council(none.work, 'contract', 'lock', 'runs/run-x').status, 2); assert.match(council(none.work, 'contract', 'lock', 'runs/run-x').stderr, /no draft/);
  const adv = workspace(); writeFileSync(join(adv.run, 'advise-log.json'), '{}');
  assert.equal(council(adv.work, 'contract', 'lock', 'runs/run-x').status, 2);
  assert.equal(council(adv.work, 'contract', 'lock', 'runs/nope').status, 2);
  assert.equal(council(adv.work, 'contract', 'lock', 'runs/run-x', '--bogus').status, 2);
  assert.equal(council(adv.work, 'contract', 'bogus').status, 2);
  assert.equal(council(adv.work, 'contract', 'amend', 'runs/run-x').status, 2, 'amend without --decide is a usage error: a request is made through the tool');
  const crit = workspace({ draft: { obligations: [{ id: 'O1', text: 'x', criterion: 'C9' }] } });
  assert.match(council(crit.work, 'contract', 'lock', 'runs/run-x').stderr, /the run has no criterion C9/, 'the run\'s own criteria are read');
});

function locked() {
  const work = tmp(); const run = join(work, 'runs', 'run-v1'); cpSync(join(FIX, 'run-v1'), run, { recursive: true });
  return { work, run };
}

test('amend --decide: with no request it lists the open ones; a request that went stale cannot be decided', () => {
  const { work } = locked();
  const list = council(work, 'contract', 'amend', '--decide', 'runs/run-v1');
  assert.equal(list.status, 0); assert.match(list.stdout, /1 open amendment request against version 1/); assert.match(list.stdout, /4 {2}O2:/);
  const v2 = join(tmp(), 'runs', 'run-v2'); cpSync(join(FIX, 'run-v2'), v2, { recursive: true });
  const stale = council(dirname(dirname(v2)), 'contract', 'amend', '--decide', 'runs/run-v2', '5');
  assert.equal(stale.status, 1); assert.match(stale.stderr, /version 1; the contract is at version 2/);
  assert.equal(council(work, 'contract', 'amend', '--decide', 'runs/run-v1', 'x').status, 2);
});

test('amend --decide at a terminal, approve: the exact current and proposed words are shown first; version 2 names version 1 and the request; the old version file is unchanged', async () => {
  const { work, run } = locked();
  const v1 = read(run, 'contract/v1.json');
  const t = terminal('y');
  const code = await contractCommand(['amend', '--decide', 'runs/run-v1', '4'], { work, ...t });
  assert.equal(code, 0, t.errs());
  const text = t.shown();
  assert.ok(text.includes('Every error path prints one line naming the file and the reason.'), 'the current words');
  assert.ok(text.includes('Every error path prints one line naming the file, the line and the reason.'), 'the proposed words');
  assert.ok(text.includes('The line number is what a person needs to find the cause.'), 'the reason');
  assert.match(text, /Approve recording exactly this text\?/);
  assert.match(t.shown(), /version 2 recorded \(amended after lock, v2 from v1; obligation O2/);
  assert.equal(read(run, 'contract/v1.json'), v1);
  const v2 = JSON.parse(read(run, 'contract/v2.json'));
  assert.equal(v2.supersedes, 1); assert.equal(v2.amendment.request_seq, 4);
  assert.equal(contractState(run).current, 2);
  const chk = council(work, 'contract', 'check', 'runs/run-v1'); assert.equal(chk.status, 1, 'the fixture\'s report.json hashes are made up, so the thin check cannot hold: only the record half is the question here');
  assert.match(chk.stdout + chk.stderr, /contract v2: record, approval and ledger agree - amended after lock \(v2, from v1\)/);
});

test('amend --decide --decline: the person\'s refusal is recorded, the contract stays, and the request is no longer open', async () => {
  const { work, run } = locked();
  const t = terminal('y');
  assert.equal(await contractCommand(['amend', '--decide', 'runs/run-v1', '4', '--decline'], { work, ...t }), 0, t.errs());
  assert.match(t.shown(), /Decline gate g2: this text will not be recorded/);
  assert.match(t.shown(), /request 4 declined; the contract stays at version 1/);
  const last = readLedger(run).lines.at(-1);
  assert.equal(last.event, 'amend_decided'); assert.equal(last.decision, 'declined'); assert.equal(last.request_seq, 4);
  assert.equal(contractState(run).current, 1);
  assert.match(council(work, 'contract', 'amend', '--decide', 'runs/run-v1').stdout, /no open amendment requests/);
});

test('amend --decide without a terminal decides nothing: no version, no refusal line, exit 2; an unconfirmed prompt keeps the request open', async () => {
  const { work, run } = locked();
  const before = readLedger(run).lines.length;
  const r = council(work, 'contract', 'amend', '--decide', 'runs/run-v1', '4');
  assert.equal(r.status, 2); assert.match(r.stderr, /needs a person at a terminal/);
  assert.equal(contractState(run).current, 1);
  assert.equal(readLedger(run).lines.filter(l => l.event === 'amend_decided').length, 0);
  assert.ok(readLedger(run).lines.length - before <= 1, 'at most the gate request');
  const t = terminal('maybe');
  assert.equal(await contractCommand(['amend', '--decide', 'runs/run-v1', '4'], { work, ...t }), 1);
  assert.equal(contractState(run).requests.find(x => x.seq === 4).status, 'open');
});

test('nothing but a person\'s terminal answers a contract gate: the MCP-style channels are refused, and the contract code never names the way to answer', () => {
  const { run } = locked();
  requestAmendment(run, { version: 1, obligation_id: 'O1', reason: 'r', proposed_text: 'a different wording' });
  const seq = readLedger(run).lines.at(-1).seq;
  // an agent-side channel cannot answer a gate a contract command requested
  council(dirname(dirname(run)), 'contract', 'amend', '--decide', 'runs/run-v1', String(seq));
  const gates = readdirSync(join(run, 'gates')).filter(f => f.endsWith('.json'));
  const last = gates.sort().at(-1).replace('.json', '');
  for (const channel of ['mcp', 'agent', 'tool']) assert.equal(answerGate(run, last, { channel, shownSha256: readGateAnswer(run, last).gate.sha256, decision: 'approved' }).code, 'channel_not_person');
  assert.equal(readGateAnswer(run, last).status, 'pending');
  for (const f of ['contract-cli.js', 'contract-record.js', 'contract-lint.js']) assert.doesNotMatch(readFileSync(join(repo, 'src', f), 'utf8'), /\banswerGate\b/, `${f} must not name answerGate`);
  void textSha256;
});

test('contract check on a run with no locked contract answers exactly as before the record existed: the same lines and exit, with a draft, a pending proposal, or a broken ledger and no version file', () => {
  const work = tmp(); const run = join(work, 'runs', 'run-p'); mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'report.json'), '{"passed":true}');
  const base = council(work, 'contract', 'check', 'runs/run-p');
  assert.equal(base.status, 2, 'a report with no thin contract: nothing to check');
  assert.doesNotMatch(base.stdout + base.stderr, /record, approval and ledger|ledger is broken|contract folder/);
  const same = (what) => { const r = council(work, 'contract', 'check', 'runs/run-p'); assert.deepEqual([r.status, r.stdout, r.stderr], [base.status, base.stdout, base.stderr], what); };
  mkdirSync(join(run, 'contract'));
  // Superseded by the audit decision cnc-contract F3 (a run with no criteria refuses a draft that names one, on the lock side too; the draft prompt's rule is "With no # Criteria section, write no criterion"):
  // this run has no criteria, so its draft names none.
  writeFileSync(join(run, 'contract', 'draft.json'), JSON.stringify({ obligations: FIXTURE_DRAFT.obligations.map(({ criterion, ...o }) => o) })); writeFileSync(join(run, 'contract', 'draft-reply.md'), 'reply');
  same('a draft only');
  // a lock waiting for a person (exit 3) leaves a proposal file and a pending gate
  assert.equal(council(work, 'contract', 'lock', 'runs/run-p').status, 3);
  same('a lock waiting for a person');
  // a ledger that cannot be read, and no version file: still "no contract"
  writeFileSync(join(run, 'gate-ledger.jsonl'), 'not json\n');
  same('a broken ledger with no version file');
  // but a version file present with a broken ledger IS a problem
  writeFileSync(join(run, 'contract', 'v1.json'), '{}\n');
  const bad = council(work, 'contract', 'check', 'runs/run-p'); assert.equal(bad.status, 1); assert.match(bad.stderr, /ledger is broken/);
  const none = council(work, 'contract', 'check', 'runs/nope'); assert.equal(none.status, 2);
});

test('amend --decide --decline when the gate was already approved by a person: refused, nothing recorded (the flag never silently becomes an approval)', async () => {
  const { work, run } = locked();
  const t0 = plain();
  assert.equal(await contractCommand(['amend', '--decide', 'runs/run-v1', '4'], { work, ...t0 }), 2, 'no terminal: the gate is requested and waits');
  const g = readGateAnswer(run, 'g2');
  assert.equal(g.status, 'pending');
  assert.equal(answerGate(run, 'g2', { channel: 'cli', shownSha256: g.gate.sha256, decision: 'approved', actor: 'test', tty: true }).ok, true);
  const t = plain();
  assert.equal(await contractCommand(['amend', '--decide', 'runs/run-v1', '4', '--decline'], { work, ...t }), 1);
  assert.match(t.errs(), /--decline was given, but gate g2 was already approved/);
  assert.equal(contractState(run).current, 1, 'no version was recorded');
  // without the flag the approval the person gave is recorded
  const t2 = plain();
  assert.equal(await contractCommand(['amend', '--decide', 'runs/run-v1', '4'], { work, ...t2 }), 0, t2.errs());
  assert.equal(contractState(run).current, 2);
});

test('gate show on a used contract gate says "already used", not "already sent"', () => {
  const { work } = locked();
  const r = council(work, 'gate', 'show', 'runs/run-v1', 'g1');
  assert.equal(r.status, 0); assert.match(r.stdout, /already used/); assert.doesNotMatch(r.stdout, /already sent/);
});
