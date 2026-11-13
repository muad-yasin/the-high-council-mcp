// 0.8.4 D33 (plan A T1.6): tests the task lacks are named by the harness, never fetched. src/fence-tests.js decides when no fenced block of a task is a test file (the held harness line of T3.3 entry 5 is
// shown only then) and lists, for a fenced test file, the identifiers it imports by name or calls through an import that the plan never mentions (information only). Pure, offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isTestFile, fencedBlocks, noFencedTestFile, testIdentifiers, checkTestIdentifiers, findingLine } from '../src/fence-tests.js';
import { handoffNoTestsLine } from './held-prompts/held-084-a.js';

const block = (path, body, { heading = true } = {}) => `${heading ? `\n\n## ${path}\n\n` : '\n\n'}\`\`\`js\n// ${path}\n${body}\n\`\`\`\n`;
// The plan's fixture: a fenced test that imports get_annotation and nothing is called through an import (mirrors plan A l.104: "a fenced test/x.test.js that imports get_annotation, which the plan never mentions"). The framework
// is imported by default and only called bare, so the one finding is get_annotation. A realistic test file is pinned separately below.
const TEST_JS = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { get_annotation } from '../src/annotate.js';\ntest('x', () => { get_annotation('a'); });";
const TASK = (...blocks) => `Plan the change.\n${blocks.join('')}`;

test('isTestFile: a directory named test or tests, or a file name (without its last extension) that begins test_ or ends _test or .test; plan A\'s A13 case src/widget.test.js included', () => {
  for (const p of ['test/x.test.js', 'tests/y.py', 'pkg/tests/deep/z.go', 'src/widget.test.js', 'pkg/test_foo.py', 'pkg/foo_test.go', 'src\\widget.test.ts']) assert.equal(isTestFile(p), true, p);
  for (const p of ['src/widget.js', 'src/contest.js', 'lib/attest.js', 'src/test_helper/util.js', 'src/latest.py', 'src/testing.py', '', undefined]) assert.equal(isTestFile(p), false, String(p));
});

test('fencedBlocks: a block\'s path is its `// path` first line (what `council fence` writes), else a word of its info string, else the heading or lead-in above it; none gives null', () => {
  const task = [
    block('src/a.js', 'x'),
    '\n\nHere is test/b.test.js:\n\n```\nconst b = 1;\n```\n',
    '\n\n```js src/c.js\nconst c = 1;\n```\n',
    '\n\n```\nno path anywhere\n```\n',
  ].join('');
  assert.deepEqual(fencedBlocks(task).map(b => b.path), ['src/a.js', 'test/b.test.js', 'src/c.js', null]);
});

test('fencedBlocks: a comment line that is not a single path word never names the block (a licence line, a description, a version), so the heading or info string above still does', () => {
  const copyright = "\n\n## test/x.test.js\n\n```js\n// Copyright 2024 Example Inc.\nimport { a } from './a.js';\n```\n";
  const version = "\n\n```js\n// 0.8.4 notes for the module\nconst x = 1;\n```\n";
  const step = "\n\n## Step 2. Update test/y.test.js\n\n```js\nimport { b } from './b.js';\n```\n";
  assert.deepEqual(fencedBlocks(copyright + version + step).map(b => b.path), ['test/x.test.js', null, 'test/y.test.js']);
  assert.equal(noFencedTestFile(copyright), false);
  assert.equal(checkTestIdentifiers({ task: copyright + step, plan: 'p' }).map(f => f.identifier).join(), 'a,b');
});

test('noFencedTestFile: true for a task whose blocks hold no test path and for a task with no block; false as soon as one block is a test file', () => {
  assert.equal(noFencedTestFile(TASK(block('src/a.js', 'x'), block('src/widget.js', 'y'))), true);
  assert.equal(noFencedTestFile('A task with no fenced block at all.'), true);
  assert.equal(noFencedTestFile(TASK(block('src/a.js', 'x'), block('test/x.test.js', TEST_JS))), false);
  assert.equal(noFencedTestFile(TASK(block('src/widget.test.js', TEST_JS))), false, 'a test file by name');
});

test('the plan\'s own case: a fenced test/x.test.js that imports get_annotation, which the plan never mentions, gets exactly one finding (the framework is imported by default and not called through, so none of it is listed)', () => {
  const found = checkTestIdentifiers({ task: TASK(block('test/x.test.js', TEST_JS)), plan: 'Change the annotation code so it handles decorators.' });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'test_identifier_unmentioned');
  assert.equal(found[0].identifier, 'get_annotation');
  assert.equal(found[0].path, 'test/x.test.js');
  assert.equal(findingLine(found[0]), 'test_identifier_unmentioned: the fenced test test/x.test.js uses get_annotation, which the plan never mentions; that test may judge the work.');
});

test('named framework imports are listed when the plan never names them (a default or namespace import is not listed itself, only what is called through it)', () => {
  const task = TASK(block('tests/test_a.py', "import pytest\nfrom unittest import TestCase\nfrom unittest.mock import MagicMock\nfrom astroid import get_annotation"));
  assert.deepEqual(checkTestIdentifiers({ task, plan: 'The plan names get_annotation and MagicMock.' }).map(f => f.identifier), ['TestCase']);
  assert.deepEqual(checkTestIdentifiers({ task: TASK(block('test/b.test.js', "import { describe, expect } from 'vitest';")), plan: 'p' }).map(f => f.identifier), ['describe', 'expect']);
});

test('a plan that mentions the identifier as a whole word gets none; "get_annotations" is not a mention of get_annotation', () => {
  const task = TASK(block('test/x.test.js', TEST_JS));
  assert.deepEqual(checkTestIdentifiers({ task, plan: 'Rework get_annotation for decorators.' }), []);
  assert.equal(checkTestIdentifiers({ task, plan: 'Rework get_annotations for decorators.' }).length, 1);
});

test('a source block that imports names is not a test file: no finding; a block with no path and an unknown language give none', () => {
  const src = "import { get_annotation } from './x.js';";
  assert.deepEqual(checkTestIdentifiers({ task: TASK(block('src/widget.js', src)), plan: 'p' }), []);
  assert.deepEqual(checkTestIdentifiers({ task: `\n\n\`\`\`js\n${src}\n\`\`\`\n`, plan: 'p' }), []);
  assert.deepEqual(checkTestIdentifiers({ task: TASK(block('test/x.test.rb', "from pkg import thing")), plan: 'p' }), []);
});

test('testIdentifiers: JavaScript named imports and require destructures, Python from-imports (aliases give the exported name, parentheses over lines, line continuations); default, namespace and module imports are not listed', () => {
  assert.deepEqual(testIdentifiers('test/a.test.js', "import def, { one, two as t2, type Three } from './m.js';\nimport * as ns from './n.js';\nimport x from './x.js';\nconst { four, five: f5 } = require('./o.js');\nconst { six } = require('./o2.js')"), ['one', 'two', 'Three', 'four', 'five', 'six']);
  assert.deepEqual(testIdentifiers('tests/test_a.py', "import pytest\nimport astroid.nodes\nfrom astroid import get_annotation, infer_node as inf\nfrom .helpers import (\n    make_node,  # the maker\n    Other as O,\n)\nfrom pkg import a, \\\n    b\nfrom star import *"), ['get_annotation', 'infer_node', 'make_node', 'Other', 'a', 'b']);
  assert.deepEqual(testIdentifiers('x.ts', "import { a, a } from './y';"), ['a'], 'each once');
});

test('calls count when the callee is reached through an import (JavaScript): mod.name() for a default import, a namespace import or a require; a bare call, a local object and a longer chain off another name are not listed', () => {
  const js = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport * as ns from './n.js';\nimport dflt from './d.js';\nimport { named } from './m.js';\nconst r = require('./r.js');\ntest('x', () => { assert.equal(named(1), 1); ns.helper(2); dflt.run(); r.go(); print(1); local.zap(); other.ns.deep(); });";
  assert.deepEqual(testIdentifiers('test/a.test.js', js), ['named', 'equal', 'helper', 'run', 'go']);
});

test('calls count when the callee is reached through an import (Python): import mod, import pkg.sub (binds pkg), import pkg as mod, pkg.sub.name(); builtins, a star import and a local object are not listed', () => {
  const py = "import pytest\nimport astroid\nimport astroid.nodes as n, os\nfrom x import *\nprint(len(a))\nastroid.get_annotation(1)\nn.infer_node(2)\nastroid.sub.deep(3)\nlocal.nope()\nnot_imported()";
  assert.deepEqual(testIdentifiers('tests/test_a.py', py), ['get_annotation', 'infer_node', 'deep']);
});

test('the plan\'s astroid shape: a test that does `import astroid` and calls astroid.get_annotation(...) names nothing by import, and still gets a finding for get_annotation', () => {
  const task = TASK(block('tests/test_a.py', "import astroid\n\ndef test_x():\n    assert astroid.get_annotation(1) == 1"));
  assert.deepEqual(checkTestIdentifiers({ task, plan: 'Fix infer_node.' }).map(f => f.identifier), ['get_annotation']);
});

test('a realistic test file (assert.equal present) gives two findings, get_annotation and equal: the import-reached rule applies to real tests, so the plan\'s one-finding case above is the minimal file', () => {
  const REALISTIC = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { get_annotation } from '../src/annotate.js';\ntest('x', () => { assert.equal(get_annotation('a'), 'b'); });";
  const found = checkTestIdentifiers({ task: TASK(block('test/x.test.js', REALISTIC)), plan: 'Change the annotation code so it handles decorators.' });
  assert.deepEqual(found.map(f => f.identifier), ['get_annotation', 'equal']);
  assert.deepEqual(found.map(f => f.path), ['test/x.test.js', 'test/x.test.js']);
});

test('the held harness line (plan A T3.3 entry 5) is the plan\'s text, word for word', () => {
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: "No test file among the source quoted to the council: no quoted block has a test file's path or name. Before the first step, read the tests that cover the code you will touch; the checks that judge this work may not have been shown to the council." NEW: the three-sentence line below. WHY: handoffNoTestsLine (src/prompts/recorded-084-a.js:20), the resolved text of the row (RESOLVED_LIST).
  assert.equal(handoffNoTestsLine(), "None of the source blocks quoted to the Council has the path or name of a test file. Before the first step, read the tests that cover the code you will change. The Council may not have seen the checks used to judge this work.");
});
