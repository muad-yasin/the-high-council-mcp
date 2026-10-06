// The send path's kinds (0.8.1 plan DR-5): what differs between one kind of send and another. The money guards,
// the masking, the key and PII scans, the approval and the run start are shared (src/send-path.js,
// src/send-path-refusals.js); a profile holds only what a kind brings of its own.
//
// Contract.
//   profileFor(kind) -> the profile, or throws an Error with code 'unknown_kind'.
//   KINDS: the registered kinds. Only `advice` exists in 0.8.1. The 0.8.2 verifier adds a profile (its brief, its
//   chain, its call-count limits) and no approval code. A stub profile for it is deliberately not here: its numbers
//   would be invented, and the seam is proven by an unregistered kind being refused.
//
// The kind is chosen by the server, never by a tool argument (DR-5: a model must not pick its own guard profile).
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADVICE_BRIEF, briefRefusal, renderBriefText } from './advice-brief.js';
import { fingerprintOf, limitsFromEnv } from './advice-guards.js';
import { isChainName } from './chain-name.js';
import { SENSITIVITY_FLOOR_ENV } from './advice-tier.js';

// Where an advice chain may come from (0.8.1 decided rule 5d, audit A4): the package's own chains/, or one folder the operator
// names in COUNCIL_ADVICE_CHAINS_DIR, looked at first. Never the working folder's chains/: a repository's own file would
// otherwise decide which seats receive the text and what they are told. One loader, for the MCP server and for
// `council --advice-adopt` (M4 review: the CLI's planning loader looks in <work>/chains first).
export const ADVICE_CHAINS_DIR_ENV = 'COUNCIL_ADVICE_CHAINS_DIR';
// The settings that decide what an advice call sends and to whom (decided rule 5d) are the operator's: they come from the server's own
// environment only. src/cli.js's .env loader never sets them, since <work>/.env is part of the project, which the agent can write
// (M5 review D3). One list, so widening it (the money limits are an open owner question) is one line.
export const OPERATOR_ONLY_ENV = Object.freeze([ADVICE_CHAINS_DIR_ENV, SENSITIVITY_FLOOR_ENV]);
const PKG_CHAINS = join(dirname(fileURLToPath(import.meta.url)), '..', 'chains');

/**
 * { dirs, error }: the folders an advice chain is looked up in, in order. error (a sentence) when the operator folder is set
 * but is not an absolute path to an existing folder outside the working folder; the callers then refuse to start (the server)
 * or to run (the CLI) rather than fall back to the package's chains silently.
 */
export function adviceChainDirs({ env = process.env, work = process.cwd() } = {}) {
  const v = env[ADVICE_CHAINS_DIR_ENV];
  if (v === undefined || v === '') return { dirs: [PKG_CHAINS], error: null };
  const bad = why => ({ dirs: [], error: `${ADVICE_CHAINS_DIR_ENV} ${JSON.stringify(v)} ${why}` });
  if (!isAbsolute(v)) return bad('is not an absolute path');
  if (!existsSync(v) || !statSync(v).isDirectory()) return bad('is not a folder');
  const real = realpathSync(v);
  const rel = relative(realpathSync(work), real);
  if (rel === '' || !(rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel))) return bad('is inside the working folder: advice chains never come from the project (they decide who receives the text)');
  return { dirs: [real, PKG_CHAINS], error: null };
}

/** The advice chain `name` as its file says, or null (no such chain, a bad name, an unreadable file, a bad operator folder). */
export function loadAdviceChain(name, opts = {}) {
  const found = adviceChainPath(name, opts);
  if (!found) return null;
  // An unreadable chain file is "no such chain": admission then refuses the call by name, before anything is sent.
  try { return JSON.parse(readFileSync(found, 'utf8')); } catch { return null; }
}

/** The path loadAdviceChain reads (the CLI loads it itself); null when there is none. */
export function adviceChainPath(name, { env = process.env, work = process.cwd() } = {}) {
  if (!isChainName(name)) return null;
  const { dirs, error } = adviceChainDirs({ env, work });
  if (error) return null;
  return dirs.map(d => resolve(d, `${name}.json`)).find(existsSync) ?? null;
}

// One seat id per single-mode chain (src/advice-seats is this table plus the chain files themselves: the chain file IS
// the seat's definition, its price row and its ceiling). `sol` is the default: a non-Anthropic model, because Claude is
// already the caller and `/advisor`. `opus` (the control) is reachable only by naming it. The 0.8.1 roster (plan DR-16): glm, muse,
// qwen and sonnet single chains are not shipped; a user can seat any of them in their own chain.
export const SEAT_CHAINS = Object.freeze({
  sol: 'advise-single', astra: 'advise-single-astra', gemini: 'advise-single-gemini', deepseek: 'advise-single-deepseek',
  opus: 'advise-single-opus',
});
export const DEFAULT_SEAT = 'sol';
export const COUNCIL_CHAIN = 'advise-standard';
export const MOCK_CHAINS = Object.freeze({ single: 'mock-advise-single', council: 'mock-advise-standard' });

export function chainNameFor({ mode, seat, env = process.env }) {
  if (env.COUNCIL_ADVISE_MOCK === '1') return MOCK_CHAINS[mode];
  if (mode === 'council') return env.COUNCIL_ADVISE_CHAIN_COUNCIL || COUNCIL_CHAIN;
  return seat ? SEAT_CHAINS[seat] : (env.COUNCIL_ADVISE_CHAIN_SINGLE || SEAT_CHAINS[DEFAULT_SEAT]);
}

const PROFILES = Object.freeze({
  advice: Object.freeze({
    kind: 'advice',
    briefSchema: ADVICE_BRIEF,
    briefRefusal,
    renderBrief: renderBriefText,
    chainFor: chainNameFor,
    fingerprint: fingerprintOf,
    // The call-count and money limits; the money part is the same for every kind, the counts are this kind's.
    limits: limitsFromEnv,
  }),
});

export const KINDS = Object.freeze(Object.keys(PROFILES));

export function profileFor(kind) {
  const p = Object.hasOwn(PROFILES, kind) ? PROFILES[kind] : null;
  if (!p) throw Object.assign(new Error(`unknown_kind: no send profile ${JSON.stringify(kind)} (known: ${KINDS.join(', ')})`), { code: 'unknown_kind' });
  return p;
}
