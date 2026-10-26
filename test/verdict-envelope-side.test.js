// E3b unit three, commit 2 (gate note Review/Build_0.8.3/m6-closing/E3b_Unit3_Gate_Note.md section 2, ruled by C&C 14 Oct 2026): rematch, replay and init follow the same rule as a fresh run (the Reply identity sentence exists),
// the start value of a SIDE folder is recorded in <dir>/verdict-envelope.json, and demo is excluded. The sentence itself is HELD: in-process tests inject it; the CLI tests below run without it (pins). $0, offline.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setCache, setBudget } from '../src/chain.js';
import { runCouncilReplay } from '../src/council-replay.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as VE from '../src/verdict-envelope.js';
import * as H from './held-prompts/held-083.js';

afterEach(() => { setHeldForTest(null); setCache(null); setBudget(null); VE.setEnvelopeStore(null); VE.setEnvelopeInForce?.(false); });

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const WORDS = { verdictEnvelopeSection: H.verdictEnvelopeSection, criticEnvelopeReaskNote: H.criticEnvelopeReaskNote };
const sh = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 120_000 });
// the same child with the explicit off state (test/helpers/held-off-preload.js): "the sentence is not recorded", for the one test that proves what a side run does without it
const shOff = (cwd, ...args) => spawnSync(process.execPath, ['--import', join(root, 'test', 'helpers', 'held-off-preload.js'), cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 120_000 });
const original = (chain, run = sh) => {
  const work = mkdtempSync(join(tmpdir(), 'e3b-side-'));
  writeFileSync(join(work, 'task.md'), 'Write a one-paragraph plan for a bake sale.\n');
  const r = run(work, '--task', 'task.md', '--chain', chain, ...(chain === 'mock-budget' ? ['--max-usd', 'none'] : []));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { work, runDir: join(work, 'runs', readdirSync(join(work, 'runs'))[0]) };
};

test('E3b side flag: recorded wins; started without = false; fresh = the sentence exists; written only when true', () => {
  const fresh = () => mkdtempSync(join(tmpdir(), 'e3b-flag-'));
  const a = fresh();
  assert.equal(VE.sideEnvelopeFlag(a, false, true), true);
  assert.deepEqual(JSON.parse(readFileSync(join(a, 'verdict-envelope.json'), 'utf8')), { in_force: true }, 'the start value is recorded');
  assert.equal(VE.sideEnvelopeFlag(a, true, false), true, 'recorded wins, even resumed and even with the sentence gone (it then fails loud at the first critic call)');
  const b = fresh();
  assert.equal(VE.sideEnvelopeFlag(b, false, false), false);
  assert.equal(existsSync(join(b, 'verdict-envelope.json')), false, 'written only when true');
  const c = fresh();
  assert.equal(VE.sideEnvelopeFlag(c, true, true), false, 'a folder that already holds stage files and no record was started without the envelope');
  assert.equal(existsSync(join(c, 'verdict-envelope.json')), false);
  const d = fresh();
  writeFileSync(join(d, 'verdict-envelope.json'), '{not json');
  assert.equal(VE.sideEnvelopeFlag(d, false, true), false, 'an unreadable record is no envelope');
});

test('E3b replay: a replay whose side run uses the envelope records its pairs in ITS folder and its report carries verdict_envelope; one that does not carries none', async () => {
  const { work, runDir } = original('mock-unanimous');
  const chainsDir = join(root, 'chains');
  setHeldForTest(WORDS);
  let replayDir;
  const on = await runCouncilReplay(runDir, { chainsDir, workDir: work, date: new Date('2026-10-14'), onReady: async ({ dir }) => {
    mkdirSync(dir, { recursive: true });
    VE.setEnvelopeStore(VE.fileEnvelopeStore(dir)); VE.setEnvelopeInForce(true); replayDir = dir; // what armSideRun does with a true flag
    return { envelope: true, onStage() {}, unverified: [] };
  } });
  assert.equal(on.report.verdict_envelope, true);
  assert.ok(readdirSync(replayDir).some(f => f.endsWith('.envelope.json')), 'the pairs are in the replay folder');
  assert.equal(on.report.passed, true, 'the default mock critics echo the ids (commit 1), so the enveloped replay passes');
  setHeldForTest(null); VE.setEnvelopeInForce(false); VE.setEnvelopeStore(null);
  const off = await runCouncilReplay(runDir, { chainsDir, workDir: work, date: new Date('2026-10-15'), onReady: async () => ({ envelope: false, onStage() {}, unverified: [] }) });
  assert.equal('verdict_envelope' in off.report, false);
});

test('E3b replay: a STOPPED enveloped replay carries the flag in its partial report args', async () => {
  const { work, runDir } = original('mock-budget');
  setHeldForTest(WORDS);
  setBudget(0.0000001);
  let err;
  try {
    await runCouncilReplay(runDir, { chainsDir: join(root, 'chains'), workDir: work, date: new Date('2026-10-16'), onReady: async ({ dir }) => {
      mkdirSync(dir, { recursive: true }); VE.setEnvelopeStore(VE.fileEnvelopeStore(dir)); VE.setEnvelopeInForce(true);
      return { envelope: true, onStage() {}, unverified: [] };
    } });
  } catch (e) { err = e; }
  assert.ok(err?.partialReportArgs, 'the replay stopped at the cap with partial report args');
  assert.equal(err.partialReportArgs.verdictEnvelope, true);
});

// CHANGED ACCEPTED TEST (decider-readiness apply patch, 24 Okt 2026; C&C ruling (b)). OLD: the shipped state was "the sentence is held", so the plain child ran without it. NEW: the same property (without the sentence a side run writes no start record and adds no identity files or text) is proved in children started with the explicit off preload, because src/roles.js now records the sentence; the original run is made the same way. WHY: roles.js records verdictEnvelopeSection.
test('E3b side runs without the sentence (the shipped state) change nothing: rematch writes no start record, init and demo add no identity files or text [PINS]', () => {
  const { work, runDir } = original('mock-unanimous', shOff);
  const re = shOff(work, '--rematch', runDir, '--rematch-seed', '1');
  assert.equal(re.status, 0, re.stdout + re.stderr);
  const rematchDir = `${runDir}.rematch-1`;
  assert.equal(existsSync(join(rematchDir, 'verdict-envelope.json')), false);
  assert.equal('verdict_envelope' in JSON.parse(readFileSync(join(rematchDir, 'report.json'), 'utf8')), false);
  const initWork = mkdtempSync(join(tmpdir(), 'e3b-init-'));
  const init = shOff(initWork, 'init');
  assert.equal(init.status, 0, init.stdout + init.stderr);
  const initDir = join(initWork, 'runs', readdirSync(join(initWork, 'runs')).find(f => f.endsWith('-init')));
  assert.deepEqual(readdirSync(initDir).filter(f => /envelope/.test(f)), []);
  const demo = shOff(initWork, 'demo');
  assert.equal(demo.status, 0, demo.stderr);
  assert.equal(/Reply identity/.test(demo.stdout), false, 'demo prints no identity text');
});

test('E3b demo is EXCLUDED by a stated rule: its block in cli.js never sets the envelope store or flag (scripted replies, no run folder, a showcase)', () => {
  const src = readFileSync(cli, 'utf8');
  const block = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
  assert.equal(block("if (a) {\nsetX();\n}\nif (b) {", 'if (a)', 'if (b)').includes('setX'), true, 'self-test: the extractor sees a call inside the block');
  const demo = block(src, "if (argv[0] === 'demo') {", "if (argv[0] === 'init')");
  assert.ok(demo.length > 500, 'the demo block was found');
  assert.equal(/setEnvelope|sideEnvelopeFlag|fileEnvelopeStore/.test(demo), false);
  const init = block(src, "if (argv[0] === 'init')", "if (argv[0] === 'export-board')");
  assert.ok(/setEnvelopeStore\(fileEnvelopeStore\(initRunDir\)\)/.test(init), 'init records its pairs in its run folder');
});
