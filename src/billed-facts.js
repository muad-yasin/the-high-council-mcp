// 0.8.4 unit 1 (D12 part 1; his 03 Nov 2026: "0.8.4 records what was billed beside THC's own count"). The ONE place that decides what counts as a recorded billed figure and a recorded generation id. A leaf module: it imports nothing, so every
// writer and reader of these two fields (the adapter, the stage record, the charge file, the replay, the side-run writer, the report's strip) can use it without widening any import graph.
//
// OpenRouter returns `usage.cost`, "the total amount charged to your account", and the response's `id` names the generation. Both are read only for OpenRouter and only when plain: a finite number of zero or more for the cost, a short
// token for the id. Nothing else is copied from a reply. A missing or unreadable value leaves the field OUT - never $0 - so "not reported" can be told from "free". UNVERIFIED (PROVIDER_BILLED_COST.md): whether `cost` is after the
// cache discount, and whether it is USD or credits. The figure is recorded beside THC's own count and counts for nothing here.

const GENERATION_ID = /^[A-Za-z0-9_.:-]{1,100}$/;
export const isBilledUsd = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export const isGenerationId = v => typeof v === 'string' && GENERATION_ID.test(v);

/** From a record that already uses the field names (a stage, a usage file, a charge payload, an error body): { providerReportedCost?, generationId? }, each only when plain. Never throws. */
export function billedFieldsOf(o) {
  const out = {};
  try {
    // The field says what it is: `providerReportedCost` is what the PROVIDER reported (not THC's count, not a verified bill), and `providerReportedUnverified: true` travels with it until Muad's first approved paid run compares it with
    // OpenRouter's export (PROVIDER_BILLED_COST.md). No reader of a record takes it for the counted amount (C&C, 04 Nov 2026).
    if (isBilledUsd(o?.providerReportedCost)) { out.providerReportedCost = o.providerReportedCost; out.providerReportedUnverified = true; }
    if (isGenerationId(o?.generationId)) out.generationId = o.generationId;
  } catch { /* a getter that throws: nothing is read */ }
  return out;
}

/** From a parsed OpenRouter reply body: { providerReportedCost?, generationId? } (`usage.cost`, `id`). Any other provider, or a body that is not an object: {}. Never throws. */
export function billedFactsOf(provider, json) {
  if (provider !== 'openrouter' || json === null || typeof json !== 'object') return {};
  try { return billedFieldsOf({ providerReportedCost: json.usage?.cost, generationId: json.id }); } catch { return {}; }
}

/**
 * The discarded attempt of a thinking retry that then answered (0.8.4 unit 2): { discardedAttempt: { usd, providerReportedCost?, providerReportedUnverified?, generationId? } } from a stage-shaped record, or {}. A stage's usd is the answer PLUS this
 * attempt (the waste is folded in); this keeps the split, so a comparison can be made attempt by attempt. Only a plain usd (a finite number of zero or more) makes one; the provider's figure and id ride along only when plain.
 */
export function discardedFieldOf(o) {
  try {
    const d = o?.discardedAttempt;
    if (!isBilledUsd(d?.usd)) return {};
    return { discardedAttempt: { usd: d.usd, ...billedFieldsOf(d) } };
  } catch { return {}; }
}
