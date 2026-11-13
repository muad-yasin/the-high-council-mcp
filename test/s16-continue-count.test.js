// 0.8.4 S16 (D part b; Q4(d), Q9(e), CA1; T13o T13r T21an T21ax T4l T4m): c_u = 2, the handling session's continues at the stops for a seat that gave no usable reply (the layer-bound stop `unheard` and the final-read stop), counted in the run's choice entries by
// the actor they record; n_u counts every such continue, the person's included. Past the count the session may not continue on its own authority (a further continue reaches the person by step defer); before it, at the Q4(d) corner, the session's finish is
// refused too. These are the PURE parts (src/no-reply-continues.js and the words in src/stop-decision.js); the tool's wiring (src/mcp/stop-decide.js) calls them and is not driven here (named in the unit report).
import test from 'node:test';
import assert from 'node:assert/strict';
import { C_U, isNoReplyStop, noReplyContinues, sessionMayContinue, sessionFinishNeedsFinding, sessionChoicesAt } from '../src/no-reply-continues.js';
import { buildStopQuote, noReplyCountLines, thirdContinueRefusal, FINISH_NEEDS_FINDING_REFUSAL, NO_CHOOSER_REFUSAL, NO_CHOICE_LEFT_LINE } from '../src/stop-decision.js';
import { finalReadSessionRefusal } from '../src/overseer-rounds.js';

const unheard = (extra = {}) => ({ kind: 'layer_bound', why: 'unheard', layer: 1, overseer_round: 1, pass: 3, ...extra });
const finalRead = (extra = {}) => ({ kind: 'layer_bound', why: 'final_read', top_layer: 3, layer: 3, overseer_round: 1, pass: 3, attempt: 0, ...extra });
const choice = (stop, actor, why = stop.why) => ({ stop: `s${Math.random()}`, choice: 'continue', kind: 'layer_bound', why, actor });
const session = (n, why) => Array.from({ length: n }, () => choice({ why }, 'handling_session', why));
const OBJ = [{ id: 'O-1', criterion: 'c', problem: 'p' }];

test('T13o, T13r: the session\'s continues count toward c_u = 2 across both kinds of stop; the person\'s own continue (a typed choice: actor unknown) counts in n_u and not in c_u', () => {
  assert.equal(C_U, 2);
  const made = [...session(1, 'unheard'), ...session(1, 'final_read'), choice({}, 'unknown', 'unheard'), { stop: 'x', choice: 'finish', kind: 'layer_bound', why: 'unheard', actor: 'handling_session' }, { stop: 'y', choice: 'continue', kind: 'overseer_cap', actor: 'handling_session' }];
  assert.deepEqual(noReplyContinues(made), { total: 3, bySession: 2, byPerson: 1 }, 'a finish and a continue at another kind of stop are not counted');
  assert.equal(sessionMayContinue(made), false);
  assert.equal(sessionMayContinue(session(1, 'unheard')), true);
  assert.deepEqual(noReplyContinues(undefined), { total: 0, bySession: 0, byPerson: 0 });
  assert.equal(isNoReplyStop(unheard()) && isNoReplyStop(finalRead()), true);
  assert.equal(isNoReplyStop({ kind: 'layer_bound', why: 'revisions' }) || isNoReplyStop({ kind: 'stall_stop' }), false);
});

test('T21an, T21ax, T4l: at the count the session is offered no continue on its own authority (the quote says finish only, and a further continue goes to the person by defer); the refusal says so', () => {
  const made = session(2, 'final_read');
  const at = sessionChoicesAt(finalRead(), made, null, ['continue', 'finish']);
  assert.deepEqual([at.choices, at.continueSpent], [['finish'], true]);
  assert.match(thirdContinueRefusal(true), /^You have already continued twice at stops where a seat gave no usable reply, which is as many as the handling session may decide on its own\. A further continue is the person's: .* step defer .* Finish stays open to you\. Nothing was recorded\.$/);
  assert.doesNotMatch(thirdContinueRefusal(false), /Finish stays open/, 'w35b: not said when finish is not among the choices');
  assert.match(thirdContinueRefusal(false), /say why\. Nothing was recorded\.$/);
  const before = sessionChoicesAt(finalRead(), session(1, 'final_read'), null, ['continue', 'finish']);
  assert.deepEqual([before.choices, before.continueSpent], [['continue', 'finish'], false]);
  const lines = noReplyCountLines(2, C_U);
  assert.equal(lines[0], 'Continues you have made at stops where a seat gave no usable reply: 2 of 2.');
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: a regex /...the person's decision .* step defer/. NEW: the whole sentence by value, "A further continue is the person's decision: if you and your advisor both find that it is, hand this stop to the person with step defer, and say why." WHY: the resolved text of the row (RESOLVED_LIST), src/stop-decision.js:137.
  assert.equal(lines[1], "That is as many as the handling session may decide on its own. A further continue is the person's decision: if you and your advisor both find that it is, hand this stop to the person with step defer, and say why.");
  assert.equal(noReplyCountLines(1, C_U).length, 1);
});

test('T4m: before the count, at the Q4(d) corner (layer 1, a silent seat, an objection standing), the session\'s finish is refused; with no objection standing it stays; when the list cannot be read the refusal applies (fail closed); a silent layer-2 seat keeps its finish; at the count it needs no finding', () => {
  assert.equal(sessionFinishNeedsFinding(unheard(), [], OBJ), true);
  assert.deepEqual(sessionChoicesAt(unheard(), [], OBJ, ['continue', 'finish']).choices, ['continue'], 'the quote offers what the answer accepts'  );
  assert.deepEqual(sessionChoicesAt(unheard(), session(2, 'unheard'), OBJ, ['continue', 'finish']).choices, ['finish']);
  assert.equal(sessionFinishNeedsFinding(unheard(), [], []), false, 'no objection stands: nothing is not_debated');
  assert.equal(sessionFinishNeedsFinding(unheard(), [], null), true, 'unreadable: fail closed');
  assert.equal(sessionFinishNeedsFinding(unheard({ layer: 2 }), [], OBJ), false);
  assert.equal(sessionFinishNeedsFinding(unheard(), session(2, 'unheard'), OBJ), false, 'T4k: at the count the finish needs no finding');
  assert.equal(sessionFinishNeedsFinding(finalRead(), [], OBJ), false, 'T21au: the final-read stop offers all its choices');
  assert.match(FINISH_NEEDS_FINDING_REFUSAL, /^You may not end this run on your own at this stop until you have made two continues at stops of this kind in this run\. .* step defer .* Nothing was recorded\.$/);
});

test('the final-read stop\'s choices: finish only while the one read before a finish is unused; with neither choice left the quote says none and sends the session to defer', () => {
  const used = sessionChoicesAt(finalRead({ finish_read_used: true }), [], null, ['continue', 'finish']);
  assert.deepEqual(used.choices, ['continue']);
  const none = sessionChoicesAt(finalRead({ finish_read_used: true }), session(2, 'final_read'), null, ['continue', 'finish']);
  assert.deepEqual(none.choices, []);
  const q = buildStopQuote({ stopId: 's', stopSentence: 'x', choices: none.choices, extraLines: [NO_CHOICE_LEFT_LINE] });
  assert.match(q.body, /\nChoices: none\.\n/);
  assert.ok(q.body.includes('You have no choice left at this stop on your own authority: hand it to the person with step defer.'));
  assert.match(buildStopQuote({ stopId: 's', stopSentence: 'x' }).body, /\nChoices: continue \| finish\.\n/, 'every other stop keeps its line');
  assert.equal(NO_CHOOSER_REFUSAL, 'This run is paused with no handling session, so nobody is named to choose here. Nothing was recorded.');
});

test('T21av (session form): a finish that ended nothing is answered, at the next quote, with the choices named as choices; the first request says the read ran, a repeat says none was made', () => {
  const ran = finalReadSessionRefusal(finalRead({ finish_read_used: true, finish_refused: 'ran' }), 0);
  assert.match(ran, /^The choice finish did not end the run: the final read ran once more and no seat of layer 3 gave a usable reply, so nobody has read the final plan\. .* What remains: the choice continue \(layer 3 reads the final plan once more\), the choice finish_now on the person's own words \(the run ends now with the verdict the panel had before the read, and layer 3 did not read the final plan\), or leaving the run stopped while the draft is revised outside the Council\. Spent so far: \$0\.00\.$/);
  const again = finalReadSessionRefusal(finalRead({ finish_read_used: true, finish_refused: 'repeat' }));
  assert.match(again, /No further read was made for this request: only the choice continue reads again\..*Nothing was run and nothing was spent\.$/);
  assert.equal(finalReadSessionRefusal(finalRead()), null);
  assert.equal(finalReadSessionRefusal(unheard()), null);
});
