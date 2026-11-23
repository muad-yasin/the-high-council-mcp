// 0.8.4 D20 (plan A T5.4), as ruled by C&C on 09 Nov 2026 (option A): the key-shape scan that runs when an excerpt of project text is ADDED, before it is recorded or shown to any seat. It is the run's own outbound
// check (src/outbound-scan.js assertOutboundClean, the same distinctive-key-format scan every prompt gets before it is sent), applied to the excerpt's text on its own: a hit throws the existing
// SecretShapedPrompt, which is the existing secret pause (secret-stop/1, the person's typed `--resume <run> --continue`). No new stop kind, record or verb. Because the scan runs BEFORE the entry is appended, a hit
// records nothing, and an entry's `scans.key_shape` is only ever 'clear' or 'continued_by_person' (every value found was one the person allowed). The pre-send check of every prompt that carries the excerpt stays
// as it is, so text added to an excerpt block is scanned twice and never exempted. No personal-data scan runs here: his 08 Nov 2026 16:30 answer ("a, only at the start") is that none is built mid-run.
import { assertOutboundClean, secretSpansIn } from './outbound-scan.js';

/**
 * -> 'clear' | 'continued_by_person'. Throws SecretShapedPrompt (label `label`, findings with line numbers and names, never a value) when a credential-shaped string is in `text` that the person has not allowed.
 * The options are the run's own outbound-scan options, exactly as invoke() passes them: `allowed` is { key, hashes } (run.json secretAllow) or null; `allow` is the whole-run override the person typed at the start
 * (--allow-secret-shaped): with it nothing throws, and a text that holds a key shape is recorded as continued_by_person (the person chose to send it), a text that holds none as clear.
 * The mapping is exhaustive: clean -> clear, consented -> continued_by_person, waived -> by what the text holds, anything else throws (a new result of the scan must not become a recorded pass by default).
 */
export function scanExcerptKeyShape(label, text, { allow = false, allowed = null } = {}) {
  const user = String(text ?? '');
  const r = assertOutboundClean(label, { system: '', user }, { allow, allowed });
  if (r === 'clean') return 'clear';
  if (r === 'consented') return 'continued_by_person';
  if (r === 'waived') return secretSpansIn(user, { distinctiveOnly: true }).length ? 'continued_by_person' : 'clear';
  throw new Error(`scanExcerptKeyShape: the outbound scan answered ${JSON.stringify(r)}, which has no recorded form`);
}
