// 0.8.4 D20 (plan A T5.4, test/excerpt-scan.test.js of the plan; C&C ruling 09 Nov 2026, option A): an excerpt with a key-shaped line stops the run BEFORE any prompt carries it, through the existing secret pause, and
// the stop text names the line, not the value. Fixtures are assembled at runtime from a repeating filler (as test/outbound-scan.test.js), so no string in this file looks like a real key. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanExcerptKeyShape } from '../src/excerpt-scan.js';
import { SecretShapedPrompt, secretSpansIn, newAllowKey, valueHashOf } from '../src/outbound-scan.js';

const fill = (n, set = 'aZ3kQ9xB') => Array.from({ length: n }, (_, i) => set[i % set.length]).join('');
const hex = n => fill(n, '0a1b2c3d4e5f6789');
const VALUE = hex(64);
const KEY_LINE = ['OPENROUTER_API_KEY=', 'sk', '-or-v1-', VALUE].join('');
const TEXT = `const a = 1;\nconst b = 2;\n${KEY_LINE}\nconst c = 3;`;
const CLEAN = 'const a = 1;\nconst apiKey = config.apiKey;\nconst c = 3;';

test('a clean excerpt scans clear', () => {
  assert.equal(scanExcerptKeyShape('excerpt-E-1', CLEAN), 'clear');
  assert.equal(scanExcerptKeyShape('excerpt-E-1', ''), 'clear');
});

test('a key-shaped line throws the existing secret pause error: the label, the line number and the kind, never the value', () => {
  assert.throws(() => scanExcerptKeyShape('excerpt-E-2', TEXT), err => {
    assert.ok(err instanceof SecretShapedPrompt);
    assert.equal(err.label, 'excerpt-E-2');
    assert.deepEqual(err.findings.map(f => [f.part, f.line]), [['user', 3]]);
    assert.equal(typeof err.stopId, 'string'); assert.match(err.stopId, /^[0-9a-f]{16}$/);
    assert.equal(JSON.stringify([err.message, err.findings]).includes(VALUE), false, 'the value is not in the error');
    return true;
  });
});

test('the person\'s allowance of that exact value makes the same text scan continued_by_person; another value still stops', () => {
  const key = newAllowKey();
  const span = secretSpansIn(KEY_LINE, { distinctiveOnly: true })[0].span;
  const allowed = { key, hashes: new Set([valueHashOf(key, span)]) };
  assert.equal(scanExcerptKeyShape('excerpt-E-2', TEXT, { allowed }), 'continued_by_person');
  const other = TEXT.replace(VALUE, hex(63) + 'f');
  assert.throws(() => scanExcerptKeyShape('excerpt-E-2', other, { allowed }), SecretShapedPrompt);
});

test('the scan reads the text it is given, so an EDITED excerpt is scanned on its edited text', () => {
  const edited = TEXT.split('\n').filter(l => !l.includes('OPENROUTER')).join('\n');
  assert.equal(scanExcerptKeyShape('excerpt-E-2', edited), 'clear');
});

test('the whole-run override the person typed at the start (allow) never throws: a text with a key shape records continued_by_person, a clean text clear (a waived scan is not recorded as a pass)', () => {
  assert.equal(scanExcerptKeyShape('excerpt-E-2', TEXT, { allow: true }), 'continued_by_person');
  assert.equal(scanExcerptKeyShape('excerpt-E-2', CLEAN, { allow: true }), 'clear');
});
