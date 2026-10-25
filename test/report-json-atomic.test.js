// Bug audit 2026-10-24 C-010 (a source scanner, the repo's answer to a mistake that can come back through a new write site): src/cli.js must write report.json and report-partial.json through writeAtomic (temp file, fsync, rename), never a bare writeFileSync.
// report.json is the finished-run marker (--resume refuses a run that has one; run_status reads it as done): a kill or a full disk in the middle of a plain write leaves a torn file that reads as finished AND unreadable, and the person pays again. The partial report is the only copy of a stopped
// run's state (a tree member's stop is read from it). The scan names every call whose first argument mentions report.json, PARTIAL_REPORT_FILE or a report path variable, however the join is spelled.
// Holes, on purpose not widened: it reads one line at a time, so a write whose first argument spans lines is missed, and so is a path held in a variable not named report*/partial*. It covers src/cli.js only (src/council-replay.js writes its own report.json: BUG-C-044, area D).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MENTIONS_REPORT = /report\.json|PARTIAL_REPORT_FILE|report-partial|reportPath|partialPath/;

/** the first argument of a call from the text after its opening parenthesis: up to the first comma outside any brackets */
function firstArgOf(rest) {
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return rest.slice(0, i); depth -= 1; }
    else if (c === ',' && depth === 0) return rest.slice(0, i);
  }
  return rest;
}

/** the lines of `source` that start a bare write whose path argument names a report file */
function bareReportWrites(source) {
  const out = [];
  source.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    const m = /\b(?:writeFileSync|appendFileSync)\((.*)$/.exec(line);
    if (!m) return;
    const firstArg = firstArgOf(m[1]);
    if (MENTIONS_REPORT.test(firstArg)) out.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return out;
}

test('RA-1: src/cli.js writes report.json and the partial report only through writeAtomic', () => {
  const found = bareReportWrites(readFileSync(join(root, 'src', 'cli.js'), 'utf8'));
  assert.deepEqual(found, [], 'a bare write of a report file: use writeAtomic (src/stop-files.js)');
});

test('RA-2: the scanner itself catches the spellings (a join, a variable, a constant) and lets the atomic and unrelated writes through', () => {
  assert.equal(bareReportWrites("writeFileSync(join(runDir, 'report.json'), JSON.stringify(x));").length, 1);
  assert.equal(bareReportWrites("  writeFileSync(join(dir, PARTIAL_REPORT_FILE), JSON.stringify(x, null, 2));").length, 1);
  assert.equal(bareReportWrites("writeFileSync(reportPath, text);").length, 1);
  assert.equal(bareReportWrites("writeAtomic(join(runDir, 'report.json'), JSON.stringify(x));").length, 0);
  assert.equal(bareReportWrites("writeFileSync(join(runDir, 'run.json'), JSON.stringify(x));").length, 0);
  assert.equal(bareReportWrites("// writeFileSync(join(runDir, 'report.json'), x)").length, 0);
});
