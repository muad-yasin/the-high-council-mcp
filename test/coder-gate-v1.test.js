// test/coder-gate-v1.test.js
//
// MLLM Coder v1 (relay/runs/2026-09-14T16-14-10-757Z/deliverable.md), IN-1 and IN-2's acceptance
// tests. Per the deliverable's own file list, `tasks/change-request-template.md` and
// `tasks/examples/example-change-request.md` are new conventions - but this repo's own CLAUDE.md
// hard rule forbids ever adding a real `tasks/` directory at the repo root (it exists to keep
// private business material from the source repo out of this public one; see HANDOFF.md). Same
// resolution used for the item-5/6 v7.x work earlier: the template/fixture content lives here,
// written into a throwaway tmpdir cwd per test/github-install.test.js's own convention, never
// committed as real files under a tasks/ directory in this repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { lintChain } from '../src/chain-lint.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');

// The change-request template's four required fields (§1 of the deliverable). This is the
// content `tasks/change-request-template.md` would hold if this repo were allowed a tasks/
// directory - kept here as a string constant so both the template's own shape and the fixture
// files below stay in one place, not duplicated.
export const CHANGE_REQUEST_TEMPLATE = `target_file: <one repo-relative path>
target_hunk_locator: <a line range, or a unique anchor string identifying the region to change>
test_command: <a test file path run_tests can invoke via \`node --test <path>\`>
intent: <one paragraph describing what the change should accomplish>
`;

function validChangeRequest() {
  return `target_file: src/example.js
target_hunk_locator: lines 10-14, anchored on "function add("
test_command: test/example.test.js
intent: Fix an off-by-one error in the add() helper so add(2, 3) returns 5.
`;
}

function missingFieldsChangeRequest() {
  return `intent: Fix something, not sure what.\n`;
}

function withTmpTask(content, run) {
  const cwd = mkdtempSync(join(tmpdir(), 'thc-coder-gate-'));
  try {
    mkdirSync(join(cwd, 'tasks'));
    writeFileSync(join(cwd, 'tasks', 'change-request.md'), content);
    return run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('chains/coder-gate-v1.json passes chain-lint', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'coder-gate-v1.json'), 'utf8'));
  const findings = lintChain(cfg, 'chains/coder-gate-v1.json');
  assert.deepEqual(findings, []);
});

test('chains/coder-gate-v1.json uses only existing stage types - external proposer/builder, debate (config), critics, unanimous signoff - and adds no new one', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'coder-gate-v1.json'), 'utf8'));
  assert.equal(cfg.seats.proposers[0].provider, 'external');
  assert.equal(cfg.seats.builder.provider, 'external');
  assert.equal(cfg.debate, true);
  assert.equal(cfg.signoff, 'unanimous');
  assert.ok(Array.isArray(cfg.seats.critics) && cfg.seats.critics.length > 0);
  // §6: no write tool anywhere in this chain's own config, and no tool at all named that isn't
  // on src/tools.js's existing allowlist.
  assert.deepEqual(cfg.verify.tools, []);
});

// Audit item 3 (2026-09-16): `debate: true` reads as live config but is structurally unreachable
// in v1/v2 - runChain's debate stage (src/chain.js) only runs when `proposals.length > 1`, and
// with exactly one proposer and `proposals.parts: 1` at most one proposal can ever exist. This
// pins that fact directly against the real config values, so a future change to either number
// (e.g. adding a second proposer) is the one thing that would make this test start failing -
// which is the correct signal that debate has gone live and the chain's own description comment
// needs revisiting.
test('chains/coder-gate-v1.json and v2.json: debate:true is structurally unreachable given proposers/parts', () => {
  for (const file of ['coder-gate-v1.json', 'coder-gate-v2.json']) {
    const cfg = JSON.parse(readFileSync(join(root, 'chains', file), 'utf8'));
    const maxPossibleProposals = cfg.seats.proposers.length * (cfg.proposals?.parts ?? 3);
    assert.equal(cfg.debate, true, `${file}: expected debate:true (forward-compat, currently inert)`);
    assert.ok(maxPossibleProposals <= 1, `${file}: expected debate to be unreachable (max ${maxPossibleProposals} proposal(s)) - if this now exceeds 1, debate has gone live and the description needs updating`);
  }
});

// Audit item 3: verify.tools ships empty by design (no per-run templating exists to inject a
// target file/test command into a static chain config - runVerification runs before any
// change-request/diff exists). Pin that runVerification is therefore a real, documented no-op
// for both chains as shipped, not a silent gap nobody noticed.
test('chains/coder-gate-v1.json and v2.json: verify.enabled is true but verify.tools is empty, so runVerification is a documented no-op today', async () => {
  const { runVerification } = await import('../src/chain.js');
  for (const file of ['coder-gate-v1.json', 'coder-gate-v2.json']) {
    const cfg = JSON.parse(readFileSync(join(root, 'chains', file), 'utf8'));
    assert.equal(cfg.verify.enabled, true, `${file}: expected verify.enabled true`);
    assert.deepEqual(cfg.verify.tools, [], `${file}: expected verify.tools empty (see description for why)`);
    const groundTruth = runVerification(cfg, { log: () => {} });
    assert.deepEqual(groundTruth, [], `${file}: runVerification must return no ground truth given an empty tools list`);
  }
});

test('IN-1 acceptance test: a well-formed change-request task file dry-run-loads the chain, calls no provider, and prints the stage sequence', () => {
  withTmpTask(validChangeRequest(), (cwd) => {
    const out = execFileSync('node', [cli, '--task', 'tasks/change-request.md', '--chain', 'coder-gate-v1', '--dry-run'], { cwd, encoding: 'utf8' });
    assert.match(out, /Chain: coder-gate-v1/);
    assert.match(out, /propose-external-proposer/);
    assert.match(out, /build\s+external\/claude-code-session/);
    assert.match(out, /panel-1-/); // critic round
    // --dry-run prices only; it never calls a real provider (the external seats price at $0 and
    // the anthropic/openai critic seats are priced from src/pricing.json, not invoked).
    assert.doesNotMatch(out, /error/i);
  });
});

test('IN-1 acceptance test, real behavior pinned: a task file missing target_file/test_command does NOT produce a validation error today', () => {
  // The deliverable's own IN-1 text describes this case exiting with a validation error. No code
  // anywhere in this repo parses a task file's prose for named fields - task files are opaque
  // free text to chain.js/cli.js, and this v1 build adds no such parser (IN-1's own
  // Backward-compat line: zero changes to src/chain.js). Per the deliverable's own IN-2 stance
  // ("enforcement in v1 is structural/social... not a programmatic parser") and GLM-5's amendment
  // ("acceptance tests here are reviewer checklist steps... not new automated validation
  // scripts"), the same posture is documented for IN-1's four required fields in
  // docs/coder-gate-diff-format.md: a human reviewer at the propose pause is the enforcement
  // point, not the CLI. This test pins the real, current behavior (dry-run still succeeds) rather
  // than asserting a validation error that no code produces - so a future session doesn't
  // mistake this gap for an untested regression.
  withTmpTask(missingFieldsChangeRequest(), (cwd) => {
    const out = execFileSync('node', [cli, '--task', 'tasks/change-request.md', '--chain', 'coder-gate-v1', '--dry-run'], { cwd, encoding: 'utf8' });
    assert.match(out, /Chain: coder-gate-v1/);
  });
});

// IN-2's acceptance test: hand-classify three fixed sample proposals against
// docs/coder-gate-diff-format.md's stated rules. Per GLM-5's amendment this is a reviewer
// checklist step, not a shipped validator - the checks below exist only to prove the *document's
// rules themselves* classify the three fixtures correctly when applied by hand, matching the
// deliverable's "confirm the document's stated rules classify them accept/reject/reject" text.
// Nothing here is exported or wired into chains/chain.js/tools.js.
function classifyByDocumentedRules(text, targetFile) {
  const blocks = [...text.matchAll(/```diff\n([\s\S]*?)```/g)].map(m => m[1]);
  if (blocks.length !== 1) return 'reject'; // rule 1
  const block = blocks[0];
  const minusFiles = [...block.matchAll(/^--- (?:a\/)?(\S+)/gm)].map(m => m[1]);
  const plusFiles = [...block.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)].map(m => m[1]);
  const allFiles = new Set([...minusFiles, ...plusFiles]);
  if (allFiles.size !== 1) return 'reject'; // rule 3 (two-file diff)
  const [onlyFile] = allFiles;
  if (onlyFile !== targetFile) return 'reject'; // rule 3
  return 'accept';
}

test('IN-2 acceptance test: docs/coder-gate-diff-format.md\'s rules classify the three fixed fixtures accept/reject/reject', () => {
  const validDiff = '```diff\n--- a/src/example.js\n+++ b/src/example.js\n@@ -10,3 +10,3 @@\n-  return a + b - 1;\n+  return a + b;\n```';
  const noDiffBlock = 'I looked at the file but did not write a diff - not sure how to fix this yet.';
  const twoFileDiff = '```diff\n--- a/src/example.js\n+++ b/src/example.js\n@@ -1 +1 @@\n-old\n+new\n--- a/src/other.js\n+++ b/src/other.js\n@@ -1 +1 @@\n-old\n+new\n```';

  assert.equal(classifyByDocumentedRules(validDiff, 'src/example.js'), 'accept');
  assert.equal(classifyByDocumentedRules(noDiffBlock, 'src/example.js'), 'reject');
  assert.equal(classifyByDocumentedRules(twoFileDiff, 'src/example.js'), 'reject');
});

test('docs/coder-gate-diff-format.md exists and states all three fixture rules plus the structural/social (not a parser) enforcement stance', () => {
  const doc = readFileSync(join(root, 'docs', 'coder-gate-diff-format.md'), 'utf8');
  assert.match(doc, /exactly one fenced/i);
  assert.match(doc, /unified diff|unified-diff/i);
  assert.match(doc, /no binary patch/i);
  assert.match(doc, /structural and social/i);
  assert.doesNotMatch(doc, /programmatic.*validat(or|es)(?!.*v2)/i);
});
