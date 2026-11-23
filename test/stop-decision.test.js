// 0.8.4 D5a (plan A T4.3, T4.2): the pure parts of the MCP tool `stop_decide` (src/stop-decision.js): which stops the session may decide, the quote and its hash, the checks of what the session writes, the numbered record,
// and the fields the record adds to the choice entry. Offline, $0, no file system.
import test from 'node:test';
import assert from 'node:assert/strict';
// a guarded import: on a tree without the module (the red tree of the unit) each row fails by name, not one load failure for the file
const { SESSION_CHOICES, buildStopQuote, checkSessionFields, chooserOf, classifyStop, climbFigures, climbLine, cliChoiceFields, entryFieldsOf, nextQuoteNumber, personStopRefusal, quoteFileName, staleHashRefusal } = await import('../src/stop-decision.js').catch(() => ({}));

const ROUND = { status: 'awaiting_choice', marker: { stoppedBy: 'overseer_cap' } };
const FIELDS = { reason: 'The remaining objection is a fact the record settles, not a preference.', advisor: 'consulted', advisor_said: 'Agreed: continue.' };

test('SD-1 the session decides a stop at the overseer-round cap and at a layer\'s revision bound; only those two', () => {
  assert.deepEqual(classifyStop(ROUND), { ok: true });
  assert.deepEqual(classifyStop({ status: 'awaiting_choice', marker: { stoppedBy: 'layer_bound' } }), { ok: true });
  assert.deepEqual(SESSION_CHOICES, ['continue', 'finish'], 'reopen is not offered, a conflict\'s prevail is answered at the terminal');
});

test('SD-2c (the secret refusal, both forms): with the marker the sentence names STOPPED-secret.md; with only the record it names secret-stop.json and the terminal command and never the marker', () => {
  const withMarker = classifyStop({ status: 'paused_secret', run: 'r1' }).refusal; const recordOnly = classifyStop({ status: 'paused_secret', secretMarker: false, run: 'r1' }).refusal;
  assert.match(withMarker, /the commands are in STOPPED-secret\.md in runs\/r1/);
  assert.match(recordOnly, /secret-stop\.json in runs\/r1\) without the marker that goes with it, so it is probably a leftover and no pause waits/); assert.match(recordOnly, /A resume of the run \(resume_run, or at a terminal\) treats the record as nothing and removes it with the run's other stop files once it goes on past the limit screen or ends the run on a recorded finish; a resume that stops at the limit screen leaves it in place\./);   // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: `...that goes on past the limit screen, or ends the run on a recorded finish, treats the record as nothing and removes it with the run's other stop files; a resume that stops...`. NEW: `A resume of the run (resume_run, or at a terminal) treats the record as nothing and removes it with the run's other stop files once it goes on past the limit screen or ends the run on a recorded finish; a resume that stops at the limit screen leaves it in place.` WHY: the reviewed row of src/stop-decision.js:60 (the apply, commit 1). assert.doesNotMatch(recordOnly, /STOPPED-secret\.md/);
});

test('SD-2b (a spending stop with no other marker is quoted, the person\'s alone): classifyStop admits it as a budget stop; beside another marker, or as a start waiting for its first limit, it is refused', () => {
  assert.deepEqual(classifyStop({ status: 'budget_stopped', marker: null }), { ok: true, budget: true });
  assert.equal(classifyStop({ status: 'budget_stopped', marker: { stoppedBy: 'owner_pause' } }).code, 'spending_limit');
  assert.equal(classifyStop({ status: 'awaiting_user_cap', marker: null }).code, 'spending_limit');
});

test('SD-2 every other stop is refused with whose it is, and nothing else: a conflict, the spending limit (both of its states), a scan hit, the hard stop, a tree member, a run that is not stopped at a choice', () => {
  const cases = [
    [{ status: 'awaiting_choice', marker: { stoppedBy: 'conflict' } }, 'conflict', /conflict between objections.*--prevail/],
    // CHANGED ACCEPTED (0.8.4 relay of --finish-now at a spending stop): OLD bar: a run stopped at its spending limit with NO other marker was refused (spending_limit). NEW: it is quoted through the person-only stop gate (see the row below); the refusal stays for a spending stop BESIDE another stop's marker and for the start that waits for its first limit.
    [{ status: 'budget_stopped', marker: { stoppedBy: 'overseer_cap' } }, 'spending_limit', /the person's \(the spending limit\).*resume_run with max_usd and their own words in person_words/],
    [{ status: 'awaiting_user_cap', marker: null }, 'spending_limit', /the spending limit/],
    [{ status: 'awaiting_choice', marker: { stoppedBy: 'person_hard_stop' } }, 'person_stop', /the hard stop at seven overseer rounds/],
    [{ status: 'awaiting_choice', marker: { stoppedBy: 'key_shape' } }, 'person_stop', /a scan hit/],
    [{ ...ROUND, member: true }, 'tree_member', /member of a recursive-councils tree/],
    [{ status: 'running', marker: null }, 'not_a_choice_stop', /state is "running"/],
    [{ status: 'awaiting_choice', marker: null }, 'not_a_choice_stop', /not stopped at a choice/],
  ];
  for (const [input, code, re] of cases) {
    const got = classifyStop(input);
    assert.equal(got.ok, false, JSON.stringify(input));
    assert.equal(got.code, code, JSON.stringify(input));
    assert.match(got.refusal, re, JSON.stringify(input));
    assert.match(got.refusal, /Nothing was recorded\./);
  }
});

test('SD-3 an approval of excerpts is checked FIRST: a run with an excerpt gate AND a round stop is refused as the person\'s, with the gate\'s own words per status (the terminal command only for a gate that waits)', () => {
  const command = w => `council gate answer runs/r ${w.gate}`;
  const pending = classifyStop({ ...ROUND, awaiting: { gate: 'g1', status: 'pending' }, command });
  assert.deepEqual([pending.ok, pending.code], [false, 'excerpt_approval']);
  assert.match(pending.refusal, /^This stop is the person's \(an approval of excerpts of their project; the run is stopped at it\)\. It waits for a person's answers\. Only a person answers it, at a terminal with `council gate answer runs\/r g1`; this tool cannot\./);
  const answered = classifyStop({ ...ROUND, awaiting: { gate: 'g1', status: 'approved' }, command });
  assert.doesNotMatch(answered.refusal, /gate answer/, 'a gate with its answer has no instruction to answer it');
  assert.match(answered.refusal, /not applied yet/);
});

test('SD-4 the quote is deterministic, its hash covers the text above its last line, and any change of the run\'s state changes the hash (a stale answer is caught by rebuilding)', () => {
  const base = { stopId: 'overseer_cap:2:2', stopSentence: 'THE RUN STOPPED, NOT AGREED.', objections: [{ id: 'O-1', criterion: 'C1 '.repeat(40), problem: 'p' }], made: [], plan: { name: 'deliverable-partial.md', sha256: 'a'.repeat(64) } };
  const q = buildStopQuote(base);
  assert.deepEqual(buildStopQuote(base), q);
  assert.match(q.text, /^Stop overseer_cap:2:2: THE RUN STOPPED, NOT AGREED\.\nChoices: continue \| finish\.\n/);
  assert.match(q.text, /Open objections a finish would hand over \(read from the last critique/);
  assert.match(q.text, /\nO-1: C1 C1 .{0,80}…: p\n/, 'the criterion is cut at 80 characters');
  assert.match(q.text, /\nChoices already made in this run: none\.\nThe plan: deliverable-partial.md, sha256 a{64}\.\n/);
  assert.match(q.text, new RegExp(`\\nsha256 of the text above: ${q.sha256}\\. Pass this hash back with your answer in step 'answer'; an answer with another hash is refused\\.$`));
  assert.equal(q.text.startsWith(q.body), true);
  assert.notEqual(buildStopQuote({ ...base, objections: [] }).sha256, q.sha256);
  assert.notEqual(buildStopQuote({ ...base, plan: { name: 'deliverable-partial.md', sha256: 'b'.repeat(64) } }).sha256, q.sha256);
  assert.notEqual(buildStopQuote({ ...base, made: [{ stop: 'x:1:1', choice: 'continue', actor: 'unknown', channel: 'cli', at: 't' }] }).sha256, q.sha256);
  assert.match(buildStopQuote({ ...base, objections: null }).text, /not read \(the stopped run's last critique cannot be read\)/, 'an unreadable list says so, it is never an empty one');
  assert.match(buildStopQuote({ ...base, plan: null }).text, /The plan: no draft file is in the run folder\./);
  assert.match(staleHashRefusal('abc', q.sha256), new RegExp(`^This answer carries hash abc, but the stop's text now has hash ${q.sha256}: the stop changed after your quote\\. Call step 'quote' again.*Nothing was recorded\\.$`));
});

test('SD-5 the five chooser values, from the fields an entry carries (a choice without them was typed at the terminal)', () => {
  assert.equal(chooserOf({ actor: 'person' }), 'the person');
  assert.equal(chooserOf({ actor: 'handling_session', advisor: 'consulted' }), 'the handling session, with its advisor');
  assert.equal(chooserOf({ actor: 'handling_session', advisor: 'none' }), 'the handling session, without an advisor');
  assert.equal(chooserOf({ actor: 'handling_session', advisor: 'unavailable' }), 'the handling session, without an advisor');
  assert.equal(chooserOf({ actor: 'handling_session', advisor: 'consulted', over_disagreement: true }), "the handling session, its advisor disagreeing on whether this was the person's");
  assert.equal(chooserOf({ actor: 'unknown', channel: 'cli' }), 'a choice typed at the terminal');
  assert.equal(chooserOf({}), 'a choice typed at the terminal', 'an entry from before 0.8.4 has no fields');
  const q = buildStopQuote({ stopId: 's', stopSentence: 'x', made: [{ stop: 'overseer_cap:2:2', choice: 'continue', actor: 'handling_session', advisor: 'consulted', at: '2026-11-04T10:00:00.000Z' }, { stop: 'overseer_cap:3:3', choice: 'finish' }] });
  assert.match(q.text, /\nChoices already made in this run:\noverseer_cap:2:2: continue by the handling session, with its advisor, 2026-11-04T10:00:00\.000Z\.\noverseer_cap:3:3: finish by a choice typed at the terminal, no time recorded\.\n/);
  assert.deepEqual(cliChoiceFields('t'), { actor: 'unknown', channel: 'cli', at: 't' });
});

test('SD-6 what the session writes: a reason is required, the advisor state is one of three, advisor_said only with an advisor that answered, sizes and control characters are refused; each refusal says nothing was recorded', () => {
  assert.deepEqual(checkSessionFields(FIELDS), { ok: true, fields: { reason: FIELDS.reason, advisor: 'consulted', advisor_said: 'Agreed: continue.' } });
  assert.deepEqual(checkSessionFields({ reason: ' r ', advisor: 'none' }), { ok: true, fields: { reason: 'r', advisor: 'none', advisor_said: '' } });
  const bad = [
    [{ ...FIELDS, reason: '' }, /reason is missing/], [{ ...FIELDS, reason: undefined }, /reason is missing/], [{ ...FIELDS, reason: 'x'.repeat(1201) }, /at most 1200/],
    [{ ...FIELDS, advisor: 'yes' }, /advisor must be one of consulted, none, unavailable/], [{ ...FIELDS, advisor_said: '' }, /advisor_said is missing/],
    [{ ...FIELDS, advisor: 'none' }, /only for an advisor that answered/], [{ ...FIELDS, advisor_said: 'y'.repeat(901) }, /at most 900/],
    [{ ...FIELDS, reason: 'a‮b' }, /control or direction characters/], [{ ...FIELDS, advisor_said: 'a\u0007' }, /control or direction characters/],
  ];
  for (const [input, re] of bad) {
    const got = checkSessionFields(input);
    assert.equal(got.ok, false, JSON.stringify(input).slice(0, 80));
    assert.match(got.refusal, re);
    assert.match(got.refusal, /Nothing was recorded\.$/);
  }
});

test('SD-7 the quote is kept as a numbered file (the gate\'s text), and the fields the answered gate adds to the choice entry are the gate\'s own, with its id', () => {
  assert.equal(quoteFileName(1), 'stop-quote-0001.md');
  assert.equal(nextQuoteNumber(['run.json', 'stop-quote-0001.md', 'stop-quote-0007.md', 'stop-quote-x.md']), 8);
  assert.equal(nextQuoteNumber([]), 1);
  const person_test = { session: { person: 'no', unsettled_by_record: false, preference: false, reason: 'The record settles it.' }, advisor: { person: 'no', unsettled_by_record: false, preference: false, reason: 'Agreed: a fact.' } };
  const gate = { gate: 'g3', actor: 'handling_session', channel: 'session', at: 't', reason: FIELDS.reason, advisor: 'consulted', advisor_said: 'Agreed: continue.', person_test, over_disagreement: false };
  assert.deepEqual(entryFieldsOf(gate), { actor: 'handling_session', channel: 'session', at: 't', reason: FIELDS.reason, advisor: 'consulted', advisor_said: 'Agreed: continue.', person_test, over_disagreement: false, gate: 'g3' });
});

const ST = (label, usd, priced = true) => ({ label, usd, priced, provider: 'p', model: 'm' });
const LAYER = (round, layer, overseer_round) => ({ round, layer, overseer_round, labs: ['a'], state: 'objected' });
// two overseer rounds; the second one (the stopped one) took TWO passes (3 and 4) and ran a layer exchange (ldebate/lreply) in each
const PARTIAL = {
  layers: [LAYER(1, 1, 1), LAYER(2, 2, 1), LAYER(3, 1, 2), LAYER(4, 2, 2)],
  stages: [ST('build', 0.4), ST('panel-1-l1', 0.3), ST('revise-1', 0.5), ST('panel-2-l2', 0.35), ST('panel-3-l1', 0.45), ST('ldebate-3-l1', 0.1), ST('lreply-3-l1', 0.05), ST('revise-3', 0.2), ST('panel-4-l2', 0.4), ST('ldebate-4-l2', 0.15), ST('revise-4', 0.25)],
};
const STOP = { kind: 'overseer_cap', overseer_round: 2, pass: 4 };
const SPENT = { usd: 4.5, unknownFigures: 0 };

test('SD-8 the money figures of the stop are MEASURED from the run itself: the counted amount (the run\'s own figure), what the limit on record leaves, and what the last COMPLETED CLIMB cost: every stage of the passes of the stopped overseer round, exchange stages included; anything that cannot be placed or priced is "not known", never an assumption', () => {
  const all = round => Math.round(round * 1e6) / 1e6;
  assert.deepEqual(climbFigures({ partial: PARTIAL, spent: SPENT, capUsd: 7, stop: STOP }), { counted: 4.5, left: 2.5, climb: all(0.45 + 0.1 + 0.05 + 0.2 + 0.4 + 0.15 + 0.25) }, 'passes 3 and 4 (one overseer round), panel + exchange + revise stages; round 1 and 2 are not part of it');
  assert.equal(climbFigures({ partial: PARTIAL, spent: SPENT, capUsd: 7, stop: STOP }).climb, 1.6);
  assert.equal(climbFigures({ partial: PARTIAL, spent: SPENT, capUsd: 7, stop: { ...STOP, overseer_round: 1 } }).climb, 1.15, 'the stop of round 1: passes 1 and 2');
  assert.deepEqual(climbFigures({ partial: PARTIAL, spent: SPENT, capUsd: 7, stop: { kind: 'layer_bound', why: 'revisions', layer: 1, overseer_round: 2, pass: 3 } }), { counted: 4.5, left: 2.5, climb: null }, 'a stop at a layer\'s revision bound: a continue is not a climb, so no climb figure');
  assert.deepEqual(climbFigures({ partial: PARTIAL, spent: SPENT, capUsd: 3, stop: STOP }).left, 0, 'a limit already passed leaves nothing, never a negative figure');
  assert.equal(climbFigures({ partial: PARTIAL, spent: SPENT, capUsd: null, stop: STOP }).left, null, 'no limit on record: the limit left is not known');
  assert.equal(climbFigures({ partial: PARTIAL, spent: { usd: 4.5, unknownFigures: 2 }, capUsd: 7, stop: STOP }).counted, null, 'a part of the run\'s own figure did not read: not known');
  assert.equal(climbFigures({ partial: PARTIAL, spent: null, capUsd: 7, stop: STOP }).counted, null);
  const unpriced = PARTIAL.stages.map(st => (st.label === 'ldebate-4-l2' ? { ...st, priced: false } : st));
  assert.equal(climbFigures({ partial: { ...PARTIAL, stages: unpriced }, spent: SPENT, capUsd: 7, stop: STOP }).climb, null, 'one unpriced stage of the climb: its cost is not known');
  const unplaced = [...PARTIAL.stages, ST('ldebate-L1-x', 0.1)];
  assert.equal(climbFigures({ partial: { ...PARTIAL, stages: unplaced }, spent: SPENT, capUsd: 7, stop: STOP }).climb, null, 'an exchange stage whose label does not name its pass cannot be placed: not known');
  assert.equal(climbFigures({ partial: { ...PARTIAL, layers: [] }, spent: SPENT, capUsd: 7, stop: STOP }).climb, null, 'layers that do not name the stopped round: not known');
  const unlayered = { stages: [ST('build', 0.4), ST('panel-1-a', 0.3), ST('revise-1', 0.2), ST('panel-2-a', 0.35), ST('panel-2-b', 0.25), ST('revise-2', 0.1)] };
  assert.equal(climbFigures({ partial: unlayered, spent: SPENT, capUsd: 7, stop: { kind: 'overseer_cap', overseer_round: 2, pass: 2 } }).climb, 0.7, 'an unlayered run has one pass per round: the last one');
  assert.equal(climbFigures({ partial: { stages: [ST('build', 0.4)] }, spent: SPENT, capUsd: 7, stop: STOP }).climb, null, 'no pass measured yet');
  assert.deepEqual(climbFigures({ partial: null, spent: null, capUsd: '7', stop: null }), { counted: null, left: null, climb: null }, 'text where a number belongs is not a number');
});

test('SD-9 the money line says each figure or "not known", and the quote places it between the choices already made and the plan; a quote without the figures has no such line', () => {
  assert.match(climbLine({ counted: 4.5, left: 2.5, climb: 1 }), /^Counted so far: \$4\.50\. Your limit leaves: \$2\.50\. One more climb is expected to cost: \$1\.00 \(what the last climb of this run cost\)\. In your reason, say whether the limit left covers it; if it does not, you may still continue, and the run stops at the limit for the person, with nothing lost\.$/);
  assert.match(climbLine({ counted: null, left: null, climb: null }), /^Counted so far: not known\. Your limit leaves: not known\. One more climb is expected to cost: not known \(no climb of this run was measured with every seat priced\)\. In your reason/);
  const base = { stopId: 'overseer_cap:2:2', stopSentence: 'x', made: [], plan: { name: 'deliverable-partial.md', sha256: 'a'.repeat(64) } };
  const withMoney = buildStopQuote({ ...base, money: { counted: 1, left: 2, climb: 0.5 } });
  assert.match(withMoney.text, /\nChoices already made in this run: none\.\nCounted so far: \$1\.00\. Your limit leaves: \$2\.00\. One more climb is expected to cost: \$0\.50 .*\nThe plan: deliverable-partial\.md/);
  assert.doesNotMatch(buildStopQuote(base).text, /Counted so far/);
  assert.notEqual(withMoney.sha256, buildStopQuote({ ...base, money: { counted: 1, left: 2, climb: 0.6 } }).sha256, 'a changed figure changes the hash an answer must send back');
});

test('SD-10 R396a, AMENDED by Muad 05 Nov 2026 ("1: a"): OLD the hard-stop quote named continue only and left out the block about what a finish hands over; NEW buildStopQuote takes the choices the stop offers and always keeps the block, so the hard stop lists continue AND finish for the person; WHY the hard stop now offers --finish too (with the line that the top layer did not sign off). The person-stop refusal has one source', () => {
  const base = { stopId: 'overseer_cap:7:7', stopSentence: 'THE RUN STOPPED, NOT AGREED.', objections: [{ id: 'O-1', criterion: 'C1', problem: 'p' }], made: [], plan: { name: 'deliverable-partial.md', sha256: 'a'.repeat(64) } };
  const both = buildStopQuote(base);
  assert.match(both.body, /\nChoices: continue \| finish\.\n.*Open objections a finish would hand over/s, 'the default is both choices and the block');
  const finishOnly = buildStopQuote({ ...base, choices: ['finish'] });
  assert.match(finishOnly.body, /^Stop overseer_cap:7:7: THE RUN STOPPED, NOT AGREED\.\nChoices: finish\.\nOpen objections a finish would hand over \(.*\):\nO-1: C1: p\nChoices already made in this run: none\.\nThe plan: deliverable-partial.md, sha256 a{64}\.$/s, 'a stop that offers finish only says so and keeps the block');
  assert.notEqual(finishOnly.sha256, both.sha256, 'the choices are part of the hashed text');
  assert.equal(buildStopQuote({ ...base, choices: ['continue', 'finish'] }).sha256, both.sha256);
  assert.equal(classifyStop({ status: 'awaiting_choice', marker: { stoppedBy: 'person_hard_stop' } }).refusal, personStopRefusal('person_hard_stop'));
  assert.equal(classifyStop({ status: 'awaiting_choice', marker: { stoppedBy: 'scan_hit' } }).refusal, personStopRefusal('scan_hit'));
  assert.match(personStopRefusal('person_hard_stop'), /^This stop is the person's \(the hard stop at seven overseer rounds\)\. .*Nothing was recorded\.$/);
});

test('SD-12 26b (R494): classifyStop learns stall_stop (S5): a stall the run waits at is a stop the session may decide; the same marker on a run that is not awaiting a choice is not; the excerpt approval still comes first', () => {
  assert.deepEqual(classifyStop({ status: 'awaiting_choice', marker: { stoppedBy: 'stall_stop' } }), { ok: true });
  assert.deepEqual(classifyStop({ status: 'awaiting_choice', marker: { stoppedBy: 'overseer_cap' } }), { ok: true });
  assert.equal(classifyStop({ status: 'finished', marker: { stoppedBy: 'stall_stop' } }).code, 'not_a_choice_stop');
  assert.equal(classifyStop({ status: 'awaiting_choice', marker: { stoppedBy: 'stall_stop' }, awaiting: { status: 'pending' } }).code, 'excerpt_approval');
  assert.equal(classifyStop({ status: 'awaiting_choice', marker: { stoppedBy: 'stall_stop' }, member: true }).code, 'tree_member');
});

test('SD-11 A-fix1: the session\'s text is held to the hidden-character module\'s checks, as the tool\'s own text check does, not to a list of this file: an invisible character beyond the old control and direction ones is refused; the quiet joiners (soft hyphen, a joiner inside an emoji), the emoji selector, a tab and a line break are not', () => {
  const cp = (...c) => String.fromCodePoint(...c);
  for (const c of [0x200B, 0x2060, 0x3164, 0x202E, 0x0007, 0x0085]) {
    for (const key of ['reason', 'advisor_said']) {
      const r = checkSessionFields({ ...FIELDS, [key]: `fine${cp(c)}text` });
      assert.equal(r.ok, false, `${key} with U+${c.toString(16).toUpperCase()}`);
      assert.match(r.refusal, /control or direction characters/);
    }
  }
  const plain = checkSessionFields({ ...FIELDS, reason: `First line.\n\tSecond line, a German soft${cp(0xAD)}hyphen, a ${cp(0x1F469, 0x200D, 0x1F4BB)} and a ${cp(0x2714, 0xFE0F)}.` });
  assert.equal(plain.ok, true, JSON.stringify(plain));
});

test('SD-13 26b (R515, C&C ruled money option (c), keyed on the STOP KIND): at a stall or a layer\'s revision bound the money line is TRUE: the counted amount and the limit, no climb clause (a continue there is not a climb), no false "no climb was measured" reason, and not the closing sentence that asks for a reason; the overseer-round cap below the hard stop keeps its line byte for byte (SD-9 is the pin)', () => {
  const figures = { counted: 4.5, left: 2.5, climb: null };
  for (const kind of ['stall_stop', 'layer_bound']) {
    for (const hard of [false, true]) {
      const line = climbLine({ ...figures, kind, hard });
      assert.equal(line, 'Counted so far: $4.50. Your limit leaves: $2.50.', `${kind} hard=${hard}`);
    }
  }
  assert.equal(climbLine({ counted: null, left: null, climb: null, kind: 'stall_stop' }), 'Counted so far: not known. Your limit leaves: not known.');
  const same = climbLine({ counted: 4.5, left: 2.5, climb: 1 });
  assert.equal(climbLine({ counted: 4.5, left: 2.5, climb: 1, kind: 'overseer_cap' }), same, 'the cap below the hard stop is unchanged');
  assert.match(climbLine({ counted: 4.5, left: 2.5, climb: null, kind: 'overseer_cap' }), /not known \(no climb of this run was measured with every seat priced\)\. In your reason/, 'D25: before the first climb the cap says so');
  const base = { stopId: 'stall_stop:0:3', stopSentence: 'X.', made: [], plan: null };
  const quote = buildStopQuote({ ...base, money: { ...figures, kind: 'stall_stop', hard: false } });
  assert.match(quote.body, /\nChoices already made in this run: none\.\nCounted so far: \$4\.50\. Your limit leaves: \$2\.50\.\nThe plan:/);
  assert.doesNotMatch(quote.body, /climb|In your reason/);
});

test('SD-14 26b (R515): at the HARD STOP of the overseer-round cap the closing sentence goes (the session cannot answer there) and the climb figure stays, because a continue there is a climb: measured or "not known" as at any cap; a hard stop that is a stall follows the stall rule', () => {
  assert.equal(climbLine({ counted: 4.5, left: 2.5, climb: 1, kind: 'overseer_cap', hard: true }), 'Counted so far: $4.50. Your limit leaves: $2.50. One more climb is expected to cost: $1.00 (what the last climb of this run cost).');
  assert.equal(climbLine({ counted: 4.5, left: 2.5, climb: null, kind: 'overseer_cap', hard: true }), 'Counted so far: $4.50. Your limit leaves: $2.50. One more climb is expected to cost: not known (no climb of this run was measured with every seat priced).');
  assert.doesNotMatch(climbLine({ counted: 1, left: 1, climb: 1, kind: 'overseer_cap', hard: true }), /In your reason/);
  assert.equal(climbLine({ counted: 4.5, left: 2.5, climb: 1, kind: 'stall_stop', hard: true }), 'Counted so far: $4.50. Your limit leaves: $2.50.', 'a stall that is the hard stop: the stall rule, no climb clause');
});
