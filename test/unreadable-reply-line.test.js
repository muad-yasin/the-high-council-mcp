// 0.8.4 (a 13837 run printed "unreadable reply round" 78 times for ONE reply, once per sitting, with no cause): a debate or reply stage whose text cannot be read is announced once,
// with what the text was, on the sitting that paid for it; a replayed stage is not announced again. The record (`debate.dropped`) is unchanged. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setCache, setBudget, unreadableReplyCause } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('unreadableReplyCause: empty, no JSON, cut-off JSON', () => {
  assert.equal(unreadableReplyCause(''), 'the reply was empty');
  assert.equal(unreadableReplyCause('  \n'), 'the reply was empty');
  assert.equal(unreadableReplyCause(undefined), 'the reply was empty');
  assert.equal(unreadableReplyCause('Several thoughts on these proposals, and no JSON at all.'), 'the reply held no JSON');
  assert.equal(unreadableReplyCause('```json\n{"posts": [{"on": "P1", "stance": "obj'), 'the JSON in the reply was cut off or malformed');
});

const run = async cache => {
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  // mock-proposer-garbled proposes normally and answers the debate with prose
  const config = { ...base, seats: { ...base.seats, proposers: [{ ...base.seats.proposers[0], model: 'mock-proposer-garbled' }, base.seats.proposers[1]] } };
  const lines = []; const disk = new Map();
  setCache(cache); setBudget(null);
  try {
    const result = await runChain({ config, request: 'A mock task.', log: l => lines.push(l), onStage: s => disk.set(s.label, { text: s.text, usage: s.usage, usd: s.usd, provider: s.provider, model: s.model }) });
    return { result, lines, disk };
  } finally { setCache(null); }
};

test('an unreadable debate reply is named once with its cause on the paying sitting, and not again on a replay', async () => {
  const first = await run(null);
  // the lines this fix is about; the board's summary line ("Dropped: ... unreadable") is printed by every sitting and says what the board holds, so it is not one of them
  const announced = l => /: unreadable (debate reply|reply)/.test(l);
  const unreadable = first.lines.filter(announced);
  assert.ok(unreadable.includes('  mock-a: unreadable debate reply (the reply held no JSON) - no posts counted.'), unreadable.join('\n'));
  assert.equal(unreadable.filter(l => /unreadable debate reply/.test(l)).length, 1);
  const dropped = first.result.debate.dropped.filter(d => d.by === 'mock-a');
  assert.ok(dropped.some(d => d.stage === 'debate' && d.reason === 'unreadable'), JSON.stringify(first.result.debate.dropped));
  // the second sitting replays every stage from disk: nothing is announced again, the drop is still recorded
  const second = await run({ get: l => first.disk.get(l) || null });
  assert.deepEqual(second.lines.filter(announced), [], 'a replayed stage is not announced again');
  assert.deepEqual(second.result.debate.dropped, first.result.debate.dropped, 'the record is the same');
});

// An external seat's answer is read from its stage file on the sitting that receives it, so it arrives as a replay: it is still announced (a gate on "replayed" alone would silence it for good).
test('an unreadable debate reply from an external seat is announced when it is read from its stage file', async () => {
  const first = await run(null);
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  const config = { ...base, seats: { ...base.seats, proposers: [{ provider: 'external', model: 'subscription:mock', lab: 'mock-a' }, base.seats.proposers[1]] } };
  const answers = new Map(first.disk);
  answers.set('debate-mock-a', { text: 'No JSON from me, only prose.', usage: { input: 0, output: 0 }, usd: 0, provider: 'external', model: 'subscription:mock' });
  const lines = [];
  setCache({ get: l => answers.get(l) || null }); setBudget(null);
  try { await runChain({ config, request: 'A mock task.', log: l => lines.push(l) }); } catch (e) { if (!e?.controlFlow) throw e; }   // the chain pauses at the external seat's next stage finally { setCache(null); }
  assert.ok(lines.includes('  mock-a: unreadable debate reply (the reply held no JSON) - no posts counted.'), lines.filter(l => /mock-a/.test(l)).join('\n'));
});
