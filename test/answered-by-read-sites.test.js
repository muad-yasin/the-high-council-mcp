// 0.8.3 harness (a), C&C's condition: the record of who answered a session seat is an UNVERIFIED statement, so it may steer no stage label, cache key, approval,
// dollar or resume. This scan pins WHERE the field `answered_by` may appear in src/ at all: the module that owns it, the one writer of the usage file, and the
// report assembly that shows it. Every other reader (spend, verdict stats, cost, the stage cache, chain.js's control flow, the tree) is excluded by being absent.
// The one line of chain.js that touches it calls answerRecordOf and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcFiles = (dir = join(root, 'src')) => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? srcFiles(p) : n.endsWith('.js') ? [p] : []; });
const filesWith = re => srcFiles().filter(f => re.test(readFileSync(f, 'utf8'))).map(f => relative(root, f)).sort();

test('the field answered_by appears only in src/answered-by.js (owner), src/report-shape.js (shows it) and src/stage-submission.js (writes it); the tree\'s own camelCase answeredBy (who answered a gate) is a different thing and is not touched', () => {
  assert.deepEqual(filesWith(/answered_by/), ['src/answered-by.js', 'src/report-shape.js', 'src/stage-submission.js']);
});

test('the readers of the record are called from exactly the places C&C named: answerRecordOf from chain.js:1590 only, rosterAnswersOf from report-shape.js only', () => {
  assert.deepEqual(filesWith(/\banswerRecordOf\b/), ['src/answered-by.js', 'src/chain.js']);
  const chain = readFileSync(join(root, 'src/chain.js'), 'utf8').split('\n');
  const uses = chain.map((l, i) => [i + 1, l]).filter(([, l]) => /answerRecordOf/.test(l) && !/^import /.test(l));
  assert.equal(uses.length, 1, 'one call in chain.js');
  assert.match(uses[0][1], /hit\.model \|\| seat\.model, lab: labOf\(seat\), \.\.\.seatField\(seat\), \.\.\.answerRecordOf\(hit, seat\)/, 'it is the cache-hit row, and a copy only');
  assert.deepEqual(filesWith(/\brosterAnswersOf\b/), ['src/answered-by.js', 'src/report-shape.js']);
});

test('the module that owns the record imports nothing that makes a decision: no labOf, no seatKeyOf, no chain, no cost, no spend', () => {
  const own = readFileSync(join(root, 'src/answered-by.js'), 'utf8');
  const imports = own.split('\n').filter(l => /^import /.test(l));
  assert.deepEqual(imports, ["import { blankHiddenChars } from './hidden-chars.js';"]);
  assert.doesNotMatch(own.replace(/\/\/.*$/gm, ''), /\blabOf\b|\bseatKeyOf\b/, 'the control-flow keys are never read here');
});

test('the readers that must never see it: spend, verdict stats, cost, the stage cache, the tree and the MCP tools that read run text do not mention the field or its readers', () => {
  const never = ['src/spend.js', 'src/verdict-stats.js', 'src/cost.js', 'src/cost-forecast.js', 'src/stage-cache.js', 'src/cache-integrity.js', 'src/seat-key.js', 'src/stage-system.js', 'src/chain-lint.js', 'src/superseded.js', 'src/metrics-report.js', 'src/outcome.js']
    .filter(f => { try { statSync(join(root, f)); return true; } catch { return false; } });
  assert.ok(never.length >= 8, 'the list names files that exist');
  for (const f of never) assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), /answered_by|answerRecordOf|rosterAnswersOf|answered-by/, f);
  for (const f of srcFiles().filter(f => /\/tree-[^/]*\.js$/.test(f))) assert.doesNotMatch(readFileSync(f, 'utf8'), /answered_by|answerRecordOf|rosterAnswersOf/, relative(root, f));
});

test('who calls what: S4/S5 are called from src/cli.js only, S3 from the NEEDS file and the bundle, and the record is built from the handshake in src/mcp/server.js only', () => {
  assert.deepEqual(filesWith(/\b(answerNoteOf|undeclaredNoteOf)\b/), ['src/answered-by.js', 'src/cli.js']);
  assert.deepEqual(filesWith(/\baskedForSentence\b/), ['src/answered-by.js', 'src/cli.js', 'src/stage-contract.js'], 'S3: the NEEDS file (cli.js) and the dispatch bundle (stage-contract.js)');
  assert.deepEqual(filesWith(/\baskedForOfNeeds\b/), ['src/answered-by.js', 'src/mcp/server.js']);
  assert.deepEqual(filesWith(/\bdeclaredAnswerer\b/), ['src/answered-by.js', 'src/mcp/server.js']);
  // the tree's camelCase answeredBy (K10: who answered a gate-bound event) is a different record and the name was avoided on purpose
  assert.doesNotMatch(readFileSync(join(root, 'src/stage-submission.js'), 'utf8'), /answeredBy/);
});
