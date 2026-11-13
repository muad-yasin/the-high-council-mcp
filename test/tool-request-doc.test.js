// 0.8.4 D36 (plan A T5.6, decision D36): the tool-request path stays as it is, outside the excerpt channel, and the manual says so. AI-README.md's "Optional chain-config fields" lists `tools.seat_requests` with the
// drafted sentences (A-DRAFT until the one release wording review): a seat's tool results go to every later seat, are not excerpts, are not recorded in excerpts.jsonl and are not covered by the privacy switch.
// The facts behind the sentence were read in the code (src/chain.js: a seat's tool results join the ground-truth list and are appended to the request every later stage reads; the path needs `tools.seat_requests.enabled`, `verify.enabled` and a `verify.tools` list; no shipped chain sets it, checked by grep of chains/*.json) and are not pinned by line here. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const BULLET = '- **`tools.seat_requests`** - opt-in (`tools.seat_requests.enabled`), and only together with `verify.enabled` and a `verify.tools` list. A chain that turns on seat tool requests sends their results to every later seat. Those results are not excerpts: they are not recorded in `excerpts.jsonl` and the privacy switch does not cover them.';

test('AI-README.md says it, inside "Optional chain-config fields" (before "How this was built"), as the `tools.seat_requests` entry', () => {
  const text = read('AI-README.md');
  const from = text.indexOf('### Optional chain-config fields');
  const to = text.indexOf('## How this was built');
  assert.ok(from > 0 && to > from, 'the section is where it was');
  assert.equal(text.slice(from, to).split(BULLET).length, 2, 'the entry appears once in that section');
});
