// 0.8.3 M5: the person's approval surface (PLAN 8.2, 8.6). Part 1 (M5a): the TEXTS a person reads; pure. Later slices add the gate, the figures and the limits below.
// CHANGED ACCEPTED (label rename, 20 Okt 2026; Muad 18 Okt: "upper estimate" replaces "at most" and "maximum"): OLD the printed label "at most" / "MAXIMUM" / "Maximum:"; NEW "upper estimate" / "UPPER ESTIMATE" / "Upper estimate:". WHY: only the printed figure label moved; the held sentences (README/docs/chain descriptions) still say "at most" and their pins here are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PREFIX_LEN, money, prefixOf, renderFrontierText, renderLimitStop, renderNeedsDecisionStop } from '../src/tree-stop.js';
import { TREE_VERBS } from '../src/tree-cli.js';
import { frontierView, limitView, needsDecisionView, replacementFrontierView } from './helpers/stop-views.js';

const NO_CLAIMS = /\b(better|best|improve[sd]?|quality|more accurate|outperform|guarantee[sd]?|safer|reliable)\b/i;

test('the approve text shows everything PLAN 8.2 lists, one assertion each', () => {
  const v = frontierView();
  const t = renderFrontierText(v);
  // (a) the parent, the PLAN 5.5 results, the verified split hash
  assert.match(t, /Node R, generation 1, run 2026-10-08T11-00-00-000Z/);
  for (const n of [1, 2, 3, 4]) assert.match(t, new RegExp(`\\n  ok: [^\\n]+ \\(plan 5\\.5, item ${n}\\)\\n`), `item ${n}: the plain sentence first, the reference last in brackets`);
  assert.equal(/\bPLAN 5\.5 item/.test(t), false, 'the reader has no plan in front of them: no reference leads a line');
  assert.ok(t.includes('This is the next set of child plans the tree would start. Nothing is started or paid until you approve.'), 'what this text is, under the title');
  assert.ok(t.includes(`The split block: sha256 ${'a'.repeat(64)}`));
  assert.equal(t.includes('opened by this decision'), false, 'a first frontier has no opening decision');
  // (b) per child: id, scope, inherited obligations verbatim with origin, agreements, chain with figures or "price pending preparation", grant, admission result, the may-stop flag
  assert.match(t, /1\. R\/M1 generation 1 \(milestone M1\)/);
  assert.ok(t.includes('Scope: Choose and build the record store.'));
  assert.ok(t.includes('- [R C1, global] The plan names an owner for every step.') && t.includes('- [R C2, delegated] No step calls the network.'), 'inherited obligations word for word with their origin');
  assert.ok(t.includes('- A1 to R/M2: K1 exposes get(id) and put(record) on the store. | check: Call get after put on both plans and compare the record.'), 'agreements it provides');
  assert.ok(t.includes('- A1 from R/M1: K1 exposes get(id) and put(record) on the store. | check: Call get after put on both plans and compare the record.'), 'agreements it expects');
  assert.ok(t.includes('Price: $1.11 cheapest end, $1.56 expected, $5.25 upper estimate (a task-less estimate from a dry run, not a measured cost)'));
  assert.ok(t.includes('Chain unpriced-chain: price pending preparation (no dry-run figure for this chain yet)'), 'a chain with no figure says so');
  assert.ok(t.includes('Proposed grant: $5.25, never more than $5.25 (a grant issued later may be lower, never higher)'));
  assert.equal((t.match(/No grant \(not admitted\)/g) || []).length, 1, 'a child that is not admitted has no grant line of money');
  assert.equal(t.includes('Proposed grant: $0.00'), false);
  assert.ok(t.includes('Admitted.') && t.includes('NOT ADMITTED: run limit (12 of 12 runs are registered)'));
  assert.equal((t.match(/May stop before finishing: yes/g) || []).length, 1, 'only the child whose grant is below the at-most figure carries the flag');
  assert.ok(t.includes('Added for this plan:') && t.includes('- The store keeps every record for 30 days.'));
  assert.ok(t.includes('Note (not a stop): no-consistency:'), 'the lint finding is shown, labelled as not a stop');
  // (c) money, limits, children not admitted and why, every guard_refused and check_not_enforced item with the three choices
  assert.ok(t.includes('Root cap $60.00; spent so far $4.20; held for running children $10.40; still available $45.40.'));
  assert.ok(t.includes('runs: 12 of 12') && t.includes('depth: 1 of 2') && t.includes('children per split: 3 of 4'));
  assert.match(t, /Not admitted, and why\n  R\/M3 generation 1: run limit/);
  assert.ok(t.includes('council tree decide 2026-10-08T11-00-00-000Z --max-runs|--max-depth|--max-children <n> (a raise never changes the root cap)'));
  assert.ok(t.includes('R/M2: refused by infeasibleCriteria, carried in context only: The plan stays consistent with the milestone format of HANDOFF.md'));
  assert.ok(t.includes('R/M2: C2 has a check this chain will not enforce: grep -c date plan.md (item: Every step has a date.)'));
  // held items: the text offers only what a command exists for (C&C ruling, 8 Oct: approving admits them context-only; not approving starts nothing; `council tree stop` stops)
  assert.ok(t.includes('Approving admits every child above with these items carried in context only: the tree then needs a person-recorded result for each before it can be ready.'));
  assert.ok(t.includes('Not approving starts nothing. To stop here: council tree stop 2026-10-08T11-00-00-000Z (nothing further starts; you can resume later).'));
  assert.equal(/you choose|leave the child unstarted|end the tree/.test(t), false, 'no choice is promised that no command makes');
  // the total being authorized is the sum of the grants printed above it, and sits above the prefix prompt
  const grants = [...t.matchAll(/Proposed grant: \$([0-9.]+),/g)].map(m => Number(m[1]));
  assert.deepEqual(grants, [5.25, 3.1]);
  assert.ok(t.includes(`Approving authorizes up to $${(grants[0] + grants[1]).toFixed(2)} of new paid runs (the sum of the NEW grants above, each shown rounded to the cent; already registered children are not counted).`));
  assert.ok(t.indexOf('Approving authorizes up to') < t.indexOf('To approve, type the first'), 'above the prefix prompt');
  assert.ok(t.includes('Milestones still to expand later: M4'));
  // the prefix to type is inside the text the gate hashes
  assert.ok(t.trimEnd().endsWith(`To approve, type the first ${PREFIX_LEN} characters of the frontier key: 3f9a1c2e`));
  assert.equal(PREFIX_LEN, 8); assert.equal(prefixOf(v.frontierKey), '3f9a1c2e');
});

test('a replacement frontier prints the decision that opened it, word for word; the same view always renders the same bytes; no claim about quality anywhere', () => {
  const t = renderFrontierText(replacementFrontierView());
  assert.ok(t.includes('This set replaces earlier generations. It was opened by this decision, word for word:'));
  assert.ok(t.includes('| Decision: the record store is SQLite, one file per tree.') && t.includes('| Start the storage plan again with that fixed.'));
  assert.equal(renderFrontierText(frontierView()), renderFrontierText(frontierView()), 'deterministic');
  assert.notEqual(renderFrontierText(frontierView()), renderFrontierText(frontierView({ frontierKey: 'b'.repeat(64) })), 'the key is in the text, so it is bound by the hash');
  for (const text of [t, renderFrontierText(frontierView()), renderLimitStop(limitView())]) assert.equal(NO_CLAIMS.test(text), false, text.match(NO_CLAIMS)?.[0]);
});

test('no text offers a command that does not exist: every `council tree <verb>` and every option named after a decide in the three texts belongs to a verb the CLI has', () => {
  const texts = [renderFrontierText(frontierView()), renderFrontierText(replacementFrontierView()), renderLimitStop(limitView()), renderNeedsDecisionStop(needsDecisionView())];
  let seen = 0;
  for (const t of texts) {
    for (const m of t.matchAll(/council tree ([a-z]+) (\S+)((?: --[a-z-]+(?:\|--[a-z-]+)*)?)/g)) {
      seen += 1;
      assert.ok(Object.hasOwn(TREE_VERBS, m[1]), `council tree ${m[1]} is not a verb`);
      for (const opt of m[3].trim().split(/\s+/).filter(Boolean).flatMap(o => o.split('|'))) assert.ok(TREE_VERBS[m[1]].value.includes(opt) || TREE_VERBS[m[1]].bool.includes(opt), `${opt} is not an option of council tree ${m[1]}`);
    }
  }
  assert.ok(seen >= 4, 'the scan found the commands the texts name (a scan that finds none proves nothing)');
});

test('money is shown the way a person reads it: two decimals, four below a cent, "unknown" for anything that is not a number', () => {
  assert.deepEqual([money(5.25), money(0), money(0.004), money(1.5), money(NaN), money(undefined), money('3')], ['$5.25', '$0.00', '$0.0040', '$1.50', 'unknown', 'unknown', 'unknown']);
});

test('a limit stop (PLAN 8.6) names the limit, its count and effective value, the open work with scope verbatim, a rough added cost with its basis (or "not yet priced"), and what a raise does not change', () => {
  const t = renderLimitStop(limitView());
  assert.ok(t.startsWith('A limit stops the tree: maxRuns is 12 of 12.'));
  assert.ok(t.includes('R/M3: Define the export format.') && t.includes('R/M5: Write the migration notes.') && t.includes('Milestones still unexpanded: M7'));
  assert.ok(t.includes('2 more children x $5.25 (daily7-sub-a, upper estimate) = $10.50. That is a task-less estimate, not a measured cost.'), 'pack-B-style arithmetic, labelled');
  assert.ok(t.includes('The root cap stays $60.00 whatever you decide; $45.40 is still available under it.'));
  assert.ok(t.includes('council tree decide 2026-10-08T11-00-00-000Z --max-runs <n> with n above 12'));
  const unpriced = renderLimitStop({ ...limitView(), perChild: null });
  assert.ok(unpriced.includes('A rough added cost: not yet priced'));
  assert.ok(renderLimitStop({ ...limitView(), raises: [{ from: 12, to: 13 }], effective: 13 }).includes('raised 12 -> 13'));
  assert.ok(renderLimitStop({ ...limitView(), wouldAdmit: 1 }).includes('1 more child x $5.25'), 'singular');
});

// ================================================================================================================================================================ M5b1: the gate (PLAN 8.2)
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerGate, listGates, readGateAnswer, recordUse, textSha256 } from '../src/gate.js';
import { TREE_GATE_KINDS, askTreeGate, recordTreeUse, requestTreeGate, treeApproval } from '../src/tree-gate.js';
import { readTreeRecord } from '../src/tree-record.js';
import { newTree } from './helpers/tree-fixture.js';
import { terminal } from './helpers/terminal.js';

const T0 = Date.parse('2026-10-08T12:00:00Z');
const frontierText = () => renderFrontierText(frontierView());
const PREFIX = prefixOf(frontierView().frontierKey);
const gateFor = (t, now = () => T0) => { const r = requestTreeGate(t.rootDir, { kind: TREE_GATE_KINDS.frontier, text: frontierText() }, { now }); assert.equal(r.ok, true, r.message); return r.gate; };

test('a tree gate is approved only by a person at a terminal who TYPES the frontier-key prefix and says y: a wrong prefix, an empty one and no terminal each write nothing and leave the gate pending; the right one approves', async () => {
  const t = newTree({ cap: 10 });
  const gate = gateFor(t);
  assert.equal(gate.kind, 'tree_frontier'); assert.equal(gate.sha256, textSha256(Buffer.from(frontierText())));
  assert.ok(existsSync(join(t.rootDir, gate.text)) && gate.text.startsWith('tree/gate-texts/'), 'the exact text is a file under tree/, inside the root run folder');
  const ledger = () => readFileSync(join(t.rootDir, 'gate-ledger.jsonl'), 'utf8');
  const before = ledger();
  for (const typedAnswers of [['wrongone', 'y'], ['', 'y'], [PREFIX.toUpperCase().replace(/[0-9]/g, 'x')]]) {
    const io = terminal(typedAnswers);
    assert.equal(await askTreeGate(t.rootDir, gate.id, { expectPrefix: PREFIX, ...io, now: () => T0 }), 1, JSON.stringify(typedAnswers));
    assert.match(io.shown(), /Nothing was written; the gate stays pending\./);
  }
  assert.equal(ledger(), before, 'no answer was written');
  const noTty = terminal([PREFIX, 'y'], { tty: false });
  assert.equal(await askTreeGate(t.rootDir, gate.id, { expectPrefix: PREFIX, ...noTty, now: () => T0 }), 2);
  assert.match(noTty.errors(), /needs a person at a terminal/); assert.equal(ledger(), before);
  assert.equal(readGateAnswer(t.rootDir, gate.id, { now: () => T0 }).status, 'pending');
  const io = terminal([PREFIX, 'y']);
  assert.equal(await askTreeGate(t.rootDir, gate.id, { expectPrefix: PREFIX, ...io, now: () => T0 }), 0, io.shown() + io.errors());
  assert.ok(io.shown().includes(frontierText().split('\n')[0]), 'the whole text was shown first');
  assert.ok(io.shown().includes('approving records your decision on exactly this text, once'), 'a tree gate says what approving does (not "sending")');
  const a = treeApproval(t.rootDir, gate.id, { kind: 'tree_frontier', now: () => T0 });
  assert.equal(a.approved, true); assert.deepEqual([a.answer.channel, a.answer.tty], ['cli', true]);
});

test('an approval is spent ONCE: recordTreeUse writes a tree_frontier_approved line, a second use and a use after expiry are refused, and a used or lapsed gate approves nothing', async () => {
  const t = newTree({ cap: 10 });
  const gate = gateFor(t);
  const io = terminal([PREFIX, 'y']); assert.equal(await askTreeGate(t.rootDir, gate.id, { expectPrefix: PREFIX, ...io, now: () => T0 }), 0);
  assert.equal(recordTreeUse(t.rootDir, gate.id, 'tree_frontier', { frontierKey: frontierView().frontierKey }, { now: () => T0 + 1000 }).ok, true);
  assert.match(readFileSync(join(t.rootDir, 'gate-ledger.jsonl'), 'utf8'), /"event":"tree_frontier_approved"/);
  const again = recordTreeUse(t.rootDir, gate.id, 'tree_frontier', {}, { now: () => T0 + 2000 });
  assert.equal(again.ok, false); assert.match(again.message, /already used/);
  assert.equal(recordUse(t.rootDir, gate.id, 'tree_frontier_approved', {}, { now: () => T0 + 2500 }).code, 'gate_used', 'and the gate itself says the same');
  assert.equal(treeApproval(t.rootDir, gate.id, { now: () => T0 + 3000 }).approved, false); assert.match(treeApproval(t.rootDir, gate.id, { now: () => T0 + 3000 }).reason, /already used/);
  // an approval nobody used lapses with the gate (ten minutes)
  const g2 = gateFor(t, () => T0 + 5000);
  const io2 = terminal([PREFIX, 'y']); assert.equal(await askTreeGate(t.rootDir, g2.id, { expectPrefix: PREFIX, ...io2, now: () => T0 + 6000 }), 0);
  const late = T0 + 5000 + 11 * 60_000;
  assert.match(treeApproval(t.rootDir, g2.id, { now: () => late }).reason, /lapsed/);
  assert.deepEqual([recordTreeUse(t.rootDir, g2.id, 'tree_frontier', {}, { now: () => late }).ok], [false]);
  // the ledger refuses any OTHER use event, and a made-up kind is not a tree kind
  assert.equal(recordUse(t.rootDir, g2.id, 'tree_made_up', {}, { now: () => T0 + 7000 }).code, 'bad_event');
  assert.equal(recordTreeUse(t.rootDir, g2.id, 'tree_made_up').code, 'bad_kind');
});

test('an expired, unanswered gate approves nothing and adds nothing to events.jsonl (the person runs approve again)', async () => {
  const t = newTree({ cap: 10 });
  const gate = gateFor(t);
  const eventsBefore = readTreeRecord(t.rootDir).events.length; const ledgerBefore = readFileSync(join(t.rootDir, 'gate-ledger.jsonl'), 'utf8');
  const late = T0 + 11 * 60_000;
  const io = terminal([PREFIX, 'y']);
  assert.equal(await askTreeGate(t.rootDir, gate.id, { expectPrefix: PREFIX, ...io, now: () => late }), 1);
  assert.match(io.errors(), /is expired/);
  assert.equal(readTreeRecord(t.rootDir).events.length, eventsBefore, 'nothing in events.jsonl');
  assert.equal(readFileSync(join(t.rootDir, 'gate-ledger.jsonl'), 'utf8'), ledgerBefore, 'and no answer in the ledger');
  assert.equal(treeApproval(t.rootDir, gate.id, { now: () => late }).approved, false);
});

test('an approval on channel `elicitation` (a client\'s dialog) is not a tree approval, even though the gate itself accepts it; a decline is recorded and approves nothing; the text cannot change between showing and answering', async () => {
  const t = newTree({ cap: 10 });
  const g = gateFor(t);
  const viaDialog = answerGate(t.rootDir, g.id, { channel: 'elicitation', shownSha256: g.sha256, decision: 'approved', tty: false }, { now: () => T0 });
  assert.equal(viaDialog.ok, true, 'the gate module allows that channel');
  const a = treeApproval(t.rootDir, g.id, { now: () => T0 });
  assert.equal(a.approved, false); assert.match(a.reason, /channel "elicitation"/);
  const use = recordTreeUse(t.rootDir, g.id, 'tree_frontier', {}, { now: () => T0 });
  assert.deepEqual([use.ok, use.code], [false, 'not_a_tree_approval'], 'the gate would let it be used; the tree refuses, inside recordTreeUse, so no caller can forget to');
  assert.equal(recordUse(t.rootDir, g.id, 'tree_frontier_approved', {}, { now: () => T0 }).ok, true, '(the gate module itself does allow it: that is why recordTreeUse reads the answer first)');
  // a decline
  const d = gateFor(t, () => T0 + 1000);
  const io = terminal(['y']); assert.equal(await askTreeGate(t.rootDir, d.id, { decline: true, expectPrefix: PREFIX, ...io, now: () => T0 + 1000 }), 0);
  assert.equal(readGateAnswer(t.rootDir, d.id, { now: () => T0 + 1000 }).status, 'declined'); assert.equal(treeApproval(t.rootDir, d.id, { now: () => T0 + 1000 }).approved, false);
  // the text changed on disk after it was requested: the answer is refused
  const c = gateFor(t, () => T0 + 2000);
  writeFileSync(join(t.rootDir, c.text), `${frontierText()}\nA line added after the request.\n`);
  const io2 = terminal([PREFIX, 'y']); assert.equal(await askTreeGate(t.rootDir, c.id, { expectPrefix: PREFIX, ...io2, now: () => T0 + 2000 }), 1);
  assert.equal(readGateAnswer(t.rootDir, c.id, { now: () => T0 + 2000 }).status === 'approved', false);
});

test('no MCP tool approves a frontier, or asks for or records a tree gate itself; tree_decide answers only its own session-requested gates through tree-gate.js; src/tree-gate.js reads no environment variable and no argument; the only tree module that takes a terminal answer is src/tree-gate.js', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const code = f => readFileSync(join(root, f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.equal(/process\.env|\bargv\b|node:process/.test(code('tree-gate.js')), false, 'no environment, no argv');
  for (const f of readdirSync(join(root, 'mcp'))) assert.equal(/tree_frontier|tree_check|askTreeGate|recordTreeUse|treeApproval|frontier_approved|requestTreeGate|answerTreeGateAsSession/.test(code(`mcp/${f}`)), false, `src/mcp/${f} must not approve or spend a tree gate`);       // EDITED, disclosed (OLD: the pattern also had tree_decide): the tool NAME tree_decide is now registered in src/mcp/server.js (the session channel, b38335fe8303); the tool reaches no gate function itself (src/tree-decide-session.js, src/tree-approve-session.js do, through src/tree-gate.js)   // M6 S2: tree_check added - `tree_checked` matched none of the older names, so the new use event would have escaped this scan
  const takers = readdirSync(root).filter(f => f.startsWith('tree') && /answerAtTerminal/.test(code(f)));
  assert.deepEqual(takers, ['tree-gate.js']);
});
// THE POSITIVE CHECK (6d, frontier unit): the only route to a tree gate answer other than a terminal is a module that (1) is one of the two session modules, and (2) asks for every gate it later answers with `requestedBy: 'session'` (gate.js refuses a session answer on any other gate). Known-bad input first.
function sessionRouteProblems(name, text) {
  const out = [];
  if (!/answerTreeGateAsSession/.test(text)) return out;
  for (const line of text.split('\n')) if (/requestTreeGate\(/.test(line) && !/requestedBy: 'session'/.test(line) && !/^\s*(\/\/|\*)/.test(line)) out.push(`${name}: a gate request without requestedBy 'session' in a module that answers as the session: ${line.trim().slice(0, 90)}`);
  return out;
}
test('SESSION ROUTE: the only modules that answer a tree gate as the session are the two session modules, and each asks for its gates as the session', () => {
  assert.equal(sessionRouteProblems('bad.js', "import { answerTreeGateAsSession } from './tree-gate.js';\nconst g = requestTreeGate(rootDir, { kind: TREE_GATE_KINDS.frontier, text });").length, 1, 'known-bad: a session module that asks without the mark');
  assert.deepEqual(sessionRouteProblems('good.js', "answerTreeGateAsSession(r, g);\nrequestTreeGate(rootDir, { kind: k, text, requestedBy: 'session' });"), []);
  const root = join(import.meta.dirname, '..', 'src');
  const files = [...readdirSync(root).filter(f => f.endsWith('.js')).map(f => f), ...readdirSync(join(root, 'mcp')).filter(f => f.endsWith('.js')).map(f => `mcp/${f}`)];
  const naming = files.filter(f => f !== 'tree-gate.js' && /answerTreeGateAsSession/.test(readFileSync(join(root, f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')));
  assert.deepEqual(naming, ['tree-approve-session.js', 'tree-decide-session.js']);
  // and the writers of `frontier_approved` in src/ are exactly the person's terminal path and the session's, neither of them an MCP file (the MCP tool reaches the session writer only through src/tree-approve-session.js)
  const writers = files.filter(f => /event: 'frontier_approved'/.test(readFileSync(join(root, f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')));
  assert.deepEqual(writers, ['tree-approve-session.js', 'tree-approve.js']);
  assert.deepEqual(naming.flatMap(f => sessionRouteProblems(f, readFileSync(join(root, f), 'utf8'))), []);
});


// ================================================================================================================================================================ M5b1b (C&C's read of M5b1)
import { gateCommand } from '../src/gate-cli.js';

test('NO path approves a tree gate without the typed step: `council gate answer` on a tree_frontier gate answered "y" writes nothing, names the command that asks, and leaves the gate pending; declining through it still works', async () => {
  const t = newTree({ cap: 10 });
  const gate = gateFor(t);
  const ledger = () => readFileSync(join(t.rootDir, 'gate-ledger.jsonl'), 'utf8');
  const before = ledger();
  const io = terminal(['y']);
  const code = await gateCommand(['answer', ROOT_ID_OF(t), gate.id], { work: t.work, ...io, now: () => T0 });
  assert.equal(code, 1);
  assert.match(io.errors(), /is a tree_frontier gate: it is approved only by `council tree approve /);
  assert.match(io.errors(), /Nothing was written; the gate stays pending\. Declining is always allowed/);
  assert.equal(io.typed(), 0, 'no prompt was even shown: nothing was asked');
  assert.equal(ledger(), before); assert.equal(readGateAnswer(t.rootDir, gate.id, { now: () => T0 }).status, 'pending');
  // the same for a tree_decide gate, naming `decide`
  const d = requestTreeGate(t.rootDir, { kind: TREE_GATE_KINDS.decide, text: 'Raise the run limit from 12 to 13.\n\nTo approve, type the new value: 13\n' }, { now: () => T0 });
  assert.equal(d.ok, true, d.message);
  const io2 = terminal(['y']); assert.equal(await gateCommand(['answer', ROOT_ID_OF(t), d.gate.id], { work: t.work, ...io2, now: () => T0 }), 1);
  assert.match(io2.errors(), /is a tree_decide gate: it is approved only by `council tree decide /);
  // declining through the generic command is allowed and records a decline
  const io3 = terminal(['y']); assert.equal(await gateCommand(['answer', ROOT_ID_OF(t), gate.id, '--decline'], { work: t.work, ...io3, now: () => T0 }), 0, io3.errors());
  assert.equal(readGateAnswer(t.rootDir, gate.id, { now: () => T0 }).status, 'declined'); assert.equal(treeApproval(t.rootDir, gate.id, { now: () => T0 }).approved, false);
});

test('what must be typed has to be NAMED in the text\'s last line: a caller that asks for another string is refused before anything is shown, and one that asks for exactly what the text names is accepted', async () => {
  const t = newTree({ cap: 10 });
  const gate = gateFor(t);
  const before = readFileSync(join(t.rootDir, 'gate-ledger.jsonl'), 'utf8');
  const io = terminal(['zzzzzzzz', 'y']);
  assert.equal(await askTreeGate(t.rootDir, gate.id, { expectPrefix: 'zzzzzzzz', ...io, now: () => T0 }), 1);
  assert.match(io.errors(), /this text does not name what was to be typed/);
  assert.equal(readFileSync(join(t.rootDir, 'gate-ledger.jsonl'), 'utf8'), before);
  const ok = terminal([PREFIX, 'y']); assert.equal(await askTreeGate(t.rootDir, gate.id, { expectPrefix: PREFIX, ...ok, now: () => T0 }), 0, ok.errors());
});
function ROOT_ID_OF(t) { return `runs/${t.rootDir.split('/').pop()}`; }   // `council gate` takes the run FOLDER (relative to the working folder), not a bare id

// ================================================================================================================================================================ M5b1c (the three gaps the M5b1 mutation run found: B1, B2, B4)
import { requestGate } from '../src/gate.js';

test('treeApproval refuses on EACH axis alone: channel `elicitation` with a terminal recorded; channel `cli` with no terminal (false, and unrecorded); a gate of another kind; the other tree kind (and recordTreeUse refuses to spend it)', () => {
  const t = newTree({ cap: 10 });
  const approve = (g, answer) => assert.equal(answerGate(t.rootDir, g.id, { shownSha256: g.sha256, decision: 'approved', ...answer }, { now: () => T0 }).ok, true);
  const gateOfKind = (kind, text) => { const r = requestTreeGate(t.rootDir, { kind, text }, { now: () => T0 }); assert.equal(r.ok, true, r.message); return r.gate; };
  const ok = (id, kind) => treeApproval(t.rootDir, id, { ...(kind ? { kind } : {}), now: () => T0 });
  // B1: only the CHANNEL is wrong (the terminal is recorded as present)
  const e = gateOfKind(TREE_GATE_KINDS.frontier, `${frontierText()}(elicitation)\n`); approve(e, { channel: 'elicitation', tty: true });
  assert.match(ok(e.id).reason, /channel "elicitation"/); assert.doesNotMatch(ok(e.id).reason, /without a terminal/, 'the reason names the channel, not the terminal');
  // B2: only the TERMINAL is wrong (the channel is cli)
  for (const [tty, label] of [[false, 'false'], [null, 'unrecorded']]) {
    const g = gateOfKind(TREE_GATE_KINDS.frontier, `${frontierText()}(cli, tty ${label})\n`); approve(g, { channel: 'cli', tty });
    assert.match(ok(g.id).reason, /without a terminal/, `cli with tty ${label}`);
  }
  // control: the same text approved the proper way (cli, terminal) IS an approval, so the three refusals above are about the axis they change
  const good = gateOfKind(TREE_GATE_KINDS.frontier, `${frontierText()}(control)\n`); approve(good, { channel: 'cli', tty: true });
  assert.equal(ok(good.id, TREE_GATE_KINDS.frontier).approved, true);
  // B4: a gate of ANOTHER KIND (a contract gate), approved properly on cli at a terminal, is not a tree approval and cannot be spent as one
  writeFileSync(join(t.rootDir, 'contract-text.txt'), 'The contract text.\n');
  const other = requestGate(t.rootDir, { kind: 'contract_lock', textPath: 'contract-text.txt' }, { now: () => T0 }); assert.equal(other.ok, true, other.message);
  approve(other.gate, { channel: 'cli', tty: true });
  assert.match(ok(other.gate.id).reason, /is a contract_lock gate, not a tree gate/);
  const spentOther = recordTreeUse(t.rootDir, other.gate.id, 'tree_frontier', {}, { now: () => T0 });
  assert.deepEqual([spentOther.ok, spentOther.code], [false, 'not_a_tree_approval']);
  // the OTHER tree kind: a tree_decide gate approved properly is not a tree_frontier approval
  const decide = gateOfKind(TREE_GATE_KINDS.decide, 'Raise the run limit from 12 to 13.\n\nTo approve, type the new value: 13\n'); approve(decide, { channel: 'cli', tty: true });
  assert.equal(ok(decide.id, TREE_GATE_KINDS.decide).approved, true, 'as a tree_decide approval it is fine');
  assert.match(ok(decide.id, TREE_GATE_KINDS.frontier).reason, /is a tree_decide gate, not tree_frontier/);
  const wrong = recordTreeUse(t.rootDir, decide.id, 'tree_frontier', {}, { now: () => T0 });
  assert.deepEqual([wrong.ok, wrong.code], [false, 'not_a_tree_approval']);
  const ledger = readFileSync(join(t.rootDir, 'gate-ledger.jsonl'), 'utf8');
  assert.equal(/"event":"tree_frontier_approved"/.test(ledger), false, 'no frontier use line was written for the wrong kind');
  assert.equal(recordTreeUse(t.rootDir, decide.id, 'tree_decide', {}, { now: () => T0 }).ok, true, 'the right kind spends it, with the right event');
  assert.match(readFileSync(join(t.rootDir, 'gate-ledger.jsonl'), 'utf8'), /"event":"tree_decided"/);
});

// ================================================================================================================================================================ M5b2c: `council tree approve` (PLAN 8.2)
import { readdirSync as lsDir } from 'node:fs';
import { approveHandler } from '../src/tree-approve.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { approvalValid } from '../src/tree-transitions.js';
import { EVENTS_FILE, appendTreeEvent, stateOf, treeDirOf } from '../src/tree-record.js';
import { ROOT_ID, SPLIT_ROOT_HANDOFF_USD } from './helpers/tree-fixture.js';
import { capFor, ceilCents, mockBudgetFigures } from './helpers/money-figures.js';
import { realRoot } from './helpers/real-root.js';
import { assertBoundTextClean, dirty, dirtyMarked } from './helpers/bound-text.js';

const approveWith = (r, answers, extra = {}) => {
  const io = terminal(answers, extra.tty === false ? { tty: false } : {});
  if (extra.onPrompt) io.stdout.on('data', d => { if (/\[y\/N\]/.test(String(d))) extra.onPrompt(); });
  const clock = extra.clock ?? { t: T0 };
  const run = () => approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => clock.t });
  return { io, clock, run };
};
const eventsOf = r => readTreeRecord(r.t.rootDir).events;
const ledgerOf = r => readFileSync(join(r.t.rootDir, 'gate-ledger.jsonl'), 'utf8');

test('R15 (Astra F7, Opus 3-7, Fable Q1-9): the re-check before the approval is spent compares the TEXT that was shown, not only the bound hash: a figure the text shows but the hash does not bind (the available line) that moves while the person reads makes the approval "changed while you read" - nothing is recorded, the approval is not spent', async () => {
  const r = await realRoot();
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  const before = eventsOf(r).length;
  let calls = 0;
  const describe = args => { const x = describeFrontier(args); calls += 1; if (calls >= 2) x.view = { ...x.view, budget: { ...x.view.budget, availableUsd: x.view.budget.availableUsd - 1 } }; return x; };   // same bound hash, one displayed figure moved
  const io = terminal([prefixOf(d.frontierKey), 'y']);
  const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => T0, deps: { describeFrontier: describe } });
  assert.notEqual(code, 0, io.shown() + io.errors());
  assert.match(io.errors(), /what you were shown has changed while you were reading it/);
  assert.equal(calls, 2, 'described exactly twice: before the ask and at the re-check');
  assert.equal(eventsOf(r).length, before, 'nothing was recorded');
  assert.equal(/"event":"tree_frontier_approved"/.test(ledgerOf(r)), false, 'and the approval was not spent');
});

test('R8 (Opus 3-4): the frontier text a person approves holds no control or bidi character from the plan (terminalSafe, the K10 class): the hashed gate text, the hash the approval kept and the screen are all clean', async () => {
  const word = dirtyMarked('record store', 7);
  const b = block3(); b.children[0].scope = `Choose and build the ${word.raw} now.`;
  const r = await realRoot({ plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  const a = approveWith(r, [prefixOf(d.frontierKey), 'y']);
  assert.equal(await a.run(), 0, a.io.shown() + a.io.errors());
  const appr = eventsOf(r).find(e => e.event === 'frontier_approved');
  assertBoundTextClean({ rootDir: r.t.rootDir, shownSha256: appr.shownSha256, shown: a.io.shown(), word: `Choose and build the ${word.clean} now.`, kind: 'tree_frontier' });
});

test('approve: the pending frontier is described with the real children; after the typed prefix and y it records frontier_previewed then frontier_approved, both with the SAME boundSha256, the gate id and the hash of the text shown; no child folder, no registration, nothing started', async () => {
  const r = await realRoot();
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.equal(pending.parent.node, 'R'); assert.equal(pending.splitSha256, r.split);
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  assert.deepEqual(d.view.children.map(c => c.node), ['R/M1', 'R/M2', 'R/M3'], 'dependency order: the provider (K1) before its consumer (K2), then the block order');
  assert.ok(d.view.children.every(c => c.admitted), JSON.stringify(d.view.children.map(c => c.notAdmittedReason)));
  const prefix = prefixOf(d.frontierKey);
  const a = approveWith(r, [prefix, 'y']);
  const eventsBefore = eventsOf(r).length;
  assert.equal(await a.run(), 0, a.io.shown() + a.io.errors());
  const added = eventsOf(r).slice(eventsBefore);
  // EDITED in M6 S3b (disclosed; old: assert.deepEqual(added.map(e => e.event), ['frontier_previewed', 'frontier_approved'])): after an approval the verdict is recorded (PLAN 9.2), so a `readiness` record follows the two transitions
  assert.deepEqual(added.map(e => e.event), ['frontier_previewed', 'frontier_approved', 'readiness']);
  const [prev, appr] = added;
  assert.equal(prev.boundSha256, d.boundSha256); assert.equal(appr.boundSha256, d.boundSha256, 'the approval binds exactly what the preview named');
  assert.match(appr.gateId, /^g\d+$/); assert.equal(appr.revision, 1);
  const gateRec = JSON.parse(readFileSync(join(r.t.rootDir, 'gates', `${appr.gateId}.json`), 'utf8'));
  assert.equal(appr.shownSha256, gateRec.sha256, 'the hash of the text the person was shown');
  assert.equal(textSha256(readFileSync(join(r.t.rootDir, gateRec.text))), appr.shownSha256, 'and that is the text on disk');
  assert.deepEqual(prev.children.map(c => [c.node, c.chain.name, c.ceilingUsd > 0, c.capUsd > 0]), [['R/M1', 'mock-budget', true, true], ['R/M2', 'mock-budget', true, true], ['R/M3', 'mock-budget', true, true]], 'each child carries its chain, its ceiling and the grant shown as its cap');
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(approvalValid(st.frontiers.get(d.frontierKey)), true);
  assert.match(ledgerOf(r), /"event":"tree_frontier_approved"/, 'the gate approval was spent once');
  assert.deepEqual(lsDir(r.t.runsDir), [ROOT_ID], 'no child run folder exists: nothing started');
  assert.equal(eventsOf(r).some(e => e.event === 'node_registered' && e.node !== 'R'), false);
  // three equal shares of what is available (proposeGrants, src/tree-budget.js:333: min(atMost, available / k), each shown through floorCents, src/tree-frontier.js:261): available = 100 - 0.04 (the root's handoff), so 3 * floorCents(99.96 / 3) = 3 * 33.32 = 99.96 (it was 3 * floorCents(100 / 3) = 99.99 while the root's handoff cost $0)
  assert.match(a.io.shown(), /Approving authorizes up to \$99\.96 of new paid runs/);
  assert.match(a.io.shown(), /Approved: frontier [0-9a-f]{8}, revision 1\. Up to \$99\.96 for 3 new child runs \(R\/M1, R\/M2, R\/M3\)\. Nothing has started: the new children start/);   // EDITED, disclosed (summary-line fix-up; old: '3 child runs ... Nothing has started'): the line counts the NEW runs
  // once approved, nothing waits
  const again = approveWith(r, []); assert.equal(await again.run(), 2); assert.match(again.io.shown(), /Nothing waits for your approval/);
});

test('approve: a wrong or empty prefix, no terminal and a "n" each approve nothing and add NOTHING to events.jsonl or the gate ledger\'s approvals', async () => {
  const r = await realRoot();
  const prefix = prefixOf(findPendingFrontier({ rootDir: r.t.rootDir }).key);
  const before = eventsOf(r).length;
  for (const [answers, opts, code] of [[['nope', 'y'], {}, 1], [['', 'y'], {}, 1], [[prefix, 'n'], {}, 1], [[prefix, 'y'], { tty: false }, 2]]) {
    const a = approveWith(r, answers, opts);
    assert.equal(await a.run(), code, JSON.stringify([answers, opts]));
  }
  assert.equal(eventsOf(r).length, before, 'nothing was written to events.jsonl');
  assert.equal(/gate_answered/.test(ledgerOf(r)) && /"decision":"approved"/.test(ledgerOf(r)), false);
  assert.equal(findPendingFrontier({ rootDir: r.t.rootDir }) !== null, true, 'and the frontier still waits');
});

test('approve: the terminal is checked BEFORE the gate is requested: an attempt with no terminal leaves no gate text file and no ledger line behind, and says so in the gate\'s own words (S8-8; it used to leave both)', async () => {
  const r = await realRoot();
  const prefix = prefixOf(findPendingFrontier({ rootDir: r.t.rootDir }).key);
  const texts = () => { const d = join(r.t.rootDir, 'tree', 'gate-texts'); return existsSync(d) ? lsDir(d).length : 0; };
  const ledgerBefore = existsSync(join(r.t.rootDir, 'gate-ledger.jsonl')) ? ledgerOf(r) : '', filesBefore = texts(), eventsBefore = eventsOf(r).length;
  const a = approveWith(r, [prefix, 'y'], { tty: false });
  assert.equal(await a.run(), 2, a.io.shown() + a.io.errors());
  assert.match(a.io.errors(), /gate answer needs a person at a terminal: stdin and stdout must both be a terminal\. Nothing was written\./);
  assert.equal(texts(), filesBefore, 'no gate text file was written');
  assert.equal(existsSync(join(r.t.rootDir, 'gate-ledger.jsonl')) ? ledgerOf(r) : '', ledgerBefore, 'no ledger line was written');
  assert.equal(eventsOf(r).length, eventsBefore);
});

test('approve: a gate left unanswered past its expiry approves nothing and adds nothing to events.jsonl', async () => {
  const r = await realRoot();
  const prefix = prefixOf(findPendingFrontier({ rootDir: r.t.rootDir }).key);
  const clock = { t: T0 };
  const a = approveWith(r, [prefix, 'y'], { clock });
  a.io.stdout.once('data', () => { clock.t = T0 + 11 * 60_000; });           // the person reads for eleven minutes
  const before = eventsOf(r).length;
  assert.equal(await a.run(), 1, a.io.shown() + a.io.errors());
  assert.match(a.io.errors(), /is expired|expired at/);
  assert.equal(eventsOf(r).length, before); assert.equal(/tree_frontier_approved/.test(ledgerOf(r)), false);
});

test('approve: if what the person was shown changes while they read it (a limit raised, so the admission and the bound hash differ), the approval is NOT used and nothing is recorded; approving again shows the new figures and works', async () => {
  const r = await realRoot();
  const prefix = prefixOf(findPendingFrontier({ rootDir: r.t.rootDir }).key);
  const a = approveWith(r, [prefix, 'y']);
  a.io.stdout.once('data', () => { appendTreeEvent(r.t.rootDir, { event: 'limit_raised', limit: 'maxChildrenPerSplit', from: 4, to: 6, actor: 'person', via: 'terminal' }); });
  const before = eventsOf(r).length;
  assert.equal(await a.run(), 1, a.io.shown() + a.io.errors());
  assert.match(a.io.errors(), /has changed while you were reading it/); assert.match(a.io.errors(), /was NOT used and nothing was recorded/);
  assert.equal(eventsOf(r).length, before + 1, 'only the limit_raised that changed things');
  assert.equal(/tree_frontier_approved/.test(ledgerOf(r)), false, 'the gate approval was not spent');
  const b = approveWith(r, [prefix, 'y']);
  assert.equal(await b.run(), 0, b.io.shown() + b.io.errors());
  assert.deepEqual(eventsOf(r).slice(before + 1).map(e => e.event), ['frontier_previewed', 'frontier_approved', 'readiness']);   // EDITED in M6 S3b (disclosed; old: no trailing readiness record)
});

test('approve: a plan that no longer matches what the run wrote is refused with the item and the field, recorded as blocked (expansion_refused), and no gate is asked; before the split is verified nothing waits', async () => {
  const pre = await realRoot({ verify: false });
  const none = approveWith(pre, []); assert.equal(await none.run(), 2); assert.match(none.io.shown(), /Nothing waits/);
  const r = await realRoot();
  writeFileSync(join(r.runDir, 'deliverable.md'), `${readFileSync(join(r.runDir, 'deliverable.md'), 'utf8')}\nAn edit after the review.\n`);
  const a = approveWith(r, ['whatever', 'y']);
  const before = eventsOf(r).length; const gatesBefore = existsSync(join(r.t.rootDir, 'gates')) ? lsDir(join(r.t.rootDir, 'gates')).length : 0;
  assert.equal(await a.run(), 19);
  assert.match(a.io.errors(), /R cannot be expanded yet\. PLAN 5\.5 item \d/);
  const added = eventsOf(r).slice(before);
  assert.deepEqual(added.map(e => [e.event, e.reason]), [['blocked', 'expansion_refused']]);
  assert.equal(existsSync(join(r.t.rootDir, 'gates')) ? lsDir(join(r.t.rootDir, 'gates')).length : 0, gatesBefore, 'no gate was requested');
});

test('approve writes boundSha256 on every frontier event, and gateId + shownSha256 on the approval (pins: the fields the loop and the audit read)', async () => {
  const r = await realRoot();
  const a = approveWith(r, [prefixOf(findPendingFrontier({ rootDir: r.t.rootDir }).key), 'y']);
  assert.equal(await a.run(), 0);
  for (const e of eventsOf(r).filter(x => x.event === 'frontier_previewed' || x.event === 'frontier_approved')) assert.match(e.boundSha256, /^[0-9a-f]{64}$/, e.event);
  const appr = eventsOf(r).find(e => e.event === 'frontier_approved');
  assert.ok(appr.gateId && /^[0-9a-f]{64}$/.test(appr.shownSha256));
});

// ---- what the stop computes: dependency order, the grant split, admission against the limits, the audit inputs of a node below the root
import { dependencyOrder, treeInputsFor } from '../src/tree-frontier.js';
import { block3, planWith } from './helpers/split-fixture.js';

test('dependencyOrder: providers before consumers, then the block\'s own order (a consumer listed BEFORE its provider still comes after it)', () => {
  const block = block3();
  assert.deepEqual(dependencyOrder('R', block).map(c => c.id), ['K1', 'K2', 'K3']);
  block.children = [block.children[1], block.children[2], block.children[0]];                 // K2 (expects from K1), K3, K1
  assert.deepEqual(dependencyOrder('R', block).map(c => c.id), ['K3', 'K1', 'K2'], 'the block order among the children that are ready: K2 waits for its provider K1 (listed last), K3 is independent and comes first, then K1, then K2');
});

test('approve: with a root cap far above the chain\'s at-most, each grant is the chain\'s at-most (the ceiling) and none is flagged "may stop" in the data - but the TEXT says "possibly" for each (C&C 12 Oct, rulings row 126: a grant equal to the ceiling is not a promise to finish); with 3 equal shares below it, each is flagged "yes"', async () => {
  // CHANGED ACCEPTED TEST (money-test conversion, lane C (drafted by lane B, reviewed by C), 24 Okt 2026; C&C ruling (c); the full suite on fad02049 listed it as #3818). OLD: the figures were typed (44.45 per child, "$133.35") and the pools were 300 and 100. NEW: the figures are mock-budget's own dry-run figures,
  // the pools are functions of them (a share of twice the at-most: "far above"; a share half way between the cheapest end and the at-most: "tight"), and the screen is asserted to show 3 x the figure. WHY: recording the drafted words moves the estimate (44.45 -> 45.75), so a typed number fails on every wording change.
  const fig = mockBudgetFigures(); const at = fig.atMostUsd;
  const whole = ceilCents(at);      // a binding at-most is granted whole, rounded up to the cent (src/tree-budget.js proposeGrants), and the ceiling is the same figure (src/tree-frontier.js)
  const rich = await realRoot({ cap: capFor(2 * at, 3, SPLIT_ROOT_HANDOFF_USD) });
  const d = describeFrontier({ rootDir: rich.t.rootDir, work: rich.t.work, pending: findPendingFrontier({ rootDir: rich.t.rootDir }) });
  assert.deepEqual(d.view.children.map(c => [c.grant, c.ceiling, c.mayStop]), [[whole, whole, false], [whole, whole, false], [whole, whole, false]]);      // each share of the pool is twice the chain's at-most figure, so each grant is capped at it
  const text = renderFrontierText(d.view);
  assert.match(text, new RegExp(`Approving authorizes up to \\$${(3 * whole).toFixed(2).replace('.', '\\.')} of new paid runs`));       // three grants of the at-most figure
  // this assertion FLIPPED by C&C's ruling (it was `includes('May stop before finishing') === false`): at grant == ceiling the line prints, as "possibly", once per child, and never as "yes"
  assert.equal((text.match(/May stop before finishing: possibly \(the grant equals the chain's upper estimate/g) || []).length, 3);
  assert.equal(text.includes('May stop before finishing: yes'), false);
  const tight = await realRoot({ cap: capFor(ceilCents((fig.cheapestUsd + at) / 2), 3, SPLIT_ROOT_HANDOFF_USD) });      // a share half way between the cheapest end and the at-most figure: admitted, and below the ceiling
  const t2 = describeFrontier({ rootDir: tight.t.rootDir, work: tight.t.work, pending: findPendingFrontier({ rootDir: tight.t.rootDir }) });
  assert.deepEqual(t2.view.children.map(c => c.mayStop), [true, true, true]);
  const tightText = renderFrontierText(t2.view);
  assert.equal((tightText.match(/May stop before finishing: yes \(the grant is below/g) || []).length, 3); assert.equal(tightText.includes('possibly'), false, 'below the ceiling the old line, not the new one');
});

test('approve: a limit that bites is shown and bound: with 2 children per split allowed the third child is "not admitted: fan-out limit" with no grant, the total counts only the admitted two, and the preview carries the refusal', async () => {
  // CHANGED ACCEPTED TEST (money-test conversion, lane C (drafted by lane B, reviewed by C), 24 Okt 2026; the full suite listed it as #3819): the pool is a function of mock-budget's at-most figure (a share of twice it for any number of admitted children), and the screen is asserted to show 2 x the figure. OLD: cap 100 and "$88.90".
  const at = mockBudgetFigures().atMostUsd; const whole = ceilCents(at);
  const r = await realRoot({ cap: capFor(2 * at, 3, SPLIT_ROOT_HANDOFF_USD), limits: { maxDepth: 2, maxRuns: 12, maxChildrenPerSplit: 2, attemptsPerChild: 1 } });
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  assert.deepEqual(d.view.children.map(c => [c.node, c.admitted, c.notAdmittedReason]), [['R/M1', true, null], ['R/M2', true, null], ['R/M3', false, 'not admitted: fan-out limit']]);
  const text = renderFrontierText(d.view);
  assert.match(text, /R\/M3 generation 1: not admitted: fan-out limit/); assert.match(text, /No grant \(not admitted\)/);
  assert.match(text, new RegExp(`Approving authorizes up to \\$${(2 * whole).toFixed(2).replace('.', '\\.')} of new paid runs`));   // two shares, each capped at the chain's at-most figure; the child that is not admitted does not dilute them
  assert.deepEqual(d.preview.children.map(c => [c.node, c.admitted, c.reason ?? null]), [['R/M1', true, null], ['R/M2', true, null], ['R/M3', false, 'not admitted: fan-out limit']]);
  // the money the bound hash covers: a child that is not admitted carries NO cap (mutation C14 showed its ceiling instead and stayed green), and an admitted one carries its grant (so a bug that zeroes every cap is red too)
  assert.equal(d.preview.children.find(c => c.node === 'R/M3').capUsd, 0, 'a child that is not admitted has no money cap in the preview');
  assert.ok(d.preview.children.filter(c => c.admitted).every(c => c.capUsd > 0), 'an admitted child has its grant');
  assert.ok(d.preview.children.find(c => c.node === 'R/M3').ceilingUsd > 0, 'the control: the not-admitted child does have a ceiling, so "no cap" is not "no figures at all"');
  assert.deepEqual(d.view.limits.map(l => [l.limit, l.count, l.effective]), [['runs', 1, 12], ['depth', 1, 2], ['children per split', 2, 2]]);
});

test('approve: if the record says a DIFFERENT block was verified than the one the plan holds now, the frontier is refused as split_changed (item 3), not shown (mutation C18 was green: the run files are guarded by `contract check` first, so an edited plan stops at item 2; this branch is the record-vs-plan check)', async () => {
  const r = await realRoot();
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.equal(describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending }).refusal, undefined, 'the control: the verified block is described');
  // M5f (a): the record never holds two split_verified for one node, so a SECOND one is refused; the record-vs-plan mismatch is built by rewriting the one the record holds (a hand-edited record: this branch is defence in depth)
  assert.throws(() => appendTreeEvent(r.t.rootDir, { event: 'split_verified', node: 'R', generation: 1, runId: ROOT_ID, splitSha256: 'ab'.repeat(32), children: ['R/M1', 'R/M2', 'R/M3'] }), /already has a verified split/);   // `children` (S8 held state): the shape of the real record's event (block3: three children); the refusal is the duplicate
  const file = join(treeDirOf(r.t.rootDir), EVENTS_FILE);
  const lines = readFileSync(file, 'utf8').split('\n').map(l => (l.includes('"event":"split_verified"') ? l.replace(/"splitSha256":"[0-9a-f]{64}"/, `"splitSha256":"${'ab'.repeat(32)}"`) : l));
  writeFileSync(file, lines.join('\n'));                                                                                     // the record now names another block; the run's files are untouched, so items 1-2 pass
  const again = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.equal(again.splitSha256, 'ab'.repeat(32), 'the pending frontier carries the hash the record names');
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: again });
  assert.deepEqual([d.refusal?.item, d.refusal?.check, d.refusal?.field], [3, 'split_changed', 'splitSha256'], JSON.stringify(d.refusal));
  assert.equal(d.view, undefined, 'nothing is put to a person');
});

test('treeInputsFor: below the root, the ids of a node\'s own list that were `global` where they began, and the open questions of the milestones along its path (read from the ancestors\' verified blocks)', async () => {
  const r = await realRoot();
  const rec = { events: [{ event: 'node_registered', node: 'R/M2', generation: 1, obligations: { items: [{ id: 'C1', identity: { originClass: 'global' } }, { id: 'C2', identity: { originClass: 'delegated' } }, { id: 'C3', identity: null }] } }] };
  const st = { nodes: new Map([['R@g1', { node: 'R', generation: 1, runId: ROOT_ID }], ['R/M2@g1', { node: 'R/M2', generation: 1, runId: 'x' }]]) };
  const got = treeInputsFor({ record: rec, state: st, runsDir: r.t.runsDir, node: 'R/M2' });
  assert.deepEqual(got.inheritedGlobal, ['C1']);
  assert.deepEqual(got.ancestorQuestions, ['What does the web layer read from the store?'], 'the question of the milestone R/M2 answers, from R\'s block');
  assert.deepEqual(got.unreadable, []);
  assert.deepEqual(treeInputsFor({ record: rec, state: st, runsDir: r.t.runsDir, node: 'R' }), { inheritedGlobal: [], ancestorQuestions: [], unreadable: [] }, 'the root has no inherited items and no ancestors');
  const lost = treeInputsFor({ record: rec, state: { nodes: new Map([['R/M2@g1', { node: 'R/M2', generation: 1, runId: 'x' }]]) }, runsDir: r.t.runsDir, node: 'R/M2' });
  assert.deepEqual(lost.unreadable, ['R'], 'an ancestor that cannot be read is named, never skipped');
});
