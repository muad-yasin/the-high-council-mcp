// A delimiter line the text between two copies of it cannot contain (audit A3-4, 0.8.1): a run of dashes one longer than the longest run of dashes anywhere in the
// text, so no line of the text can equal it or close the block early. Same idea as the backtick fence in src/advice-brief.js. Used by the approval dialog and
// `council gate show`, where a person reads the exact text and must be able to tell where it ends.
export function dashFence(text, min = 40) {
  let longest = 0;
  // Every Unicode dash (\p{Pd}), the minus sign and the light and heavy box-drawing horizontals (U+2500-2503, U+254C-254F) count as a dash: a line of look-alikes cannot match the fence either.
  for (const m of String(text).matchAll(/[\p{Pd}\u2212\u2500-\u2503\u254C-\u254F]+/gu)) longest = Math.max(longest, m[0].length);
  return '-'.repeat(Math.max(min, longest + 1));
}
