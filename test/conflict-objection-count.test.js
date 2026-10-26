// 0.8.3 Astra B2.1 / D.* (C&C thcmcp-6d order of 20 Okt): a conflict can show more than two objections, so no sentence a person reads says "two objections" for it. Rows: (C1) the status phrase, (C2) the help text and README row 25, 
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('C1 the status phrase for a conflict stop does not count the objections', { timeout: 60_000 }, () => {
  const line = src('src/report-shape.js').split('\n').find(l => l.trim().startsWith('conflict: '));
  assert.ok(line, 'the STOP_CAUSE_WORDS conflict entry is found');
  assert.doesNotMatch(line, /two objections/); assert.match(line, /which objection takes priority/);
});

test('C2 the help text and README row 25 do not say two objections', { timeout: 60_000 }, () => {
  const help = src('src/cli.js'); const readme = src('README.md');
  assert.doesNotMatch(help, /choose between two objections \(exit 25\)/); assert.match(help, /"neither" keeps them all/);
  const row = readme.split('\n').find(l => l.startsWith('| 25 |'));
  assert.doesNotMatch(row, /two objections|both objections/); assert.match(row, /all the objections stand/);
});
