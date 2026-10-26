// The paid repair recommendation, the OFFER side (0.8.3 ROADMAP 77; gate note Review/Build_0.8.3/m7/A_Paid_Repair_Recommendation_Gate_Note.md, C&C PASS ON CONDITIONS 18 Okt 2026; design note
// M6_Root_Regenerate_Design_Note.md section 17). This file is PURE: it reads no file, writes no record, calls no model and spends nothing. It decides WHETHER and HOW the decide form offers a recommendation and says
// so in words; the admission of the grant, the claim and the end of the hold need new records (src/tree-transitions.js) and come in later commits (P1/P2, after the C4 unit that edits that file).
//   adviceChainNamed     the advisor chain the person named for the single-council seat: COUNCIL_ADVISE_CHAIN_SINGLE or the decide option, read DIRECTLY. NEVER src/send-profiles.js chainNameFor, which always falls back to a
//                        default chain: "no default chain, ever" (note 17.3; a test scans this file for the import).
//   adviceOfferFacts     -> { offer: true, case: 'A' | 'C', ... } | { offer: false, why: 'no_chain' | 'exhausted' | 'no_ceiling' | 'cap_short', ... }: the figures of the offer, from what the tree can grant TODAY.
//   adviceOfferLines     the lines the decide screen prints (A-DRAFT, texts E22 and E25 of the end-of-release list, for the Fable pass); the last line of an offer is the y/N question.
//   adviceGateText       those lines joined: the EXACT text of the typed y/N gate. The ledger records its shownSha256, so the record says the grant was approved THERE (C&C, Q12: shown with the grant AND the available figure,
//                        never inferred from the tree cap). The commit that builds the gate hashes this function's output, so the tested text and the hashed text are the same bytes.
//   adviceBriefRefusal   the tree's key scan and personal-data mode over the exact brief that would leave the machine ("the check should go everywhere"): null | { text }.
// The figures (note 3.3, F4): F = `availableNowUsd` is what an admission can grant today (the one formula, budgetOf); `freeUsd` is what the new main plan can use after the decision (the root re-plan preflight's own figure,
// which ignores money other nodes still hold because the decision releases it); the recommendation never draws on money other nodes hold. The grant is two calls (the first and the one re-ask) only when the re-ask
// exists (its fixed problem phrases are model-read wording that is still held: `reaskAvailable` false), and no figure is printed that the run cannot spend.
import { formatUsd } from './cost.js';
import { MONEY_EPS } from './tree-budget.js';
import { textSecretFindings, piiGateReport } from './run-preflight.js';
import { secretRefusalLines } from './outbound-scan.js';
import { treeInputScanModeFrom } from './tree-pii-mode.js';

/** The named single-council advisor chain: { named: true, name, source: 'option' | 'env' } | { named: false }. An option beats the variable; blank or whitespace is not a name. Never a default. */
export function adviceChainNamed({ env = process.env, option = null } = {}) {
  for (const [source, v] of [['option', option], ['env', env?.COUNCIL_ADVISE_CHAIN_SINGLE]]) {
    if (typeof v === 'string' && v.trim() !== '') return { named: true, name: v.trim(), source };
  }
  return { named: false };
}

/**
 * The offer. Inputs: `chain` (adviceChainNamed's answer), `cap` (tree-budget capFactsOf: { exhausted }), `availableNowUsd` (budgetOf(...).availableUsd), `freeUsd` (the root re-plan preflight's free amount),
 * `cheapestUsd` (Z, the root chain's cheapest end), `ceilingUsd` (X, the advice path's own ceiling for ONE call with its retries reserved, or null when the path has none), `reaskAvailable`.
 * Boundary (Astra #22): an exhausted cap offers nothing at all; otherwise A (two calls fit), C (one fits, a re-ask only if it still fits), or no offer because not even one fits (D, the cap's arithmetic, shown).
 */
export function adviceOfferFacts({ chain, cap, availableNowUsd, freeUsd, cheapestUsd, ceilingUsd, reaskAvailable = false }) {
  if (!chain?.named) return { offer: false, why: 'no_chain' };
  if (cap?.exhausted) return { offer: false, why: 'exhausted' };
  const x = ceilingUsd;
  if (!(typeof x === 'number' && Number.isFinite(x) && x > 0)) return { offer: false, why: 'no_ceiling' };
  const f = Math.max(0, availableNowUsd);
  const heldElsewhereUsd = Math.max(0, freeUsd - f);
  if (f + MONEY_EPS < x) return { offer: false, why: 'cap_short', xUsd: x, availableNowUsd: f };
  const twoCalls = reaskAvailable && f + MONEY_EPS >= 2 * x;
  const grantUsd = reaskAvailable ? Math.min(f, 2 * x) : x;
  return {
    offer: true, case: !reaskAvailable || twoCalls ? 'A' : 'C', chain: chain.name, xUsd: x, grantUsd, reask: !reaskAvailable ? 'none' : twoCalls ? 'yes' : 'conditional',
    availableNowUsd: f, freeUsd, heldElsewhereUsd, yUsd: Math.max(0, freeUsd - grantUsd), zUsd: cheapestUsd,
  };
}

/** The sentence under every place a recommendation is named (E22 tail). */
export const RECOMMENDATION_IS = 'A recommendation is a suggestion, never a fix; nothing in it is checked.';

/** The lines of the decide screen for a recommendation, from adviceOfferFacts. `rootId` names the amend command. A-DRAFT (texts E22, E25; the exhausted-cap line is NEW). */
export function adviceOfferLines(facts, { rootId = '<root>' } = {}) {
  if (!facts.offer) {
    if (facts.why === 'no_chain') return ['No advisor chain is named, so no recommendation is offered.'];
    if (facts.why === 'exhausted') return [`This tree's cap is used up, so no recommendation is offered. You can stop, wait, or raise the cap: council tree decide ${rootId} --amend-cap <total>.`];
    if (facts.why === 'no_ceiling') return ['The price of a recommendation could not be worked out, so none is offered.'];
    return [`Only ${formatUsd(facts.availableNowUsd)} is free under this tree's cap, less than one request costs (${formatUsd(facts.xUsd)}): a recommendation cannot be asked for.`];
  }
  const lines = [RECOMMENDATION_IS, `This sets aside ${formatUsd(facts.grantUsd)} of the ${formatUsd(facts.availableNowUsd)} that is free under this tree's cap right now; what it does not spend is given back.`];
  if (facts.heldElsewhereUsd > 0.005) lines.push(`${formatUsd(facts.heldElsewhereUsd)} of the free money is held for nodes this decision will release; a recommendation cannot use it.`);
  if (facts.case === 'C') lines.push(`Only ${formatUsd(facts.availableNowUsd)} is free under this tree's cap: if the answer cannot be read, there may not be enough left to ask once more.`);
  if (facts.yUsd + MONEY_EPS < facts.zUsd) lines.push(`If you ask for it, the new plan may not fit under this tree's cap. You can then raise the cap (council tree decide ${rootId} --amend-cap <total>) or start a new tree.`);       // B-DRAFT (Astra 17: the cap can be amended)
  const upTo = facts.reask === 'none' ? '' : ` (up to ${formatUsd(facts.grantUsd)} if the answer cannot be read and is asked for once more)`;
  lines.push(`Ask for a recommendation? about ${formatUsd(facts.xUsd)}${upTo}; free after it ${formatUsd(facts.yUsd)}; the new main plan needs at least ${formatUsd(facts.zUsd)} [y/N]`);
  return lines;
}

/**
 * The key scan and the tree's personal-data mode over the EXACT brief text, before the offer is made (a hit withholds the recommendation, never the whole decision). `tree` is tree.json's object. -> null | { text }.
 * The sentence names the pattern or type and the position, never the value.
 */
export function adviceBriefRefusal({ tree, briefText }) {
  const where = 'the recommendation brief';
  const keyed = textSecretFindings(briefText, where);
  if (keyed.length) return { text: `No recommendation is offered: the brief it would send holds ${keyed.length} credential-shaped string(s):\n${secretRefusalLines(keyed).join('\n')}\nYou can still type your own decision.` };
  const mode = treeInputScanModeFrom(tree);
  if (mode.status === 'unusable') return { text: `No recommendation is offered: the tree's personal-data mode in tree.json is unusable (${mode.reason}), so the brief cannot be checked. You can still type your own decision.` };
  if (mode.status === 'on') {
    const pii = piiGateReport({ mode: mode.mode, sources: [[where, briefText]], forTree: true });
    if (pii.blocked) return { text: `No recommendation is offered: the brief it would send holds personal data under --pii-gate ${mode.mode}:\n${pii.findings.map(f => `  ${f.where}, line ${f.line}, col ${f.column}: ${f.type}${f.pattern ? ` (${f.pattern})` : ''}`).join('\n')}\nYou can still type your own decision.` };
  }
  return null;
}

/** The exact text of the typed y/N gate: the offer lines, one per line. */
export const adviceGateText = (facts, opts) => adviceOfferLines(facts, opts).join('\n');
