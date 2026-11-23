// 0.8.1 FX-14 (owner's decision 2026-10-02, from the M1 review): `council handoff --from-run` on an advice run made a
// paid call and wrote a HANDOFF.md from an advice answer, read as signed off (report.passed is true for advice). An
// advice call has no plan to hand off, so the command refuses it (exit 2) before anything could spend. Offline.
// 0.8.4 (the add-on removal, wave 2): no advice call can be made any more, so the folder is built by hand in the shape an earlier version left (run.json, advise-log.json, a report with `advise` and passed: true).
// Q3 rows of the removal: handoff --from-run, contract draft --from-run and contract lock refuse the old folder, EACH ON THE FOLDER'S OWN FILES BEFORE ANY CHAIN IS LOOKED UP (WORDING REM-w32, REM-w1): the chain
// the folder names may be gone from the repository (exit 2 here, not the unknown-chain exit 1) and a project chain of the same name (the SHADOWING row) does not make the folder hand-off-able.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });

// A folder as an earlier version's advice call left it. `chainName` is what run.json says; `shadow` also writes a project chains/<chainName>.json (a plain planning chain with a builder seat), so a chain lookup that ran would find a chain that can really run.
function oldAdviceFolder({ chainName, shadow = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fx14-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# Advice\n\nShould the note list keep ticked items or remove them?\n');
  if (shadow) {
    // the SHADOW: a project chains/<name>.json that is a plain mock planning chain with a builder seat (the chain `mock`, renamed), so a lookup that found it could really call the seat
    const plain = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
    writeFileSync(join(dir, 'chains', `${chainName}.json`), JSON.stringify({ ...plain, name: chainName }));
  }
  const id = '2026-10-02T10-00-00-000Z'; const rd = join(dir, 'runs', id);
  mkdirSync(rd, { recursive: true });
  writeFileSync(join(rd, 'run.json'), JSON.stringify({ chain: chainName, task: join(dir, 'tasks', 't.md'), cwd: dir, label: 't' }));
  writeFileSync(join(rd, 'advise-log.json'), '{}');
  writeFileSync(join(rd, 'report.json'), readFileSync(join(root, 'test', 'fixtures', 'report-advice-single.json'), 'utf8'));   // passed: true, carries `advise`
  writeFileSync(join(rd, 'deliverable.md'), 'An old advice answer.\n');
  return { dir, id, rd };
}
// REM-w32 whole, with the run folder's absolute path (resolved by the CLI) in the middle
const refusal = (who, id) => new RegExp(`(^|\\n)${who}: \\S*${id} is an advice call, not a plan: there is nothing to hand off\\. Read its deliverable\\.md \\(the advice\\) instead\\.\\n?$`);
const noWrites = (rd, before) => {
  assert.deepEqual(readdirSync(rd).sort(), before, 'nothing written to the run folder');
  for (const f of ['HANDOFF.md', 'HANDOFF-from-run.md', 'handoff-from-run.usage.json', 'superseded', 'contract']) assert.equal(existsSync(join(rd, f)), false, f);
};

// CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD `--chain mock-advise-standard` found the chain in the package's chains/. NEW the chain is copied from test/fixtures/advice-chains/ into the work folder's chains/ first. WHY mock-advise-standard left chains/ with the add-on and is a fixture now; the run and the refusal are unchanged.
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: a real mock advice call was made through the CLI (the fixture chain mock-advise-standard copied into the work folder), then handed off: exit 2, stderr /advice/i. NEW: the old folder is built by hand and the refusal is REM-w32 whole (no chain clause). WHY: no advice call can be started any more; the refusal reads the folder's own files.
test('FX-14: handoff --from-run refuses an old advice folder with exit 2 and the REM-w32 sentence, writes nothing and calls nothing', () => {
  const { dir, id, rd } = oldAdviceFolder({ chainName: 'mock-advise-quick' });
  const before = readdirSync(rd).sort();
  const r = run(dir, ['handoff', '--from-run', join('runs', id)]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, refusal('handoff', id));
  assert.ok(!/chain "/.test(r.stderr), 'REM-w32: the chain clause is gone');
  noWrites(rd, before);
});

// NEW (0.8.4 add-on removal; Q3 and Q9): an OLD advice folder whose chain is gone from the repository (advise-single) is never handed off either: the chain lookup fails first (exit 1), says the chain was removed in 0.8.4 with the advice add-on (REM-w1), and nothing is written or called.
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD (wave 1): exit 1, "No such chain" and the removed-chain sentence REM-w1, because the chain lookup came first. NEW: exit 2 and REM-w32, no chain lookup at all. WHY: REM-w32 says the refusal is "now refused on the folder's own files before any chain is looked up".
test('FX-14b: handoff --from-run on an old advice folder of a removed chain exits 2 with the REM-w32 sentence (no chain is looked up), writes nothing and calls nothing', () => {
  const { dir, id, rd } = oldAdviceFolder({ chainName: 'advise-single' });
  const before = readdirSync(rd).sort();
  const r = run(dir, ['handoff', '--from-run', join('runs', id)]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /is an advice call, not a plan: there is nothing to hand off\. Read its deliverable\.md \(the advice\) instead\./);
  assert.ok(!/no such chain/i.test(r.stderr), 'the chain was never looked up');
  noWrites(rd, before);
});

// Q3 ROW (the shadowing row, handoff half): a project's own chains/advise-standard.json (here a plain planning chain with a builder seat) does not make an old advice folder hand-off-able.
test('FX-14c (shadowing): a project chains/advise-standard.json does not make an old advice folder hand-off-able: handoff --from-run and contract draft --from-run both refuse it, exit 2, nothing written', () => {
  const { dir, id, rd } = oldAdviceFolder({ chainName: 'advise-standard', shadow: true });
  const before = readdirSync(rd).sort();
  for (const [who, argv] of [['handoff', ['handoff', '--from-run', join('runs', id)]], ['contract draft', ['contract', 'draft', '--from-run', join('runs', id)]]]) {
    const r = run(dir, argv);
    assert.equal(r.status, 2, `${who}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, refusal(who, id), who);
    noWrites(rd, before);
  }
});

// Q3 ROW (contract lock): an old advice folder has nothing to make a contract from; the refusal reads the folder's own files.
test('FX-14d: contract lock on an old advice folder exits 2 with its sentence and writes no contract', () => {
  const { dir, id, rd } = oldAdviceFolder({ chainName: 'advise-standard', shadow: true });
  const before = readdirSync(rd).sort();
  const r = run(dir, ['contract', 'lock', join('runs', id)]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.ok(r.stderr.includes(`contract lock: ${join('runs', id)} is an advice call, not a plan: it has nothing to make a contract from`), r.stderr);
  noWrites(rd, before);
});
