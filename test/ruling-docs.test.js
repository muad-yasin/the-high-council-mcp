// 0.8.4 MERGE_ORDER row 18 (WORDING U2-w7..w9): README, AI-README and CHANGELOG document `council ruling-add` and `council ruling-withdraw`, written from the code. The facts the text states are pinned to it here: both commands are dispatched in
// src/cli.js, the approval lives a day, a relayed ruling answer is accepted only if the ruling's text is in the person's words, a session cannot decline a ruling, and no MCP tool names a ruling. Text-only checks, offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const cli = read('src/cli.js'); const gate = read('src/gate.js'); const controls = read('src/run-controls.js');

test('the code does what the docs say: both commands are dispatched, an approval lives a day, a relayed ruling needs its text in the words, a session cannot decline a ruling, and there is no MCP tool for a ruling', () => {
  assert.match(cli, /if \(argv\[0\] === 'ruling-add'\)/);
  assert.match(cli, /if \(argv\[0\] === 'ruling-withdraw'\)/);
  assert.match(gate, /const RULING_TTL_MS = 24 \* 60 \* 60 \* 1000;/);
  assert.match(gate, /rulingTextInWords\(personWords, parsedRuling\.text\)\) return refuse\('person_words_text'/);
  assert.match(controls, /channel === SESSION_CHANNEL && decision !== 'approved'\) return refuse\('session_cannot_decline'/);
  assert.match(gate, /\{ const own = sessionOwnerRefusal\(lines, gateId\); if \(own\) return own; \}/, 'a gate the person asked for is not the session\'s to answer or to decline (declineOwnRequest goes through answerGate)');
  assert.doesNotMatch(read('src/mcp/server.js'), /server\.tool\(\s*'[a-z_]*ruling/);
  assert.equal(gate.includes("export const RULING_KIND = 'ruling';") && gate.includes("export const RULING_WITHDRAWAL_KIND = 'ruling_withdrawal';"), true);
});

test('README, AI-README and CHANGELOG each name both commands, and say what they promise: a day, the person\'s words, no MCP tool, the record', () => {
  // CHANGED (0.8.4 apply, the README rework): the ruling sentences are a Known limit, which moved word for word to KNOWN-LIMITS.md; the README entry reads the README and the limits file together (OLD: README.md alone).
  const readme = `${read('README.md')}\n${read('KNOWN-LIMITS.md')}`; const ai = read('AI-README.md'); const log = read('CHANGELOG.md');
  for (const text of [readme, ai, log]) { assert.match(text, /council ruling-add/); assert.match(text, /council ruling-withdraw/); assert.match(text, /no MCP tool/); }
  assert.match(readme, /\*\*A ruling is given from a terminal \(0\.8\.4\)\.\*\*/);
  assert.match(ai, /### A ruling for the judges \(`council ruling-add`, `council ruling-withdraw`; 0\.8\.4\)/);
  assert.match(ai, /the approval\s+can wait a day/);
  assert.match(ai, /accepted only if the ruling's text is in\s+them/);
  assert.match(ai, /`owner_rulings`[^]*`declined_requests`/);
  assert.match(log, /\*\*The person can give the judges a ruling in the middle of a run \(0\.8\.4\)\.\*\*/);
});
