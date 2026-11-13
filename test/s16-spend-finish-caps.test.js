// 0.8.4 S16 (F; T21q = the Anthropic ceiling, T21bz = the OpenRouter ceiling; N29): `--finish` at a spending stop UNDER THE PER-PROVIDER CAPS, through the real verbs. A layered chain of priced mock seats that declare the account they bill (mockBills): the builder and the reviser bill the
// Anthropic cap, the three critics the OpenRouter cap. The cap that lands the stop INSIDE the review rounds is FOUND (the target cap's typed limit is tried low to high, the other cap high); every stop is the harness's own. Offline, $0. Test shape: test/caps-resume.test.js.
// Asserted per cap: (a) --finish exits 4 with no new gate, no new file and no new reservation line, and records the finish with cap_name; (b) the next --resume waits (exit 21) for a raise of THAT cap only; (c) after the person's typed raise the final read runs and the
// run ends NOT agreed with report.json stop.kind budget_stop, chosen finish, cap_name = the cap (or, if the mock top seats cannot read the final plan, stops again at the final-read stop with its record).
// The fixture makes the FIRST charge of each cap fall inside the review rounds: the builder bills no cap; the reviser (anthropic) runs only after layer 1's scripted critic objects once (`mock-critic-script-xo`: objects, then signs), so its revise call is the first anthropic charge;
// layers 2 and 3 bill openrouter, so the first openrouter charge is layer 2's call in pass 2.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readGateAnswer, answerGate } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const BOTH = { COUNCIL_SPEND_CAPS: 'openrouter,anthropic' };
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });
const seat = (bills, extra = {}) => ({ provider: 'mock', model: 'mock-priced', maxTokens: 4000, ...(bills ? { mockBills: bills } : {}), ...extra });
const CHAIN = { name: 'sf-caps', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
  seats: { criteria: seat(null, { maxTokens: 100 }), builder: seat(null, { lab: 'author' }), reviser: seat('anthropic', { lab: 'author' }), critics: [{ provider: 'mock', model: 'mock-critic-script-xo-sfcaps', maxTokens: 4000, lab: 'l1', layer: 1 }, seat('openrouter', { lab: 'l2', layer: 2 }), seat('openrouter', { lab: 'l3', layer: 3 })] } };
const ID = '2026-11-09T14-00-00-000Z';
const LOWS = ['0.01', '0.5', '2', '8', '20'];   // the first charge of the target cap is inside the review rounds, so the smallest limit already lands there; the rest is a fallback
const STAGE = { openrouter: /^panel-/, anthropic: /^revise-/ };   // the stage the limit must stop, so a premise pass cannot hide the wrong stage
const read = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const gatesOf = d => ledger(d).filter(l => l.event === 'gate_requested').map(l => l.gate);
const capOf = (d, id) => readGateAnswer(d, id).gate.cap;
const typeLimit = (d, id, total) => { const g = readGateAnswer(d, id).gate; const a = answerGate(d, id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'tester', tty: true, typedCap: total }); assert.equal(a.ok, true, JSON.stringify(a)); };
const gateOfCap = (d, cap) => gatesOf(d).find(id => capOf(d, id).cap_name === cap && capOf(d, id).operation === 'start');
const files = d => readdirSync(d).filter(n => !/lock/i.test(n)).sort();
const reservations = d => (existsSync(join(d, 'spend-reservations.jsonl')) ? readFileSync(join(d, 'spend-reservations.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0);

function project() {
  const work = mkdtempSync(join(tmpdir(), 'thc-spend-finish-caps-')); dirs.push(work);
  mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change with a retry limit.\n'); writeFileSync(join(work, 'chains', 'sf-caps.json'), JSON.stringify(CHAIN));
  const run = args => { const r = spawnSync(process.execPath, [cli, ...args], { cwd: work, env: { PATH: process.env.PATH, HOME: work, ...BOTH }, encoding: 'utf8', timeout: 120_000 }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
  return { work, run, dir: join(work, 'runs', ID) };
}
// a caps run started, both limits typed (the target cap low, the other high), the resume that arms it
function stopAt(target, low) {
  const p = project();
  assert.equal(p.run(['--task', 'tasks/x.md', '--chain', 'sf-caps', '--run-id', ID]).code, 21);
  const other = target === 'anthropic' ? 'openrouter' : 'anthropic';
  typeLimit(p.dir, gateOfCap(p.dir, target), low); typeLimit(p.dir, gateOfCap(p.dir, other), '1000');
  return { ...p, first: p.run(['--resume', p.dir]) };
}
function findLoopStop(target) {
  const tried = [];
  for (const low of LOWS) {
    const a = stopAt(target, low);
    let st = null; try { st = read(a.dir, 'STOPPED-budget.json'); } catch { /* no stop file */ }
    tried.push(`${low}: exit ${a.first.code}, cap ${st?.capName ?? '-'}, phase ${st?.phase ?? '-'}, stage ${st?.stoppedAt ?? '-'}`);
    if (a.first.code === 4 && st?.capName === target && st.phase === 'loop' && STAGE[target].test(String(st.stoppedAt))) return a;
  }
  assert.fail(`premise: no typed limit for the ${target} cap stopped the run inside the review rounds at that cap: ${tried.join(' | ')}`);
}

for (const [row, target] of [['T21bz', 'openrouter'], ['T21q', 'anthropic']]) {
  test(`${row}: --finish at a stop inside the review rounds at the ${target} cap: recorded with the cap, no gate, no call; the next resume waits for a raise of that cap only; after the typed raise the final read runs and the run ends NOT agreed, budget_stop, cap_name ${target}`, () => {
    const a = findLoopStop(target);
    const gates = gatesOf(a.dir); const before = files(a.dir); const reserved = reservations(a.dir);
    const f = a.run(['--resume', a.dir, '--finish']);
    assert.equal(f.code, 4, f.out);
    assert.match(f.out, /Your choice to end the run here is recorded: nothing was run and nothing was spent\./);
    assert.deepEqual(gatesOf(a.dir), gates, 'no new gate: --finish asks nothing');
    assert.deepEqual(files(a.dir), before, 'no new file');
    assert.equal(reservations(a.dir), reserved, 'no call was reserved or sent');
    assert.equal(read(a.dir, 'run.json').budgetFinish.cap_name, target);
    // the resume that follows asks the raise of THAT cap, and nothing else
    const w = a.run(['--resume', a.dir]);
    assert.equal(w.code, 21, w.out);
    const fresh = gatesOf(a.dir).filter(g => !gates.includes(g));
    assert.equal(fresh.length, 1, `one new gate: ${fresh}`);
    assert.deepEqual([capOf(a.dir, fresh[0]).cap_name, capOf(a.dir, fresh[0]).operation], [target, 'raise']);
    assert.ok(!existsSync(join(a.dir, 'report.json')), 'the wait ended nothing');
    typeLimit(a.dir, fresh[0], '1000');
    const r = a.run(['--resume', a.dir]);
    assert.match(r.out, /you chose to end the run at the spending stop/);
    const labels = files(a.dir).filter(n => n.endsWith('.md')).map(n => n.replace(/\.md$/, ''));
    assert.ok(labels.some(l => l.startsWith('final-read-')), `the final read ran before the end: ${labels.join(', ')}`);
    if (existsSync(join(a.dir, 'report.json'))) {
      const report = read(a.dir, 'report.json');
      assert.deepEqual([report.passed, report.stop?.kind, report.stop?.chosen, report.stop?.cap_name], [false, 'budget_stop', 'finish', target]);
      assert.equal(report.stop.label, read(a.dir, 'run.json').budgetFinish.label, 'the stage the report names is the one the person finished at');
      assert.equal(r.code, 22);
    } else assert.ok(existsSync(join(a.dir, 'report-partial.json')), 'not ended without a report: it stopped again, with its record');
  });
}
