// 0.8.3 C1.5 (Muad 15 Okt 2026: the Chinese roster is "advertised in the readme"; C&C thcmcp-6d order of 20 Okt): every shipped plan-china-* chain has a row in the README's "Which chain" table, and its row says it has not run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('WC-1 each plan-china-* chain file has a row in the Which-chain table that says the roster has not run', { timeout: 60_000 }, () => {
  // README split (owner, 26 Okt 2026: "one final commit"): the section moved word for word to AI-README.md (the Which-chain table); the pin reads it there.
  const readme = readFileSync(new URL('../AI-README.md', import.meta.url), 'utf8');
  const start = readme.indexOf('**Which chain.**'); assert.ok(start > 0, 'the Which-chain section is found');
  const table = readme.slice(start, readme.indexOf('\n\n', readme.indexOf('| Chain |', start) + 10) + 1);
  const names = readdirSync(new URL('../chains/', import.meta.url)).filter(f => /^plan-china-.*\.json$/.test(f)).map(f => f.replace(/\.json$/, ''));
  assert.ok(names.length >= 3, 'the three Chinese chains are found');
  for (const n of names) {
    const row = table.split('\n').find(l => l.startsWith(`| \`${n}\` |`));
    assert.ok(row, `${n} has a row in the Which-chain table`);
    assert.match(row, /This roster has not run\./);
  }
});
