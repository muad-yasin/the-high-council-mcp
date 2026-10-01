// test/chain-summary.test.js
//
// 0.8.0 WM0 item 9: a one-line `summary` per recommended chain, for a chain card. Display only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { lintChain } from '../src/chain-lint.js';
import { fingerprintInputs } from '../src/cache-integrity.js';
import { dryRunReport } from '../src/dry-run.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = n => JSON.parse(readFileSync(join(root, 'chains', `${n}.json`), 'utf8'));
const validate = new Ajv({ allErrors: true }).compile(JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8')));
const RECOMMENDED = ['cheap-7-v2', 'plan-premium-7', 'plan-highest-7', 'plan-daily-7', 'local-ollama'];

test('every recommended chain has a one-line summary, and it says what the chain is, not how well it works', () => {
  for (const name of RECOMMENDED) {
    const { summary } = load(name);
    assert.equal(typeof summary, 'string', name);
    assert.ok(summary.length >= 20 && summary.length <= 120 && !/[\r\n]/.test(summary), `${name}: ${summary.length}`);
    assert.doesNotMatch(summary, /\b(better|best|smarter|higher[- ]quality|more accurate|improv|outperform|superior|proven|guarantee)/i, `${name}: no efficacy wording`);
    assert.doesNotMatch(summary, /\$\s?\d/, `${name}: prices live in the dry run, not in a line that goes stale`);
  }
});

test('the schema and the lint accept a good summary and refuse a wrong one', () => {
  const base = load('mock');
  assert.equal(validate({ ...base, summary: 'A short line.' }), true, JSON.stringify(validate.errors));
  for (const bad of ['', 'two\nlines', 'x'.repeat(121), 7, null]) {
    assert.equal(validate({ ...base, summary: bad }), false, JSON.stringify(bad));
    assert.equal(lintChain({ ...base, summary: bad }, 'x.json').filter(f => f.kind === 'invalid-summary').length, 1, JSON.stringify(bad));
  }
  assert.equal(lintChain({ ...base, summary: 'A short line.' }, 'x.json').filter(f => f.kind === 'invalid-summary').length, 0);
});

test('a summary is left out of the stage cache fingerprint, and a chain without one hashes as before', () => {
  const base = load('mock');
  assert.equal(fingerprintInputs('task', { ...base, summary: 'One line.' }), fingerprintInputs('task', base));
  assert.equal(fingerprintInputs('task', { ...base, summary: 'Another.' }), fingerprintInputs('task', { ...base, summary: 'One line.' }));
  assert.notEqual(fingerprintInputs('task', { ...base, maxRounds: 9 }), fingerprintInputs('task', base), 'any other field still counts');
  assert.equal(fingerprintInputs('t', undefined), fingerprintInputs('t', undefined));
});

test('the dry-run JSON carries the summary when there is one', () => {
  assert.equal(dryRunReport(load('cheap-7-v2')).summary, load('cheap-7-v2').summary);
  assert.ok(!('summary' in dryRunReport(load('mock'))));
});
