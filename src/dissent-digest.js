// Harness feature round v6, item E (relay/runs/2026-09-15T15-12-52-325Z/deliverable.md): a
// plain-English dissent digest - a short paragraph explaining why the panel disagreed, or that it
// didn't.
//
// Contract:
//   deriveDissentSummary(report) -> { topics: string[], objections: string[], verdict: string }
//     Pure, offline, no model call. Reads only report.json fields already written by
//     src/disagreement-groups.js (disagreement_groups) and src/outcome.js (outcome) - never
//     recomputes debate logic itself (derive-never-record: this module owns no debate semantics
//     of its own).
//   renderDigestTemplate(summary) -> string
//     Pure, offline, deterministic. Fills the fixed template named in the plan:
//     "The panel disagreed on: <topics>. Objections raised: <list>. Final verdict: <verdict>."
//     No comparative/efficacy language - this function is itself the offline-testable proof that
//     the template never varies by content.
//   generateDigestText({ report, call, model, provider, maxTokens }) -> Promise<string>
//     The one function that may make a real model call (BYOK, stated plainly - see the plan's own
//     item E). Takes `call` as a parameter (same shape as providers.js's `call`) rather than
//     importing providers.js directly, so a test can pass the mock provider and the mechanism is
//     fully offline-verifiable independent of any real call. Falls back to
//     renderDigestTemplate(summary) verbatim if `call` is omitted or the model reply is empty -
//     never throws, never leaves digest.md unwritten for a formatting failure alone.
//   writeDigest(runDir, text, { now = () => new Date() } = {}) -> { path, mtime }
//     Writes digest.md into the given completed run folder. Caller (the CLI's --digest flag) is
//     responsible for calling this only after report.json exists on disk - see the acceptance
//     test's mtime-ordering check.
//
// The structural read-only guarantee, stated once here (binding, from the plan): nothing under
// src/chain.js's or src/roles.js's import graph may import this file, and this file may import
// neither of those two. That is the whole mechanism - not a comment's promise, a fact a static
// test (test/no-digest-in-prompt-paths.test.js) checks by walking both import graphs. This module
// therefore imports nothing from ./chain.js, ./roles.js, or any module that itself imports either
// (checked transitively by the same test) - only node:fs/node:path and its own pure helpers below.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// canary.js has no imports at all, so this keeps the digest's import graph free of chain.js/roles.js.
import { isCanary } from './canary.js';
import { deniedReasonsOf, DeniedModel } from './denied-models.js';

const NO_DISSENT_TOPICS = 'nothing - every critic signed off with no objections';

export function deriveDissentSummary(report) {
  // Reports written before the 2026-09-23 fix can carry a canary post inside a group (pre-release
  // audit, ProposalsDebateDispute #2); drop it, and any group it was the only post of.
  const groups = (report?.disagreement_groups || [])
    .map(g => ({ ...g, posts: (g.posts || []).filter(p => !isCanary(p)) }))
    .filter(g => g.posts.length);
  const topics = groups.map(g => g.title || g.on).filter(Boolean);
  const objections = groups.flatMap(g =>
    (g.posts || [])
      .filter(p => p.stance === 'object')
      .map(p => `${p.by}: ${p.text}`)
  );
  const verdict = report?.outcome || 'unknown';
  return { topics, objections, verdict: String(verdict) };
}

export function renderDigestTemplate({ topics, objections, verdict }) {
  const topicsText = topics.length ? topics.join(', ') : NO_DISSENT_TOPICS;
  const objectionsText = objections.length ? objections.join('; ') : 'none';
  return `The panel disagreed on: ${topicsText}. Objections raised: ${objectionsText}. Final verdict: ${verdict}.`;
}

export async function generateDigestText({ report, call, model, provider, maxTokens = 300 }) {
  const summary = deriveDissentSummary(report);
  const fallback = renderDigestTemplate(summary);
  if (!call) return fallback;
  // Money path #5 (Review/PreRelease_Audit_moneypath_2026-09-23.md): this is the one paid call made
  // outside chain.js's invoke(), so the run-time denied-model check never saw it and
  // `--provider openrouter --model x-ai/...` would have been sent. "No xAI/Grok, ever", no opt-out:
  // checked before the try below, so it is thrown, never degraded to the template.
  const denied = deniedReasonsOf({ provider, model });
  if (denied.length) throw new DeniedModel([{ path: 'digest', reasons: denied }]);
  try {
    const reply = await call(provider, {
      model,
      system: 'You write one short, plain-English paragraph explaining why a review panel '
        + 'disagreed, from the structured summary given. State facts only - no comparative or '
        + 'efficacy language (never say one reviewer is better or more accurate than another). '
        + 'One paragraph, no headers, no markdown.',
      messages: [{ role: 'user', content: JSON.stringify(summary) }],
      maxTokens,
    });
    const text = (reply?.text || '').trim();
    return text || fallback;
  } catch {
    // A model-call failure degrades to the deterministic template rather than leaving no digest
    // at all - same "read-only, never blocking" spirit as the rest of this module.
    return fallback;
  }
}

export function readCompletedRun(runDir) {
  const reportPath = join(runDir, 'report.json');
  if (!existsSync(reportPath)) {
    throw new Error(`no report.json in ${runDir} - digest can only be generated after a run has finished`);
  }
  return JSON.parse(readFileSync(reportPath, 'utf8'));
}

export function writeDigest(runDir, text) {
  const path = join(runDir, 'digest.md');
  writeFileSync(path, text.endsWith('\n') ? text : text + '\n');
  return path;
}
