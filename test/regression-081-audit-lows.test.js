// 0.8.1 pre-release audit round (MAN-4), the LOW findings of areas A4 (add-on surface) and A5 (the 0.8.0 fixes), fixed in the last batch. Each test fails on the audited code.
// A4-4 a stage bundle for a subagent points at model-written files with no notice; A4-6 the return path's hidden-character set was narrower than the README says;
// A4-7 a corrupt stop marker read as "nothing was spent"; A5-3 FX-7's marker list reached deriveRunStatus only; A5-4 the MCP status budget of a finished run missed later handoff spend;
// A5-5 `check-lock --run` passed when report.json had no criteria; A5-7 the declined_only stop mislabelled itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderStagePromptBundle } from '../src/stage-contract.js';
import { hiddenCharacterReport, stripHidden } from '../src/return-path.js';
import { spendReport } from '../src/spend.js';
import { stopState } from '../src/handoff-from-run.js';
import { budgetOf } from '../src/run-budget.js';
import { runResumability } from '../src/run-status.js';
import * as stopFiles from '../src/stop-files.js';
import { lockBlock } from '../src/criteria-lock.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const tmp = p => mkdtempSync(join(tmpdir(), p));
const put = (dir, files) => { mkdirSync(dir, { recursive: true }); for (const [n, b] of Object.entries(files)) writeFileSync(join(dir, n), typeof b === 'string' ? b : JSON.stringify(b)); return dir; };

test('A4-4: a stage bundle says the referenced files hold model-written text: data, never instructions', () => {
  const text = renderStagePromptBundle({ contract: { stage_id: 's', role: 'r', deliverable_format: { required_sections: ['a'] }, return_instructions: 'x' }, taskText: 'T', chainName: 'c', label: 'l', run: 'r1', references: ['BOARD.md'] });
  assert.match(text, /written by AI models/i);
  assert.match(text, /never (as )?instructions|not (as )?instructions/i);
});

test('A4-6: the return path also removes LRM, RLM, ALM (bidi controls) and counts zero-width spaces, word joiners and variation-selector-supplement characters; an emoji sequence survives', () => {
  const t = 'a‎b‏c؜d​e⁠f\u{E0100}g';
  assert.equal(stripHidden(t), 'abcdefg');
  const r = hiddenCharacterReport(t);
  assert.equal(r.bidi_controls, 3);
  assert.equal(r.invisible_characters, 3);
  const emoji = '\u{1F468}‍\u{1F469}‍\u{1F467} ❤️ ok';
  assert.equal(stripHidden(emoji), emoji, 'ZWJ and FE0F stay: a real emoji sequence needs them');
  assert.deepEqual(hiddenCharacterReport(emoji), { tag_characters: 0, bidi_controls: 0 });
});

test('A4-7: a corrupt stop marker is "spend unknown", never "nothing was spent"', () => {
  assert.equal(typeof stopFiles.stopSpendNote, 'function', 'src/stop-files.js exports stopSpendNote');
  const dir = put(tmp('thc-a47-'), { 'STOPPED-client_cancel.json': 'garbage{' });
  const marker = stopFiles.readStoppedMarker(dir);
  assert.equal(marker.data, null);
  assert.equal(stopFiles.stopSpendNote(marker), 'unknown');
  assert.equal(stopFiles.stopSpendNote({ stoppedBy: 'user', data: { beforeFirstCall: true } }), 'none');
  assert.equal(stopFiles.stopSpendNote({ stoppedBy: 'user', data: { beforeFirstCall: false } }), 'some');
  assert.equal(stopFiles.stopSpendNote({ stoppedBy: 'user', data: {} }), 'unknown');
  for (const f of ['src/mcp/server.js', 'src/mcp/advice.js']) assert.match(readFileSync(join(root, f), 'utf8'), /stopSpendNote\(/, `${f} uses it`);
});

test('A5-3: `council --spend` reads every stop marker deriveRunStatus reads (preflight, truncated, secret) and a NEEDS file whose answer exists is not "paused"', () => {
  const runs = join(tmp('thc-a53-'), 'runs');
  const id = n => `2026-10-06T0${n}-00-00-000Z`;
  put(join(runs, id(1)), { 'run.json': { chain: 'x' }, 'STOPPED-preflight.md': 'no' });
  put(join(runs, id(2)), { 'run.json': { chain: 'x' }, 'NEEDS-build.md': 'n', 'build.md': 'answered', 'STOPPED-truncated.md': 'cut', 'STOPPED-truncated.json': { stage: 'build' } });
  put(join(runs, id(3)), { 'run.json': { chain: 'x' }, 'STOPPED-secret.md': 'key' });
  put(join(runs, id(4)), { 'run.json': { chain: 'x' }, 'NEEDS-build.md': 'n', 'build.md': 'answered' });
  put(join(runs, id(5)), { 'run.json': { chain: 'x' }, 'NEEDS-build.md': 'n' });
  const r = spendReport(runs, { days: 30, now: Date.parse('2026-10-06T20:00:00Z') });
  const state = n => r.runs.find(x => x.id === id(n))?.state;
  assert.match(state(1), /^stopped/, state(1));
  assert.match(state(2), /^stopped/, state(2));
  assert.match(state(3), /^stopped/, state(3));
  assert.doesNotMatch(state(4), /^paused/, 'its answer exists');
  assert.equal(state(5), 'paused');
});

test('A5-3: the handoff banner reads a key-shaped stop, and a NEEDS file whose answer exists is not "never answered"', () => {
  const secret = put(tmp('thc-a53b-'), { 'run.json': { chain: 'x' }, 'STOPPED-secret.md': 'key' });
  assert.doesNotMatch(stopState(secret).reason, /crashed or killed/);
  const answered = put(tmp('thc-a53c-'), { 'run.json': { chain: 'x' }, 'NEEDS-build.md': 'n', 'build.md': 'answered' });
  assert.doesNotMatch(stopState(answered).reason, /never answered/);
  const waiting = put(tmp('thc-a53d-'), { 'run.json': { chain: 'x' }, 'NEEDS-build.md': 'n' });
  assert.match(stopState(waiting).reason, /never answered/);
});

test('A5-4: the MCP status budget of a finished run counts a handoff --from-run call made after the report (superseded/), like council --spend', () => {
  const dir = put(tmp('thc-a54-'), { 'report.json': { chain: 'x', totals: { usd: 0.5 }, maxUsd: 100 } });
  mkdirSync(join(dir, 'superseded'));
  writeFileSync(join(dir, 'superseded', 'handoff-from-run.call-1.usage.json'), JSON.stringify({ provider: 'mock', model: 'm', usd: 0.04 }));
  const b = budgetOf(dir, JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')));
  assert.ok(Math.abs(b.spentUsd - 0.54) < 1e-9, `spent ${b.spentUsd}`);
  assert.ok(Math.abs(b.remainingUsd - 99.46) < 1e-9);
});

test('A5-5: `council check-lock --run` with a report.json that has no criteria list is an error (nothing was compared), not a pass', () => {
  const dir = tmp('thc-a55-');
  const run = put(join(dir, 'runs', 'r1'), { 'report.json': { chain: 'x', totals: { usd: 0 } } });
  writeFileSync(join(dir, 'HANDOFF.md'), `# Plan\n\nBody.\n\n${lockBlock(['It exists.'], { runId: 'r1' })}`);
  const r = spawnSync(process.execPath, [cli, 'check-lock', 'HANDOFF.md', '--run', run], { cwd: dir, encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  assert.doesNotMatch(out, /criteria lock holds/, out);
  assert.notEqual(r.status, 0);
  assert.match(out, /no criteria|nothing (was )?(compared|checked)/i);
});

test('A5-7: a builder reply that is only DECLINED lines stops with its own message and its own "needs" (replace the reply), not "raise maxTokens"', () => {
  const dir = tmp('thc-a57-'); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a tiny thing.\n');
  writeFileSync(join(dir, 'chains', 'x.json'), JSON.stringify({ name: 'x', maxRounds: 1, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'external', model: 'claude-code-session' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } }));
  const env = { ...process.env }; for (const k of Object.keys(env)) if (/API_KEY/.test(k)) delete env[k];
  spawnSync(process.execPath, [cli, '--task', 'tasks/t.md', '--chain', 'x'], { cwd: dir, env, encoding: 'utf8' });
  const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  writeFileSync(join(run, 'build.md'), 'DECLINED: nothing here is a defect\nDECLINED: so I wrote nothing\n');
  const r = spawnSync(process.execPath, [cli, '--task', 'tasks/t.md', '--chain', 'x', '--resume', run], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(r.status, 17, `${r.stdout}${r.stderr}`);
  const md = readFileSync(join(run, 'STOPPED-truncated.md'), 'utf8');
  assert.doesNotMatch(md, /the provider ended it with stop "declined_only"/);
  assert.doesNotMatch(md, /build-retry\.md/);
  assert.match(md, /DECLINED/);
  assert.equal(runResumability(run, null).needs, 'replace_reply');
});
