// 0.8.2 (owner via C&C, 7 Oct 2026: "Put the fix in 0.8.2, not 0.8.3"): `council gate answer` on an ADVICE gate re-checked policy.json the way the quote did and refused an approval the policy refused.
// 0.8.4 (the add-on removal, wave 2): nothing makes an advice gate any more and src/gate-cli.js no longer has that policy check (advicePolicyAtTerminal) or the price / seats / sensitivity / masks / follow-up
// lines of an advice gate's screen, so the five tests of this file about the advice terminal policy are removed with the code. The file keeps the one thing a person can still meet: an OLD gate of the kind
// `advice` (a ledger an earlier version wrote) is a gate of an unknown kind to this version, and its terminal screen is the plain one (WORDING REM-w28). $0, nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerAtTerminal } from '../src/gate-cli.js';
import { readGateAnswer, requestGate } from '../src/gate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const BRIEF_TEXT = '# A brief\n\nShould we drop the legacy invoices column before the release?\n';

// NEW (0.8.4 add-on removal, wave 2; REM-w28): the gate is built by hand in the shape an earlier version recorded (kind advice, with a price, seats and a sensitivity), then shown with `council gate show` and put to a
// terminal (typed n). Both screens carry the gate line and `expires:` and none of the five advice lines; the record keeps the fields (they are the ledger's, byte-stable).
function oldAdviceGate() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-term-policy-')); mkdirSync(join(dir, 'runs'));
  const id = '2026-10-03T06-00-00-001Z';
  const run = join(dir, 'runs', id);
  mkdirSync(run);
  writeFileSync(join(run, 'advice-brief.md'), BRIEF_TEXT);
  const g = requestGate(run, { kind: 'advice', textPath: 'advice-brief.md', price: { ceiling_usd: 1.5 }, seats: [{ lab: 'mock-a', model: 'mock-x', retention: 'unknown' }], sensitivity: { label: 'internal', set_by: 'test' } });
  assert.ok(g.ok, g.message);
  assert.equal(readGateAnswer(run, 'g1').status, 'pending');
  return { dir, id, run };
}
const FIVE = [/^price:/m, /^seats:/m, /^sensitivity:/m, /^masked before sending:/m, /^follow-up:/m];
const GATE_LINE = /^gate g1 \(advice\): advice-brief\.md, \d+ bytes, sha256 [0-9a-f]{64}$/m;
function terminal(...typed) {
  const stdin = new PassThrough(); stdin.isTTY = true; stdin.setRawMode = () => {};
  const stdout = new PassThrough(); stdout.isTTY = true; const stderr = new PassThrough();
  let shown = '', errs = ''; stdout.on('data', d => { shown += d; }); stderr.on('data', d => { errs += d; });
  for (const t of typed) stdin.write(`${t}\n`);
  return { stdin, stdout, stderr, shown: () => shown, errs: () => errs };
}

test('REM-w28: `council gate show` of an old gate of the kind "advice" (an unknown kind now) prints the gate line and expires: and no price, seats, sensitivity, masked-before-sending or follow-up line', () => {
  const { dir, id } = oldAdviceGate();
  const shown = spawnSync(process.execPath, [cli, 'gate', 'show', join('runs', id), 'g1'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, GATE_LINE);
  assert.match(shown.stdout, /^expires: /m);
  for (const re of FIVE) assert.doesNotMatch(shown.stdout, re);
});

test('REM-w28: the terminal answer of the same gate shows the same plain screen before it asks, and a typed n approves nothing', async () => {
  const { run } = oldAdviceGate();
  const t = terminal('n');
  const code = await answerAtTerminal(run, 'g1', { stdin: t.stdin, stdout: t.stdout, stderr: t.stderr });
  const shown = t.shown();
  assert.match(shown, GATE_LINE, `${shown}${t.errs()}`);
  assert.match(shown, /^expires: /m);
  for (const re of FIVE) assert.doesNotMatch(shown, re);
  assert.equal(code, 1, 'a typed n is not confirmed');
  assert.match(shown, /Not confirmed\. Nothing was written; the gate stays pending\./);
  assert.equal(readGateAnswer(run, 'g1').status, 'pending');
});
