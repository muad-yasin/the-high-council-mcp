// 0.8.3 (Muad 21 Okt 2026: "it should inform the user, acquire the new lowest price and ask to proceed with this one. It shouldn't be a reason to stop the run entirely"): when OpenRouter refuses a seat at its price limit and a person sits at the
// terminal, the run asks to raise the price and go on in the same breath. Ask only when it can be true and safe: a terminal on both ends, a plain run (not an advice call, not a tree member), every refused seat recognised as a price refusal,
// no seat whose price limit the chain itself sets, and a lookup that found ONE host that can serve the seat. Everything else keeps the old exit 24 with today's words. All sentences are A-DRAFT.
//
//   cheapestHost(modelId, { fetchImpl, needs })   -> { ok: true, host: { name, in, out } } | { ok: false, why }     OpenRouter's public endpoints list (no key); the host with the lowest in+out price among those that can serve this seat
//   offerWords({ rows, capUsd })                  -> the screen
//   offerPriceRaise({ set, ... })                 -> { offered: false, why } | { offered: true, raised: false } | { offered: true, raised: true, rows }
//   resumeAtExit({ runPath, ... })                -> registers the resume to start when this process has exited (its run lock is gone by then)
import { effectiveRow, raiseUserPriceRow } from './price-table.js';
import { blankHiddenChars } from './hidden-chars.js';
import { extraWithHighDefault, reasoningFieldPaths, rowOf } from './reasoning.js';

export const ENDPOINTS_URL = modelId => `https://openrouter.ai/api/v1/models/${modelId}/endpoints`;
const perMillion = s => { const n = Number(s) * 1e6; return Number.isFinite(n) && n > 0 ? Number(n.toPrecision(9)) : null; };

/**
 * What a call of this seat really needs from a host: its output cap (`defaultCap` when the seat names none) and whether it reasons. HIGH unit fix-up (C&C thcmcp-cd, 24 Okt 2026): a seat reasons when the call carries a reasoning field
 * (the seat's own, or the harness's high default) OR when the table says the model reasons by itself above high (defaultAboveHigh: GLM-5.3, GLM-5.3 Flash, Qwen 3.8 Max). Such a seat states no effort (Muad, 23 Okt 2026: "High should be *our*
 * default setting. Some models are so cheap that *their* default is Max effort, and we can go with that"), so without the second test a price-stop offer would name a host that does not list `reasoning`, for a model that thinks by default.
 */
export function needsOfSeat(seat, defaultCap) {
  const maxTokens = seat.maxTokens ?? defaultCap;
  return { maxTokens, reasoning: reasoningFieldPaths(extraWithHighDefault(seat, maxTokens)).length > 0 || rowOf(seat)?.defaultAboveHigh === true };
}

/** The cheapest SINGLE host that can serve the seat: max_price must cover one host on prompt AND completion, so the two minimums of different hosts are never combined. `needs` = { maxTokens, reasoning }. */
export async function cheapestHost(modelId, { fetchImpl = fetch, needs = {}, timeoutMs = 15000 } = {}) {
  let body;
  try {
    const res = await fetchImpl(ENDPOINTS_URL(modelId), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, why: `OpenRouter's list of hosts answered HTTP ${res.status}` };
    body = await res.json();
  } catch (e) { return { ok: false, why: `OpenRouter's list of hosts could not be read (${e?.name === 'TimeoutError' ? 'no answer in time' : e?.message || e})` }; }
  const hosts = Array.isArray(body?.data?.endpoints) ? body.data.endpoints : [];
  const usable = hosts.map(h => ({ name: safeName(h.provider_name ?? h.name), in: perMillion(h.pricing?.prompt), out: perMillion(h.pricing?.completion), h }))
    .filter(x => x.in !== null && x.out !== null)
    .filter(x => x.h.status === 0 || x.h.status === undefined)
    .filter(x => !(Number.isFinite(needs.maxTokens) && Number.isFinite(x.h.max_completion_tokens) && x.h.max_completion_tokens < needs.maxTokens))
    .filter(x => !(needs.reasoning && !(Array.isArray(x.h.supported_parameters) && x.h.supported_parameters.includes('reasoning'))));
  if (!usable.length) return { ok: false, why: hosts.length ? 'none of the listed hosts can serve this seat as it is set (output size, reasoning or availability)' : 'OpenRouter lists no host for it' };
  usable.sort((a, b) => (a.in + a.out) - (b.in + b.out));
  const best = usable[0];
  return { ok: true, host: { name: best.name, in: best.in, out: best.out } };
}

const usd = n => `$${n}`;
/** Network text (a host's name) before it reaches a screen: control, escape and bidi characters become spaces, at most 60 characters. */
export const safeName = s => blankHiddenChars(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'a host';

/** The screen. rows = [{ seat, pin: { prompt, completion }, host: { name, in, out } }]. */
export function offerWords({ rows, capUsd }) {
  const L = [];
  L.push(`OpenRouter's cheapest host that can serve ${rows.length === 1 ? 'this seat' : 'these seats'} costs more than the price limit the call carried:`);
  for (const r of rows) L.push(`  ${r.seat}: price limit ${usd(r.pin.prompt)} in / ${usd(r.pin.completion)} out, cheapest host ${r.host.name} at ${usd(r.host.in)} in / ${usd(r.host.out)} out (per million tokens).`);
  L.push(`Raising the price to ${rows.length === 1 ? 'that number' : 'those numbers'} writes ${rows.length === 1 ? 'a row' : 'rows'} into pricing.user.json in your project folder, which every later run there reads, and lets OpenRouter use ${rows.length === 1 ? 'that host' : 'those hosts'}. Every call of ${rows.length === 1 ? 'the seat' : 'the seats'} is then counted at that price against your spending limit${capUsd === null || capUsd === undefined ? '' : ` (the limit you typed, ${usd(capUsd)}, is not changed by this)`}, so a tight limit may stop the run sooner, and continuing asks you to type the limit again because a price changed. The host list does not say whether a host's context window fits this call: if it does not, the run stops again with a new question. The recorded cost is the tokens used times that price, so it can read higher than the bill if a cheaper host served the call.`);
  return L.join('\n');
}

/** Whether to ask at all. Pure. */
export function mayOffer({ set, tty, adviceOn, member }) {
  if (!tty) return { ok: false, why: 'no terminal' };
  if (adviceOn) return { ok: false, why: 'an advice call has no resume' };
  if (member) return { ok: false, why: 'a tree member is answered through its tree' };
  if (!set.length || set.some(e => !e.recognised)) return { ok: false, why: 'a refusal that does not name the price gets no price remedy' };
  if (set.some(e => e.ownPin)) return { ok: false, why: "a seat's own provider.max_price is changed in the chain, not in pricing.user.json" };
  if (set.some(e => !String(e.seat).startsWith('openrouter/'))) return { ok: false, why: 'only OpenRouter seats' };
  return { ok: true };
}

/** One typed line. The callback form of readline's question never answers when the input ends (Ctrl-D) or Ctrl-C is pressed: both count as an empty answer, so anything but a yes leaves the stop as it was. */
export function askLine(rl, question) {
  return new Promise(resolve => {
    const done = v => { rl.off('close', onClose); rl.off('SIGINT', onClose); resolve(v); };
    const onClose = () => done('');
    rl.once('close', onClose); rl.once('SIGINT', onClose);
    rl.question(question, done);
  });
}

/**
 * Looks up, shows, asks, and (on a yes) raises the rows. `needsOf(seat)` -> { maxTokens, reasoning }; `folder` = the project folder whose pricing.user.json gets the rows; `ask(question)` -> the typed answer.
 * Nothing is written unless the answer is y or yes. Never raises twice: one call, one answer.
 */
export async function offerPriceRaise({ set, folder, capUsd, needsOf = () => ({}), fetchImpl, ask, say }) {
  const rows = [];
  for (const e of set) {
    const modelId = String(e.seat).replace(/^openrouter\//, '');
    const found = await cheapestHost(modelId, { fetchImpl, needs: needsOf(e) });
    if (!found.ok) return { offered: false, why: `${e.seat}: ${found.why}` };
    const pin = e.pin ?? {};
    if (!(found.host.in > pin.prompt || found.host.out > pin.completion)) return { offered: false, why: `${e.seat}: its cheapest host is at or under the price limit the call carried, so OpenRouter's host list gives no higher price to offer` };
    rows.push({ seat: e.seat, pin, host: found.host });
  }
  say(offerWords({ rows, capUsd }));
  const answer = String(await ask('Raise the price and continue this run now? (y/n): ')).trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') return { offered: true, raised: false };
  for (const r of rows) {
    const before = effectiveRow('openrouter', r.seat.replace(/^openrouter\//, ''));
    raiseUserPriceRow(folder, r.seat, { in: Math.max(r.host.in, before?.in ?? 0), out: Math.max(r.host.out, before?.out ?? 0), note: `raised at the terminal after a price refusal: cheapest host ${r.host.name} (openrouter.ai endpoints list)` });
  }
  return { offered: true, raised: true, rows };
}

/** Starts `--resume <runPath>` after this process has exited: by then the run lock (released by its exit listener, registered earlier) is gone. The resumed run inherits the cap from run.json. */
export function resumeAtExit({ runPath, entry, cwd, proc = process, spawn }) {
  proc.on('exit', () => {
    try { proc.on('SIGINT', () => {}); } catch { /* the child alone answers Ctrl-C */ }
    const r = spawn(proc.execPath, [entry, '--resume', runPath], { stdio: 'inherit', cwd });
    proc.exitCode = typeof r?.status === 'number' ? r.status : 1;
  });
}
