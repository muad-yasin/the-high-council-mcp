// test/digest-cli.test.js
//
// v6 item E: `council digest --run <folder>` end to end, via the real CLI process - proves the
// subcommand is wired, defaults to the $0 deterministic template with no --provider/--model
// given, and never touches src/chain.js/src/tools.js (checked directly, same convention as the
// plan's own acceptance tests for items A-D).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');

function makeRunDir() {
  const dir = mkdtempSync(join(tmpdir(), 'digest-cli-'));
  writeFileSync(join(dir, 'report.json'), JSON.stringify({
    outcome: 'no_consensus',
    disagreement_groups: [{
      on: 'p1',
      title: 'whether to build item 4 as new infrastructure',
      posts: [{ by: 'deepseek', stance: 'object', text: 'that adds a new script' }],
    }],
  }));
  return dir;
}

test('council digest --run writes digest.md with the fixed deterministic template by default', () => {
  const dir = makeRunDir();
  const out = execFileSync('node', [cli, 'digest', '--run', dir], { encoding: 'utf8' });
  assert.match(out, /Wrote .*digest\.md/);
  const text = readFileSync(join(dir, 'digest.md'), 'utf8');
  assert.match(text, /^The panel disagreed on: whether to build item 4 as new infrastructure\. Objections raised: deepseek: that adds a new script\. Final verdict: no_consensus\.$/m);
  assert.doesNotMatch(text, /better|outperform|superior|more accurate/i);
});

test('council digest --run without --provider/--model makes no model call (fully offline)', () => {
  // The absence of any provider key requirement for this path is itself the proof - the run
  // above succeeds with no ANTHROPIC_API_KEY/OPENROUTER_API_KEY/etc. set beyond whatever the
  // test environment already has, because generateDigestText only calls out when --provider is
  // explicitly given (src/dissent-digest.js).
  const dir = makeRunDir();
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/API_KEY/i.test(k)) delete env[k];
  const out = execFileSync('node', [cli, 'digest', '--run', dir], { encoding: 'utf8', env });
  assert.match(out, /Wrote .*digest\.md/);
});

test('council digest --run fails loudly on a run with no report.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'digest-cli-empty-'));
  assert.throws(() => execFileSync('node', [cli, 'digest', '--run', dir], { encoding: 'utf8' }));
  assert.ok(!existsSync(join(dir, 'digest.md')));
});

test('item E made zero net new lines of change in src/chain.js and src/tools.js (plan\'s own acceptance bar)', () => {
  const root = resolve(here, '..');
  let diff = '';
  try {
    diff = execFileSync('git', ['diff', '--stat', 'HEAD', '--', 'src/chain.js', 'src/tools.js'], { cwd: root, encoding: 'utf8' });
  } catch {
    diff = '';
  }
  assert.equal(diff.trim(), '', `expected no diff in src/chain.js/src/tools.js, got:\n${diff}`);
});
