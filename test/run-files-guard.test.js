// 0.8.2 item 2, the mechanical guard (a mistake shipped twice earns one): the MCP server's run-folder reads and writes all go through src/run-files.js.
// Any line in src/mcp/*.js or src/stage-submission.js that calls readFileSync, writeFileSync, readdirSync, openSync, appendFileSync, copyFileSync, a stream
// constructor or the old readJson must carry `// fs-ok: <why this file is not a run-folder file>`. A new tool that reads a run folder with a bare call fails here.
// 0.8.2 item 2 review: the scan covers src/send-path.js and src/advice-guards.js too (the dispositions write and the ledger read lived there, outside src/mcp/).
// The paraphrases enumerated first: readFileSync(join(runsDir, ...)), readFileSync(join(dir, ...)) after dir = join(runsDir, run), a variable p built from either,
// readJson(join(...)), writeFileSync of a path built the same way, and readdirSync of a run folder. All of them contain one of the call names below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FS_CALL = /\b(readFileSync|writeFileSync|readdirSync|openSync|appendFileSync|copyFileSync|createReadStream|createWriteStream)\s*\(|\breadJson\s*\(/;

export function unmarkedFsCalls(source) {
  return source.split('\n').map((line, i) => [i + 1, line])
    .filter(([, line]) => !/^\s*(import |\/\/)/.test(line) && FS_CALL.test(line) && !/fs-ok:/.test(line))
    .map(([n, line]) => `${n}: ${line.trim().slice(0, 100)}`);
}

test('the guard can fail: the pre-0.8.2 forms of every run-folder access are all flagged', () => {
  const old = [
    "const log = existsSync(join(runsDir, run, 'run.log')) ? readFileSync(join(runsDir, run, 'run.log'), 'utf8') : '';",
    "const prompt = readFileSync(join(dir, `NEEDS-${label}.md`), 'utf8');",
    "const runMeta = readJson(join(dir, 'run.json'));",
    "return text(readFileSync(p, 'utf8'));",
    "writeFileSync(join(dir, 'RESUME.md'), rb);",
    "files: existsSync(dir) ? readdirSync(dir).filter(f => !f.endsWith('.usage.json')).sort() : [],",
    "writeFileSync(writtenFile, content);",
  ];
  assert.equal(unmarkedFsCalls(old.join('\n')).length, old.length);
  assert.deepEqual(unmarkedFsCalls("const r = readFileSync(p, 'utf8'); // fs-ok: a chain file"), []);
});

test('src/mcp/*.js, stage-submission.js, send-path.js and advice-guards.js make no unmarked filesystem read or write', () => {
  const files = [...readdirSync(join(root, 'src', 'mcp')).filter(f => f.endsWith('.js')).map(f => join('src', 'mcp', f)), join('src', 'stage-submission.js'), join('src', 'send-path.js'), join('src', 'advice-guards.js')];
  assert.ok(files.length >= 6, `expected the MCP modules, found ${files}`);
  const found = files.flatMap(f => unmarkedFsCalls(readFileSync(join(root, f), 'utf8')).map(x => `${f}:${x}`));
  assert.deepEqual(found, [], 'a bare file call: go through src/run-files.js (readRunFile, readRunJson, writeRunFile) or add `// fs-ok: <why>`');
});
