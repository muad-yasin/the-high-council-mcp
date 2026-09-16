// MLLM Coder v6 item 2 (relay/runs/2026-09-16T12-16-41-099Z/revise-3.md, "Item 2 - Progress-data
// shape: append-only span list"): a separate, purely additive, non-cryptographic log for GUI
// mid-run polling. Deliberately NOT audit.jsonl (src/audit.js) - that file is a signed,
// hash-chained compliance log keyed on provider-call-level data; this file has no integrity
// chain and no signing, because a GUI polling this for "what's the run doing right now" has no
// need for either property. Deliberately NOT stage-log.jsonl either (the V6-2 span-tree log,
// src/spans.js) - that log already exists for a different purpose (span_id/parent_span_id tree
// reconstruction) and is left untouched; this module writes one flat, human-simple record per
// round/stage boundary, in the exact shape this plan item specifies, so a future GUI has one
// small, stable contract to poll instead of needing to understand the span tree.
//
// One write path only: appendSpanRecord() appends a line. A "current state" view for polling is
// meant to be derived at read time from the last line (readLastSpanRecord()) - there is
// deliberately no second, separately-maintained snapshot file to keep in sync.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function spansFilePath(runDir) {
  return resolve(runDir, 'spans.jsonl');
}

// Every record this module writes carries exactly these keys, in this order, so a reader can
// rely on the shape without guessing which fields a given boundary bothered to fill in. Fields
// this codebase cannot yet compute honestly are passed in as `null` with a `*_reason` sibling
// field explaining why, rather than invented - never silently omitted (an omitted key is
// indistinguishable from a bug that forgot to set it) and never faked with a made-up number.
export function buildSpanRecord({
  runId, stage, round, seatsParticipating, startedAt, endedAt, outcome, costSoFar,
  startedAtReason = null, costSoFarReason = null,
}) {
  if (!runId || !stage) throw new Error('buildSpanRecord: run_id and stage are required');
  return {
    run_id: runId,
    stage,
    round: round ?? null,
    seats_participating: Array.isArray(seatsParticipating) ? seatsParticipating : [],
    started_at: startedAt ?? null,
    ...(startedAt == null ? { started_at_reason: startedAtReason || 'not yet instrumented for this boundary' } : {}),
    ended_at: endedAt ?? null,
    outcome: outcome ?? null,
    cost_so_far: costSoFar ?? null,
    ...(costSoFar == null ? { cost_so_far_reason: costSoFarReason || 'not yet instrumented for this boundary' } : {}),
  };
}

// Appends one line. Never truncates, never rewrites an earlier line - a crash right after this
// call still leaves every previously-written line intact and parseable (Node's appendFileSync is
// a single write(2) call for a string this small; a torn write would still only ever damage the
// newest line, never an earlier one already flushed to disk).
export function appendSpanRecord(runDir, record) {
  appendFileSync(spansFilePath(runDir), `${JSON.stringify(record)}\n`);
}

// Read-time-derived "current state" for a future GUI's polling - the last parseable line in the
// file. Deliberately tolerant of a trailing partial/corrupt line (a run that crashed mid-write):
// scans from the end and returns the first line that parses, rather than the literal last line
// unconditionally, matching this module's own append-only/no-truncation contract.
export function readLastSpanRecord(runDir) {
  const path = spansFilePath(runDir);
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      return JSON.parse(line);
    } catch {
      continue; // torn/partial line from a crash mid-write - skip and keep looking backward
    }
  }
  return null;
}
