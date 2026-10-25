// A tree member stopped by a price refusal (exit 24): what the tree says about it (0.8.3 Astra items 38 and 39; C&C thcmcp-6d ruling 20 Okt: ONE rule for items 31-39). The run's own sentence (src/price-refused.js
// priceRefusedWords, written into STOPPED-price_refused.json as `reason`) already splits a refusal OpenRouter said was about the max price from one whose cause nobody knows; it is written for a STANDALONE run, so its lines that
// tell the person to `--resume` or `--skip-seat` the run are left out here: neither works for a member of a tree (the tree resumes it; a member's seat is never skipped). The kind is read from the record the CLI wrote beside the
// marker (report-partial.json `stop.recognised`); a run stopped before the field existed has none: the neutral wording. All sentences are B-DRAFT.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PARTIAL_REPORT_FILE } from './report-shape.js';
import { readStoppedMarker } from './stop-files.js';

/** 'recognised-own' (the same, and the limit came from the seat's own provider.max_price) | 'recognised' (OpenRouter's answer names the max price) | 'other' (a 404 in other words) | 'unknown' (no record of it). */
export function priceStopKindOf(runDir) {
  try {
    const stop = JSON.parse(readFileSync(join(runDir, PARTIAL_REPORT_FILE), 'utf8'))?.stop;
    if (stop?.kind !== 'price_refused') return 'unknown';
    return stop.recognised === true ? (stop.ownPin === true ? 'recognised-own' : 'recognised') : stop.recognised === false ? 'other' : 'unknown';
  } catch { return 'unknown'; }
}

/**
 * The price-refusal part of a member's result, read from the run folder the member stopped in at exit 24: { reason, kind, chain }, or null when the folder holds no price_refused marker. ONE reader for both
 * ways a member ends here: tree-run.js (start) and tree-resume.js (`council tree resume`, BUG-C-055), so the resume path says what the start path says.
 */
export function priceRefusedOf(runDir, chain) {
  const marker = readStoppedMarker(runDir);
  if (marker?.stoppedBy !== 'price_refused') return null;
  return { reason: typeof marker.data?.reason === 'string' ? marker.data.reason : null, kind: priceStopKindOf(runDir), chain };
}

/** The status line of the close screen. */
export function priceStopStatus(kind, { rootId = null, chain = null } = {}) {
  // the accept command is printed whole or not at all (A-DRAFT, C&C thcmcp-cd flag ruling 23 Okt 2026): a root and a chain name are what make it runnable; the tree's own refusal at resume names it where a caller knows neither
  if (kind === 'recognised-own') return `stopped by a price refusal (change the numbers of the seat's own provider.max_price in the chain${rootId && chain ? `, accept them with \`council tree decide ${rootId} --accept-chain-limits ${chain}\`` : ''}, then resume)`;
  if (kind === 'recognised') return "stopped by a price refusal (raise the model's price in pricing.user.json, then resume)";
  if (kind === 'other') return 'stopped by a refusal from OpenRouter whose cause is not known for at least one seat (read its answer, then resume)';   // A-DRAFT (4.1, C&C thcmcp-cd 23 Okt 2026): true for a mixed stop too (the record's `recognised` is every seat); the clause is the same one the MCP price_raise refusal got
  return "stopped by a price refusal (see the provider's answer; if it names the price, raise the model's price in pricing.user.json, then resume)";
}

/** The run's own sentence without the lines that only a standalone run can act on (BUG-C-046: the run's "Recommended: skip" line is one of them, since `--skip-seat` is not available for a tree member). */
export function memberReasonLines(reason) {
  return String(reason ?? '').split('\n').map(l => l.trim()).filter(l => l && !/^(Continue with: |Or skip |Recommended: skip |After you fix the cause|To use the copy with --resume)/.test(l));
}

/** The lines `council tree resume` prints for a member stopped by a price refusal. */
export function priceStopLines({ at, rootId, reason, kind, chain = null }) {
  const L = [`${at} was stopped by a price refusal (exit code 24).`];
  for (const l of memberReasonLines(reason)) L.push(`  ${l}`);
  const go = `then run \`council tree resume ${rootId}\`. The refused stage is asked again; stages already finished are replayed from their saved results without a new call, and the refused stage and the stages after it may cost money. \`--skip-seat\` is not available for a tree member.`;
  // the accept step names the chain the member runs; where the caller does not know it, the step is left out (the tree's own refusal at resume names it) rather than printing a placeholder (A-DRAFT, C&C thcmcp-cd FIX 1)
  const accept = typeof chain === 'string' && chain ? `, run \`council tree decide ${rootId} --accept-chain-limits ${chain}\` at a terminal to see the old and the new limits and confirm them` : '';
  if (kind === 'recognised-own') L.push(`  To go on: change the numbers of the seat's own provider.max_price in the chain the tree uses (nothing else in the chain; a pricing.user.json row does not change a field it sets)${accept}, ${go}`);
  else if (kind === 'recognised') L.push(`  To go on: raise the model's price in pricing.user.json in your project folder, ${go}`);
  else if (kind === 'other') L.push(`  To go on: fix the cause OpenRouter's answer points to, ${go}`);
  else L.push(`  To go on: if the provider's answer names the price, raise the model's price in pricing.user.json in your project folder; ${go}`);
  return L;
}
