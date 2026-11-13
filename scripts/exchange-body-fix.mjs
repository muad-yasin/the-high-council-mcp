// The 084/glm-format change as a function of an OLD request body (A-DRAFT). A body THC sent for a layer-exchange call BEFORE the change goes in; the body the SAME call would carry after it comes out:
// the closing sentence appended to the user message, response_format added for a seat of a listed lab, and the host order rebuilt from the project's CURRENT provider-preference file.
// It calls the code's own helpers (exchangeClosingText, jsonModeSeat, orderFor), never its own copies of them. test/exchange-body-fix.test.js holds it to the call site byte for byte.
// Used by the paid test's preparation (the run-3 bodies of the stages that came back as prose); it sends nothing.
import { exchangeClosingText, jsonModeSeat } from '../src/exchange-json-mode.js';
import { orderFor } from '../src/provider-preference.js';

/**
 * @param {object} old      the request body as it was sent: { ...extra, model, messages: [system, user], max_completion_tokens }
 * @param {object} opts     seat: the seat that made the call (provider, model, lab, extra); jsonModeLabs: the Set from exchangeJsonModeLabs(config) or null; closing: the text exchangeClosingText() gives (default: asks now)
 */
export function fixExchangeBody(old, { seat, jsonModeLabs = null, closing = exchangeClosingText() }) {
  const last = old.messages.length - 1;
  const messages = old.messages.map((m, i) => (i === last && m.role === 'user' ? { ...m, content: m.content + closing } : m));
  const rf = jsonModeSeat(seat, jsonModeLabs).extra?.response_format;
  const out = {};
  for (const [k, v] of Object.entries(old)) {
    if (k === 'model' && rf && !('response_format' in old)) out.response_format = structuredClone(rf);   // the seat's extra comes first in the body, then model, messages, max_completion_tokens
    out[k] = k === 'messages' ? messages : v;
  }
  if (Array.isArray(out.provider?.order)) {
    const order = orderFor({ ...seat, extra: { ...(seat.extra || {}), provider: { ...(seat.extra?.provider || {}) } } });
    if (order) out.provider = { ...out.provider, order };
  }
  return out;
}
