// `council refresh-zdr-list` (0.8.4, Muad's pick (b) for an old list of zero-retention hosts: the person refreshes it with ONE command). One public GET of OpenRouter's list (no key, nothing of the project is sent: the request carries no header, no body and no path of the
// folder), the same table maker as scripts/refresh-zdr-table.mjs, the invariant check, then NARROWED against the list this program shipped with (src/zdr-table.js narrowTable: the result can never allow a host the shipped table lacks, so a file the project can write
// is no way to add one) and written to zdr-hosts.user.json in the project folder, atomically and only when every step passed. A failed refresh (the fetch fails, the page's shape changed, the invariant fails) writes NOTHING: the list in use stays exactly as it was and the
// refusal that asked for the refresh stands; there is never a fallback to running on the old list. The sentences are A-DRAFT (wording rows ZR-w15 to ZR-w17).
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { ZDR_TABLE, ZDR_USER_FILE, ZDR_LIST_URL } from './zero-retention.js';
import { zdrTableOf, allowedSlugsThatMatchOthers, narrowTable } from './zdr-table.js';

const failed = reason => ({ ok: false, lines: [`Could not refresh the list of zero-retention hosts: ${reason}. Nothing was written; the list in use is unchanged.`] });
const validRow = r => r && typeof r === 'object' && typeof r.model_id === 'string' && r.model_id !== '' && typeof r.tag === 'string' && r.tag !== '' && r.pricing && typeof r.pricing === 'object';

/** -> { ok, lines }. `fetchImpl` and `today` are for a test; the verb passes neither. */
export async function refreshZdrList({ work, fetchImpl = globalThis.fetch, today = new Date().toISOString().slice(0, 10), shipped = ZDR_TABLE } = {}) {
  let res;
  try { res = await fetchImpl(ZDR_LIST_URL); } catch (e) { return failed(`OpenRouter's list could not be fetched (${e?.cause?.code || e?.code || e?.message || 'no answer'})`); }
  if (!res || !res.ok) return failed(`OpenRouter's list answered HTTP ${res?.status ?? 'nothing'}`);
  let body;
  try { body = await res.json(); } catch { return failed("OpenRouter's list is not JSON"); }
  const rows = Array.isArray(body?.data) ? body.data : null;
  if (!rows || rows.length === 0) return failed("OpenRouter's list has no endpoint rows (its shape changed)");
  const good = rows.filter(validRow);
  if (good.length / rows.length < 0.95) return failed("most rows of OpenRouter's list do not have the fields this program reads (its shape changed)");
  const fresh = zdrTableOf(good, today);
  if (Object.keys(fresh.models).length === 0) return failed("OpenRouter's list yields no model (its shape changed)");
  const leaks = allowedSlugsThatMatchOthers(good, fresh);
  if (leaks.length) return failed(`a host the list allows would also match one it marks otherwise (${leaks[0].model}: ${leaks[0].slug})`);
  const kept = narrowTable(shipped, fresh);
  const lost = Object.entries(shipped.models).filter(([id, r]) => Object.keys(r.hosts).length > 0 && Object.keys(kept.models[id]?.hosts ?? {}).length === 0).length;
  const path = join(work, ZDR_USER_FILE);
  try { const tmp = `${path}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(kept, null, 1)}\n`); renameSync(tmp, path); } catch (e) { return failed(`${ZDR_USER_FILE} could not be written (${e?.code || e?.message})`); }
  const models = Object.keys(kept.models).length;
  return { ok: true, lines: [`Refreshed the list of zero-retention hosts: OpenRouter's list of ${today}, narrowed to the hosts this program shipped with, is in ${ZDR_USER_FILE} (${models} models${lost ? `; ${lost} model${lost === 1 ? '' : 's'} of the shipped list no longer ${lost === 1 ? 'has' : 'have'} a host this program may use` : ''}). A host OpenRouter added after this version was released is not used until a newer version ships its own list.`] };
}
