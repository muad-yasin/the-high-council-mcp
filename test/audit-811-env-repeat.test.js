// Audit item 11 / S02-2 (13 Oct 2026, C&C's rulings): a name written on two lines of a project .env keeps its FIRST value and the second is dropped without a word. For the two spend settings that is a cap the person may have meant
// the other way round, so a repeat of COUNCIL_MAX_USD_LIMIT or MAX_USD_PER_RUN stops the program before any command reads it (exit 2, one sentence). CONSEQUENCE, chosen on purpose: `council --version` refuses with such a .env too;
// that is right for a money name. Repeats are counted by name in the file text with the setter's own line rule (so `export NAME=1` then `NAME=100` is a repeat, and a name the real environment already holds still counts);
// a line with an empty value is no setting; any other repeated name keeps the old silent rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnvFile, MONEY_NAMES } from '../src/env-file.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
// The sentence is the diagnostic (it stops `council doctor` too): it names the FILE and the line numbers.
const SENTENCE = (name, label, lines) => `${label}: ${name} is written on lines ${lines}, and it is a spend setting, so nothing started rather than guess which line you meant. Keep one line and run the command again.`;

test('applyEnvFile reports each repeated MONEY name once, counted with the setter\'s own line rule, and the sentence names the file and every line', () => {
  const sentences = {};
  applyEnvFile('MAX_USD_PER_RUN=2\nMAX_USD_PER_RUN=20\nMAX_USD_PER_RUN=30\nexport COUNCIL_MAX_USD_LIMIT=1\nCOUNCIL_MAX_USD_LIMIT=100\n', {}, { label: '/proj/.env', onRepeatedMoney: (n, sentence) => { sentences[n] = sentence; } });
  assert.deepEqual(sentences, {
    MAX_USD_PER_RUN: SENTENCE('MAX_USD_PER_RUN', '/proj/.env', '1, 2 and 3'),
    COUNCIL_MAX_USD_LIMIT: SENTENCE('COUNCIL_MAX_USD_LIMIT', '/proj/.env', '4 and 5'),
  }, 'once each, the export form counts, and the caller gets the one sentence (so every entry says the same)');
  assert.deepEqual(MONEY_NAMES, ['COUNCIL_MAX_USD_LIMIT', 'MAX_USD_PER_RUN']);
  const none = []; applyEnvFile('MAX_USD_PER_RUN=2\nMAX_USD_PER_RUN=20\n', {}, { onRepeatedMoney: (n, sentence) => none.push(sentence) });
  assert.ok(none[0].startsWith('.env: MAX_USD_PER_RUN is written on lines 1 and 2,'), 'without a label the file is called .env');
});

test('a name the real environment already holds still counts (its lines are skipped, the repeat is still a mistake); an empty-value line, one line, and any other repeated name do not', () => {
  const told = [];
  const on = n => told.push(n);
  applyEnvFile('MAX_USD_PER_RUN=2\nMAX_USD_PER_RUN=20\n', { MAX_USD_PER_RUN: '5' }, { onRepeatedMoney: on });
  assert.deepEqual(told, ['MAX_USD_PER_RUN']);
  told.length = 0;
  applyEnvFile('MAX_USD_PER_RUN=2\nMAX_USD_PER_RUN=\nCOUNCIL_MAX_USD_LIMIT=1\nOPENROUTER_API_KEY=a\nOPENROUTER_API_KEY=b\n', {}, { onRepeatedMoney: on });
  assert.deepEqual(told, [], 'an empty value is no setting; one line each; a key repeated keeps the old silent first-wins rule');
  const env = {}; applyEnvFile('OPENROUTER_API_KEY=a\nOPENROUTER_API_KEY=b\n', env, { onRepeatedMoney: on });
  assert.equal(env.OPENROUTER_API_KEY, 'a');
});

function run(args, dotenv) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-envrepeat-')); writeFileSync(join(dir, '.env'), dotenv);
  return { dir, ...spawnSync(process.execPath, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, COUNCIL_WORKDIR: dir, ...malformedProviderKeys() }, input: '', encoding: 'utf8', timeout: 60_000 }) };
}

test('REAL VERBS: `council --version`, `council --mcp` and `council doctor` refuse (exit 2, the one sentence naming the file and the lines) with a repeated MAX_USD_PER_RUN / COUNCIL_MAX_USD_LIMIT in the project .env', () => {
  for (const [args, dotenv, name, lines] of [[['--version'], 'MAX_USD_PER_RUN=2\nMAX_USD_PER_RUN=20\n', 'MAX_USD_PER_RUN', '1 and 2'], [['--mcp'], '# a comment\nexport COUNCIL_MAX_USD_LIMIT=1\nCOUNCIL_MAX_USD_LIMIT=100\n', 'COUNCIL_MAX_USD_LIMIT', '2 and 3'], [['doctor'], 'MAX_USD_PER_RUN=2\nOPENROUTER_API_KEY=k\nMAX_USD_PER_RUN=3\n', 'MAX_USD_PER_RUN', '1 and 3']]) {
    const r = run(args, dotenv);
    assert.equal(r.status, 2, `${args}: ${r.stdout}${r.stderr}`.slice(0, 300));
    assert.ok(r.stderr.includes(SENTENCE(name, join(r.dir, '.env'), lines)), `${args}: ${r.stderr}`);
  }
});

test('CONTROL: one line each, an empty second line, and a repeated key all start normally (`council --version` exit 0)', () => {
  for (const dotenv of ['MAX_USD_PER_RUN=2\nCOUNCIL_MAX_USD_LIMIT=5\n', 'MAX_USD_PER_RUN=2\nMAX_USD_PER_RUN=\n', 'OPENROUTER_API_KEY=a\nOPENROUTER_API_KEY=b\n']) {
    const r = run(['--version'], dotenv);
    assert.equal(r.status, 0, `${JSON.stringify(dotenv)}: ${r.stdout}${r.stderr}`.slice(0, 300));
    assert.ok(!r.stderr.includes('spend setting'), r.stderr);
  }
});
