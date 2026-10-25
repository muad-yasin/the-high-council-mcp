// 0.8.3 overseer stop without figures (Builder C, 24 Okt 2026; C&C thcmcp-cd order, my ledger fact on the stop-words unit; A-DRAFT words): src/cli.js (a tree member whose report-partial.json cannot be read) calls stopSentence with `{ kind: roundMarker.stoppedBy }`
// alone, and the head of the sentence printed a figure it did not have: "all undefined overseer rounds were used", "layer undefined needed more than its undefined allowed revisions in overseer round undefined", "a seat in layer null ...". It now says it
// generally (whyOf, src/overseer-rounds.js); a stop that carries its figures reads exactly as before (the controls). The pure rows cover every kind and every missing figure; the CLI row is the real path of a member's direct `--continue`. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopSentence } from '../src/overseer-rounds.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const head = s => { const m = /^THE RUN STOPPED, NOT AGREED, and is waiting for your choice: (.*?)\. (?:Spent|The plan|Nothing more)/.exec(s); assert.ok(m, `the head names why: ${s}`); return m[1]; };
const NO_BLANKS = /undefined|null|NaN/;

test('a stop WITHOUT its figures says why generally, for every kind, and never prints a figure it does not have', () => {
  const rows = [
    [{ kind: 'overseer_cap' }, 'all its allowed overseer rounds were used and the top layer still objected'],
    [{ kind: 'layer_bound', why: 'unheard' }, 'a seat of a layer stayed silent for too many passes in a row'],
    [{ kind: 'layer_bound', why: 'revisions' }, 'a layer needed more than its allowed revisions and still objects'],
    [{ kind: 'layer_bound' }, 'a layer needed more than its allowed revisions, or a seat of a layer stayed silent for too many passes in a row'],
    [{}, 'an overseer limit was reached'],
  ];
  for (const [stop, why] of rows) {
    const s = stopSentence(stop, { runDir: 'runs/x' });
    assert.equal(head(s), why, JSON.stringify(stop));
    assert.doesNotMatch(s, NO_BLANKS, `${JSON.stringify(stop)}: ${s}`);
  }
});

test('one missing figure is enough to say it generally: a layer that is null, a bound that is absent, a cap that is not a number', () => {
  assert.equal(head(stopSentence({ kind: 'layer_bound', why: 'unheard', layer: null, passes: 3, overseer_round: 2 }, {})), 'a seat of a layer stayed silent for too many passes in a row', 'a silent seat whose layer is unknown (advance() passes layer: null)');
  assert.equal(head(stopSentence({ kind: 'layer_bound', why: 'revisions', layer: 2, overseer_round: 2 }, {})), 'a layer needed more than its allowed revisions and still objects', 'no bound');
  assert.equal(head(stopSentence({ kind: 'overseer_cap', cap: 'seven' }, {})), 'all its allowed overseer rounds were used and the top layer still objected', 'a cap that is not a count');
});

test('CONTROLS: a stop that carries its figures reads exactly as before', () => {
  assert.equal(head(stopSentence({ kind: 'overseer_cap', rounds: 7, cap: 7, pass: 20, overseer_round: 7 }, {})), 'all 7 overseer rounds were used and the top layer still objected');
  assert.equal(head(stopSentence({ kind: 'layer_bound', why: 'revisions', layer: 1, used: 5, bound: 5, pass: 9, overseer_round: 2 }, {})), 'layer 1 needed more than its 5 allowed revisions in overseer round 2 and still objects');
  assert.equal(head(stopSentence({ kind: 'layer_bound', why: 'unheard', layer: 2, passes: 3, reasks: 2, pass: 9, overseer_round: 2 }, {})), 'a seat in layer 2 stayed silent for 3 passes in a row in overseer round 2');
});

test('the real path (cli.js, a tree member whose report-partial.json cannot be read): a direct --continue prints the member text with a head that has no "undefined"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ovn-'));
  try {
    mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
    const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
    writeFileSync(join(dir, 'chains', 'ovn.json'), JSON.stringify({ name: 'ovn', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
      seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics: [judge('o', 'nfa', 'l1', 1), judge('o', 'nfb', 'l2', 2), judge('x', 'nfc', 'l3', 3)] } }));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
    const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    const first = run(['--chain', 'ovn', '--task', 'tasks/t.md']);
    assert.equal(first.status, 23, first.stdout + first.stderr);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    // the run becomes a tree member whose partial report is gone: the lineage in run.json, no report-partial.json
    const meta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
    writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...meta, tree: { treeId: '2026-10-08T11-00-00-000Z', node: 'R/M1', generation: 1 } }));
    rmSync(join(runDir, 'report-partial.json'));
    const r = run(['--resume', runDir, '--continue']);
    const text = r.stdout + r.stderr;
    assert.equal(r.status, 2, text);
    assert.match(text, /This run is a tree member/, text);
    assert.match(text, /THE RUN STOPPED, NOT AGREED, and is waiting for your choice: /, text);
    const at = text.indexOf('THE RUN STOPPED'); const headPart = text.slice(at, text.indexOf('\n\n', at));       // the head only: the member text after it is not what this row is about
    assert.equal(head(headPart), 'all its allowed overseer rounds were used and the top layer still objected', 'the marker says overseer_cap, no figures: said generally');
    assert.doesNotMatch(headPart, NO_BLANKS, headPart);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
