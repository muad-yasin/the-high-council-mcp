// Hostile inputs through the fence path (2026-09-25). `council fence` promises that each fenced
// file parses back as exactly one closed block, and that the task prose after it is never read
// as source (test/fence-parity.test.js covers the ``` example that broke that promise first).
// This runs a small matrix of awkward file NAMES and CONTENTS through fenceFile + parseFences.
// The idea of a shared list of strings that tend to break input handling comes from
// minimaxir/big-list-of-naughty-strings (MIT); these strings are our own, aimed at this parser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fenceFile, countInvisible, FENCE_MAX_BYTES } from '../src/fence.js';
import { parseFences, fencedSourceOf } from '../src/quote-check.js';

const B = n => '`'.repeat(n);

// Contents a real repository can hold and that a fence parser can trip on.
const CONTENTS = {
  'empty': '',
  'backtick run mid-line': `a ${B(4)} b`,
  'fence of its own': `${B(3)}js\nx()\n${B(3)}`,
  'longer fence of its own': `${B(5)}\n${B(3)}\n${B(5)}`,
  'tilde fences': '~~~\nx\n~~~~~~',
  'indented fences': `   ${B(3)}\n    ${B(3)}\nend`,
  'CRLF with a fence': `line\r\n${B(3)}\r\nend\r\n`,
  'lone CR line endings': `a\r${B(3)}\rb`,
  'BOM first': '﻿hello',
  'NUL and C0': 'a\u0000b\u0007c\u001b[31mred',
  'bidi override': 'let ok = "‮yrros‬";',
  'zero-width': 'is​Admin = true',
  'combining and astral': 'é́ \u{1F600} \u{10FFFF}',
  'line and paragraph separators': 'a b c',
  'HTML and comment openers': '<!-- <script>alert(1)</script> -->\n</details>',
  'looks like our own markers': '# Source, fenced verbatim\n## other.md\n[truncated: 1 of 2 bytes not shown]',
  'multibyte cut at the limit': 'é'.repeat(FENCE_MAX_BYTES),
  'only newlines': '\n\n\n',
};

// Names that are fine to fence. Awkward, but not dangerous.
const NAMES_OK = ['plain.md', 'sp ace.md', 'q\'uote"s.md', 'emoji\u{1F600}.md', 'back`tick.md', `run${B(4)}.md`, 'zero​width.md'];

function oneFile(name, body) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-hostile-'));
  writeFileSync(join(dir, name), body);
  return dir;
}

test('every awkward name x content pair fences into exactly one closed block', () => {
  for (const name of NAMES_OK) {
    for (const [label, body] of Object.entries(CONTENTS)) {
      const dir = oneFile(name, body);
      try {
        const task = `Task prose before.${fenceFile(dir, name).text}\nPROSE-AFTER must stay prose.\n`;
        const blocks = parseFences(task);
        const where = `${JSON.stringify(name)} / ${label}`;
        assert.equal(blocks.length, 1, `${where}: one file, one block`);
        assert.equal(blocks[0].closed, true, `${where}: the block closes`);
        assert.doesNotMatch(fencedSourceOf(task), /PROSE-AFTER/, `${where}: prose after the fence is not source`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
});

test('a file name with a line break or a bidi control is refused, not fenced', () => {
  // A name with "\n````\n" in it put a closing fence line into the block before this was refused.
  const bad = [`a\n${B(4)}\nb.md`, `x\n${B(3)}js\ny.js`, 'tab\there.md', 'cr\rhere.md', 'evil‮txt.md', 'iso⁦late.md'];
  for (const name of bad) {
    let dir;
    try {
      dir = oneFile(name, 'hello');
    } catch {
      continue; // the filesystem would not take this name; nothing to fence
    }
    try {
      assert.throws(() => fenceFile(dir, name), /control or bidi-override character/, JSON.stringify(name));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('invisible characters in content are counted so the operator is told', () => {
  const dir = oneFile('a.js', CONTENTS['bidi override'] + CONTENTS['zero-width']);
  try {
    assert.equal(fenceFile(dir, 'a.js').invisible, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(countInvisible('﻿plain text'), 0, 'a leading BOM is ordinary');
  assert.equal(countInvisible('plain﻿text'), 1, 'a BOM mid-text is not');
  assert.equal(countInvisible('ordinary source'), 0);
});
