// 0.8.4 D38 (C&C 09 Nov 2026, option I): where the excerpt block goes in the text a seat is sent. ONE pure function, called by invoke() on the finished user text before anything else reads it (the key scan, the
// prompt spy, the cost projection, the spend reservation, the prompt hash, an external seat's pause). No text search: with a head (the start of the prompt the call site named) the block follows the head directly,
// which for the judges' prompts is below the draft and its end line and above the per-round material; without one it is the true end of the text. An empty block returns the very same string.
/** -> the user text with `block` placed. `head` (optional) must be the start of `user`; a call site that names a head which is not the start is a call-site error and throws. */
export function placeExcerptBlock(user, block, head) {
  if (typeof block !== 'string' || block === '') return user;
  if (head === undefined || head === null) return `${user}\n\n${block}`;
  if (typeof head !== 'string' || head === '' || !user.startsWith(head)) throw new Error('excerpt block: the head named for the placement is not the start of the prompt (a call-site error); nothing was sent');
  return `${head}\n\n${block}${user.slice(head.length)}`;
}

/**
 * The calls through invoke() that are not shown the excerpt block, by name, with the reason (C&C 09 Nov 2026, condition 5, and his test "reads no plan"). The `answers` stage and the build-check answer are not here: they
 * do not pass through invoke() at all (they are the handling session's own prompts, and the session is the excerpts' source). Every other label gets the block, including the harness helpers whose user text carries the
 * draft or the objections' quotes: the conflict decider, the claim extraction, the argued file, the security review, and the canary probe (an exact copy of the reply prompt, so it must be sent what the real one is sent).
 */
export const NOT_A_SEAT = Object.freeze([
  { label: /^preflight-/, reason: 'its user text is the task description alone: no draft, no objection, and it runs before any stage, so no excerpt can exist yet' },
]);
export const isNotASeat = label => NOT_A_SEAT.some(r => r.label.test(String(label)));
