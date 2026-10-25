// 0.8.3 (Muad 23 Okt 2026, "2: ii"; C&C thcmcp-cd PASS WITH CONDITIONS on Review/Build_0.8.3/m8/E_PriceLimit_Fingerprint_Plan_2026-10-23.md): the person accepts a changed PRICE LIMIT in a chain file the tree pinned.
// A tree pins each chain file by its hash (tree.json chains, src/tree-continuation.js), so a chain edited after a price refusal on a seat that sets its OWN provider.max_price was refused with no way on. This is the way on, and
// it is the person's: `council tree decide <root> --accept-chain-limits <chain>` shows the old and the new limits of every seat, the chain's upper estimate before and after, and every depth and node that reads the file, and asks
// the person to type the chain name. Only a file that differs from the accepted one in NOTHING but the two limit fields is accepted (src/price-limits.js limitFreeSha256Of; tree.json recorded the hash without the limits at
// `tree start`); anything else is refused as before. On yes ONE event, chain_limits_amended (src/tree-transitions.js), is written under the tree lock after the file has been read again; readTreeRecord lays it over tree.chains.
// It moves no money and no grant, starts nothing and clears nothing; a limit lowered is accepted like one raised (the person approves it). All sentences are A-DRAFT.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Of } from './thin-contract.js';
import { TreeRefusal, appendTreeEventLocked, readTreeRecord, stateOf, unreadableRecordRefusal, withTreeLock } from './tree-record.js';
import { liveMembersOf } from './tree-transitions.js';
import { bundleAllowanceBytesOf, chainFigures, ceilCents } from './tree-budget.js';
import { limitFreeSha256Of, priceLimitsOf, withPriceLimits } from './price-limits.js';
import { terminalSafeMarked } from './terminal-safe.js';
import { money } from './tree-stop.js';

const PKG_CHAINS = join(dirname(fileURLToPath(import.meta.url)), '..', 'chains');
const FIELDS = ['prompt', 'completion'];
const pathLabel = path => path.map((k, i) => (typeof k === 'number' ? `[${k}]` : `${i ? '.' : ''}${k}`)).join('');
const asTyped = v => (v === undefined ? 'not set' : JSON.stringify(v));

/** The chain file the tree reads for `name`: the working folder's chains/ first, then the package's (src/tree-derive-load.js loadChainConfig). -> path | null */
const chainPathOf = (work, name) => [join(work, 'chains', `${name}.json`), join(PKG_CHAINS, `${name}.json`)].find(existsSync) ?? null;

/** The changed limits as { seat, path, field, from, to } rows, one per field that differs, in the order of the new file. `oldLimits` and `newLimits` are priceLimitsOf snapshots; `config` names the seats. */
export function limitChangesOf(oldLimits, newLimits, config) {
  const key = p => JSON.stringify(p);
  const before = new Map((oldLimits ?? []).map(e => [key(e.path), e.limits])); const after = new Map((newLimits ?? []).map(e => [key(e.path), e.limits]));
  const out = [];
  for (const k of new Set([...after.keys(), ...before.keys()])) {
    const path = JSON.parse(k); let seat = config; for (const p of path) seat = seat?.[p];
    for (const f of FIELDS) {
      const a = before.get(k)?.[f]; const b = after.get(k)?.[f];
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ seat: seat && seat.provider ? `${seat.provider}/${seat.model}` : 'a seat', path, field: f, from: a, to: b });
    }
  }
  return out;
}

/** What the file on disk is, against what the tree accepted. -> { refusal } | { entry, name, path, text, actual, config } */
function inspectChain({ record, work, name }) {
  const entries = (record.tree.chains ?? []).filter(c => c.name === name);
  if (!entries.length) return { refusal: `this tree names no chain ${JSON.stringify(name)} (its chains: ${[...new Set((record.tree.chains ?? []).map(c => c.name))].join(', ')})` };
  const entry = entries[0];
  if (!/^[0-9a-f]{64}$/.test(entry.limitFreeSha256 ?? '')) return { refusal: `this tree did not record what ${name} is without its price limits, so a change of those limits cannot be accepted for it: start a new tree with council tree start` };
  const path = chainPathOf(work, name);
  if (!path) return { refusal: `the chain ${name} is not in ${join(work, 'chains')} or in the package` };
  let text; try { text = readFileSync(path, 'utf8'); } catch (e) { return { refusal: `${path} cannot be read (${e.code || e.message})` }; }
  const actual = sha256Of(text);
  if (actual === entry.sha256) return { refusal: `${name}.json is the file the tree accepted: there is nothing to accept` };
  let free = null; try { free = limitFreeSha256Of(text); } catch { return { refusal: `${path} is not valid JSON` }; }
  if (free !== entry.limitFreeSha256) return { refusal: `${name}.json differs from the file the tree accepted in more than the price limits of its seats (provider.max_price prompt/completion): a tree takes no other change to a chain it has pinned; restore the file, or start a new tree with council tree start` };
  return { entry, name, path, text, actual, config: JSON.parse(text) };
}

/**
 * The form (mirrors buildAmendCap in src/tree-decide.js). -> { refusal } | { text, expect, typedLabel, formName, after, apply }. Nothing is written here. Refused BEFORE anything is typed: a record that does not read, a node with a live
 * claim (its figures change while it runs), a chain the tree does not name, a file that is the accepted one or differs in more than the limits.
 */
export function buildAcceptChainLimits({ rootDir, rootId, nameArg, work, facts }) {
  const record = readTreeRecord(rootDir);
  { const unreadable = unreadableRecordRefusal(record); if (unreadable) return { refusal: unreadable }; }
  const name = typeof nameArg === 'string' ? nameArg : '';
  // the root is known here, so it is printed (A-DRAFT, C&C thcmcp-cd 23 Okt 2026); the chain is what the person has not said: <chain> stays as the slot to fill, with the tree's own chain names beside it
  if (!name) return { refusal: `--accept-chain-limits needs the name of the chain (its chains: ${[...new Set((record.tree.chains ?? []).map(c => c.name))].join(', ')}): council tree decide ${rootId} --accept-chain-limits <chain>` };
  const state = stateOf(record);
  const live = liveMembersOf(state, facts);
  if (live.length) return { refusal: `${live[0].key} has a live ${live[0].kind === 'post_run' ? 'post-run call' : 'claim'} (pid ${live[0].pid} on ${live[0].host}): it reads its chain while it runs, so what you read could not be what it uses; accept the limits when it has ended or stopped (\`council tree stop ${rootId}\` starts nothing further but lets a running node finish)` };
  const seen = inspectChain({ record, work, name });
  if (seen.refusal) return { refusal: `--accept-chain-limits: ${seen.refusal}` };
  const { entry, path, actual, config } = seen;
  const newLimits = priceLimitsOf(config); const oldLimits = entry.priceLimits ?? [];
  const changes = limitChangesOf(oldLimits, newLimits, config);
  const inputBytes = bundleAllowanceBytesOf(record.tree);
  const figOld = chainFigures(withPriceLimits(config, oldLimits), { inputBytes }); const figNew = chainFigures(config, { inputBytes });
  const size = inputBytes >= 1000 ? `${Math.round(inputBytes / 1000)} KB` : `${inputBytes} bytes`;
  const depths = record.tree.chains.filter(c => c.name === name).map(c => c.depth);
  const readers = record.events.filter(e => e.event === 'node_registered' && e.chain?.name === name).map(e => { const key = `${e.node}@g${e.generation}`; return `${key}: ${state.nodes.get(key)?.phase ?? 'registered'}`; });
  const text = `Accept changed price limits in the chain ${name}?   (tree ${rootId})

The tree pinned the chain file ${name}.json. The file now differs from the one it accepted ONLY in the price limits of its seats (provider.max_price, the highest price per million tokens OpenRouter may charge for a call: prompt and completion). Nothing else in the file differs; a tree takes no other change.

The limits that changed (US dollars per million tokens, as typed in the file):
${changes.length ? changes.map(c => `  ${pathLabel(c.path)} (${c.seat}): ${c.field} ${asTyped(c.from)} -> ${asTyped(c.to)}`).join('\n') : '  none that a call is priced with (a field that is not a number above 0 counts as not set)'}

The chain's upper estimate (priced for an input of up to ${size}): ${figOld ? money(ceilCents(figOld.atMostUsd)) : 'unknown'} before, ${figNew ? money(ceilCents(figNew.atMostUsd)) : 'unknown'} after. Only the upper estimate includes a seat's own limit; the cheapest end and the expected figure are priced from the price table.
Who reads this file: ${depths.length ? `depth${depths.length === 1 ? '' : 's'} ${depths.join(', ')}` : 'no depth'}${readers.length ? `; registered nodes: ${readers.join('; ')}` : '; no node is registered yet'}. All of them go on with the new file.

A higher limit lets OpenRouter use dearer hosts, and every call is counted at the higher price against the caps; a lower one may leave a call no host. This moves no grant and no hold, starts nothing, and the finished work stays. A sub-plan whose approval showed another upper estimate is shown again at \`council tree approve ${rootId}\`.

To approve, type the chain name: ${name}
`;
  return {
    text: terminalSafeMarked(text), expect: name, typedLabel: 'the chain name', formName: `accept the price limits of chain ${name}`,
    after: `Nothing was started and nothing was spent. \`council tree resume ${rootId}\` goes on with the new limits; the finished work is kept.`,
    apply: ({ gateId, shownSha256, actor, via }) => amendChainLimits(rootDir, { chain: name, fromSha256: entry.sha256, toSha256: actual, limitFreeSha256: entry.limitFreeSha256, fromLimits: oldLimits, toLimits: newLimits, work, gateId, shownSha256, actor, via }),
  };
}

/** Writes the event, under the tree lock, once the file on disk has been read again: it is the file the person was shown and still differs from the accepted one in nothing but its limits. */
export function amendChainLimits(rootDir, { chain, fromSha256, toSha256, limitFreeSha256, fromLimits, toLimits, work, gateId, shownSha256, actor, via }, { now } = {}) {
  if (typeof gateId !== 'string' || !gateId || typeof shownSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(shownSha256)) throw new TypeError('amendChainLimits: gateId and shownSha256 (64 hex) are required: accepting a limit is a decision a person made through the gate');
  return withTreeLock(rootDir, () => {
    const record = readTreeRecord(rootDir);
    const refuse = reason => { appendTreeEventLocked(rootDir, { event: 'blocked', reason: 'continuation_refused', scope: 'tree', check: 'accept_chain_limits', detail: reason }, { now }); throw new TreeRefusal({ code: 'continuation_refused', transition: 'chain_limits_amended', reason }); };
    { const unreadable = unreadableRecordRefusal(record); if (unreadable) return refuse(unreadable); }
    const seen = inspectChain({ record, work, name: chain });
    if (seen.refusal) return refuse(seen.refusal);
    if (seen.entry.sha256 !== fromSha256) return refuse(`the limits of ${chain} were accepted since you read them (the tree now accepts ${seen.entry.sha256.slice(0, 12)}, not ${String(fromSha256).slice(0, 12)}): read them again`);
    if (seen.actual !== toSha256) return refuse(`${chain}.json changed while you read it (${seen.actual.slice(0, 12)} now, ${String(toSha256).slice(0, 12)} on the screen): read it again`);
    return appendTreeEventLocked(rootDir, { event: 'chain_limits_amended', chain, fromSha256, toSha256, limitFreeSha256, fromLimits, toLimits, gateId, shownSha256, actor, via }, { now });
  });
}
