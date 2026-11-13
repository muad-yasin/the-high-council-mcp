// 0.8.4 unit 1 (C&C 09 Nov 2026, the second merge's cross-lane item): the handler's sorting wait of the final read (S18, askHandlerSort, stage sort-<n>) is read outside invoke() like the other answer reads (answers, the
// build check), so record() never sees it; the excerpts its answer carried (session_reads, excerpt_answers) must be shown from the next call on, which is what showExcerptsAfter(label) does. Text-only check of src/chain.js: the
// stage-level run of S18's wait needs a layered fixture and the held words together; the first box run decides that fixture (see test/s18-sort-wait.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chain = readFileSync(new URL('../src/chain.js', import.meta.url), 'utf8');
const slice = (from, to) => chain.slice(chain.indexOf(from), chain.indexOf(to, chain.indexOf(from)));

test('every answer read outside invoke() takes the excerpt hook when its answer is accepted: answers, the build check and the handler\'s sorting', () => {
  const sort = slice('const askHandlerSort = async', 'const askBuildCheck = async');
  assert.ok(sort.length > 500, 'found askHandlerSort');
  assert.match(sort, /if \(j\.ok\) \{ log\(`  sort wait \$\{n\}: the handler answered \$\{j\.sort\}\.`\); showExcerptsAfter\(label\); return \{ id, sort: j\.sort, reasons: j\.reasons \}; \}/, 'the hook runs before the accepted sorting is returned');
  const at = chain.indexOf('const askBuildCheck = async');
  const build = chain.slice(at, at + 12000);
  assert.match(build, /log\(`  build check \$\{n\}: the handler answered \$\{j\.answer\}\.`\);[^\n]*\n\s*showExcerptsAfter\(label\);/);
  assert.match(chain, /showExcerptsAfter\('answers'\);/);
});
