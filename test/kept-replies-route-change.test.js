// 0.8.4 cache part (b)2, FIX 5 (C&C, 10 Nov 2026, his 05 Nov 03:52 heading: a changed prompt on resume continues on its saved replies, nothing re-run or paid extra): after a typed route change, to or from the session route included, finished stages replay their saved replies with no paid call, whether the order's words are recorded or not. Offline, $0.
// WHY A ROUTE CHANGE MAKES A STAGE PROMPT-STALE: a session (external) seat is outside the cache order (src/cache-order-gate.js cacheOrderSeat), so once the order's words are recorded a judge's prompt differs between the session route and the others; the stage cache then reads the saved stage as asked a different prompt (cacheVerdict cause 'prompt') and src/stale-guard.js keeps it only when THC's CODE changed since it was written (wordingChanged), which a route change within one version does not.
// KR-1 (the ONE row): in the recorded-words state, the premise (a session seat is outside the order, the others are inside; unrecorded, none is), and the decision: a prompt-stale stage written on one route and asked on another is KEPT, in both directions; the bounds stay: the same route with the same code is still asked again (the audit-5 pin), and a stage whose upstream stage ran live this sitting is still asked again; and src/cli.js stamps the sitting with its route (a scan with its own known-bad). The real-verb resume across a route change cannot run offline (a Claude seat calls the network), so the pieces are pinned where they are real: the stamp's record, the ledger's decision and the cli.js line.
// KR-2 (C&C 10 Nov 2026, the RECORD of a route-kept stage; his bound: one log line, one WARNINGS line, one added experimental report field, nothing else): with the real verbs, offline, a mock chain whose saved records say they were written on the OpenRouter route and whose stored prompts differ, resumed on the
//   direct route: the stages are kept (no call), and the record says ANOTHER ROUTE, never 'earlier wording' (that would be false: the same THC wrote them): the run.log line, the WARNINGS.md line, report.json `answered_on_another_route`; `answered_under_earlier_wording` is absent and no stage row leaks the bookkeeping flag.
//   Known-bad input of the same row: the same folder aged by VERSION instead (the update case) records 'earlier wording' and no route field. The report field's shape is pinned in test/report-schema.test.js.
// RED RUN: against the tree before the fix plus this file: the first decision (direct -> session) is refused ('same_code') and the cli.js scan fails.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { submitStageAnswer } from '../src/stage-submission.js';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Held from '../src/held-roles.js';
import * as Stale from '../src/stale-guard.js';
import * as R from '../src/roles.js';
import { promptHashOf } from '../src/cache-integrity.js';
import * as HC from './held-prompts/held-084-cache-order.js';

const Gate = await import('../src/cache-order-gate.js').catch(() => ({}));
const Order = await import('../src/cache-order.js').catch(() => ({}));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => Held.setHeldForTest(null));

const NOW = { version: '0.8.4', code_sha256: 'a'.repeat(64) };
const judge = lab => ({ provider: 'anthropic', model: 'claude-sonnet-5-5', lab, layer: 1, maxTokens: 2000 });
const chain = { prompt_cache: { enabled: true, ttl: '5m' }, signoff: 'unanimous', seats: { critics: [judge('a'), judge('b')] } };
const asSession = seat => ({ ...seat, provider: 'external', model: 'subscription:sonnet-5.5' });
const LABEL = 'panel-L1-a';
// the record a stage gets on a route (a direct run's record carries no route key: the shape every existing record has), and the ledger a sitting on a route holds
const writtenOn = route => Stale.writtenByRecord({ now: { ...NOW, ...(route ? { route } : {}) }, sitting: 1, text: 'abcdef012345' });
const ledgerOn = route => Stale.createWordingLedger({ now: { ...NOW, ...(route ? { route } : {}) } });

test('KR-1 after a route change the saved replies are kept: the order\'s words recorded, a prompt-stale stage written on one route and asked on another is kept in both directions, and the bounds stay', () => {
  // the premise with REAL prompts: the prompt one judge call is sent (src/cache-order.js judgePrompt, the one builder) as a direct Claude judge and as the same judge answered by a session, the order's words recorded and not
  const HEAD = '# Original request\nBuild it.\n# Draft under review\nthe draft\n';
  const promptHashOn = seat => { const p = Order.judgePrompt({ config: chain, seat, kind: 'panel', compose: () => `${R.COUNCIL_INTRO}\n\nYou are a judge.`, user: `${HEAD}Review it.`, head: HEAD }); return promptHashOf(p.system, p.user); };
  Held.setHeldForTest({ ...HC });
  assert.notEqual(promptHashOn(chain.seats.critics[0]), promptHashOn(asSession(chain.seats.critics[0])), 'premise: with the words recorded the prompt differs between a direct judge and the same judge answered by a session, so a saved stage reads as prompt-stale after a route change');
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the row also asserted, with the words unrecorded (setHeldForTest(null)), that a direct judge and a session judge send the same prompt. NEW: that held-state premise is REMOVED; the recorded-state premise right above it (the prompts differ) stays. WHY: the cache-order words are recorded (src/prompts/recorded-084-cache-order.js; src/cache-order-gate.js:16), so null is no longer 'unrecorded'.
  Held.setHeldForTest({ ...HC });
  assert.deepEqual(ledgerOn('session').decide({ label: LABEL, writtenBy: writtenOn(null) }), { keep: true }, 'a stage written on the direct route is kept on the session route');
  assert.deepEqual(ledgerOn(null).decide({ label: LABEL, writtenBy: writtenOn('session') }), { keep: true }, 'a stage written on the session route is kept on the direct route');
  assert.deepEqual(ledgerOn('openrouter').decide({ label: LABEL, writtenBy: writtenOn('session') }), { keep: true }, 'and on the OpenRouter route');
  // the bounds
  assert.deepEqual(ledgerOn(null).decide({ label: LABEL, writtenBy: writtenOn(null) }), { keep: false, why: 'same_code' }, 'the same route with the same code: a prompt-stale stage is still asked again (the audit-5 pin)');
  const upstream = ledgerOn('session'); upstream.note({ label: 'criteria', live: true });
  assert.deepEqual(upstream.decide({ label: LABEL, writtenBy: writtenOn(null) }), { keep: false, why: 'upstream_changed', upstream: 'criteria' }, 'a route change does not keep a stage whose upstream stage ran live this sitting');
  assert.equal(ledgerOn('session').decide({ label: LABEL, writtenBy: writtenOn(null), textOk: false }).keep, false, 'an edited reply is still asked again');
  // the sitting's stamp carries the route (src/cli.js), each scan with its own known-bad input
  const cli = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  const STAMP = /wordingNow = \{ version: entry\.version,[^\n]*route: claudeRoute \}/;
  assert.match(cli, STAMP, 'src/cli.js stamps the sitting with the route it runs on');
  assert.doesNotMatch(cli.replace(/, route: claudeRoute \}/, ' }'), STAMP, 'known-bad input: the same scan fails on the line without the route');
});

// ---- KR-2: the record, with the real verbs (the fixture of test/stale-wording.test.js: a mock unanimous chain, a pause at an external critic, records re-stamped, the resume) ----
const readJson = f => JSON.parse(readFileSync(f, 'utf8'));
const fromDisk = (out, label) => new RegExp(`${label}: [^\\n]*from disk`).test(out);
const mockChain = () => ({
  name: 'wc', signoff: 'unanimous', maxRounds: 2, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
    critics: [{ provider: 'mock', model: 'mock-review-fixture', lab: 'l1', maxTokens: 3000 }, { provider: 'external', model: 'claude-code-session', lab: 'l2' }, { provider: 'mock', model: 'mock-review-fixture', lab: 'l3', maxTokens: 3000 }] },
});
function pausedFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'kr2-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'wc.json'), JSON.stringify(mockChain()));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const r = run(['--chain', 'wc', '--task', 'tasks/t.md']);
  assert.equal(r.status, 3, `fixture: sitting 1 paused at the external critic: ${r.stdout}${r.stderr}`);
  const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run, runDir, done: () => rmSync(dir, { recursive: true, force: true }) };
}
// re-stamp every record: a stored prompt no prompt has, and either a route (written on another route, SAME code) or an older version (written by an earlier THC)
function restamp(runDir, { route = null, version = null }) {
  for (const f of readdirSync(runDir).filter(x => /\.(usage|prompt)\.json$/.test(x))) {
    const j = readJson(join(runDir, f));
    if (j.promptHash) j.promptHash = 'f'.repeat(16);
    if (j.writtenBy) { j.writtenBy = { ...j.writtenBy, ...(route ? { route } : {}), ...(version ? { version } : {}) }; if (version) delete j.writtenBy.code_sha256; }
    writeFileSync(join(runDir, f), JSON.stringify(j));
  }
}
function resumeToEnd(p) {
  submitStageAnswer(p.runDir, 'panel-1-l2', readFileSync(join(p.runDir, 'panel-1-l1.md'), 'utf8'), {});
  let again = p.run(['--resume', p.runDir]); const first = again.stdout + again.stderr;
  for (let i = 0; i < 4 && again.status === 3; i++) {
    const m = /PAUSED: stage "([^"]+)" is an external seat/.exec(again.stdout + again.stderr);
    if (!m) break;
    const sibling = join(p.runDir, `${m[1].replace(/-l2$/, '-l1')}.md`);
    submitStageAnswer(p.runDir, m[1], readFileSync(existsSync(sibling) ? sibling : join(p.runDir, 'panel-1-l1.md'), 'utf8'), {});
    again = p.run(['--resume', p.runDir]);
  }
  const doc = existsSync(join(p.runDir, 'report.json')) ? readJson(join(p.runDir, 'report.json')) : readJson(join(p.runDir, 'report-partial.json'));
  return { first, doc, warnings: readFileSync(join(p.runDir, 'WARNINGS.md'), 'utf8') };
}

test('KR-2 the record of a stage kept after a route change says "another route", not "earlier wording": run.log, WARNINGS.md and report.json (a version change, the known-bad input, still says earlier wording)', () => {
  const p = pausedFolder();
  try {
    restamp(p.runDir, { route: 'openrouter' });
    const { first, doc, warnings } = resumeToEnd(p);
    assert.doesNotMatch(first, /CACHE STALENESS WARNING/, first);
    for (const l of ['panel-1-l1', 'panel-1-l3']) assert.ok(fromDisk(first, l), `${l}: replayed from disk, no call\n${first}`);
    assert.match(first, /CACHE: stage "panel-1-l1" was answered on OpenRouter; this run is on the direct Anthropic key\. Kept as it is, no new call\./, 'the run.log line');
    assert.doesNotMatch(first, /earlier wording|--draft/, 'no "earlier wording" and no "start a new run" line for a route-kept stage');
    assert.match(warnings, /- answered_on_another_route: stage "panel-1-l3" \(pass 1\) was answered on OpenRouter and was kept as it is in sitting 2, which runs on the direct Anthropic key/, 'the WARNINGS.md line');
    assert.doesNotMatch(warnings, /answered_under_earlier_wording/, 'no earlier-wording line');
    assert.ok(Array.isArray(doc.answered_on_another_route) && doc.answered_on_another_route.some(k => k.stage === 'panel-1-l3' && k.pass === 1 && k.written_route === 'openrouter' && k.route === 'anthropic'), JSON.stringify(doc.answered_on_another_route));
    assert.equal('answered_under_earlier_wording' in doc, false, 'the earlier-wording field is absent');
    assert.equal(JSON.stringify(doc.stages).includes('answeredOnAnotherRoute'), false, 'the stage rows do not carry the bookkeeping flag');
  } finally { p.done(); }
  const q = pausedFolder();
  try {
    restamp(q.runDir, { version: '0.0.1' });
    const { first, doc, warnings } = resumeToEnd(q);
    assert.match(first, /stage "panel-1-l1" was answered under THC's earlier wording/, 'known-bad input: aged by version, the earlier-wording line is written');
    assert.match(warnings, /- answered_under_earlier_wording: stage "panel-1-l3"/);
    assert.equal('answered_on_another_route' in doc, false, 'and no route field');
    assert.ok(Array.isArray(doc.answered_under_earlier_wording) && doc.answered_under_earlier_wording.every(k => k.cause === 'prompt'), 'the earlier-wording rows keep their cause');
  } finally { q.done(); }
});
