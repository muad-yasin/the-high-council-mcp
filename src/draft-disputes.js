// DECLINED lines and the one function every reader of a model's draft text goes through (0.8.1 FX-15: the build stage did not parse them).
// parseDisputes moved here verbatim from src/chain.js (which re-exports it, so every import keeps working): a builder's or a reviser's raw stage text
// can end in DECLINED lines, and whoever takes that text as a DRAFT - the build stage, a reviser stage, `--from-run`, `council handoff --from-run` -
// must strip them. Nothing else in the harness may read build.md or a revise-N.md as a draft without `stripDeclined` or `readModelDraft`
// (test/regression-081-build-declined.test.js scans src/ for it). The finalist stage is deliberately NOT routed through here: its prompt has no DECLINED
// channel (its job is to remove chain artifacts), so a DECLINED line in its reply is text, not a dispute.
import { readFileSync } from 'node:fs';

// §5 (v3 plan, MISTRAL-3 accepted): a reviser that judges an objection to not
// be a real defect ends its reply with one or more trailing "DECLINED: <reason>"
// lines (src/roles.js's reviser system prompt). Those lines are never part of
// the deliverable a critic grades - they're stripped here and returned
// separately so the caller can carry them into report.json's `disputes`
// field instead. Only lines strictly at the end of the reply count: a
// "DECLINED:"-shaped line does not get pulled out of the middle of the
// deliverable's own body text.
// `disputedBlock` (default true: the reviser stages, as in 0.8.0): also strip a trailing Disputed block. The build stage and the draft readers FX-15 added pass false: a
// builder's plan may legitimately contain a paragraph that starts with "Disputed" (audit A5-2), so only its DECLINED lines are stripped there.
export function parseDisputes(text, { disputedBlock = true, withIds = false } = {}) {
  let lines = text.split('\n');
  const declined = [];
  const declinedIds = []; // 0.8.2 (owner, 7 Oct 2026, P13): in step with `declined`: the objection id a line answers ("DECLINED: O-1a2b3c4d: <reason>"), or null
  // Strip trailing DECLINED lines and a trailing Disputed block, in any order, until neither is
  // left at the end. Blank lines inside the trailer are skipped, not treated as its end. Bug-audit
  // fix, 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #3): a reply ending in "\n" - every
  // external-seat reviser file does - left an empty last line, the loop stopped there, every
  // DECLINED line was lost from report.json's `disputes` AND shipped inside the deliverable text.
  //
  // The Disputed block: pre-release audit 2026-09-23 (RolesPrompts #1, HIGH). REVISER_SYSTEM used
  // to ALSO tell the reviser to add a "Disputed" line at the end, contradicting the DECLINED rule
  // below it, and only DECLINED was stripped. In a real premium run the reviser ended its draft
  // with a multi-line "DISPUTED: ... This plan's position, unchanged: ..." paragraph: it stayed in
  // the graded draft, `disputes` was empty, and panel seats then marked "records dissent honestly"
  // as met BECAUSE of it. The prompt rule is gone (DECLINED is the only channel); this strip is the
  // defence in depth for a model that writes one anyway. Only a TRAILING block counts - one that
  // starts at a "Disputed" heading or a "DISPUTED:" line with nothing but its own paragraph after it
  // - so a plan that merely discusses disputes in its body is never cut.
  const DISPUTED_START = /^(#{1,6}\s*)?(\*\*)?disputed\b(\*\*)?\s*:?/i;
  for (let changed = true; changed;) {
    changed = false;
    let i = lines.length - 1;
    while (i >= 0 && lines[i].trim() === '') i--;
    while (i >= 0) {
      const line = lines[i].trim();
      if (line === '') { i--; continue; }
      if (!/^DECLINED:\s*.+/.test(line)) break;
      const rest = line.replace(/^DECLINED:\s*/, '');
      const { ids, reason } = withIds ? splitDeclinedId(rest) : { ids: [null], reason: rest }; // `withIds`: only the stage whose prompt asks for ids (the revise of a chain with answer_back.enabled); everywhere else a line is read as it always was
      for (const id of [...ids].reverse()) { declined.unshift(reason); declinedIds.unshift(id); } // a line naming several ids gives each its own entry with the same reason
      i--; changed = true;
    }
    lines = lines.slice(0, i + 1);
    // A trailing Disputed block: walk back over its paragraph(s) to the line that opens it.
    let j = lines.length - 1;
    while (j >= 0 && lines[j].trim() === '') j--;
    let k = j;
    while (k >= 0 && !DISPUTED_START.test(lines[k].trim()) && lines[k].trim() !== '' && !/^#{1,6}\s/.test(lines[k].trim())) k--;
    // A heading-style block ("## Disputed") may be followed by a blank line and then its lines.
    if (k >= 0 && lines[k].trim() === '' && k > 0) {
      let h = k - 1;
      while (h >= 0 && lines[h].trim() === '') h--;
      if (h >= 0 && /^#{1,6}\s*(\*\*)?disputed\b/i.test(lines[h].trim())) k = h;
    }
    if (disputedBlock && k >= 0 && k <= j && DISPUTED_START.test(lines[k].trim())) {
      const block = lines.slice(k, j + 1).map(l => l.trim()).filter(Boolean);
      const body = [block[0].replace(DISPUTED_START, '').trim(), ...block.slice(1)].filter(Boolean).join(' ');
      if (body) { declined.push(body); declinedIds.push(null); }
      lines = lines.slice(0, k);
      changed = true;
    }
  }
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return { draft: lines.join('\n'), disputes: declined, disputeIds: declinedIds };
}

// "O-1a2b3c4d: <reason>" (also "[O-1a2b3c4d] <reason>", "O-1a2b3c4d - <reason>", "O-1a2b3c4d <reason>"; any case) names the objection a DECLINED line answers (src/objection-ids.js: "O-" and eight hex digits).
// A line with no id, or an id and nothing after it, stays whole as a reason with no id: a line is never lost and never matched to an objection by guesswork.
function splitDeclinedId(rest) {
  // Audit fix cnc-prompts F5: an id may be wrapped in backticks, emphasis or angle/square brackets, and one line may name several ("`O-aaaaaaaa`, `O-bbbbbbbb` - reason").
  const WRAP = '[`*_<\\[(]*'; const END = '[`*_>\\])]*'; const ONE = 'O-[0-9a-f]{8}(?![0-9a-f])';
  const m = new RegExp(`^${WRAP}(${ONE}(?:${END}\\s*,\\s*${WRAP}${ONE})*)${END}\\s*(?:[:\\-\\u2013\\u2014]\\s*)?(\\S[\\s\\S]*)$`, 'i').exec(rest);
  return m ? { ids: m[1].match(/O-[0-9a-f]{8}/gi).map(x => x.toLowerCase().replace(/^o-/, 'O-')), reason: m[2].trim() } : { ids: [null], reason: rest };
}

/** The draft in a model's stage text, with its trailing DECLINED lines removed (a Disputed paragraph is plan text here; see parseDisputes). */
export function stripDeclined(text) {
  return parseDisputes(String(text ?? ''), { disputedBlock: false }).draft;
}

/** Read a stage file (build.md, revise-N.md) as a draft: its text without the DECLINED lines. */
export function readModelDraft(path) {
  const text = readFileSync(path, 'utf8');
  // A reviser's stage file is read the way the reviser stage reads it (its trailing Disputed block is the model's own record of a declined objection); a builder's is not.
  return /(^|[\\/])revise-\d+\.md$/.test(path) ? parseDisputes(text).draft : stripDeclined(text);
}
