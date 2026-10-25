// 0.8.3 M6 S5b part B (decide text; B's contract 3.9): the text a person types at `council tree decide` reaches every regenerated child's context.md (part 7) and was scanned NOWHERE. It now gets the SAME all-shapes key scan a run applies to
// its inputs (run-preflight textSecretFindings: INPUT_SCAN, the reserved-placeholder-host exemption of Part E and nothing else exempt), after the text is read and BEFORE the gate text is built or any event is appended: exit 1, the pattern name and
// the line - never the value - and the typed text is not echoed. Real flow on a real root (the shape of test/tree-root-decide.test.js), all-mock, $0. The key-shaped strings are ASSEMBLED HERE FROM PARTS (this repo is public and its own scanners read it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTreeEvent, readTreeRecord } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { decideHandler } from '../src/tree-decide.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const STOP = { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] };
const KEY = ['sk-ant-', 'api03-', 'A'.repeat(40)].join('');
const URL_OF = host => ['postgres', '://user:', 'pass', '@', host, '/db'].join('');
async function rootWithStop(over = {}) {
  const r = await trackedRealRoot({ ...pricedChildren(), ...over }); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  return { r, stop: appendTreeEvent(r.t.rootDir, STOP) };
}
const decide = (r, stop, typed, tail = [stop.id, 'y']) => {
  const io = terminal([`${typed}\n.`, ...tail]); const timer = setTimeout(() => io.stdin.end(), 8000);
  return { io, run: () => decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)) };
};

test('a key-shaped repair text is refused BEFORE anything is written: exit 1, the pattern name and the line, never the value, no gate asked, the record unchanged; a password in a URL on a real-looking host too', async () => {
  const { r, stop } = await rootWithStop();
  const before = readTreeRecord(r.t.rootDir).events.length;
  for (const [typed, name] of [[`Plan it again.\nUse ${KEY} for the store.`, 'Anthropic'], [`Plan it again.\nThe store is ${URL_OF('db.internal')}.`, 'URL credentials']]) {
    const d = decide(r, stop, typed);
    assert.equal(await d.run(), 1, d.io.shown() + d.io.errors());
    const out = d.io.errors();           // the refusal goes to stderr; stdout holds the terminal's own echo of what the person typed (readline), which the program does not add to
    assert.match(out, new RegExp(`the decision text:2  .*${name}`));
    assert.match(out, /No gate was requested and nothing was written/);
    assert.ok(!out.includes(KEY) && !out.includes(URL_OF('db.internal')), 'the value is never printed');
    assert.ok(!/Answer stop|SET ASIDE/.test(d.io.shown()), 'the gate text was never built');
    assert.equal(d.io.typed(), 1, 'nothing was asked after the text: no gate prompt');
  }
  assert.equal(readTreeRecord(r.t.rootDir).events.length, before, 'nothing was recorded');
});

test('known-good control: a clean repair text, and a placeholder on a RESERVED host (the same exemption a run\'s input scan has), pass the scan and are decided', async () => {
  const { r, stop } = await rootWithStop();
  const d = decide(r, stop, `Plan it again.\nThe local store is ${URL_OF(['local', 'host'].join(''))}.`);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.equal(readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'decision_recorded').length, 1);
});

const EMAIL = ['jane.doe', '@', 'mail-corp', '.de'].join('');
test('the personal-data gate runs on the typed text when the tree carries a mode (Muad: the check goes everywhere): hard-stop refuses before anything is written, naming type and position and never the value; warn and no mode decide it', async () => {
  const typed = `Plan it again.\nAsk ${EMAIL} for the store layout.`;
  const hard = await rootWithStop({ piiGate: 'hard-stop' });
  const n0 = readTreeRecord(hard.r.t.rootDir).events.length;
  const d = decide(hard.r, hard.stop, typed);
  assert.equal(await d.run(), 1, d.io.shown() + d.io.errors());
  assert.match(d.io.errors(), /the decision text holds personal data under --pii-gate hard-stop[\s\S]*the decision text, line 2, col \d+: email[\s\S]*No gate was requested and nothing was written/);
  assert.ok(!d.io.errors().includes(EMAIL) && !d.io.errors().includes('mail-corp'), 'the value, and its masked prefix, are never printed');
  assert.equal(readTreeRecord(hard.r.t.rootDir).events.length, n0, 'nothing was recorded');
  // CHANGED ACCEPTED (19 Okt 2026, C&C: no released tree lacks a mode, a tree with none is asked as hard-stop): OLD [{ piiGate: 'warn' }, {}] both decided; NEW only `warn` decides, a tree with no mode refuses like hard-stop (checked below).
  for (const over of [{ piiGate: 'warn' }]) {
    const { r, stop } = await rootWithStop(over);
    const ok = decide(r, stop, typed);
    assert.equal(await ok.run(), 0, JSON.stringify(over) + ok.io.shown() + ok.io.errors());
    assert.equal(readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'decision_recorded').length, 1, JSON.stringify(over));
  }
  const none = await rootWithStop({}); const refused = decide(none.r, none.stop, typed);
  assert.equal(await refused.run(), 1, refused.io.shown() + refused.io.errors()); assert.match(refused.io.errors(), /holds personal data under --pii-gate hard-stop/);
});
