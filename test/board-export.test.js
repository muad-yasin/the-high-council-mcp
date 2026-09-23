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

test('council export-board --run against a malformed report.json degrades cleanly, no thrown stack trace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-export-bad-'));
  const runDir = join(dir, 'run');
  mkdirSync(runDir);
  writeFileSync(join(runDir, 'report.json'), '{not valid json');
  assert.throws(() => execFileSync('node', [cli, 'export-board', '--run', runDir, '--out', join(dir, 'board.html')], { encoding: 'utf8' }));
  try {
    execFileSync('node', [cli, 'export-board', '--run', runDir, '--out', join(dir, 'board.html')], { encoding: 'utf8' });
  } catch (err) {
    assert.equal(err.status, 2);
    assert.match(err.stderr, /not valid JSON/);
    assert.doesNotMatch(err.stderr, /SyntaxError/);
  }
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

// Pre-release audit 2026-09-23 (PreRelease_Audit_contract #1): the exported board never showed the
// alternatives stage, so a shared board dropped the architecture debate without a word.
test('renderBoardHtml: the alternatives stage is rendered, escaped, and absent when the stage never ran', async () => {
  const { renderBoardHtml } = await import('../src/board-export.js');
  const report = {
    runId: 'r1', chain: 'plan-open-7', passed: false,
    alternatives: {
      items: [
        { id: 'GLM-ALT', lab: 'glm', name: 'Event log <b>first</b>', shape: 'ALT_MARKER one log', key_tradeoffs: 'simple', bad_at: 'joins', amended: true },
        { id: 'QWEN-ALT', lab: 'qwen', name: 'Monolith', shape: 's', key_tradeoffs: 't', bad_at: 'b', withdrawn: true, replaced_by: 'GLM-ALT' },
      ],
      posts: [{ by: 'qwen', on: 'GLM-ALT', stance: 'object', text: '<script>alert(1)</script>' }],
      replies: [{ id: 'GLM-ALT', action: 'amend', text: 'fair' }],
      dropouts: [],
    },
  };
  const html = renderBoardHtml(report);
  assert.match(html, /<h2>Alternative architectures<\/h2>/);
  assert.match(html, /ALT_MARKER one log/);
  assert.match(html, /GLM-ALT \(glm\) - Event log &lt;b&gt;first&lt;\/b&gt; - AMENDED/);
  assert.match(html, /WITHDRAWN by qwen in favour of GLM-ALT/);
  assert.ok(!html.includes('<script>'), 'model-written text is escaped');
  assert.ok(html.indexOf('Alternative architectures') < html.indexOf('<h2>Proposals'));
  assert.ok(!renderBoardHtml({ runId: 'r2', chain: 'x' }).includes('Alternative architectures'));
});
