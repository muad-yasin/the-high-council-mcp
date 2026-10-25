// 4.1 (C&C thcmcp-cd, 23 Okt 2026; lane E): a MIXED price-refusal stop (one seat's 404 names the max price, another's does not) names the cause per seat and recommends a raise for the
// recognised seats only. Before: one unrecognised seat made the whole stop "The cause has not been identified ... recommends nothing". A-DRAFT wording (the sentences these tests pin).
// The money half: nothing here writes a row or a limit (that stays closed by the stop record's `recognised`, pinned in MR-3 and price-raise), and no figure of the unrecognised seat reaches the raise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PriceRefused, priceRefusedWords, markSkippable, recommendationOf, refusedSet } from '../src/price-refused.js';
import { memberReasonLines } from '../src/tree-price-stop.js';
import { mayOffer } from '../src/price-raise.js';
import { SHIPPED_PRICES } from '../src/price-table.js';

const SAID = 'No endpoints found that satisfy the max price for this request';
const mk = (seat, over = {}) => new PriceRefused({ seat, label: 'panel-1-orx', pin: { prompt: 0.4, completion: 1.6 }, row: { in: 0.4, out: 1.6 }, said: SAID, recognised: true, lab: 'orx', ...over });
const R_SEAT = 'openrouter/qwen/qwen3.7-plus'; const U_SEAT = 'openrouter/other/model';
// U has a table row and no own pin of its own on purpose: if the partition were left out, its row would reach the example and the table-price line (so the safety asserts below can fail).
const mixed = (rOver = {}, uOver = {}) => { const a = mk(R_SEAT, rOver); a.also = [mk(U_SEAT, { recognised: false, said: 'Model not found', row: { in: 2, out: 6 }, pin: { prompt: 2, completion: 6 }, ...uOver })]; return a; };
const skippable = err => { for (const e of [err, ...err.also]) markSkippable(e, { voices: 4, lab: 'orx' }); return err; };
// the lines that may name the unrecognised seat: the first line, its quote, its own paragraph, and the continue line
const mayNameU = l => /^(OpenRouter refused the calls|openrouter\/other\/model: OpenRouter said|OpenRouter's answers? for openrouter\/other\/model|After you fix the cause for openrouter\/other\/model)/.test(l);

test('MIX-1: a mixed stop names the cause per seat; the unrecognised seat keeps "recommends nothing" and its own limit', () => {
  const lines = priceRefusedWords(mixed(), { runPath: 'runs/R1' }).split('\n');
  assert.ok(lines[0].includes(`with HTTP 404: ${R_SEAT}, ${U_SEAT}. For ${R_SEAT} the answer names the max price; for ${U_SEAT} the cause has not been identified. `));
  assert.ok(!/ The cause has not been identified\./.test(lines[0]), 'no blanket "The cause has not been identified." sentence');
  const u = lines.find(l => l.startsWith("OpenRouter's answer for "));
  assert.equal(u, `OpenRouter's answer for ${U_SEAT} does not say the price is the problem, so this program does not know the cause for that seat and recommends nothing for it. The price limit sent: ${U_SEAT}: $2 in / $6 out per million tokens.`);
  assert.ok(lines.some(l => l.startsWith('Every OpenRouter call carries a price limit') && l.includes(`${R_SEAT}: $0.4 in / $1.6 out`) && l.includes(`found no host for ${R_SEAT} at or under that price`)));
});

test('MIX-2 (safety): nothing of the unrecognised seat reaches the raise: not the example, not the table price, not "no host", not the recommendation', () => {
  const text = priceRefusedWords(mixed(), { runPath: 'runs/R1' });
  const lines = text.split('\n');
  const m = text.match(/for example (\{.*?\}) \(US dollars/);
  assert.ok(m, 'a copyable example exists for the recognised seat');
  assert.deepEqual(Object.keys(JSON.parse(m[1])), [R_SEAT], 'only the recognised seat is in the copyable example');
  // the money half for this very shape: the terminal offer to write a row stays closed for a mixed stop (the stop record says recognised:false)
  assert.equal(mayOffer({ set: refusedSet(mixed()), tty: true, adviceOn: false, member: false }).ok, false);
  assert.match(text, new RegExp(`Today's table price is ${R_SEAT.replace(/\//g, '\\/')}: \\$0\\.4 in / \\$1\\.6 out per million tokens; only a higher number`));
  const rest = lines.filter(l => !mayNameU(l));
  assert.ok(!rest.some(l => l.includes(U_SEAT)), `the unrecognised seat is named only where it may be: ${rest.filter(l => l.includes(U_SEAT)).map(l => l.slice(0, 60))}`);
  assert.ok(!/"in": 4\b|"out": 12\b/.test(text), 'no figure derived from the unrecognised seat row (twice 2 and 6)');
  assert.match(text, new RegExp(`Recommended: if you accept the higher price, raise ${R_SEAT.replace(/\//g, '\\/')} in a pricing\\.user\\.json row\\.`));
});

test('MIX-3: a mixed stop is never recommended a skip (a skip drops every refused seat, the unrecognised one too); the line is offered with the reason', () => {
  const err = skippable(mixed());
  assert.deepEqual(recommendationOf(err), { kind: 'row' });
  const text = priceRefusedWords(err, { runPath: 'runs/R1' });
  assert.ok(!text.includes('Recommended: skip'));
  assert.match(text, /\(Skipping is not recommended here: a skip drops all 2 refused seats, including openrouter\/other\/model, whose cause is not known\.\)/);
  assert.ok(!/--skip-seat drops/.test(text), 'the reason does not name the flag (a tree member reads this line next to "--skip-seat is not available")');
  assert.match(text, /\nOr skip all 2 refused seats for the rest of this run: council --resume runs\/R1 --skip-seat$/);
  // an all-unrecognised or all-recognised set is not touched by this: no recommendation / the existing skip recommendation
  const allU = skippable(mixed({ recognised: false, said: 'x' })); assert.deepEqual(recommendationOf(allU), { kind: 'none' });
  const allR = skippable(mixed({}, { recognised: true, said: SAID })); assert.deepEqual(recommendationOf(allR), { kind: 'skip' });
});

test('MIX-4: the continue lines name the cause to fix first; a tree member drops both (they begin as its filter expects); an advice call says it is not resumed', () => {
  const text = priceRefusedWords(skippable(mixed()), { runPath: 'runs/R1' });
  assert.match(text, /\nAfter you fix the cause for openrouter\/other\/model and raise openrouter\/qwen\/qwen3\.7-plus if you accept the higher price, continue with: council --resume runs\/R1\n/);
  const kept = memberReasonLines(text);
  assert.ok(!kept.some(l => /^(After you fix the cause|Or skip |Continue with: )/.test(l)), 'a tree member is resumed with `council tree resume`, so neither --resume line reaches it');
  assert.ok(kept.some(l => l.startsWith('Recommended: ')), 'the rest of the reason stays');
  const advice = priceRefusedWords(mixed(), { runPath: null });
  assert.match(advice, /An advice call is not resumed: after the row is in and the cause for openrouter\/other\/model is found, ask for a new quote\.$/);
  assert.ok(!advice.includes('--resume'));
});

test('MIX-5: a recognised OWN-pin seat among unrecognised ones is told to raise its own chain fields, by name; the other seat stays out', () => {
  const text = priceRefusedWords(mixed({ ownPin: true, ownFields: ['prompt'] }), { runPath: 'runs/R1' });
  assert.match(text, new RegExp(`Recommended: if you accept the higher price, raise ${R_SEAT.replace(/\//g, '\\/')} through the fields of the seat's own provider\\.max_price in your chain`));
  assert.ok(!/for example/.test(text), 'no pricing.user.json example for an own-pin seat');
  assert.ok(!text.split('\n').filter(l => !mayNameU(l)).some(l => l.includes(U_SEAT)));
});

test('MIX-6 (golden): sets that are all recognised or all unrecognised read exactly as before 4.1 (captured from 47c51621)', () => {
  // the fixture is the output as captured; its one date is the price table's "last compared" day, which a table refresh moves (a date in a test is never patched): ONLY the words "list on <date>" are swapped for the table's current day; every dollar figure and every other character is compared as captured
  const raw = readFileSync(new URL('./fixtures/price-refused-golden-47c51621.json', import.meta.url), 'utf8');
  const g = JSON.parse(raw.replaceAll("list on 2026-10-18", `list on ${SHIPPED_PRICES._openrouterCheckedAt ?? 'an unknown date'}`));
  const two = (over = {}, uOver = {}) => { const a = mk(R_SEAT, over); a.also = [mk(U_SEAT, { row: { in: 2, out: 6 }, pin: { prompt: 2, completion: 6 }, ...uOver })]; return a; };
  const allRec = two();
  const allUnrec = two({ recognised: false, said: 'Model not found' }, { recognised: false, said: 'x' });
  const own = mk('openrouter/table/model'); own.also = [mk('openrouter/own/model', { ownPin: true, ownFields: ['prompt'] })];
  assert.equal(priceRefusedWords(allRec, { runPath: 'runs/R1' }), g.allRec);
  assert.equal(priceRefusedWords(skippable(two()), { runPath: 'runs/R1' }), g.allRecSkippable);
  assert.equal(priceRefusedWords(allRec, { runPath: null }), g.allRecAdvice);
  assert.equal(priceRefusedWords(allUnrec, { runPath: 'runs/R1' }), g.allUnrec);
  assert.equal(priceRefusedWords(skippable(two({ recognised: false, said: 'Model not found' }, { recognised: false, said: 'x' })), { runPath: 'runs/R1' }), g.allUnrecSkippable);
  assert.equal(priceRefusedWords(own, { runPath: 'runs/R1' }), g.ownPlusTable);
  assert.equal(priceRefusedWords(mk(R_SEAT), { runPath: 'runs/R1' }), g.singleRec);
  assert.equal(priceRefusedWords(mk(R_SEAT, { recognised: false, said: 'Model not found' }), { runPath: null }), g.singleUnrec);
});
