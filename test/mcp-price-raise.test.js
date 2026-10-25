// 0.8.3 (Muad 21 Okt 2026): the session's route for a run a price refusal stopped. quote returns the user's text and a hash and writes nothing; confirm needs that hash and the user's words and writes the pricing.user.json row; nothing is spent by
// either. All $0, no network (the host list is injected). Rows: MR-1 quote; MR-2 confirm (wrong hash, changed price, no words, the good call); MR-3 the refusals; MR-4 a changed price row changes the spending-limit scope (so resume_run
// stops at the person's gate); MR-5 the tool is registered, classified and described; MR-6 a long yes still fits the row's 200-character note; MR-7 a credential-shaped reason is refused before anything is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { priceRaiseResult, PRICE_RAISE_DESCRIPTION } from '../src/mcp/price-raise.js';
import { writeStoppedMarker } from '../src/stop-files.js';
import { resetUserPrices, effectiveRow } from '../src/price-table.js';
import { acquireRunLock } from '../src/run-lock.js';
import { TOOL_TRUST } from '../src/mcp/untrusted.js';
import { buildStartScope } from '../src/start-scope.js';
import { hiddenIn } from '../src/hidden-chars.js';
import { capScopeSha256 } from '../src/gate.js';

const MODEL = 'meta-llama/llama-3.3-70b-instruct';
const SEAT = `openrouter/${MODEL}`;
const HEX = 'a'.repeat(64);
const hostList = (inP, outP, name = 'Dear') => async () => ({ ok: true, status: 200, json: async () => ({ data: { endpoints: [{ provider_name: name, pricing: { prompt: String(inP / 1e6), completion: String(outP / 1e6) }, status: 0, max_completion_tokens: 100000, supported_parameters: ['reasoning'] }] } }) });
const same = (a, b) => a === b;

function fixture({ meta = {}, stop = {}, marker = 'price_refused' } = {}) {
  resetUserPrices();
  const work = mkdtempSync(join(tmpdir(), 'mcp-price-raise-')); const runsDir = join(work, 'runs'); const run = '2026-10-21T10-00-00-000Z'; const dir = join(runsDir, run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'x', cwd: work, maxUsd: 7, ...meta }));
  if (marker) writeStoppedMarker(dir, { stoppedBy: marker, beforeFirstCall: false, spentUsd: 0, resumeAfterStop: true, reason: 'r' });
  writeFileSync(join(dir, 'report-partial.json'), JSON.stringify({ stop: { kind: 'price_refused', seat: SEAT, recognised: true, ownPin: false, ...stop } }));
  return { work, runsDir, run, dir };
}
const call = (fx, args, fetchImpl) => priceRaiseResult({ runsDir: fx.runsDir, work: fx.work, args: { run: fx.run, ...args }, sameFolder: same, fetchImpl, seatsOf: () => [{ provider: 'openrouter', model: MODEL, maxTokens: 64000, extra: { reasoning: { effort: 'high' } } }] });
const dearer = () => { const r = effectiveRow('openrouter', MODEL); return hostList(r.in * 2, r.out * 2); };

test('MR-1 quote returns the text for the user and its hash, and writes nothing', { timeout: 60_000 }, async () => {
  const fx = fixture();
  const q = await call(fx, { step: 'quote' }, dearer());
  assert.equal(q.step, 'quote'); assert.match(q.text, /was stopped because OpenRouter refused a seat at the price limit/); assert.match(q.text, /cheapest host Dear at/); assert.match(q.text, /Raising the price spends nothing by itself\./);
  assert.match(q.shown, /^[0-9a-f]{64}$/); assert.match(q.instruction, /only after the user has said yes in the chat/);
  assert.equal(existsSync(join(fx.work, 'pricing.user.json')), false);
});

test('MR-2 confirm: a wrong hash, a changed price and missing words are refused; the right call writes the row and says nothing was spent', { timeout: 60_000 }, async () => {
  const fx = fixture(); const f = dearer();
  const q = await call(fx, { step: 'quote' }, f);
  assert.match((await call(fx, { step: 'confirm', shown: 'f'.repeat(64), reason: 'yes please' }, f)).refusal, /has changed .* or is not the text you hold/);
  const r = effectiveRow('openrouter', MODEL);
  assert.match((await call(fx, { step: 'confirm', shown: q.shown, reason: 'yes please' }, hostList(r.in * 3, r.out * 3))).refusal, /has changed/);
  assert.match((await call(fx, { step: 'confirm', shown: q.shown }, f)).refusal, /needs the user's own yes in their words/);
  assert.equal(existsSync(join(fx.work, 'pricing.user.json')), false, 'nothing written by the refusals');
  const ok = await call(fx, { step: 'confirm', shown: q.shown, reason: 'Muad said yes in the chat' }, f);
  assert.equal(ok.step, 'confirm'); assert.match(ok.next, /Nothing was spent\. Call resume_run\(run\)/);
  const file = JSON.parse(readFileSync(join(fx.work, 'pricing.user.json'), 'utf8'));
  assert.equal(file[SEAT].in, r.in * 2); assert.match(file[SEAT].note, /raised by the session after the user's yes \("Muad said yes in the chat"\)/);
  resetUserPrices();
});

test('MR-3 refusals, each with words and nothing written: a tree member, a running run, a run not stopped by a price, an unrecognised refusal, a seat whose limit the chain sets, another start folder, a non-OpenRouter seat, a host not above the limit', { timeout: 60_000 }, async () => {
  const f = dearer();
  const cases = [
    [{ meta: { tree: { treeId: 't' } } }, /member of a recursive-councils tree.*tree_decide/],
    [{ marker: 'wall_clock' }, /not stopped by a price refusal/],
    [{ stop: { recognised: false } }, /answer for at least one refused seat does not name the price.*for the whole stop/],
    [{ stop: { ownPin: true } }, /changed in the chain, not in pricing\.user\.json/],
    [{ meta: { cwd: '/elsewhere' } }, /started in a different project folder/],
    [{ stop: { seat: 'anthropic/claude' } }, /only OpenRouter seats/],
  ];
  for (const [opts, re] of cases) { const fx = fixture(opts); const r = await call(fx, { step: 'quote' }, f); assert.match(r.refusal ?? '', re, JSON.stringify(opts)); assert.equal(existsSync(join(fx.work, 'pricing.user.json')), false); }
  const running = fixture(); acquireRunLock(running.dir);       // this very process holds it: alive
  assert.match((await call(running, { step: 'quote' }, f)).refusal, /still running/);
  const row = effectiveRow('openrouter', MODEL);
  const cheap = fixture(); assert.match((await call(cheap, { step: 'quote' }, hostList(row.in, row.out))).refusal, /at or under the price now in force for it/);
  const odd = fixture(); assert.match((await call(odd, { step: 'later' }, f)).refusal, /step is "quote" or "confirm"/);
});

test('MR-4 a changed pricing.user.json row changes the spending-limit scope, so resume_run stops at the person\'s limit gate (src/start-cap.js amend_scope)', { timeout: 60_000 }, () => {
  const base = { taskSha256: HEX, contextSha256: null, chainSha256: HEX, policySha256: null, sensitivityFloor: null, piiMode: null, seats: [{ role: 'critic', provider: 'openrouter', model: MODEL }] };
  const before = capScopeSha256(buildStartScope({ ...base, userPrices: [] }));
  const after = capScopeSha256(buildStartScope({ ...base, userPrices: [{ key: SEAT, file_in: 1, file_out: 2, effective_in: 1, effective_out: 2 }] }));
  assert.notEqual(before, after);
});

test('MR-5 the tool is classified as untrusted text and its description tells the session to show the user and get the yes first', { timeout: 60_000 }, () => {
  assert.deepEqual(TOOL_TRUST.price_raise, { wrap: 'fields', fields: ['text', 'refusal'] });
  assert.match(PRICE_RAISE_DESCRIPTION, /SHOW THE USER THE QUOTED TEXT AND GET THEIR YES IN THE CHAT BEFORE YOU CALL CONFIRM\. NEVER CONFIRM ON YOUR OWN/);
});

test('MR-6 the note fits pricing.user.json\'s 200-character bound whatever the user said: a long yes is cut with an ellipsis, never dropped and never refused (note wording A-DRAFT)', { timeout: 60_000 }, async () => {
  const row = effectiveRow('openrouter', MODEL);
  const yes = 'I have read the quoted text and I say yes to the higher price for this seat. '.repeat(2).trim();
  assert.ok(yes.length >= 105 && yes.length < 200, `fixture: a long yes (${yes.length} characters)`);
  const fx = fixture(); const f = hostList(row.in * 2, row.out * 2);
  const q = await call(fx, { step: 'quote' }, f);
  const ok = await call(fx, { step: 'confirm', shown: q.shown, reason: yes }, f);
  assert.equal(ok.step, 'confirm', ok.refusal);        // red at 8c71d2b: "note must be a string of at most 200 characters"
  const note = JSON.parse(readFileSync(join(fx.work, 'pricing.user.json'), 'utf8'))[SEAT].note;
  assert.ok(note.length <= 200, `${note.length} characters`);
  assert.match(note, /raised by the session after the user's yes \("I have read the quoted text and I say yes to the higher price.*…"\): cheapest host Dear /, 'the user\'s own words lead the note, cut with an ellipsis');
  resetUserPrices();
  // the largest inputs: a 200-character reason (the reason's own cut) and a 60-character host name (safeName's cut)
  const big = fixture(); const bf = hostList(row.in * 2, row.out * 2, 'H'.repeat(80));
  const bq = await call(big, { step: 'quote' }, bf);
  const bo = await call(big, { step: 'confirm', shown: bq.shown, reason: 'y'.repeat(250) }, bf);
  assert.equal(bo.step, 'confirm', bo.refusal);
  const bnote = JSON.parse(readFileSync(join(big.work, 'pricing.user.json'), 'utf8'))[SEAT].note;
  assert.ok(bnote.length <= 200, `${bnote.length} characters at the maximum inputs`);
  assert.match(bnote, new RegExp(`cheapest host ${'H'.repeat(60)} \\(`), 'the host name keeps its full 60 characters');
  assert.match(bnote, /\("y{20,}…"\)/, 'the reason is cut, not dropped');
  resetUserPrices();
});

test('MR-7 the reason is scanned like the tree\'s reasons are: a credential-shaped string in it is refused and nothing is written (the note lands in a project file the user may commit)', { timeout: 60_000 }, async () => {
  const fx = fixture(); const f = dearer();
  const q = await call(fx, { step: 'quote' }, f);
  const r = await call(fx, { step: 'confirm', shown: q.shown, reason: `yes, my key is ${'sk-' + 'A'.repeat(40)}` }, f);
  assert.match(r.refusal ?? '', /^the reason holds 1 credential-shaped string\(s\): change the text\. Nothing was written\.$/, JSON.stringify(r));    // red at f7ce7ba: the row is written
  assert.equal(existsSync(join(fx.work, 'pricing.user.json')), false, 'nothing written');
  const ok = await call(fx, { step: 'confirm', shown: q.shown, reason: 'yes, raise it' }, f);
  assert.equal(ok.step, 'confirm', ok.refusal);        // the same quote still works with a clean reason
  resetUserPrices();
});

test('MR-8 hidden characters and control characters in the reason and in a host name become spaces, whichever the character: the shared list (src/hidden-chars.js) decides, not an inline class (lane D, 23 Okt 2026; test/hidden-chars.test.js "no sixth list")', { timeout: 60_000 }, async () => {
  const WJ = String.fromCodePoint(0x2060), FILL = String.fromCodePoint(0x3164), ZWNJ = String.fromCodePoint(0x200c);   // the first two were in no inline list; ZWNJ was, and so are tab and line feed
  const fx = fixture(); const f = hostList(effectiveRow('openrouter', MODEL).in * 2, effectiveRow('openrouter', MODEL).out * 2, `De${WJ}ar${FILL}Host`);
  const q = await call(fx, { step: 'quote' }, f);
  assert.equal(hiddenIn(q.text), null, 'the quoted text a person is shown holds no hidden character');   // red at 863852b: the host name's U+2060 and U+3164 were in no inline list
  assert.match(q.text, /De ar Host/, 'a hidden character in the host name became a space');
  const ok = await call(fx, { step: 'confirm', shown: q.shown, reason: `yes${WJ}raise${FILL}it${ZWNJ}now\tok\ndone` }, f);
  assert.equal(ok.step, 'confirm', ok.refusal);
  const note = JSON.parse(readFileSync(join(fx.work, 'pricing.user.json'), 'utf8'))[SEAT].note;
  assert.equal(hiddenIn(note), null, 'the recorded note holds no hidden character');
  assert.ok(!/[\t\n\r]/.test(note), 'no tab or line break reached the recorded note');
  assert.match(note, /\("yes raise it now ok done"\): cheapest host De ar Host /, note);
  resetUserPrices();
});
