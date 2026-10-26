// 0.8.3 ROADMAP 77, step 4a (the cli.js hook): an advice call started for a tree's paid recommendation mirrors its own reservation lines into the tree's record, in the process that spends. All $0 (mock advice chain), REAL verbs:
// `council gate answer` through a pseudo-terminal, then `council --advice-adopt runs/<id>`. Rows: (M1) a folder with the marker: every reservation line reaches the record as advice_reservation_mirrored, the gate passes and the request shows the spend;
// (M2) a marker that names another folder, a request that is not open, or a call the request never added (no advice_run_added), refuses the start (exit 2) before the approval is used, and nothing is spent; (M3) a folder without a marker mirrors nothing (an ordinary advice call is unchanged).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendTreeEvent, readTreeRecord } from '../src/tree-record.js';
import { MONEY_EPS, budgetOf, gateTree } from '../src/tree-budget.js';
import { registerAdviceAdmitted, adviceStart, endAdvice, writeAdviceTreeMarker } from '../src/tree-advice-record.js';
import { requestGate } from '../src/gate.js';
import { gateSeatsOf } from '../src/send-path-refusals.js';
import { readLedger } from '../src/gate-ledger.js';
import { closedRootTree, reservedLine, syntheticRun } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const hasPython = spawnSync('python3', ['-c', 'import pty'], { encoding: 'utf8' }).status === 0;
const sha = s => createHash('sha256').update(s).digest('hex');
const SHA = 'a'.repeat(64);
const CHAIN = 'mock-advise-priced';
const answer = { actor: 'session', via: 'mcp', reason: 'inside the typed cap; the person approves the brief' };

function inPty(cwd, args) {
  const py = `
import os, pty, sys
pid, fd = pty.fork()
if pid == 0:
    os.chdir(sys.argv[1]); os.execv(sys.argv[2], sys.argv[2:])
out = b''; sent = False
while True:
    try: b = os.read(fd, 4096)
    except OSError: break
    if not b: break
    out += b
    if not sent and b'[y/N]' in out:
        os.write(fd, sys.stdin.buffer.read()); sent = True
_, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(out)
sys.exit(os.waitstatus_to_exitcode(status))
`;
  return spawnSync('python3', ['-c', py, cwd, process.execPath, cli, ...args], { encoding: 'utf8', input: 'y\n', timeout: 60_000 });
}

// A tree with a held request, and a run folder as the add-on builds it: the brief, advice.meta.json and an APPROVED gate. `withMarker`: false = an ordinary advice call.
function setup(id, { withMarker = true, markerRun = id, open = true, grantUsd = 4 } = {}) {   // open: false = the request was held but adviceStart never added this call
  const t = closedRootTree({ cap: 20 }); track(t.work);
  const grant = registerAdviceAdmitted(t.rootDir, { adviceId: 'A1', grantUsd, stopId: 'e9', gateId: 'g-grant', shownSha256: SHA, answer, ttlMs: 600_000 });
  assert.equal(grant.event, 'advice_registered');
  if (open) adviceStart(t.rootDir, { adviceId: 'A1', runId: id, kind: 'first', briefSha256: SHA, shownSha256: SHA });
  const run = join(t.work, 'runs', id); mkdirSync(run, { recursive: true });
  const text = '# A brief\n\nShould we keep the legacy invoices column?\n';
  writeFileSync(join(run, 'advice-brief.md'), text);
  writeFileSync(join(run, 'advice.meta.json'), JSON.stringify({ schema: 'advice-meta/1', quote_id: `q_${'1'.repeat(24)}`, chain: CHAIN, gate: 'g1', brief_sha256: sha(text), mode: 'single', advisor: 'sol', effective_sensitivity: 'internal', question_hash: sha(id).slice(0, 16), question_words: [sha(`w${id}`).slice(0, 8), sha(`v${id}`).slice(0, 8)], has_new_evidence: false, quoted: { worst_usd: 0, expected_usd: 0, ceiling_usd: 1 }, previous_run: null, dispositions: [] }));
  // the shipped one-seat mock advice chain with a priced mock model, so its calls project a cost and write reservations (a $0 seat writes none); advice chains load only from the package or a directory outside the working folder
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock-advise-single.json'), 'utf8'));
  config.name = CHAIN; config.seats.critics[0].model = 'mock-priced'; config.seats.critics[0].maxTokens = 200;
  t.advDir = mkdtempSync(join(tmpdir(), 'tree-advice-chains-')); writeFileSync(join(t.advDir, `${CHAIN}.json`), JSON.stringify(config));
  const g = requestGate(run, { kind: 'advice', textPath: 'advice-brief.md', price: { ceiling_usd: 1 }, seats: gateSeatsOf(config), sensitivity: { label: 'internal', set_by: 'test' } });
  assert.ok(g.ok, g.message);
  assert.equal(inPty(t.work, ['gate', 'answer', `runs/${id}`, 'g1']).status, 0);
  if (withMarker) writeAdviceTreeMarker(run, { rootDir: t.rootDir, adviceId: 'A1' });
  if (withMarker && markerRun !== id) writeFileSync(join(run, 'tree-advice.json'), JSON.stringify({ schema: 'tree-advice/1', rootDir: t.rootDir, adviceId: 'A1', runId: markerRun }));
  return { t, run };
}
const adopt = (t, id) => spawnSync(process.execPath, [cli, '--advice-adopt', `runs/${id}`], { cwd: t.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: t.work, COUNCIL_ADVISE_COOLDOWN_MS: '0', COUNCIL_ADVICE_CHAINS_DIR: t.advDir }, timeout: 60_000 });
const mirrored = t => readTreeRecord(t.rootDir).events.filter(e => e.event === 'advice_reservation_mirrored');
const skip = !hasPython && 'python3 is not installed';

test('M1 an advice call with the marker mirrors every one of its own reservation lines into the tree record; the gate passes and the request shows the spend', { skip }, () => {
  const id = '2026-10-20T12-01-00-000Z';
  const { t, run } = setup(id);
  const r = adopt(t, id);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const own = readFileSync(join(run, 'spend-reservations.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.ok(own.length >= 2, 'the call reserved and settled');
  const lines = mirrored(t);
  assert.deepEqual(lines.map(e => e.line), own, 'the record holds exactly the call\'s own lines, in order');
  assert.ok(lines.every(e => e.adviceId === 'A1' && e.runId === id));
  assert.equal(gateTree(t.rootDir).ok, true, JSON.stringify(gateTree(t.rootDir).problems));
  const row = budgetOf(t.rootDir).advice.find(a => a.adviceId === 'A1');
  const charged = own.filter(l => l.event === 'settled').reduce((n, l) => n + l.usd, 0);
  assert.ok(row.spentUsd > 0, 'the priced mock seat spent something');
  assert.ok(Math.abs(row.spentUsd - charged) < 1e-9, `the request shows what the run's own settled lines charged (${row.spentUsd} vs ${charged})`);
  assert.ok(Math.abs(row.heldUsd - (4 - row.spentUsd)) < 1e-9, 'held is the grant minus the spend, counted once');
});

test('M2 a marker that cannot be used refuses the start before the approval is used: it names another folder, or its request is no longer open; nothing is sent or spent', { skip }, () => {
  const a = '2026-10-20T12-02-00-000Z';
  const wrong = setup(a, { markerRun: 'some-other-run' });
  const r1 = adopt(wrong.t, a);
  assert.equal(r1.status, 2, r1.stderr); assert.match(r1.stderr, /tree-advice\.json does not name this folder.*Nothing was sent and nothing was spent/);
  const b = '2026-10-20T12-03-00-000Z';
  const shut = setup(b);
  // the request ends before the call starts
  endAdvice(shut.t.rootDir, { adviceId: 'A1', reason: 'declined' });
  const r2 = adopt(shut.t, b);
  assert.equal(r2.status, 2, r2.stderr); assert.match(r2.stderr, /the tree request A1 is not open/);
  const c = '2026-10-20T12-05-00-000Z';
  const unadded = setup(c, { open: false });
  const r3 = adopt(unadded.t, c);
  assert.equal(r3.status, 2, r3.stderr); assert.match(r3.stderr, /has not added this call/);
  // the call's cap (the gate's ceiling, $1) is more than what is left of the grant ($0.50): refused, not clamped
  const d = '2026-10-20T12-06-00-000Z';
  const small = setup(d, { grantUsd: 0.5 });
  const r4 = adopt(small.t, d);
  assert.equal(r4.status, 2, r4.stderr); assert.match(r4.stderr, /is more than the \$0\.50\d* left of this tree request's grant.*Nothing was sent and nothing was spent/);
  for (const x of [wrong, shut, unadded, small]) {
    assert.equal(existsSync(join(x.run, 'run.json')), false);
    assert.equal(readLedger(x.run).lines.some(l => l.event === 'sent'), false, 'the approval was not used');
    assert.equal(mirrored(x.t).length, 0);
  }
});

test('M4 what is left of the grant counts a reserved line with NO settled line at its worst case, and a request that holds several runs sums them', () => {
  const t = closedRootTree({ cap: 20 }); track(t.work);
  registerAdviceAdmitted(t.rootDir, { adviceId: 'A1', grantUsd: 4, stopId: 'e9', gateId: 'g-grant', shownSha256: SHA, answer, ttlMs: 600_000 });
  const R1 = '2026-10-20T12-07-00-000Z', R2 = '2026-10-20T12-08-00-000Z';
  for (const r of [R1, R2]) { adviceStart(t.rootDir, { adviceId: 'A1', runId: r, kind: r === R1 ? 'first' : 'reask', briefSha256: SHA, shownSha256: SHA }); }
  const put = (r, line) => { syntheticRun(t, r, {}); appendFileSync(join(t.work, 'runs', r, 'spend-reservations.jsonl'), `${JSON.stringify(line)}\n`); return line; };
  const mirrorOf = (r, line) => appendTreeEvent(t.rootDir, { event: 'advice_reservation_mirrored', adviceId: 'A1', runId: r, line });
  mirrorOf(R1, put(R1, reservedLine('r1', 1.25)));                         // in flight: never settled
  mirrorOf(R2, put(R2, reservedLine('r1', 0.75)));
  const row = budgetOf(t.rootDir).advice[0];
  assert.ok(Math.abs(row.spentUsd - 2) < MONEY_EPS, `two unsettled reservations count at their worst case, summed: ${row.spentUsd}`);
  assert.ok(Math.abs(row.heldUsd - 2) < MONEY_EPS, 'held is the grant minus them');
});

test('M3 a folder without the marker is an ordinary advice call: it runs and mirrors nothing', { skip }, () => {
  const id = '2026-10-20T12-04-00-000Z';
  const { t } = setup(id, { withMarker: false, open: false });
  const r = adopt(t, id);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(mirrored(t).length, 0);
});
