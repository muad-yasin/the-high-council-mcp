// test/board-export.test.js
//
// v5 §1 candidate 8: static HTML board export - self-contained, no
// external assets, no template-engine dependency, no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBoardHtml } from '../src/board-export.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');

function fixtureReport() {
  return {
    runId: '2026-09-13T00-00-00-000Z',
    chain: 'verify',
    passed: true,
    proposals: [
      {
        id: 'A-1', lab: 'a', title: 'A cheap fix', what: 'Adds a counter.', why: 'It was missing.',
        how: 'Add a field.', serves: 'evidence item 1', acceptance_test: 'test_a1', withdrawn: false,
      },
    ],
    debate: {
      posts: [{ by: 'b', on: 'A-1', stance: 'support', text: 'Looks right.' }],
      replies: [{ id: 'A-1', action: 'keep', text: 'Keeping as written.' }],
    },
    signoff: [{ provider: 'a', signedOff: true, objections: [] }],
  };
}

test('test_export_board_html: contains a proposal\'s text and a reply\'s text, no http references, uses <details>', () => {
  const html = renderBoardHtml(fixtureReport());
  assert.match(html, /A cheap fix/);              // proposal's text
  assert.match(html, /Keeping as written\./);      // a reply's text
  assert.doesNotMatch(html, /http/i);
  assert.match(html, /<details>/);
  assert.match(html, /<summary>/);
});

test('an empty/partial report renders without throwing', () => {
  const html = renderBoardHtml({ chain: 'verify' });
  assert.match(html, /No proposal debate ran this run\./);
});

test('council export-board --run --out writes a real file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-export-'));
  const runDir = join(dir, 'run');
  mkdirSync(runDir);
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(fixtureReport()));
  const outPath = join(dir, 'board.html');
  const out = execFileSync('node', [cli, 'export-board', '--run', runDir, '--out', outPath], { encoding: 'utf8', cwd: dir });
  assert.match(out, /Wrote/);
  assert.ok(existsSync(outPath));
  const html = readFileSync(outPath, 'utf8');
  assert.match(html, /A cheap fix/);
  assert.doesNotMatch(html, /http/i);
});
