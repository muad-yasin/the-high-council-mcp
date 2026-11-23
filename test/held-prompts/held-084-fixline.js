// 0.8.4 leftovers, the judge's fix line (WORDING LVO-w1). His words, 02 Nov 2026 18:27 and 03 Nov 22:12: asking for a fix and then for "the smallest possible fix" is not a wise wording; "sometimes small is good, sometimes complexity is needed".
// A-DRAFT: drafted for the one release wording review, recorded all together or not at all (test/held-prompts-084-fixline.test.js). The words replace the placeholder text of the "fix" field of the judge's reply format in
// src/prompts/core.js (the verdict format, line ~101: "<the smallest change that would fix it>") and src/prompts/tiered.js (the findings format, line ~155: "<the smallest change that fixes it>"). One text serves both.
// It says nothing about making a fix required (open) and nothing about effort.

// criticFixHint(): the placeholder text inside the "fix" field of a judge's reply format.
export function criticFixHint() {
  return '<the change that would fix it, as small or as large as the problem needs>';
}
