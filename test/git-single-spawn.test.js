// Audit item 8 (13 Oct 2026, C&C's ruling): src/git.js is the ONLY place that starts git, so every call carries `-c core.fsmonitor=false` (see test/audit-811-git-fsmonitor.test.js for what that stops).
// A scanner, so a fourth spawn site cannot appear quietly: no `'git'` command literal anywhere in src/ outside src/git.js. Comment lines are not code. The detector has its own row: it must flag a duplicate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
// `'git'` as a whole string (a spawn/exec command), or a shell string that starts with git and a git sub-command; sentences that merely begin with the word git are not commands.
const GIT_COMMAND = /['"`]git['"`]|['"`]git\s+(?:-C|-c|check-ignore|status|diff|log|ls-files|rev-parse|add|commit|config)\b/;
const isComment = line => /^\s*(\/\/|\*|\/\*)/.test(line);
export const gitLiteralLines = text => text.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !isComment(l) && GIT_COMMAND.test(l.replace(/\/\/.*$/, '')));
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });

test('no `git` command literal in src/ outside src/git.js (the scan walks every .js file under src/)', () => {
  const files = walk(src);
  assert.ok(files.length > 50 && files.some(f => f.endsWith('git.js')), `the scan really sees src/ (${files.length} files)`);
  const hits = files.filter(f => !f.endsWith(join('src', 'git.js'))).flatMap(f => gitLiteralLines(readFileSync(f, 'utf8')).map(([n, l]) => `${relative(src, f)}:${n}: ${l.trim().slice(0, 100)}`));
  assert.deepEqual(hits, [], 'git is started through runGit (src/git.js) only');
  assert.ok(gitLiteralLines(readFileSync(join(src, 'git.js'), 'utf8')).length >= 1, 'and the one allowed place does hold the literal (the scan can see it)');
});

test('the detector flags a scratch duplicate (spawnSync / execFileSync / a shell string) and ignores a comment', () => {
  assert.equal(gitLiteralLines("const r = spawnSync('git', ['status']);").length, 1);
  assert.equal(gitLiteralLines('execFileSync("git", ["rev-parse"]);').length, 1);
  assert.equal(gitLiteralLines('exec(`git check-ignore -q .env`);').length, 1);
  assert.equal(gitLiteralLines("// spawnSync('git', ...) is only a comment").length, 0);
  assert.equal(gitLiteralLines("const x = 1; // run 'git' here").length, 0);
});
