// 0.8.3 Astra items 38 and 39 (C&C ruling 20 Okt: ONE rule for items 31-39): a tree member stopped by a price refusal says what its run's record knows. The kind (OpenRouter named the max price / a 404 in other words / no record) is read from
// report-partial.json beside the marker; the member's lines drop the run's own "--resume" and "--skip-seat" lines (neither works for a member). All $0. Rows: (K1) the kind is read from the record; (K2) the lines for each kind, built from the REAL
// sentence priceRefusedWords writes; (K3) the close screen's status line for each kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PriceRefused, markSkippable, priceRefusedWords } from '../src/price-refused.js';
import { priceStopKindOf, priceStopLines, priceStopStatus } from '../src/tree-price-stop.js';

const folder = stop => { const d = mkdtempSync(join(tmpdir(), 'price-stop-')); if (stop !== undefined) writeFileSync(join(d, 'report-partial.json'), JSON.stringify({ stop })); return d; };
const refused = recognised => new PriceRefused({ seat: 'openrouter/vendor/model', label: 'propose-glm', pin: { prompt: 0.66, completion: 1.98 }, status: 404, said: recognised ? 'No endpoints found that satisfy the max price for this request' : 'No endpoints found', recognised });
const reasonOf = recognised => priceRefusedWords(refused(recognised), { runPath: 'runs/r1', command: 'council' });

test('K1 the kind is read from the record the CLI wrote beside the marker; no record, no field or another stop reads unknown', { timeout: 60_000 }, () => {
  assert.equal(priceStopKindOf(folder({ kind: 'price_refused', recognised: true })), 'recognised');
  assert.equal(priceStopKindOf(folder({ kind: 'price_refused', recognised: false })), 'other');
  assert.equal(priceStopKindOf(folder({ kind: 'price_refused', recognised: true, ownPin: true })), 'recognised-own', 'a limit from the seat\'s own provider.max_price is its own kind');
  assert.equal(priceStopKindOf(folder({ kind: 'price_refused' })), 'unknown');
  assert.equal(priceStopKindOf(folder({ kind: 'round' , recognised: true })), 'unknown');
  assert.equal(priceStopKindOf(folder(undefined)), 'unknown');
});

test('K2 the lines for each kind: the run\'s own cause sentence stays, its resume and skip lines go, and the way on matches what is known', { timeout: 60_000 }, () => {
  const at = 'R/M1@g1';
  const rec = priceStopLines({ at, rootId: 'T', reason: reasonOf(true), kind: 'recognised' }).join('\n');
  assert.match(rec, /^R\/M1@g1 was stopped by a price refusal \(exit code 24\)\./); assert.match(rec, /was refused at the price (pin|limit)/);
  assert.match(rec, /To go on: raise the model's price in pricing\.user\.json in your project folder, then run `council tree resume T`/);
  const other = priceStopLines({ at, rootId: 'T', reason: reasonOf(false), kind: 'other' }).join('\n');
  assert.match(other, /The cause has not been identified/); assert.match(other, /To go on: fix the cause OpenRouter's answer points to, then run `council tree resume T`/);
  assert.doesNotMatch(other, /raise the model's price/);
  const unknown = priceStopLines({ at, rootId: 'T', reason: 'the seat has no price', kind: 'unknown' }).join('\n');
  assert.match(unknown, /if the provider's answer names the price, raise the model's price/);
  const own = priceStopLines({ at, rootId: 'T', reason: priceRefusedWords(Object.assign(refused(true), { ownPin: true }), { runPath: 'runs/r1', command: 'council' }), kind: 'recognised-own', chain: 'my-chain' }).join('\n');
  assert.match(own, /To go on: change the numbers of the seat's own provider\.max_price in the chain the tree uses \(nothing else in the chain; a pricing\.user\.json row does not change a field it sets\), run `council tree decide T --accept-chain-limits my-chain` at a terminal to see the old and the new limits and confirm them, then run `council tree resume T`/); assert.doesNotMatch(own, /raise the model's price in pricing\.user\.json|To use the copy with --resume/, 'a member is never told --resume or a row that changes nothing');
  assert.doesNotMatch(own, /<chain>/, 'no placeholder reaches a person');
  const unnamed = priceStopLines({ at, rootId: 'T', reason: 'x', kind: 'recognised-own' }).join('\n');   // red with src/tree-price-stop.js of 24da98f: a literal <chain> is printed
  assert.doesNotMatch(unnamed, /<chain>|<[a-z]+>|--accept-chain-limits/, 'where the chain is not known the accept step is left out, not printed with a placeholder');
  assert.match(unnamed, /a pricing\.user\.json row does not change a field it sets\), then run `council tree resume T`/);
  for (const text of [rec, other, unknown, own]) {
    assert.doesNotMatch(text, /Continue with:|Or skip |--resume runs\/|After you fix the cause/, 'nothing a standalone run does');
    assert.match(text, /`--skip-seat` is not available for a tree member/); assert.match(text, /may cost money/);
  }
});

test('K2b (BUG-C-046) a member whose refusal the run recommends SKIPPING is not told to skip: the "Recommended: skip" line goes, the cause, the raise-the-price way on and "--skip-seat is not available" stay', { timeout: 60_000 }, () => {
  const err = markSkippable(refused(true), { voices: 3 });       // the stage can do without the seat and three other seats stay: the run's own words recommend a skip
  const run = priceRefusedWords(err, { runPath: 'runs/r1', command: 'council' });
  assert.match(run, /^Recommended: skip this seat for the rest of this run\./m, 'the premise: a standalone run is recommended to skip');
  const text = priceStopLines({ at: 'R/M1@g1', rootId: 'T', reason: run, kind: 'recognised' }).join('\n');
  assert.doesNotMatch(text, /Recommended: skip|Skipping needs no price change|Or skip /, 'a member is not recommended an action it cannot take');
  assert.match(text, /was refused at the price (pin|limit)/); assert.match(text, /To go on: raise the model's price in pricing\.user\.json in your project folder, then run `council tree resume T`/);
  assert.match(text, /`--skip-seat` is not available for a tree member/);
  // the other recommendation (raise the price) is the run's own line and stays
  const row = priceStopLines({ at: 'R/M1@g1', rootId: 'T', reason: reasonOf(true), kind: 'recognised' }).join('\n');
  assert.match(row, /Recommended: if you accept the higher price/);
});

test('K3 the close screen\'s status line for each kind', { timeout: 60_000 }, () => {
  assert.match(priceStopStatus('recognised'), /^stopped by a price refusal \(raise the model's price in pricing\.user\.json, then resume\)$/);
  assert.equal(priceStopStatus('recognised-own', { rootId: 'T', chain: 'my-chain' }), "stopped by a price refusal (change the numbers of the seat's own provider.max_price in the chain, accept them with `council tree decide T --accept-chain-limits my-chain`, then resume)");
  assert.equal(priceStopStatus('recognised-own'), "stopped by a price refusal (change the numbers of the seat's own provider.max_price in the chain, then resume)", 'no root or no chain: no half command');
  assert.match(priceStopStatus('other'), /whose cause is not known for at least one seat/);   // 4.1: old bar /whose cause is not known/; the clause is true for a mixed stop (some seats name the price, some do not)
  assert.match(priceStopStatus('unknown'), /if it names the price/);
});
