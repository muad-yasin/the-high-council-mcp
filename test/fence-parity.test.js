// Pre-release audit 2026-09-23 (PreRelease_Audit_guards, HIGH): fence parity. fencedSourceOf used
// a global /```...```/ regex and `council fence` wrote a plain ``` fence, so a fenced .md file that
// itself contained a ``` example flipped the pairing: the task's own prose after it was read as
// fenced "source", and (since 9e07d1d renders quote status to the reviser) an objection quoting
// that prose showed as "(verified)". Also #5: CRLF front matter was ignored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fencedSourceOf, parseFences, markFailures } from '../src/quote-check.js';
import { fenceFile, fenceFor } from '../src/fence.js';
import { parseUnfencedAllow, checkArtifactReferences } from '../src/preflight.js';

const T = '`'.repeat(3);
const README = ['# Usage', '', 'Run it like this:', '', `${T}sh`, 'npm start', T, '', 'That is all.'].join('\n');

test('a fenced file containing its own fence stays one block, and the task prose after it is not source', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fence-parity-'));
  writeFileSync(join(dir, 'README.md'), README);
  const block = fenceFile(dir, 'README.md').text;
  const task = `Please review the readme below.${block}\nPROSE-AFTER: the reviewer must keep the tone formal.\n`;
  const blocks = parseFences(task);
  assert.equal(blocks.length, 1, 'one fenced file, one block');
  const src = fencedSourceOf(task);
  assert.match(src, /npm start/);
  assert.match(src, /That is all\./, 'the whole file is inside the block');
  assert.doesNotMatch(src, /PROSE-AFTER/, 'the task prose after the fence is not source');
});

test('an objection quoting task prose is never marked verified', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fence-parity-'));
  writeFileSync(join(dir, 'README.md'), README);
  const task = `Review this.${fenceFile(dir, 'README.md').text}\nThe reviewer must keep the tone formal.\n`;
  const [f] = markFailures([{ criterion: 'c', problem: 'p', quote: 'The reviewer must keep the tone formal.' }], fencedSourceOf(task));
  assert.notEqual(f.quote_status, 'verified');
});

test('parseFences follows opening/closing lengths, like CommonMark', () => {
  const four = '`'.repeat(4);
  const text = [`${four}md`, 'inner:', `${T}js`, 'x()', T, 'after inner', four, 'outside'].join('\n');
  const [b] = parseFences(text);
  assert.equal(b.info, 'md');
  assert.match(b.body, /after inner/);
  assert.doesNotMatch(fencedSourceOf(text), /outside/);
  assert.equal(fenceFor('no ticks'), T);
  assert.equal(fenceFor(`has ${T} and ${'`'.repeat(5)}`), '`'.repeat(6));
});

test('task front matter written with CRLF line endings is read (unfenced-ok)', () => {
  const text = '---\r\nunfenced-ok: [secret.js]\r\n---\r\nPlease look at secret.js.\r\n';
  assert.deepEqual(parseUnfencedAllow(text), ['secret.js']);
  assert.deepEqual(checkArtifactReferences(text), []);
});
