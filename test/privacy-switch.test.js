// 0.8.4 D10 (plan A T5.5), slice 1: the privacy switch's ON state in the run's gate ledger. A run started or resumed with `--approve-excerpts`, or with a chain whose own file sets `approve_excerpts: true`, gets ONE
// ledger line, `excerpt_switch_on`: a setting THC recorded (source flag or chain, no actor, no channel, `approval: false`), not a person's answer. The state is read back from the ledger (src/gate.js
// excerptSwitchOf): a resume keeps it whatever run.json or the chain file say, a missing ledger reads as off, a ledger that does not verify reads as a refusal and never as off, and no line in this slice can turn it off.
// The approval pause itself (`awaiting_excerpt_approval`) and the person's answers are later slices. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir, hostname } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// guarded: on a tree without these exports (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { recordExcerptSwitchOn, excerptSwitchOf, EXCERPT_SWITCH_EVENT, EXCERPT_SWITCH_SOURCES, listGates, appendEvent } = await import('../src/gate.js');
import { EVENTS, LEDGER_FILE, LEDGER_LOCK_FILE, readLedger } from '../src/gate-ledger.js';
import { contractState } from '../src/contract-record.js';
import Ajv from 'ajv';
import { lintChain } from '../src/chain-lint.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'thc-privacy-')); dirs.push(d); return d; };
const NOW = () => Date.parse('2026-11-04T06:00:00.000Z');
const ledgerLines = dir => readFileSync(join(dir, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

// ---- the ledger functions -------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('the event is in the ledger\'s list, and recording writes ONE chained line: a setting THC recorded (source, recorded_by, approval: false), with no actor and no channel', () => {
  assert.ok(EVENTS.includes(EXCERPT_SWITCH_EVENT));
  const dir = tmp();
  const r = recordExcerptSwitchOn(dir, { source: 'flag' }, { now: NOW });
  assert.deepEqual([r.ok, r.already, r.seq], [true, false, 1]);
  const lines = ledgerLines(dir);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], { schema: 'gate-ledger/1', seq: 1, prev: null, ts: '2026-11-04T06:00:00.000Z', event: 'excerpt_switch_on', source: 'flag', recorded_by: 'thc', approval: false });
  assert.equal('actor' in lines[0] || 'channel' in lines[0], false, 'nothing here can be read as a person\'s answer');
  assert.equal(readLedger(dir).ok, true, 'the line is part of a ledger that verifies');
});

test('asking again records nothing (the first line stands for the run); a source that is neither the flag nor the chain is refused and writes nothing', () => {
  const dir = tmp();
  assert.equal(recordExcerptSwitchOn(dir, { source: 'chain' }, { now: NOW }).already, false);
  const again = recordExcerptSwitchOn(dir, { source: 'flag' }, { now: NOW });
  assert.deepEqual([again.ok, again.already, again.seq], [true, true, 1]);
  assert.equal(ledgerLines(dir).length, 1);
  assert.equal(ledgerLines(dir)[0].source, 'chain', 'the line keeps the source that turned it on');
  const other = tmp();
  for (const source of ['person', 'session', '', undefined, 'FLAG']) assert.equal(recordExcerptSwitchOn(other, { source }).code, 'bad_source', String(source));
  assert.equal(existsSync(join(other, LEDGER_FILE)), false);
  assert.deepEqual([...EXCERPT_SWITCH_SOURCES], ['flag', 'chain']);
});

test('excerptSwitchOf: no ledger reads as off; a ledger of other events reads as off; the line reads as on with its source and time', () => {
  const dir = tmp();
  assert.deepEqual(excerptSwitchOf(dir), { ok: true, on: false });
  appendEvent(dir, 'amend_requested', { note: 'an event of another kind' });
  assert.equal(readLedger(dir).lines.length, 1, 'the ledger now holds a line that is not ours');
  assert.deepEqual(excerptSwitchOf(dir), { ok: true, on: false });
  recordExcerptSwitchOn(dir, { source: 'flag' }, { now: NOW });
  assert.deepEqual(excerptSwitchOf(dir), { ok: true, on: true, seq: 2, source: 'flag', ts: '2026-11-04T06:00:00.000Z' });
});

test('chain verification: a ledger that does not verify is a refusal and NEVER "off" - an earlier line edited, and a forged line that turns the switch off (no such event exists) both fail closed; recording is refused too', () => {
  const dir = tmp();
  recordExcerptSwitchOn(dir, { source: 'flag' }, { now: NOW });
  // a forged, correctly chained second line that tries to turn the switch off: the event name is not in the ledger's list, so the ledger reads as broken
  const first = readFileSync(join(dir, LEDGER_FILE), 'utf8');
  const prev = createHash('sha256').update(first.replace(/\n$/, '')).digest('hex');
  appendFileSync(join(dir, LEDGER_FILE), `${JSON.stringify({ schema: 'gate-ledger/1', seq: 2, prev, ts: '2026-11-04T06:00:01.000Z', event: 'excerpt_switch_off', source: 'person' })}\n`);
  assert.equal(readLedger(dir).ok, false, 'an unknown event breaks the ledger');
  const read = excerptSwitchOf(dir);
  assert.deepEqual([read.ok, read.code], [false, 'gate_ledger_corrupt']);
  assert.equal(recordExcerptSwitchOn(dir, { source: 'flag' }).ok, false, 'a broken ledger takes no new line');
  // an earlier line edited (the first of two): the second line's `prev` no longer matches
  const dir2 = tmp();
  recordExcerptSwitchOn(dir2, { source: 'flag' }, { now: NOW });
  const l1 = readFileSync(join(dir2, LEDGER_FILE), 'utf8');
  const prev2 = createHash('sha256').update(l1.replace(/\n$/, '')).digest('hex');
  appendFileSync(join(dir2, LEDGER_FILE), `${JSON.stringify({ schema: 'gate-ledger/1', seq: 2, prev: prev2, ts: '2026-11-04T06:00:02.000Z', event: 'more_material_requested', items: [] })}\n`);
  assert.equal(excerptSwitchOf(dir2).on, true, 'two good lines: on');
  writeFileSync(join(dir2, LEDGER_FILE), readFileSync(join(dir2, LEDGER_FILE), 'utf8').replace('"source":"flag"', '"source":"chain"'));
  assert.equal(excerptSwitchOf(dir2).code, 'gate_ledger_corrupt', 'an edited first line breaks the chain');
});

test('the readers of the run\'s ledger leave the new line alone: the contract state, the gate list and `council gate verify` see a ledger with only this line as one with no gate and no contract', () => {
  const dir = tmp();
  recordExcerptSwitchOn(dir, { source: 'flag' }, { now: NOW });
  const st = contractState(dir);
  assert.equal(st.ok, true);
  assert.deepEqual(st.versions, []);
  assert.deepEqual(listGates(dir), []);
  const v = spawnSync(process.execPath, [cli, 'gate', 'verify', dir], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: dir } });
  assert.equal(v.status, 0, v.stdout + v.stderr);
  assert.match(v.stdout, /gate ledger holds \(1 line\)/);
});

// ---- the chain key ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('chain-lint: approve_excerpts must be true or false; any other value is a finding (it would silently leave the switch off), and true and false and absent are fine', () => {
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  const kinds = cfg => lintChain(cfg, 'chains/x.json').map(f => f.kind);
  for (const bad of ['yes', 'true', 1, null, {}]) assert.ok(kinds({ ...base, approve_excerpts: bad }).includes('approve-excerpts'), JSON.stringify(bad));
  for (const ok of [true, false]) assert.equal(kinds({ ...base, approve_excerpts: ok }).includes('approve-excerpts'), false, String(ok));
  assert.equal(kinds(base).includes('approve-excerpts'), false);
});

test('chain-schema: approve_excerpts is a boolean and nothing else', () => {
  const schema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const chain = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  assert.equal(validate({ ...chain, approve_excerpts: true }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...chain, approve_excerpts: false }), true);
  for (const bad of ['yes', 'true', 1, null]) assert.equal(validate({ ...chain, approve_excerpts: bad }), false, JSON.stringify(bad));
});

// ---- through the CLI: real runs on a mock chain ---------------------------------------------------------------------------------------------------------------------------------------

function project(extra = {}) {
  const dir = tmp();
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  // the builder is an external seat, so a run pauses (exit 3) and can be resumed twice without finishing
  writeFileSync(join(dir, 'chains', 'p.json'), JSON.stringify({ ...cfg, name: 'p', seats: { ...cfg.seats, builder: { provider: 'external', model: 'x', lab: 'ext' } }, ...extra }));
  return dir;
}
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
const runDirOf = dir => join(dir, 'runs', readdirSync(join(dir, 'runs')).filter(d => !d.includes('.'))[0]);

test('a start with --approve-excerpts records the switch before any stage: the run pauses at its external seat (exit 3) and its ledger holds ONE line, source flag; without the flag or the key there is no ledger at all', () => {
  const dir = project();
  const r = run(dir, ['--chain', 'p', '--task', 'tasks/t.md', '--approve-excerpts']);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  const lines = ledgerLines(runDirOf(dir));
  assert.deepEqual(lines.map(l => [l.event, l.source, l.recorded_by, l.approval]), [['excerpt_switch_on', 'flag', 'thc', false]]);
  const plain = project();
  assert.equal(run(plain, ['--chain', 'p', '--task', 'tasks/t.md']).status, 3);
  assert.equal(existsSync(join(runDirOf(plain), LEDGER_FILE)), false, 'a run that asked for nothing writes no ledger');
});

test('a chain whose own file sets approve_excerpts: true records source chain; with the flag as well the flag is the source', () => {
  const dir = project({ approve_excerpts: true });
  assert.equal(run(dir, ['--chain', 'p', '--task', 'tasks/t.md']).status, 3);
  assert.equal(ledgerLines(runDirOf(dir))[0].source, 'chain');
  const both = project({ approve_excerpts: true });
  assert.equal(run(both, ['--chain', 'p', '--task', 'tasks/t.md', '--approve-excerpts']).status, 3);
  assert.equal(ledgerLines(runDirOf(both))[0].source, 'flag');
  const off = project({ approve_excerpts: false });
  assert.equal(run(off, ['--chain', 'p', '--task', 'tasks/t.md']).status, 3);
  assert.equal(existsSync(join(runDirOf(off), LEDGER_FILE)), false, 'false asks for nothing');
});

test('a resume with the flag turns the switch on mid-run (one line, source flag); a second resume with the flag adds nothing; a plain resume keeps it; run.json and the chain file cannot turn it off', () => {
  const dir = project();
  assert.equal(run(dir, ['--chain', 'p', '--task', 'tasks/t.md']).status, 3);
  const rd = runDirOf(dir);
  assert.equal(excerptSwitchOf(rd).on, false);
  assert.equal(run(dir, ['--resume', rd, '--approve-excerpts']).status, 3);
  assert.deepEqual(excerptSwitchOf(rd), { ok: true, on: true, seq: 1, source: 'flag', ts: excerptSwitchOf(rd).ts });
  assert.equal(run(dir, ['--resume', rd, '--approve-excerpts']).status, 3);
  assert.equal(ledgerLines(rd).length, 1, 'asking again adds nothing');
  // the two places a project can write: run.json and the chain file
  const meta = JSON.parse(readFileSync(join(rd, 'run.json'), 'utf8'));
  writeFileSync(join(rd, 'run.json'), JSON.stringify({ ...meta, approve_excerpts: false, excerpt_switch: 'off' }));
  const chainFile = JSON.parse(readFileSync(join(dir, 'chains', 'p.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'p.json'), JSON.stringify({ ...chainFile, approve_excerpts: false }));
  assert.equal(run(dir, ['--resume', rd]).status, 3);
  assert.equal(excerptSwitchOf(rd).on, true, 'a plain resume keeps the switch');
  assert.equal(ledgerLines(rd).length, 1);
});

test('fail closed on a resume: a run whose ledger does not verify is refused before any stage (exit 2, by the readers that were there already) and the flag cannot get around it', () => {
  const dir = project();
  assert.equal(run(dir, ['--chain', 'p', '--task', 'tasks/t.md', '--approve-excerpts']).status, 3);
  const rd = runDirOf(dir);
  const file = join(rd, LEDGER_FILE);
  writeFileSync(file, `${readFileSync(file, 'utf8')}{"schema":"gate-ledger/1","seq":9}\n`);   // a complete line that does not belong: a mid-file break
  const r = run(dir, ['--resume', rd, '--approve-excerpts']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /approval record of this run cannot be read/);
  assert.match(r.stderr, /Nothing was run and nothing was spent\./);
  const plain = run(dir, ['--resume', rd]);   // the readers do not need the flag: a plain resume of the same run is refused the same way
  assert.equal(plain.status, 2, plain.stdout + plain.stderr);
  assert.match(plain.stderr, /approval record of this run cannot be read/);
});

test('a resume whose switch cannot be recorded stops before any stage: with the ledger held by another process the record is refused (gate_busy), exit 2, and the run is not continued', () => {
  const dir = project();
  assert.equal(run(dir, ['--chain', 'p', '--task', 'tasks/t.md']).status, 3);
  const rd = runDirOf(dir);
  writeFileSync(join(rd, LEDGER_LOCK_FILE), JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString(), nonce: 'held-by-the-test' }));   // a live holder on this host
  const r = run(dir, ['--resume', rd, '--approve-excerpts']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /privacy switch could not be recorded \(gate_busy\): /);
  assert.match(r.stderr, /Nothing was run and nothing was spent\./);
  assert.equal(existsSync(join(rd, LEDGER_FILE)), false, 'nothing was recorded');
});

test('--approve-excerpts is refused on anything that is not a start or a resume of a council run (exit 2, nothing started): a command, a side option; a typo of the flag and --approve-excerpts=value are refused as before', () => {
  const dir = project();
  for (const args of [['gate', 'verify', 'runs/x'], ['doctor'], ['--rematch', 'runs/x'], ['--stats'], ['tree', 'status']]) {
    const r = run(dir, [...args, '--approve-excerpts']);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--approve-excerpts: it keeps every excerpt of project text for your approval/, args.join(' '));
    assert.match(r.stderr, /Nothing was run and nothing was spent\./);
  }
  assert.equal(run(dir, ['--chain', 'p', '--task', 'tasks/t.md', '--approve-excerpt']).status, 2, 'a typo of the flag is unknown');
  assert.equal(run(dir, ['--chain', 'p', '--task', 'tasks/t.md', '--approve-excerpts=yes']).status, 2, 'the flag takes no value');
  assert.equal(existsSync(join(dir, 'runs')), false, 'none of them started a run');
});

test('a chain whose approve_excerpts is present and not true or false does not run: the chain-lint gate at chain load stops it (exit 1, "will not run"), naming the finding, before any run folder exists', () => {
  for (const bad of ['yes', 'true', 1, null]) {
    const dir = project({ approve_excerpts: bad });
    const r = run(dir, ['--chain', 'p', '--task', 'tasks/t.md']);
    assert.equal(r.status, 1, `${JSON.stringify(bad)}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /will not run/);
    assert.match(r.stderr, /\[approve-excerpts\] approve_excerpts .* is not true or false/);
    assert.equal(existsSync(join(dir, 'runs')), false);
  }
  // the same gate stands on a resume: a chain edited to a bad value between a start and a resume does not run
  const dir = project();
  assert.equal(run(dir, ['--chain', 'p', '--task', 'tasks/t.md']).status, 3);
  const chainFile = JSON.parse(readFileSync(join(dir, 'chains', 'p.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'p.json'), JSON.stringify({ ...chainFile, approve_excerpts: 'yes' }));
  const again = run(dir, ['--resume', runDirOf(dir)]);
  assert.equal(again.status, 1, again.stdout + again.stderr);
  assert.match(again.stderr, /will not run/);
  assert.match(again.stderr, /\[approve-excerpts\]/);
});
