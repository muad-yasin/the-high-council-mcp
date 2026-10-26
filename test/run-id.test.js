// The run id generator (0.8.3 M6, C&C ruling 12 Oct): ONE copy, in src/run-files.js, the lowest layer. It had three identical copies (src/api.js nextRunId, src/mcp/server.js nextRunId, src/tree-start.js newRunId), each with its own
// "last millisecond handed out"; now one module-level counter is shared by every caller in a process, which is the intended improvement (two ids can no longer collide across the three entry points).
// The shape is pinned because spend.js and the secret scanner key off that exact shape (src/mcp/server.js comment: run ids stay plain ISO timestamps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = rel => readFileSync(join(import.meta.dirname, '..', 'src', rel), 'utf8');
const SHAPE = /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/;

test('RID-1 nextRunId (src/run-files.js) makes an id of the exact shape YYYY-MM-DDTHH-MM-SS-mmmZ that is the current time, and two calls in the same millisecond give different, increasing ids', async () => {
  const { nextRunId } = await import('../src/run-files.js');
  assert.equal(typeof nextRunId, 'function');
  const before = Date.now(); const a = nextRunId(); const after = Date.now();
  assert.match(a, SHAPE);
  const parsed = Date.parse(a.replace(/^(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, '$1:$2:$3.$4Z'));
  assert.ok(parsed >= before - 1 && parsed <= after + 1000, 'the id is the clock, not an invented time');
  const ids = Array.from({ length: 2000 }, () => nextRunId());   // far more calls than milliseconds elapse: the monotonic bump has to carry them
  assert.equal(new Set(ids).size, ids.length, 'no id twice'); assert.deepEqual([...ids].sort(), ids, 'increasing');
  for (const id of ids) assert.match(id, SHAPE);
});

test('RID-2 the three call sites use that ONE function: none defines its own (no "last millisecond" counter, no timestamp-to-id replace) and each imports nextRunId from run-files.js', () => {
  for (const rel of ['api.js', 'mcp/server.js', 'tree-start.js']) {
    const text = src(rel).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.equal(/lastRunMs|lastMs\b/.test(text), false, `${rel} keeps its own counter`);
    assert.equal(/toISOString\(\)\.replace\(\/\[:\.\]\/g, '-'\)/.test(text), false, `${rel} turns a timestamp into an id itself`);
    assert.match(text, /import \{[^}]*\bnextRunId\b[^}]*\} from '(\.\.\/|\.\/)run-files\.js'/, `${rel} imports nextRunId from run-files.js`);
  }
  assert.equal((src('run-files.js').match(/export function nextRunId/g) ?? []).length, 1, 'exactly one definition');
});

test('RID-3 no import cycle: run-files.js imports only node built-ins, so it can sit under api.js, mcp/server.js and tree-start.js; and the library entry point still loads', async () => {
  const imports = [...src('run-files.js').matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1]);
  assert.ok(imports.length > 0 && imports.every(m => m.startsWith('node:')), `run-files.js imports: ${imports.join(', ')}`);
  await import('../src/api.js'); await import('../src/tree-start.js');
});
