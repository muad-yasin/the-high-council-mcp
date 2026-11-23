// 0.8.4 seats and retirements unit (Muad, typed in Helper A's window, 10 Nov 2026 02:09 CET: src/budget.js and src/buys.js are removed in 0.8.4; closes ROADMAP 131). The two estimator modules priced an imagined roster against a token budget; nothing in the harness
// imported either one, and the cost module (src/cost.js, src/cache-prices.js) is the one place a call is priced. This scanner keeps both directions honest: the files are gone, and no file under src/, test/, scripts/ or the packaged entry points imports them
// again (the two tests that used them, test/b3-cache-adapter.test.js and test/price-table.test.js, check the same claims through costOf). Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsFilesUnder = dir => readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
  .filter(e => e.isFile() && /\.(m?js|cjs)$/.test(e.name))
  .map(e => join(e.parentPath ?? e.path, e.name));

test('src/budget.js and src/buys.js are gone', () => {
  assert.equal(existsSync(join(root, 'src', 'budget.js')), false);
  assert.equal(existsSync(join(root, 'src', 'buys.js')), false);
  assert.equal(existsSync(join(root, 'test', 'budget-pricing.test.js')), false, 'the test of the removed module is removed with it');
});

test('no file under src/, test/ or scripts/ imports or runs budget.js or buys.js (zero importers)', () => {
  const importing = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"][^'"]*\/(?:budget|buys)(?:\.js)?['"]|node\s+src\/(?:budget|buys)\.js/;
  const hits = [];
  for (const dir of ['src', 'test', 'scripts']) for (const f of jsFilesUnder(dir)) {
    if (f === fileURLToPath(import.meta.url)) continue;   // this scanner names the modules in its own pattern
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (importing.test(line) && !line.trim().startsWith('//')) hits.push(`${relative(root, f)}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
  assert.deepEqual(hits, []);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.doesNotMatch(JSON.stringify(pkg.scripts ?? {}) + JSON.stringify(pkg.bin ?? {}), /\b(budget|buys)\.js\b/, 'no npm script or bin runs them');
});

test('the scanner can fail: an import line of either module is caught by the same pattern (fixture lines)', () => {
  const importing = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"][^'"]*\/(?:budget|buys)(?:\.js)?['"]|node\s+src\/(?:budget|buys)\.js/;
  for (const line of ["import { priceRoster } from '../src/budget.js';", "import { ROSTERS } from './budget.js';", "const b = await import('./buys.js');", "const m = require('../src/buys');", '// node src/buys.js --usd 43']) assert.equal(importing.test(line), true, line);
  for (const line of ["import { costOf } from '../src/cost.js';", "import { readStoppedMarker } from './stop-files.js'; // STOPPED-budget.json", "const x = 'budgets.js';"]) assert.equal(importing.test(line), false, line);
});
