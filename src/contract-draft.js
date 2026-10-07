// `council contract draft --from-run <run>` (0.8.2 item 6d, plan M8): one call on the run's handoff seat that drafts the contract's obligations from the finished plan. The call itself is in src/cli.js, beside
// `council handoff --from-run` whose key scan, spend cap and policy gate it shares (it is the same block, in draft mode); this file holds what is specific to a contract draft.
//
// THE PROMPT IS RECORDED (0.8.2 prompt re-record, P12): CONTRACT_DRAFT_SYSTEM and contractDraftUser live in src/roles.js like every prompt, and `contractDraftPrompt` gives them to any seat (a mock seat too). Only a build
// whose roles.js lacks them (none ships) would refuse a real seat ("this build has no recorded prompt for contract draft", nothing sent) and let a mock seat through with a plain data layout; a test can still inject a
// prompt (setContractDraftPromptForTest) to prove the wiring.
//
// What the reply becomes: it is parsed with the run's own repairing parser, linted ($0, src/contract-lint.js) and, only if the lint passes, written as contract/draft.json for `council contract lock` to show a person.
// The raw reply is always kept as contract/draft-reply.md. A reply the lint refuses is a failed draft (nothing but that file is written); no identity field ever comes from it.
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import * as R from './roles.js';
import { parseJson } from './chain.js';
import { lintContractDraft } from './contract-lint.js';

const DIR = 'contract';
let testPrompt = null;
/** Test seam, same style as setLaneTextsForTest: { system, user({ request, draft, handoff, criteria }) } injected so the wiring can be proven before the real text exists. Null in production. */
export function setContractDraftPromptForTest(p) { testPrompt = p || null; }

/** { ok: true, system, user } or { ok: false, message }. The recorded prompt is roles.js's; without it only a mock seat is let through. */
export function contractDraftPrompt({ provider, request, draft, handoff = '', criteria = [] }) {
  const live = testPrompt ?? (typeof R.CONTRACT_DRAFT_SYSTEM === 'string' && typeof R.contractDraftUser === 'function' ? { system: R.CONTRACT_DRAFT_SYSTEM, user: R.contractDraftUser } : null);
  if (live) return { ok: true, system: live.system, user: live.user({ request, draft, handoff, criteria }) };
  if (provider === 'mock') return { ok: true, system: 'MOCK CONTRACT DRAFT (no model reads this)', user: `${criteria.map((c, i) => `C${i + 1}. ${c}`).join('\n')}\n\n${draft}` };
  return { ok: false, message: 'this build has no recorded prompt for contract draft (its wording waits for the 0.8.2 prompt re-record); nothing was sent' };
}

function writeView(dir, name, text) {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `${name}.tmp-${process.pid}`);
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, join(dir, name));
}

/**
 * Parses and lints a seat's reply and keeps it. -> { ok: true, obligations } | { ok: false, problems[] }. The reply is saved as contract/draft-reply.md either way; contract/draft.json is written (temp
 * file, then rename) only when the lint passes, and holds the lint's normalized copy: id, text, criterion, check, nothing else.
 */
export function finishDraft(runDir, replyText, { criteriaIds = null } = {}) {
  const dir = join(runDir, DIR);
  writeView(dir, 'draft-reply.md', String(replyText));
  let value = null;
  try { value = parseJson(String(replyText)); } catch { value = null; }
  const lint = value === null ? { ok: false, problems: ['the reply is not JSON of the form { "obligations": [ ... ] }'] } : lintContractDraft(value, { criteriaIds });
  if (!lint.ok) return { ok: false, problems: lint.problems };
  writeView(dir, 'draft.json', `${JSON.stringify({ obligations: lint.obligations }, null, 2)}\n`);
  return { ok: true, obligations: lint.obligations };
}
