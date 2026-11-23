// 0.8.4 D1 (UNIT 3): the ending word through the REAL command and the first-mode path. The envelope (a project whose layered mock chain stops at the overseer cap, then `--resume <run> --finish`) is the one
// test/overseer-choice.test.js C3b uses and passes: copied, not re-invented. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain } from '../src/chain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const chainOf = (critics, over = {}) => ({
  name: 'ovc', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...over,
});
const project = (id = 'c', over = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'ovc-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'ovc.json'), JSON.stringify(chainOf([judge('o', `${id}a`, 'l1', 1), judge('o', `${id}b`, 'l2', 2), judge('x', `${id}c`, 'l3', 3)], over)));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  return { dir, run, done: () => rmSync(dir, { recursive: true, force: true }) };
};
const stopped = (over = {}) => { const p = project('c', over); const r = p.run(['--chain', 'ovc', '--task', 'tasks/t.md']); assert.equal(r.status, 23, r.stdout + r.stderr); p.runDir = join(p.dir, 'runs', readdirSync(join(p.dir, 'runs'))[0]); return p; };

test('W1 a run stopped at the overseer cap and finished by the person: report.json carries ending_word finish_chosen and stop_kind overseer_cap beside the legacy dispute.reason, and validates against the schema; the waiting run had none', () => {
  const p = stopped({ dispute: { enabled: true, stall_rounds: 99 } });
  try {
    const partial = JSON.parse(readFileSync(join(p.runDir, 'report-partial.json'), 'utf8'));
    assert.equal(partial.ending_word, undefined, 'a run waiting at a stop is not an ending: no word in report-partial.json');
    assert.equal(partial.stop_kind, undefined);
    const r = p.run(['--resume', p.runDir, '--finish']);
    assert.notEqual(r.status, 23, r.stdout + r.stderr);
    const report = JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8'));
    assert.deepEqual([report.ending_word, report.stop_kind, report.dispute.reason], ['finish_chosen', 'overseer_cap', 'finish_chosen']);
    assert.equal(report.stop.kind, 'overseer_cap');
    assert.equal(typeof report.stop.overseer_round, 'number', 'the stop is in the report with its round');
    const ajv = new Ajv2020({ strict: false, allErrors: true }); ajv.addFormat('date-time', true);
    const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')));
    assert.ok(validate(report), JSON.stringify(validate.errors));
  } finally { p.done(); }
});

test('W2 a first-mode run (the plain mock chain) gets a word too: the shared return path carries it', async () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  const r = await runChain({ config, request: 'A mock task.', log: () => {} });
  assert.equal(r.endingWord, r.passed ? 'signed_off' : 'round_cap');
  assert.equal(r.stopKind, undefined);
});
