// T2-4 (14 Oct 2026): "every lab signed off" was printed for every passed report. This file drives REAL mock chains through the CLI (one report per mode, no hand-written
// records) and reads the sentence each report-reading site prints for it. Modes: unanimous (mock-open), first (mock: one critic passes), advise (mock-advise-single),
// degraded (a unanimous chain where one seat only states a pass). A hand-written record with no signoff field is the "cannot tell" case and gets the neutral word.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { renderBoardHtml } from '../src/board-export.js';
import { buildTranscript } from '../src/replay.js';
import { finishedRunState } from '../src/run-status.js';
import * as VH from '../src/verdict-headline.js';
const { verdictWords, UNANIMOUS_WORDS, FIRST_WORDS, DEGRADED_WORDS, NEUTRAL_WORDS } = VH;
const verdictHeadline = r => VH.verdictHeadline(r); // namespace access, so the file still loads against a module that lacks it (a staged red)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');

function realReport(chain, chainFile) {
  const work = mkdtempSync(join(tmpdir(), 'verdict-headline-'));
  writeFileSync(join(work, 'task.md'), 'Write a one-paragraph plan for a bake sale.\n');
  if (chainFile) { mkdirSync(join(work, 'chains')); writeFileSync(join(work, 'chains', `${chain}.json`), JSON.stringify(chainFile)); }
  const r = spawnSync(process.execPath, [cli, '--task', 'task.md', '--chain', chain], { cwd: work, encoding: 'utf8' });
  const runDir = join(work, 'runs', readdirSync(join(work, 'runs')).sort().pop());
  return { report: JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')), stdout: r.stdout };
}

const degradedChain = {
  name: 'deg', maxRounds: 3, signoff: 'unanimous', freedoms: { pass: true }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
    critics: [{ provider: 'mock', model: 'mock-critic-passer', lab: 'la' }, { provider: 'mock', model: 'mock-critic-a', lab: 'lb' }] },
};

const cases = [
  { mode: 'unanimous', chain: 'mock-open', words: UNANIMOUS_WORDS },
  { mode: 'first', chain: 'mock', words: FIRST_WORDS },
  { mode: 'degraded', chain: 'deg', file: degradedChain, words: DEGRADED_WORDS },
];

for (const c of cases) {
  test(`T2-4 ${c.mode}: the board, the replay and run_status say how a real ${c.chain} report passed`, () => {
    const { report } = realReport(c.chain, c.file);
    assert.equal(report.passed, true);
    assert.equal(verdictWords(report), c.words);
    assert.match(renderBoardHtml(report), new RegExp(`PASSED - ${c.words.replace(/[()]/g, '\\$&')}`));
    assert.equal(buildTranscript(report).at(-1).text, `Verdict: PASSED - ${c.words}`);
    // The state may add ', on the signed draft; the delivered text differs ...' (0.8.2 item 4); the start is the words.
    assert.ok(finishedRunState(report).startsWith(`done: ${c.words}`), finishedRunState(report));
    if (c.mode !== 'unanimous') assert.doesNotMatch(finishedRunState(report), /every lab signed off/, 'only a unanimous clean pass may say every lab signed off');
  });
}

test('T2-4 advise: a real advice report is passed with no sign-off and says what it is, not "first" and not "every lab"', () => {
  const { report } = realReport('mock-advise-single');
  assert.equal(report.passed, true);
  assert.equal(report.signoff, null, 'the same shape as a first-mode pass; only `advise` tells them apart');
  const words = verdictWords(report);
  assert.match(words, /^advice from \d+ of \d+ seat\(s\), leaning /);
  assert.equal(finishedRunState(report), `done: ${words}`);
  // Commit 2 (C&C ruling 3, 14 Oct 2026): an advice report has no verdict, so the board and the replay no longer say "Verdict" or "PASSED" for it (old bar: 'PASSED - advice from ...').
  assert.match(renderBoardHtml(report), /<h2>Advice<\/h2>\n<p>advice from/);
  assert.doesNotMatch(renderBoardHtml(report), /PASSED/);
  assert.equal(buildTranscript(report).at(-1).text, `Advice: ${words}`);
  // `advise` present is never a panel pass, whatever its status: a non-answered advice report keeps the Advice heading and the neutral word (one field of the real report changed).
  const stopped = { ...report, advise: { ...report.advise, status: 'stopped' } }; // what advise.js writes when the final halted() at :441 first latches the stop: status 'stopped', NO stopped_by (commit 4 reverts the stopped_by added in commit 3)
  assert.equal(verdictHeadline(stopped).heading, 'Advice');
  assert.match(verdictHeadline(stopped).text, /\(stopped early\)$/, 'a stopped record with a verdict says it stopped even without stopped_by (commit 4; commit 3\'s message wrongly said advise.js always sets stopped_by)');
  assert.equal(verdictHeadline(stopped).text, VH.adviceWords(stopped.advise), 'the record\'s words for a stopped call, never the neutral word (commit 3, dated old bar \'passed\' -> new bar)');
  assert.doesNotMatch(renderBoardHtml(stopped), /PASSED/);
});

test('T2-4 unknown and open: a record that cannot say how it passed gets the neutral word; a failed run keeps its sentence', () => {
  assert.equal(verdictWords({ passed: true }), NEUTRAL_WORDS);
  assert.equal(verdictWords({ passed: true, signoff: undefined, outcome: undefined }), NEUTRAL_WORDS);
  // An advice report that is not 'answered' (a stopped one is written with passed false; this is the defensive case) never reads as a first-mode pass: `advise` present means it is not a panel pass.
  // Commit 3 (C&C, 14 Oct 2026, reversing one line of the commit-2 ruling), dated old bar -> new bar: an advice report never prints the neutral word 'passed'. Old: 'passed'. New: the record's words, or 'advice (stopped)' when the verdict is null.
  assert.equal(verdictWords({ passed: true, signoff: null, advise: { status: 'stopped' } }), 'advice (stopped)'); // PIN: the commit-3 module already said this for any null verdict
  assert.equal(verdictWords({ passed: false, signoff: [] }), null);
  assert.equal(verdictWords(null), null);
  assert.match(renderBoardHtml({ passed: false, proposals: [], debate: {}, signoff: [] }), /OPEN OBJECTIONS/);
  assert.equal(finishedRunState({ passed: false }), 'done: open objections');
});

test('T2-4 one source: no src file except the headline module prints a sentence that says how a run passed', () => {
  const lits = ['every lab signed off', 'a critic from another lab passed it', 'not every seat gave a verdict'];
  // Comments that quote a sentence are allowed; a code line that holds one is not. A line is a comment when it starts with //, * or /*.
  const codeHits = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return codeHits(p);
    if (!p.endsWith('.js') || p.endsWith('verdict-headline.js')) return [];
    return readFileSync(p, 'utf8').split('\n').flatMap((l, i) => lits.some(x => l.includes(x)) && !/^\s*(\/\/|\*|\/\*)/.test(l) ? [`${p.slice(root.length + 1)}:${i + 1}`] : []);
  });
  assert.deepEqual(codeHits(join(root, 'src')), [], 'a sentence that says how a run passed lives in src/verdict-headline.js only');
});

// The live CLI line (cli.js `verdict:`), which prints from the result inside the run. It said "every lab on the panel signed off" for a degraded unanimous pass.
for (const c of [{ mode: 'first', chain: 'mock', has: FIRST_WORDS }, { mode: 'degraded', chain: 'deg', file: degradedChain, has: DEGRADED_WORDS }, { mode: 'unanimous', chain: 'mock-open', has: 'every lab on the panel signed off' }]) {
  test(`T2-4 live CLI line (${c.mode}): the verdict: line of a real ${c.chain} run`, () => {
    const { stdout } = realReport(c.chain, c.file);
    const line = stdout.split('\n').find(l => l.startsWith('verdict:'));
    assert.equal(line?.replace(/^verdict:\s+/, ''), c.has);
  });
}

// Commit 2 (C&C, 14 Oct 2026). Rows take a REAL report and change ONE field, so no record is hand-built.
test('T2-4 c2 outcome fallback: a signoff array with no `outcome` is classified from what the report carries, never read as unanimous by default', () => {
  const clean = realReport('mock-open').report;
  const degraded = realReport('deg', degradedChain).report;
  const strip = r => { const { outcome, ...rest } = r; return rest; };
  assert.equal(verdictWords(strip(clean)), UNANIMOUS_WORDS, 'a clean unanimous report without outcome is still unanimous'); // PIN: the old code said this too (no red of its own)
  assert.equal(verdictWords(strip(degraded)), DEGRADED_WORDS, 'a degraded one without outcome is not');
});

test('T2-4 c2 security gate: a run the security review blocked is NOT A PASS on the board, the replay, run_status and the viewer data', () => {
  const report = { ...realReport('mock-open').report, security_review: { gate: 'blocked' } };
  assert.equal(report.passed, true, 'the panel passed it; the gate outranks the panel');
  const h = verdictHeadline(report);
  assert.equal(h.label, 'NOT A PASS');
  assert.equal(verdictWords(report), null);
  assert.doesNotMatch(renderBoardHtml(report), /PASSED/);
  assert.match(renderBoardHtml(report), /NOT A PASS - security gate blocked - not a pass/);
  assert.equal(buildTranscript(report).at(-1).text, `Verdict: ${h.text}`);
  assert.equal(finishedRunState(report), `done: ${h.words}`);
  assert.ok(finishedRunState({ ...report, security_review: { gate: 'pass' } }).startsWith(`done: ${UNANIMOUS_WORDS}`), 'a passed gate changes nothing'); // PIN
});

function get(port, path) {
  return new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}` } }, res => { let body = ''; res.on('data', d => { body += d; }); res.on('end', () => ok({ status: res.statusCode, body })); });
    req.on('error', fail); req.end();
  });
}

test('T2-4 c2 viewer data: /api/runs/<id> carries `verdict`, the words from the same source (first mode, gate-blocked, open)', async () => {
  const work = mkdtempSync(join(tmpdir(), 'verdict-viewer-'));
  const first = realReport('mock').report;
  const rows = { '2026-01-01T00-00-00-000Z': first, '2026-01-02T00-00-00-000Z': { ...first, security_review: { gate: 'not_judged' } }, '2026-01-03T00-00-00-000Z': { ...first, passed: false } };
  for (const [id, rep] of Object.entries(rows)) { mkdirSync(join(work, 'runs', id), { recursive: true }); writeFileSync(join(work, 'runs', id, 'report.json'), JSON.stringify(rep)); }
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [join(root, 'src', 'ui', 'server.js')], { env: { ...process.env, PORT: String(port), COUNCIL_WORKDIR: work }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((ok, fail) => { child.stdout.on('data', d => { if (String(d).includes('relay viewer')) ok(); }); child.on('exit', code => fail(new Error(`viewer exited early (${code})`))); });
    const verdictOf = async id => JSON.parse((await get(port, `/api/runs/${id}`)).body).verdict;
    assert.equal(await verdictOf('2026-01-01T00-00-00-000Z'), FIRST_WORDS); // PIN: commit 1 already sent the first-mode words
    assert.match(await verdictOf('2026-01-02T00-00-00-000Z'), /^security gate not_judged - not a pass/);
    assert.equal(await verdictOf('2026-01-03T00-00-00-000Z'), null); // PIN: an unpassed run was already null
  } finally { const gone = new Promise(ok => child.on('exit', ok)); child.kill(); await gone; }
});

// Commit 3 (C&C, 14 Oct 2026).
test('T2-4 c3 advice with passed false: a stopped advice call is not "OPEN OBJECTIONS" either (it has no verdict and no objections)', () => {
  const real = realReport('mock-advise-single').report;
  const stopped = { ...real, passed: false, advise: { ...real.advise, status: 'stopped' } }; // one field pair of a real advice report: what advise.js writes on a stop (partialDefaults() has passed false)
  const h = verdictHeadline(stopped);
  assert.equal(h.heading, 'Advice');
  assert.equal(h.text, VH.adviceWords(stopped.advise));
  assert.notEqual(h.text, NEUTRAL_WORDS);
  assert.doesNotMatch(renderBoardHtml(stopped), /OPEN OBJECTIONS|PASSED/);
  assert.equal(buildTranscript(stopped).at(-1).text, `Advice: ${VH.adviceWords(stopped.advise)}`);
  assert.equal(verdictHeadline({ passed: false, advise: { status: 'stopped', verdict: null } }).text, 'advice (stopped)', 'a null verdict has no leaning to quote'); // PIN
});

test('T2-4 c3 gate clause: it says what the PANEL did in the panel\'s own words, not "the panel signed off" for every pass', () => {
  const first = { ...realReport('mock').report, security_review: { gate: 'blocked' } };
  assert.equal(finishedRunState(first), `done: security gate blocked - not a pass (${FIRST_WORDS}; the security review did not)`);
  const unanimous = { ...realReport('mock-open').report, security_review: { gate: 'not_judged' } };
  assert.equal(finishedRunState(unanimous), `done: security gate not_judged - not a pass (${UNANIMOUS_WORDS}; the security review did not)`);
  assert.match(renderBoardHtml(first), /NOT A PASS - security gate blocked - not a pass \(a critic from another lab passed it; the security review did not\)/);
  // The panel did not pass: no clause (old behaviour, unchanged).
  assert.equal(finishedRunState({ ...first, passed: false }), 'done: security gate blocked - not a pass');
});

test('T2-4 c3 rematch line: a rematch can carry security_review (runChain runs the review) or advise, so its `rematch verdict:` line goes through the module', () => {
  // grep (14 Oct 2026): cli.js's rematch path calls runChain (cli.js:1642) and rewrites the security_reviewer seat (cli.js:1630-1640), so the report it writes can hold security_review. The rematch path (cli.js:1480-1660) has no advice refusal (grep isAdviceFolder|advise: none), so an advice chain's result (advise) can reach the same line: INFERRED, not driven.
  // run_status (finishedRunState) is called only at src/mcp/server.js:299 with the report.json report; a stopped advice call writes report-partial.json, which server.js does not read there (grep report-partial in src/mcp/server.js + src/run-status.js: only the read_run_file description), so the passed:false advice shape cannot reach run_status.
  const dir = mkdtempSync(join(tmpdir(), 'verdict-rematch-'));
  writeFileSync(join(dir, 'task.md'), 'A smoke-test task for the rematch feature.');
  spawnSync(process.execPath, [cli, '--chain', 'mock-unanimous', '--task', 'task.md'], { cwd: dir, encoding: 'utf8' });
  const id = readdirSync(join(dir, 'runs'))[0];
  const f = join(dir, 'runs', id, 'report.json');
  const rep = JSON.parse(readFileSync(f, 'utf8'));
  writeFileSync(f, JSON.stringify({ ...rep, security_review: { gate: 'blocked' } })); // one field of a real report: the ORIGINAL was gate-blocked
  const r = spawnSync(process.execPath, [cli, '--rematch', join('runs', id), '--rematch-seed', '1'], { cwd: dir, encoding: 'utf8' });
  assert.match(r.stdout, /rematch verdict: PASSED \(original: NOT A PASS\)/);
});

// Commit 4 (C&C, 14 Oct 2026): "say only what the record says". A null verdict only reads "stopped" when the record says it stopped: status 'stopped' or stopped_by (advise.js builds the object before its final halted(), so a stop first latched there has the status but no stopped_by: advise.js :437 vs :441).
test('T2-4 c4 a damaged ANSWERED advice record with a null verdict is not called stopped (hand-built known-bad input)', () => {
  const answeredNoVerdict = { passed: true, signoff: null, advise: { status: 'answered', verdict: null, seats_asked: 2, seats_answered: 2 } };
  assert.equal(verdictHeadline(answeredNoVerdict).text, 'advice');
  assert.equal(verdictWords(answeredNoVerdict), 'advice');
  // The two assertions below pass on the old code (PIN); the first assertion above is this row's red, so these have no red of their own.
  assert.equal(VH.adviceWords({ status: 'stopped', verdict: null, stopped_by: 'own_cap' }), 'advice (stopped)', 'the record says it stopped (stopped_by)');
  assert.equal(VH.adviceWords({ status: 'answered', verdict: null, stopped_by: 'own_cap' }), 'advice (stopped)', 'an answered record that carries stopped_by');
});

test('T2-4 c4 run_status shares adviceWords: an answered advice record with a null verdict reads "done: advice", not "done: advice (stopped)"', () => {
  assert.equal(finishedRunState({ passed: true, signoff: null, advise: { status: 'answered', verdict: null, seats_asked: 2, seats_answered: 2 } }), 'done: advice');
});

test('T2-4 c4 a stopped advice record WITH a verdict says it stopped even without stopped_by (status carries it)', () => {
  const real = realReport('mock-advise-single').report.advise;
  const words = VH.adviceWords({ ...real, status: 'stopped' });
  assert.match(words, /^advice from \d+ of \d+ seat\(s\), leaning \w+ \(stopped early\)$/);
  assert.equal(VH.adviceWords({ ...real, status: 'stopped', stopped_by: 'wall_clock' }), VH.adviceWords(real).replace(/$/, ' (stopped early: wall_clock)'), 'stopped_by, when present, keeps its shipped clause'); // PIN
  // PIN (passes on the old code by construction): an answered call with a verdict keeps the shipped template.
  assert.equal(VH.adviceWords(real), `advice from ${real.seats_answered} of ${real.seats_asked} seat(s), leaning ${String(real.verdict).replace('_', ' ')}${real.stopped_by ? ` (stopped early: ${real.stopped_by})` : ''}`);
});

test('T2-4 c4 run_status shares adviceWords: a passed:true report holding a stopped advice record (hand-built shape) reads the stopped clause', () => {
  const real = realReport('mock-advise-single').report;
  assert.match(finishedRunState({ ...real, advise: { ...real.advise, status: 'stopped' } }), /^done: advice from \d+ of \d+ seat\(s\), leaning \w+ \(stopped early\)$/);
});
