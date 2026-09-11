// relay/test/license.test.js
//
// The 0.7% pledge is an honour request and lives in README.md. It must never
// migrate into LICENSE, which is a legal instrument: a payment request inside
// it makes compliance ambiguous, stops the project being standard MIT in
// practice, and gets it auto-rejected by corporate legal review - losing
// exactly the adopters most likely to earn anything with it.
//
// This is the kind of thing a well-meaning future edit "tidies" into the
// wrong file, so it is pinned here rather than left to memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const licence = readFileSync(join(root, 'LICENSE'), 'utf8');

test('LICENSE carries no payment link and no pledge', () => {
  assert.ok(!/stripe\.com|paypal|buy\.|checkout|donate/i.test(licence),
    'LICENSE must contain no payment link');
  assert.ok(!/0\.7\s*%|0,7\s*%|\bpledge\b|\broyalty\b|\broyalties\b/i.test(licence),
    'LICENSE must not mention the pledge; it belongs in README.md');
});

test('LICENSE is byte-for-byte standard MIT, apart from the copyright line', () => {
  // A keyword scan is the wrong instrument here - MIT itself says "shall"
  // twice. The only check that actually holds is the full canonical text.
  const CANONICAL = `MIT License

Copyright (c) <YEAR> <HOLDER>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

  const normalised = licence.trimEnd()
    .replace(/Copyright \(c\) \d{4} .+/, 'Copyright (c) <YEAR> <HOLDER>');
  assert.equal(normalised, CANONICAL,
    'LICENSE differs from standard MIT - any change here is a legal change');
  // The holder is a settled decision: the legal company, not a person.
  assert.match(licence, /Copyright \(c\) 2026 Sower Industries/);
});

test('the pledge is in README, and says no is a complete answer', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.match(readme, /0\.7%/, 'the pledge should be in the README');
  // Implied permission is not permission - this has to be stated outright.
  assert.match(readme, /No is a complete answer/i);
  // The reader must be told the section does not alter the licence.
  assert.match(readme, /nothing below changes it/i);
  // One link, no form, no address to report to.
  assert.equal((readme.match(/buy\.stripe\.com/g) || []).length, 1,
    'exactly one payment link, and no reporting address');
});
