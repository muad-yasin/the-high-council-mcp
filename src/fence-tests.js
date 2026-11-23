// 0.8.4 D33 (plan A T1.6, "Identifiers the outside tests need that the task lacks"). Pure and offline: no I/O, no model call, nothing here blocks a run or removes text.
//
// Two pieces, both harness-written:
//   noFencedTestFile(task)          true when no fenced block of the task is a test file (the rule of isTestFile). The harness line of plan A's T3.3 entry 5 (held: test/held-prompts/held-084-a.js) is
//                                   shown only when this is true; where that line goes is List 1 of T1.3 (src/verify-first.js withNoTestsLine), called by the run's handoff stage and by `--from-run`.
//   checkTestIdentifiers({task, plan})  for every fenced TEST file, the identifiers it imports by name or calls through an import that the plan never mentions, as informational findings (plan l.95).
//
// The heuristics, stated here so the plan and the code cannot drift (the plan names no more than "the identifiers that test imports or calls"):
//   - A fenced block's path is the first of: the `// <path>` line `council fence` writes as the block's first line, a path-looking word of the fence's info string, the markdown heading or "...:" lead-in line
//     directly above it (the same three places src/preflight.js reads a fence's file name from). A block with none of them has no path and is never a test file.
//   - A test file is one whose path has a directory named `test` or `tests`, or whose file name, without its last extension, begins `test_` or ends `_test` or `.test`.
//   - Identifiers come from test files written in JavaScript or TypeScript (.js .mjs .cjs .jsx .ts .tsx) or Python (.py) only. "Imports or calls" (plan A T1.6) is read as: a name the test IMPORTS BY NAME
//     (`import { a, b as c } from '...'`, `const { a } = require('...')`, `from pkg import a, b as c`, also in parentheses over several lines; the name as exported, `b`, not the alias), or a name the test CALLS
//     through an import: `mod.name(...)` where `mod` is bound by `import mod from`, `import * as mod from`, `const mod = require('...')` or Python `import mod`, `import pkg.sub` (binds `pkg`) or
//     `import pkg as mod` (a chain like `pkg.sub.name(...)` gives `name`). A call of a name that is neither imported nor defined in the test (a language builtin or a global) is not listed, and a star import is not
//     followed (`from x import *` names nothing). There is no list of builtin or framework words: a call through an imported framework (`assert.equal(...)` after `import assert from 'node:assert'`) IS listed
//     (`equal`) when the plan never mentions it, which is information, not a defect.
//   - "The plan never mentions it" = the identifier does not occur in the plan text as a whole word (`get_annotations` does not mention `get_annotation`).
//   A false flag costs a reader's attention and stops nothing: the check is information only.
import { parseFences } from './quote-check.js';

const TEST_DIRS = new Set(['test', 'tests']);
// A path word: only path characters, and either a slash inside it or a file extension that starts with a letter (`src/a.js`, `a.py`, `test/x.test.js`, `tests/Makefile`). Not `Inc.`, `0.8.4` or `2.`.
const PATHISH = /^[\w@~.$/\\-]+$/;
const isPathWord = w => PATHISH.test(w) && !/[/\\]$/.test(w) && (/[/\\]/.test(w.replace(/^[./\\]+/, '')) || /[^./\\]\.[A-Za-z][A-Za-z0-9]{0,5}$/.test(w));

/** True when `path` is a test file: a directory named test or tests on the way, or a file name (without its last extension) that begins `test_` or ends `_test` or `.test`. */
export function isTestFile(path) {
  const parts = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length) return false;
  const file = parts[parts.length - 1];
  if (parts.slice(0, -1).some(p => TEST_DIRS.has(p))) return true;
  const stem = file.replace(/\.[^.]*$/, '');
  return stem.startsWith('test_') || stem.endsWith('_test') || stem.endsWith('.test');
}

const pathWord = s => String(s || '').split(/\s+/).find(isPathWord) || null;

/** The fenced blocks of a task text with the path each one names (null when it names none): [{ path, body }]. */
export function fencedBlocks(task) {
  const text = String(task || '');
  return parseFences(text).map(b => {
    const first = /^\/\/\s*(\S+)$/.exec((b.firstLine || '').trim());   // only when the whole comment is one word: `council fence` writes `// <path>`; a licence or description comment is not a path
    const lastAbove = text.slice(0, b.index).split('\n').map(l => l.trim()).filter(Boolean).pop() || '';
    const above = /^#{1,6}\s/.test(lastAbove) ? lastAbove.replace(/^#{1,6}\s+/, '') : /:\s*$/.test(lastAbove) ? lastAbove.slice(0, -1) : '';
    const path = (first && pathWord(first[1])) || pathWord(b.info) || pathWord(above) || null;
    return { path, body: b.body };
  });
}

/** True when no fenced block of the task is a test file (a task with no fenced block at all included). */
export function noFencedTestFile(task) {
  return !fencedBlocks(task).some(b => b.path && isTestFile(b.path));
}

const LANG = ext => (/^(js|mjs|cjs|jsx|ts|tsx)$/.test(ext) ? 'js' : ext === 'py' ? 'py' : null);
const exportedNames = list => list.split(',').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
  .map(s => s.replace(/^type /, '').split(/ as |\s*:\s*/)[0].trim()).filter(n => /^[A-Za-z_$][\w$]*$/.test(n) && n !== 'default');

const MEMBER_CALLS = (src, binding) => {
  const out = [];
  const re = new RegExp(`(?<![\\w$.])${binding.replace(/\$/g, '\\$')}((?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)*)\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`, 'g');
  for (const m of src.matchAll(re)) out.push({ index: m.index, n: m[2] });
  return out;
};

/** The identifiers a test file imports by name or calls through an import, in source order, each once. Only JavaScript, TypeScript and Python files are read; anything else gives []. */
export function testIdentifiers(path, body) {
  const lang = LANG(String(path || '').split('.').pop().toLowerCase());
  const src = String(body || '');
  const found = [];
  const bindings = [];   // names bound to a whole module: their member calls count
  const add = (index, list) => { for (const n of exportedNames(list)) found.push({ index, n }); };
  if (lang === 'js') {
    for (const m of src.matchAll(/\bimport\s+(?:([\w$]+)\s*,?\s*)?(?:\*\s*as\s+([\w$]+)\s*|\{([^}]*)\}\s*)?from\s*['"][^'"]+['"]/g)) {
      if (m[1]) bindings.push(m[1]);
      if (m[2]) bindings.push(m[2]);
      if (m[3]) add(m.index, m[3]);
    }
    for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"][^'"]+['"]\s*\)/g)) add(m.index, m[1]);
    for (const m of src.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*require\(\s*['"][^'"]+['"]\s*\)/g)) bindings.push(m[1]);
  } else if (lang === 'py') {
    for (const m of src.matchAll(/^[ \t]*from[ \t]+[.\w]+[ \t]+import[ \t]+(\([^)]*\)|(?:[^\n#\\]|\\\n)*)/gm)) add(m.index, m[1].replace(/\\\n/g, ' ').replace(/#[^\n]*/g, '').replace(/^\(|\)$/g, ''));
    for (const m of src.matchAll(/^[ \t]*import[ \t]+([^\n#]+)/gm)) {
      for (const part of m[1].split(',')) {
        const mm = /^\s*([\w.]+)(?:\s+as\s+(\w+))?\s*$/.exec(part);
        if (mm) bindings.push(mm[2] || mm[1].split('.')[0]);
      }
    }
  }
  for (const binding of new Set(bindings)) found.push(...MEMBER_CALLS(src, binding));
  return [...new Set(found.sort((a, b) => a.index - b.index).map(f => f.n))];
}

const mentions = (plan, name) => new RegExp(`(^|[^A-Za-z0-9_$])${name.replace(/\$/g, '\\$')}($|[^A-Za-z0-9_$])`).test(plan);

/** The finding line as the warnings file prints it. */
export const findingLine = f => `${f.id}: ${f.message}`;

/**
 * Informational findings: for every fenced test file of the task, each identifier it imports by name or calls through an import that the plan never mentions. [{ id: 'test_identifier_unmentioned', path, identifier, message }].
 * The message is an A-DRAFT sentence (plan A l.95) for the wording review.
 */
export function checkTestIdentifiers({ task, plan }) {
  const planText = String(plan || '');
  const findings = [];
  for (const b of fencedBlocks(task)) {
    if (!b.path || !isTestFile(b.path)) continue;
    for (const identifier of testIdentifiers(b.path, b.body)) {
      if (mentions(planText, identifier)) continue;
      findings.push({ id: 'test_identifier_unmentioned', path: b.path, identifier, message: `the fenced test ${b.path} uses ${identifier}, which the plan never mentions; that test may judge the work.` });
    }
  }
  return findings;
}
