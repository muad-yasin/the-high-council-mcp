// Post-V fix-up (B3 prep): the final read meets JUDGE's severity tags. With the chain's severity switch on, a layer-3 seat that reads the final plan tags its objections; an objection rated
// below 4 is recorded and does not turn an agreed ending into "not agreed", one that holds sign-off (4 or above, or no readable tag) does. The predicate is ONE call to holdsSignOff
// (src/final-read.js). Offline, no provider call: the stage is driven with a scripted invoke, the dispute copy with mock seats. Switch off: today's behaviour, byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, runFinalRead } from '../src/chain.js';
import { SEVERITY_LINES } from '../src/severity.js';
import { severityReaskNote } from '../src/roles.js';
import { finalReadBlocksAgreement, finalReadObjected, finalReadSummaryLine, finalReadLogLines, readEntry, finalReadRecord } from '../src/final-read.js';
import { chainOf, critic } from './helpers/final-read-chain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SWEEP = Math.round((SEVERITY_LINES.settle - 0.1) * 10) / 10;   // the highest tag that does NOT hold sign-off
const HOLD = SEVERITY_LINES.settle;                                    // the lowest tag that does

// ---- the predicate -------------------------------------------------------------------------------------------------------------------------------------------------------------
const seat = failures => ({ lab: 'x', layer: 3, label: 'final-read-x', read: true, meets: false, failures, reasked: false, last_read_sha: null });
const agreed = (...seats) => ({ ran: true, run_end: 'agreed', final_sha: 'abc', seats });
const f = severity => ({ criterion: 'Scope', problem: 'It adds a billing system.', ...(severity === undefined ? {} : { severity }) });

test('predicate: a seat whose objections are ALL below the line is recorded, not a flip; one at or above the line, an untagged one, an empty list and every switch-off record still block', () => {
  assert.equal(finalReadBlocksAgreement(agreed(seat([f(SWEEP)]))), false, 'only a swept objection: agreement stands');
  assert.equal(finalReadObjected(agreed(seat([f(SWEEP)]))), false);
  assert.equal(finalReadBlocksAgreement(agreed(seat([f(SWEEP), f(SWEEP)]))), false);
  assert.equal(finalReadBlocksAgreement(agreed(seat([f(SWEEP), f(HOLD)]))), true, 'one holding objection among swept ones blocks');
  assert.equal(finalReadObjected(agreed(seat([f(SWEEP), f(HOLD)]))), true);
  assert.equal(finalReadBlocksAgreement(agreed(seat([f(null)]))), true, 'a tag that is not readable holds (null in the record)');
  assert.equal(finalReadBlocksAgreement(agreed(seat([f()]))), true, 'switch off: no failure carries a tag, so nothing is swept (today\'s predicate)');
  assert.equal(finalReadBlocksAgreement(agreed(seat([]))), true, 'meets false with no objection listed blocks, as before');
  assert.equal(finalReadBlocksAgreement(agreed(seat([f(SWEEP)]), { ...seat([]), meets: true })), false, 'a clear seat beside a swept one');
  assert.equal(finalReadBlocksAgreement(agreed(seat([f(SWEEP)]), { lab: 'y', layer: 3, label: 'final-read-y', read: false, why: 'no reply', reasked: true, last_read_sha: null })), true, 'an unread seat still blocks');
});

test('texts follow the predicate: the summary line and the log say "NOT agreed" / "OBJECTED" only for a seat that holds the plan', () => {
  const swept = agreed(seat([f(SWEEP)]));
  assert.equal(finalReadSummaryLine(swept), 'final read: x objected (1)', 'a swept objection is shown, but the run is not called not-agreed');
  assert.equal(finalReadSummaryLine(agreed(seat([f(HOLD)]))), 'final read: x objected (1) - the run is NOT agreed');
  assert.doesNotMatch(finalReadLogLines(swept.seats, 'agreed').join('\n'), /LAYER 3 OBJECTED/);
  assert.match(finalReadLogLines(agreed(seat([f(HOLD)])).seats, 'agreed').join('\n'), /LAYER 3 OBJECTED TO THE FINAL PLAN/);
});

test('the record copies a tag through readSeverity: a readable one as written, an unreadable one as null, none as no key', () => {
  const entry = critique => readEntry({ lab: 'x', layer: 3, label: 'final-read-x', lastReadSha: null, reasked: false, critique });
  const out = entry({ meets: false, failures: [{ criterion: 'A', problem: 'a', severity: 6.5 }, { criterion: 'B', problem: 'b', severity: 'high' }, { criterion: 'C', problem: 'c' }] });
  assert.deepEqual(out.failures.map(x => ('severity' in x ? x.severity : 'no key')), [6.5, null, 'no key']);
});

test('schema: the final read\'s and the dispute\'s severity point at JUDGE\'s one definition; no second inline definition is left', () => {
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  const found = [];
  (function walk(n, path) {
    if (!n || typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n)) {
      if (k === 'severity' && v && typeof v === 'object' && !Array.isArray(v) && (path.endsWith('properties'))) found.push(v);
      walk(v, `${path}.${k}`);
    }
  })(schema, '');
  const refs = found.filter(v => v.$ref === '#/$defs/objection/properties/severity');
  assert.equal(refs.length, 2, 'final_read.seats[].failures[] and dispute.open_objections[] reference the one definition');
  const inline = found.filter(v => Array.isArray(v.type) && v.type.includes('number'));
  assert.ok(inline.length >= 1 && inline.every(v => v.minimum === 1 && v.maximum === 10), 'every inline number definition left is JUDGE\'s own (bounded 1 to 10), never a bare [number, null] of this lane');
});

// ---- the stage (a scripted invoke; no provider) ---------------------------------------------------------------------------------------------------------------------------
const layered = extra => ({ name: 'sev-final-read', signoff: 'unanimous', maxRounds: 2, seats: { critics: [critic('mock-x', 'l3a', 3)] }, ...extra });
const reply = (failures, extra = {}) => JSON.stringify({ meets: false, criteria: [], failures, verdict_line: 'One thing is wrong.', ...extra });
const FAILURE = (severity) => ({ criterion: 'Scope', problem: 'It adds a billing system nobody asked for.', fix: 'Remove it.', ...(severity === undefined ? {} : { severity }) });
const drive = async (config, replies) => {
  const calls = [];
  const invoke = async (seatObj, { user, label }) => {
    const next = replies[Math.min(calls.length, replies.length - 1)];
    calls.push({ label, user, maxTokens: seatObj.maxTokens });
    return typeof next === 'string' ? { text: next, usage: { input: 10, output: 10, stop: 'stop' } } : next;
  };
  const seats = config.seats.critics.map(c => ({ ...c, maxTokens: 4000 }));
  const entries = await runFinalRead(config, { seats, lastReadShas: new Map(seats.map(s => [s.lab, null])), request: 'A mock task.', criteria: ['It is complete.'], draft: 'THE PLAN', invoke, record: x => x });
  return { entries, calls };
};

test('stage, switch ON: the tags a seat writes are kept and a swept read does not block an agreed ending', async () => {
  const { entries, calls } = await drive(layered({ severity: { enabled: true } }), [reply([FAILURE(SWEEP)])]);
  assert.equal(calls.length, 1);
  assert.deepEqual(entries[0].failures.map(x => x.severity), [SWEEP]);
  const rec = finalReadRecord({ ran: true, finalSha: 'abc', runEnd: 'agreed', seats: entries });
  assert.equal(finalReadBlocksAgreement(rec), false);
  const holds = await drive(layered({ severity: { enabled: true } }), [reply([FAILURE(HOLD)])]);
  assert.equal(finalReadBlocksAgreement(finalReadRecord({ ran: true, finalSha: 'abc', runEnd: 'agreed', seats: holds.entries })), true);
});

test('stage, switch ON: a missing tag is re-asked once and the re-ask carries the missing-tag sentence', async () => {
  const note = severityReaskNote({ kind: 'untagged', n: 1, criterion: FAILURE().criterion });
  const { entries, calls } = await drive(layered({ severity: { enabled: true } }), [reply([FAILURE()]), reply([FAILURE(SWEEP)])]);
  assert.equal(calls.length, 2);
  assert.ok(!calls[0].user.includes(note) && calls[1].user.includes(note), 'only the re-ask is told');
  assert.ok(calls[1].user.startsWith(calls[0].user), 'the re-ask is the first prompt with the sentence added at the end');
  assert.equal(entries[0].read, true);
  assert.equal(entries[0].reasked, true);
  assert.deepEqual(entries[0].failures.map(x => x.severity), [SWEEP]);
});

test('stage, switch ON: a reply the provider cut off with a missing tag is asked again at the bigger cap AND that attempt carries the sentence', async () => {
  const cut = { text: `${reply([FAILURE()])}\n\nNotes on the remaining sections: the rollout order in sect`, usage: { input: 10, output: 4000, stop: 'length' } };
  const note = severityReaskNote({ kind: 'untagged', n: 1, criterion: FAILURE().criterion });
  const { entries, calls } = await drive(layered({ severity: { enabled: true } }), [cut, reply([FAILURE(HOLD)])]);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].maxTokens > calls[0].maxTokens, 'the second ask has the bigger cap');
  assert.ok(calls[1].user.includes(note), 'and it still carries the missing-tag sentence');
  assert.equal(entries[0].read, true);
});

test('stage, switch ON: two replies with no tag are recorded "did NOT read" and the reason says the tag was missing, not "malformed"', async () => {
  const { entries, calls } = await drive(layered({ severity: { enabled: true } }), [reply([FAILURE()])]);
  assert.equal(calls.length, 2, 'one call and one re-ask, as in unit D');
  assert.equal(entries[0].read, false);
  assert.match(entries[0].why, /severity/);
});

test('stage, switch OFF: the same replies behave as before - no note, no re-ask, the tag a seat volunteers is dropped and the record has no severity key', async () => {
  const { entries, calls } = await drive(layered(), [reply([FAILURE(HOLD)])]);
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].user.includes('severity'));
  assert.equal(entries[0].read, true);
  assert.ok(entries[0].failures.every(x => !('severity' in x)));
  const untagged = await drive(layered(), [reply([FAILURE()])]);
  assert.equal(untagged.calls.length, 1, 'an untagged objection is simply read');
});

// ---- the dispute record ---------------------------------------------------------------------------------------------------------------------------------------------------
test('dispute.open_objections: with the switch on each open objection carries its tag; with it off there is no severity key', async () => {
  const run = async on => {
    const cfg = chainOf([critic('mock-exch-support-keep-sev5', 'ja', 1), critic('mock-exch-support-keep-sev9', 'jb', 1), critic('mock-exch-support-keep', 'jc', 2), critic('mock-exch-support-keep', 'jd', 3)],
      { maxRounds: 1, dispute: { enabled: true, stall_rounds: 9 }, ...(on ? { severity: { enabled: true } } : {}) });
    return (await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-sev-dispute', config: cfg })).dispute.open_objections;
  };
  const on = await run(true);
  assert.deepEqual(on.map(o => [o.lab, o.severity]), [['ja', 5], ['jb', 9]]);
  const off = await run(false);
  assert.equal(off.length, 2);
  assert.ok(off.every(o => !('severity' in o)));
});
